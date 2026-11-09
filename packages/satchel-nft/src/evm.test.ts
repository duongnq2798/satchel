import { describe, expect, it } from "vitest";
import outcome from "./__fixtures__/sign-evm-outcome.json" with { type: "json" };
import {
  type EvmTx,
  type MpcSignature,
  addressFromMpcKey,
  base58Decode,
  maxCost,
  recoverSigner,
  signedRawTx,
  signingHash,
  toContractTx,
  toEvmSignature,
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
