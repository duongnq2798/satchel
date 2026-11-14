import { type Address, type Hex, type PublicClient, encodeFunctionData, getAddress, parseAbi, zeroAddress } from "viem";
import { type Liveness, type ReadAt, approvalLiveness } from "./approvals.js";
import { NETWORKS, chainInfo, sendChains } from "./config.js";
import { verifiedClient } from "./evm.js";
import type { ApprovalRecord, SigningRecord } from "./near.js";
import type { Check, Report, Status } from "./report.js";

/**
 * "Make it clean": the transactions that would make a satchel's report read clean, built from the
 * report, the record and each chain's latest block. `fixPlan` decides and reads nothing;
 * `readFixInputs` gathers what it reads. Every fix is a send of 0 from the satchel, so it goes
 * through `sendFromSatchel` and the owner's wallet like any other send. Nothing fixes check 4: its
 * counters only grow.
 */

/** The contract's `MAX_APPROVALS`. An approval past the 32nd row is only counted, and check 4 then fails. */
export const MAX_APPROVAL_ROWS = 32;
/** Above this many open nonces on a chain, the plan offers no buttons to spend them: each one is a wallet approval. */
export const MAX_NONCE_SPENDS = 10;

const APPROVE = parseAbi(["function approve(address spender, uint256 value) returns (bool)"]);
const SET_APPROVAL_FOR_ALL = parseAbi(["function setApprovalForAll(address operator, bool approved)"]);
const PERMIT2_APPROVE = parseAbi(["function approve(address token, address spender, uint160 amount, uint48 expiration)"]);

/**
 * The calls that clear an approval, ABI-encoded. Never `increaseAllowance(spender, 0)`: the contract
 * logs it as a revocation, but the allowance stays. Never `decreaseAllowance`: the contract can't
 * classify it, and an unclassified call makes check 4 fail for good.
 */
export const revokeCalldata = {
  /** ERC-20 `approve(spender, 0)`. An `Approve` row: itemized unless an identical row exists. */
  erc20: (spender: Address): Hex => encodeFunctionData({ abi: APPROVE, functionName: "approve", args: [spender, 0n] }),
  /** ERC-721 `approve(0x0, tokenId)`. An `Approve` row granted to the zero address, which no one can use; itemized too. */
  erc721: (tokenId: bigint): Hex => encodeFunctionData({ abi: APPROVE, functionName: "approve", args: [zeroAddress, tokenId] }),
  /** `setApprovalForAll(operator, false)`. The contract logs it as a revocation and itemizes nothing. */
  operator: (operator: Address): Hex =>
    encodeFunctionData({ abi: SET_APPROVAL_FOR_ALL, functionName: "setApprovalForAll", args: [operator, false] }),
  /**
   * Permit2 `approve(token, spender, 0, 0)`, sent to Permit2. An amount of 0 is a revocation to the
   * contract; an expiration of 0 makes Permit2 store the block's own time.
   */
  permit2: (token: Address, spender: Address): Hex =>
    encodeFunctionData({ abi: PERMIT2_APPROVE, functionName: "approve", args: [token, spender, 0n, 0] }),
};

/** What a fix does to the record's 32 itemized approval rows. */
export type SlotCost =
  /** Logged as a revocation or a value transfer: never itemized. */
  | { kind: "none" }
  /** The same row as row `row` (1-based), so the contract merges it and adds nothing. */
  | { kind: "merges"; row: number }
  /** A new row, in slot `slot` of 32. */
  | { kind: "takes"; slot: number }
  /**
   * It would be a 33rd row, which is only counted, and check 4 then fails for good. The plan refuses
   * it while check 4 passes; once check 4 fails, a counted row costs nothing more, so it sends it.
   */
  | { kind: "over" };

export interface FixAction {
  chainId: number;
  kind: "revoke" | "spend";
  title: string;
  /** The call written out, with full addresses. */
  call: string;
  to: Address;
  value: bigint;
  data: Hex;
  /** The record's approval rows it clears, 0-based; empty for a nonce spend. */
  rows: number[];
  slot: SlotCost;
  /** What it costs the record, in words. */
  cost: string;
  /** The nonce it takes when the chain's fixes are sent in the plan's order; null when the nonce couldn't be read. */
  nonce: bigint | null;
  /** Why the app won't send it; absent when it can. */
  refused?: string;
}

/** A live or unread approval the plan builds no button for: the calls that could clear it, and why it picks none. */
export interface ManualFix {
  chainId: number;
  /** The record's approval row, 0-based. */
  row: number;
  why: string;
  calls: { call: string; to: Address; data: Hex }[];
}

export interface ChainFix {
  chainId: number;
  name: string;
  symbol: string;
  /** Whether the app sends on it from this network's satchels. */
  sendable: boolean;
  /** The satchel's balance there, in wei; null when unread. Every fix pays its gas from it. */
  balance: bigint | null;
  /** The nonce the next send takes, counting pending transactions; null when unread. */
  nextNonce: bigint | null;
  /**
   * Signed nonces no transaction has taken yet: `max_nonce + 1 - nextNonce`, or 0. Also 0 when the
   * report's check 2 passes on the chain, or its latest block holds more: the nonce read lags then.
   */
  openNonces: bigint;
  /** Free revokes first, then revokes that take a slot, then nonce spends: the order to send them in. */
  actions: FixAction[];
  manual: ManualFix[];
  notes: string[];
}

export interface FixPlan {
  /** False when the app can send nothing now: check 1 fails, the satchel is listed, or the report is stale. */
  canSend: boolean;
  notes: string[];
  /** Only the chains with something to do or to wait for. */
  chains: ChainFix[];
  /** Check 4's lines, which no transaction fixes. Empty when it passes. */
  unfixable: string[];
}

/** One chain as `readFixInputs` reads it, at its latest block. */
export interface FixChainState {
  chainId: number;
  /** `getTransactionCount` at `pending`, as `prepareTx` reads it: the nonce the next send takes. */
  pendingNonce: bigint | null;
  /** At the latest block, to tell a send waiting for finality from one waiting to be included. */
  latestNonce: bigint | null;
  balance: bigint | null;
}

export interface FixInputs {
  report: Report;
  record: SigningRecord;
  chains: FixChainState[];
  /** Each of `record.approvals`, in its order, read at its chain's latest block. */
  approvals: Liveness[];
}

function short(hex: string): string {
  return `${hex.slice(0, 6)}…${hex.slice(-4)}`;
}

/** A 32-byte ABI word, as the contract writes a row's `arg`. */
function word(value: bigint): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

/** A row's identity as the contract compares rows: every field, addresses lowercase, `arg` as a number. */
function sameRow(a: ApprovalRecord, b: ApprovalRecord): boolean {
  return (
    BigInt(a.chain_id) === BigInt(b.chain_id) &&
    a.contract.toLowerCase() === b.contract.toLowerCase() &&
    a.kind === b.kind &&
    a.spender.toLowerCase() === b.spender.toLowerCase() &&
    (a.token?.toLowerCase() ?? null) === (b.token?.toLowerCase() ?? null) &&
    BigInt(a.arg) === BigInt(b.arg)
  );
}

interface Revoke {
  title: string;
  call: string;
  to: Address;
  data: Hex;
  /** The row the contract itemizes for it, or null for a revocation. */
  adds: ApprovalRecord | null;
}

/** The ways to clear `row`, whatever its standard: what a manual fix lists. */
function revokesOf(row: ApprovalRecord): Revoke[] {
  const contract = getAddress(row.contract);
  const spender = getAddress(row.spender);
  const base = { chain_id: row.chain_id, contract: contract.toLowerCase(), kind: "Approve" as const, token: null };
  switch (row.kind) {
    case "Approve":
    case "IncreaseAllowance": {
      const erc20: Revoke = {
        title: `Revoke ${short(spender)}'s allowance on ${short(contract)}`,
        call: `approve(${spender}, 0)`,
        to: contract,
        data: revokeCalldata.erc20(spender),
        adds: { ...base, spender: spender.toLowerCase(), arg: word(0n) },
      };
      if (row.kind === "IncreaseAllowance") return [erc20];
      const id = BigInt(row.arg);
      const erc721: Revoke = {
        title: `Clear the approval of token ${id} on ${short(contract)}`,
        call: `approve(${zeroAddress}, ${id})`,
        to: contract,
        data: revokeCalldata.erc721(id),
        adds: { ...base, spender: zeroAddress, arg: word(id) },
      };
      return [erc20, erc721];
    }
    case "SetApprovalForAll":
      return [
        {
          title: `Turn off operator ${short(spender)} on ${short(contract)}`,
          call: `setApprovalForAll(${spender}, false)`,
          to: contract,
          data: revokeCalldata.operator(spender),
          adds: null,
        },
      ];
    case "Permit2Approve": {
      if (row.token === null) return [];
      const token = getAddress(row.token);
      return [
        {
          title: `Revoke ${short(spender)}'s Permit2 allowance for ${short(token)}`,
          call: `approve(${token}, ${spender}, 0, 0)`,
          to: contract,
          data: revokeCalldata.permit2(token, spender),
          adds: null,
        },
      ];
    }
  }
}

/** The one revoke for a live row, or why there is none. */
function revokeFor(row: ApprovalRecord, liveness: Liveness): { revoke: Revoke } | { why: string } {
  const all = revokesOf(row);
  if (all.length === 0) return { why: "The row names no token, so no Permit2 call can be built for it." };
  if (all.length === 1) return { revoke: all[0] };
  // An Approve row: ERC-20 or ERC-721. The wrong call grants a right instead of clearing one:
  // approve(spender, 0) on an ERC-721 contract approves token 0.
  if (liveness.standard === "erc20") return { revoke: all[0] };
  if (liveness.standard === "erc721") return { revoke: all[1] };
  return {
    why: "Both reads find it live: the contract answers ERC-20's allowance and ERC-721's getApproved for this row, so the app can't tell which call clears it. approve(spender, 0) clears an ERC-20 allowance but approves token 0 on an ERC-721 contract; approve(0x0000…0000, tokenId) clears an ERC-721 approval. Check the contract's code, then send the call it needs under Calldata (advanced) in Send from this satchel.",
  };
}

const chainIdsOf = (record: SigningRecord) => [
  ...new Set([...record.evm.map((e) => Number(e.chain_id)), ...record.approvals.map((a) => Number(a.chain_id))]),
];

/** How the report's check 2 read `chainId`: it has one line per chain. */
function pendingOn(report: Report, chainId: number): Status | undefined {
  return report.checks.find((c) => c.id === "pending")?.chains?.find((c) => c.chainId === chainId)?.status;
}

/**
 * The plan: per chain, the revokes for every approval still live at the latest block (free ones
 * first), then a send of 0 to the satchel's own address for each open nonce the revokes don't
 * already spend. Each send takes the address's next pending nonce, so a revoke spends one too.
 * Check 2 decides whether a nonce is spent: a chain whose nonce read is below it gets no sends.
 * Pure: `readFixInputs` reads what it needs.
 */
export function fixPlan({ report, record, chains, approvals }: FixInputs): FixPlan {
  const plan: FixPlan = { canSend: true, notes: [], chains: [], unfixable: [] };
  if (report.verdict === "clean") return plan;
  if (report.recordVersion !== record.version) {
    plan.canSend = false;
    plan.notes.push(
      `The report read record version ${report.recordVersion}, and the record is now at version ${record.version}. Check again before you fix anything.`,
    );
    return plan;
  }
  const net = NETWORKS[report.network];
  const mainnet = report.network === "mainnet";
  const check = (id: Check["id"]) => report.checks.find((c) => c.id === id);
  if (check("contract")?.status !== "pass") {
    plan.canSend = false;
    plan.notes.push(
      "Check 1 fails, so the app signs nothing: it checks the deployment before every transaction. None of these fixes can be sent until it passes.",
    );
  }
  if (report.listing) {
    plan.canSend = false;
    plan.notes.push("The satchel is listed, and a listed satchel can't sign. Its owner has to delist it first, under Sell or transfer.");
  }
  const counters = check("counters");
  // Check 4 fails for good already, so a 33rd approval row, which is only counted, changes nothing.
  const counted = counters?.status === "fail";
  if (counted) {
    plan.unfixable = counters.lines;
    plan.notes.push(
      "Check 4 fails, and no transaction fixes it: its counters only grow. The fixes below still close what they close, but the report can't read clean again, for you or any later owner.",
    );
  }

  const own = sendChains(net);
  // Check 3's chains have one entry per approval row, in the record's order (its lines may share one).
  const approvalRows = check("approvals")?.chains;
  const built: { chain: ChainFix; revokes: (Revoke & { rows: number[] })[] }[] = [];

  for (const chainId of chainIdsOf(record)) {
    const info = chainInfo(chainId);
    const name = info?.name ?? `chain ${chainId}`;
    const state = chains.find((c) => c.chainId === chainId);
    const chain: ChainFix = {
      chainId,
      name,
      symbol: info?.symbol ?? "",
      sendable: own.some((c) => c.id === chainId),
      balance: state?.balance ?? null,
      nextNonce: state?.pendingNonce ?? null,
      openNonces: 0n,
      actions: [],
      manual: [],
      notes: [],
    };
    const revokes: (Revoke & { rows: number[] })[] = [];
    // Revoked at the latest block, but not at the finalized one the report read, or not read there.
    let notFinal = false;
    let unreadThen = false;
    record.approvals.forEach((row, i) => {
      if (Number(row.chain_id) !== chainId) return;
      const liveness = approvals[i] ?? { live: null, detail: "not read" };
      if (liveness.live === false) {
        if (approvalRows?.[i]?.status === "fail") notFinal = true;
        if (approvalRows?.[i]?.status === "unknown") unreadThen = true;
        return;
      }
      if (liveness.live === null) {
        const calls = revokesOf(row).map(({ call, to, data }) => ({ call, to, data }));
        chain.manual.push({
          chainId,
          row: i,
          why: `Couldn't read it at the latest block (${liveness.detail}). Check again in a few minutes. If it stays unread, the contract it names may not be a token, and the satchel can't read clean: tell the buyer.`,
          calls,
        });
        return;
      }
      const found = revokeFor(row, liveness);
      if ("why" in found) {
        chain.manual.push({ chainId, row: i, why: found.why, calls: revokesOf(row).map(({ call, to, data }) => ({ call, to, data })) });
        return;
      }
      const same = revokes.find((r) => r.to === found.revoke.to && r.data === found.revoke.data);
      if (same) same.rows.push(i);
      else revokes.push({ ...found.revoke, rows: [i] });
    });
    if (notFinal) {
      chain.notes.push(
        `An approval on ${name} is revoked in a recent block that isn't finalized yet, so there is nothing to send for it. Check 3 passes for it once that block is: check again then.`,
      );
    }
    if (unreadThen) {
      chain.notes.push(
        `The report couldn't read an approval on ${name} at a finalized block; the latest block shows it revoked. Check again in a few minutes.`,
      );
    }
    // Free revokes first: they take no slot, whatever happens to the rest.
    revokes.sort((a, b) => Number(a.adds !== null) - Number(b.adds !== null));
    built.push({ chain, revokes });
  }

  // Each chain's nonces, before any slot is counted: a chain whose nonce read lags sends nothing.
  const lagging = new Set<ChainFix>();
  for (const { chain } of built) {
    const { chainId, name } = chain;
    const signed = record.evm.find((e) => Number(e.chain_id) === chainId);
    const state = chains.find((c) => c.chainId === chainId);
    // The RPC answered a next nonce that is already spent: check 2 read more at a finalized block, or
    // the latest block holds more. A send now could sign at a spent nonce, so the plan sends nothing.
    if (signed) {
      const max = BigInt(signed.max_nonce);
      const next = chain.nextNonce;
      const passes = pendingOn(report, chainId) === "pass";
      const latest = state?.latestNonce ?? null;
      if (next === null) {
        if (!passes) {
          chain.notes.push(`Couldn't read the satchel's nonce on ${name}, so the plan can't count its open nonces. Check again in a few minutes.`);
        }
      } else if (next <= max && (passes || (latest !== null && latest > next))) {
        lagging.add(chain);
        chain.notes.push(
          `The RPC for ${name} answered ${next} as the next nonce, though ${passes ? "the report read a later one at a finalized block" : `the address's nonce at its latest block is already ${latest}`}. A send there now could sign a nonce that is already spent, so the plan sends nothing on ${name}. Check again.`,
        );
      } else if (next <= max) {
        chain.openNonces = max + 1n - next;
      } else if (!passes) {
        chain.notes.push(
          latest === null
            ? `A transaction at nonce ${max} is sent but not finalized yet, so no nonce is left to spend. Check 2 passes for ${name} once its block is finalized: check again then.`
            : latest > max
              ? `The transaction at nonce ${max} is in a recent block that isn't finalized yet, so no nonce is left to spend. Check 2 passes for ${name} once it is: check again then.`
              : `A transaction at nonce ${max} is sent but not in a block yet, so no nonce is left to spend. Wait for it, and for its block to be finalized, then check again.`,
        );
      }
    }
  }

  // Slots are counted over the whole plan: first the revokes the app sends, chain by chain, then
  // those it refuses (another network's chain, or one whose nonce read lags), so a refused revoke
  // never takes a slot one it sends would need.
  const sends = (chain: ChainFix) => chain.sendable && !lagging.has(chain);
  const itemized = [...record.approvals];
  const slotOf = (adds: ApprovalRecord | null): SlotCost => {
    if (adds === null) return { kind: "none" };
    const same = itemized.findIndex((r) => sameRow(r, adds));
    if (same >= 0) return { kind: "merges", row: same + 1 };
    if (itemized.length >= MAX_APPROVAL_ROWS) return { kind: "over" };
    itemized.push(adds);
    return { kind: "takes", slot: itemized.length };
  };
  const slots = new Map<Revoke, SlotCost>();
  for (const first of [true, false]) {
    for (const { chain, revokes } of built) {
      if (sends(chain) === first) for (const r of revokes) slots.set(r, slotOf(r.adds));
    }
  }

  for (const { chain, revokes } of built) {
    const { chainId, name } = chain;
    const elsewhere = `The app doesn't send on ${name} from a ${report.network} satchel: it sends only on the ${own.length} ${mainnet ? "mainnets" : "testnets"}.`;
    const lags = lagging.has(chain);

    let nonce = lags ? null : chain.nextNonce;
    const take = () => {
      const n = nonce;
      if (nonce !== null) nonce += 1n;
      return n;
    };
    for (const r of revokes) {
      const slot = slots.get(r) ?? { kind: "none" };
      const action: FixAction = {
        chainId,
        kind: "revoke",
        title: r.title,
        call: r.call,
        to: r.to,
        value: 0n,
        data: r.data,
        rows: r.rows,
        slot,
        cost:
          slot.kind === "none"
            ? "Free: the contract logs it as a revocation and itemizes nothing."
            : slot.kind === "merges"
              ? `No new slot: it is the same row as approval row ${slot.row}, which the contract merges it with.`
              : slot.kind === "takes"
                ? `Takes approval slot ${slot.slot} of ${MAX_APPROVAL_ROWS}: the contract itemizes it as a new row, which reads as no right once it is final.`
                : counted
                  ? `Counted, not itemized: the record's ${MAX_APPROVAL_ROWS} approval rows are full, counting the revokes this plan sends before it. Check 4 already fails, so this costs the record nothing more.`
                  : `No slot left: the record's ${MAX_APPROVAL_ROWS} approval rows are full, counting the revokes this plan sends before it.`,
        nonce: null,
      };
      const over = slot.kind === "over" && !counted;
      if (!chain.sendable) {
        // Send from this satchel doesn't offer this chain either: only the near CLI can sign there.
        action.refused = over
          ? `${elsewhere} Signed with the near CLI, it would also be a 33rd approval row, which the contract only counts, and check 4 would then fail for good.`
          : elsewhere;
      } else if (lags) {
        // The lag is why, not the slots: this chain's revokes were counted after the rest.
        action.refused = `The RPC for ${name} answered a nonce that is already spent, so this send could sign at it and revoke nothing. Check again.`;
      } else if (over) {
        action.refused = `This revoke would be a 33rd approval row, which the contract only counts, and check 4 would then fail for good. The app won't send it. Revoking it still protects what the address holds: to do that anyway, send this call under Calldata (advanced) in Send from this satchel, knowing the satchel can then never read clean.`;
      } else {
        action.nonce = take();
      }
      chain.actions.push(action);
    }

    const open = chain.openNonces;
    // Every send takes the next pending nonce, so each revoke the app sends here spends one.
    const revoking = BigInt(chain.actions.filter((a) => a.refused === undefined).length);
    if (open > 0n && !chain.sendable) {
      chain.notes.push(`${open} signed nonce(s) are open on ${name}.`);
    } else if (open > BigInt(MAX_NONCE_SPENDS)) {
      chain.notes.push(
        `${open} nonces are open on ${name}, more than the app sends one by one (${MAX_NONCE_SPENDS}), so they can't be fixed from here. From a terminal, send 0 to the satchel's own address ${revoking > 0n ? "once for each open nonce the revokes on this chain don't take" : "once per open nonce"}, with npx -y satchel-nft@0.3.0 send ${report.tokenId} --chain ${chainId} --to ${report.address} --value 0 --as <you>${mainnet ? " --network mainnet" : ""}: each send takes the next one.`,
      );
    } else if (open > 0n) {
      for (let k = revoking; k < open; k++) {
        const n = take();
        chain.actions.push({
          chainId,
          kind: "spend",
          title: n === null ? "Spend an open nonce" : `Spend nonce ${n}`,
          call: `a send of 0 ${chain.symbol} to the satchel's own address, ${report.address}`,
          to: report.address,
          value: 0n,
          data: "0x",
          rows: [],
          slot: { kind: "none" },
          cost: "Free: a plain transfer, which the record never itemizes.",
          nonce: n,
        });
      }
      if (revoking > 0n) {
        chain.notes.push(
          `${open} nonce(s) are open on ${name}, and each revoke on this chain takes the next one, so ${revoking >= open ? "the revokes spend them all" : `${open - revoking} nonce spend(s) cover the rest`}.`,
        );
      }
    }
    if (!chain.sendable && (chain.actions.length > 0 || open > 0n)) {
      chain.notes.push(
        `${elsewhere} To send these there, call sign_evm yourself with the near CLI, then add the signature and broadcast the transaction, as /docs/developers/contract#sign_evm shows. Or tell the buyer: the report shows it until then.`,
      );
    }
    if (chain.sendable && chain.actions.some((a) => a.refused === undefined)) {
      chain.notes.push(
        chain.balance === null
          ? `Couldn't read the satchel's balance on ${name}. Each fix is a transaction there, and pays its gas from that balance.`
          : chain.balance === 0n
            ? open > 0n
              ? `The satchel holds 0 ${chain.symbol} on ${name}, and each fix pays its gas there, so a send stops before your wallet opens until the address is funded.`
              : `The satchel holds 0 ${chain.symbol} on ${name}, and each fix pays its gas there: fund its address first, or the send stops before your wallet opens.`
            : `Each fix is a transaction on ${name}, and pays its gas from the satchel's balance there.`,
      );
    }
    if (chain.sendable && open > 0n) {
      // The signed transactions are public (sign_evm's arguments, and the signature in its receipt);
      // only the lack of gas keeps one from landing ahead of the fix.
      chain.notes.push(
        `The transaction signed at each open nonce on ${name} is public. Once the address can pay for it, anyone can broadcast it before your fix. History on this page lists what each one sends. Fund only what the fixes need, and send them right after.`,
      );
    }
    if (chain.actions.length > 0 || chain.manual.length > 0 || chain.notes.length > 0) plan.chains.push(chain);
  }
  return plan;
}

/**
 * Reads what `fixPlan` needs at each chain's latest block, through the RPC that said it serves that
 * chain: the nonce the next send takes, the balance, and whether each approval row is still live.
 * The latest block, not the finalized one the report reads, so a fix already sent isn't offered
 * again. A read that fails is null, and the plan says so.
 */
export async function readFixInputs(report: Report, record: SigningRecord): Promise<FixInputs> {
  const address = report.address;
  const reads = new Map<number, { client: PublicClient; at: ReadAt }>();
  const orNull = async <T>(read: () => Promise<T>): Promise<T | null> => {
    try {
      return await read();
    } catch {
      return null;
    }
  };
  const chains = await Promise.all(
    chainIdsOf(record).map(async (chainId): Promise<FixChainState> => {
      const unread: FixChainState = { chainId, pendingNonce: null, latestNonce: null, balance: null };
      if (!chainInfo(chainId)) return unread;
      const c = await orNull(() => verifiedClient(chainId));
      const block = c && (await orNull(() => c.getBlock({ blockTag: "latest" })));
      if (!c || !block) return unread;
      reads.set(chainId, { client: c, at: { blockNumber: block.number, now: block.timestamp } });
      const [pendingNonce, latestNonce, balance] = await Promise.all([
        orNull(async () => BigInt(await c.getTransactionCount({ address, blockTag: "pending" }))),
        orNull(async () => BigInt(await c.getTransactionCount({ address, blockNumber: block.number }))),
        orNull(() => c.getBalance({ address, blockNumber: block.number })),
      ]);
      return { chainId, pendingNonce, latestNonce, balance };
    }),
  );
  const approvals = await Promise.all(
    record.approvals.map(async (row): Promise<Liveness> => {
      const read = reads.get(Number(row.chain_id));
      if (!read) return { live: null, detail: "could not read the chain's latest block" };
      return approvalLiveness(read.client, address, row, read.at);
    }),
  );
  return { report, record, chains, approvals };
}
