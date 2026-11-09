import { afterEach, describe, expect, it, vi } from "vitest";
import { MAINNET, TESTNET } from "./config.js";
import { failureMessage, outcomeValue, viewErrorMessage } from "./near.js";
import { formatNear, parseNear, satchel, satchelTx } from "./satchel.js";

describe("satchel(net).get", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** A NEAR RPC whose `satchel` view returns `view`, whatever token it was asked about. */
  const answering = (view: unknown) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const result = [...new TextEncoder().encode(JSON.stringify(view))];
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: "satchel", result: { result } }));
      }),
    );

  it("refuses an answer about another token, since addresses and transactions are built from it", async () => {
    answering({ token_id: "7", owner_id: "a.testnet", path: "satchel/7" });
    await expect(satchel(TESTNET).get("4")).rejects.toThrow(/answered for satchel #7 at path satchel\/7, not #4/);
    answering({ token_id: "4", owner_id: "a.testnet", path: "satchel/7" });
    await expect(satchel(TESTNET).get("4")).rejects.toThrow(/at path satchel\/7, not #4/);
    answering({ token_id: "4", owner_id: "a.testnet", path: "satchel/4" });
    await expect(satchel(TESTNET).get("4")).resolves.toMatchObject({ token_id: "4" });
    answering(null);
    await expect(satchel(TESTNET).get("4")).resolves.toBeNull();
  });
});

describe("NEAR amounts", () => {
  it("parses decimals to yoctoNEAR exactly", () => {
    expect(parseNear("1")).toBe(10n ** 24n);
    expect(parseNear("2.5")).toBe(25n * 10n ** 23n);
    expect(parseNear("0.000000000000000000000001")).toBe(1n);
  });

  it("refuses zero, negatives, junk and too many decimals", () => {
    for (const bad of ["0", "-1", "1e3", "abc", "", "0.0000000000000000000000001"]) {
      expect(() => parseNear(bad)).toThrow();
    }
  });

  it("formats yoctoNEAR", () => {
    expect(formatNear(25n * 10n ** 23n)).toBe("2.5");
    expect(formatNear("100000000000000000000000")).toBe("0.1");
    expect(formatNear(10n ** 24n)).toBe("1");
  });
});

describe("transactions", () => {
  it("calls the contract of the network it is built for", () => {
    expect(satchelTx(TESTNET).mint().receiverId).toBe("v1.satchel-nft.testnet");
    expect(satchelTx(MAINNET).mint().receiverId).toBe("v1.satchel-nft.near");
  });

  it("buys with the price as deposit and pins the record version and price", () => {
    const tx = satchelTx(TESTNET).buy("1", "4", 3n * 10n ** 24n);
    expect(tx.actions[0].params).toMatchObject({
      methodName: "buy",
      args: { token_id: "1", record_version: "4", price: "3000000000000000000000000" },
      deposit: "3000000000000000000000000",
    });
  });

  it("signs with one yocto and enough gas for the MPC request", () => {
    const tx = satchelTx(TESTNET).signEvm("1", {
      chain_id: "11155111",
      nonce: "0",
      max_priority_fee_per_gas: "1",
      max_fee_per_gas: "2",
      gas_limit: "21000",
      to: "0x000000000000000000000000000000000000dEaD",
      value: "0",
      data: "0x",
    });
    expect(tx.actions[0].params.deposit).toBe("1");
    expect(BigInt(tx.actions[0].params.gas)).toBeGreaterThanOrEqual(50n * 10n ** 12n);
  });

  it("mints with 0.1 NEAR", () => {
    expect(satchelTx(TESTNET).mint().actions[0].params.deposit).toBe("100000000000000000000000");
  });
});

describe("outcomes", () => {
  it("turns a contract panic into its message", () => {
    const failure = {
      ActionError: {
        index: 0,
        kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: Satchel: only the token's owner can do this" } },
      },
    };
    expect(failureMessage(failure)).toBe("Satchel: only the token's owner can do this");
    expect(() => outcomeValue({ transaction: { hash: "x" }, status: { Failure: failure } })).toThrow(/only the token's owner/);
  });

  it("turns a view panic into its message", () => {
    // What rpc.testnet.fastnear.com answered for evm_signing_hash with the tip above the fee cap.
    const error =
      'wasm execution failed with error: HostError(GuestPanic { panic_msg: "Satchel: max_priority_fee_per_gas is above max_fee_per_gas" })';
    expect(viewErrorMessage("evm_signing_hash", error)).toBe("Satchel: max_priority_fee_per_gas is above max_fee_per_gas");
    expect(viewErrorMessage("satchel", "MethodNotFound")).toBe("satchel failed: MethodNotFound");
  });

  it("never reads an unfinished transaction as a success", () => {
    for (const status of [undefined, "Started", "NotStarted", {}]) {
      expect(() => outcomeValue({ transaction: { hash: "x" }, status })).toThrow(/has not finished/);
    }
    expect(outcomeValue({ transaction: { hash: "x" }, status: { SuccessValue: "" } })).toBeNull();
  });
});
