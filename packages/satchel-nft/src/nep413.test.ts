import { describe, expect, it } from "vitest";
import vectors from "./__fixtures__/nep413-near-cli.json" with { type: "json" };
import { base58Decode, base58Encode } from "./evm.js";
import { base64ToBytes, bytesToBase64, nep413Hash, verifyNep413 } from "./nep413.js";

/** A fixture vector as verifyNep413 takes it. near-cli-rs signed these, not this package. */
const signed = (v: (typeof vectors.vectors)[number]) => ({
  message: v.message,
  nonce: base64ToBytes(v.nonce) as Uint8Array,
  recipient: v.recipient,
  publicKey: v.publicKey,
  signature: v.signature,
});

const [plain, multiline] = vectors.vectors.map(signed);

describe("verifyNep413", () => {
  it("verifies both near-cli-rs vectors, the multi-line UTF-8 one too", () => {
    expect(multiline.message).toContain("\n");
    expect(multiline.message).toContain("é");
    expect(verifyNep413(plain)).toBe(true);
    expect(verifyNep413(multiline)).toBe(true);
  });

  it("fails when any of the message, nonce, recipient, signature or key changes", () => {
    for (const v of [plain, multiline]) {
      const nonce = Uint8Array.from(v.nonce);
      nonce[31] ^= 1;
      const sig = base58Decode(v.signature.slice("ed25519:".length));
      sig[10] ^= 1;
      expect(verifyNep413({ ...v, message: `${v.message} ` })).toBe(false);
      expect(verifyNep413({ ...v, message: v.message.replace("Satchel", "satchel") })).toBe(false);
      expect(verifyNep413({ ...v, nonce })).toBe(false);
      expect(verifyNep413({ ...v, recipient: "satchelnft.xyz.evil.com" })).toBe(false);
      expect(verifyNep413({ ...v, signature: `ed25519:${base58Encode(sig)}` })).toBe(false);
      expect(verifyNep413({ ...v, callbackUrl: "https://satchelnft.xyz" })).toBe(false);
    }
    // Each vector's key against the other's signature.
    expect(verifyNep413({ ...plain, publicKey: multiline.publicKey })).toBe(false);
    expect(verifyNep413({ ...multiline, publicKey: plain.publicKey })).toBe(false);
  });

  it("takes the signature as base64, as wallets return it, or as ed25519:base58", () => {
    for (const v of [plain, multiline]) {
      const bytes = base58Decode(v.signature.slice("ed25519:".length));
      expect(bytes.length).toBe(64);
      const base64 = bytesToBase64(bytes);
      expect(verifyNep413({ ...v, signature: base64 })).toBe(true);
      expect(verifyNep413({ ...v, signature: base64.replace(/=+$/, "") })).toBe(true);
      expect(verifyNep413({ ...v, signature: base64.replace(/\+/g, "-").replace(/\//g, "_") })).toBe(true);
    }
  });

  it("refuses a key that is not ed25519, and a key or signature of the wrong length", () => {
    const key = plain.publicKey.slice("ed25519:".length);
    expect(verifyNep413({ ...plain, publicKey: `secp256k1:${key}` })).toBe(false);
    expect(verifyNep413({ ...plain, publicKey: key })).toBe(false);
    expect(verifyNep413({ ...plain, publicKey: `ed25519:${base58Encode(base58Decode(key).subarray(1))}` })).toBe(false);
    const sig = base58Decode(plain.signature.slice("ed25519:".length));
    expect(verifyNep413({ ...plain, signature: bytesToBase64(sig.subarray(0, 63)) })).toBe(false);
    expect(verifyNep413({ ...plain, signature: bytesToBase64(Uint8Array.of(...sig, 0)) })).toBe(false);
  });

  it("returns false for garbage, never throws", () => {
    const garbage: unknown[] = [
      { ...plain, publicKey: "ed25519:0OIl" },
      { ...plain, signature: "ed25519:not base58!" },
      { ...plain, signature: "%%%" },
      { ...plain, signature: "" },
      { ...plain, nonce: new Uint8Array(31) },
      { ...plain, nonce: "AAAA" },
      { ...plain, message: 42 },
      { ...plain, publicKey: null },
      { ...plain, signature: undefined },
      {},
      null,
    ];
    for (const g of garbage) expect(verifyNep413(g as Parameters<typeof verifyNep413>[0])).toBe(false);
  });
});

describe("nep413Hash", () => {
  it("hashes the tag, then borsh: the message, the nonce, the recipient and an Option for the callback", () => {
    const nonce = new Uint8Array(32).fill(7);
    const none = nep413Hash({ message: "m", nonce, recipient: "r" });
    expect(nep413Hash({ message: "m", nonce, recipient: "r", callbackUrl: null })).toEqual(none);
    // Some("") is one byte longer than None, so it can't hash the same.
    expect(nep413Hash({ message: "m", nonce, recipient: "r", callbackUrl: "" })).not.toEqual(none);
    // A boundary moved between message and recipient changes the hash: each carries its length.
    expect(nep413Hash({ message: "mr", nonce, recipient: "" })).not.toEqual(nep413Hash({ message: "m", nonce, recipient: "r" }));
    expect(() => nep413Hash({ message: "m", nonce: new Uint8Array(16), recipient: "r" })).toThrow(/32 bytes/);
  });

  it("reads base64 strictly enough to refuse what isn't", () => {
    expect(base64ToBytes(vectors.vectors[0].nonce)).toEqual(new Uint8Array(32).fill(7));
    expect(base64ToBytes("A")).toBeNull();
    expect(base64ToBytes("AA AA")).toBeNull();
    expect(base64ToBytes("AA==AA")).toBeNull();
    expect(base64ToBytes("")).toEqual(new Uint8Array(0));
  });
});
