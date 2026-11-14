import { describe, expect, it } from "vitest";
import derived from "./__fixtures__/derived-keys.json" with { type: "json" };
import { base58Decode, base58Encode } from "./base58.js";
import * as evm from "./evm.js";
import * as root from "./index.js";

// base58.ts holds the codec evm.ts had; evm.ts and the package root still export the same functions.
describe("base58", () => {
  it("is the codec evm.ts and the package root export", () => {
    expect(evm.base58Decode).toBe(base58Decode);
    expect(evm.base58Encode).toBe(base58Encode);
    expect(root.base58Decode).toBe(base58Decode);
    expect(root.base58Encode).toBe(base58Encode);
  });

  it("keeps leading zero bytes both ways", () => {
    expect(Array.from(base58Decode("112"))).toEqual([0, 0, 1]);
    expect(base58Encode(Uint8Array.from([0, 0, 1]))).toBe("112");
    expect(base58Encode(new Uint8Array(3))).toBe("111");
    expect(Array.from(base58Decode("111"))).toEqual([0, 0, 0]);
  });

  it("encodes nothing as nothing", () => {
    expect(base58Encode(new Uint8Array(0))).toBe("");
    expect(Array.from(base58Decode(""))).toEqual([]);
  });

  it("round-trips every recorded MPC key", () => {
    const keys = [derived.testnet.rootKey, derived.mainnet.rootKey, ...Object.values(derived.testnet.keys), ...Object.values(derived.mainnet.keys)];
    for (const key of keys) {
      const body = key.slice("secp256k1:".length);
      const bytes = base58Decode(body);
      expect(bytes.length).toBe(64);
      expect(base58Encode(bytes)).toBe(body);
    }
  });

  it("refuses a character outside the alphabet, with the same text as before", () => {
    for (const c of ["0", "O", "I", "l", "+"]) {
      expect(() => base58Decode(`2${c}`)).toThrow(`not base58: ${c}`);
    }
  });
});
