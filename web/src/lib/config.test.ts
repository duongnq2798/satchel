import { describe, expect, it } from "vitest";
import { CHAINS, MAINNET, TESTNET, accountOnNetwork, appPath, networkForPath, sendChains, switchPath } from "./config";

describe("networks", () => {
  it("reads the network from the page's path", () => {
    expect(networkForPath("/mainnet")).toBe(MAINNET);
    expect(networkForPath("/mainnet/satchel/1")).toBe(MAINNET);
    expect(networkForPath("/")).toBe(TESTNET);
    expect(networkForPath("/satchel/1")).toBe(TESTNET);
    expect(networkForPath("/mainnetish")).toBe(TESTNET);
    expect(networkForPath(null)).toBe(TESTNET);
  });

  it("keeps links on the same network", () => {
    expect(appPath(TESTNET, "/market")).toBe("/market");
    expect(appPath(TESTNET, "/")).toBe("/");
    expect(appPath(MAINNET, "/market")).toBe("/mainnet/market");
    expect(appPath(MAINNET, "/")).toBe("/mainnet");
  });

  it("switches to the same page on the other network, or home", () => {
    expect(switchPath("/market", MAINNET)).toBe("/mainnet/market");
    expect(switchPath("/mainnet/satchels", TESTNET)).toBe("/satchels");
    expect(switchPath("/mainnet", TESTNET)).toBe("/");
    expect(switchPath("/", MAINNET)).toBe("/mainnet");
    expect(switchPath("/satchel/4", MAINNET)).toBe("/mainnet");
    expect(switchPath("/mainnet/satchel/1", TESTNET)).toBe("/");
  });

  it("sends only on the network's own chains, and both cover every chain the contract signs for", () => {
    expect(sendChains(TESTNET).every((c) => c.testnet)).toBe(true);
    expect(sendChains(MAINNET).every((c) => !c.testnet)).toBe(true);
    expect(sendChains(TESTNET).length + sendChains(MAINNET).length).toBe(CHAINS.length);
  });

  it("runs the same reproducible build on both networks", () => {
    expect(MAINNET.build).toEqual(TESTNET.build);
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
