/**
 * Runs at most `n` tasks at once; the rest wait their turn. A page of reports would otherwise hit
 * a public RPC with hundreds of requests at once and get rate limited.
 */
export function limiter(n: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  // A finished task hands its slot straight to the next one, so `active` never goes over `n`.
  const release = () => {
    const wake = queue.shift();
    if (wake) wake();
    else active--;
  };
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active < n) active++;
    else await new Promise<void>((resolve) => queue.push(resolve));
    try {
      return await task();
    } finally {
      release();
    }
  };
}
