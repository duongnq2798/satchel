import { MAINNET, TESTNET } from "satchel-nft";
import { describe, expect, it } from "vitest";
import { NOT_FOUND, appPath, isSatchelId, networkForPath, switchPath } from "./routes";

describe("routes", () => {
  it("takes a satchel id of 1 to 19 digits, and nothing else", () => {
    for (const id of ["0", "1", "42", "1234567890123456789"]) expect(isSatchelId(id), id).toBe(true);
    for (const id of ["", "abc", "1a", "-1", "1.0", " 1", "1 ", "+1", "１", "12345678901234567890"]) {
      expect(isSatchelId(id), JSON.stringify(id)).toBe(false);
    }
  });

  it("names a missing page the same way wherever it is", () => {
    expect(NOT_FOUND.title).toBe("Page not found");
    expect(NOT_FOUND.description).toMatch(/^Satchel has no page at this address\./);
  });

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
