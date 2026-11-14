import { secp256k1 } from "@noble/curves/secp256k1";
import { sha3_256 } from "@noble/hashes/sha3";
import { bytesToHex } from "@noble/hashes/utils";
import { describe, expect, it, vi } from "vitest";
import derived from "./__fixtures__/derived-keys.json" with { type: "json" };
import { base58Encode } from "./base58.js";
import { MAINNET, TESTNET } from "./config.js";
import { deriveMpcKey } from "./evm.js";
import { TWEAK_PREFIX, deriveKey, deriveTweak } from "./mpc-kdf.js";

// v1.signer-prod.testnet's domain 1 (ed25519) root key and the key it derives for tx-bench.testnet
// with an empty path: `public_key({domain_id: 1})` and
// `derived_public_key({path: "", predecessor: "tx-bench.testnet", domain_id: 1})`, read at final on
// 2026-11-14 (blocks 277648168 and 277648169) through https://rpc.testnet.fastnear.com.
const TESTNET_ED25519_ROOT = "ed25519:6vSEtQxrQj6txUMh33WC4ERyCWmNMRTdufDWAaDY3Un2";
const TX_BENCH_ED25519 = "ed25519:pJisEEQe9mw8Ew2faGNAHzu6wijjtUhjorKGReGTkpi";

const SECP256K1_N = secp256k1.CURVE.n;

describe("MPC key derivation, domain 0 (secp256k1)", () => {
  const networks = [
    ["testnet", TESTNET, derived.testnet],
    ["mainnet", MAINNET, derived.mainnet],
  ] as const;

  for (const [name, net, read] of networks) {
    it(`gives every key ${read.mpc}'s derived_public_key gave on ${name}, as deriveMpcKey does`, () => {
      for (const [path, key] of Object.entries(read.keys)) {
        expect(deriveKey(read.rootKey, net.contract, path, 0)).toBe(key);
        expect(deriveKey(read.rootKey, net.contract, path)).toBe(key);
        expect(deriveMpcKey(read.rootKey, net.contract, path)).toBe(key);
      }
    });
  }

  it("hashes the prefix, the caller, a comma and the path, as evm.ts did", () => {
    expect(TWEAK_PREFIX).toBe("near-mpc-recovery v0.1.0 epsilon derivation:");
    const tweak = deriveTweak(TESTNET.contract, "satchel/1");
    expect(bytesToHex(tweak)).toBe(bytesToHex(sha3_256(`${TWEAK_PREFIX}${TESTNET.contract},satchel/1`)));
    expect(tweak.length).toBe(32);
    expect(bytesToHex(deriveTweak("a.testnet", ""))).not.toBe(bytesToHex(deriveTweak("a.testnet", "x")));
  });

  it("throws evm.ts's texts for a key that is not a 64-byte secp256k1 key", () => {
    const ed = "ed25519:11111111111111111111111111111111";
    expect(() => deriveKey(ed, TESTNET.contract, "satchel/1", 0)).toThrow(`not a secp256k1 key: ${ed}`);
    expect(() => deriveMpcKey(ed, TESTNET.contract, "satchel/1")).toThrow(`not a secp256k1 key: ${ed}`);
    expect(() => deriveKey("secp256k1:2", TESTNET.contract, "satchel/1", 0)).toThrow("expected a 64-byte key, got 1");
    expect(() => deriveMpcKey("secp256k1:2", TESTNET.contract, "satchel/1")).toThrow("expected a 64-byte key, got 1");
  });

  it("throws the same error as deriveMpcKey for a root key off the curve", () => {
    const offCurve = `secp256k1:${base58Encode(new Uint8Array(64).fill(1))}`;
    let ours: unknown;
    let theirs: unknown;
    try {
      deriveKey(offCurve, TESTNET.contract, "satchel/1", 0);
    } catch (err) {
      ours = err;
    }
    try {
      deriveMpcKey(offCurve, TESTNET.contract, "satchel/1");
    } catch (err) {
      theirs = err;
    }
    expect(ours).toBeInstanceOf(Error);
    expect((ours as Error).message).toBe((theirs as Error).message);
  });

  it("refuses a tweak that is not a scalar, with evm.ts's text", async () => {
    // No (caller, path) is known whose sha3-256 is 0 or at least n, so sha3_256 is replaced in this test
    // only: first by 32 zero bytes, then by n itself. Both domains must refuse 0; secp256k1 refuses n.
    const n = SECP256K1_N.toString(16).padStart(64, "0");
    for (const digest of [new Uint8Array(32), Uint8Array.from(n.match(/../g) ?? [], (b) => Number.parseInt(b, 16))]) {
      vi.resetModules();
      vi.doMock("@noble/hashes/sha3", async (original) => ({
        ...(await original<typeof import("@noble/hashes/sha3")>()),
        sha3_256: () => digest,
      }));
      const kdf = await import("./mpc-kdf.js");
      const evmMocked = await import("./evm.js");
      expect(() => kdf.deriveKey(derived.testnet.rootKey, TESTNET.contract, "satchel/1", 0)).toThrow(
        "the tweak for satchel/1 is not a valid scalar",
      );
      expect(() => evmMocked.deriveMpcKey(derived.testnet.rootKey, TESTNET.contract, "satchel/1")).toThrow(
        "the tweak for satchel/1 is not a valid scalar",
      );
      if (digest.every((b) => b === 0)) {
        expect(() => kdf.deriveKey(TESTNET_ED25519_ROOT, "tx-bench.testnet", "", 1)).toThrow("the tweak for  is not a valid scalar");
      }
      vi.doUnmock("@noble/hashes/sha3");
    }
    vi.resetModules();
  });

  it("refuses a domain it does not know", () => {
    expect(() => deriveKey(derived.testnet.rootKey, TESTNET.contract, "satchel/1", 2 as 0)).toThrow("unknown MPC domain 2");
  });
});

describe("MPC key derivation, domain 1 (ed25519)", () => {
  it("gives the key v1.signer-prod.testnet derived for tx-bench.testnet with an empty path", () => {
    expect(deriveKey(TESTNET_ED25519_ROOT, "tx-bench.testnet", "", 1)).toBe(TX_BENCH_ED25519);
    expect(deriveKey(TESTNET_ED25519_ROOT, "tx-bench.testnet", "")).toBe(TX_BENCH_ED25519);
  });

  it("gives another key for another path or another caller", () => {
    const key = deriveKey(TESTNET_ED25519_ROOT, "tx-bench.testnet", "", 1);
    expect(deriveKey(TESTNET_ED25519_ROOT, "tx-bench.testnet", "a", 1)).not.toBe(key);
    expect(deriveKey(TESTNET_ED25519_ROOT, "tx-bench2.testnet", "", 1)).not.toBe(key);
  });

  it("refuses a root key that is not ed25519, or not a valid point", () => {
    expect(() => deriveKey(derived.testnet.rootKey, "tx-bench.testnet", "", 1)).toThrow(`not an ed25519 key: ${derived.testnet.rootKey}`);
    // In-test inputs: the identity point (small order), a y with no point on the curve, the wrong length
    // and text that is not base58.
    const identity = new Uint8Array(32);
    identity[0] = 1;
    const noPoint = new Uint8Array(32);
    noPoint[0] = 2;
    for (const bad of [identity, noPoint, new Uint8Array(31).fill(7)]) {
      expect(() => deriveKey(`ed25519:${base58Encode(bad)}`, "tx-bench.testnet", "", 1)).toThrow(
        "the root key is not a valid ed25519 point",
      );
    }
    expect(() => deriveKey("ed25519:0OIl", "tx-bench.testnet", "", 1)).toThrow("the root key is not a valid ed25519 point");
  });
});
