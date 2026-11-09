import type { Address } from "viem";
import { type Liveness, type ReadAt, approvalLiveness } from "./approvals";
import { type Network, chainInfo } from "./config";
import { client, tokenAddress, verifiedClient } from "./evm";
import {
  type AccountView,
  type ApprovalRecord,
  type SatchelView,
  accessKeyCount,
  nearRpcUrl,
  view,
  viewAccount,
} from "./near";
import { satchel } from "./satchel";

/**
 * The clean-transfer report: whether a buyer can rule out everything the seller could have kept
 * back. Each check passes, fails, or could not be read; only four passes make a token clean.
 * The pure check functions below decide; `buildReport` only gathers what they read.
 */
export type Status = "pass" | "fail" | "unknown";

export interface Check {
  id: "contract" | "pending" | "approvals" | "counters";
  status: Status;
  title: string;
  lines: string[];
}

export type Verdict = "clean" | "not-provable" | "unknown";

export interface Report {
  tokenId: string;
  owner: string;
  address: Address;
  recordVersion: string;
  listing: SatchelView["listing"];
  checks: Check[];
  verdict: Verdict;
  checkedAt: string;
  /** The RPCs every fact came from. The report is as honest as they are. */
  sources?: string[];
}

export interface ContractFacts {
  accessKeys: number;
  account: Pick<AccountView, "code_hash" | "global_contract_hash" | "global_contract_account_id">;
  mpcContract: string;
}

export function contractCheck(net: Network, facts: ContractFacts): Check {
  const lines: string[] = [];
  let status: Status = "pass";
  const fail = (line: string) => {
    status = "fail";
    lines.push(line);
  };
  if (facts.accessKeys === 0) lines.push("No access keys, so no one can redeploy it or sign as it");
  else fail(`${facts.accessKeys} access key(s) on ${net.contract}: whoever holds one can sign around the record`);

  if (facts.account.global_contract_account_id !== undefined) {
    fail(`Runs a global contract referenced by account (${facts.account.global_contract_account_id}), whose code can change`);
  } else if (facts.account.global_contract_hash !== undefined && facts.account.global_contract_hash !== net.build.codeHash) {
    fail(`Runs global contract code ${facts.account.global_contract_hash}, not the reproducible build`);
  } else if (facts.account.global_contract_hash === undefined && facts.account.code_hash !== net.build.codeHash) {
    fail(`Code hash ${facts.account.code_hash} is not the reproducible build (${net.build.codeHash})`);
  } else {
    lines.push(`Code hash ${net.build.codeHash} is the reproducible build of commit ${net.build.commit.slice(0, 7)}`);
  }

  if (facts.mpcContract === net.mpc) lines.push(`Signs only through ${net.mpc}`);
  else fail(`Signs through ${facts.mpcContract}, not the canonical ${net.mpc}`);

  return {
    id: "contract",
    status,
    title: status === "pass" ? "The contract can't sign behind the record" : "The contract could sign behind the record",
    lines,
  };
}

/** Per chain the record lists: the address's nonce at a finalized block, or null if unreadable. */
export interface ChainNonce {
  chainId: number;
  maxNonce: bigint;
  finalizedNonce: bigint | null;
  /** The nonce at the latest block, only to tell "not final yet" from "still open". */
  latestNonce?: bigint | null;
  blockNumber: bigint | null;
}

/** A signed nonce N is spent once the finalized nonce is above N: some transaction took that slot. */
export function pendingCheck(nonces: ChainNonce[]): Check {
  const lines: string[] = [];
  let status: Status = "pass";
  if (nonces.length === 0) lines.push("Nothing was ever signed for this token through sign_evm");
  for (const n of nonces) {
    const name = chainInfo(n.chainId)?.name ?? `chain ${n.chainId}`;
    if (n.finalizedNonce === null) {
      if (status === "pass") status = "unknown";
      lines.push(`${name}: could not read the nonce at a finalized block`);
    } else if (n.finalizedNonce > n.maxNonce) {
      lines.push(`${name}: signed up to nonce ${n.maxNonce}, finalized nonce is ${n.finalizedNonce}`);
    } else if (n.latestNonce != null && n.latestNonce > n.maxNonce) {
      if (status === "pass") status = "unknown";
      lines.push(
        `${name}: signed up to nonce ${n.maxNonce}; a transaction at that nonce is in a recent block that is not finalized yet. Check again once it is`,
      );
    } else {
      status = "fail";
      // The MPC signature is public in the sign_evm receipt, so anyone can rebuild and broadcast it.
      lines.push(
        `${name}: signed up to nonce ${n.maxNonce}, finalized nonce is ${n.finalizedNonce}. That signature is public in its NEAR receipt, so anyone can still broadcast the transaction until one at nonce ${n.maxNonce} is final`,
      );
    }
  }
  const titles: Record<Status, string> = {
    pass: "No signed transaction is still pending",
    fail: "A signed transaction may still be pending",
    unknown: "Could not confirm every signed nonce is spent",
  };
  return { id: "pending", status, title: titles[status], lines };
}

export interface ApprovalState {
  row: ApprovalRecord;
  liveness: Liveness;
}

export function approvalsCheck(states: ApprovalState[]): Check {
  const lines: string[] = [];
  let status: Status = "pass";
  if (states.length === 0) lines.push("No approval was ever signed for this token");
  for (const { row, liveness } of states) {
    const name = chainInfo(Number(row.chain_id))?.name ?? `chain ${row.chain_id}`;
    const label = `${name}: ${row.kind} on ${short(row.contract)} for ${short(row.spender)}`;
    if (liveness.live === true) status = "fail";
    else if (liveness.live === null && status === "pass") status = "unknown";
    lines.push(`${label}: ${liveness.detail}`);
  }
  const titles: Record<Status, string> = {
    pass: "No approval left behind",
    fail: "An approval is still live",
    unknown: "Could not read every approval",
  };
  return { id: "approvals", status, title: titles[status], lines };
}

export function countersCheck(record: SatchelView["record"]): Check {
  const counts = [
    [record.opaque_signatures, "raw signature(s) over payloads the contract did not build"],
    [record.unclassified_calls, "call(s) the contract could not classify"],
    [record.approvals_not_itemized, "approval(s) signed after the list was full"],
  ] as const;
  const bad = counts.filter(([n]) => n > 0);
  return {
    id: "counters",
    status: bad.length === 0 ? "pass" : "fail",
    title: bad.length === 0 ? "Nothing the record can't explain" : "The record can't explain everything signed",
    lines:
      bad.length === 0
        ? ["0 raw signatures, 0 unclassified calls, 0 approvals over the cap"]
        : bad.map(([n, what]) => `${n} ${what}. No one can rule out what these left behind`),
  };
}

export function verdict(checks: Check[]): Verdict {
  if (checks.some((c) => c.status === "fail")) return "not-provable";
  if (checks.some((c) => c.status === "unknown")) return "unknown";
  return "clean";
}

function short(hex: string): string {
  return `${hex.slice(0, 6)}…${hex.slice(-4)}`;
}

/**
 * The finalized block of a chain, which every read on it is pinned to, after its RPC has said it
 * serves that chain. Where the RPC's "finalized" is its latest block, read further back.
 */
async function finalizedAt(chainId: number): Promise<ReadAt | null> {
  try {
    const c = await verifiedClient(chainId);
    const finalized = await c.getBlock({ blockTag: "finalized" });
    const lag = chainInfo(chainId)?.finalityLag ?? 0n;
    const block = lag === 0n ? finalized : await c.getBlock({ blockNumber: finalized.number - lag });
    return { blockNumber: block.number, now: block.timestamp };
  } catch {
    return null;
  }
}

/** What anyone can read about the deployment itself. One read serves every report on a page. */
export async function contractFacts(net: Network): Promise<ContractFacts> {
  const [accessKeys, account, mpcContract] = await Promise.all([
    accessKeyCount(net, net.contract),
    viewAccount(net, net.contract),
    view<string>(net, net.contract, "mpc_contract"),
  ]);
  return { accessKeys, account, mpcContract };
}

export interface ReportInputs {
  net: Network;
  view: SatchelView;
  address: Address;
  facts: ContractFacts;
  nonces: ChainNonce[];
  approvals: ApprovalState[];
}

export function assemble(inputs: ReportInputs): Report {
  const checks = [
    contractCheck(inputs.net, inputs.facts),
    pendingCheck(inputs.nonces),
    approvalsCheck(inputs.approvals),
    countersCheck(inputs.view.record),
  ];
  return {
    tokenId: inputs.view.token_id,
    owner: inputs.view.owner_id,
    address: inputs.address,
    recordVersion: inputs.view.record.version,
    listing: inputs.view.listing,
    checks,
    verdict: verdict(checks),
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Reads everything for one token, from NEAR and from each chain its record lists. Pass `facts` to
 * share one read of the contract's own facts across many reports.
 */
export async function buildReport(net: Network, tokenId: string, facts?: Promise<ContractFacts>): Promise<Report | null> {
  const token = await satchel(net).get(tokenId);
  if (token === null) return null;
  const [address, contract] = await Promise.all([tokenAddress(net, token.path), facts ?? contractFacts(net)]);

  const chainIds = new Set<number>([
    ...token.record.evm.map((c) => Number(c.chain_id)),
    ...token.record.approvals.map((a) => Number(a.chain_id)),
  ]);
  const pinned = new Map<number, ReadAt | null>();
  await Promise.all([...chainIds].map(async (id) => pinned.set(id, chainInfo(id) ? await finalizedAt(id) : null)));

  const nonces = await Promise.all(
    token.record.evm.map(async (c): Promise<ChainNonce> => {
      const chainId = Number(c.chain_id);
      const at = pinned.get(chainId) ?? null;
      const read = async (blockNumber?: bigint) => {
        try {
          const rpc = client(chainId);
          return BigInt(
            await (blockNumber === undefined
              ? rpc.getTransactionCount({ address, blockTag: "latest" })
              : rpc.getTransactionCount({ address, blockNumber })),
          );
        } catch {
          return null;
        }
      };
      const [finalizedNonce, latestNonce] = at === null ? [null, null] : await Promise.all([read(at.blockNumber), read()]);
      return { chainId, maxNonce: BigInt(c.max_nonce), finalizedNonce, latestNonce, blockNumber: at?.blockNumber ?? null };
    }),
  );

  const approvals = await Promise.all(
    token.record.approvals.map(async (row): Promise<ApprovalState> => {
      const at = pinned.get(Number(row.chain_id)) ?? null;
      if (at === null) return { row, liveness: { live: null, detail: "could not read the chain at a finalized block" } };
      return { row, liveness: await approvalLiveness(client(Number(row.chain_id)), address, row, at) };
    }),
  );

  const sources = [nearRpcUrl(net), ...[...chainIds].flatMap((id) => chainInfo(id)?.rpc ?? [])];
  return { ...assemble({ net, view: token, address, facts: contract, nonces, approvals }), sources };
}
