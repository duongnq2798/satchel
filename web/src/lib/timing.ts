import { TimeoutError } from "./errors";

/** When a wait's indicator shows, how long it stays once shown, when it says it is slow, when it gives up (ms). */
export interface Timing {
  showAfter: number;
  minShown: number;
  slowAfter: number;
  timeoutAfter: number;
}

export const TIMING = {
  action: { showAfter: 150, minShown: 400, slowAfter: 3_000, timeoutAfter: Infinity },
  read: { showAfter: 150, minShown: 400, slowAfter: 4_000, timeoutAfter: 15_000 },
  report: { showAfter: 150, minShown: 400, slowAfter: 8_000, timeoutAfter: 45_000 },
  wallet: { showAfter: 0, minShown: 0, slowAfter: 45_000, timeoutAfter: Infinity },
} as const satisfies Record<string, Timing>;

/** What a wait shows: nothing yet, its indicator, the indicator plus why it's slow, or its timeout. */
export type WaitPhase = "hidden" | "shown" | "slow" | "timeout";

/** The phase at `now` of a wait that began at `start` and ended at `end` (null while it runs). */
export function waitPhase(t: Timing, start: number, end: number | null, now: number): WaitPhase {
  if (end !== null) return end - start >= t.showAfter && now < start + t.showAfter + t.minShown ? "shown" : "hidden";
  const elapsed = now - start;
  if (elapsed < t.showAfter) return "hidden";
  if (elapsed >= t.timeoutAfter) return "timeout";
  return elapsed >= t.slowAfter ? "slow" : "shown";
}

/** The first time after `now` at which `waitPhase` changes, or null. */
export function nextChange(t: Timing, start: number, end: number | null, now: number): number | null {
  const marks = end === null ? [t.showAfter, t.slowAfter, t.timeoutAfter] : [t.showAfter + t.minShown];
  const phase = waitPhase(t, start, end, now);
  const ahead = marks.map((m) => start + m).filter((at) => Number.isFinite(at) && at > now);
  for (const at of ahead.sort((a, b) => a - b)) if (waitPhase(t, start, end, at) !== phase) return at;
  return null;
}

/** `work`, or a TimeoutError("No answer from <what> in <s> s.") after `ms`; clears its timer. The work keeps running. */
export function deadline<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  if (!Number.isFinite(ms)) return work;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`No answer from ${what} in ${ms / 1000} s.`)), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}
