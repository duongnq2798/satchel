"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Runs `load` when `key` changes and on `reload()`; a stale result never overwrites a newer one. */
export function useAsync<T>(load: () => Promise<T>, key: string) {
  const [state, setState] = useState<{ data: T | undefined; error: unknown; loading: boolean }>({
    data: undefined,
    error: null,
    loading: true,
  });
  const run = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(() => {
    const id = ++run.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    loadRef.current().then(
      (data) => id === run.current && setState({ data, error: null, loading: false }),
      (error) => id === run.current && setState((s) => ({ ...s, error, loading: false })),
    );
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is what should trigger a reload
  useEffect(reload, [key, reload]);
  return { ...state, reload };
}
