import { afterEach, describe, expect, it, vi } from "vitest";
import { MAINNET, TESTNET } from "./config.js";
import { INDEX_TRIES, indexPost, retryAfter } from "./tx-index.js";

/** An index that gives each answer in turn, then the last one again, and the waits asked for between sends. */
function answers(...replies: (() => Response | Promise<Response>)[]) {
  const fetch = vi.fn(async () => (replies.length > 1 ? replies.shift() : replies[0])?.() as Response);
  vi.stubGlobal("fetch", fetch);
  const waits: number[] = [];
  const wait = async (ms: number) => {
    waits.push(ms);
  };
  return { fetch, waits, wait };
}

const ok = () => Response.json({ txs_count: 7 });
const status = (code: number, headers?: Record<string, string>) => () => new Response("no", { status: code, headers });
const unreachable = () => Promise.reject(new TypeError("Failed to fetch"));

describe("indexPost", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends a rate-limited or failed request again, after a random wait that doubles", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const { fetch, waits, wait } = answers(status(429), status(503), status(408), unreachable, ok);
    await expect(indexPost(MAINNET, "/v0/account", { account_id: "a" }, wait)).resolves.toEqual({ txs_count: 7 });
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(fetch.mock.calls[0]).toEqual(["https://tx.main.fastnear.com/v0/account", expect.objectContaining({ method: "POST" })]);
    expect(waits).toEqual([250, 500, 1000, 2000]);
  });

  it("waits for the index's Retry-After instead, up to 8 s", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const { waits, wait } = answers(status(429, { "retry-after": "3" }), status(429, { "retry-after": "120" }), ok);
    await indexPost(TESTNET, "/v0/account", {}, wait);
    expect(waits).toEqual([3000, 8000]);
  });

  it(`gives up after ${INDEX_TRIES} sends and says what each one got`, async () => {
    const { fetch, waits, wait } = answers(status(429));
    await expect(indexPost(MAINNET, "/v0/account", {}, wait)).rejects.toThrow(
      "https://tx.main.fastnear.com/v0/account failed 5 sends in a row: 429 each time. The index limits how often it is asked: try again in a minute.",
    );
    expect(fetch).toHaveBeenCalledTimes(INDEX_TRIES);
    expect(waits).toHaveLength(INDEX_TRIES - 1);
    // Each wait stays under its cap: 0.5 s, then 1, 2 and 4 s.
    waits.forEach((ms, i) => expect(ms).toBeLessThan(500 * 2 ** i));

    answers(status(502));
    await expect(indexPost(MAINNET, "/v0/account", {}, wait)).rejects.toThrow(/v0\/account failed 5 sends in a row: 502 each time\.$/);

    // Sends that got different things are each named, and one 429 is enough for the hint.
    answers(status(503), status(429), unreachable, status(408), status(502));
    await expect(indexPost(MAINNET, "/v0/account", {}, wait)).rejects.toThrow(
      "failed 5 sends in a row: 503, 429, no answer (Failed to fetch), 408, 502. The index limits how often it is asked: try again in a minute.",
    );
  });

  it("names the network failure when the index never answered, as a browser sees its 429", async () => {
    const { fetch, wait } = answers(unreachable);
    const failed = indexPost(MAINNET, "/v0/transactions", {}, wait);
    await expect(failed).rejects.toThrow(
      "https://tx.main.fastnear.com/v0/transactions failed 5 sends in a row: no answer (Failed to fetch) each time. In a browser, the index's rate limit looks the same: try again in a minute.",
    );
    await expect(failed).rejects.toHaveProperty("cause", expect.any(TypeError));
    expect(fetch).toHaveBeenCalledTimes(INDEX_TRIES);

    // Firefox's message ends in a full stop, which isn't doubled.
    answers(() => Promise.reject(new TypeError("NetworkError when attempting to fetch resource.")), status(503));
    await expect(indexPost(MAINNET, "/v0/transactions", {}, wait)).rejects.toThrow(
      /: no answer \(NetworkError when attempting to fetch resource\), 503, 503, 503, 503\. In a browser, the index's rate limit looks the same/,
    );
  });

  it("doesn't send again what the index refused for good, or what timed out", async () => {
    const refused = answers(status(400));
    await expect(indexPost(TESTNET, "/v0/transactions", {}, refused.wait)).rejects.toThrow(
      /^https:\/\/tx\.test\.fastnear\.com\/v0\/transactions answered 400$/,
    );
    expect(refused.fetch).toHaveBeenCalledTimes(1);

    const slow = answers(() => Promise.reject(new DOMException("The operation was aborted due to timeout", "TimeoutError")));
    await expect(indexPost(TESTNET, "/v0/transactions", {}, slow.wait)).rejects.toThrow(/timeout/);
    expect(slow.fetch).toHaveBeenCalledTimes(1);
    expect(slow.waits).toEqual([]);
  });
});

describe("retryAfter", () => {
  const after = (value?: string) => retryAfter(new Response(null, value === undefined ? {} : { headers: { "retry-after": value } }), 0);

  it("reads seconds or a date, never more than 8 s or less than none", () => {
    expect(after("2")).toBe(2000);
    expect(after(" 0 ")).toBe(0);
    expect(after("3600")).toBe(8000);
    expect(after(new Date(5000).toUTCString())).toBe(5000);
    expect(retryAfter(new Response(null, { headers: { "retry-after": new Date(0).toUTCString() } }), 60_000)).toBe(0);
  });

  it("has nothing to say without a header it can read", () => {
    expect(after()).toBeUndefined();
    expect(after("")).toBeUndefined();
    expect(after("soon")).toBeUndefined();
  });
});
