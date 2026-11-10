import type { Network } from "./config.js";

/** The contract's JSON types (contracts/satchel/src/lib.rs). u64 and u128 arrive as strings. */
export type ApprovalKind = "Approve" | "IncreaseAllowance" | "SetApprovalForAll" | "Permit2Approve";

export interface ApprovalRecord {
  chain_id: string;
  contract: string;
  kind: ApprovalKind;
  spender: string;
  token: string | null;
  arg: string;
}

export interface SigningRecord {
  evm: { chain_id: string; max_nonce: string; signatures: number }[];
  approvals: ApprovalRecord[];
  approvals_not_itemized: number;
  unclassified_calls: number;
  opaque_signatures: number;
  last_opaque_at: string;
  version: string;
}

export interface Listing {
  seller: string;
  price: string;
  record_version: string;
  listed_at: string;
}

export interface SatchelView {
  token_id: string;
  owner_id: string;
  path: string;
  record: SigningRecord;
  listing: Listing | null;
}

export interface Token {
  token_id: string;
  owner_id: string;
  metadata?: { title?: string | null } | null;
}

export interface AccountView {
  amount: string;
  code_hash: string;
  storage_usage: number;
  global_contract_hash?: string;
  global_contract_account_id?: string;
}

export interface ExecutionOutcome {
  transaction: { hash: string; signer_id?: string; receiver_id?: string };
  status?: { SuccessValue?: string; Failure?: unknown } | string;
  final_execution_status?: string;
}

export class NearRpcError extends Error {
  constructor(
    readonly method: string,
    readonly cause: unknown,
  ) {
    super(`NEAR RPC ${method} failed: ${typeof cause === "string" ? cause : JSON.stringify(cause)}`);
  }
}

let override: string | null = null;

/** The NEAR RPC every read on `net` goes to. `satchel-nft verify` can point it at your own node. */
export function nearRpcUrl(net: Network): string {
  return override ?? net.nearRpc;
}

/** Sends every NEAR read to `url`. For the `satchel-nft` CLI, which reads one network per run. */
export function setNearRpc(url: string) {
  override = url;
}

/** `signal`, if given, can abort the read; without one it waits as long as `fetch` does. */
export async function nearRpc<T>(net: Network, method: string, params: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(nearRpcUrl(net), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "satchel", method, params }),
    signal,
  });
  if (!res.ok) throw new NearRpcError(method, `HTTP ${res.status}`);
  const body = (await res.json()) as { result?: T; error?: unknown };
  if (body.error !== undefined) throw new NearRpcError(method, body.error);
  return body.result as T;
}

/** The chain the NEAR RPC for `net` serves, from its status: "testnet" or "mainnet" for the real ones. */
export async function nearChainId(net: Network): Promise<string> {
  return (await nearRpc<{ chain_id: string }>(net, "status", [])).chain_id;
}

function encodeArgs(args: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(args));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function decodeBase64(value: string): string {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Calls a view method at a final block. A panic comes back as `result.error`, not as an RPC error. */
export async function view<T>(net: Network, account: string, method: string, args: unknown = {}): Promise<T> {
  const result = await nearRpc<{ result?: number[]; error?: string }>(net, "query", {
    request_type: "call_function",
    finality: "final",
    account_id: account,
    method_name: method,
    args_base64: encodeArgs(args),
  });
  if (result.result === undefined) throw new Error(viewErrorMessage(method, result.error));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(result.result))) as T;
}

/** "Satchel: …" from a view panic, or the raw error. */
export function viewErrorMessage(method: string, error: string | undefined): string {
  const panic = error?.match(/panic_msg: "((?:[^"\\]|\\.)*)"/);
  return panic ? panic[1] : `${method} failed: ${error ?? "no result"}`;
}

export async function viewAccount(net: Network, account: string): Promise<AccountView> {
  return nearRpc<AccountView>(net, "query", { request_type: "view_account", finality: "final", account_id: account });
}

export async function accessKeyCount(net: Network, account: string): Promise<number> {
  const result = await nearRpc<{ keys: unknown[] }>(net, "query", {
    request_type: "view_access_key_list",
    finality: "final",
    account_id: account,
  });
  return result.keys.length;
}

/** One NEAR JSON-RPC call. Reads pinned to a block take one, so a test can answer them. */
export type RpcCall = <T>(method: string, params: unknown) => Promise<T>;

/** How long a read through `rpcFor` waits for the node. */
export const RPC_TIMEOUT_MS = 10_000;

/**
 * `nearRpc` for `net`, as an `RpcCall` that gives up after `timeoutMs`: a node that never answers
 * fails like one that errs, while the caller still has time to say so.
 */
export function rpcFor(net: Network, timeoutMs = RPC_TIMEOUT_MS): RpcCall {
  return async (method, params) => {
    try {
      return await nearRpc(net, method, params, AbortSignal.timeout(timeoutMs));
    } catch (err) {
      if ((err as { name?: unknown } | null)?.name === "TimeoutError") throw new NearRpcError(method, `no answer in ${timeoutMs / 1000} s`);
      throw err;
    }
  };
}

/** A final NEAR block: every read pinned to it sees the same state. */
export interface BlockRef {
  height: number;
  hash: string;
  /** The block's time, ISO 8601. */
  timestamp: string;
}

export async function finalBlock(rpc: RpcCall): Promise<BlockRef> {
  const { header } = await rpc<{ header: { height: number; hash: string; timestamp: number; timestamp_nanosec?: string } }>(
    "block",
    { finality: "final" },
  );
  // `timestamp` is nanoseconds, past what a JSON number holds exactly; `timestamp_nanosec` is the same as a string.
  const nanos = BigInt(header.timestamp_nanosec ?? header.timestamp);
  return { height: header.height, hash: header.hash, timestamp: new Date(Number(nanos / 1_000_000n)).toISOString() };
}

/** Throws unless a query's answer names the block it was asked for. */
function assertAtBlock(method: string, blockHash: string, answered: string | undefined) {
  if (answered !== undefined && answered !== blockHash) {
    throw new NearRpcError(method, `answered at block ${answered}, not ${blockHash}`);
  }
}

/** Calls a view method at the block `blockHash`, like `view` does at a final one. */
export async function viewAt<T>(rpc: RpcCall, blockHash: string, account: string, method: string, args: unknown = {}): Promise<T> {
  const result = await rpc<{ result?: number[]; error?: string; block_hash?: string }>("query", {
    request_type: "call_function",
    block_id: blockHash,
    account_id: account,
    method_name: method,
    args_base64: encodeArgs(args),
  });
  assertAtBlock(method, blockHash, result.block_hash);
  if (result.result === undefined) throw new Error(viewErrorMessage(method, result.error));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(result.result))) as T;
}

export type AccessKeyPermission =
  | "FullAccess"
  | { FunctionCall: { allowance: string | null; receiver_id: string; method_names: string[] } };

/**
 * `publicKey` on `account` at the block `blockHash`, or null if the account has no such key there.
 * A node says so either as `result.error` ("… does not exist while viewing") or as an
 * UNKNOWN_ACCESS_KEY (or UNKNOWN_ACCOUNT) error; anything else it answers throws.
 */
export async function accessKeyAt(
  rpc: RpcCall,
  blockHash: string,
  account: string,
  publicKey: string,
): Promise<{ permission: AccessKeyPermission } | null> {
  let result: { permission?: AccessKeyPermission; error?: string; block_hash?: string };
  try {
    result = await rpc("query", { request_type: "view_access_key", block_id: blockHash, account_id: account, public_key: publicKey });
  } catch (err) {
    const name = err instanceof NearRpcError ? (err.cause as { cause?: { name?: unknown } } | null)?.cause?.name : undefined;
    if (name === "UNKNOWN_ACCESS_KEY" || name === "UNKNOWN_ACCOUNT") return null;
    throw err;
  }
  assertAtBlock("view_access_key", blockHash, result.block_hash);
  if (result.error !== undefined) {
    if (/does not exist/.test(result.error)) return null;
    throw new NearRpcError("view_access_key", result.error);
  }
  if (result.permission === undefined) throw new NearRpcError("view_access_key", "no permission in the answer");
  return { permission: result.permission };
}

/**
 * The value a transaction returned, or a readable error. For a call that returned a promise (like
 * `sign_evm`), this is the value the whole chain of receipts resolved to.
 */
export function outcomeValue<T>(outcome: ExecutionOutcome): T | null {
  const status = outcome.status;
  if (!finished(outcome) || typeof status !== "object") {
    throw new Error(`Transaction ${outcome.transaction.hash} has not finished: its status is ${JSON.stringify(status ?? null)}`);
  }
  if (status.Failure !== undefined) throw new Error(failureMessage(status.Failure));
  const raw = decodeBase64(status.SuccessValue as string);
  return raw === "" ? null : (JSON.parse(raw) as T);
}

/** Whether every receipt finished: a final status is `{ SuccessValue }` or `{ Failure }`, nothing else. */
export function finished(outcome: ExecutionOutcome): boolean {
  const status = outcome.status;
  return typeof status === "object" && status !== null && (status.SuccessValue !== undefined || status.Failure !== undefined);
}

/** "Satchel: …" from a contract panic, or the raw failure. */
export function failureMessage(failure: unknown): string {
  const text = JSON.stringify(failure);
  const panic = text.match(/Smart contract panicked: ([^"\\]+)/);
  if (panic) return panic[1];
  const execution = text.match(/"ExecutionError":"([^"]+)"/);
  return execution ? execution[1] : text;
}

/** Waits until every receipt of a transaction is final. Wallets often return before MPC answers. */
export async function finalOutcome(net: Network, hash: string, signer: string, attempts = 30): Promise<ExecutionOutcome> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const outcome = await nearRpc<ExecutionOutcome>(net, "tx", { tx_hash: hash, sender_account_id: signer, wait_until: "FINAL" });
      if (finished(outcome)) return outcome;
      last = new Error(`transaction ${hash} has not finished`);
    } catch (err) {
      last = err;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw last instanceof Error ? last : new Error(`transaction ${hash} did not finish`);
}
