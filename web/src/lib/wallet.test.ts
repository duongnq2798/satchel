import { TESTNET } from "satchel-nft";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserRejected, WalletUnsure } from "./errors";
import { runTx, savedWallet } from "./wallet";

/** What the mocked wallet's signAndSendTransaction rejects with, per test. */
const refusal: { value: unknown } = { value: undefined };

vi.mock("@hot-labs/near-connect", () => ({
  NearConnector: class {
    async wallet() {
      return { signAndSendTransaction: () => Promise.reject(refusal.value) };
    }
  },
}));

describe("savedWallet", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads the wallet near-connect saved for the network", () => {
    vi.stubGlobal("window", { localStorage: { getItem: (key: string) => (key === "satchel:testnet:selected-wallet" ? "meteor" : null) } });
    expect(savedWallet(TESTNET)).toBe("meteor");
  });

  it("is null where site data is blocked and the getter throws", () => {
    const blocked = {};
    Object.defineProperty(blocked, "localStorage", {
      get() {
        throw new DOMException("Failed to read the 'localStorage' property from 'Window'", "SecurityError");
      },
    });
    vi.stubGlobal("window", blocked);
    expect(savedWallet(TESTNET)).toBeNull();
  });
});

describe("runTx at the wallet boundary", () => {
  const tx = { receiverId: TESTNET.contract, actions: [] };

  it.each([
    ["no reason", undefined],
    ["null", null],
    ["a refusal", new Error("User rejected the request")],
  ])("reads %s as the wallet closing", async (_, value) => {
    refusal.value = value;
    await expect(runTx(TESTNET, tx, "alice.testnet")).rejects.toBeInstanceOf(UserRejected);
  });

  it("reads any other wallet error as unsure, since it may have sent", async () => {
    refusal.value = new Error("Failed to fetch");
    const error = await runTx(TESTNET, tx, "alice.testnet").catch((err: unknown) => err);
    expect(error).toBeInstanceOf(WalletUnsure);
    expect((error as WalletUnsure).cause).toBe(refusal.value);
  });
});
