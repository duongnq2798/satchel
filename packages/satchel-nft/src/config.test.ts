import { describe, expect, it } from "vitest";
import { CHAINS, MAINNET, TESTNET, accountOnNetwork, sendChains } from "./config.js";

describe("networks", () => {
  it("sends only on the network's own chains, and both cover every chain the contract signs for", () => {
    expect(sendChains(TESTNET).every((c) => c.testnet)).toBe(true);
    expect(sendChains(MAINNET).every((c) => !c.testnet)).toBe(true);
    expect(sendChains(TESTNET).length + sendChains(MAINNET).length).toBe(CHAINS.length);
  });

  it("points each network at its own contract, signer and RPC", () => {
    expect([MAINNET.contract, MAINNET.mpc, MAINNET.nearRpc]).toEqual([
      "v1.satchel-nft.near",
      "v1.signer",
      "https://rpc.mainnet.fastnear.com",
    ]);
    expect([TESTNET.contract, TESTNET.mpc, TESTNET.nearRpc]).toEqual([
      "v1.satchel-nft.testnet",
      "v1.signer-prod.testnet",
      "https://rpc.testnet.fastnear.com",
    ]);
  });

  it("takes only accounts that can exist on the network", () => {
    expect(accountOnNetwork(TESTNET, "alice.testnet")).toBe(true);
    expect(accountOnNetwork(TESTNET, "alice.near")).toBe(false);
    expect(accountOnNetwork(MAINNET, "alice.near")).toBe(true);
    expect(accountOnNetwork(MAINNET, "alice.tg")).toBe(true);
    expect(accountOnNetwork(MAINNET, "alice.testnet")).toBe(false);
    const implicit = "98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6de";
    expect(accountOnNetwork(MAINNET, implicit)).toBe(true);
    expect(accountOnNetwork(TESTNET, implicit)).toBe(true);
  });
});
