import { type Address, type Hex, getAddress, keccak256 } from "viem";
import { type ChainInfo, NEAR_ARCHIVAL_RPC, type Network, ONE_YOCTO, TGAS, chainInfo, sendChains } from "./config.js";
import {
  type ContractTx,
  type EvmTx,
  type MpcSignature,
  client,
  contractUint,
  fromContractTx,
  l1Fee,
  maxCost,
  recoverSigner,
  signedRawTx,
  signingHash,
  toEvmSignature,
  tokenAddress,
  verifiedClient,
} from "./evm.js";
import { type ExecutionOutcome, NearRpcError, decodeBase64, encodeArgs, failureMessage, nearRpc, nearRpcUrl, view } from "./near.js";
import { satchel } from "./satchel.js";

// A satchel owned by a Sputnik DAO (github.com/near-daos/sputnik-dao-contract, `sputnikdao2`). The
// DAO's members propose a FunctionCall that has the DAO call the Satchel contract, and the vote
// that approves it makes the call. The contract checks the DAO owns the token, builds and hashes
// the EVM transaction from the proposal's arguments and records it, as for any owner.

/**
 * Gas for each call a proposal makes. The DAO attaches it as is, with no share of the vote's
 * unused gas: `sign_evm` needs 50 TGas, and the MPC request gets what the contract leaves.
 */
export const DAO_SIGN_EVM_GAS = 150n * TGAS;
export const DAO_TRANSFER_GAS = 30n * TGAS;
/** For the vote that approves: it runs the proposal's call and its callback inside the same 300 TGas. */
export const DAO_VOTE_GAS = 300n * TGAS;

/** One call in a FunctionCall proposal (sputnikdao2 `ActionCall`). `args` is base64 JSON. */
export interface DaoActionCall {
  method_name: string;
  args: string;
  deposit: string;
  gas: string;
}

export interface FunctionCallKind {
  FunctionCall: { receiver_id: string; actions: DaoActionCall[] };
}

/** A proposal's kind as `get_proposal` returns it. Only FunctionCall is read here. */
export type DaoProposalKind = FunctionCallKind | Record<string, unknown> | string;

export type DaoProposalStatus = "InProgress" | "Approved" | "Rejected" | "Removed" | "Expired" | "Moved" | "Failed";

export interface DaoProposal {
  id: number;
  proposer: string;
  description: string;
  kind: DaoProposalKind;
  status: DaoProposalStatus;
  /** Nanoseconds, as a decimal string. */
  submission_time: string;
  votes?: Record<string, string>;
}

export interface DaoPolicy {
  /** yoctoNEAR `add_proposal` must attach, exactly. */
  proposal_bond: string;
  /** Nanoseconds a proposal stays open for votes. */
  proposal_period: string;
}

/**
 * `add_proposal` arguments that have a Sputnik DAO call `net`'s Satchel contract. The call to
 * `add_proposal` must attach the DAO's `proposal_bond`, no more and no less. Every call carries 1
 * yoctoNEAR, which the contract asks for, from the DAO's balance.
 */
export function daoProposal(net: Network) {
  const call = (description: string, methodName: string, args: Record<string, unknown>, gas: bigint) => ({
    proposal: {
      description,
      kind: {
        FunctionCall: {
          receiver_id: net.contract,
          actions: [{ method_name: methodName, args: encodeArgs(args), deposit: ONE_YOCTO.toString(), gas: gas.toString() }],
        },
      },
    },
  });
  return {
    /** The arguments are the transaction: the contract hashes them itself when the vote passes. */
    signEvm: (tokenId: string, tx: ContractTx, description = signEvmDescription(tokenId, tx)) =>
      call(description, "sign_evm", { token_id: tokenId, tx }, DAO_SIGN_EVM_GAS),
    /** `nft_transfer`, never `nft_transfer_call`: a DAO has no `nft_on_transfer`, so the token would come back. */
    transfer: (tokenId: string, receiverId: string, description = `Give satchel #${tokenId} to ${receiverId}`) =>
      call(description, "nft_transfer", { token_id: tokenId, receiver_id: receiverId }, DAO_TRANSFER_GAS),
  };
}

function signEvmDescription(tokenId: string, tx: ContractTx): string {
  const chain = chainInfo(Number(tx.chain_id))?.name ?? `chain ${tx.chain_id}`;
  const data = tx.data === "0x" || tx.data === undefined ? "" : `, data ${tx.data.length > 42 ? `${tx.data.slice(0, 42)}…` : tx.data}`;
  return `Satchel #${tokenId} signs nonce ${tx.nonce} on ${chain}: ${tx.value} wei to ${tx.to}${data}`;
}

/**
 * `act_proposal` arguments for a vote. `kind` is the proposal's kind exactly as `get_proposal`
 * returned it: newer Sputnik DAOs refuse a vote without it (ERR_WRONG_KIND), and v2.3.1, which
 * testnet's `sputnikv2.testnet` factory deploys, ignores it.
 */
export function daoVote(id: number, kind: DaoProposalKind, action: "VoteApprove" | "VoteReject" = "VoteApprove") {
  return { id, action, proposal: kind };
}

/** Reads a Sputnik DAO on `net`. */
export function sputnikDao(net: Network, daoId: string) {
  const policy = () => view<DaoPolicy>(net, daoId, "get_policy");
  const lastProposalId = () => view<number>(net, daoId, "get_last_proposal_id");
  const proposals = (fromIndex: number, limit: number) =>
    view<DaoProposal[]>(net, daoId, "get_proposals", { from_index: fromIndex, limit });
  return {
    policy,
    proposal: (id: number) => view<DaoProposal>(net, daoId, "get_proposal", { id }),
    lastProposalId,
    proposals,
    /**
     * Every proposal that can still run: in progress or failed (a failed one can be finalized and
     * run again) and inside the policy's proposal period, with 10 minutes to spare for clocks.
     * Proposals are read newest first, until one is older than the period.
     */
    openProposals: async (nowMs = Date.now()): Promise<DaoProposal[]> => {
      const [last, { proposal_period }] = await Promise.all([lastProposalId(), policy()]);
      const oldest = BigInt(nowMs - 10 * 60_000) * 1_000_000n - BigInt(proposal_period);
      const open: DaoProposal[] = [];
      for (let end = last; end > 0; end -= PROPOSALS_PAGE) {
        const from = Math.max(0, end - PROPOSALS_PAGE);
        const page = await proposals(from, end - from);
        for (const p of page) {
          if ((p.status === "InProgress" || p.status === "Failed") && BigInt(p.submission_time) >= oldest) open.push(p);
        }
        if (page.length > 0 && BigInt(page[0].submission_time) < oldest) break;
      }
      return open.sort((a, b) => a.id - b.id);
    },
  };
}

const PROPOSALS_PAGE = 100;

/** The `sign_evm` calls a proposal makes on `net`'s contract. Calls whose arguments aren't JSON are left out. */
export function proposedSignatures(net: Network, proposal: DaoProposal): { tokenId: string; tx: ContractTx }[] {
  const kind = proposal.kind;
  if (typeof kind !== "object" || kind === null || !("FunctionCall" in kind)) return [];
  const call = (kind as FunctionCallKind).FunctionCall;
  if (call.receiver_id !== net.contract) return [];
  return call.actions.flatMap((action) => {
    if (action.method_name !== "sign_evm") return [];
    try {
      const args = JSON.parse(decodeBase64(action.args)) as { token_id?: unknown; tx?: ContractTx };
      return typeof args.token_id === "string" && typeof args.tx === "object" && args.tx !== null
        ? [{ tokenId: args.token_id, tx: args.tx }]
        : [];
    } catch {
      return [];
    }
  });
}

/**
 * An open proposal that already has `tokenId` sign `nonce` on `chainId`, or null. Two of them could
 * both pass and both be signed, and only one can be mined: propose the next nonce instead. Numbers
 * compare as the contract reads them, so "+0" and "00" are nonce 0; a proposal whose chain id or
 * nonce the contract can't read can't sign, so it doesn't clash.
 */
export function nonceClash(net: Network, open: DaoProposal[], tokenId: string, chainId: string, nonce: string): DaoProposal | null {
  const chain = contractUint(chainId);
  const at = contractUint(nonce);
  if (chain === null || at === null) throw new Error(`nonceClash takes a chain id and a nonce as decimal strings, not ${chainId} and ${nonce}`);
  return (
    open.find((p) =>
      proposedSignatures(net, p).some(
        (s) => s.tokenId === tokenId && contractUint(s.tx.chain_id) === chain && contractUint(s.tx.nonce) === at,
      ),
    ) ?? null
  );
}

// ---- Finishing a signature ----------------------------------------------------------------------

type ReceiptStatus = { SuccessValue?: string; SuccessReceiptId?: string; Failure?: unknown } | string;

/** A transaction with every receipt, as `EXPERIMENTAL_tx_status` returns it; only the fields read here. */
export interface TxStatus extends ExecutionOutcome {
  receipts_outcome: { id: string; outcome: { executor_id: string; logs?: string[]; status: ReceiptStatus } }[];
  receipts?: {
    receipt_id: string;
    predecessor_id: string;
    receiver_id: string;
    receipt: { Action?: { actions: (Record<string, unknown> | string)[] } } | Record<string, unknown>;
  }[];
}

function isMpcSignature(value: unknown): value is MpcSignature {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const bigR = v.big_r as Record<string, unknown> | undefined;
  const s = v.s as Record<string, unknown> | undefined;
  return (
    (v.scheme === undefined || v.scheme === "Secp256k1") &&
    typeof bigR?.affine_point === "string" &&
    typeof s?.scalar === "string" &&
    typeof v.recovery_id === "number"
  );
}

/**
 * The MPC signature a transaction's receipts hold, or null. A transaction's own return value holds
 * it only when every call returns the MPC answer up the chain, as a direct `sign_evm` does; a DAO
 * vote returns nothing, and the signature is in the receipt where `net`'s MPC contract answered.
 * So every receipt is read, and only those the MPC contract ran are taken. Two different
 * signatures in one transaction throw: which one is meant can't be told here.
 */
export function signatureFromReceipts(net: Network, tx: TxStatus): MpcSignature | null {
  const found = new Map<string, MpcSignature>();
  for (const { outcome } of tx.receipts_outcome) {
    if (outcome.executor_id !== net.mpc || typeof outcome.status !== "object" || !outcome.status.SuccessValue) continue;
    let value: unknown;
    try {
      value = JSON.parse(decodeBase64(outcome.status.SuccessValue));
    } catch {
      continue;
    }
    if (isMpcSignature(value)) found.set(JSON.stringify([value.big_r.affine_point, value.s.scalar, value.recovery_id]), value);
  }
  if (found.size > 1) throw new Error(`${tx.transaction.hash} holds ${found.size} MPC signatures; finish one sign_evm at a time`);
  return found.values().next().value ?? null;
}

/** A `sign_evm` call on `net`'s contract that one of a transaction's receipts made. */
export interface SignEvmCall {
  receiptId: string;
  /** Who called it: the DAO, for a vote. */
  caller: string;
  /** Empty, and `tx` null, when the arguments aren't JSON: the contract refused the call. */
  tokenId: string;
  tx: ContractTx | null;
  /** The receipt's outcome: null while it hasn't run. */
  status: ReceiptStatus | null;
}

/** The `sign_evm` calls in a transaction's receipts (needs `EXPERIMENTAL_tx_status`, which lists them). */
export function signEvmCalls(net: Network, tx: TxStatus): SignEvmCall[] {
  const outcomes = new Map(tx.receipts_outcome.map((r) => [r.id, r.outcome]));
  return (tx.receipts ?? []).flatMap((r) => {
    if (r.receiver_id !== net.contract) return [];
    const actions = (r.receipt as { Action?: { actions: (Record<string, unknown> | string)[] } }).Action?.actions ?? [];
    return actions.flatMap((action) => {
      const call = typeof action === "object" ? (action.FunctionCall as { method_name?: string; args?: string } | undefined) : undefined;
      if (call?.method_name !== "sign_evm" || typeof call.args !== "string") return [];
      let args: { token_id?: unknown; tx?: ContractTx } | null = null;
      try {
        args = JSON.parse(decodeBase64(call.args));
      } catch {
        // Not JSON: the contract refused the call, which its status shows.
      }
      return [
        {
          receiptId: r.receipt_id,
          caller: r.predecessor_id,
          tokenId: typeof args?.token_id === "string" ? args.token_id : "",
          tx: typeof args?.tx === "object" && args.tx !== null ? args.tx : null,
          status: outcomes.get(r.receipt_id)?.status ?? null,
        },
      ];
    });
  });
}

export type FinishStep = "read" | "hash" | "recover" | "broadcast" | "confirm";

export interface FinishDeps {
  /** The NEAR transaction with all its receipts, once it is final. */
  readTx: (hash: string) => Promise<TxStatus>;
  contractHash: (tx: ContractTx) => Promise<string>;
  /** Fees the sender pays besides gas, like the OP Stack's L1 data fee. */
  extraFee: (tx: EvmTx) => Promise<bigint>;
  balance: (chainId: number, address: Address) => Promise<bigint>;
  /** How many transactions `address` has had mined: the nonce of its next one. */
  minedNonce: (chainId: number, address: Address) => Promise<number>;
  /** The status of a mined transaction, or null if it isn't mined. */
  receipt: (chainId: number, hash: Hex) => Promise<"success" | "reverted" | null>;
  /** Asked once everything has checked out, before broadcasting; it throws to stop. */
  approve: (found: FoundSignature) => Promise<void>;
  broadcast: (chainId: number, raw: Hex) => Promise<Hex>;
  confirm: (chainId: number, hash: Hex) => Promise<"success" | "reverted">;
}

/** What a finished `sign_evm` signed, checked: its transaction, from the satchel's address. */
export interface FoundSignature {
  nearTx: string;
  caller: string;
  tokenId: string;
  chain: ChainInfo;
  from: Address;
  tx: EvmTx;
  raw: Hex;
  /** The EVM transaction's hash. */
  hash: Hex;
  /** The most it can pay on top of `tx.value`: gas at the fee cap, plus any L1 data fee. */
  fee: bigint;
}

export interface FinishResult extends FoundSignature {
  status: "success" | "reverted";
  /** True when someone had already broadcast it and it was mined: nothing was sent. */
  alreadyMined: boolean;
}

export const liveFinishDeps = (net: Network, approve: FinishDeps["approve"]): FinishDeps => ({
  readTx: (hash) => readTxStatus(net, hash),
  contractHash: (tx) => satchel(net).signingHash(tx),
  extraFee: l1Fee,
  balance: async (chainId, address) => (await verifiedClient(chainId)).getBalance({ address }),
  minedNonce: async (chainId, address) => (await verifiedClient(chainId)).getTransactionCount({ address, blockTag: "latest" }),
  receipt: async (chainId, hash) => {
    try {
      return (await (await verifiedClient(chainId)).getTransactionReceipt({ hash })).status;
    } catch (err) {
      if (err instanceof Error && err.name === "TransactionReceiptNotFoundError") return null;
      throw err;
    }
  },
  approve,
  broadcast: (chainId, raw) => client(chainId).sendRawTransaction({ serializedTransaction: raw }),
  confirm: async (chainId, hash) => (await client(chainId).waitForTransactionReceipt({ hash, timeout: 180_000 })).status,
});

/**
 * Reads a transaction with every receipt from `net`'s NEAR RPC. The RPC wants the signer, which
 * FastNEAR's transaction index gives; nothing else is read from the index. The regular node keeps a
 * transaction for a day or two, so an older one is read from FastNEAR's archival node, unless
 * `NEAR_RPC` named another node.
 */
export async function readTxStatus(net: Network, hash: string): Promise<TxStatus> {
  const res = await fetch(`${net.txApi}/v0/transactions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tx_hashes: [hash] }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${net.txApi} answered ${res.status} for ${hash}`);
  const body = (await res.json()) as { transactions?: ({ transaction?: { signer_id?: string } } | null)[] };
  const signer = body.transactions?.[0]?.transaction?.signer_id;
  if (typeof signer !== "string") throw new Error(`No transaction ${hash} on NEAR ${net.id}`);
  const params = { tx_hash: hash, sender_account_id: signer, wait_until: "FINAL" };
  let status: TxStatus;
  try {
    status = await nearRpc<TxStatus>(net, "EXPERIMENTAL_tx_status", params);
  } catch (err) {
    if (!(err instanceof NearRpcError) || nearRpcUrl(net) !== net.nearRpc) throw err;
    status = await nearRpc<TxStatus>(net, "EXPERIMENTAL_tx_status", params, undefined, NEAR_ARCHIVAL_RPC[net.id]);
  }
  if (status.transaction.hash !== hash) throw new Error(`The NEAR RPC answered about ${status.transaction.hash}, not ${hash}`);
  return status;
}

/**
 * Broadcasts what a finished `sign_evm` signed: the call a DAO's vote made, or any other whose
 * signer didn't wait for the MPC network's answer. Before anything is sent, it checks the
 * transaction is the one the contract hashed (`evm_signing_hash` equals viem's hash of the same
 * fields) and that the MPC signature recovers to the satchel's address, derived here from the
 * pinned root key. A transaction someone already broadcast is reported, not sent again.
 */
export async function finishSignEvm(
  net: Network,
  nearTx: string,
  deps: FinishDeps,
  onStep: (step: FinishStep, detail?: string) => void = () => {},
): Promise<FinishResult> {
  onStep("read");
  const read = await deps.readTx(nearTx);
  const calls = signEvmCalls(net, read);
  if (calls.length === 0) throw new Error(`${nearTx} made no sign_evm call on ${net.contract}`);
  if (calls.length > 1) throw new Error(`${nearTx} made ${calls.length} sign_evm calls; this finishes one at a time`);
  const [call] = calls;
  const failed = typeof call.status === "object" && call.status !== null && call.status.Failure !== undefined;
  if (failed) throw new Error(`sign_evm failed in ${nearTx}: ${failureMessage((call.status as { Failure: unknown }).Failure)}`);
  const callTx = call.tx;
  if (callTx === null) throw new Error(`The sign_evm call in ${nearTx} has no transaction in its arguments. Nothing was broadcast.`);
  const signature = signatureFromReceipts(net, read);
  if (signature === null) {
    const mpcFailure = read.receipts_outcome.find(
      (r) => r.outcome.executor_id === net.mpc && typeof r.outcome.status === "object" && r.outcome.status.Failure !== undefined,
    );
    if (mpcFailure) {
      throw new Error(
        `${net.mpc} didn't sign in ${nearTx}: ${failureMessage((mpcFailure.outcome.status as { Failure: unknown }).Failure)}. The record counts nonce ${callTx.nonce}; sign it again.`,
      );
    }
    throw new Error(`${nearTx} holds no MPC signature yet. If it was just sent, run this again in a minute.`);
  }

  const tx = fromContractTx(callTx);
  const chain = chainInfo(tx.chainId);
  if (!chain || !sendChains(net).some((c) => c.id === chain.id)) {
    throw new Error(`A ${net.id} satchel doesn't send on chain ${tx.chainId} from here. Nothing was broadcast.`);
  }

  onStep("hash");
  const local = signingHash(tx);
  const onChain = `0x${await deps.contractHash(callTx)}`;
  if (onChain !== local) throw new Error(`The contract hashes this transaction to ${onChain}, not ${local}. Nothing was broadcast.`);

  onStep("recover");
  const from = await tokenAddress(net, `satchel/${call.tokenId}`);
  const evmSignature = toEvmSignature(signature);
  const recovered = await recoverSigner(tx, evmSignature);
  if (getAddress(recovered) !== getAddress(from)) {
    throw new Error(`The signature recovers to ${recovered}, not satchel #${call.tokenId}'s ${from}. Nothing was broadcast.`);
  }
  const raw = signedRawTx(tx, evmSignature);
  const cost = maxCost(tx, await deps.extraFee(tx));
  const hash = keccak256(raw);
  const found: FoundSignature = { nearTx, caller: call.caller, tokenId: call.tokenId, chain, from, tx, raw, hash, fee: cost - tx.value };

  // The signature is public once the vote passes, so anyone may have broadcast it already.
  const mined = await deps.receipt(chain.id, hash);
  if (mined !== null) return { ...found, status: mined, alreadyMined: true };
  const next = await deps.minedNonce(chain.id, from);
  if (next > tx.nonce) {
    // It may have been mined between the two reads, or read from a node behind the other.
    const minedSince = await deps.receipt(chain.id, hash);
    if (minedSince !== null) return { ...found, status: minedSince, alreadyMined: true };
    throw new Error(
      `Nonce ${tx.nonce} of ${from} is already spent on ${chain.name}. Check ${chain.explorer}/tx/${hash} to see whether this transaction spent it. Nothing was broadcast.`,
    );
  }
  if (next < tx.nonce) {
    throw new Error(`${from}'s next nonce on ${chain.name} is ${next}, and this transaction is for ${tx.nonce}: it would wait until ${next} to ${tx.nonce - 1} are mined. Nothing was broadcast.`);
  }
  const balance = await deps.balance(chain.id, from);
  if (balance < cost) {
    throw new Error(`${from} holds ${balance} wei on ${chain.name} and this can cost up to ${cost}. Fund it and run this again: the signature stays valid.`);
  }

  await deps.approve(found);
  onStep("broadcast", found.hash);
  const sent = await deps.broadcast(chain.id, raw);
  onStep("confirm", sent);
  const status = await deps.confirm(chain.id, sent);
  return { ...found, status, alreadyMined: false };
}
