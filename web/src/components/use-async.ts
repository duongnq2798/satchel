"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { EMPTY, type RunState, ask, settle, tokenFor, viewOf } from "@/lib/async-state";
import { TIMING, type Timing, type WaitPhase, nextChange, waitPhase } from "@/lib/timing";

export interface AsyncOptions<T> {
  /** A result already known for `key`: shown at once, and no read runs for it until reload(). Read every render. */
  initial?: T;
  /** Data clears when this changes. Without it, a key change keeps data on screen. A new identity needs a new key. */
  identity?: string;
  /** Default TIMING.read. */
  timing?: Timing;
}

export interface Async<T> {
  data: T | undefined;
  error: unknown;
  lastError: unknown;
  /** True in the very render where `key` changes, and through reload(). */
  loading: boolean;
  /** Loading, with data still on screen. */
  refreshing: boolean;
  wait: WaitPhase;
  status: "loading" | "slow" | "timeout" | "success" | "error";
  /** Settles when the next run for this key settles, or on unmount. */
  reload: () => Promise<void>;
}

/**
 * Runs `load` when `key` changes and on `reload()`. A superseded run is aborted and its result dropped;
 * a refresh keeps the data on screen until `identity` changes.
 */
export function useAsync<T>(load: (signal: AbortSignal) => Promise<T>, key: string, options: AsyncOptions<T> = {}): Async<T> {
  const { initial, identity, timing = TIMING.read } = options;
  const [state, setState] = useState<RunState<T>>(EMPTY);
  const { token, first } = tokenFor(state, key);
  const { data, error, lastError, loading } = viewOf(state, key, identity, initial);
  const wait = useWait(loading, timing, token);
  const waiting = useRef<(() => void)[]>([]);

  const run = useEffectEvent(async (token: string, first: boolean, signal: AbortSignal) => {
    if (first && initial !== undefined) return;
    let out: { ok: true; value: T } | { ok: false; error: unknown };
    try {
      out = { ok: true, value: await load(signal) };
    } catch (error) {
      out = { ok: false, error };
    }
    if (signal.aborted) return;
    setState((s) => settle(s, token, identity, out, initial));
    for (const done of waiting.current.splice(0)) done();
  });

  useEffect(() => {
    const controller = new AbortController();
    run(token, first, controller.signal);
    return () => controller.abort();
  }, [token, first]);

  useEffect(
    () => () => {
      for (const done of waiting.current.splice(0)) done();
    },
    [],
  );

  const reload = useCallback(
    () =>
      new Promise<void>((resolve) => {
        waiting.current.push(resolve);
        setState((s) => ask(s, key));
      }),
    [key],
  );

  const status = loading ? (wait === "timeout" || wait === "slow" ? wait : "loading") : error != null ? "error" : "success";
  return { data, error, lastError, loading, refreshing: loading && data !== undefined, wait, status, reload };
}

/**
 * The phase of any wait the caller tracks itself (a busy button, a wallet stage). Default TIMING.action.
 * A new `run` while active starts the clock again, as a reload does.
 */
export function useWait(active: boolean, timing: Timing = TIMING.action, run?: string): WaitPhase {
  const [phase, setPhase] = useState<WaitPhase>("hidden");
  const span = useRef<{ start: number; end: number | null; run?: string } | null>(null);

  useEffect(() => {
    const now = performance.now();
    const was = span.current;
    if (active && (was === null || was.end !== null || was.run !== run)) span.current = { start: now, end: null, run };
    else if (!active && was !== null && was.end === null) span.current = { ...was, end: now };
    const s = span.current;
    if (s === null) return;
    let timer: ReturnType<typeof setTimeout>;
    const sync = () => {
      const at = performance.now();
      setPhase(waitPhase(timing, s.start, s.end, at));
      const next = nextChange(timing, s.start, s.end, at);
      if (next !== null) timer = setTimeout(sync, next - at);
    };
    timer = setTimeout(sync, 0);
    return () => clearTimeout(timer);
  }, [active, timing, run]);

  return phase;
}
