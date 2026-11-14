import { sha3_256 } from "@noble/hashes/sha3";
import { bytesToHex } from "@noble/hashes/utils";
import { base58Decode } from "./base58.js";
import { type At, type PinnedBlock, type PinnedReader, RpcError, type RpcCall, isAccountId, pinnedReader } from "./near-rpc.js";
import { type Nep413Payload, verifyNep413 } from "./nep413.js";

// NEP-641 (https://github.com/near/NEPs/blob/master/neps/nep-0641.md, Final): offchain authorizations
// for smart contracts. This is the leaf of its resolver, the access-key authorization: an
// OffchainMessage signed through NEP-413 by a full-access key of `signer_id`, checked at one pinned
// block. It follows the NEP's verification procedure and the reference implementation in near/intents
// (crates/signatures/nep641). Recursion through contract authorizations (`w_resolve_auth`) is Planned.
// Exported through satchel-nft/account-proof.

/** The signable envelope. `timestamp` is RFC 3339 in UTC with a Z; `path` is omitted when empty. */
export interface OffchainMessage {
  chain_id: string;
  signer_id: string;
  path?: string[];
  timestamp: string;
  payload: string;
}

/** The access-key authorization blob, as JSON. `access_key` and `signature` are `<curve>:<base58>`. */
export interface AccessKeyAuthorization {
  msg: OffchainMessage;
  via: { schema: "nep413"; extra?: { callback_url?: string } };
  access_key: string;
  signature: string;
}

/** The prefix of the canonical hash. */
export const NEP641_DOMAIN = "NEAR_NEP641_OFFCHAIN_MESSAGE/V1";

const U64_MAX = 2n ** 64n - 1n;
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;

/**
 * An RFC 3339 UTC time with a Z and 0-9 fractional digits, as nanoseconds since the epoch, and its
 * whole-second text; null for anything else, or a time a borsh u64 of nanoseconds cannot hold (before
 * 1970 or after 2554). Stricter than the reference implementation, which also takes other offsets.
 */
function parseTimestamp(text: unknown): { ns: bigint; seconds: string } | null {
  if (typeof text !== "string") return null;
  const m = TIMESTAMP.exec(text);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number);
  const ms = Date.UTC(y, mo - 1, d, h, mi, s);
  const seconds = Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 19) : "";
  // A date that rolls over (02-30, 24:00, second 60) does not round-trip.
  if (seconds !== text.slice(0, 19) || ms < 0) return null;
  const ns = BigInt(ms) * 1_000_000n + BigInt((m[7] ?? "").padEnd(9, "0"));
  if (ns > U64_MAX) return null;
  return { ns, seconds: `${seconds}Z` };
}

const u32 = (n: number) => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, n, true);
  return bytes;
};

const u64 = (n: bigint) => {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, n, true);
  return bytes;
};

const borshString = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  return concat(u32(bytes.length), bytes);
};

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function timestampOf(msg: OffchainMessage): { ns: bigint; seconds: string } {
  const parsed = parseTimestamp(msg.timestamp);
  if (!parsed) throw new Error(`the timestamp ${JSON.stringify(msg.timestamp)} is not an RFC 3339 UTC time with a Z, from 1970 to 2554`);
  return parsed;
}

/**
 * borsh(msg): chain_id, signer_id, path (u32 count, then each id), timestamp (u64 nanoseconds,
 * little-endian), payload; strings as a u32 byte length and UTF-8. Throws on a timestamp that is not
 * an RFC 3339 UTC time with a Z.
 */
export function encodeOffchainMessage(msg: OffchainMessage): Uint8Array {
  const path = msg.path ?? [];
  return concat(
    borshString(msg.chain_id),
    borshString(msg.signer_id),
    u32(path.length),
    ...path.map(borshString),
    u64(timestampOf(msg).ns),
    borshString(msg.payload),
  );
}

/** The canonical hash: sha3_256(NEP641_DOMAIN || borsh(msg)). */
export function nep641Hash(msg: OffchainMessage): Uint8Array {
  return sha3_256(concat(new TextEncoder().encode(NEP641_DOMAIN), encodeOffchainMessage(msg)));
}

/**
 * The NEP-413 payload a wallet signs for `msg`: the payload as the message, the canonical hash as the
 * nonce, and `"<chain_id>: <signer_id>[ -> <path[i]>]... @ <timestamp in whole seconds>"` as the
 * recipient, which the wallet shows.
 */
export function nep641ToNep413(msg: OffchainMessage, callbackUrl?: string): Nep413Payload {
  const ids = [msg.signer_id, ...(msg.path ?? [])].join(" -> ");
  return {
    message: msg.payload,
    nonce: nep641Hash(msg),
    recipient: `${msg.chain_id}: ${ids} @ ${timestampOf(msg).seconds}`,
    callbackUrl: callbackUrl ?? null,
  };
}

export type Nep641ParseCode = "malformed" | "too-long" | "unknown-field" | "wrong-schema" | "timestamp-format";

/** The size caps parseAccessKeyAuthorization applies before any decoding or hashing. */
export const NEP641_LIMITS = Object.freeze({
  /** The default for maxPayloadBytes: msg.payload in UTF-8, as verifyAccountProof's maxMessageBytes. */
  payloadBytes: 8192,
  /** Entries in msg.path. */
  pathEntries: 16,
  chainIdChars: 64,
  accessKeyChars: 128,
  signatureChars: 256,
  callbackUrlChars: 2048,
  /** Beyond six characters per payload byte (JSON escapes a code unit in six), for the other fields and whitespace. */
  blobSlackChars: 32_768,
});

const KEY_BYTES: Record<string, number> = { ed25519: 32, secp256k1: 64 };
const SIGNATURE_BYTES: Record<string, number> = { ed25519: 64, secp256k1: 65 };

/** The curve of a `<curve>:<base58>` value whose bytes have that curve's length, or null. */
function curveOf(value: unknown, lengths: Record<string, number>): string | null {
  if (typeof value !== "string") return null;
  const at = value.indexOf(":");
  const curve = value.slice(0, at);
  if (at < 0 || !Object.hasOwn(lengths, curve)) return null;
  try {
    return base58Decode(value.slice(at + 1)).length === lengths[curve] ? curve : null;
  } catch {
    return null;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Parses an access-key authorization, given as its JSON value or as the blob string. Unknown fields
 * are refused at every level (the reference refuses them on the authorization itself; this is
 * stricter inside `msg` and `via`). `via.schema` must be "nep413"; `path` may be omitted when empty;
 * the timestamp must be RFC 3339 in UTC with a Z (another offset is refused, stricter than upstream).
 * The value always carries `path`. Never throws. Sizes are capped before anything is decoded or
 * hashed (too-long, see NEP641_LIMITS): a blob string over 6 × maxPayloadBytes + 32768 characters is
 * not parsed, msg.payload may take at most `maxPayloadBytes` (default 8192) in UTF-8, msg.path at most
 * 16 entries, chain_id 64, access_key 128, signature 256 and callback_url 2048 characters.
 */
export function parseAccessKeyAuthorization(
  json: unknown,
  options: { maxPayloadBytes?: number } = {},
): { ok: true; value: AccessKeyAuthorization } | { ok: false; code: Nep641ParseCode; reason: string } {
  const fail = (code: Nep641ParseCode, reason: string) => ({ ok: false as const, code, reason });
  const maxPayloadBytes = options.maxPayloadBytes ?? NEP641_LIMITS.payloadBytes;
  const tooLong = (v: unknown, max: number) => typeof v === "string" && v.length > max;
  let value = json;
  if (typeof json === "string") {
    const maxBlob = 6 * maxPayloadBytes + NEP641_LIMITS.blobSlackChars;
    if (json.length > maxBlob) return fail("too-long", `the authorization is longer than ${maxBlob} characters`);
    try {
      value = JSON.parse(json);
    } catch {
      return fail("malformed", "the authorization is not JSON");
    }
  }
  if (!isObject(value)) return fail("malformed", "the authorization is not a JSON object");
  const unknown = (object: Record<string, unknown>, allowed: string[], where: string) => {
    const extra = Object.keys(object).filter((k) => !allowed.includes(k));
    return extra.length > 0 ? fail("unknown-field", `unknown field ${JSON.stringify(extra[0])} in ${where}`) : null;
  };
  const top = unknown(value, ["msg", "via", "access_key", "signature"], "the authorization");
  if (top) return top;

  const msg = value.msg;
  if (!isObject(msg)) return fail("malformed", "msg must be an object");
  const inMsg = unknown(msg, ["chain_id", "signer_id", "path", "timestamp", "payload"], "msg");
  if (inMsg) return inMsg;
  if (typeof msg.chain_id !== "string") return fail("malformed", "msg.chain_id must be a string");
  if (tooLong(msg.chain_id, NEP641_LIMITS.chainIdChars)) return fail("too-long", `msg.chain_id is longer than ${NEP641_LIMITS.chainIdChars} characters`);
  if (typeof msg.signer_id !== "string" || !isAccountId(msg.signer_id)) return fail("malformed", "msg.signer_id must be a NEAR account id");
  // Omitted means empty; null is not a list (serde's `default` fills in only a missing field).
  const path = msg.path === undefined ? [] : msg.path;
  if (Array.isArray(path) && path.length > NEP641_LIMITS.pathEntries) return fail("too-long", `msg.path has more than ${NEP641_LIMITS.pathEntries} entries`);
  if (!Array.isArray(path) || !path.every((id) => typeof id === "string" && isAccountId(id))) {
    return fail("malformed", "msg.path must be a list of NEAR account ids");
  }
  if (typeof msg.timestamp !== "string") return fail("malformed", "msg.timestamp must be a string");
  if (!parseTimestamp(msg.timestamp)) {
    return fail("timestamp-format", `msg.timestamp ${JSON.stringify(msg.timestamp)} is not an RFC 3339 UTC time with a Z (0-9 fractional digits), from 1970 to 2554`);
  }
  if (typeof msg.payload !== "string") return fail("malformed", "msg.payload must be a string");
  // UTF-8 never takes fewer bytes than UTF-16 code units, so a longer string is refused unencoded.
  if (msg.payload.length > maxPayloadBytes || new TextEncoder().encode(msg.payload).length > maxPayloadBytes) {
    return fail("too-long", `msg.payload is longer than ${maxPayloadBytes} bytes`);
  }

  const via = value.via;
  if (!isObject(via)) return fail("malformed", "via must be an object");
  const inVia = unknown(via, ["schema", "extra"], "via");
  if (inVia) return inVia;
  if (via.schema !== "nep413") return fail("wrong-schema", `via.schema is ${JSON.stringify(via.schema ?? null)}; only "nep413" is defined`);
  let extra: { callback_url?: string } | undefined;
  if (via.extra !== undefined) {
    if (!isObject(via.extra)) return fail("malformed", "via.extra must be an object");
    const inExtra = unknown(via.extra, ["callback_url"], "via.extra");
    if (inExtra) return inExtra;
    const cb = via.extra.callback_url;
    if (cb !== undefined && cb !== null && typeof cb !== "string") return fail("malformed", "via.extra.callback_url must be a string");
    if (tooLong(cb, NEP641_LIMITS.callbackUrlChars)) return fail("too-long", `via.extra.callback_url is longer than ${NEP641_LIMITS.callbackUrlChars} characters`);
    extra = typeof cb === "string" ? { callback_url: cb } : {};
  }

  if (tooLong(value.access_key, NEP641_LIMITS.accessKeyChars) || tooLong(value.signature, NEP641_LIMITS.signatureChars)) {
    return fail("too-long", `access_key or signature is longer than ${NEP641_LIMITS.accessKeyChars} or ${NEP641_LIMITS.signatureChars} characters`);
  }
  if (curveOf(value.access_key, KEY_BYTES) === null) return fail("malformed", "access_key must be ed25519:<base58 of 32 bytes> or secp256k1:<base58 of 64 bytes>");
  if (curveOf(value.signature, SIGNATURE_BYTES) === null) {
    return fail("malformed", "signature must be ed25519:<base58 of 64 bytes> or secp256k1:<base58 of 65 bytes>");
  }
  return {
    ok: true,
    value: {
      msg: { chain_id: msg.chain_id, signer_id: msg.signer_id, path: path as string[], timestamp: msg.timestamp, payload: msg.payload },
      via: extra === undefined ? { schema: "nep413" } : { schema: "nep413", extra },
      access_key: value.access_key as string,
      signature: value.signature as string,
    },
  };
}

export type Nep641Code =
  | Nep641ParseCode
  | "wrong-chain"
  | "wrong-signer"
  | "wrong-path"
  | "unsupported-key-type"
  | "bad-signature"
  | "rpc-block"
  | "timestamp-after-block"
  | "rpc-account"
  | "rpc-key"
  | "wrong-block"
  | "key-not-on-account"
  | "function-call-key"
  | "unknown-permission"
  | "no-account";

export type Nep641LeafResult =
  | { ok: true; payload: string; signerId: string; implicit: boolean; block: PinnedBlock }
  | { ok: false; step: 0 | 1 | 2 | 3 | 4 | 5 | 6; code: Nep641Code; reason: string; cause?: unknown };

/** An answer about another block than the pinned one. */
function aboutAnotherBlock(err: unknown): boolean {
  return err instanceof RpcError && err.kind === "bad-answer" && /^answered (without a block hash|at block )/.test(err.detail);
}

const said = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Resolves one NEP-641 access-key authorization (a leaf) at one block (default the final one), by the
 * NEP's verification procedure:
 *   0. parse (parseAccessKeyAuthorization), sizes capped before any decoding or hashing;
 *   1. `chain_id` is `expect.chainId`; 2. `signer_id` is `expect.signerId`; 3. `path` is `expect.path`
 *      (default []), element by element;
 *   4. the signature verifies, strict ed25519 over the NEP-413 mapping (nep641ToNep413), with
 *      `via.extra.callback_url`; secp256k1 is Planned;
 *   5. `timestamp` is not after the block's timestamp, so a fresh authorization is never resolved
 *      against older state;
 *   6. at the block: an existing account must hold `access_key` with full access (a gas key with full
 *      access counts, Experimental); an account that does not exist passes only when `signer_id` is the
 *      key's implicit account, the hex of its 32 bytes.
 * Steps 1-4 need no RPC. Every outcome is a value, RPC failures included (`cause` holds the error).
 * Note the difference from verifyAccountProof, which requires the key on chain: a NEP-641 leaf for an
 * implicit account that does not exist yet passes, by the NEP's rule.
 */
export async function verifyNep641Leaf(input: {
  rpc: RpcCall;
  authorization: unknown;
  expect: { chainId: "mainnet" | "testnet"; signerId: string; path?: string[] };
  at?: At;
  strictBlock?: boolean;
  /** msg.payload's cap in UTF-8 bytes (parseAccessKeyAuthorization); default 8192. */
  maxPayloadBytes?: number;
}): Promise<Nep641LeafResult> {
  type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6;
  const fail = (step: Step, code: Nep641Code, reason: string, cause?: unknown): Nep641LeafResult =>
    cause === undefined ? { ok: false, step, code, reason } : { ok: false, step, code, reason, cause };

  const parsed = parseAccessKeyAuthorization(input.authorization, { maxPayloadBytes: input.maxPayloadBytes });
  if (!parsed.ok) return fail(0, parsed.code, parsed.reason);
  const auth = parsed.value;
  const msg = auth.msg;
  const path = msg.path ?? [];
  const expected = input.expect;

  if (msg.chain_id !== expected.chainId) return fail(1, "wrong-chain", `the message is for chain ${JSON.stringify(msg.chain_id)}, not ${expected.chainId}`);
  if (msg.signer_id !== expected.signerId) return fail(2, "wrong-signer", `the message is signed for ${msg.signer_id}, not ${expected.signerId}`);
  const expectedPath = expected.path ?? [];
  if (path.length !== expectedPath.length || path.some((id, i) => id !== expectedPath[i])) {
    return fail(3, "wrong-path", `the message's path is ${JSON.stringify(path)}, not ${JSON.stringify(expectedPath)}`);
  }

  const keyCurve = auth.access_key.slice(0, auth.access_key.indexOf(":"));
  if (keyCurve !== "ed25519") return fail(4, "unsupported-key-type", `only ed25519 keys are checked here; ${keyCurve} NEP-413 signatures are Planned`);
  if (!auth.signature.startsWith("ed25519:")) return fail(4, "bad-signature", "the signature's curve is not the key's");
  const payload = nep641ToNep413(msg, auth.via.extra?.callback_url);
  if (!verifyNep413({ ...payload, publicKey: auth.access_key, signature: auth.signature })) {
    return fail(4, "bad-signature", `the signature does not verify for ${auth.access_key} over the NEP-413 mapping of this message`);
  }

  let reader: PinnedReader;
  try {
    reader = await pinnedReader(input.rpc, input.at ?? "final", { strictBlock: input.strictBlock ?? true });
  } catch (err) {
    return fail(5, "rpc-block", `couldn't read the block: ${said(err)}`, err);
  }
  const block = reader.block;
  const signedNs = timestampOf(msg).ns;
  if (signedNs > BigInt(block.timestampNs)) {
    return fail(5, "timestamp-after-block", `the message is timestamped ${msg.timestamp}, after block ${block.height} (${block.timestamp})`);
  }

  let account: Awaited<ReturnType<PinnedReader["account"]>>;
  try {
    account = await reader.account(msg.signer_id);
  } catch (err) {
    return aboutAnotherBlock(err)
      ? fail(6, "wrong-block", `the node answered about another block: ${said(err)}`, err)
      : fail(6, "rpc-account", `couldn't read ${msg.signer_id} at block ${block.height}: ${said(err)}`, err);
  }
  if (account === null) {
    const implicit = bytesToHex(base58Decode(auth.access_key.slice("ed25519:".length)));
    if (msg.signer_id !== implicit) {
      return fail(6, "no-account", `${msg.signer_id} does not exist at block ${block.height}, and it is not ${auth.access_key}'s implicit account ${implicit}`);
    }
    return { ok: true, payload: msg.payload, signerId: msg.signer_id, implicit: true, block };
  }
  let key: Awaited<ReturnType<PinnedReader["accessKey"]>>;
  try {
    key = await reader.accessKey(msg.signer_id, auth.access_key);
  } catch (err) {
    return aboutAnotherBlock(err)
      ? fail(6, "wrong-block", `the node answered about another block: ${said(err)}`, err)
      : fail(6, "rpc-key", `couldn't read ${msg.signer_id}'s key at block ${block.height}: ${said(err)}`, err);
  }
  if (key === null) return fail(6, "key-not-on-account", `${auth.access_key} is not a key of ${msg.signer_id} at block ${block.height}`);
  const kind = key.permission.kind;
  if (kind === "function-call" || kind === "gas-key-function-call") {
    return fail(6, "function-call-key", `${auth.access_key} is a function-call key of ${msg.signer_id}; NEP-641 takes only a full-access key`);
  }
  if (kind !== "full-access" && kind !== "gas-key-full-access") {
    return fail(6, "unknown-permission", `${auth.access_key} has a permission this code does not know: ${JSON.stringify(key.permission)}`);
  }
  return { ok: true, payload: msg.payload, signerId: msg.signer_id, implicit: false, block };
}
