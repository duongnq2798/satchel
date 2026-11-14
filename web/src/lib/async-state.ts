/** What `useAsync` keeps between renders: the last settled run's result, and how often each key was reloaded. */
export interface RunState<T> {
  data: T | undefined;
  /** The settled run's error. */
  error: unknown;
  /** The last failure, kept until a run succeeds. */
  lastError: unknown;
  /** Token of the run whose result is in state. */
  done: string | null;
  identity: string | undefined;
  /** reload() count for the current key. */
  asks: { key: string; n: number } | null;
}

export const EMPTY: RunState<never> = { data: undefined, error: null, lastError: null, done: null, identity: undefined, asks: null };

const asksFor = (s: RunState<unknown>, key: string) => (s.asks?.key === key ? s.asks.n : 0);

/** The run token for `key`: `${n}:${key}`, n = reloads of this key; `first` when n is 0. */
export function tokenFor(s: RunState<unknown>, key: string): { token: string; first: boolean } {
  const n = asksFor(s, key);
  return { token: `${n}:${key}`, first: n === 0 };
}

/** reload(): the next token for `key`. */
export function ask<T>(s: RunState<T>, key: string): RunState<T> {
  return { ...s, asks: { key, n: asksFor(s, key) + 1 } };
}

/** The state once the run `token` ended with `out`: a failure keeps the data of the same identity. */
export function settle<T>(
  s: RunState<T>,
  token: string,
  identity: string | undefined,
  out: { ok: true; value: T } | { ok: false; error: unknown },
  initial: T | undefined,
): RunState<T> {
  if (out.ok) return { ...s, data: out.value, error: null, lastError: null, done: token, identity };
  const data = (identity === s.identity ? s.data : undefined) ?? initial;
  return { ...s, data, error: out.error, lastError: out.error, done: token, identity };
}

/** What the page shows for `key`: the settled run, `initial` before any read, or a load that keeps what it may. */
export function viewOf<T>(
  s: RunState<T>,
  key: string,
  identity: string | undefined,
  initial: T | undefined,
): { data: T | undefined; error: unknown; lastError: unknown; loading: boolean } {
  const { token, first } = tokenFor(s, key);
  if (s.done === token) return { data: s.data, error: s.error, lastError: s.lastError, loading: false };
  if (first && initial !== undefined) return { data: initial, error: null, lastError: null, loading: false };
  const same = identity === s.identity;
  return { data: (same ? s.data : undefined) ?? initial, error: null, lastError: same ? s.lastError : null, loading: true };
}
