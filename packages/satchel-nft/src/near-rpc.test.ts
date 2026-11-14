import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Cassette, cassetteOf, loadFixture, replayRpc } from "./__fixtures__/replay.js";
import { MAINNET, NEAR_ARCHIVAL_RPC, TESTNET, isAccountId as configIsAccountId } from "./config.js";
import { decodeBase64 as nearDecodeBase64, encodeArgs as nearEncodeArgs, nearRpc, rpcFor, viewErrorMessage } from "./near.js";
import {
  ENDPOINTS,
  READ_METHODS,
  READ_QUERY_TYPES,
  ReadOnlyError,
  ReadTxError,
  RpcError,
  type RpcCall,
  type TxStatusView,
  ViewError,
  blockAt,
  decodeBase64,
  encodeArgs,
  fastnearSenderLookup,
  functionCalls,
  httpGetJson,
  httpRpc,
  isAccountId,
  parsePermission,
  pinnedReader,
  readOnlyRpc,
  readTx,
  receiptsOf,
  redactUrl,
  withFallback,
} from "./near-rpc.js";

// Transport tests use a fake fetch and say so. Everything about what a node answers comes from the
// cassettes in __fixtures__/primitives, recorded from mainnet and testnet by
// scripts/capture-primitive-fixtures.mjs; a test that needs a broken answer changes a deep copy and
// says what it changed.

const INTENTS = loadFixture("primitives/near-rpc/intents-keys-paged.json");
const VIEWS = loadFixture("primitives/near-rpc/views-mainnet.json");
const EZLX = loadFixture<{ provenance: Cassette["provenance"]; result: TxStatusView }>("primitives/chain-signatures/tx-EZLX.json");
const DAO_VOTE = loadFixture<TxStatusView>("dao-vote-outcome.json");
const MAINNET_DEPLOY = JSON.parse(readFileSync(new URL("../../../deployments/mainnet.json", import.meta.url), "utf8")) as {
  contract: string;
  parent_account: string;
  code_hash: string;
};

type Recorded = Cassette["calls"][number];
const params = (c: Recorded) => c.params as Record<string, unknown>;
const copy = <T>(value: T): T => structuredClone(value);
const pinnedAt = (cassette: Cassette) => cassette.provenance.block?.hash as string;

/** The recorded calls of `cassette` that match `where`. */
function calls(cassette: Cassette, where: (c: Recorded) => boolean): Recorded[] {
  return cassette.calls.filter(where);
}

// ---- A fake fetch, for the transport tests only ------------------------------------------------

type Reply = { status?: number; body?: unknown; text?: string; headers?: Record<string, string> } | Error | "hang";

function fakeFetch(replies: Reply[]) {
  const seen: { url: string; init: RequestInit }[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    seen.push({ url: String(url), init });
    const reply = replies[Math.min(seen.length - 1, replies.length - 1)];
    if (reply instanceof Error) throw reply;
    if (reply === "hang") {
      return new Promise<Response>((_, reject) =>
        init.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError"))),
      );
    }
    return new Response(reply.text ?? JSON.stringify(reply.body), { status: reply.status ?? 200, headers: reply.headers });
  });
  return Object.assign(fn as unknown as typeof fetch, { seen });
}

const ok = (result: unknown): Reply => ({ body: { jsonrpc: "2.0", id: "satchel", result } });
const URL_A = "https://rpc.example.org";

/** Runs `start` under fake timers until it settles, and returns how it settled. */
async function settle<T>(start: () => Promise<T>): Promise<{ value?: T; error?: unknown }> {
  vi.useFakeTimers();
  try {
    const out: { value?: T; error?: unknown } = {};
    const promise = start().then(
      (value) => {
        out.value = value;
      },
      (error) => {
        out.error = error;
      },
    );
    await vi.runAllTimersAsync();
    await promise;
    return out;
  } finally {
    vi.useRealTimers();
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("httpRpc (transport, fake fetch)", () => {
  it("sends the body nearRpc sends, byte for byte", async () => {
    const bodies: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      bodies.push(String(init?.body));
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: "satchel", result: {} }));
    });
    const query = { request_type: "view_account", block_id: "abc", account_id: "a.near" };
    await nearRpc(MAINNET, "query", query);
    const fetch = fakeFetch([ok({})]);
    await httpRpc(MAINNET.nearRpc, { fetch })("query", query);
    expect(fetch.seen[0].init.body).toBe(bodies[0]);
    expect(fetch.seen[0].init.method).toBe("POST");
  });

  it("retries HTTP 408, 429, 500, 502, 503 and 504, then returns the answer", async () => {
    for (const status of [408, 429, 500, 502, 503, 504]) {
      const fetch = fakeFetch([{ status, text: "busy" }, { status, text: "busy" }, ok({ chain_id: "mainnet" })]);
      const { value } = await settle(() => httpRpc(URL_A, { fetch })<{ chain_id: string }>("status", []));
      expect(value?.chain_id).toBe("mainnet");
      expect(fetch.seen.length).toBe(3);
    }
  });

  it("retries a fetch that failed with no answer", async () => {
    const fetch = fakeFetch([new TypeError("fetch failed"), ok(1)]);
    expect((await settle(() => httpRpc(URL_A, { fetch })("status", []))).value).toBe(1);
    expect(fetch.seen.length).toBe(2);
  });

  it("gives up on its own timeout after 5 tries, with near.ts's wording", async () => {
    const fetch = fakeFetch(["hang"]);
    const { error } = await settle(() => httpRpc(URL_A, { fetch, timeoutMs: 2_000 })("status", []));
    expect(error).toBeInstanceOf(RpcError);
    expect(error).toMatchObject({ kind: "timeout", tries: 5, method: "status", endpoint: URL_A, status: null });
    expect((error as Error).message).toBe(`NEAR RPC status failed at ${URL_A}: no answer in 2 s`);
    expect(fetch.seen.length).toBe(5);
  });

  it("words the timeout as rpcFor does (near.ts:171), for the same timeoutMs", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url, init) =>
        new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason))),
    );
    const theirs = await rpcFor(MAINNET, 30)("status", []).catch((err: Error) => err.message);
    const ours = await httpRpc(URL_A, { timeoutMs: 30, retries: 0, fetch: globalThis.fetch })("status", []).catch(
      (err: RpcError) => err.detail,
    );
    expect(theirs).toBe(`NEAR RPC status failed: ${ours}`);
  });

  it("never retries a JSON-RPC error: it is an answer", async () => {
    const error = { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_ACCOUNT", info: {} }, code: -32000 };
    const fetch = fakeFetch([{ body: { jsonrpc: "2.0", id: "satchel", error } }]);
    const err = await httpRpc(URL_A, { fetch })("query", {}).catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: "rpc-error", data: error, tries: 1, status: 200 });
    expect((err as Error).message).toBe(`NEAR RPC query failed at ${URL_A}: ${JSON.stringify(error)}`);
    expect(fetch.seen.length).toBe(1);
  });

  it("reads a JSON-RPC error a node sends with HTTP 422, as nodes do for an unknown block", async () => {
    const error = { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_BLOCK", info: {} }, code: -32000 };
    const fetch = fakeFetch([{ status: 422, body: { jsonrpc: "2.0", id: "satchel", error } }]);
    const err = await httpRpc(URL_A, { fetch })("block", { block_id: 1 }).catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: "rpc-error", status: 422, data: error });
    expect(fetch.seen.length).toBe(1);
  });

  it("fails at once on any other HTTP error", async () => {
    const fetch = fakeFetch([{ status: 404, text: "not found" }]);
    const err = await httpRpc(URL_A, { fetch })("status", []).catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: "http", status: 404, tries: 1 });
    expect((err as Error).message).toBe(`NEAR RPC status failed at ${URL_A}: HTTP 404`);
  });

  it("names rate limiting after the last 429 or 503, and says HTTP for the other statuses", async () => {
    for (const status of [429, 503]) {
      const fetch = fakeFetch([{ status, text: "slow down" }]);
      const { error } = await settle(() => httpRpc(URL_A, { fetch })("status", []));
      expect(error).toMatchObject({ kind: "rate-limited", status, tries: 5 });
      expect((error as Error).message).toBe(`NEAR RPC status failed at ${URL_A}: transport: rate-limited (HTTP ${status}) after 5 tries`);
    }
    const fetch = fakeFetch([{ status: 502, text: "bad gateway" }]);
    const { error } = await settle(() => httpRpc(URL_A, { fetch, retries: 2 })("status", []));
    expect(error).toMatchObject({ kind: "http", status: 502, tries: 3 });
    expect((error as Error).message).toBe(`NEAR RPC status failed at ${URL_A}: HTTP 502`);
  });

  it("waits for Retry-After up to maxRetryAfterMs", async () => {
    vi.useFakeTimers();
    const fetch = fakeFetch([{ status: 429, text: "", headers: { "retry-after": "20" } }, ok("done")]);
    const promise = httpRpc(URL_A, { fetch })("status", []);
    await vi.advanceTimersByTimeAsync(7_999);
    expect(fetch.seen.length).toBe(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(fetch.seen.length).toBe(2);
    expect(await promise).toBe("done");
  });

  it("fails at once when Retry-After asks for more than giveUpRetryAfterMs", async () => {
    const fetch = fakeFetch([{ status: 429, text: "", headers: { "retry-after": "329" } }, ok("never")]);
    const err = await httpRpc(URL_A, { fetch })("status", []).catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: "rate-limited", status: 429, tries: 1 });
    expect(fetch.seen.length).toBe(1);
  });

  it("calls a 200 answer that is not a JSON-RPC result a bad answer, without retrying", async () => {
    for (const reply of [{ text: "<html>gateway</html>" }, { body: { jsonrpc: "2.0", id: "satchel" } }]) {
      const fetch = fakeFetch([reply]);
      const err = await httpRpc(URL_A, { fetch })("status", []).catch((e: unknown) => e);
      expect(err).toMatchObject({ kind: "bad-answer", tries: 1 });
      expect(fetch.seen.length).toBe(1);
    }
  });

  it("keeps at most `concurrency` requests in flight", async () => {
    let inFlight = 0;
    let most = 0;
    const release: (() => void)[] = [];
    const slowFetch = (async () => {
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise<void>((resolve) => release.push(resolve));
      inFlight--;
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: "satchel", result: 1 }));
    }) as unknown as typeof globalThis.fetch;
    const rpc = httpRpc(URL_A, { fetch: slowFetch, concurrency: 2 });
    const all = Promise.all([1, 2, 3, 4, 5].map(() => rpc("status", [])));
    for (let i = 0; i < 20 && (release.length > 0 || inFlight > 0); i++) {
      await new Promise((r) => setTimeout(r, 1));
      release.shift()?.();
    }
    expect(await all).toEqual([1, 1, 1, 1, 1]);
    expect(most).toBe(2);
  });

  it("sends headers, such as an API key, and never shows them or the path in errors", async () => {
    const fetch = fakeFetch([{ status: 401, text: "no" }]);
    const err = await httpRpc("https://rpc.example.org/v1/secret-path", { fetch, headers: { Authorization: "Bearer k-123" } })(
      "status",
      [],
    ).catch((e: Error) => e);
    expect((fetch.seen[0].init.headers as Record<string, string>).Authorization).toBe("Bearer k-123");
    expect((err as RpcError).endpoint).toBe("https://rpc.example.org");
    expect(JSON.stringify({ ...(err as object), message: (err as Error).message })).not.toMatch(/k-123|secret-path/);
  });

  it("refuses, when built, a header fetch would refuse, naming the header but not its value, and no request leaves", () => {
    const fetch = fakeFetch([ok("never")]);
    const builds = [
      (headers: Record<string, string>) => httpRpc(URL_A, { fetch, headers }),
      (headers: Record<string, string>) => httpGetJson(`${URL_A}/v1/account/a.near/nft`, { fetch, headers }),
      (headers: Record<string, string>) => fastnearSenderLookup(ENDPOINTS.testnet.txApi, { fetch, headers }),
    ];
    for (const build of builds) {
      let err: unknown = null;
      try {
        build({ Authorization: "Bearer SECRETKEY\nX-Injected: 1" });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(TypeError);
      expect((err as Error).message).toContain("Authorization");
      expect((err as Error).message).not.toMatch(/SECRETKEY|Injected/);
      expect(() => build({ "bad header": "x" })).toThrow("a header name fetch refuses was given in headers");
    }
    expect(fetch.seen).toEqual([]);
  });

  it("refuses a URL it cannot parse without repeating it", () => {
    let err: unknown = null;
    try {
      httpRpc("rpc.example.org/SECRETPATH");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TypeError);
    expect((err as Error).message).not.toContain("SECRETPATH");
  });

  it("refuses a URL with credentials or a query string", () => {
    const text =
      'httpRpc takes a URL without credentials or a query string; send an API key as headers: { Authorization: "Bearer <key>" }';
    for (const url of ["https://rpc.mainnet.fastnear.com/?apiKey=abc", "https://user:pw@rpc.example.org", "https://rpc.example.org?"]) {
      expect(() => httpRpc(url)).toThrow(TypeError);
      expect(() => httpRpc(url)).toThrow(text);
      expect(() => httpGetJson(url)).toThrow(text);
    }
  });

  it("redacts a URL to its origin", () => {
    expect(redactUrl("https://archival-rpc.mainnet.fastnear.com/some/path#x")).toBe("https://archival-rpc.mainnet.fastnear.com");
    expect(redactUrl("http://127.0.0.1:3030/")).toBe("http://127.0.0.1:3030");
  });
});

describe("httpGetJson and fastnearSenderLookup (transport, fake fetch)", () => {
  it("GETs JSON with the same retries", async () => {
    const fetch = fakeFetch([{ status: 503, text: "" }, { body: { tokens: [] } }]);
    const { value } = await settle(() => httpGetJson<{ tokens: unknown[] }>("https://api.fastnear.com/v1/account/a.near/nft", { fetch }));
    expect(value).toEqual({ tokens: [] });
    expect(fetch.seen.map((s) => s.init.method ?? "GET")).toEqual(["GET", "GET"]);
  });

  it("names the method and origin in its errors, never the path, which can hold a key", async () => {
    const fetch = fakeFetch([{ status: 404, text: "no" }]);
    const err = (await httpGetJson("https://api.example.org/SECRETPATHKEY/v1/account/a.near/nft", { fetch }).then(
      () => null,
      (e: unknown) => e,
    )) as RpcError;
    expect(err).toBeInstanceOf(RpcError);
    expect(err).toMatchObject({ method: "GET", endpoint: "https://api.example.org" });
    expect(`${err.message} ${JSON.stringify(err)}`).not.toContain("SECRETPATHKEY");
    expect(fetch.seen[0].url).toBe("https://api.example.org/SECRETPATHKEY/v1/account/a.near/nft");
  });

  it("asks FastNEAR's transaction index for the signer, as dao.ts does, and returns null when it has none", async () => {
    const fetch = fakeFetch([{ body: { transactions: [{ transaction: { signer_id: "satchel-nft.testnet" } }] } }, { body: { transactions: [null] } }]);
    const lookup = fastnearSenderLookup(ENDPOINTS.testnet.txApi, { fetch });
    expect(await lookup("EZLX")).toBe("satchel-nft.testnet");
    expect(await lookup("nothing")).toBeNull();
    expect(fetch.seen[0].url).toBe("https://tx.test.fastnear.com/v0/transactions");
    expect(JSON.parse(String(fetch.seen[0].init.body))).toEqual({ tx_hashes: ["EZLX"] });
  });
});

describe("withFallback", () => {
  const failing = (kind: RpcError["kind"]): RpcCall =>
    (async (method: string) => {
      throw new RpcError({ method, kind, endpoint: URL_A, detail: kind });
    }) as RpcCall;
  const answering: RpcCall = (async () => "fallback") as RpcCall;

  it("calls the fallback once on a transport failure", async () => {
    for (const kind of ["timeout", "http", "rate-limited", "network"] as const) {
      expect(await withFallback(failing(kind), answering)("status", [])).toBe("fallback");
    }
  });

  it("passes on an answer: a JSON-RPC error or a bad answer", async () => {
    for (const kind of ["rpc-error", "bad-answer"] as const) {
      await expect(withFallback(failing(kind), answering)("status", [])).rejects.toMatchObject({ kind });
    }
  });
});

describe("readOnlyRpc", () => {
  it("refuses every method that is not a read, before calling the node", async () => {
    const inner = vi.fn(async () => "sent");
    const rpc = readOnlyRpc(inner as unknown as RpcCall);
    for (const method of ["broadcast_tx_commit", "broadcast_tx_async", "send_tx", "sandbox_patch_state", "tx"]) {
      await expect(rpc(method, ["AAAA"])).rejects.toBeInstanceOf(ReadOnlyError);
    }
    await expect(rpc("query", { request_type: "change_everything", account_id: "a.near", finality: "final" })).rejects.toMatchObject({
      name: "ReadOnlyError",
      method: "query",
    });
    await expect(rpc("query", ["access_key/a.near"])).rejects.toBeInstanceOf(ReadOnlyError);
    expect(inner).not.toHaveBeenCalled();
  });

  it("passes the reads", async () => {
    const inner = vi.fn(async () => "read");
    const rpc = readOnlyRpc(inner as unknown as RpcCall);
    expect(await rpc("query", { request_type: "call_function", finality: "final", account_id: "a.near", method_name: "m", args_base64: "" })).toBe(
      "read",
    );
    for (const type of READ_QUERY_TYPES) await rpc("query", { request_type: type, finality: "final", account_id: "a.near" });
    for (const method of READ_METHODS.filter((m) => m !== "query")) await rpc(method, {});
    expect(inner).toHaveBeenCalledTimes(1 + READ_QUERY_TYPES.length + READ_METHODS.length - 1);
  });
});

describe("blockAt and pinnedReader, on recorded mainnet answers", () => {
  const hash = pinnedAt(VIEWS);

  it("pins the block a hash names, with its parent and time", async () => {
    const block = await blockAt(replayRpc(VIEWS), { blockHash: hash });
    const recorded = calls(VIEWS, (c) => c.method === "block")[0].result as {
      header: { height: number; hash: string; prev_hash: string; timestamp_nanosec: string };
    };
    expect(block).toEqual({
      height: recorded.header.height,
      hash,
      prevHash: recorded.header.prev_hash,
      timestampNs: recorded.header.timestamp_nanosec,
      timestamp: new Date(Number(BigInt(recorded.header.timestamp_nanosec) / 1_000_000n)).toISOString(),
    });
    expect(block.height).toBe(VIEWS.provenance.block?.height);
  });

  it("refuses a block answer about another block than the one asked", async () => {
    // Changed in this test: the recorded block answer's hash, as a node answering about another block would.
    const mutated = copy(VIEWS);
    const block = calls(mutated, (c) => c.method === "block")[0].result as { header: { hash: string } };
    block.header.hash = "11111111111111111111111111111111";
    await expect(blockAt(replayRpc(mutated), { blockHash: hash })).rejects.toMatchObject({ kind: "bad-answer" });
  });

  it("refuses a query answered at another block, or with no block hash", async () => {
    const account = MAINNET_DEPLOY.contract;
    // Changed in this test: the view_account answer's block_hash, first to another hash, then removed.
    const other = copy(VIEWS);
    const answer = (c: Cassette) =>
      calls(c, (x) => params(x).request_type === "view_account" && params(x).account_id === account)[0].result as Record<string, unknown>;
    answer(other).block_hash = "11111111111111111111111111111111";
    const reader = await pinnedReader(replayRpc(other), { blockHash: hash });
    const err = await reader.account(account).catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: "bad-answer" });
    expect((err as Error).message).toContain(`answered at block 11111111111111111111111111111111, not ${hash}`);

    const missing = copy(VIEWS);
    delete answer(missing).block_hash;
    const strict = await pinnedReader(replayRpc(missing), { blockHash: hash });
    await expect(strict.account(account)).rejects.toThrow("answered without a block hash");
    const lenient = await pinnedReader(replayRpc(missing), { blockHash: hash }, { strictBlock: false });
    expect((await lenient.account(account))?.code_hash).toBe(MAINNET_DEPLOY.code_hash);
  });

  it("reads an account, and null for one that does not exist", async () => {
    const reader = await pinnedReader(replayRpc(VIEWS), { blockHash: hash });
    const account = await reader.account(MAINNET_DEPLOY.contract);
    expect(account?.code_hash).toBe(MAINNET_DEPLOY.code_hash);
    expect(typeof account?.amount).toBe("string");
    expect(await reader.account(`missing.${MAINNET_DEPLOY.contract}`)).toBeNull();
  });

  it("decodes a view's JSON", async () => {
    const reader = await pinnedReader(replayRpc(VIEWS), { blockHash: hash });
    expect(await reader.view(MAINNET_DEPLOY.contract, "mpc_contract")).toBe("v1.signer");
  });

  it("turns each recorded contract-side failure into a ViewError of its kind", async () => {
    const reader = await pinnedReader(replayRpc(VIEWS), { blockHash: hash });
    const viewOf = async (account: string, method: string, args: unknown = {}) =>
      reader.view(account, method, args).then(
        () => null,
        (e: unknown) => e,
      );
    const panic = await viewOf(MAINNET_DEPLOY.contract, "evm_signing_hash");
    expect(panic).toBeInstanceOf(ViewError);
    expect(panic).toMatchObject({ kind: "panic", account: MAINNET_DEPLOY.contract, method: "evm_signing_hash" });
    expect((panic as Error).message).toMatch(/^Failed to deserialize input from JSON/);
    expect(await viewOf(MAINNET_DEPLOY.contract, "no_such_view")).toMatchObject({ kind: "method-not-found" });
    expect(await viewOf(MAINNET_DEPLOY.parent_account, "mpc_contract")).toMatchObject({ kind: "no-code" });
    const missing = await viewOf(`missing.${MAINNET_DEPLOY.contract}`, "mpc_contract");
    expect(missing).toMatchObject({ kind: "account-missing" });
    expect((missing as Error).cause).toBeInstanceOf(RpcError);
  });

  it("gives viewErrorMessage's text (near.ts:138-141) for every result.error in the cassettes", async () => {
    let checked = 0;
    for (const cassette of [VIEWS, INTENTS]) {
      const reader = await pinnedReader(replayRpc(cassette), { blockHash: pinnedAt(cassette) });
      for (const c of calls(cassette, (x) => params(x).request_type === "call_function")) {
        const error = (c.result as { error?: unknown } | undefined)?.error;
        if (typeof error !== "string") continue;
        const p = params(c);
        const args = JSON.parse(decodeBase64(p.args_base64 as string));
        const err = await reader.view(p.account_id as string, p.method_name as string, args).catch((e: Error) => e);
        expect((err as Error).message).toBe(viewErrorMessage(p.method_name as string, error));
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(3);
  });

  it("reads one access key, and null for a missing key or a missing account", async () => {
    const reader = await pinnedReader(replayRpc(VIEWS), { blockHash: hash });
    const listed = await reader.accessKeys(MAINNET_DEPLOY.parent_account);
    expect(listed.keys.length).toBeGreaterThan(0);
    const key = await reader.accessKey(MAINNET_DEPLOY.parent_account, listed.keys[0].publicKey);
    expect(key).toEqual(listed.keys[0]);
    expect(key?.permission).toEqual({ kind: "full-access" });
    expect(await reader.accessKey(MAINNET_DEPLOY.parent_account, "ed25519:11111111111111111111111111111111")).toBeNull();
    expect(await reader.accessKey(`missing.${MAINNET_DEPLOY.contract}`, "ed25519:11111111111111111111111111111111")).toBeNull();
  });

  it("also reads null from an UNKNOWN_ACCESS_KEY or UNKNOWN_ACCOUNT error, as near.ts:225-246 does", async () => {
    // Written here, not recorded: the recorded 2.14.1 nodes answer a missing key as `result.error`
    // ("… does not exist while viewing"); near.ts also takes these two JSON-RPC errors as "no key".
    const replay = replayRpc(VIEWS);
    for (const name of ["UNKNOWN_ACCESS_KEY", "UNKNOWN_ACCOUNT"]) {
      const node = (async (method: string, p: unknown) => {
        if ((p as Record<string, unknown>).request_type !== "view_access_key") return replay(method, p);
        throw new RpcError({ method, kind: "rpc-error", endpoint: URL_A, detail: name, data: { name: "HANDLER_ERROR", cause: { name, info: { block_hash: hash } } } });
      }) as RpcCall;
      const reader = await pinnedReader(node, { blockHash: hash });
      expect(await reader.accessKey(MAINNET_DEPLOY.parent_account, "ed25519:11111111111111111111111111111111")).toBeNull();
    }
    const other = (async (method: string, p: unknown) => {
      if ((p as Record<string, unknown>).request_type !== "view_access_key") return replay(method, p);
      throw new RpcError({ method, kind: "rpc-error", endpoint: URL_A, detail: "x", data: { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_BLOCK" } } });
    }) as RpcCall;
    const reader = await pinnedReader(other, { blockHash: hash });
    await expect(reader.accessKey(MAINNET_DEPLOY.parent_account, "ed25519:11111111111111111111111111111111")).rejects.toBeInstanceOf(RpcError);
  });

  it("holds an error it reads as an answer to the pinned block, as it holds a result (in-test changes to the recorded errors)", async () => {
    // The recorded UNKNOWN_ACCOUNT (missing.v1.satchel-nft.near) and NO_CONTRACT_CODE (satchel-nft.near)
    // errors name the pinned block in cause.info.block_hash. Each copy changes or deletes that hash.
    const missingAccount = `missing.${MAINNET_DEPLOY.contract}`;
    const errorsOf = (cassette: Cassette) => cassette.calls.filter((c) => c.error !== undefined) as (Recorded & { error: { cause: { name: string; info: Record<string, unknown> } } })[];
    expect(errorsOf(VIEWS).map((c) => [c.error.cause.name, c.error.cause.info.block_hash])).toEqual([
      ["UNKNOWN_ACCOUNT", hash],
      ["UNKNOWN_ACCOUNT", hash],
      ["NO_CONTRACT_CODE", hash],
    ]);
    const changed = (change: (info: Record<string, unknown>) => void) => {
      const cassette = copy(VIEWS);
      for (const c of errorsOf(cassette)) change(c.error.cause.info);
      return cassette;
    };
    const other = changed((info) => {
      info.block_hash = "11111111111111111111111111111111";
    });
    const none = changed((info) => {
      delete info.block_hash;
    });
    const reads = (reader: Awaited<ReturnType<typeof pinnedReader>>) => [
      () => reader.account(missingAccount),
      () => reader.codeSha256(MAINNET_DEPLOY.parent_account),
      () => reader.view(missingAccount, "mpc_contract"),
    ];
    // About another block: refused, strict or not, as a result about another block is.
    for (const strictBlock of [true, false]) {
      for (const read of reads(await pinnedReader(replayRpc(other), { blockHash: hash }, { strictBlock }))) {
        const err = await read().then(
          () => null,
          (e: unknown) => e,
        );
        expect(err).toBeInstanceOf(RpcError);
        expect(err).toMatchObject({ kind: "bad-answer", detail: `answered at block 11111111111111111111111111111111, not ${hash}` });
        expect((err as RpcError).cause).toBeInstanceOf(RpcError);
      }
    }
    // Naming no block: refused when strict; read as before when not.
    for (const read of reads(await pinnedReader(replayRpc(none), { blockHash: hash }))) {
      await expect(read()).rejects.toMatchObject({ kind: "bad-answer", detail: "answered without a block hash" });
    }
    const lenient = await pinnedReader(replayRpc(none), { blockHash: hash }, { strictBlock: false });
    expect(await lenient.account(missingAccount)).toBeNull();
    expect(await lenient.codeSha256(MAINNET_DEPLOY.parent_account)).toBeNull();
    await expect(lenient.view(missingAccount, "mpc_contract")).rejects.toMatchObject({ kind: "account-missing" });
    // An error the reader does not read as an answer is passed on unchanged, whatever block it names.
    const replay = replayRpc(VIEWS);
    const unknownBlock = (async (method: string, p: unknown) => {
      if (method !== "query") return replay(method, p);
      throw new RpcError({ method, kind: "rpc-error", endpoint: URL_A, detail: "x", data: { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_BLOCK", info: {} } } });
    }) as RpcCall;
    const passOn = await pinnedReader(unknownBlock, { blockHash: hash });
    await expect(passOn.account(missingAccount)).rejects.toMatchObject({ kind: "rpc-error", detail: "x" });
  });

  it("lists no key on the locked contract, and no code on an account without any", async () => {
    const reader = await pinnedReader(replayRpc(VIEWS), { blockHash: hash });
    expect(await reader.accessKeys(MAINNET_DEPLOY.contract)).toEqual({ keys: [], pages: 1, paged: true });
    expect(await reader.codeSha256(MAINNET_DEPLOY.parent_account)).toBeNull();
  });

  it("uses every call it recorded", async () => {
    const rpc = replayRpc(VIEWS);
    const reader = await pinnedReader(rpc, { blockHash: hash });
    await reader.account(MAINNET_DEPLOY.contract);
    await reader.account(`missing.${MAINNET_DEPLOY.contract}`);
    await reader.view(MAINNET_DEPLOY.contract, "mpc_contract");
    for (const [account, method] of [
      [MAINNET_DEPLOY.contract, "evm_signing_hash"],
      [MAINNET_DEPLOY.contract, "no_such_view"],
      [MAINNET_DEPLOY.parent_account, "mpc_contract"],
      [`missing.${MAINNET_DEPLOY.contract}`, "mpc_contract"],
    ]) {
      await reader.view(account, method).catch(() => {});
    }
    const listed = await reader.accessKeys(MAINNET_DEPLOY.parent_account);
    await reader.accessKey(MAINNET_DEPLOY.parent_account, listed.keys[0].publicKey);
    await reader.accessKey(MAINNET_DEPLOY.parent_account, "ed25519:11111111111111111111111111111111");
    await reader.accessKey(`missing.${MAINNET_DEPLOY.contract}`, "ed25519:11111111111111111111111111111111");
    await reader.accessKeys(MAINNET_DEPLOY.contract);
    await reader.codeSha256(MAINNET_DEPLOY.parent_account);
    expect(rpc.unused()).toEqual([]);
  });

  it("never reaches the network: an unrecorded call throws", async () => {
    const reader = await pinnedReader(replayRpc(VIEWS), { blockHash: hash });
    await expect(reader.view(MAINNET_DEPLOY.contract, "not_recorded_here")).rejects.toThrow(/^replay: no recorded answer for query/);
  });
});

describe("accessKeys paging, on intents.near's key list recorded with limit 2", () => {
  const hash = pinnedAt(INTENTS);
  const unpaged = calls(INTENTS, (c) => params(c).request_type === "view_access_key_list" && params(c).limit === undefined)[0]
    .result as { keys: { public_key: string; access_key: { nonce: number; permission: unknown } }[]; last_key?: string };
  const pagedCalls = calls(INTENTS, (c) => params(c).limit === 2);

  it("was recorded on a node that pages (nearcore 2.14 or later), over several real pages", () => {
    expect(INTENTS.provenance.notes).toBe("paged");
    expect(INTENTS.provenance.nodeVersion).toMatch(/^2\.(1[4-9]|[2-9]\d)\./);
    expect(pagedCalls.filter((c) => (c.result as { last_key?: string }).last_key).length).toBeGreaterThanOrEqual(2);
    expect(unpaged.last_key).toBeUndefined();
  });

  it("chains last_key over the real pages to the end, and gets the unpaged list", async () => {
    const rpc = replayRpc(INTENTS);
    const reader = await pinnedReader(rpc, { blockHash: hash });
    const listed = await reader.accessKeys("intents.near", { pageSize: 2 });
    expect(listed.paged).toBe(true);
    expect(listed.pages).toBe(Math.ceil(unpaged.keys.length / 2));
    expect(new Set(listed.keys.map((k) => k.publicKey))).toEqual(new Set(unpaged.keys.map((k) => k.public_key)));
    expect(listed.keys.length).toBe(unpaged.keys.length);
    // The real page after the last key (recorded too) and the unpaged list are the calls not needed here.
    expect(rpc.unused().length).toBe(2);
  });

  it("stops on an empty page, for a node that always sends last_key", async () => {
    // Changed in this test: the last real page and the real, recorded empty page after it both get a
    // last_key (the last key), as a node that always sends one would. Only the empty page ends it.
    const mutated = copy(INTENTS);
    const pageEnds = calls(mutated, (c) => params(c).limit === 2 && !(c.result as { last_key?: string }).last_key);
    const lastPage = pageEnds.filter((c) => (c.result as { keys: unknown[] }).keys.length > 0)[0].result as {
      keys: { public_key: string }[];
      last_key?: string;
    };
    const emptyPage = pageEnds.filter((c) => (c.result as { keys: unknown[] }).keys.length === 0)[0].result as { last_key?: string };
    lastPage.last_key = lastPage.keys[lastPage.keys.length - 1].public_key;
    emptyPage.last_key = lastPage.last_key;
    const reader = await pinnedReader(replayRpc(mutated), { blockHash: hash });
    const listed = await reader.accessKeys("intents.near", { pageSize: 2 });
    expect(listed.keys.length).toBe(unpaged.keys.length);
    expect(listed.pages).toBe(Math.ceil(unpaged.keys.length / 2) + 1);
  });

  it("refuses paging that repeats a key, or does not advance", async () => {
    // Changed in this test: the second page repeats the first page's first key.
    const repeated = copy(INTENTS);
    const page = (c: Cassette, i: number) =>
      calls(c, (x) => canonical(x.params) === canonical(pagedCalls[i].params))[0].result as {
        keys: { public_key: string }[];
        last_key?: string;
      };
    page(repeated, 1).keys[0] = copy(page(repeated, 0).keys[0]);
    expect(pagedCalls.length).toBeGreaterThan(2);
    let reader = await pinnedReader(replayRpc(repeated), { blockHash: hash });
    await expect(reader.accessKeys("intents.near", { pageSize: 2 })).rejects.toThrow("paging repeated a key");

    // Changed in this test: the second page answers the first page's last_key again.
    const stuck = copy(INTENTS);
    page(stuck, 1).last_key = page(stuck, 0).last_key;
    reader = await pinnedReader(replayRpc(stuck), { blockHash: hash });
    await expect(reader.accessKeys("intents.near", { pageSize: 2 })).rejects.toThrow("paging did not advance");
  });

  it("stops past `max` keys", async () => {
    const reader = await pinnedReader(replayRpc(INTENTS), { blockHash: hash });
    await expect(reader.accessKeys("intents.near", { pageSize: 2, max: 3 })).rejects.toMatchObject({
      kind: "bad-answer",
      message: expect.stringContaining("more than 3 keys"),
    });
  });

  it("falls back to one unpaged call on a node older than 2.14", async () => {
    // Changed in this test: the first paged call fails as a node that does not know `limit` would;
    // the error is written here, not recorded. The unpaged answer is the recorded one.
    const replay = replayRpc(INTENTS);
    const older = (async (method: string, p: unknown) => {
      const q = p as Record<string, unknown>;
      if (q.request_type === "view_access_key_list" && q.limit !== undefined) {
        throw new RpcError({
          method,
          kind: "rpc-error",
          endpoint: URL_A,
          detail: "unknown field",
          data: { name: "REQUEST_VALIDATION_ERROR", cause: { name: "PARSE_ERROR", info: { error_message: "unknown field `limit`" } } },
        });
      }
      return replay(method, p);
    }) as RpcCall;
    const reader = await pinnedReader(older, { blockHash: hash });
    const listed = await reader.accessKeys("intents.near", { pageSize: 2 });
    expect(listed).toMatchObject({ paged: false, pages: 1 });
    expect(listed.keys.length).toBe(unpaged.keys.length);
  });

  it("parses the recorded permissions", async () => {
    const reader = await pinnedReader(replayRpc(INTENTS), { blockHash: hash });
    const listed = await reader.accessKeys("intents.near", { pageSize: 2 });
    for (const key of listed.keys) {
      const raw = unpaged.keys.find((k) => k.public_key === key.publicKey)?.access_key;
      expect(key.nonce).toBe(String(raw?.nonce));
      const fc = (raw?.permission as { FunctionCall: { receiver_id: string; method_names: string[]; allowance: string | null } }).FunctionCall;
      expect(key.permission).toEqual({ kind: "function-call", receiverId: fc.receiver_id, methodNames: fc.method_names, allowance: fc.allowance });
    }
  });
});

describe("parsePermission", () => {
  it("parses full access and function-call keys", () => {
    expect(parsePermission("FullAccess")).toEqual({ kind: "full-access" });
    expect(parsePermission({ FunctionCall: { allowance: "1", receiver_id: "a.near", method_names: [] } })).toEqual({
      kind: "function-call",
      receiverId: "a.near",
      methodNames: [],
      allowance: "1",
    });
  });

  it("parses gas keys (Experimental: shapes written here, after nearcore 2.14.0's views.rs, none recorded yet)", () => {
    const fc = { balance: "5", num_nonces: 4, allowance: null, receiver_id: "a.near", method_names: ["m"] };
    expect(parsePermission({ GasKeyFunctionCall: fc })).toEqual({
      kind: "gas-key-function-call",
      receiverId: "a.near",
      methodNames: ["m"],
      raw: { GasKeyFunctionCall: fc },
    });
    // near-kit's tuple form: GasKeyFunctionCall(GasKeyInfo, FunctionCallPermission).
    const tuple = { GasKeyFunctionCall: [{ balance: "5", num_nonces: 4 }, { FunctionCall: { receiver_id: "b.near", method_names: [] } }] };
    expect(parsePermission(tuple)).toMatchObject({ kind: "gas-key-function-call", receiverId: "b.near", methodNames: [] });
    expect(parsePermission({ GasKeyFunctionCall: { balance: "5", num_nonces: 4 } })).toMatchObject({ receiverId: null, methodNames: null });
    expect(parsePermission({ GasKeyFullAccess: { balance: "5", num_nonces: 4 } })).toEqual({
      kind: "gas-key-full-access",
      raw: { GasKeyFullAccess: { balance: "5", num_nonces: 4 } },
    });
    expect(parsePermission("GasKeyFullAccess")).toEqual({ kind: "gas-key-full-access", raw: "GasKeyFullAccess" });
  });

  it("gives `unknown` for anything else", () => {
    for (const raw of [null, 3, "Owner", { FullAccess: {}, FunctionCall: {} }, { FunctionCall: { receiver_id: 1 } }, { NewThing: {} }]) {
      expect(parsePermission(raw)).toEqual({ kind: "unknown", raw });
    }
  });
});

describe("readTx, on testnet's recorded EZLX… (the owner's direct sign_evm)", () => {
  const hash = EZLX.result.transaction.hash;
  const sender = (EZLX.provenance.params as { sender_account_id: string }).sender_account_id;

  it("reads the transaction with the sender given or looked up", async () => {
    const rpc = replayRpc(cassetteOf(EZLX));
    expect(await readTx(rpc, hash, { sender })).toEqual(EZLX.result);
    expect(await readTx(rpc, hash, { senderLookup: async () => sender })).toEqual(EZLX.result);
    expect(rpc.unused()).toEqual([]);
  });

  it("tries the archival node once when the first node throws", async () => {
    // Written here, not recorded: a first node that has dropped the transaction.
    const dropped = (async (method: string) => {
      throw new RpcError({ method, kind: "rpc-error", endpoint: URL_A, detail: "UNKNOWN_TRANSACTION", data: { name: "HANDLER_ERROR" } });
    }) as RpcCall;
    expect(await readTx(dropped, hash, { sender, archival: replayRpc(cassetteOf(EZLX)) })).toEqual(EZLX.result);
    await expect(readTx(dropped, hash, { sender })).rejects.toBeInstanceOf(RpcError);
  });

  it("refuses an answer about another transaction", async () => {
    // Changed in this test: the recorded answer replayed for another hash.
    const other = "11111111111111111111111111111111";
    const mutated = copy(cassetteOf(EZLX));
    (mutated.calls[0].params as Record<string, unknown>).tx_hash = other;
    const err = await readTx(replayRpc(mutated), other, { sender }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReadTxError);
    expect(err).toMatchObject({ code: "wrong-tx", hash: other });
  });

  it("needs a sender, and says when the lookup failed", async () => {
    const rpc = replayRpc(cassetteOf(EZLX));
    await expect(readTx(rpc, hash)).rejects.toMatchObject({ code: "no-sender" });
    await expect(readTx(rpc, hash, { senderLookup: async () => null })).rejects.toMatchObject({ code: "no-sender" });
    const broken = new Error("index down");
    const err = await readTx(rpc, hash, {
      senderLookup: async () => {
        throw broken;
      },
    }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "sender-lookup" });
    expect((err as Error).cause).toBe(broken);
  });
});

describe("receiptsOf and functionCalls", () => {
  it("joins every outcome of the full EZLX answer with its receipt and block", () => {
    const receipts = receiptsOf(EZLX.result);
    expect(receipts.map((r) => r.receiptId)).toEqual(EZLX.result.receipts_outcome.map((o) => o.id));
    for (const r of receipts) expect(typeof r.blockHash).toBe("string");
    const first = receipts[0];
    expect(first).toMatchObject({ executorId: "v1.satchel-nft.testnet", predecessorId: signerOf(EZLX.result), receiverId: "v1.satchel-nft.testnet" });
    expect(functionCalls(first).map((c) => c.method)).toEqual(["sign_evm"]);
    const sign = receipts.find((r) => r.receiverId === "v1.signer-prod.testnet" && functionCalls(r).some((c) => c.method === "sign"));
    expect(sign?.predecessorId).toBe("v1.satchel-nft.testnet");
    expect(sign?.next.length).toBeGreaterThan(0);
    const [call] = functionCalls(sign as NonNullable<typeof sign>);
    expect(JSON.parse(decodeBase64(call.argsBase64)).request.path).toBe("satchel/1");
    expect(call.deposit).toMatch(/^\d+$/);
    expect(call.gas).toMatch(/^\d+$/);
  });

  it("reads the trimmed DAO vote, which has no block hashes and no receipt ids", () => {
    const receipts = receiptsOf(DAO_VOTE);
    expect(receipts.length).toBe(DAO_VOTE.receipts_outcome.length);
    const sign = receipts.find((r) => r.receiptId.startsWith("FWa3axK2"));
    expect(sign).toMatchObject({ blockHash: null, executorId: "v1.signer-prod.testnet", predecessorId: "v1.satchel-nft.testnet", next: [] });
    expect(functionCalls(sign as NonNullable<typeof sign>)[0]).toMatchObject({ method: "sign", deposit: "1" });
    const callback = receipts.find((r) => r.receiptId.startsWith("5Y8LFFZm"));
    expect(functionCalls(callback as NonNullable<typeof callback>)[0].method).toBe("return_signature_and_clean_state_on_success");
    // A refund from `system` is a Transfer: no function call.
    expect(functionCalls(receipts.find((r) => r.predecessorId === "system") as NonNullable<(typeof receipts)[number]>)).toEqual([]);
  });

  it("gives no actions and null ends for an outcome with no receipt", () => {
    // Changed in this test: the receipts list is dropped, as in a trimmed fixture.
    const trimmed = { ...copy(DAO_VOTE), receipts: undefined };
    for (const r of receiptsOf(trimmed)) expect(r).toMatchObject({ actions: [], predecessorId: null, receiverId: null });
  });
});

describe("parity with near.ts and config.ts", () => {
  /** Every account id and every base64 value in the fixtures this file reads. */
  function harvest() {
    const ids = new Set<string>();
    const base64 = new Set<string>();
    const walk = (value: unknown, key = "") => {
      if (typeof value === "string") {
        if (/(_id|^account_id|^signer_id|^receiver_id|^predecessor_id|^executor_id)$/.test(key)) ids.add(value);
        if (key === "args" || key === "args_base64" || key === "SuccessValue") base64.add(value);
      } else if (Array.isArray(value)) value.forEach((v) => walk(v, key));
      else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, k);
    };
    for (const f of [INTENTS, VIEWS, EZLX, DAO_VOTE]) walk(f);
    return { ids: [...ids], base64: [...base64] };
  }

  it("decodes and encodes arguments as near.ts does", () => {
    const { base64 } = harvest();
    expect(base64.length).toBeGreaterThan(10);
    for (const value of base64) {
      expect(decodeBase64(value)).toBe(nearDecodeBase64(value));
      const text = decodeBase64(value);
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        continue;
      }
      expect(encodeArgs(json)).toBe(nearEncodeArgs(json));
    }
    for (const args of [{}, { token_id: "1" }, { s: "é ✓ 🙂" }, [1, 2], null]) expect(encodeArgs(args)).toBe(nearEncodeArgs(args));
  });

  it("takes the account ids config.ts takes", () => {
    const { ids } = harvest();
    const invalid = ["Alice.testnet", "a", "﻿alice.testnet", "alice..testnet", "alice-.testnet", "Holder.testnet", "", "a".repeat(65), "-a.near", "a_.near", "a b.near"];
    expect(ids.length).toBeGreaterThan(5);
    for (const id of [...ids, ...invalid]) expect(isAccountId(id)).toBe(configIsAccountId(id));
    for (const id of invalid) expect(isAccountId(id)).toBe(false);
  });

  it("points at config.ts's nodes, and at NEAR's archival nodes as AGENTS.md names them", () => {
    for (const net of [MAINNET, TESTNET]) {
      const e = ENDPOINTS[net.id];
      expect([e.rpc, e.archival, e.txApi]).toEqual([net.nearRpc, NEAR_ARCHIVAL_RPC[net.id], net.txApi]);
      expect(e.nearArchival).toBe(`https://archival-rpc.${net.id}.near.org`);
    }
    const agents = readFileSync(new URL("../../../AGENTS.md", import.meta.url), "utf8");
    expect(agents).toContain("https://archival-rpc.<network>.near.org");
  });
});

/** Keys sorted, as the replay matches calls. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function signerOf(tx: TxStatusView): string {
  return tx.transaction.signer_id;
}
