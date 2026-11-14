import { ed25519 } from "@noble/curves/ed25519";
import { secp256k1 } from "@noble/curves/secp256k1";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import {
  type Chain,
  type Hex,
  HttpRequestError,
  type PublicClient,
  TimeoutError,
  type Transaction,
  type TransactionReceipt,
  type TransactionSerializable,
  createPublicClient,
  custom,
  getAddress,
  keccak256,
  numberToHex,
  parseTransaction,
  serializeTransaction,
} from "viem";
import { base58Decode } from "./base58.js";
import { type MpcDomain, deriveKey, deriveTweak, signDomainCurve } from "./mpc-kdf.js";
import {
  type At,
  type PinnedBlock,
  ReadOnlyError,
  type ReadTxOptions,
  type ReceiptView,
  type RpcCall,
  type TxStatusView,
  decodeBase64,
  functionCalls,
  pinnedReader,
  readTx,
  receiptsOf,
} from "./near-rpc.js";

// satchel-nft/chain-signatures: what a NEAR transaction asked NEAR's MPC network (Chain Signatures)
// to sign, what it got back, whether each answer is a valid signature by the key derived for the
// caller and path, and whether an EVM transaction is exactly the one an answer signed. It only reads.
//
//   import { ENDPOINTS, fastnearSenderLookup, httpRpc, readOnlyRpc } from "satchel-nft/near-rpc";
//   import { MPC_CONTRACTS, MPC_ROOT_KEYS, auditSignTx, proveEvmTx, readOnlyEvmClient } from "satchel-nft/chain-signatures";
//   const rpc = readOnlyRpc(httpRpc(ENDPOINTS.testnet.archival));
//   const audit = await auditSignTx(rpc, hash, { mpcContract: MPC_CONTRACTS.testnet, rootKeys: MPC_ROOT_KEYS.testnet,
//     senderLookup: fastnearSenderLookup(ENDPOINTS.testnet.txApi) });
//   const proof = await proveEvmTx({ audit, client: readOnlyEvmClient(sepolia, url), hash: evmHash, expectedChainId: 11155111 });
//
// Requests and answers are paired by receipts, never by log text: a `sign` receipt on the MPC
// contract, the hops its outcome names (each on the MPC contract), and the yield callback
// `return_signature_and_clean_state_on_success`, whose arguments must carry the request's tweak,
// payload and domain. Keys are derived here from root keys pinned below, never fetched to verify.

export { type MpcCurve, type MpcDomain, MPC_SIGN_DOMAINS, TWEAK_PREFIX, deriveKey, deriveTweak, signDomainCurve } from "./mpc-kdf.js";
/** The error readOnlyEvm throws for a method it refuses (the same class as satchel-nft/near-rpc's). */
export { ReadOnlyError } from "./near-rpc.js";

/** NEAR's Chain Signatures contracts. */
export const MPC_CONTRACTS = { mainnet: "v1.signer", testnet: "v1.signer-prod.testnet" } as const;

/**
 * Each MPC contract's `public_key({domain_id})` for its signing domains (MPC_SIGN_DOMAINS), pinned:
 * domains 0 and 4 are secp256k1, 1 and 5 ed25519, each with its own root key. They are the trust
 * anchor, so nothing here fetches them; `crossCheckDerivation` is how a change is noticed.
 */
export const MPC_ROOT_KEYS = {
  mainnet: {
    // Domains 0 and 1: read on v1.signer at block 224509629 (FF8VF3XabkuFuCfo43WFGYx8931cpmmoDMJNBDNe8KVA), 2026-11-14.
    0: "secp256k1:3tFRbMqmoa6AAALMrEFAYCEoHcqKxeW38YptwowBVBtXK1vo36HDbUWuR6EZmoK4JcH6HDkNMGGqP1ouV7VZUWya",
    1: "ed25519:G9hwngxWNKdmqMCmU1Yt6LPhFpayJeKFxyAV1HqMNLtF",
    // Domains 4 and 5: read on v1.signer at block 224521129 (2msKYdwCer3GzLEG6kHti3GCznqgHgUdC8XLYGHqdiBh), 2026-11-14.
    4: "secp256k1:47q96QqEhpbY6R7t3s29w2DKWCV6uKGSPUmaCnppRkrJhD9gjZoHM3qSETbJFhdjiRGHbCpunnGAKDSM78EwGirc",
    5: "ed25519:8C65zxCVFG2fXN58cDB71gpUeUPQiihzNjEuBsvDLAh1",
  },
  testnet: {
    // Domains 0 and 1: read on v1.signer-prod.testnet at block 277652699 (H2zz4BGLMi3PkUDZ3CAjvx7HhwmQ3ZExWnFJFkZzv4GZ), 2026-11-14.
    0: "secp256k1:4NfTiv3UsGahebgTaHyD9vF8KYKMBnfd6kh94mK6xv8fGBiJB8TBtFMP5WWXz6B89Ac1fbpzPwAvoyQebemHFwx3",
    1: "ed25519:6vSEtQxrQj6txUMh33WC4ERyCWmNMRTdufDWAaDY3Un2",
    // Domains 4 and 5: read on v1.signer-prod.testnet at block 277663870 (7nEdjbkonBnhTPJzb6oLsiDo5jyemcRd5MVmbTtk2nbe), 2026-11-14.
    4: "secp256k1:3XcQcfDKvbyNdkKHpN11vtsjX4dX1ABf4HFyqcxiTUbEgnjRzKtR9Cv43fggtseGVCiSxRSgMG5GGFpXhDHyVtuQ",
    5: "ed25519:HapeyU4SFvrQKMa8zijPF8KC9g5J1tcuxx2FXAfEcQDQ",
  },
} as const;

const N = secp256k1.CURVE.n;

/** The 64 bytes (x then y) of a NEAR `secp256k1:<base58>` key, with evm.ts's error texts. */
function secp256k1KeyBytes(key: string): Uint8Array {
  if (!key.startsWith("secp256k1:")) throw new Error(`not a secp256k1 key: ${key}`);
  const bytes = base58Decode(key.slice("secp256k1:".length));
  if (bytes.length !== 64) throw new Error(`expected a 64-byte key, got ${bytes.length}`);
  return bytes;
}

/** The EVM address of a NEAR `secp256k1:` key: the last 20 bytes of keccak256 over its 64 bytes, checksummed. */
export function evmAddress(secp256k1Key: string): `0x${string}` {
  return getAddress(`0x${keccak256(secp256k1KeyBytes(secp256k1Key)).slice(-40)}`);
}

// ---- Requests and answers ----------------------------------------------------------------------

/** An MPC answer as the contract returns it: ECDSA for a secp256k1 domain (`scheme` may be absent), EdDSA for an ed25519 one. */
export type MpcResponse =
  | { scheme?: "Secp256k1"; big_r: { affine_point: string }; s: { scalar: string }; recovery_id: number }
  | { scheme: "Ed25519"; signature: number[] };

export interface MpcSignRequest {
  /** The receipt in which the MPC contract ran `sign`. */
  receiptId: string;
  blockHash: string | null;
  /** The transaction's signer. */
  signerId: string;
  /** Who called `sign`: the key's owner. */
  predecessor: string;
  path: string;
  /**
   * The domain id the request names (`domain_id`, or the legacy `key_version`, which near/mpc reads as
   * the same id). Any non-negative integer is kept: a domain that is not in MPC_SIGN_DOMAINS is
   * followed like any other, and never verified. Null only when the request names no readable domain
   * (status "inconsistent").
   */
  domain: MpcDomain | null;
  /** Lower-case hex of the payload bytes. */
  payload: { kind: "ecdsa" | "eddsa"; hex: string };
  form: "payload_v2" | "legacy";
  /** yoctoNEAR attached to `sign`. */
  deposit: string;
}

export interface MpcSignOutcome {
  request: MpcSignRequest;
  status: "signed" | "failed" | "timed-out" | "pending" | "inconsistent";
  response: MpcResponse | null;
  /** The receipt ids followed, the sign receipt first. */
  hops: string[];
  callback: { receiptId: string; blockHash: string | null; tweak: number[]; payload: unknown; domainId: number } | null;
  /** The failure text, or what was inconsistent. */
  detail: string | null;
}

const SIGN = "sign";
const CALLBACK = "return_signature_and_clean_state_on_success";
const FAIL_ON_TIMEOUT = "fail_on_timeout";

type Status = { kind: "value"; value: string } | { kind: "receipt"; id: string } | { kind: "failure"; failure: unknown } | { kind: "unknown" };

/** An outcome status, as one of its kinds. A string status ("Unknown") or a missing one is unknown. */
function statusOf(status: unknown): Status {
  if (typeof status !== "object" || status === null) return { kind: "unknown" };
  const s = status as { SuccessValue?: unknown; SuccessReceiptId?: unknown; Failure?: unknown };
  if (typeof s.SuccessValue === "string") return { kind: "value", value: s.SuccessValue };
  if (typeof s.SuccessReceiptId === "string") return { kind: "receipt", id: s.SuccessReceiptId };
  if (s.Failure !== undefined) return { kind: "failure", failure: s.Failure };
  return { kind: "unknown" };
}

/** A receipt failure's text: the contract's execution error when there is one, else the failure as JSON. */
function failureText(failure: unknown): string {
  const execution = (failure as { ActionError?: { kind?: { FunctionCallError?: { ExecutionError?: unknown } } } } | null)?.ActionError?.kind
    ?.FunctionCallError?.ExecutionError;
  return typeof execution === "string" ? execution : JSON.stringify(failure);
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isByte = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 255;
const HEX_BYTES = /^(?:[0-9a-fA-F]{2})*$/;

/** A secp256k1 answer, with or without `scheme`, as dao.ts's isMpcSignature reads one. */
function isSecp256k1Response(v: unknown): v is Extract<MpcResponse, { big_r: unknown }> {
  if (!isRecord(v)) return false;
  return (
    (v.scheme === undefined || v.scheme === "Secp256k1") &&
    isRecord(v.big_r) &&
    typeof v.big_r.affine_point === "string" &&
    isRecord(v.s) &&
    typeof v.s.scalar === "string" &&
    typeof v.recovery_id === "number"
  );
}

function isEd25519Response(v: unknown): v is Extract<MpcResponse, { scheme: "Ed25519" }> {
  return isRecord(v) && v.scheme === "Ed25519" && Array.isArray(v.signature);
}

function jsonOf(base64: string): unknown {
  try {
    return JSON.parse(decodeBase64(base64));
  } catch {
    return undefined;
  }
}

/** `{Ecdsa: hex}` (32 bytes) or `{Eddsa: hex}`, as payload_v2 and the callback carry a payload. */
function payloadVariant(value: unknown): { kind: "ecdsa" | "eddsa"; hex: string } | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 1 || (keys[0] !== "Ecdsa" && keys[0] !== "Eddsa")) return null;
  const hex = value[keys[0]];
  if (typeof hex !== "string" || !HEX_BYTES.test(hex)) return null;
  if (keys[0] === "Ecdsa" && hex.length !== 64) return null;
  return { kind: keys[0] === "Ecdsa" ? "ecdsa" : "eddsa", hex: hex.toLowerCase() };
}

interface ParsedRequest {
  path: string;
  payload: MpcSignRequest["payload"];
  form: MpcSignRequest["form"];
  domain: MpcDomain | null;
  problem: string | null;
}

/** A domain id as the contract reads one: a non-negative integer (a u64 there; a safe integer here). */
const isDomainId = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;

/**
 * `sign`'s `{request: …}`, read as near/mpc's SignRequestArgs reads it: the payload from `payload_v2`
 * or the legacy `payload` (32 numbers, ECDSA), and the domain from `domain_id` or the legacy
 * `key_version`, each on its own. near/mpc reads key_version n as DomainId(n)
 * (crates/near-mpc-crypto-types/src/sign.rs at 686fbb2de1a6b426303c23617ab84773f15bfb19), and so does
 * this. The contract's `sign` takes any domain whose purpose is Sign (crates/contract/src/api/sign.rs,
 * same commit), so any domain id is followed; only a signing domain in MPC_SIGN_DOMAINS is checked
 * against the payload's kind, since for another one the contract itself refuses a mismatch, which
 * shows as "failed".
 */
function parseRequest(argsBase64: string): ParsedRequest {
  const out: ParsedRequest = { path: "", payload: { kind: "ecdsa", hex: "" }, form: "legacy", domain: null, problem: null };
  const problem = (text: string) => {
    out.problem ??= text;
  };
  const args = jsonOf(argsBase64);
  const request = isRecord(args) ? args.request : undefined;
  if (!isRecord(request)) {
    problem("sign's arguments hold no request");
    return out;
  }
  if (typeof request.path === "string") out.path = request.path;
  else problem("the request has no path");

  const { payload_v2: v2, payload: legacy } = request;
  if (v2 !== undefined && legacy !== undefined) problem("payload_v2 and payload are mutually exclusive");
  if (v2 !== undefined) {
    out.form = "payload_v2";
    const payload = payloadVariant(v2);
    if (payload) out.payload = payload;
    else problem("payload_v2 is not {Ecdsa: 32 bytes of hex} or {Eddsa: hex}");
  } else if (legacy !== undefined) {
    if (Array.isArray(legacy) && legacy.length === 32 && legacy.every(isByte)) out.payload = { kind: "ecdsa", hex: bytesToHex(Uint8Array.from(legacy)) };
    else problem("the legacy payload is not 32 bytes");
  } else problem("the request has no payload_v2 or payload");

  const { domain_id: id, key_version: keyVersion } = request;
  if (id !== undefined && keyVersion !== undefined) problem("domain_id and key_version are mutually exclusive");
  if (id !== undefined) {
    if (isDomainId(id)) out.domain = id;
    else problem(`domain_id ${JSON.stringify(id)} is not a domain id`);
  } else if (keyVersion !== undefined) {
    if (isDomainId(keyVersion)) out.domain = keyVersion;
    else problem(`legacy key_version ${JSON.stringify(keyVersion)} is not a key version`);
  } else problem("the request has no domain_id or key_version");

  const curve = out.domain === null ? null : signDomainCurve(out.domain);
  if (curve !== null && (curve === "secp256k1") !== (out.payload.kind === "ecdsa")) {
    problem(`an ${out.payload.kind} payload does not fit domain ${out.domain} (${curve})`);
  }
  return out;
}

/** The callback's one-element argument array, `[{tweak: number[32], payload, domain_id}]`, or null. */
function parseCallbackArgs(argsBase64: string): { tweak: number[]; payload: unknown; domain_id: number } | null {
  const args = jsonOf(argsBase64);
  if (!Array.isArray(args) || args.length !== 1 || !isRecord(args[0])) return null;
  const { tweak, payload, domain_id } = args[0];
  if (!Array.isArray(tweak) || !tweak.every(isByte) || typeof domain_id !== "number") return null;
  return { tweak: tweak as number[], payload, domain_id };
}

/**
 * Every `sign` request `tx` made on `mpcContract`, in receipt order, each with what became of it: the
 * sign receipt's outcome followed hop by hop (each hop on the MPC contract, at most `maxHops`,
 * default 8) to the yield callback, whose arguments must carry the request's tweak, payload and
 * domain. The callback's value is the answer ("signed"); a callback that hands on to
 * `fail_on_timeout`, which fails, is "timed-out". Receipts are read, never logs.
 */
export function mpcRequests(tx: TxStatusView, mpcContract: string, options: { maxHops?: number } = {}): MpcSignOutcome[] {
  const maxHops = options.maxHops ?? 8;
  const receipts = receiptsOf(tx);
  const byId = new Map(receipts.map((r) => [r.receiptId, r]));
  const out: MpcSignOutcome[] = [];
  for (const receipt of receipts) {
    if (receipt.receiverId !== mpcContract) continue;
    const signs = functionCalls(receipt).filter((c) => c.method === SIGN);
    for (const call of signs) {
      const parsed = parseRequest(call.argsBase64);
      const request: MpcSignRequest = {
        receiptId: receipt.receiptId,
        blockHash: receipt.blockHash,
        signerId: tx.transaction.signer_id,
        predecessor: receipt.predecessorId ?? "",
        path: parsed.path,
        domain: parsed.domain,
        payload: parsed.payload,
        form: parsed.form,
        deposit: call.deposit,
      };
      const several = signs.length > 1 ? `the receipt holds ${signs.length} sign calls, and its outcome answers only one` : null;
      out.push(follow(request, receipt, parsed.problem ?? several, byId, mpcContract, maxHops));
    }
  }
  return out;
}

function follow(
  request: MpcSignRequest,
  sign: ReceiptView,
  problem: string | null,
  byId: Map<string, ReceiptView>,
  mpcContract: string,
  maxHops: number,
): MpcSignOutcome {
  const hops = [sign.receiptId];
  const done = (status: MpcSignOutcome["status"], extra: Partial<Pick<MpcSignOutcome, "response" | "callback" | "detail">> = {}): MpcSignOutcome => ({
    request,
    status,
    response: null,
    hops,
    callback: null,
    detail: null,
    ...extra,
  });

  const first = statusOf(sign.status);
  if (first.kind === "failure") return done("failed", { detail: failureText(first.failure) });
  if (problem !== null) return done("inconsistent", { detail: problem });
  if (first.kind === "value") return done("inconsistent", { detail: "the sign receipt returned a value, with no callback" });
  if (first.kind === "unknown") return done("pending");

  let next = first.id;
  for (let hop = 0; ; hop++) {
    if (hop >= maxHops) return done("inconsistent", { detail: `no callback within ${maxHops} hops` });
    const receipt = byId.get(next);
    if (!receipt) return done("pending");
    hops.push(receipt.receiptId);
    if (receipt.executorId !== mpcContract) return done("inconsistent", { detail: "a hop left the MPC contract" });
    const call = functionCalls(receipt).find((c) => c.method === CALLBACK);
    if (call) return callbackOutcome(receipt, call.argsBase64);
    const status = statusOf(receipt.status);
    if (status.kind === "receipt") {
      next = status.id;
      continue;
    }
    if (status.kind === "failure") return done("failed", { detail: failureText(status.failure) });
    if (status.kind === "value") return done("inconsistent", { detail: "a hop returned a value, with no callback" });
    return done("pending");
  }

  function callbackOutcome(receipt: ReceiptView, argsBase64: string): MpcSignOutcome {
    const args = parseCallbackArgs(argsBase64);
    if (!args) return done("inconsistent", { detail: "the callback's arguments are not [{tweak, payload, domain_id}]" });
    const callback = { receiptId: receipt.receiptId, blockHash: receipt.blockHash, tweak: args.tweak, payload: args.payload, domainId: args.domain_id };
    const inconsistent = (detail: string) => done("inconsistent", { callback, detail });
    if (receipt.predecessorId !== null && receipt.predecessorId !== mpcContract) return inconsistent("the callback was not scheduled by the MPC contract");
    const tweak = deriveTweak(request.predecessor, request.path);
    if (args.tweak.length !== tweak.length || args.tweak.some((b, i) => b !== tweak[i])) return inconsistent("the callback's tweak is not the request's");
    const payload = payloadVariant(args.payload);
    if (!payload || payload.kind !== request.payload.kind || payload.hex !== request.payload.hex) return inconsistent("the callback's payload is not the request's");
    if (args.domain_id !== request.domain) return inconsistent("the callback's domain_id is not the request's");

    const status = statusOf(receipt.status);
    if (status.kind === "value") {
      // The payload's kind says which signature answers it: ECDSA (secp256k1) or EdDSA (ed25519).
      const value = jsonOf(status.value);
      const ecdsa = request.payload.kind === "ecdsa";
      const response = ecdsa ? (isSecp256k1Response(value) ? value : null) : isEd25519Response(value) ? value : null;
      if (!response) return inconsistent(`the callback's answer is not ${ecdsa ? "a secp256k1" : "an ed25519"} signature`);
      return done("signed", { callback, response });
    }
    if (status.kind === "receipt") {
      const timeout = byId.get(status.id);
      if (!timeout) return done("pending", { callback });
      hops.push(timeout.receiptId);
      if (timeout.executorId !== mpcContract || !functionCalls(timeout).some((c) => c.method === FAIL_ON_TIMEOUT)) {
        return inconsistent("the callback handed on to a receipt that is not the MPC contract's fail_on_timeout");
      }
      const end = statusOf(timeout.status);
      if (end.kind === "failure") return done("timed-out", { callback, detail: failureText(end.failure) });
      if (end.kind === "unknown") return done("pending", { callback });
      return inconsistent("fail_on_timeout did not fail");
    }
    if (status.kind === "failure") return done("failed", { callback, detail: failureText(status.failure) });
    return done("pending", { callback });
  }
}

/**
 * Every secp256k1 answer among the receipts `mpcContract` ran, in order (dao.ts's
 * signatureFromReceipts loop, without its dedupe): any receipt the MPC contract executed whose
 * SuccessValue is JSON shaped like an answer, `scheme` absent or "Secp256k1".
 */
export function scanMpcResponses(tx: TxStatusView, mpcContract: string): MpcResponse[] {
  const found: MpcResponse[] = [];
  for (const { outcome } of tx.receipts_outcome) {
    if (outcome.executor_id !== mpcContract) continue;
    const status = statusOf(outcome.status);
    if (status.kind !== "value" || status.value === "") continue;
    const value = jsonOf(status.value);
    if (isSecp256k1Response(value)) found.push(value);
  }
  return found;
}

// ---- Signatures --------------------------------------------------------------------------------

export type VerifyReason =
  | "ok"
  | "scheme-mismatch"
  | "malformed-response"
  | "malformed-key"
  | "identity-key"
  | "small-order-key"
  | "malformed-big-r"
  | "r-out-of-range"
  | "s-out-of-range"
  | "bad-recovery-id"
  | "payload-not-32-bytes"
  | "payload-not-scalar"
  | "malformed-signature"
  | "invalid-signature"
  | "recovery-mismatch";

export interface VerifyResult {
  ok: boolean;
  reason: VerifyReason;
  /** secp256k1 only: the signature as an EVM transaction carries it, s normalized to the low half. */
  evm?: { r: `0x${string}`; s: `0x${string}`; yParity: 0 | 1; highS: boolean };
}

const hex32 = (n: bigint): `0x${string}` => `0x${n.toString(16).padStart(64, "0")}`;

function decodeKey(text: string): Uint8Array | null {
  try {
    return base58Decode(text);
  } catch {
    return null;
  }
}

/**
 * Whether `response` is a valid signature of `payload` by `key`. It never throws: every outcome is a
 * reason. secp256k1 is checked strictly: no identity key; big_r a compressed point with
 * 1 ≤ x(R) < n (refused, not reduced, at or above n); s in [1, n-1]; recovery_id 0 or 1; a 32-byte
 * payload below n, as the MPC contract requires; s normalized to low-s (parity flipped), the
 * signature verified unhashed, and the key recovered from (r, s, parity) equal to `key`. ed25519 is
 * strict RFC 8032 (no ZIP-215 leniency), with small-order and identity keys refused.
 */
export function verifySignature(input: { key: string; payload: Uint8Array; response: MpcResponse }): VerifyResult {
  try {
    return verify(input);
  } catch {
    return { ok: false, reason: "malformed-response" };
  }
}

function verify({ key, payload, response }: { key: unknown; payload: unknown; response: unknown }): VerifyResult {
  const fail = (reason: VerifyReason): VerifyResult => ({ ok: false, reason });
  if (typeof key !== "string") return fail("malformed-key");
  const curve = key.startsWith("secp256k1:") ? "secp256k1" : key.startsWith("ed25519:") ? "ed25519" : null;
  if (curve === null) return fail("malformed-key");
  const edScheme = isRecord(response) && response.scheme === "Ed25519";

  if (curve === "secp256k1") {
    if (!isSecp256k1Response(response)) return fail(edScheme ? "scheme-mismatch" : "malformed-response");
    const keyBytes = decodeKey(key.slice("secp256k1:".length));
    if (!keyBytes || keyBytes.length !== 64) return fail("malformed-key");
    // A 64-byte NEAR key cannot encode the point at infinity; all zeros is how one would try (near/mpc#4608).
    if (keyBytes.every((b) => b === 0)) return fail("identity-key");
    let point: ReturnType<typeof secp256k1.ProjectivePoint.fromHex>;
    try {
      point = secp256k1.ProjectivePoint.fromHex(`04${bytesToHex(keyBytes)}`);
      point.assertValidity();
    } catch {
      return fail("malformed-key");
    }
    if (point.equals(secp256k1.ProjectivePoint.ZERO)) return fail("identity-key");

    const bigR = response.big_r.affine_point;
    if (!/^0[23][0-9a-fA-F]{64}$/.test(bigR)) return fail("malformed-big-r");
    const r = BigInt(`0x${bigR.slice(2)}`);
    if (r === 0n || r >= N) return fail("r-out-of-range");
    try {
      secp256k1.ProjectivePoint.fromHex(bigR).assertValidity();
    } catch {
      return fail("malformed-big-r");
    }
    const sHex = response.s.scalar;
    if (!/^[0-9a-fA-F]{1,64}$/.test(sHex)) return fail("malformed-response");
    const s = BigInt(`0x${sHex}`);
    if (s === 0n || s >= N) return fail("s-out-of-range");
    if (response.recovery_id !== 0 && response.recovery_id !== 1) return fail("bad-recovery-id");
    if (!(payload instanceof Uint8Array) || payload.length !== 32) return fail("payload-not-32-bytes");
    if (BigInt(`0x${bytesToHex(payload)}`) >= N) return fail("payload-not-scalar");

    const low = normalizeEcdsa(sHex, response.recovery_id);
    const signature = new secp256k1.Signature(r, low.s);
    if (!secp256k1.verify(signature, payload, point.toRawBytes(false), { prehash: false, lowS: true })) return fail("invalid-signature");
    const recovered = signature.addRecoveryBit(low.yParity).recoverPublicKey(payload);
    if (!recovered.equals(point)) return fail("recovery-mismatch");
    return { ok: true, reason: "ok", evm: { r: hex32(r), s: hex32(low.s), yParity: low.yParity, highS: low.highS } };
  }

  if (!edScheme) return fail(isSecp256k1Response(response) ? "scheme-mismatch" : "malformed-response");
  const signature = (response as { signature?: unknown }).signature;
  if (!Array.isArray(signature)) return fail("malformed-response");
  if (signature.length !== 64 || !signature.every(isByte)) return fail("malformed-signature");
  const keyBytes = decodeKey(key.slice("ed25519:".length));
  if (!keyBytes || keyBytes.length !== 32) return fail("malformed-key");
  let point: ReturnType<typeof ed25519.ExtendedPoint.fromHex>;
  try {
    point = ed25519.ExtendedPoint.fromHex(keyBytes);
  } catch {
    return fail("malformed-key");
  }
  if (point.equals(ed25519.ExtendedPoint.ZERO)) return fail("identity-key");
  if (point.isSmallOrder()) return fail("small-order-key");
  if (!(payload instanceof Uint8Array)) return fail("invalid-signature");
  const ok = ed25519.verify(Uint8Array.from(signature as number[]), payload, keyBytes, { zip215: false });
  return ok ? { ok: true, reason: "ok" } : fail("invalid-signature");
}

/**
 * s, normalized to the low half as EVM nodes require (EIP-2), and the parity that goes with it:
 * flipped when s was above n/2. Throws on a recovery_id that is not 0 or 1, as toEvmSignature does.
 */
export function normalizeEcdsa(sHex: string, recoveryId: number): { s: bigint; yParity: 0 | 1; highS: boolean } {
  if (recoveryId !== 0 && recoveryId !== 1) throw new Error("MPC signature: recovery_id must be 0 or 1");
  if (!/^[0-9a-fA-F]{1,64}$/.test(sHex)) throw new Error("MPC signature: s is not a hex scalar");
  const s = BigInt(`0x${sHex}`);
  const highS = s > N / 2n;
  return highS ? { s: N - s, yParity: (recoveryId ^ 1) as 0 | 1, highS } : { s, yParity: recoveryId, highS };
}

// ---- The derivation, against the contract -------------------------------------------------------

/**
 * At one pinned block, the MPC contract's `public_key({domain_id})` for each domain the cases use,
 * and its `derived_public_key({path, predecessor, domain_id})` for each case, beside the key derived
 * here from that block's root key. So a `match: false` means the contract and this code derive
 * differently, whether or not MPC_ROOT_KEYS is still current.
 */
export async function crossCheckDerivation(
  rpc: RpcCall,
  mpcContract: string,
  cases: { predecessor: string; path: string; domain: MpcDomain }[],
  at: At = "final",
): Promise<{
  block: PinnedBlock;
  rootKeys: Partial<Record<MpcDomain, string>>;
  results: { predecessor: string; path: string; domain: MpcDomain; local: string; contract: string; match: boolean }[];
}> {
  const reader = await pinnedReader(rpc, at);
  const rootKeys: Partial<Record<MpcDomain, string>> = {};
  for (const domain of [...new Set(cases.map((c) => c.domain))].sort((a, b) => a - b)) {
    rootKeys[domain] = await reader.view<string>(mpcContract, "public_key", { domain_id: domain });
  }
  const results = [];
  for (const { predecessor, path, domain } of cases) {
    const contract = await reader.view<string>(mpcContract, "derived_public_key", { path, predecessor, domain_id: domain });
    const local = deriveKey(rootKeys[domain] as string, predecessor, path, domain);
    results.push({ predecessor, path, domain, local, contract, match: local === contract });
  }
  return { block: reader.block, rootKeys, results };
}

// ---- Auditing a transaction ---------------------------------------------------------------------

export type SignTxVerdict = "no-requests" | "all-verified" | "has-inconsistent" | "has-failed" | "has-pending" | "some-unverified";

export interface SignTxAudit {
  tx: string;
  signerId: string;
  /** The transaction's inclusion block hash. */
  block: string;
  requests: (MpcSignOutcome & { derivedKey: string | null; verify: VerifyResult | null; evmAddress: `0x${string}` | null })[];
  /** MPC answers in the transaction that no sign request reaches. */
  orphanResponses: number;
  verdict: SignTxVerdict;
}

/**
 * Reads transaction `hash` (readTx, FINAL by default) and reports each MPC request in it: its
 * outcome, the key derived for it from `rootKeys`, whether the answer verifies under that key, and
 * for a secp256k1 domain the key's EVM address. Only signing domains (MPC_SIGN_DOMAINS) whose root
 * key is passed are verified; none is fetched, and a request on another domain gets `verify: null`.
 * The verdict is the first that applies: no-requests, has-inconsistent, has-failed (failed or timed
 * out), has-pending, some-unverified, all-verified.
 */
export async function auditSignTx(
  rpc: RpcCall,
  hash: string,
  options: ReadTxOptions & { mpcContract: string; rootKeys: Partial<Record<MpcDomain, string>>; maxHops?: number },
): Promise<SignTxAudit> {
  const { mpcContract, rootKeys, maxHops, ...readOptions } = options;
  const tx = await readTx(rpc, hash, readOptions);
  const outcomes = mpcRequests(tx, mpcContract, { maxHops });
  const requests = outcomes.map((o) => {
    const domain = o.request.domain;
    const known = domain !== null && signDomainCurve(domain) !== null;
    const root = known ? rootKeys[domain as number] : undefined;
    const derivedKey = root === undefined ? null : deriveKey(root, o.request.predecessor, o.request.path, domain as number);
    const verify =
      o.status === "signed" && o.response !== null && derivedKey !== null
        ? verifySignature({ key: derivedKey, payload: hexToBytes(o.request.payload.hex), response: o.response })
        : null;
    return { ...o, derivedKey, verify, evmAddress: derivedKey?.startsWith("secp256k1:") ? evmAddress(derivedKey) : null };
  });

  const reached = new Set(outcomes.flatMap((o) => o.hops));
  let orphanResponses = 0;
  for (const receipt of receiptsOf(tx)) {
    if (receipt.executorId !== mpcContract || reached.has(receipt.receiptId)) continue;
    const status = statusOf(receipt.status);
    if (status.kind !== "value" || status.value === "") continue;
    const value = jsonOf(status.value);
    if (isSecp256k1Response(value) || isEd25519Response(value)) orphanResponses++;
  }

  const has = (...statuses: MpcSignOutcome["status"][]) => requests.some((r) => statuses.includes(r.status));
  const verdict: SignTxVerdict =
    requests.length === 0
      ? "no-requests"
      : has("inconsistent")
        ? "has-inconsistent"
        : has("failed", "timed-out")
          ? "has-failed"
          : has("pending")
            ? "has-pending"
            : requests.some((r) => !r.verify?.ok)
              ? "some-unverified"
              : "all-verified";
  return { tx: tx.transaction.hash, signerId: tx.transaction.signer_id, block: tx.transaction_outcome.block_hash, requests, orphanResponses, verdict };
}

// ---- EVM: a read-only client, and the proof ------------------------------------------------------

/** The EVM JSON-RPC methods readOnlyEvm lets through. */
export const EVM_READ_METHODS = ["eth_chainId", "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getBlockByNumber"] as const;

type Eip1193Request = (args: { method: string; params?: unknown }) => Promise<unknown>;

/**
 * A plain JSON-RPC POST to an EVM node, as an EIP-1193 `request` function. Errors name only the
 * node's origin, since EVM node URLs often carry a key in their path: a URL that does not parse, or
 * one with credentials (user:pass@), is refused here with a TypeError that does not repeat it, and a
 * network failure is reported by the error's name and code alone, without its message or cause
 * (fetch's own errors can quote the URL). An HTTP failure throws viem's HttpRequestError (which
 * viem's clients retry for 408, 429 and 5xx), a JSON-RPC error throws with its `code`, and no answer
 * within `timeoutMs` (default 15_000) throws viem's TimeoutError.
 */
export function evmJsonRpc(url: string, options: { timeoutMs?: number; fetch?: typeof fetch } = {}): Eip1193Request {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new TypeError("evmJsonRpc takes an absolute http(s) URL; the one given is not shown");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new TypeError("evmJsonRpc takes a URL without credentials (user:pass@); the one given is not shown");
  }
  const origin = parsed.origin;
  let id = 0;
  return async ({ method, params }) => {
    const doFetch = options.fetch ?? globalThis.fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
    let status: number;
    let headers: Headers;
    let text: string;
    try {
      const res = await doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params: params ?? [] }),
        signal: controller.signal,
      });
      status = res.status;
      headers = res.headers;
      text = await res.text();
    } catch (err) {
      if (controller.signal.aborted) throw new TimeoutError({ body: { method }, url: origin });
      // Only the error's name and a short code: fetch's message and cause can quote the full URL.
      throw new HttpRequestError({ url: origin, details: `network error (${networkErrorLabel(err)})` });
    } finally {
      clearTimeout(timer);
    }
    if (status < 200 || status >= 300) throw new HttpRequestError({ url: origin, status, headers, details: `HTTP ${status}` });
    let answer: { result?: unknown; error?: { code?: unknown; message?: unknown; data?: unknown } };
    try {
      answer = JSON.parse(text);
    } catch {
      throw new HttpRequestError({ url: origin, status, details: "the answer is not JSON" });
    }
    if (isRecord(answer) && answer.error !== undefined && answer.error !== null) {
      const message = typeof answer.error.message === "string" ? answer.error.message : JSON.stringify(answer.error);
      throw Object.assign(new Error(`EVM RPC ${method} failed at ${origin}: ${message}`), { code: answer.error.code, data: answer.error.data });
    }
    if (!isRecord(answer) || !("result" in answer)) throw new HttpRequestError({ url: origin, status, details: "the answer has no result" });
    return answer.result;
  };
}

/** `name` and, when it is a short token, `code` of a network error (or of its cause), never its message. */
function networkErrorLabel(err: unknown): string {
  const token = (v: unknown) => (typeof v === "string" && /^[A-Za-z0-9_]{1,40}$/.test(v) ? v : null);
  const name = err instanceof Error ? (token(err.name) ?? "Error") : "Error";
  const cause = err instanceof Error ? (err as { cause?: unknown }).cause : undefined;
  const code = token((err as { code?: unknown } | null)?.code) ?? token((cause as { code?: unknown } | null | undefined)?.code);
  return code ? `${name} ${code}` : name;
}

/**
 * `request`, letting through only EVM_READ_METHODS: anything else, such as eth_sendRawTransaction,
 * eth_sendTransaction or any signing method, throws ReadOnlyError before `request` is called. The
 * error carries EIP-1193's code 4200 (unsupported method), so viem's custom transport wraps it in its
 * UnsupportedProviderMethodError (the ReadOnlyError is its `cause`) and does not retry it.
 */
export function readOnlyEvm(request: Eip1193Request): Eip1193Request {
  return async (args) => {
    const method = isRecord(args) ? args.method : undefined;
    if (typeof method !== "string" || !(EVM_READ_METHODS as readonly string[]).includes(method)) {
      throw Object.assign(new ReadOnlyError(String(method), "not an EVM read method"), { code: 4200 });
    }
    return request(args);
  };
}

/**
 * A viem public client whose only way to the network is readOnlyEvm over evmJsonRpc(url): a read
 * outside EVM_READ_METHODS, or any send, is refused before a request leaves, once and without a
 * retry (viem's UnsupportedProviderMethodError, whose cause is the ReadOnlyError). viem retries a
 * read `retryCount` times (default 3).
 */
export function readOnlyEvmClient(
  chain: Chain,
  url: string,
  options: { retryCount?: number; timeoutMs?: number; fetch?: typeof fetch } = {},
): PublicClient {
  const request = readOnlyEvm(evmJsonRpc(url, { timeoutMs: options.timeoutMs, fetch: options.fetch }));
  return createPublicClient({ chain, transport: custom({ request }, { retryCount: options.retryCount ?? 3 }) }) as PublicClient;
}

export type EvmCheckId =
  | "node-chain-id"
  | "tx-chain-id"
  | "tx-type"
  | "tx-hash"
  | "signing-hash"
  | "r"
  | "s"
  | "y-parity"
  | "sender"
  | "receipt"
  | "finalized";

export interface EvmProof {
  verdict: "proven" | "not-proven";
  checks: { id: EvmCheckId; ok: boolean; detail: string }[];
  /** JSON-safe: no bigint. */
  evm: {
    chainId: number;
    hash: `0x${string}`;
    from: `0x${string}` | null;
    nonce: number;
    blockNumber: string | null;
    status: "success" | "reverted" | null;
  };
  near: { tx: string; receiptId: string; predecessor: string; path: string };
}

/** What an EVM transaction signed, from a node's answer or a raw transaction. */
interface SignedFields {
  /** viem's name for the type: eip1559, eip2930, legacy, eip4844, eip7702, or another. */
  type: string;
  chainId: number | undefined;
  nonce: number;
  /** The fields its signature covers, for the types rebuilt here; null for the others. */
  unsigned: TransactionSerializable | null;
  signature: { r: bigint; s: bigint; yParity: number | undefined; v: bigint | undefined } | null;
}

const TYPE_NAMES: Record<string, string> = {
  eip1559: "type 2 (EIP-1559)",
  eip2930: "type 1 (EIP-2930)",
  legacy: "type 0 (legacy)",
  eip4844: "type 3 (blob)",
  eip7702: "type 4 (EIP-7702)",
};

function parityFromV(v: bigint | undefined): number | undefined {
  if (v === undefined) return undefined;
  if (v === 0n || v === 27n) return 0;
  if (v === 1n || v === 28n) return 1;
  if (v >= 35n) return Number((v - 35n) % 2n);
  return undefined;
}

function fieldsOfNode(tx: Transaction): SignedFields {
  const t = tx as Transaction & { gasPrice?: bigint; maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint; accessList?: unknown; v?: bigint; yParity?: number };
  const common = { nonce: t.nonce, gas: t.gas, to: t.to ?? undefined, value: t.value, data: t.input };
  let unsigned: TransactionSerializable | null = null;
  if (t.type === "eip1559") {
    unsigned = {
      type: "eip1559",
      chainId: t.chainId,
      maxFeePerGas: t.maxFeePerGas,
      maxPriorityFeePerGas: t.maxPriorityFeePerGas,
      accessList: (t.accessList ?? []) as never,
      ...common,
    };
  } else if (t.type === "eip2930") {
    unsigned = { type: "eip2930", chainId: t.chainId as number, gasPrice: t.gasPrice, accessList: (t.accessList ?? []) as never, ...common };
  } else if (t.type === "legacy") {
    unsigned = { type: "legacy", chainId: t.chainId, gasPrice: t.gasPrice, ...common };
  }
  const yParity = typeof t.yParity === "number" ? t.yParity : parityFromV(t.v);
  const signature = t.r && t.s ? { r: BigInt(t.r), s: BigInt(t.s), yParity, v: t.v } : null;
  return { type: String(t.type), chainId: t.chainId, nonce: t.nonce, unsigned, signature };
}

function fieldsOfRaw(raw: Hex): SignedFields {
  const parsed = parseTransaction(raw) as TransactionSerializable & { r?: Hex; s?: Hex; v?: bigint; yParity?: number };
  const { r, s, v, yParity, ...rest } = parsed;
  const type = String(parsed.type);
  const unsigned = type === "eip1559" || type === "eip2930" || type === "legacy" ? (rest as TransactionSerializable) : null;
  const signature = r && s ? { r: BigInt(r), s: BigInt(s), yParity: typeof yParity === "number" ? yParity : parityFromV(v), v } : null;
  return { type, chainId: parsed.chainId, nonce: parsed.nonce ?? 0, unsigned, signature };
}

/** The signature as viem serializes it with the fields: yParity for typed transactions, v for legacy ones. */
function viemSignature(fields: SignedFields) {
  const sig = fields.signature;
  if (!sig) return null;
  const r = numberToHex(sig.r, { size: 32 });
  const s = numberToHex(sig.s, { size: 32 });
  if (fields.type === "legacy") {
    const v = sig.v ?? (sig.yParity === undefined ? undefined : BigInt(27 + sig.yParity));
    return v === undefined ? null : { r, s, v };
  }
  return sig.yParity === undefined ? null : { r, s, yParity: sig.yParity };
}

/** The address that signed `hash` with (r, s, parity), or null when that is not a signature. */
function recoverAddress(hash: Hex, sig: { r: bigint; s: bigint; yParity: number }): `0x${string}` | null {
  try {
    const point = new secp256k1.Signature(sig.r, sig.s).addRecoveryBit(sig.yParity).recoverPublicKey(hexToBytes(hash.slice(2)));
    return getAddress(`0x${keccak256(point.toRawBytes(false).subarray(1)).slice(-40)}`);
  } catch {
    return null;
  }
}

type Check = EvmProof["checks"][number];
type AuditedRequest = SignTxAudit["requests"][number];

/**
 * The checks that bind a signed EVM transaction to an MPC answer: chain id, type, the signing hash
 * against the request's payload, r, s and parity against the answer, and the sender against the
 * derived key's address (and the node's `from`, when there is one).
 */
function signatureChecks(
  fields: SignedFields | null,
  request: AuditedRequest | undefined,
  requestIndex: number,
  expectedChainId: number,
  nodeFrom: `0x${string}` | null,
): { checks: Check[]; signingHash: Hex | null; recovered: `0x${string}` | null } {
  const checks: Check[] = [];
  const add = (id: EvmCheckId, ok: boolean, detail: string) => checks.push({ id, ok, detail });
  const unreadable = "the transaction could not be read";

  if (!fields) add("tx-chain-id", false, unreadable);
  else if (fields.chainId === undefined) add("tx-chain-id", false, "the transaction carries no EIP-155 chain id");
  else add("tx-chain-id", fields.chainId === expectedChainId, `the transaction is signed for chain ${fields.chainId}${fields.chainId === expectedChainId ? "" : `, not ${expectedChainId}`}`);

  const typeName = fields ? (TYPE_NAMES[fields.type] ?? `type ${fields.type}`) : "";
  if (!fields) add("tx-type", false, unreadable);
  else if (fields.type === "eip1559") add("tx-type", true, typeName);
  else if (fields.type === "eip2930" || fields.type === "legacy") add("tx-type", true, `${typeName}: Experimental, no real one is recorded`);
  else if (fields.type === "eip4844" || fields.type === "eip7702") add("tx-type", false, `${typeName} is refused: its signing covers more than the fields rebuilt here`);
  else add("tx-type", false, `${typeName} is not a type rebuilt here`);

  const signingHash = fields?.unsigned ? keccak256(serializeTransaction(fields.unsigned)) : null;
  const answer = request?.response;
  const secpAnswer = request !== undefined && request.status === "signed" && request.request.payload.kind === "ecdsa" && isSecp256k1Response(answer) ? answer : null;
  const noAnswer = !request
    ? `the audit has no request ${requestIndex}`
    : request.status !== "signed"
      ? `request ${requestIndex} is ${request.status}, not signed`
      : `request ${requestIndex} has no secp256k1 answer`;

  if (!signingHash) add("signing-hash", false, fields ? `not rebuilt: ${typeName}` : unreadable);
  else if (!request) add("signing-hash", false, noAnswer);
  else {
    const payload = `0x${request.request.payload.hex}`;
    add("signing-hash", signingHash === payload, signingHash === payload ? `${signingHash} is the request's payload` : `${signingHash}, but the request's payload is ${payload}`);
  }

  let expected: { r: bigint; s: bigint; yParity: number } | null = null;
  if (secpAnswer) {
    try {
      const low = normalizeEcdsa(secpAnswer.s.scalar, secpAnswer.recovery_id);
      expected = { r: BigInt(`0x${secpAnswer.big_r.affine_point.slice(2)}`), s: low.s, yParity: low.yParity };
    } catch {
      expected = null;
    }
  }
  const sig = fields?.signature ?? null;
  const compare = (id: "r" | "s" | "y-parity", ours: bigint | number | undefined, theirs: bigint | number | undefined) => {
    if (!expected) return add(id, false, secpAnswer ? "the MPC answer is malformed" : noAnswer);
    if (ours === undefined) return add(id, false, fields ? "the transaction carries no signature" : unreadable);
    const show = (v: bigint | number) => (typeof v === "bigint" ? hex32(v) : String(v));
    add(id, ours === theirs, ours === theirs ? `${show(ours)} as the MPC answer gives it` : `${show(ours)}, but the MPC answer gives ${show(theirs as bigint | number)}`);
  };
  compare("r", sig?.r, expected?.r);
  compare("s", sig?.s, expected?.s);
  compare("y-parity", sig?.yParity, expected?.yParity);

  const recovered = signingHash && sig && sig.yParity !== undefined ? recoverAddress(signingHash, { r: sig.r, s: sig.s, yParity: sig.yParity }) : null;
  const derived = request?.evmAddress ?? null;
  if (!recovered) add("sender", false, signingHash ? "no sender recovers from the transaction's signature" : "no signing hash, so no sender to recover");
  else if (!derived) add("sender", false, request ? `request ${requestIndex} has no derived EVM address (pass the root key for its domain)` : noAnswer);
  else {
    const fromOk = nodeFrom === null || getAddress(nodeFrom) === recovered;
    const ok = recovered === getAddress(derived) && fromOk;
    add(
      "sender",
      ok,
      ok
        ? `${recovered}, the derived key's address${nodeFrom === null ? "" : " and the node's from field"}`
        : `${recovered} recovers, the derived key's address is ${getAddress(derived)}${nodeFrom === null ? "" : `, the node's from field is ${getAddress(nodeFrom)}`}`,
    );
  }
  return { checks, signingHash, recovered };
}

/**
 * Proves that the EVM transaction `hash`, read through `client` (pass a readOnlyEvmClient), is exactly
 * the one the audit's request `requestIndex` (default 0) got signed: the node serves
 * `expectedChainId`; the transaction is signed for it; it is type 2 (types 0 and 1 are Experimental,
 * 3 and 4 refused); rebuilt from the node's fields with its signature it hashes to `hash`; its
 * signing hash is the request's payload; r, s and parity are the MPC answer's, s normalized low;
 * it recovers to the derived key's address and the node's `from`; its receipt succeeded; and its
 * block is finalized. Every check is reported; "proven" only when all pass.
 */
export async function proveEvmTx(input: {
  audit: SignTxAudit;
  requestIndex?: number;
  client: PublicClient;
  hash: `0x${string}`;
  expectedChainId: number;
}): Promise<EvmProof> {
  const { audit, client, hash, expectedChainId } = input;
  const requestIndex = input.requestIndex ?? 0;
  const request = audit.requests[requestIndex];
  const nodeChainId = await client.getChainId();
  const tx = await client.getTransaction({ hash });
  let receipt: TransactionReceipt | null = null;
  try {
    receipt = await client.getTransactionReceipt({ hash });
  } catch (err) {
    if (!(err instanceof Error && err.name === "TransactionReceiptNotFoundError")) throw err;
  }
  const finalized = await client.getBlock({ blockTag: "finalized" });

  const fields = fieldsOfNode(tx);
  const nodeOk = nodeChainId === expectedChainId;
  const checks: Check[] = [{ id: "node-chain-id", ok: nodeOk, detail: `the node serves chain ${nodeChainId}${nodeOk ? "" : `, not ${expectedChainId}`}` }];
  const bound = signatureChecks(fields, request, requestIndex, expectedChainId, tx.from ?? null);
  const [chainCheck, typeCheck, ...rest] = bound.checks;
  checks.push(chainCheck, typeCheck);

  const viemSig = viemSignature(fields);
  if (!fields.unsigned) checks.push({ id: "tx-hash", ok: false, detail: `not rebuilt: ${TYPE_NAMES[fields.type] ?? `type ${fields.type}`}` });
  else if (!viemSig) checks.push({ id: "tx-hash", ok: false, detail: "the node's transaction carries no signature" });
  else {
    const rebuilt = keccak256(serializeTransaction(fields.unsigned, viemSig));
    const ok = rebuilt === hash.toLowerCase();
    checks.push({ id: "tx-hash", ok, detail: ok ? "the node's fields and signature hash to it" : `the node's fields and signature hash to ${rebuilt}` });
  }
  checks.push(...rest);

  if (!receipt) {
    const where = tx.blockNumber === null || tx.blockNumber === undefined ? "the transaction is not mined" : `the node puts the transaction in block ${tx.blockNumber} but answers no receipt for it`;
    checks.push({ id: "receipt", ok: false, detail: `no receipt: ${where}` });
  } else checks.push({ id: "receipt", ok: receipt.status === "success", detail: `the receipt says ${receipt.status}` });

  const blockNumber = receipt?.blockNumber ?? tx.blockNumber ?? null;
  const finalNumber = finalized.number ?? null;
  if (blockNumber === null) checks.push({ id: "finalized", ok: false, detail: "the transaction is in no block" });
  else if (finalNumber === null) checks.push({ id: "finalized", ok: false, detail: "the node names no finalized block" });
  else {
    const ok = blockNumber <= finalNumber;
    checks.push({ id: "finalized", ok, detail: `block ${blockNumber}; the node has finalized up to ${finalNumber}` });
  }

  return {
    verdict: checks.every((c) => c.ok) ? "proven" : "not-proven",
    checks,
    evm: {
      chainId: fields.chainId ?? nodeChainId,
      hash,
      from: tx.from ? getAddress(tx.from) : null,
      nonce: tx.nonce,
      blockNumber: tx.blockNumber === null || tx.blockNumber === undefined ? null : String(tx.blockNumber),
      status: receipt?.status ?? null,
    },
    near: nearSide(audit, request),
  };
}

function nearSide(audit: SignTxAudit, request: AuditedRequest | undefined): EvmProof["near"] {
  return { tx: audit.tx, receiptId: request?.request.receiptId ?? "", predecessor: request?.request.predecessor ?? "", path: request?.request.path ?? "" };
}

/**
 * Offline: whether the raw signed transaction `raw` is signed by the audit's request `requestIndex`
 * (default 0) — chain id, type, signing hash, r, s, parity and sender. Its hash is computed, not
 * checked, and it is never broadcast, so there is no receipt or finality check.
 */
export function proveRawTx(input: { audit: SignTxAudit; requestIndex?: number; raw: `0x${string}`; expectedChainId: number }): EvmProof {
  const { audit, raw, expectedChainId } = input;
  const requestIndex = input.requestIndex ?? 0;
  const request = audit.requests[requestIndex];
  let fields: SignedFields | null = null;
  try {
    fields = fieldsOfRaw(raw);
  } catch {
    fields = null;
  }
  const bound = signatureChecks(fields, request, requestIndex, expectedChainId, null);
  return {
    verdict: bound.checks.every((c) => c.ok) ? "proven" : "not-proven",
    checks: bound.checks,
    evm: { chainId: fields?.chainId ?? 0, hash: keccak256(raw), from: bound.recovered, nonce: fields?.nonce ?? 0, blockNumber: null, status: null },
    near: nearSide(audit, request),
  };
}
