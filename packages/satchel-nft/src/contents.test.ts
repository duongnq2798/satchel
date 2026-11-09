import { encodeAbiParameters, getAddress } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHAINS, chainInfo } from "./config.js";
import { TOKENS, chainContents } from "./contents.js";
import { formatAmount } from "./evm.js";

describe("TOKENS", () => {
  it("names a list for every chain the contract signs for, and no other", () => {
    expect(Object.keys(TOKENS).map(Number).sort()).toEqual(CHAINS.map((c) => c.id).sort());
  });

  it("holds checksummed addresses, plausible decimals and one token of each kind", () => {
    for (const [id, tokens] of Object.entries(TOKENS)) {
      expect(new Set(tokens.map((t) => t.kind)).size, `chain ${id}`).toBe(tokens.length);
      for (const t of tokens) {
        expect(getAddress(t.address), `${t.kind} on ${id}`).toBe(t.address);
        expect(t.kind === "WETH" ? [18] : [6, 18], `${t.kind} on ${id}`).toContain(t.decimals);
      }
    }
  });
});

describe("formatAmount", () => {
  it("shows whole units to five decimals", () => {
    expect(formatAmount(0n, 6)).toBe("0");
    expect(formatAmount(1_500_000n, 6)).toBe("1.5");
    expect(formatAmount(123_456_789n, 6)).toBe("123.45678");
    expect(formatAmount(1n, 18)).toBe("< 0.00001");
    expect(formatAmount(100n * 10n ** 18n + 1n, 18)).toBe("100");
    expect(formatAmount(1_840_000_000_000_000n, 18)).toBe("0.00184");
  });
});

describe("chainContents", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const SATCHEL = "0x000000000000000000000000000000000000dEaD";
  const uint = (n: bigint) => encodeAbiParameters([{ type: "uint256" }], [n]);

  it("reads the native coin and each token, and marks one it can't read", async () => {
    const sepolia = chainInfo(11155111);
    if (!sepolia) throw new Error("no Sepolia");
    const [usdc, weth] = TOKENS[11155111];
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { body: string }) => {
        const { id, method, params } = JSON.parse(init.body) as { id: number; method: string; params: [{ to: string }] };
        asked.push(String(url));
        const reply = (body: object) => Response.json({ jsonrpc: "2.0", id, ...body });
        if (method === "eth_getBalance") return reply({ result: "0x1bc16d674ec80000" });
        if (params[0].to.toLowerCase() === usdc.address.toLowerCase()) return reply({ result: uint(1_500_000n) });
        return reply({ error: { code: 3, message: "execution reverted", data: "0x" } });
      }),
    );
    const found = await chainContents(sepolia, SATCHEL);
    expect(found.native).toBe(2n * 10n ** 18n);
    expect(found.tokens).toEqual([
      { token: usdc, amount: 1_500_000n },
      { token: weth, amount: null },
    ]);
    expect(asked).toHaveLength(3);
    for (const url of asked) expect(url.startsWith(sepolia.rpc)).toBe(true);
  });
});
