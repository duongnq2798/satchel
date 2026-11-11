import type { Network } from "./config.js";

/** Sends to FastNEAR's transaction index, the first one included, before a read gives up. */
export const INDEX_TRIES = 5;
/** The longest wait between two sends, in ms, whatever the index's Retry-After asks for. */
const MAX_WAIT = 8_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * POSTs `body` to `path` on `net`'s FastNEAR transaction index and returns the JSON it answers.
 *
 * The index limits how often it is asked: on 2026-11-11 `tx.main.fastnear.com` answered 429 to
 * about half the requests, at one every 5 s. So a 408, a 429 or a 5xx is sent again, up to
 * INDEX_TRIES sends in all, as FastNEAR's own client does. Before each new send it waits a random
 * time of up to 0.5 s, then up to 1, 2 and 4 s, or the Retry-After the index sent, up to 8 s.
 * A send that got no answer at all is sent again too: the index's 429 had no CORS headers, and a
 * browser can't read such an answer, so fetch only fails, as it does when the network is down.
 * A send that timed out isn't: it has already waited 20 s.
 *
 * `wait` is for tests, which don't sleep.
 */
export async function indexPost<T>(net: Network, path: string, body: unknown, wait = sleep): Promise<T> {
  const url = `${net.txApi}${path}`;
  // What each send got: a status, or `no answer (<the fetch error>)`.
  const seen: string[] = [];
  for (let tries = 1; ; tries++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") throw err;
      seen.push(`no answer (${(err instanceof Error ? err.message : String(err)).replace(/\.$/, "")})`);
      if (tries >= INDEX_TRIES) throw new Error(gaveUp(url, seen), { cause: err });
      await wait(backoff(tries));
      continue;
    }
    if (res.ok) return (await res.json()) as T;
    const again = res.status === 408 || res.status === 429 || res.status >= 500;
    if (!again) throw new Error(`${url} answered ${res.status}`);
    seen.push(String(res.status));
    if (tries >= INDEX_TRIES) throw new Error(gaveUp(url, seen));
    // Frees the connection; the answer's body isn't read.
    await res.body?.cancel().catch(() => {});
    await wait(retryAfter(res) ?? backoff(tries));
  }
}

/** Says what each of the sends got, and when the index's rate limit may be why, to try again later. */
function gaveUp(url: string, seen: string[]): string {
  const what = seen.every((s) => s === seen[0]) ? `${seen[0]} each time` : seen.join(", ");
  const hint = seen.includes("429")
    ? " The index limits how often it is asked: try again in a minute."
    : seen.some((s) => s.startsWith("no answer"))
      ? " In a browser, the index's rate limit looks the same: try again in a minute."
      : "";
  return `${url} failed ${seen.length} sends in a row: ${what}.${hint}`;
}

/** A random wait before send `tries + 1`: up to 0.5 s after the first send, then twice as long each time. */
function backoff(tries: number): number {
  return Math.random() * Math.min(MAX_WAIT, 500 * 2 ** (tries - 1));
}

/** The index's Retry-After, in seconds or as a date, as ms up to MAX_WAIT; undefined when there is none to read. */
export function retryAfter(res: Response, now = Date.now()): number | undefined {
  const header = res.headers.get("retry-after")?.trim();
  if (!header) return undefined;
  const ms = /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - now;
  return Number.isFinite(ms) ? Math.min(MAX_WAIT, Math.max(0, ms)) : undefined;
}
