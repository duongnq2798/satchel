import { ed25519 } from "@noble/curves/ed25519";
import { secp256k1 } from "@noble/curves/secp256k1";
import { sha3_256 } from "@noble/hashes/sha3";
import { bytesToHex } from "@noble/hashes/utils";
import { base58Decode, base58Encode } from "./base58.js";

// The key NEAR's MPC network (Chain Signatures) holds for a caller and a path, computed locally from
// the network's root key, as the MPC contract's `derived_public_key` view computes it
// (https://docs.near.org/chain-abstraction/chain-signatures, https://github.com/near/mpc).
// Each signing domain has its own root key: domains 0 and 4 are secp256k1 (ECDSA), 1 and 5 ed25519
// (EdDSA), and the derivation is the same within a curve.

/** An MPC domain id, as the contract's `domain_id` (a u64) names it. */
export type MpcDomain = number;

/** The curve of an MPC signing domain's keys. */
export type MpcCurve = "secp256k1" | "ed25519";

/**
 * The signing domains (purpose "Sign") both MPC contracts list, with the curve of their keys. Read with
 * `state()` on 2026-11-14: v1.signer at block 224520081 (8mk3bAGvDq2pAyYg8L4t3C7EbPR6CWYEuwtPeg8rPKAq)
 * and v1.signer-prod.testnet at block 277662864 (FBLrcxhg8PeWCdrT7XF2UfC7KxHPBJUpHz1QzTSd1Nni). Both
 * list domains 0-7: 0 and 4 CaitSith (secp256k1), 1 and 5 Frost (ed25519), all four "Sign"; 2 and 6
 * "CKD" (confidential key derivation) and 3 and 7 "ForeignTx", which `sign` does not take. Pinned, never
 * fetched: the live test compares it with `state()` at a final block.
 */
export const MPC_SIGN_DOMAINS: Readonly<Record<number, MpcCurve>> = Object.freeze({ 0: "secp256k1", 1: "ed25519", 4: "secp256k1", 5: "ed25519" });

/** The curve of signing domain `domain`, or null for a domain id this code does not know as a signing domain. */
export function signDomainCurve(domain: number): MpcCurve | null {
  return Number.isSafeInteger(domain) && Object.hasOwn(MPC_SIGN_DOMAINS, domain) ? MPC_SIGN_DOMAINS[domain] : null;
}

/** What the MPC network hashes, with the caller's account and the path, to tweak its root key. */
export const TWEAK_PREFIX = "near-mpc-recovery v0.1.0 epsilon derivation:";

const SECP256K1_N = secp256k1.CURVE.n;
const ED25519_L = ed25519.CURVE.n;

/**
 * sha3-256 of the prefix, `predecessor`, a comma and `path`. Account ids cannot hold a comma, so the
 * pair is unambiguous.
 */
export function deriveTweak(predecessor: string, path: string): Uint8Array {
  return sha3_256(`${TWEAK_PREFIX}${predecessor},${path}`);
}

/**
 * The key the MPC network derives for `predecessor` and `path` from `rootKey`, in NEAR's text form:
 * `secp256k1:<64 bytes>` (the root plus t·G, t the tweak read big-endian) for a secp256k1 domain (0, 4),
 * or `ed25519:<32 bytes>` (the root plus t·B, t the tweak read little-endian mod l) for an ed25519
 * domain (1, 5). `rootKey` is that domain's own root key. Without `domain`, the root key's prefix
 * picks the curve; with it, the domain's curve (MPC_SIGN_DOMAINS) must be the root key's, and a domain
 * that is not a signing domain there throws. A root key that is not a valid point, or a tweak that is
 * not a valid scalar, throws: no key is better than a wrong one.
 */
export function deriveKey(rootKey: string, predecessor: string, path: string, domain?: MpcDomain): string {
  const curve = domain === undefined ? (rootKey.startsWith("ed25519:") ? "ed25519" : "secp256k1") : signDomainCurve(domain);
  if (curve === "secp256k1") return deriveSecp256k1(rootKey, deriveTweak(predecessor, path), path);
  if (curve === "ed25519") return deriveEd25519(rootKey, deriveTweak(predecessor, path), path);
  throw new Error(`unknown MPC signing domain ${String(domain)}: the signing domains are ${Object.keys(MPC_SIGN_DOMAINS).join(", ")}`);
}

/** The 64 bytes (x then y) of a NEAR `secp256k1:<base58>` public key. */
function secp256k1KeyBytes(publicKey: string): Uint8Array {
  if (!publicKey.startsWith("secp256k1:")) throw new Error(`not a secp256k1 key: ${publicKey}`);
  const bytes = base58Decode(publicKey.slice("secp256k1:".length));
  if (bytes.length !== 64) throw new Error(`expected a 64-byte key, got ${bytes.length}`);
  return bytes;
}

function deriveSecp256k1(rootKey: string, tweakBytes: Uint8Array, path: string): string {
  const root = secp256k1.ProjectivePoint.fromHex(`04${bytesToHex(secp256k1KeyBytes(rootKey))}`);
  const tweak = BigInt(`0x${bytesToHex(tweakBytes)}`);
  if (tweak === 0n || tweak >= SECP256K1_N) throw new Error(`the tweak for ${path} is not a valid scalar`);
  const key = root.add(secp256k1.ProjectivePoint.BASE.multiply(tweak)).toRawBytes(false);
  return `secp256k1:${base58Encode(key.subarray(1))}`;
}

function deriveEd25519(rootKey: string, tweakBytes: Uint8Array, path: string): string {
  if (!rootKey.startsWith("ed25519:")) throw new Error(`not an ed25519 key: ${rootKey}`);
  let root: ReturnType<typeof ed25519.ExtendedPoint.fromHex>;
  try {
    const bytes = base58Decode(rootKey.slice("ed25519:".length));
    if (bytes.length !== 32) throw new Error("not 32 bytes");
    root = ed25519.ExtendedPoint.fromHex(bytes);
    if (root.isSmallOrder()) throw new Error("small order");
  } catch {
    throw new Error("the root key is not a valid ed25519 point");
  }
  const tweak = BigInt(`0x${bytesToHex(Uint8Array.from(tweakBytes).reverse())}`) % ED25519_L;
  if (tweak === 0n) throw new Error(`the tweak for ${path} is not a valid scalar`);
  return `ed25519:${base58Encode(root.add(ed25519.ExtendedPoint.BASE.multiply(tweak)).toRawBytes())}`;
}
