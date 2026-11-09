import { describe, expect, it } from "vitest";
import { failureMessage, outcomeValue, viewErrorMessage } from "./near";
import { formatNear, parseNear, satchelTx } from "./satchel";

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
  it("buys with the price as deposit and pins the record version and price", () => {
    const tx = satchelTx.buy("1", "4", 3n * 10n ** 24n);
    expect(tx.actions[0].params).toMatchObject({
      methodName: "buy",
      args: { token_id: "1", record_version: "4", price: "3000000000000000000000000" },
      deposit: "3000000000000000000000000",
    });
  });

  it("signs with one yocto and enough gas for the MPC request", () => {
    const tx = satchelTx.signEvm("1", {
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
    expect(satchelTx.mint().actions[0].params.deposit).toBe("100000000000000000000000");
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

  it("returns null while a wallet reports no final status", () => {
    expect(outcomeValue({ transaction: { hash: "x" } })).toBeNull();
    expect(outcomeValue({ transaction: { hash: "x" }, status: "Started" })).toBeNull();
  });
});
