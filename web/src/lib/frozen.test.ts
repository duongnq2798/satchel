import { MAINNET, TESTNET } from "satchel-nft";
import { describe, expect, it } from "vitest";
import { FROZEN_NOTE, isFrozen } from "./frozen";

const BEFORE = new Date("2026-11-11T12:00:00Z");

describe("the demo satchels' guard", () => {
  it("covers testnet #1 to #9 and mainnet #1 to #3, and no other", () => {
    for (const id of ["1", "2", "3", "4", "5", "6", "7", "8", "9"]) expect(isFrozen(TESTNET, id, BEFORE), `testnet #${id}`).toBe(true);
    expect(isFrozen(TESTNET, "10", BEFORE)).toBe(false);
    expect(isFrozen(TESTNET, "11", BEFORE)).toBe(false);
    expect(isFrozen(MAINNET, "1", BEFORE)).toBe(true);
    expect(isFrozen(MAINNET, "2", BEFORE)).toBe(true);
    expect(isFrozen(MAINNET, "3", BEFORE)).toBe(true);
    expect(isFrozen(MAINNET, "4", BEFORE)).toBe(false);
    // Ids as the contract writes them: "01" is no token, not #1.
    expect(isFrozen(TESTNET, "01", BEFORE)).toBe(false);
  });

  it("ends at 2026-11-25T00:00:00Z", () => {
    expect(isFrozen(TESTNET, "4", new Date("2026-11-24T23:59:59.999Z"))).toBe(true);
    expect(isFrozen(TESTNET, "4", new Date("2026-11-25T00:00:00Z"))).toBe(false);
    expect(isFrozen(MAINNET, "1", new Date("2026-12-01T00:00:00Z"))).toBe(false);
    expect(FROZEN_NOTE).toBe(
      "Demo satchel: through judging (until 2026-11-25) this app turns off the owner's buttons and the buy button on this satchel, to keep the state the README quotes for it.",
    );
  });
});
