import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha2";
import { base58Decode } from "./evm.js";

/**
 * NEP-413 signed messages: what a NEAR wallet signs when a site asks it to prove it holds an
 * account's key, with no transaction. The wallet signs sha256 of a tag, 2^31 + 413, then the borsh
 * payload. No transaction starts with that tag, so a signed message can never be sent as one.
 */
export const NEP413_TAG = 2 ** 31 + 413;

export interface Nep413Payload {
  message: string;
  /** 32 bytes the site picked, so one signature can't stand for another request. */
  nonce: Uint8Array;
  /** Who the message is for, like "satchelnft.xyz". The wallet shows it. */
  recipient: string;
  callbackUrl?: string | null;
}

const u32 = (n: number) => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, n, true);
  return bytes;
};

/** A borsh string: its UTF-8 byte length as a little-endian u32, then the bytes. */
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

/** The 32 bytes a wallet signs for `payload`. Throws on a nonce that is not 32 bytes. */
export function nep413Hash({ message, nonce, recipient, callbackUrl = null }: Nep413Payload): Uint8Array {
  if (nonce.length !== 32) throw new Error(`a NEP-413 nonce is 32 bytes, not ${nonce.length}`);
  return sha256(
    concat(
      u32(NEP413_TAG),
      borshString(message),
      nonce,
      borshString(recipient),
      callbackUrl === null ? Uint8Array.of(0) : concat(Uint8Array.of(1), borshString(callbackUrl)),
    ),
  );
}

/** Standard or URL-safe base64, padded or not, as bytes; null for anything else. */
export function base64ToBytes(text: string): Uint8Array | null {
  if (typeof text !== "string" || !/^[A-Za-z0-9+/_-]*={0,2}$/.test(text)) return null;
  const plain = text.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
  if (plain.length % 4 === 1) return null;
  try {
    return Uint8Array.from(atob(plain.padEnd(Math.ceil(plain.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** The 32 bytes of an `ed25519:<base58>` key; null for any other key type or length. */
function ed25519Key(publicKey: string): Uint8Array | null {
  if (!publicKey.startsWith("ed25519:")) return null;
  const bytes = base58Decode(publicKey.slice("ed25519:".length));
  return bytes.length === 32 ? bytes : null;
}

/**
 * A signature's 64 bytes: base64, as wallets return it through near-connect, or `ed25519:<base58>`,
 * as near-cli-rs prints it.
 */
function signatureBytes(signature: string): Uint8Array | null {
  const bytes = signature.startsWith("ed25519:") ? base58Decode(signature.slice("ed25519:".length)) : base64ToBytes(signature);
  return bytes !== null && bytes.length === 64 ? bytes : null;
}

export interface Nep413Signed extends Nep413Payload {
  /** `ed25519:<base58>`. NEAR's other key type, secp256k1, is refused. */
  publicKey: string;
  signature: string;
}

/**
 * Whether `publicKey` signed this message for `recipient` with this nonce. Strict RFC 8032
 * verification (no ZIP-215 leniency). Malformed input of any kind is false, never a throw.
 */
export function verifyNep413(signed: Nep413Signed): boolean {
  try {
    const key = ed25519Key(signed.publicKey);
    const signature = signatureBytes(signed.signature);
    if (key === null || signature === null || !(signed.nonce instanceof Uint8Array) || signed.nonce.length !== 32) return false;
    return ed25519.verify(signature, nep413Hash(signed), key, { zip215: false });
  } catch {
    return false;
  }
}
