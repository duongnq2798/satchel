import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimeoutError } from "./errors";
import { TIMING, deadline, nextChange, waitPhase } from "./timing";

describe("waitPhase", () => {
  const read = TIMING.read;

  it("runs hidden, shown, slow, then timeout", () => {
    expect(waitPhase(read, 0, null, 100)).toBe("hidden");
    expect(waitPhase(read, 0, null, 150)).toBe("shown");
    expect(waitPhase(read, 0, null, 4_000)).toBe("slow");
    expect(waitPhase(read, 0, null, 15_000)).toBe("timeout");
  });

  it("never shows a wait that ended before showAfter", () => {
    expect(waitPhase(read, 0, 100, 100)).toBe("hidden");
    expect(waitPhase(read, 0, 100, 600)).toBe("hidden");
  });

  it("holds a shown indicator for minShown", () => {
    expect(waitPhase(read, 0, 200, 549)).toBe("shown");
    expect(waitPhase(read, 0, 200, 550)).toBe("hidden");
    expect(waitPhase(read, 0, 1_000, 1_000)).toBe("hidden");
  });

  it("shows a wallet wait at once, slow at 45 s, and never times it out", () => {
    expect(waitPhase(TIMING.wallet, 0, null, 0)).toBe("shown");
    expect(waitPhase(TIMING.wallet, 0, null, 45_000)).toBe("slow");
    expect(waitPhase(TIMING.wallet, 0, null, 10_000_000)).toBe("slow");
  });
});

describe("nextChange", () => {
  it("steps through each change of a running read, then stops", () => {
    const steps: (number | null)[] = [];
    let now: number | null = 0;
    while (now !== null) {
      now = nextChange(TIMING.read, 0, null, now);
      steps.push(now);
    }
    expect(steps).toEqual([150, 4_000, 15_000, null]);
  });

  it("ends a shown indicator after minShown", () => {
    expect(nextChange(TIMING.read, 0, 200, 200)).toBe(550);
    expect(nextChange(TIMING.read, 0, 100, 100)).toBeNull();
  });
});

describe("deadline", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("rejects with a TimeoutError naming the work at the deadline", async () => {
    const late = deadline(new Promise(() => {}), 2_000, "X");
    const caught = late.catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    const err = await caught;
    expect(err).toBeInstanceOf(TimeoutError);
    expect((err as Error).message).toBe("No answer from X in 2 s.");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resolves when the work wins and leaves no timer", async () => {
    await expect(deadline(Promise.resolve(7), 2_000, "X")).resolves.toBe(7);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("passes the work's own failure on and leaves no timer", async () => {
    await expect(deadline(Promise.reject(new Error("boom")), 2_000, "X")).rejects.toThrow("boom");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("sets no timer for an endless wait", async () => {
    const work = Promise.resolve(1);
    expect(deadline(work, Infinity, "X")).toBe(work);
    expect(vi.getTimerCount()).toBe(0);
  });
});
