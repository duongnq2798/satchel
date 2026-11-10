import { afterEach, describe, expect, it, vi } from "vitest";
import derived from "./__fixtures__/derived-keys.json" with { type: "json" };
import outcome from "./__fixtures__/sign-evm-outcome.json" with { type: "json" };
import { MAINNET, TESTNET } from "./config.js";
import {
  type EvmTx,
  type MpcSignature,
  addressFromMpcKey,
  base58Decode,
  base58Encode,
  contractUint,
  deriveMpcKey,
  fromContractTx,
  maxCost,
  recoverSigner,
  signedRawTx,
  signingHash,
  toContractTx,
  toEvmSignature,
  tokenAddress,
} from "./evm.js";
import { outcomeValue } from "./near.js";

// Token 1 on v1.satchel-nft.testnet, from the end-to-end run (deployments/testnet-e2e.json).
const TOKEN_1_KEY =
  "secp256k1:uB6uEeQBAQdZZ4mTgDpaSSfyBXUWcNixrep15KX8UwSGa9iUkfywL1xQQog9MZ76YbKQWe5hiMbuDhXVJnuBykT";
const TOKEN_1_ADDRESS = "0x96DA1468E95Ab31A698891f0150095f86b5a282B";
const SIGNED_TX: EvmTx = {
  chainId: 11155111,
  nonce: 0,
  maxPriorityFeePerGas: 2n,
  maxFeePerGas: 20n,
  gas: 21000n,
  to: "0x000000000000000000000000000000000000dEaD",
  value: 1n,
  data: "0x",
};
const RAW =
  "0x02f86583aa36a780021482520894000000000000000000000000000000000000dead0180c001a03bfe67004fdf62d18335201b3dd21dbc587de22beb526876fc0c4950fda0c1e3a04f94162cec29837b574fedef2af0825ab0a890c1c66667cd8940f38f98098cae";
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

describe("token address", () => {
  it("is the keccak of the key the MPC contract derived", () => {
    expect(addressFromMpcKey(TOKEN_1_KEY)).toBe(TOKEN_1_ADDRESS);
  });

  it("keeps leading zero bytes in base58", () => {
    expect(Array.from(base58Decode("112"))).toEqual([0, 0, 1]);
  });

  it("refuses keys that are not 64-byte secp256k1", () => {
    expect(() => addressFromMpcKey("ed25519:11111111111111111111111111111111")).toThrow(/secp256k1/);
    expect(() => addressFromMpcKey("secp256k1:2")).toThrow(/64-byte/);
  });

  it("encodes base58 back to the same text, leading zero bytes too", () => {
    for (const text of ["112", "1", "", TOKEN_1_KEY.slice("secp256k1:".length)]) {
      expect(base58Encode(base58Decode(text))).toBe(text);
    }
  });
});

// Every satchel minted on each network by 2026-11-10 (testnet #1 to #8, mainnet #1), with the root key
// and the derived keys the MPC contracts returned for them (__fixtures__/derived-keys.json).
describe("deriving a satchel's key locally", () => {
  afterEach(() => vi.restoreAllMocks());

  const networks = [
    ["testnet", TESTNET, derived.testnet],
    ["mainnet", MAINNET, derived.mainnet],
  ] as const;

  for (const [name, net, read] of networks) {
    it(`pins the ${name} MPC contract's root key`, () => {
      expect([net.mpc, net.contract, net.mpcRootKey]).toEqual([read.mpc, read.contract, read.rootKey]);
    });

    for (const [path, key] of Object.entries(read.keys)) {
      it(`gives the key ${read.mpc}'s derived_public_key gave for ${path} on ${name}`, () => {
        expect(deriveMpcKey(net.mpcRootKey, net.contract, path)).toBe(key);
      });
    }
  }

  it("gives the addresses the app and the README show, without reading anything", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    expect(await tokenAddress(TESTNET, "satchel/1")).toBe(TOKEN_1_ADDRESS);
    expect(await tokenAddress(MAINNET, "satchel/1")).toBe("0xdC269Ead17B522d49db2ceFD38CEF0C5413868F9");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("gives another key for another path or another caller", () => {
    const key = deriveMpcKey(TESTNET.mpcRootKey, TESTNET.contract, "satchel/1");
    expect(deriveMpcKey(TESTNET.mpcRootKey, TESTNET.contract, "satchel/10")).not.toBe(key);
    expect(deriveMpcKey(TESTNET.mpcRootKey, "satchel-nft.testnet", "satchel/1")).not.toBe(key);
  });

  it("refuses a root key that is not a point on the curve", () => {
    const offCurve = `secp256k1:${base58Encode(new Uint8Array(64).fill(1))}`;
    expect(() => deriveMpcKey(offCurve, TESTNET.contract, "satchel/1")).toThrow();
    expect(() => deriveMpcKey("ed25519:11111111111111111111111111111111", TESTNET.contract, "satchel/1")).toThrow(
      /secp256k1/,
    );
  });
});

describe("a real sign_evm round trip", () => {
  const mpc = outcomeValue<MpcSignature>(outcome);

  it("parses the MPC signature the transaction returned", () => {
    expect(mpc?.recovery_id).toBe(1);
    expect(mpc?.big_r.affine_point).toMatch(/^03/);
  });

  it("hashes the transaction as the contract did", () => {
    expect(signingHash(SIGNED_TX)).toBe("0xdb23d1f97d37db73f8043be1db8d96ec494e5711fc845fab444b8f91e0601154");
  });

  it("recovers the token's address and rebuilds the signed transaction byte for byte", async () => {
    const signature = toEvmSignature(mpc as MpcSignature);
    expect(await recoverSigner(SIGNED_TX, signature)).toBe(TOKEN_1_ADDRESS);
    expect(signedRawTx(SIGNED_TX, signature)).toBe(RAW);
  });

  it("sends the fields the contract took", () => {
    expect(toContractTx(SIGNED_TX)).toEqual({
      chain_id: "11155111",
      nonce: "0",
      max_priority_fee_per_gas: "2",
      max_fee_per_gas: "20",
      gas_limit: "21000",
      to: "0x000000000000000000000000000000000000dEaD",
      value: "1",
      data: "0x",
    });
  });

  it("reads sign_evm's fields back as the contract reads them, and refuses what it refuses", () => {
    const fields = toContractTx(SIGNED_TX);
    expect(fromContractTx(fields)).toEqual(SIGNED_TX);
    // near-sdk's U64 and U128 take a leading + and leading zeros: the contract signs the same hash.
    expect(fromContractTx({ ...fields, nonce: "+0", chain_id: "011155111", value: `${"0".repeat(45)}1` })).toEqual(SIGNED_TX);
    expect(contractUint("18446744073709551615")).toBe(2n ** 64n - 1n);
    for (const bad of ["18446744073709551616", "-0", " 1", "0x10", "1e3", ""]) expect(contractUint(bad)).toBeNull();
    expect(() => fromContractTx({ ...fields, nonce: "-1" })).toThrow(/nonce is not a number the contract takes/);
    expect(() => fromContractTx({ ...fields, max_priority_fee_per_gas: "21" })).toThrow(/above its max_fee_per_gas/);
    expect(() => fromContractTx({ ...fields, to: "0xdead" })).toThrow(/to is not an address/);
    expect(() => fromContractTx({ ...fields, data: "0xabc" })).toThrow(/whole bytes/);
    expect(fromContractTx({ ...fields, data: `0x${"ab".repeat(8192)}` }).data).toHaveLength(2 + 2 * 8192);
    expect(() => fromContractTx({ ...fields, data: `0x${"ab".repeat(8193)}` })).toThrow(/longer than the contract's 8192 bytes/);
  });

  it("normalizes a high s and flips the parity, so the same address recovers", async () => {
    const m = mpc as MpcSignature;
    const high = (SECP256K1_N - BigInt(`0x${m.s.scalar}`)).toString(16).padStart(64, "0");
    const flipped: MpcSignature = { ...m, s: { scalar: high }, recovery_id: m.recovery_id ^ 1 };
    const signature = toEvmSignature(flipped);
    expect(signature.yParity).toBe(m.recovery_id);
    expect(await recoverSigner(SIGNED_TX, signature)).toBe(TOKEN_1_ADDRESS);
  });

  it("refuses malformed signatures", () => {
    const m = mpc as MpcSignature;
    expect(() => toEvmSignature({ ...m, recovery_id: 2 })).toThrow(/recovery_id/);
    expect(() => toEvmSignature({ ...m, big_r: { affine_point: "04ab" } })).toThrow(/compressed/);
  });
});

it("prices a transaction at its fee cap", () => {
  expect(maxCost(SIGNED_TX)).toBe(420_001n);
});
