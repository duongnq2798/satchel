import type { Network } from "./config";

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

/** The NEAR RPC every read on `net` goes to. `npm run verify` can point it at your own node. */
export function nearRpcUrl(net: Network): string {
  return override ?? net.nearRpc;
}

/** Sends every NEAR read to `url`. For `npm run verify`, which reads one network per run. */
export function setNearRpc(url: string) {
  override = url;
}

export async function nearRpc<T>(net: Network, method: string, params: unknown): Promise<T> {
  const res = await fetch(nearRpcUrl(net), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "satchel", method, params }),
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

/**
 * The value a transaction returned, or a readable error. For a call that returned a promise (like
 * `sign_evm`), this is the value the whole chain of receipts resolved to.
 */
export function outcomeValue<T>(outcome: ExecutionOutcome): T | null {
  const status = outcome.status;
  if (status === undefined || typeof status === "string") return null;
  if (status.Failure !== undefined) throw new Error(failureMessage(status.Failure));
  if (status.SuccessValue === undefined) return null;
  const raw = decodeBase64(status.SuccessValue);
  return raw === "" ? null : (JSON.parse(raw) as T);
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
      return await nearRpc<ExecutionOutcome>(net, "tx", { tx_hash: hash, sender_account_id: signer, wait_until: "FINAL" });
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw last instanceof Error ? last : new Error(`transaction ${hash} did not finish`);
}
