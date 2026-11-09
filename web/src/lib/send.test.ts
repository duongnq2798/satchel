import { keccak256 } from "viem";
import { describe, expect, it, vi } from "vitest";
import outcome from "./__fixtures__/sign-evm-outcome.json";
import { CHAINS, MAINNET, TESTNET } from "./config";
import { type EvmTx, type MpcSignature, signingHash } from "./evm";
import { outcomeValue } from "./near";
import { type SendDeps, type SendRequest, liveSendDeps, sendFromSatchel } from "./send";

// The real token 1 transaction and its MPC signature (evm.test.ts has the same vectors).
const TX: EvmTx = {
  chainId: 11155111,
  nonce: 0,
  maxPriorityFeePerGas: 2n,
  maxFeePerGas: 20n,
  gas: 21000n,
  to: "0x000000000000000000000000000000000000dEaD",
  value: 1n,
  data: "0x",
};
const SIGNATURE = outcomeValue<MpcSignature>(outcome);
const REQUEST: SendRequest = {
  net: TESTNET,
  tokenId: "1",
  from: "0x96DA1468E95Ab31A698891f0150095f86b5a282B",
  chain: CHAINS.find((c) => c.id === 11155111) as SendRequest["chain"],
  to: TX.to,
  value: 1n,
  data: "0x",
};

function deps(overrides: Partial<SendDeps> = {}): SendDeps {
  return {
    prepare: vi.fn(async () => TX),
    extraFee: async () => 0n,
    balance: async () => 10n ** 18n,
    contractHash: async (tx) => signingHash(tx).slice(2),
    signWithWallet: vi.fn(async () => ({ hash: "EZLXcvf43jqHYFUJm7gt3Ris5yM1Ru2FPihiEqJW1GUo", signature: SIGNATURE })),
    broadcast: vi.fn(async () => "0xabc" as const),
    confirm: async () => "success" as const,
    ...overrides,
  };
}

describe("sending from a satchel", () => {
  it("signs through the wallet, recovers the token's address and broadcasts", async () => {
    const d = deps();
    const steps: string[] = [];
    const result = await sendFromSatchel(REQUEST, d, (s) => steps.push(s));
    expect(result).toEqual({ nearTx: "EZLXcvf43jqHYFUJm7gt3Ris5yM1Ru2FPihiEqJW1GUo", evmTx: "0xabc", status: "success" });
    expect(steps).toEqual(["build", "hash", "wallet", "recover", "broadcast", "confirm"]);
    expect(d.broadcast).toHaveBeenCalledWith(11155111, expect.stringMatching(/^0x02f865/));
  });

  it("shows the hash before broadcasting and the most it can pay in fees before the wallet", async () => {
    const d = deps();
    const details: Record<string, string | undefined> = {};
    await sendFromSatchel(REQUEST, d, (s, detail) => {
      details[s] = detail;
    });
    const raw = vi.mocked(d.broadcast).mock.calls[0][1];
    expect(details.broadcast).toBe(keccak256(raw));
    expect(details.wallet).toBe((21000n * 20n).toString());
  });

  it("stops before the wallet when the satchel cannot pay for the transaction", async () => {
    const d = deps({ balance: async () => 420_000n });
    await expect(sendFromSatchel(REQUEST, d)).rejects.toThrow(/Fund 0x96DA/);
    expect(d.signWithWallet).not.toHaveBeenCalled();
  });

  it("counts the L1 data fee in what the satchel must hold", async () => {
    // Exactly enough for gas and value (21000 * 20 + 1), not for the L1 fee on top.
    const d = deps({ balance: async () => 420_001n, extraFee: async () => 5n });
    await expect(sendFromSatchel(REQUEST, d)).rejects.toThrow(/up to 420006/);
    await expect(sendFromSatchel(REQUEST, deps({ balance: async () => 420_001n }))).resolves.toBeDefined();
  });

  it("asks for funds before estimating a send the satchel can't cover", async () => {
    const d = deps({ balance: async () => 0n });
    await expect(sendFromSatchel(REQUEST, d)).rejects.toThrow(/Fund 0x96DA/);
    expect(d.prepare).not.toHaveBeenCalled();
  });

  it("stops before the wallet when the contract would hash something else", async () => {
    const d = deps({ contractHash: async () => "00".repeat(32) });
    await expect(sendFromSatchel(REQUEST, d)).rejects.toThrow(/Nothing was signed/);
    expect(d.signWithWallet).not.toHaveBeenCalled();
  });

  it("never broadcasts a signature from another key", async () => {
    const d = deps({ prepare: async () => ({ ...TX, nonce: 1 }) });
    await expect(sendFromSatchel(REQUEST, d)).rejects.toThrow(/Nothing was broadcast/);
    expect(d.broadcast).not.toHaveBeenCalled();
  });

  it("never signs for a chain on the other network", async () => {
    const d = deps();
    await expect(sendFromSatchel({ ...REQUEST, net: MAINNET }, d)).rejects.toThrow(/mainnet satchel doesn.t send on Sepolia/);
    const base = CHAINS.find((c) => c.id === 8453) as SendRequest["chain"];
    await expect(sendFromSatchel({ ...REQUEST, chain: base }, d)).rejects.toThrow(/testnet satchel doesn.t send on Base/);
    expect(d.signWithWallet).not.toHaveBeenCalled();
  });

  it("says signing again is safe when the wallet returns no signature", async () => {
    const d = deps({ signWithWallet: async () => ({ hash: "h", signature: null }) });
    await expect(sendFromSatchel(REQUEST, d)).rejects.toThrow(/signing again is safe/);
  });
});

describe("liveSendDeps", () => {
  it("asks the page's own contract for the signing hash", async () => {
    const asked: Record<string, string>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { body: string }) => {
        asked.push({ url, ...(JSON.parse(init.body) as { params: Record<string, string> }).params });
        return new Response(JSON.stringify({ result: { result: [...new TextEncoder().encode(JSON.stringify("ab"))] } }));
      }),
    );
    try {
      await liveSendDeps(MAINNET, vi.fn()).contractHash(TX);
      expect(asked).toEqual([
        expect.objectContaining({
          url: "https://rpc.mainnet.fastnear.com",
          account_id: "v1.satchel-nft.near",
          method_name: "evm_signing_hash",
        }),
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
