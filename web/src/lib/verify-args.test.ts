import { describe, expect, it } from "vitest";
import { parseVerifyArgs } from "./verify-args";

describe("parseVerifyArgs", () => {
  it("reads a token id, on testnet unless --network says otherwise", () => {
    expect(parseVerifyArgs(["1"])).toEqual({ network: "testnet", tokenId: "1" });
    expect(parseVerifyArgs(["--network", "mainnet", "12"])).toEqual({ network: "mainnet", tokenId: "12" });
    expect(parseVerifyArgs(["12", "--network", "testnet"])).toEqual({ network: "testnet", tokenId: "12" });
  });

  it.each([
    [[]],
    [["1", "2"]],
    [["x"]],
    [["--network"]],
    [["--network", "1"]],
    [["--network", "devnet", "1"]],
    [["--network", "constructor", "1"]],
    [["--network", "toString", "1"]],
    [["--network=mainnet", "1"]],
  ])("refuses %j", (args) => {
    expect(parseVerifyArgs(args)).toBeNull();
  });
});
