import { MAINNET, TESTNET } from "satchel-nft";
import { describe, expect, it } from "vitest";
import { appPath, networkForPath, switchPath } from "./routes";

describe("routes", () => {
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
    // A DAO's board too: account ids differ by network.
    expect(switchPath("/dao/satchel-bounty.sputnikv2.testnet", MAINNET)).toBe("/mainnet");
  });
});
