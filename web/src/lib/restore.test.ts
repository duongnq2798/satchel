import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RESTORE_TIMEOUT_MS, fromSameWallet, restoreAccount } from "./restore";

/** A wallet that answers only when the test says so, like a locked extension. */
function pending() {
  let resolve!: (id: string | null) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<string | null>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { read: () => promise, resolve, reject };
}

describe("restoreAccount", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("passes on the account a wallet names in time, once", async () => {
    const answers: (string | null)[] = [];
    restoreAccount(() => Promise.resolve("alice.near"), (id) => answers.push(id));
    await vi.advanceTimersByTimeAsync(RESTORE_TIMEOUT_MS * 2);
    expect(answers).toEqual(["alice.near"]);
  });

  it("treats a wallet that throws as no account", async () => {
    const answers: (string | null)[] = [];
    restoreAccount(() => Promise.reject(new Error("no wallet")), (id) => answers.push(id));
    await vi.advanceTimersByTimeAsync(RESTORE_TIMEOUT_MS * 2);
    expect(answers).toEqual([null]);
  });

  it("offers Connect wallet when a locked wallet doesn't answer, then takes its account once unlocked", async () => {
    const wallet = pending();
    const answers: (string | null)[] = [];
    restoreAccount(wallet.read, (id) => answers.push(id));
    await vi.advanceTimersByTimeAsync(RESTORE_TIMEOUT_MS - 1);
    expect(answers).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(answers).toEqual([null]);
    wallet.resolve("satchel-nft.near");
    await vi.advanceTimersByTimeAsync(0);
    expect(answers).toEqual([null, "satchel-nft.near"]);
  });

  it("drops a late answer of no account, which could undo a sign-in made meanwhile", async () => {
    const wallet = pending();
    const answers: (string | null)[] = [];
    restoreAccount(wallet.read, (id) => answers.push(id));
    await vi.advanceTimersByTimeAsync(RESTORE_TIMEOUT_MS);
    wallet.reject(new Error("locked"));
    await vi.advanceTimersByTimeAsync(0);
    expect(answers).toEqual([null]);
  });

  it("says nothing once stopped, as when the page switches network", async () => {
    const wallet = pending();
    const answers: (string | null)[] = [];
    const stop = restoreAccount(wallet.read, (id) => answers.push(id));
    stop();
    await vi.advanceTimersByTimeAsync(RESTORE_TIMEOUT_MS);
    wallet.resolve("alice.near");
    await vi.advanceTimersByTimeAsync(0);
    expect(answers).toEqual([]);
  });
});

describe("fromSameWallet", () => {
  it("passes on the account when the saved wallet stayed the same", async () => {
    await expect(fromSameWallet(() => "meteor-wallet", async () => "alice.near")).resolves.toBe("alice.near");
  });

  it("drops the old wallet's account once another wallet was saved meanwhile", async () => {
    let saved = "meteor-wallet";
    const wallet = pending();
    const answer = fromSameWallet(() => saved, wallet.read);
    // The user picked another wallet, then refused in it: near-connect keeps the new one saved.
    saved = "intear-wallet";
    wallet.resolve("satchel-nft.near");
    await expect(answer).resolves.toBeNull();
  });
});
