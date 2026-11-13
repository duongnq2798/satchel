import { readFileSync } from "node:fs";
import { MAINNET, TESTNET } from "satchel-nft";
import { describe, expect, it } from "vitest";
import { appPath } from "./routes";
import { MINT_PATH, SALE_DEED_PATH, TESTNET_ACCOUNT_URL, TESTNET_FAUCET_URL, allDemo } from "./try-it";

const BEFORE = new Date("2026-11-14T12:00:00Z");
const AFTER = new Date("2026-11-25T00:00:00Z");

describe("the market's demo notice", () => {
  it("shows only when every listing is a demo satchel", () => {
    expect(allDemo(TESTNET, ["4", "6"], BEFORE)).toBe(true);
    expect(allDemo(TESTNET, ["4"], BEFORE)).toBe(true);
    expect(allDemo(TESTNET, ["4", "12"], BEFORE)).toBe(false);
    expect(allDemo(TESTNET, ["12"], BEFORE)).toBe(false);
    expect(allDemo(MAINNET, ["3"], BEFORE)).toBe(true);
    expect(allDemo(MAINNET, ["3", "4"], BEFORE)).toBe(false);
  });

  it("doesn't show with nothing listed, or once the freeze ends", () => {
    expect(allDemo(TESTNET, [], BEFORE)).toBe(false);
    expect(allDemo(MAINNET, [], BEFORE)).toBe(false);
    expect(allDemo(TESTNET, ["4", "6"], AFTER)).toBe(false);
  });
});

describe("where a visitor tries the app instead", () => {
  it("links mainnet #3's deed of sale, a section its page has", () => {
    expect(SALE_DEED_PATH).toBe("/mainnet/satchel/3#deed");
    const deed = readFileSync(new URL("../components/landing/deed/deed-of-sale.tsx", import.meta.url), "utf8");
    expect(deed).toContain('<section id="deed"');
  });

  it("mints on testnet, whichever network the page is on", () => {
    expect(MINT_PATH).toBe(appPath(TESTNET, "/satchels"));
  });

  it("points to NEAR's own docs for a testnet account and testnet NEAR", () => {
    for (const url of [TESTNET_ACCOUNT_URL, TESTNET_FAUCET_URL]) expect(new URL(url).origin).toBe("https://docs.near.org");
  });
});
