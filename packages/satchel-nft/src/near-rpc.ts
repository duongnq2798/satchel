import { sha256 } from "@noble/hashes/sha2";
import { base58Encode } from "./base58.js";

// satchel-nft/near-rpc: a plain NEAR JSON-RPC transport for any node, and reads pinned to one block.
//
//   import { ENDPOINTS, httpRpc, pinnedReader, readOnlyRpc } from "satchel-nft/near-rpc";
//   const rpc = readOnlyRpc(httpRpc(ENDPOINTS.mainnet.rpc));
//   const reader = await pinnedReader(rpc);            // one final block
//   const { keys } = await reader.accessKeys("intents.near");
//
// It retries what is worth retrying and names rate limiting as such; refuses an answer about another
// block than the pinned one; pages access-key lists without dropping pages; reads a transaction with
// all its receipts, with an archival fallback; and `readOnlyRpc` lets only read methods through.
// It reads nothing on its own: every call goes to the RpcCall you pass.

/** Public endpoints: config.ts's nodes, and NEAR's own archival nodes as AGENTS.md names them. */
export const ENDPOINTS = {
  mainnet: {
    rpc: "https://rpc.mainnet.fastnear.com",
    archival: "https://archival-rpc.mainnet.fastnear.com",
    nearArchival: "https://archival-rpc.mainnet.near.org",
    txApi: "https://tx.main.fastnear.com",
  },
  testnet: {
    rpc: "https://rpc.testnet.fastnear.com",
    archival: "https://archival-rpc.testnet.fastnear.com",
    nearArchival: "https://archival-rpc.testnet.near.org",
    txApi: "https://tx.test.fastnear.com",
  },
} as const;

/** One NEAR JSON-RPC call: the same shape as near.ts's RpcCall. */
export type RpcCall = <T>(method: string, params: unknown) => Promise<T>;

export type RpcErrorKind = "timeout" | "http" | "rate-limited" | "network" | "rpc-error" | "bad-answer";

/**
 * A read that failed. `kind` says how: no answer in time, an HTTP error, rate limiting, no
 * connection, a JSON-RPC error the node answered (`data` holds it), or an answer that is wrong.
 */
export class RpcError extends Error {
  readonly method: string;
  readonly kind: RpcErrorKind;
  /** The HTTP status, when there was an answer. */
  readonly status: number | null;
  /** The JSON-RPC `error` body, for kind "rpc-error". */
  readonly data: unknown;
  readonly tries: number;
  /** The node's origin only: scheme, host and port. */
  readonly endpoint: string;
  /** The message after "failed at <endpoint>: ". */
  readonly detail: string;

  constructor(init: {
    method: string;
    kind: RpcErrorKind;
    endpoint: string;
    detail: string;
    status?: number | null;
    data?: unknown;
    tries?: number;
    cause?: unknown;
  }) {
    super(`NEAR RPC ${init.method} failed at ${init.endpoint}: ${init.detail}`, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = "RpcError";
    this.method = init.method;
    this.kind = init.kind;
    this.status = init.status ?? null;
    this.data = init.data ?? null;
    this.tries = init.tries ?? 1;
    this.endpoint = init.endpoint;
    this.detail = init.detail;
  }
}

/** A call `readOnlyRpc` refused before it reached any node. */
export class ReadOnlyError extends Error {
  readonly method: string;
  readonly detail: string;

  constructor(method: string, detail: string) {
    super(`read-only: refused ${method}: ${detail}`);
    this.name = "ReadOnlyError";
    this.method = method;
    this.detail = detail;
  }
}

export interface HttpRpcOptions {
  /** How long one try waits for the whole answer. Default 10_000, as near.ts's RPC_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Tries after the first. Default 4, so 5 tries. */
  retries?: number;
  /** Requests in flight at once, per transport. Default 4. */
  concurrency?: number;
  /** The longest wait a Retry-After gets. Default 8_000. */
  maxRetryAfterMs?: number;
  /** A Retry-After longer than this fails at once, as rate limiting. Default 30_000. */
  giveUpRetryAfterMs?: number;
  /** Sent with every request, such as { Authorization: "Bearer <key>" }. Never logged, never in errors. */
  headers?: Record<string, string>;
  fetch?: typeof fetch;
}

const URL_RULE =
  'httpRpc takes a URL without credentials or a query string; send an API key as headers: { Authorization: "Bearer <key>" }';

/** The origin of `url`: scheme, host and port, with no path, query or credentials. */
export function redactUrl(url: string): string {
  return new URL(url).origin;
}

function checkUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || url.includes("?")) throw new TypeError(URL_RULE);
  return parsed.origin;
}

const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const RATE_LIMIT_STATUSES = new Set([429, 503]);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Up to `n` calls at once; a finished call hands its slot to the next one waiting. */
function limiter(n: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(run: () => Promise<T>): Promise<T> => {
    if (active < n) active++;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await run();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

/** A Retry-After header, in seconds or as an HTTP date, as ms; null when there is none to read. */
function retryAfterMs(res: Response): number | null {
  const header = res.headers.get("retry-after")?.trim();
  if (!header) return null;
  const ms = /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now();
  return Number.isFinite(ms) ? Math.max(0, ms) : null;
}

/** A random wait before try `tries + 1`: about 1, 2, 4 s, then 8 s, between half and all of it. */
function backoffMs(tries: number): number {
  const base = Math.min(8_000, 1_000 * 2 ** (tries - 1));
  return base / 2 + Math.random() * (base / 2);
}

interface Sent {
  label: string;
  url: string;
  init: RequestInit;
}

type Answer = { status: number; text: string } | { status: number; retryAfter: number | null };

/**
 * Sends one request with the retry, timeout and rate-limit rules, and returns the HTTP status and
 * body text of an answer that is not to be retried.
 */
async function send(sent: Sent, endpoint: string, options: HttpRpcOptions, slot: <T>(run: () => Promise<T>) => Promise<T>) {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const retries = options.retries ?? 4;
  const maxRetryAfterMs = options.maxRetryAfterMs ?? 8_000;
  const giveUpRetryAfterMs = options.giveUpRetryAfterMs ?? 30_000;
  const fail = (kind: RpcErrorKind, detail: string, tries: number, status: number | null = null, cause?: unknown) =>
    new RpcError({ method: sent.label, kind, endpoint, detail, status, tries, cause });

  for (let tries = 1; ; tries++) {
    const last = tries > retries;
    const outcome: { answer: Answer } | { timeout: true } | { network: unknown } = await slot(async () => {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let timedOut = false;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new Error("timeout"));
          controller.abort();
        }, timeoutMs);
      });
      const exchange = (async (): Promise<Answer> => {
        const doFetch = options.fetch ?? globalThis.fetch;
        const res = await doFetch(sent.url, { ...sent.init, signal: controller.signal });
        if (RETRY_STATUSES.has(res.status)) {
          await res.body?.cancel().catch(() => {});
          return { status: res.status, retryAfter: retryAfterMs(res) };
        }
        return { status: res.status, text: await res.text() };
      })();
      try {
        return { answer: await Promise.race([exchange, timeout]) };
      } catch (err) {
        return timedOut ? { timeout: true as const } : { network: err };
      } finally {
        clearTimeout(timer);
      }
    });

    if ("timeout" in outcome) {
      if (last) throw fail("timeout", `no answer in ${timeoutMs / 1000} s`, tries);
      await sleep(backoffMs(tries));
      continue;
    }
    if ("network" in outcome) {
      const err = outcome.network;
      if (last) throw fail("network", `network error: ${err instanceof Error ? err.message : String(err)}`, tries, null, err);
      await sleep(backoffMs(tries));
      continue;
    }
    const answer = outcome.answer;
    if ("retryAfter" in answer) {
      const limited = `transport: rate-limited (HTTP ${answer.status}) after ${tries} tries`;
      if (answer.retryAfter !== null && answer.retryAfter > giveUpRetryAfterMs) throw fail("rate-limited", limited, tries, answer.status);
      if (last) {
        if (RATE_LIMIT_STATUSES.has(answer.status)) throw fail("rate-limited", limited, tries, answer.status);
        throw fail("http", `HTTP ${answer.status}`, tries, answer.status);
      }
      await sleep(answer.retryAfter === null ? backoffMs(tries) : Math.min(answer.retryAfter, maxRetryAfterMs));
      continue;
    }
    return { status: answer.status, text: answer.text, tries };
  }
}

/**
 * A JSON-RPC transport for the node at `url`. It sends near.ts's body, `{jsonrpc, id: "satchel",
 * method, params}`. It retries HTTP 408, 429, 500, 502, 503 and 504, a fetch that failed and its own
 * timeout, waiting 1, 2, 4 then 8 s (jittered), or the node's Retry-After up to `maxRetryAfterMs`. A
 * JSON-RPC error is an answer and is never retried: it throws RpcError kind "rpc-error" at once.
 */
export function httpRpc(url: string, options: HttpRpcOptions = {}): RpcCall {
  const endpoint = checkUrl(url);
  const slot = limiter(options.concurrency ?? 4);
  const headers = { "content-type": "application/json", ...options.headers };
  const call = async <T>(method: string, params: unknown): Promise<T> => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: "satchel", method, params });
    const { status, text, tries } = await send({ label: method, url, init: { method: "POST", headers, body } }, endpoint, options, slot);
    let parsed: { result?: T; error?: unknown } | null = null;
    try {
      parsed = JSON.parse(text) as { result?: T; error?: unknown };
    } catch {
      parsed = null;
    }
    const isObject = typeof parsed === "object" && parsed !== null;
    if (isObject && parsed?.error !== undefined) {
      throw new RpcError({ method, kind: "rpc-error", endpoint, detail: JSON.stringify(parsed.error), status, data: parsed.error, tries });
    }
    if (status < 200 || status >= 300) throw new RpcError({ method, kind: "http", endpoint, detail: `HTTP ${status}`, status, tries });
    if (!isObject) throw new RpcError({ method, kind: "bad-answer", endpoint, detail: "the answer is not JSON", status, tries });
    if (!("result" in (parsed as object))) {
      throw new RpcError({ method, kind: "bad-answer", endpoint, detail: "the answer has no result", status, tries });
    }
    return (parsed as { result: T }).result;
  };
  return named(call as RpcCall, endpoint);
}

/** GETs JSON from `url` with httpRpc's retry, timeout, URL and header rules. */
export function httpGetJson<T>(url: string, options: Omit<HttpRpcOptions, "concurrency"> = {}): Promise<T> {
  const endpoint = checkUrl(url);
  return restJson<T>({ label: `GET ${new URL(url).pathname}`, url, init: { method: "GET", headers: { ...options.headers } } }, endpoint, options);
}

async function restJson<T>(sent: Sent, endpoint: string, options: HttpRpcOptions): Promise<T> {
  const { status, text, tries } = await send(sent, endpoint, options, limiter(1));
  if (status < 200 || status >= 300) throw new RpcError({ method: sent.label, kind: "http", endpoint, detail: `HTTP ${status}`, status, tries });
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new RpcError({ method: sent.label, kind: "bad-answer", endpoint, detail: "the answer is not JSON", status, tries });
  }
}

/**
 * Asks FastNEAR's transaction index (ENDPOINTS.*.txApi) who signed a transaction, which
 * `EXPERIMENTAL_tx_status` needs: POST `{tx_hashes: [hash]}` to `<base>/v0/transactions`, the shape
 * dao.ts reads. Null when the index does not know the transaction.
 */
export function fastnearSenderLookup(txApiBase: string, options: HttpRpcOptions = {}): (hash: string) => Promise<string | null> {
  const url = `${txApiBase.replace(/\/+$/, "")}/v0/transactions`;
  const endpoint = checkUrl(url);
  const headers = { "content-type": "application/json", ...options.headers };
  return async (hash) => {
    const body = await restJson<{ transactions?: ({ transaction?: { signer_id?: unknown } } | null)[] }>(
      { label: "POST /v0/transactions", url, init: { method: "POST", headers, body: JSON.stringify({ tx_hashes: [hash] }) } },
      endpoint,
      options,
    );
    const signer = body?.transactions?.[0]?.transaction?.signer_id;
    return typeof signer === "string" ? signer : null;
  };
}

const ENDPOINT = Symbol("endpoint");

/** Marks `call` with the origin it reads, so errors made above the transport can name it. */
function named(call: RpcCall, endpoint: string): RpcCall {
  return Object.assign(call, { [ENDPOINT]: endpoint });
}

/** The origin `rpc` reads, when httpRpc (or a wrapper here) made it. */
function endpointOf(rpc: RpcCall): string {
  return (rpc as RpcCall & { [ENDPOINT]?: string })[ENDPOINT] ?? "the RPC";
}

const FALLBACK_KINDS: ReadonlySet<RpcErrorKind> = new Set(["timeout", "http", "rate-limited", "network"]);

/**
 * Calls `primary`, and makes one call to `fallback` when the primary failed as a transport (kind
 * timeout, http, rate-limited or network). A JSON-RPC error or a bad answer is an answer, and passes.
 */
export function withFallback(primary: RpcCall, fallback: RpcCall): RpcCall {
  const call = async <T>(method: string, params: unknown): Promise<T> => {
    try {
      return await primary<T>(method, params);
    } catch (err) {
      if (!(err instanceof RpcError) || !FALLBACK_KINDS.has(err.kind)) throw err;
      return fallback<T>(method, params);
    }
  };
  return named(call as RpcCall, `${endpointOf(primary)} (or ${endpointOf(fallback)})`);
}

export const READ_METHODS = ["block", "status", "query", "EXPERIMENTAL_tx_status", "tx_status"] as const;
export const READ_QUERY_TYPES = ["view_account", "view_access_key", "view_access_key_list", "view_code", "call_function"] as const;

/**
 * `rpc`, letting only reads through: a method outside READ_METHODS, or a `query` whose request type
 * is outside READ_QUERY_TYPES, throws ReadOnlyError before `rpc` is called. So nothing sent through
 * it can broadcast, send or relay a transaction.
 */
export function readOnlyRpc(rpc: RpcCall): RpcCall {
  const call = async <T>(method: string, params: unknown): Promise<T> => {
    if (!(READ_METHODS as readonly string[]).includes(method)) throw new ReadOnlyError(method, "not a read method");
    if (method === "query") {
      const type = typeof params === "object" && params !== null && !Array.isArray(params) ? (params as { request_type?: unknown }).request_type : undefined;
      if (typeof type !== "string" || !(READ_QUERY_TYPES as readonly string[]).includes(type)) {
        throw new ReadOnlyError(method, `request_type ${JSON.stringify(type ?? null)} is not a read`);
      }
    }
    return rpc<T>(method, params);
  };
  return named(call as RpcCall, endpointOf(rpc));
}

// ---- Reads pinned to one block -----------------------------------------------------------------

/** A block every pinned read answers about. */
export interface PinnedBlock {
  height: number;
  hash: string;
  prevHash: string;
  /** ISO 8601. */
  timestamp: string;
  /** Decimal nanoseconds, so results stay JSON-safe. */
  timestampNs: string;
}

export type At = "final" | { blockHash: string } | { height: number };

interface BlockHeader {
  height: number;
  hash: string;
  prev_hash: string;
  timestamp: number;
  timestamp_nanosec?: string;
}

/** Resolves `at` (default the final block) once, with `block`, and checks the node answered about it. */
export async function blockAt(rpc: RpcCall, at: At = "final"): Promise<PinnedBlock> {
  const params = at === "final" ? { finality: "final" } : "blockHash" in at ? { block_id: at.blockHash } : { block_id: at.height };
  const answer = await rpc<{ header?: Partial<BlockHeader> }>("block", params);
  const header = answer?.header;
  const bad = (detail: string) => new RpcError({ method: "block", kind: "bad-answer", endpoint: endpointOf(rpc), detail });
  if (typeof header?.height !== "number" || typeof header.hash !== "string" || typeof header.prev_hash !== "string") {
    throw bad("the block answer has no header");
  }
  if (at !== "final" && "blockHash" in at && header.hash !== at.blockHash) throw bad(`answered at block ${header.hash}, not ${at.blockHash}`);
  if (at !== "final" && "height" in at && header.height !== at.height) throw bad(`answered at height ${header.height}, not ${at.height}`);
  // `timestamp` is nanoseconds, past what a JSON number holds exactly; `timestamp_nanosec` is the same as a string.
  const timestampNs = String(header.timestamp_nanosec ?? header.timestamp);
  return {
    height: header.height,
    hash: header.hash,
    prevHash: header.prev_hash,
    timestamp: new Date(Number(BigInt(timestampNs) / 1_000_000n)).toISOString(),
    timestampNs,
  };
}

export type KeyPermission =
  | { kind: "full-access" }
  | { kind: "function-call"; receiverId: string; methodNames: string[]; allowance: string | null }
  /** Experimental: no real gas-key answer is recorded yet. */
  | { kind: "gas-key-full-access"; raw: unknown }
  /** Experimental: no real gas-key answer is recorded yet. */
  | { kind: "gas-key-function-call"; receiverId: string | null; methodNames: string[] | null; raw: unknown }
  | { kind: "unknown"; raw: unknown };

export interface AccessKeyInfo {
  publicKey: string;
  nonce: string;
  permission: KeyPermission;
}

export interface AccountView {
  amount: string;
  locked: string;
  code_hash: string;
  storage_usage: number;
  global_contract_hash?: string;
  global_contract_account_id?: string;
}

export type ViewErrorKind = "method-not-found" | "panic" | "no-code" | "account-missing";

/** "Satchel: …" from a view panic, or the raw error: the text of near.ts's viewErrorMessage. */
function viewMessage(method: string, detail: string): string {
  const panic = detail.match(/panic_msg: "((?:[^"\\]|\\.)*)"/);
  return panic ? panic[1] : `${method} failed: ${detail}`;
}

/** A view call the contract (or the missing contract) refused. `cause` is the RpcError, when there was one. */
export class ViewError extends Error {
  readonly account: string;
  readonly method: string;
  readonly kind: ViewErrorKind;
  readonly detail: string;

  constructor(account: string, method: string, kind: ViewErrorKind, detail: string, cause?: unknown) {
    super(viewMessage(method, detail), cause === undefined ? undefined : { cause });
    this.name = "ViewError";
    this.account = account;
    this.method = method;
    this.kind = kind;
    this.detail = detail;
  }
}

/** The kind of a contract-side failure, from its text. */
function failureKind(text: string): ViewErrorKind {
  if (/MethodNotFound|MethodResolveError/.test(text)) return "method-not-found";
  if (/CodeDoesNotExist/.test(text)) return "no-code";
  return "panic";
}

/** A permission as a node answers it, parsed; anything this code does not know is `unknown`. */
export function parsePermission(raw: unknown): KeyPermission {
  if (raw === "FullAccess") return { kind: "full-access" };
  if (raw === "GasKeyFullAccess") return { kind: "gas-key-full-access", raw };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { kind: "unknown", raw };
  const keys = Object.keys(raw);
  if (keys.length !== 1) return { kind: "unknown", raw };
  const value = (raw as Record<string, unknown>)[keys[0]];
  if (keys[0] === "FunctionCall") {
    const fc = functionCallShape(value);
    if (!fc) return { kind: "unknown", raw };
    const allowance = (value as { allowance?: unknown }).allowance;
    if (allowance !== null && allowance !== undefined && typeof allowance !== "string") return { kind: "unknown", raw };
    return { kind: "function-call", receiverId: fc.receiverId, methodNames: fc.methodNames, allowance: allowance ?? null };
  }
  if (keys[0] === "GasKeyFullAccess") return { kind: "gas-key-full-access", raw };
  if (keys[0] === "GasKeyFunctionCall") {
    const fc = findFunctionCall(value);
    return { kind: "gas-key-function-call", receiverId: fc?.receiverId ?? null, methodNames: fc?.methodNames ?? null, raw };
  }
  return { kind: "unknown", raw };
}

function functionCallShape(value: unknown): { receiverId: string; methodNames: string[] } | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as { receiver_id?: unknown; method_names?: unknown };
  if (typeof v.receiver_id !== "string" || !Array.isArray(v.method_names) || !v.method_names.every((m) => typeof m === "string")) {
    return null;
  }
  return { receiverId: v.receiver_id, methodNames: v.method_names as string[] };
}

/** A FunctionCall-shaped object in a gas key's value: the value itself, `{FunctionCall: …}`, or an element of a tuple. */
function findFunctionCall(value: unknown): { receiverId: string; methodNames: string[] } | null {
  const direct = functionCallShape(value);
  if (direct) return direct;
  if (typeof value !== "object" || value === null) return null;
  const nested = functionCallShape((value as { FunctionCall?: unknown }).FunctionCall);
  if (nested) return nested;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = functionCallShape(item) ?? functionCallShape((item as { FunctionCall?: unknown } | null)?.FunctionCall);
      if (found) return found;
    }
  }
  return null;
}

/** The `cause.name` of a JSON-RPC error, such as UNKNOWN_ACCOUNT. */
function causeName(err: unknown): string | undefined {
  if (!(err instanceof RpcError) || err.kind !== "rpc-error") return undefined;
  const name = (err.data as { cause?: { name?: unknown } } | null)?.cause?.name;
  return typeof name === "string" ? name : undefined;
}

/** The text of a JSON-RPC error, for a ViewError's detail. */
function rpcErrorText(err: RpcError): string {
  const data = (err.data as { data?: unknown; cause?: { info?: { vm_error?: unknown; error_message?: unknown } } } | null) ?? null;
  const vm = data?.cause?.info?.vm_error ?? data?.cause?.info?.error_message;
  if (typeof vm === "string") return vm;
  if (typeof data?.data === "string") return data.data;
  return JSON.stringify(err.data);
}

export interface PinnedReader {
  readonly block: PinnedBlock;
  /** Calls a view method at the pinned block and decodes its JSON (null for an empty result). Throws ViewError or RpcError. */
  view<T>(account: string, method: string, args?: unknown): Promise<T>;
  /** Null when the account does not exist at the block. */
  account(accountId: string): Promise<AccountView | null>;
  /** Null when the key, or the account, does not exist at the block. */
  accessKey(accountId: string, publicKey: string): Promise<AccessKeyInfo | null>;
  /** Every key of the account at the block, page by page. */
  accessKeys(accountId: string, options?: { pageSize?: number; max?: number }): Promise<{ keys: AccessKeyInfo[]; pages: number; paged: boolean }>;
  /** sha256 of the account's code, in base58, and its size; null without code. Reads the whole code. */
  codeSha256(accountId: string): Promise<{ base58: string; bytes: number } | null>;
}

interface KeyListAnswer {
  keys?: { public_key: string; access_key: { nonce: number | string; permission: unknown } }[];
  last_key?: string | null;
  block_hash?: string;
}

/**
 * Resolves `at` (default the final block) once, then reads every query at that block's hash. With
 * `strictBlock` (the default), every answer must name that block; `strictBlock: false` lets an
 * answer with no block hash through, as near.ts does. State at block B is the state after B's chunks
 * ran, so what a receipt saw before it ran is read at its block's `prevHash`.
 */
export async function pinnedReader(rpc: RpcCall, at: At = "final", options: { strictBlock?: boolean } = {}): Promise<PinnedReader> {
  const block = await blockAt(rpc, at);
  const strict = options.strictBlock ?? true;
  const endpoint = endpointOf(rpc);
  const bad = (detail: string) => new RpcError({ method: "query", kind: "bad-answer", endpoint, detail });

  async function query<T extends { block_hash?: string }>(request: Record<string, unknown>): Promise<T> {
    const answer = await rpc<T>("query", { request_type: request.request_type, block_id: block.hash, ...request });
    if (typeof answer !== "object" || answer === null) throw bad("the query answer is not an object");
    if (answer.block_hash === undefined) {
      if (strict) throw bad("answered without a block hash");
    } else if (answer.block_hash !== block.hash) {
      throw bad(`answered at block ${answer.block_hash}, not ${block.hash}`);
    }
    return answer;
  }

  const keyInfo = (k: { public_key: string; access_key: { nonce: number | string; permission: unknown } }): AccessKeyInfo => ({
    publicKey: k.public_key,
    nonce: String(k.access_key.nonce),
    permission: parsePermission(k.access_key.permission),
  });

  return {
    block,

    async view<T>(account: string, method: string, args: unknown = {}): Promise<T> {
      let answer: { result?: number[]; error?: unknown; block_hash?: string };
      try {
        answer = await query({ request_type: "call_function", account_id: account, method_name: method, args_base64: encodeArgs(args) });
      } catch (err) {
        const name = causeName(err);
        if (name === "UNKNOWN_ACCOUNT") throw new ViewError(account, method, "account-missing", rpcErrorText(err as RpcError), err);
        if (name === "NO_CONTRACT_CODE") throw new ViewError(account, method, "no-code", rpcErrorText(err as RpcError), err);
        if (name === "CONTRACT_EXECUTION_ERROR") {
          const text = rpcErrorText(err as RpcError);
          throw new ViewError(account, method, failureKind(text) === "method-not-found" ? "method-not-found" : "panic", text, err);
        }
        throw err;
      }
      if (answer.result === undefined) {
        if (typeof answer.error === "string") throw new ViewError(account, method, failureKind(answer.error), answer.error);
        throw bad(`${method} answered with neither a result nor an error`);
      }
      const text = new TextDecoder().decode(Uint8Array.from(answer.result));
      if (text === "") return null as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        throw bad(`${method} returned bytes that are not JSON`);
      }
    },

    async account(accountId: string): Promise<AccountView | null> {
      let answer: AccountView & { block_hash?: string };
      try {
        answer = await query({ request_type: "view_account", account_id: accountId });
      } catch (err) {
        if (causeName(err) === "UNKNOWN_ACCOUNT") return null;
        throw err;
      }
      const view: AccountView = {
        amount: String(answer.amount),
        locked: String(answer.locked),
        code_hash: answer.code_hash,
        storage_usage: answer.storage_usage,
      };
      if (answer.global_contract_hash !== undefined) view.global_contract_hash = answer.global_contract_hash;
      if (answer.global_contract_account_id !== undefined) view.global_contract_account_id = answer.global_contract_account_id;
      return view;
    },

    async accessKey(accountId: string, publicKey: string): Promise<AccessKeyInfo | null> {
      let answer: { nonce?: number | string; permission?: unknown; error?: unknown; block_hash?: string };
      try {
        answer = await query({ request_type: "view_access_key", account_id: accountId, public_key: publicKey });
      } catch (err) {
        const name = causeName(err);
        if (name === "UNKNOWN_ACCESS_KEY" || name === "UNKNOWN_ACCOUNT") return null;
        throw err;
      }
      if (answer.error !== undefined) {
        if (typeof answer.error === "string" && /does not exist/.test(answer.error)) return null;
        throw new RpcError({ method: "query", kind: "rpc-error", endpoint, detail: JSON.stringify(answer.error), data: answer.error });
      }
      if (answer.permission === undefined || answer.nonce === undefined) throw bad("no permission in the view_access_key answer");
      return { publicKey, nonce: String(answer.nonce), permission: parsePermission(answer.permission) };
    },

    async accessKeys(accountId: string, pageOptions: { pageSize?: number; max?: number } = {}) {
      const pageSize = pageOptions.pageSize ?? 100;
      const max = pageOptions.max ?? 10_000;
      const keys: AccessKeyInfo[] = [];
      const seen = new Set<string>();
      let after: string | undefined;
      let pages = 0;
      for (;;) {
        const request: Record<string, unknown> = { request_type: "view_access_key_list", account_id: accountId, limit: pageSize };
        if (after !== undefined) request.after_key = after;
        let answer: KeyListAnswer;
        try {
          answer = await query<KeyListAnswer>(request);
        } catch (err) {
          if (pages === 0 && after === undefined && olderNode(err)) return unpaged(accountId);
          throw err;
        }
        pages += 1;
        const list = answer.keys;
        if (!Array.isArray(list)) throw bad("the key list answer has no keys");
        if (list.length === 0) return { keys, pages, paged: true };
        for (const k of list) {
          if (seen.has(k.public_key)) throw bad("paging repeated a key");
          seen.add(k.public_key);
          keys.push(keyInfo(k));
        }
        if (keys.length > max) throw bad(`more than ${max} keys`);
        if (answer.last_key === undefined || answer.last_key === null) return { keys, pages, paged: true };
        if (answer.last_key === after) throw bad("paging did not advance");
        after = answer.last_key;
      }
    },

    async codeSha256(accountId: string) {
      let answer: { code_base64?: string; hash?: string; block_hash?: string };
      try {
        answer = await query({ request_type: "view_code", account_id: accountId });
      } catch (err) {
        const name = causeName(err);
        if (name === "NO_CONTRACT_CODE" || name === "UNKNOWN_ACCOUNT") return null;
        throw err;
      }
      if (typeof answer.code_base64 !== "string") throw bad("the view_code answer has no code");
      const code = Uint8Array.from(atob(answer.code_base64), (c) => c.charCodeAt(0));
      const hash = base58Encode(sha256(code));
      if (answer.hash !== undefined && answer.hash !== hash) throw bad(`view_code says hash ${answer.hash}, but the code's sha256 is ${hash}`);
      return { base58: hash, bytes: code.length };
    },
  };

  /** A node before nearcore 2.14, which does not know `limit` and `after_key`. */
  function olderNode(err: unknown): boolean {
    if (!(err instanceof RpcError) || err.kind !== "rpc-error") return false;
    const text = JSON.stringify(err.data ?? null);
    return text.includes("REQUEST_VALIDATION_ERROR") || text.includes("unknown field");
  }

  async function unpaged(accountId: string) {
    const answer = await query<KeyListAnswer>({ request_type: "view_access_key_list", account_id: accountId });
    if (!Array.isArray(answer.keys)) throw bad("the key list answer has no keys");
    if (answer.last_key !== undefined && answer.last_key !== null) throw bad("an unpaged key list answered a last_key");
    const seen = new Set<string>();
    for (const k of answer.keys) {
      if (seen.has(k.public_key)) throw bad("the key list repeated a key");
      seen.add(k.public_key);
    }
    return { keys: answer.keys.map(keyInfo), pages: 1, paged: false };
  }
}

// ---- Transactions and receipts -----------------------------------------------------------------

/** A transaction with every receipt, as `EXPERIMENTAL_tx_status` returns it; the fields read here. */
export interface TxStatusView {
  transaction: { hash: string; signer_id: string; public_key: string; nonce: number; receiver_id: string; actions: unknown[] };
  transaction_outcome: { id: string; block_hash: string; outcome: { status: unknown; receipt_ids: string[] } };
  status: unknown;
  receipts_outcome: {
    id: string;
    block_hash: string;
    outcome: { executor_id: string; logs: string[]; status: unknown; receipt_ids: string[] };
  }[];
  receipts?: { receipt_id: string; predecessor_id: string; receiver_id: string; receipt: unknown }[];
}

export interface ReceiptView {
  receiptId: string;
  blockHash: string | null;
  executorId: string;
  predecessorId: string | null;
  receiverId: string | null;
  /** From `receipts[].receipt.Action.actions`; [] for a data receipt, or when the answer has no `receipts`. */
  actions: unknown[];
  status: unknown;
  logs: string[];
  /** The receipts this one made: `outcome.receipt_ids`. */
  next: string[];
}

/** Each outcome of `tx`, in `receipts_outcome` order, joined with its receipt by id. */
export function receiptsOf(tx: TxStatusView): ReceiptView[] {
  const receipts = new Map((tx.receipts ?? []).map((r) => [r.receipt_id, r]));
  return tx.receipts_outcome.map((o) => {
    const r = receipts.get(o.id);
    const actions = (r?.receipt as { Action?: { actions?: unknown } } | undefined)?.Action?.actions;
    return {
      receiptId: o.id,
      blockHash: typeof o.block_hash === "string" ? o.block_hash : null,
      executorId: o.outcome.executor_id,
      predecessorId: r?.predecessor_id ?? null,
      receiverId: r?.receiver_id ?? null,
      actions: Array.isArray(actions) ? actions : [],
      status: o.outcome.status,
      logs: Array.isArray(o.outcome.logs) ? o.outcome.logs : [],
      next: Array.isArray(o.outcome.receipt_ids) ? o.outcome.receipt_ids : [],
    };
  });
}

/** The function calls among a receipt's actions. */
export function functionCalls(receipt: ReceiptView): { method: string; argsBase64: string; deposit: string; gas: string }[] {
  return receipt.actions.flatMap((action) => {
    const call = typeof action === "object" && action !== null ? (action as { FunctionCall?: unknown }).FunctionCall : undefined;
    if (typeof call !== "object" || call === null) return [];
    const fc = call as { method_name?: unknown; args?: unknown; deposit?: unknown; gas?: unknown };
    if (typeof fc.method_name !== "string") return [];
    return [{ method: fc.method_name, argsBase64: typeof fc.args === "string" ? fc.args : "", deposit: String(fc.deposit ?? "0"), gas: String(fc.gas ?? "0") }];
  });
}

export interface ReadTxOptions {
  /** The transaction's signer, which the RPC needs. */
  sender?: string;
  /** Finds the signer when `sender` is not given, such as fastnearSenderLookup. */
  senderLookup?: (hash: string) => Promise<string | null>;
  /** Tried once if the first node throws an RpcError: regular nodes drop a transaction after a day or two. */
  archival?: RpcCall;
  /** Default FINAL. */
  waitUntil?: "FINAL" | "EXECUTED_OPTIMISTIC" | "NONE";
  /** Default EXPERIMENTAL_tx_status, which older nodes serve; nearcore 2.14 also calls it tx_status. */
  method?: "EXPERIMENTAL_tx_status" | "tx_status";
}

export class ReadTxError extends Error {
  readonly code: "no-sender" | "sender-lookup" | "wrong-tx";
  readonly hash: string;

  constructor(code: "no-sender" | "sender-lookup" | "wrong-tx", hash: string, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ReadTxError";
    this.code = code;
    this.hash = hash;
  }
}

/**
 * Reads transaction `hash` with all its receipts: `method` with `{tx_hash, sender_account_id,
 * wait_until}`, then once on `archival` if the first node threw an RpcError. The answer must be
 * about `hash`.
 */
export async function readTx(rpc: RpcCall, hash: string, options: ReadTxOptions = {}): Promise<TxStatusView> {
  let sender = options.sender ?? null;
  if (sender === null) {
    if (!options.senderLookup) throw new ReadTxError("no-sender", hash, `reading ${hash} needs its sender: pass sender or senderLookup`);
    try {
      sender = await options.senderLookup(hash);
    } catch (err) {
      throw new ReadTxError("sender-lookup", hash, `looking up ${hash}'s sender failed: ${err instanceof Error ? err.message : String(err)}`, err);
    }
    if (sender === null) throw new ReadTxError("no-sender", hash, `the sender lookup knows no transaction ${hash}`);
  }
  const method = options.method ?? "EXPERIMENTAL_tx_status";
  const params = { tx_hash: hash, sender_account_id: sender, wait_until: options.waitUntil ?? "FINAL" };
  let tx: TxStatusView;
  try {
    tx = await rpc<TxStatusView>(method, params);
  } catch (err) {
    if (!(err instanceof RpcError) || !options.archival) throw err;
    tx = await options.archival<TxStatusView>(method, params);
  }
  const answered = (tx as { transaction?: { hash?: unknown } } | null)?.transaction?.hash;
  if (answered !== hash) throw new ReadTxError("wrong-tx", hash, `the node answered about ${String(answered)}, not ${hash}`);
  return tx;
}

// ---- Codecs ------------------------------------------------------------------------------------

/** A NEAR account id: lowercase letters, digits, `-` and `_` between them, parts joined by dots (config.ts's rule). */
const ACCOUNT_ID = /^(?:[a-z\d]+[-_])*[a-z\d]+(?:\.(?:[a-z\d]+[-_])*[a-z\d]+)*$/;

export function isAccountId(text: string): boolean {
  return text.length >= 2 && text.length <= 64 && ACCOUNT_ID.test(text);
}

/** Arguments as NEAR carries them: the JSON's UTF-8 bytes, in base64. */
export function encodeArgs(args: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(args));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** The UTF-8 text of a base64 value: call arguments, a receipt's return value. */
export function decodeBase64(value: string): string {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
