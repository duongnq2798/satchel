import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";
import { base58Encode } from "../base58.js";

// The unit tests' ed25519 key. It is made in process from fixed text, so the cassettes can record what
// testnet answers about it (scripts/capture-primitive-fixtures.mjs makes it from the same TEST_KEY_TEXT).
// It signs test messages only, never a transaction, and no account holds it: its implicit account
// does not exist, and any "this account holds the test key" answer is an in-test change that says so.

export const TEST_KEY_TEXT = "satchel-nft primitives: unit-test key; it signs test messages, never a transaction";

const secret = sha256(new TextEncoder().encode(TEST_KEY_TEXT));
const publicBytes = ed25519.getPublicKey(secret);

export const TEST_KEY = {
  /** `ed25519:<base58>`. */
  publicKey: `ed25519:${base58Encode(publicBytes)}`,
  /** Its implicit account id: the hex of the 32 key bytes. */
  implicit: bytesToHex(publicBytes),
  /** An `ed25519:<base58>` signature of `message` (for NEP-413, the 32-byte nep413Hash). */
  sign(message: Uint8Array): string {
    return `ed25519:${base58Encode(ed25519.sign(message, secret))}`;
  },
};
