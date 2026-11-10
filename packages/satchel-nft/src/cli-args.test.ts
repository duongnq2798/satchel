import { describe, expect, it } from "vitest";
import { type CliArgs, parseCli, sendInputs, tokenIdArg } from "./cli-args.js";
import { MAINNET, TESTNET } from "./config.js";

function run(argv: string[]): CliArgs {
  const parsed = parseCli(argv);
  if (parsed.kind !== "run") throw new Error(`expected a command, got ${JSON.stringify(parsed)}`);
  return parsed.args;
}

function error(argv: string[]): string {
  const parsed = parseCli(argv);
  if (parsed.kind !== "error") throw new Error(`expected an error, got ${JSON.stringify(parsed)}`);
  return parsed.message;
}

describe("parseCli", () => {
  it("reads a read command on testnet by default, or on the network given either way", () => {
    expect(run(["verify", "1"])).toMatchObject({ command: "verify", network: "testnet", tokenId: "1", json: false });
    expect(run(["verify", "--network", "mainnet", "1"])).toMatchObject({ network: "mainnet", tokenId: "1" });
    expect(run(["show", "7", "--network=mainnet", "--json"])).toMatchObject({ command: "show", network: "mainnet", json: true });
    expect(run(["market"])).toMatchObject({ command: "market" });
    expect(run(["history", "7", "--json"])).toMatchObject({ command: "history", tokenId: "7", json: true });
    expect(error(["history"])).toBe("usage: satchel-nft history <id>");
  });

  it("shows help or the version, and help with no command", () => {
    expect(parseCli([]).kind).toBe("help");
    expect(parseCli(["--help"]).kind).toBe("help");
    expect(parseCli(["verify", "1", "-h"]).kind).toBe("help");
    expect(parseCli(["--version"]).kind).toBe("version");
  });

  it("refuses an unknown command, network, keychain or option", () => {
    expect(error(["burn", "1"])).toMatch(/Unknown command burn/);
    expect(error(["verify", "1", "--network", "devnet"])).toMatch(/testnet or mainnet/);
    expect(error(["verify", "1", "--network", "constructor"])).toMatch(/testnet or mainnet/);
    expect(error(["mint", "--as", "a.testnet", "--keychain", "file"])).toMatch(/legacy or os/);
    expect(error(["verify", "1", "--force"])).toMatch(/Unknown option/);
  });

  it("refuses an option that belongs to another command", () => {
    expect(error(["show", "1", "--to", "0x00"])).toMatch(/show does not take --to/);
    expect(error(["verify", "1", "--as", "alice.testnet"])).toMatch(/does not take --as/);
    expect(error(["list", "1", "2", "--as", "a.testnet", "--accept-not-clean"])).toMatch(/does not take --accept-not-clean/);
  });

  it("takes exactly the positional arguments a command names", () => {
    expect(error(["verify"])).toBe("usage: satchel-nft verify <id>");
    expect(error(["verify", "1", "2"])).toBe("usage: satchel-nft verify <id>");
    expect(error(["market", "1"])).toBe("usage: satchel-nft market");
    expect(error(["list", "1", "--as", "a.testnet"])).toBe("usage: satchel-nft list <id> <price>");
  });

  it("takes token ids as the contract stores them", () => {
    expect(run(["verify", "007"]).tokenId).toBe("7");
    expect(error(["verify", "-1"])).toMatch(/Unknown option|whole number/);
    expect(error(["verify", "1.5"])).toMatch(/whole number/);
    expect(error(["verify", "18446744073709551616"])).toMatch(/whole number/);
    expect(tokenIdArg("18446744073709551615")).toBe("18446744073709551615");
    expect(tokenIdArg("0x10")).toBeNull();
  });

  it("needs a signer for every sign command, and reads its options", () => {
    for (const argv of [["mint"], ["list", "1", "2"], ["delist", "1"], ["buy", "1"], ["transfer", "1", "b.testnet"]]) {
      expect(error(argv)).toMatch(/--as <account>/);
    }
    expect(run(["mint", "--as", "alice.testnet"])).toMatchObject({
      command: "mint",
      signer: "alice.testnet",
      yes: false,
      keychain: "legacy",
    });
    expect(run(["list", "4", "2.5", "--as", "a.testnet", "--yes", "--keychain", "os", "--near-cli", "/bin/near"])).toMatchObject({
      tokenId: "4",
      price: "2.5",
      yes: true,
      keychain: "os",
      nearCli: "/bin/near",
    });
    expect(run(["transfer", "1", "friend.testnet", "--as", "a.testnet"]).receiver).toBe("friend.testnet");
    expect(run(["buy", "4", "--as", "b.testnet", "--accept-not-clean"]).acceptNotClean).toBe(true);
    for (const bad of ["Alice.testnet", "a", "﻿alice.testnet", "alice..testnet", "alice-.testnet"]) {
      expect(error(["mint", "--as", bad])).toMatch(/--as takes a NEAR account id/);
    }
  });

  it("needs a chain, a recipient and an amount to send, with no calldata by default", () => {
    expect(error(["send", "1", "--as", "a.testnet", "--to", "0x00", "--value", "1"])).toBe("send needs --chain");
    expect(error(["send", "1", "--as", "a.testnet", "--chain", "sepolia", "--value", "1"])).toBe("send needs --to");
    expect(run(["send", "1", "--as", "a.testnet", "--chain", "sepolia", "--to", "0xab", "--value", "1"])).toMatchObject({
      chain: "sepolia",
      to: "0xab",
      value: "1",
      data: "0x",
    });
  });

  it("finishes a DAO's sign_evm from the NEAR transaction hash, with no signer", () => {
    const hash = "2ryQpsJRq8zQwxCdHzJszi5dBBxjECF4Jt59J1NmPG4M";
    expect(run(["dao", "finish", hash])).toMatchObject({ command: "dao", nearTx: hash, yes: false, network: "testnet" });
    expect(run(["dao", "finish", hash, "--yes", "--json"])).toMatchObject({ yes: true, json: true });
    expect(error(["dao"])).toBe("usage: satchel-nft dao finish <near tx>");
    expect(error(["dao", "finish"])).toBe("usage: satchel-nft dao finish <near tx>");
    expect(error(["dao", "vote", hash])).toBe("dao takes finish, not vote");
    expect(error(["dao", "finish", "0x27e3"])).toMatch(/not a NEAR transaction hash/);
    expect(error(["dao", "finish", `${hash.slice(0, 42)}0l`])).toMatch(/not a NEAR transaction hash/);
    // Leading zero bytes encode as 1s, so a hash can be as short as 32 characters.
    expect(run(["dao", "finish", "1".repeat(32)]).nearTx).toBe("1".repeat(32));
    expect(error(["dao", "finish", "1".repeat(31)])).toMatch(/not a NEAR transaction hash/);
    expect(error(["dao", "finish", hash, "--as", "a.testnet"])).toMatch(/does not take --as/);
  });
});

describe("sendInputs", () => {
  const to = "0x000000000000000000000000000000000000dEaD";

  it("finds the chain by id or name, only among the network's own chains", () => {
    const ok = (net = TESTNET, chain = "sepolia") => sendInputs(net, { chain, to, value: "1", data: "0x" });
    expect(ok()).toMatchObject({ chain: { id: 11155111 }, value: 10n ** 18n });
    expect(ok(TESTNET, "84532")).toMatchObject({ chain: { name: "Base Sepolia" } });
    expect(ok(TESTNET, "Base Sepolia")).toMatchObject({ chain: { id: 84532 } });
    expect(ok(MAINNET, "base")).toMatchObject({ chain: { id: 8453 } });
    expect(ok(TESTNET, "base")).toMatchObject({ error: expect.stringMatching(/A testnet satchel sends on Sepolia/) });
    expect(ok(MAINNET, "sepolia")).toMatchObject({ error: expect.stringMatching(/A mainnet satchel sends on Ethereum/) });
  });

  it("refuses a bad address, amount or calldata", () => {
    const with_ = (fields: object) => sendInputs(TESTNET, { chain: "sepolia", to, value: "0.01", data: "0x", ...fields });
    expect(with_({ to: "0x1234" })).toHaveProperty("error");
    // A mixed-case address must carry a valid checksum.
    expect(with_({ to: "0x000000000000000000000000000000000000DEaD" })).toHaveProperty("error");
    expect(with_({ value: "-1" })).toHaveProperty("error");
    expect(with_({ value: "1e18" })).toHaveProperty("error");
    expect(with_({ value: "0.0000000000000000001" })).toHaveProperty("error");
    expect(with_({ data: "0xabc" })).toHaveProperty("error");
    expect(with_({ data: "abcd" })).toHaveProperty("error");
    expect(with_({ value: "0.000000000000000001", data: "0xa9059cbb" })).toMatchObject({ value: 1n, data: "0xa9059cbb" });
  });
});
