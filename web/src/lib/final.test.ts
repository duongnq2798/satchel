import { describe, expect, it } from "vitest";
import type { ExecutionOutcome, RpcCall } from "satchel-nft";
import { PendingTx, UserRejected } from "./errors";
import { followUp, waitFinal } from "./final";

const HASH = "8Xh1";
const outcome = (status: ExecutionOutcome["status"]): ExecutionOutcome => ({ transaction: { hash: HASH }, status });
const FINISHED = outcome({ SuccessValue: "" });
const STARTED = outcome("Started");

/** An RpcCall that answers each attempt from `answers` in turn (an Error is thrown), and logs what it was asked. */
function node(answers: (ExecutionOutcome | Error)[]) {
  const asked: { method: string; params: unknown }[] = [];
  const call = (async (method: string, params: unknown) => {
    asked.push({ method, params });
    const next = answers[Math.min(asked.length - 1, answers.length - 1)];
    if (next instanceof Error) throw next;
    return next;
  }) as RpcCall;
  return { call, asked };
}

/** A sleep that returns at once and logs each pause. */
function clock() {
  const pauses: number[] = [];
  return { pauses, sleep: async (ms: number) => void pauses.push(ms) };
}

describe("waitFinal", () => {
  it("returns at the first finished outcome, asking for FINAL as the signer", async () => {
    const { call, asked } = node([STARTED, FINISHED, STARTED]);
    const { sleep } = clock();
    await expect(waitFinal(call, HASH, "alice.testnet", { sleep })).resolves.toBe(FINISHED);
    expect(asked).toHaveLength(2);
    expect(asked[0]).toEqual({ method: "tx", params: { tx_hash: HASH, sender_account_id: "alice.testnet", wait_until: "FINAL" } });
  });

  it("counts a call that throws as one attempt", async () => {
    const { call, asked } = node([new Error("no answer in 10 s"), FINISHED]);
    const { sleep } = clock();
    await expect(waitFinal(call, HASH, "alice.testnet", { sleep })).resolves.toBe(FINISHED);
    expect(asked).toHaveLength(2);
  });

  it("throws PendingTx with the hash and the last failure after `attempts`", async () => {
    const last = new Error("NEAR RPC tx failed: no answer in 10 s");
    const { call, asked } = node([STARTED, last]);
    const { sleep } = clock();
    const err = await waitFinal(call, HASH, "alice.testnet", { attempts: 3, sleep }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PendingTx);
    expect((err as PendingTx).hash).toBe(HASH);
    expect((err as PendingTx).cause).toBe(last);
    expect(asked).toHaveLength(3);
  });

  it("pauses `pause` between attempts, not after the last", async () => {
    const { call } = node([STARTED]);
    const { sleep, pauses } = clock();
    await waitFinal(call, HASH, "alice.testnet", { attempts: 3, pause: 2_000, sleep }).catch(() => {});
    expect(pauses).toEqual([2_000, 2_000]);
  });

  it("tries 30 times by default, as finalOutcome does", async () => {
    const { call, asked } = node([STARTED]);
    const { sleep, pauses } = clock();
    await expect(waitFinal(call, HASH, "alice.testnet", { sleep })).rejects.toBeInstanceOf(PendingTx);
    expect(asked).toHaveLength(30);
    expect(new Set(pauses)).toEqual(new Set([2_000]));
  });
});

describe("followUp", () => {
  it.each([
    ["no error: refresh", true, null, "refresh"],
    ["a pending tx: nothing yet", true, new PendingTx(HASH), "none"],
    ["a cancel in the wallet: recheck", true, new UserRejected("tx"), "recheck"],
    ["any error after the wallet: recheck", true, new Error("Satchel: listed"), "recheck"],
    ["an error before the wallet: nothing", false, new Error("Enter a price"), "none"],
  ] as const)("%s", (_, reached, error, next) => {
    expect(followUp(reached, error)).toBe(next);
  });
});
