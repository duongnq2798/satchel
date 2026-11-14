import { bytesToHex } from "@noble/hashes/utils";
import { type At, type KeyPermission, type PinnedBlock, type PinnedReader, RpcError, type RpcCall, ViewError, isAccountId, pinnedReader } from "./near-rpc.js";
import { base64ToBytes, verifyNep413 } from "./nep413.js";

// satchel-nft/account-proof: a NEP-413 signed message turned into a decision, at one final block.
//
//   import { nftOwner, verifyAccountProof } from "satchel-nft/account-proof";
//   const result = await verifyAccountProof({ rpc, proof, expect: { recipient: "example.app", message },
//     predicate: nftOwner("v1.satchel-nft.near", "1") });
//   if (!result.ok) return reply(result.status, result.reason);
//
// A NEP-413 signature proves only that some key signed some text. This checks, cheapest first and with
// no RPC call before the signature verifies: the shape, the time bound to the signed text, the
// signature; then, at one block, that the key is on the account (full access by default) and an
// optional on-chain predicate; and last a replay guard, so a failing proof never uses up a nonce.
// Every outcome is a value: it is safe to call on unauthenticated input. It also ships the NEP-641
// leaf resolver (nep641.ts) and re-exports nep413.ts.

export { NEP413_TAG, type Nep413Payload, base64ToBytes, bytesToBase64, nep413Hash, verifyNep413 } from "./nep413.js";
export {
  type AccessKeyAuthorization,
  NEP641_DOMAIN,
  NEP641_LIMITS,
  type Nep641Code,
  type Nep641LeafResult,
  type Nep641ParseCode,
  type OffchainMessage,
  encodeOffchainMessage,
  nep641Hash,
  nep641ToNep413,
  parseAccessKeyAuthorization,
  verifyNep641Leaf,
} from "./nep641.js";

/** What a client sends: a NEP-413 signature and who it says signed. */
export interface Nep413Proof {
  accountId: string;
  /** `ed25519:<base58>`. */
  publicKey: string;
  /** Base64, as wallets return it, or `ed25519:<base58>`, as near-cli-rs prints it. */
  signature: string;
  /** 32 bytes; base64 when a string. */
  nonce: string | Uint8Array;
  callbackUrl?: string | null;
}

/**
 * A time bound. `issuedAt` must appear, exactly, in the message the server built and the key signed.
 * The message should also name the account on its own line (as satchel-nft/holder's roomMessage does
 * with `Account: <id>`): a NEP-413 signature does not cover the account id, so only the message ties
 * the proof to one account.
 */
export interface Freshness {
  /** ISO 8601 UTC, as Date.prototype.toISOString writes it (up to 9 fractional digits). */
  issuedAt: string;
  /** ms, the server's time when the call starts; default Date.now(). The replay step moves it on by the time the call has taken. */
  now?: number;
  /** How long a proof stays fresh. Default 300_000. */
  windowMs?: number;
  /** How far ahead of `now` a proof may say it was signed. Default 60_000. */
  skewMs?: number;
}

/**
 * Remembers nonces. `claim` is true the first time it sees `key` within `ttlMs`, false after.
 * verifyAccountProof passes a `ttlMs` that lasts until at least issuedAt + windowMs + skewMs by this
 * server's clock, so a replay that is still fresh always finds the first claim. A shared store must
 * keep a key at least that long by its own clock: its expiry must outlive issuedAt + windowMs, and
 * skewMs is the margin for drift between the two clocks.
 */
export interface NonceStore {
  claim(key: string, ttlMs: number): Promise<boolean>;
}

/**
 * A NonceStore in this process's memory: one server instance only. Behind more than one instance, a
 * nonce replayed on another instance is not caught: use a shared store. Full of nonces that have not
 * expired (default 10_000), it throws, so verifyAccountProof fails closed (502 replay-store) rather
 * than forget a live nonce.
 */
export function memoryNonceStore(options: { max?: number } = {}): NonceStore {
  const max = options.max ?? 10_000;
  const expires = new Map<string, number>();
  const purge = (now: number) => {
    for (const [key, at] of expires) if (at <= now) expires.delete(key);
  };
  return {
    async claim(key: string, ttlMs: number): Promise<boolean> {
      const now = Date.now();
      const at = expires.get(key);
      if (at !== undefined && at > now) return false;
      if (at !== undefined) expires.delete(key);
      if (expires.size >= max) purge(now);
      if (expires.size >= max) throw new Error(`the nonce store is full: ${max} nonces have not expired`);
      expires.set(key, now + ttlMs);
      return true;
    },
  };
}

/** What a predicate reads with: the reader pinned to the decision's block, and the same RPC. */
export interface ProofContext {
  reader: PinnedReader;
  rpc: RpcCall;
  accountId: string;
  publicKey: string;
}

export type PredicateResult<F> = { ok: true; facts: F } | { ok: false; status: 403 | 404 | 502; code: string; reason: string; cause?: unknown };

/** An on-chain condition, read at the decision's block. A throw is reported as predicate-rpc (502). */
export type Predicate<F> = (ctx: ProofContext) => Promise<PredicateResult<F>>;

export type ProofStage = "shape" | "time" | "signature" | "block" | "key" | "predicate" | "replay";
export type ProofCode =
  | "malformed"
  | "too-long"
  | "freshness-unbound"
  | "stale"
  | "from-the-future"
  | "unsupported-key-type"
  | "bad-signature"
  | "rpc-block"
  | "rpc-key"
  | "wrong-block"
  | "key-not-on-account"
  | "function-call-key"
  | "unknown-permission"
  | "predicate-refused"
  | "predicate-rpc"
  | "replay-store"
  | "replayed";

export type AccountProofResult<F> =
  | { ok: true; accountId: string; publicKey: string; permission: KeyPermission; block: PinnedBlock; facts: F }
  | {
      ok: false;
      status: 400 | 401 | 403 | 404 | 409 | 502;
      stage: ProofStage;
      code: ProofCode;
      /** The predicate's own code, when stage is "predicate". */
      predicateCode?: string;
      reason: string;
      cause?: unknown;
      block?: PinnedBlock;
    };

const MAX_NONCE_CHARS = 64;
const MAX_CALLBACK_URL_CHARS = 2048;

const ISSUED_AT = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d{1,9})?Z$/;

/** An answer about another block than the pinned one. */
function aboutAnotherBlock(err: unknown): boolean {
  return err instanceof RpcError && err.kind === "bad-answer" && /^answered (without a block hash|at block )/.test(err.detail);
}

const said = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Decides a NEP-413 signed message at one block (default the final one). In order:
 *  0. `nonceStore` without `freshness` rejects with a TypeError: the only rejection.
 *  1. shape (400 malformed / too-long), before any decoding or hashing: an account id, a key of at
 *     most 128 and a signature of at most 256 characters, a 32-byte nonce (as a string, at most 64
 *     characters), a callbackUrl of at most 2048 characters, a message of at most `maxMessageBytes`
 *     in UTF-8;
 *  2. time, with `freshness` (400 malformed / freshness-unbound, 401 stale / from-the-future): the
 *     message must contain `issuedAt` exactly, so the time is part of what was signed;
 *  3. signature (401): ed25519 only, strict RFC 8032, over `expect` (the server builds it);
 *  4. block (502 rpc-block); 5. the key at that block (403 key-not-on-account, function-call-key
 *     unless `keyPolicy.functionCallReceiver` is its receiver, unknown-permission; 502 wrong-block,
 *     rpc-key);
 *  6. the predicate, with the same reader (its own status, code predicate-refused; 502 predicate-rpc);
 *  7. replay (401 stale, 409 replayed, 502 replay-store): the clock is read again (`freshness.now`
 *     moved on by the time spent since the call started), and a proof that went stale while it was
 *     checked is refused without a claim. Otherwise `publicKey \n hex(nonce) \n recipient` (what the
 *     signature binds; the account id is not signed) is claimed last, until issuedAt + windowMs +
 *     skewMs, or for `nonceTtlMs` when that is longer: `nonceTtlMs` is a minimum.
 */
export async function verifyAccountProof<F = undefined>(input: {
  rpc: RpcCall;
  proof: Nep413Proof;
  expect: { recipient: string; message: string };
  keyPolicy?: "full-access" | { functionCallReceiver: string };
  predicate?: Predicate<F>;
  freshness?: Freshness;
  nonceStore?: NonceStore;
  nonceTtlMs?: number;
  strictBlock?: boolean;
  at?: At;
  maxMessageBytes?: number;
}): Promise<AccountProofResult<F>> {
  if (input.nonceStore !== undefined && input.freshness === undefined) {
    throw new TypeError("nonceStore needs freshness: without a time bound a nonce TTL means nothing");
  }
  type Failure = Extract<AccountProofResult<F>, { ok: false }>;
  const refuse = (status: Failure["status"], stage: ProofStage, code: ProofCode, reason: string, more: Partial<Failure> = {}): Failure => ({
    ok: false,
    status,
    stage,
    code,
    reason,
    ...more,
  });

  // 1. Shape.
  const entryDateNow = Date.now();
  const p = (typeof input.proof === "object" && input.proof !== null ? input.proof : {}) as Partial<Record<keyof Nep413Proof, unknown>>;
  const e = (typeof input.expect === "object" && input.expect !== null ? input.expect : {}) as Partial<Record<"recipient" | "message", unknown>>;
  if (typeof p.accountId !== "string" || !isAccountId(p.accountId)) return refuse(400, "shape", "malformed", "accountId is not a NEAR account id");
  if (typeof p.publicKey !== "string" || typeof p.signature !== "string") return refuse(400, "shape", "malformed", "publicKey and signature must be strings");
  if (p.publicKey.length > 128 || p.signature.length > 256) return refuse(400, "shape", "too-long", "publicKey or signature is too long");
  // Base64 of 32 bytes is 44 characters; 64 leaves slack, and nothing longer is decoded.
  if (typeof p.nonce === "string" && p.nonce.length > MAX_NONCE_CHARS) {
    return refuse(400, "shape", "too-long", `the nonce is longer than ${MAX_NONCE_CHARS} characters`);
  }
  const nonce = typeof p.nonce === "string" ? base64ToBytes(p.nonce) : p.nonce instanceof Uint8Array ? p.nonce : null;
  if (nonce === null || nonce.length !== 32) return refuse(400, "shape", "malformed", "nonce must be 32 bytes, as bytes or base64");
  if (typeof e.message !== "string" || typeof e.recipient !== "string") return refuse(400, "shape", "malformed", "expect.message and expect.recipient must be strings");
  const maxMessageBytes = input.maxMessageBytes ?? 8192;
  // UTF-8 never takes fewer bytes than UTF-16 code units, so a longer string is refused unencoded.
  if (e.message.length > maxMessageBytes || new TextEncoder().encode(e.message).length > maxMessageBytes) {
    return refuse(400, "shape", "too-long", `the message is longer than ${maxMessageBytes} bytes`);
  }
  if (p.callbackUrl !== undefined && p.callbackUrl !== null && typeof p.callbackUrl !== "string") {
    return refuse(400, "shape", "malformed", "callbackUrl must be a string or null");
  }
  if (typeof p.callbackUrl === "string" && p.callbackUrl.length > MAX_CALLBACK_URL_CHARS) {
    return refuse(400, "shape", "too-long", `callbackUrl is longer than ${MAX_CALLBACK_URL_CHARS} characters`);
  }
  const accountId = p.accountId;
  const publicKey = p.publicKey;
  const message = e.message;
  const recipient = e.recipient;

  // 2. Time.
  const freshness = input.freshness;
  const windowMs = freshness?.windowMs ?? 300_000;
  const skewMs = freshness?.skewMs ?? 60_000;
  let issuedMs = Number.NaN;
  if (freshness !== undefined) {
    const issuedAt = freshness.issuedAt;
    const m = typeof issuedAt === "string" ? ISSUED_AT.exec(issuedAt) : null;
    issuedMs = m ? Date.parse(issuedAt) : Number.NaN;
    // Date.parse rolls 02-30 over into March, and takes 24:00: such a time does not round-trip.
    if (!m || Number.isNaN(issuedMs) || new Date(issuedMs).toISOString().slice(0, 19) !== m[1]) {
      return refuse(400, "time", "malformed", "issuedAt must be an ISO 8601 UTC time, as toISOString writes it, like 2026-11-14T09:30:00.000Z");
    }
    if (!message.includes(issuedAt)) {
      return refuse(400, "time", "freshness-unbound", `the signed message does not contain issuedAt (${issuedAt}): build the message from it, so the time is part of what was signed`);
    }
    const now = freshness.now ?? Date.now();
    if (issuedMs < now - windowMs) {
      return refuse(401, "time", "stale", `this proof was signed at ${issuedAt}, more than ${windowMs / 1000} s before the server's time, ${new Date(now).toISOString()}`);
    }
    if (issuedMs > now + skewMs) {
      return refuse(401, "time", "from-the-future", `this proof says it was signed at ${issuedAt}, after the server's time, ${new Date(now).toISOString()}`);
    }
  }

  // 3. Signature.
  if (!publicKey.startsWith("ed25519:")) {
    return refuse(401, "signature", "unsupported-key-type", "only ed25519 keys are checked here; secp256k1 NEP-413 signatures are Planned");
  }
  const callbackUrl = typeof p.callbackUrl === "string" ? p.callbackUrl : null;
  if (!verifyNep413({ publicKey, signature: p.signature, message, nonce, recipient, callbackUrl })) {
    return refuse(401, "signature", "bad-signature", `the signature does not verify for ${publicKey} over this message, nonce and recipient ${recipient}`);
  }

  // 4. Block.
  let reader: PinnedReader;
  try {
    reader = await pinnedReader(input.rpc, input.at ?? "final", { strictBlock: input.strictBlock ?? true });
  } catch (err) {
    return refuse(502, "block", "rpc-block", `couldn't read the block: ${said(err)}`, { cause: err });
  }
  const block = reader.block;

  // 5. Key.
  let key: Awaited<ReturnType<PinnedReader["accessKey"]>>;
  try {
    key = await reader.accessKey(accountId, publicKey);
  } catch (err) {
    if (aboutAnotherBlock(err)) return refuse(502, "key", "wrong-block", `the node answered about another block: ${said(err)}`, { cause: err, block });
    return refuse(502, "key", "rpc-key", `couldn't read ${accountId}'s key at block ${block.height}: ${said(err)}`, { cause: err, block });
  }
  if (key === null) return refuse(403, "key", "key-not-on-account", `${publicKey} is not a key of ${accountId} at block ${block.height}`, { block });
  const permission = key.permission;
  const receiver = typeof input.keyPolicy === "object" && input.keyPolicy !== null ? input.keyPolicy.functionCallReceiver : null;
  if (permission.kind === "function-call" || permission.kind === "gas-key-function-call") {
    if (receiver === null || permission.receiverId !== receiver) {
      return refuse(
        403,
        "key",
        "function-call-key",
        `${publicKey} is a function-call key of ${accountId}${permission.receiverId ? ` for ${permission.receiverId}` : ""}, the kind a site you signed in to keeps; sign with a full-access key`,
        { block },
      );
    }
  } else if (permission.kind !== "full-access" && permission.kind !== "gas-key-full-access") {
    return refuse(403, "key", "unknown-permission", `${publicKey} has a permission this code does not know, so it never passes`, { block });
  }

  // 6. Predicate.
  let facts = undefined as F;
  if (input.predicate) {
    let result: PredicateResult<F>;
    try {
      result = await input.predicate({ reader, rpc: input.rpc, accountId, publicKey });
    } catch (err) {
      return refuse(502, "predicate", "predicate-rpc", `the on-chain check failed: ${said(err)}`, { cause: err, block });
    }
    if (!result.ok) {
      const more: Partial<Failure> = { predicateCode: result.code, block };
      if (result.cause !== undefined) more.cause = result.cause;
      return refuse(result.status, "predicate", "predicate-refused", result.reason, more);
    }
    facts = result.facts;
  }

  // 7. Replay, last. The reads above took time: a proof that went stale meanwhile is refused
  // unclaimed, and the claim lives until issuedAt + windowMs + skewMs, past the last moment at which
  // a replay could still be fresh.
  if (input.nonceStore && freshness !== undefined) {
    const nowClaim = freshness.now === undefined ? Date.now() : freshness.now + (Date.now() - entryDateNow);
    if (issuedMs < nowClaim - windowMs) {
      return refuse(
        401,
        "time",
        "stale",
        `this proof went stale while it was checked: signed at ${freshness.issuedAt}, more than ${windowMs / 1000} s before the server's time, ${new Date(nowClaim).toISOString()}`,
        { block },
      );
    }
    // What the signature binds. The account id is not signed, so it is not part of the key.
    const claimKey = `${publicKey}\n${bytesToHex(nonce)}\n${recipient}`;
    const ttlMs = Math.max(input.nonceTtlMs ?? 0, issuedMs + windowMs + skewMs - nowClaim);
    let first: boolean;
    try {
      first = await input.nonceStore.claim(claimKey, ttlMs);
    } catch (err) {
      return refuse(502, "replay", "replay-store", `couldn't check the nonce: ${said(err)}`, { cause: err, block });
    }
    if (!first) return refuse(409, "replay", "replayed", "this nonce was already used: sign again", { block });
  }

  return { ok: true, accountId, publicKey, permission, block, facts };
}

const refusal = (status: 403 | 404 | 502, code: string, reason: string, cause?: unknown) =>
  cause === undefined ? { ok: false as const, status, code, reason } : { ok: false as const, status, code, reason, cause };

/**
 * `ctx.accountId` owns token `tokenId` on the NEP-171 contract `contract`: `nft_token({token_id})` at
 * the pinned block. 404 no-token, 502 wrong-token (an answer about another token), 403 not-owner,
 * 502 not-nep171 (a view error, or an answer that is not a token).
 */
export function nftOwner(contract: string, tokenId: string): Predicate<{ token: { token_id: string; owner_id: string } }> {
  return async ({ reader, accountId }) => {
    let token: unknown;
    try {
      token = await reader.view(contract, "nft_token", { token_id: tokenId });
    } catch (err) {
      if (err instanceof ViewError) return refusal(502, "not-nep171", `${contract} did not answer nft_token as an NFT contract: ${err.message}`, err);
      throw err;
    }
    if (token === null) return refusal(404, "no-token", `${contract} has no token ${tokenId} at block ${reader.block.height}`);
    const t = token as { token_id?: unknown; owner_id?: unknown };
    if (typeof t !== "object" || typeof t.token_id !== "string" || typeof t.owner_id !== "string") {
      return refusal(502, "not-nep171", `${contract}'s nft_token answer is not a NEP-171 token`);
    }
    if (t.token_id !== tokenId) return refusal(502, "wrong-token", `${contract} answered for token ${t.token_id}, not ${tokenId}`);
    if (t.owner_id !== accountId) {
      return refusal(403, "not-owner", `${t.owner_id} owns token ${tokenId} on ${contract} at block ${reader.block.height}, not ${accountId}`);
    }
    return { ok: true, facts: { token: { token_id: t.token_id, owner_id: t.owner_id } } };
  };
}

const U128 = /^(0|[1-9]\d{0,38})$/;

/**
 * `ctx.accountId` holds at least `min` of the NEP-141 token `contract`: `ft_balance_of({account_id})`
 * at the pinned block, compared as integers. 403 below-min; 502 not-nep141 (a view error, or a
 * balance that is not a u128 decimal string). Throws a TypeError at once for a `min` that is not a
 * non-negative integer.
 */
export function ftBalanceAtLeast(contract: string, min: bigint | string): Predicate<{ balance: string }> {
  if (typeof min === "string" ? !/^\d+$/.test(min) : typeof min !== "bigint" || min < 0n) {
    throw new TypeError(`ftBalanceAtLeast takes a non-negative integer minimum, not ${String(min)}`);
  }
  const minimum = BigInt(min);
  return async ({ reader, accountId }) => {
    let balance: unknown;
    try {
      balance = await reader.view(contract, "ft_balance_of", { account_id: accountId });
    } catch (err) {
      if (err instanceof ViewError) return refusal(502, "not-nep141", `${contract} did not answer ft_balance_of as a token contract: ${err.message}`, err);
      throw err;
    }
    if (typeof balance !== "string" || !U128.test(balance)) return refusal(502, "not-nep141", `${contract}'s ft_balance_of answer is not a u128 decimal string`);
    if (BigInt(balance) < minimum) {
      return refusal(403, "below-min", `${accountId} holds ${balance} of ${contract} at block ${reader.block.height}, less than ${minimum}`);
    }
    return { ok: true, facts: { balance } };
  };
}

/**
 * `ctx.accountId` is in role `role` of the Sputnik DAO v2 `dao`: `get_policy` at the pinned block. A
 * Group role passes when it lists the account, and an Everyone role always does. 403 not-in-role, 404
 * no-role, 403 member-role-unsupported (a token-weighted Member role, Planned), 502 not-sputnik (a
 * view error, or a policy of another shape).
 */
export function sputnikRole(dao: string, role: string): Predicate<{ role: string; kind: "Group" | "Everyone" }> {
  return async ({ reader, accountId }) => {
    let policy: unknown;
    try {
      policy = await reader.view(dao, "get_policy");
    } catch (err) {
      if (err instanceof ViewError) return refusal(502, "not-sputnik", `${dao} did not answer get_policy as a Sputnik DAO: ${err.message}`, err);
      throw err;
    }
    const roles = (policy as { roles?: unknown } | null)?.roles;
    if (!Array.isArray(roles)) return refusal(502, "not-sputnik", `${dao}'s get_policy answer has no roles`);
    const found = roles.find((r) => (r as { name?: unknown } | null)?.name === role) as { kind?: unknown } | undefined;
    if (!found) return refusal(404, "no-role", `${dao} has no role ${role} at block ${reader.block.height}`);
    const kind = found.kind;
    if (kind === "Everyone") return { ok: true, facts: { role, kind: "Everyone" as const } };
    if (typeof kind === "object" && kind !== null && "Member" in kind) {
      return refusal(403, "member-role-unsupported", `${role} on ${dao} is a token-weighted Member role, which this check does not count yet`);
    }
    const group = typeof kind === "object" && kind !== null ? (kind as { Group?: unknown }).Group : undefined;
    if (!Array.isArray(group)) return refusal(502, "not-sputnik", `${role} on ${dao} has a role kind this code does not know`);
    if (!group.includes(accountId)) return refusal(403, "not-in-role", `${accountId} is not in ${role} on ${dao} at block ${reader.block.height}`);
    return { ok: true, facts: { role, kind: "Group" as const } };
  };
}

/** Every predicate, in order: the first refusal is the answer; otherwise the facts, in order. */
export function all<P extends Predicate<unknown>[]>(...predicates: P): Predicate<unknown[]> {
  return async (ctx) => {
    const facts: unknown[] = [];
    for (const predicate of predicates) {
      const result = await predicate(ctx);
      if (!result.ok) return result;
      facts.push(result.facts);
    }
    return { ok: true, facts };
  };
}
