import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "./__fixtures__/history-7.json" with { type: "json" };
import { MAINNET, TESTNET } from "./config.js";
import { type IndexedTx, describeEntry, eventsIn, signatureCounts, tokenHistory } from "./history.js";
import type { SigningRecord } from "./near.js";

// Satchel #7's transactions on testnet, as FastNEAR's index returned them: its mint, a send on
// Sepolia, a listing and its delisting, the sale, the hand-back, and a buy that failed.
const TXS = fixture.transactions as IndexedTx[];
const SALE = "BcrTmMCqdYGdCXDHH4fZqUHCy8bYdnUXLx3JS94jKUHX";
const DELIST = "2g9KsqmKVQGiSNSJMGkMo7WpdxakVji8BkRPg7ZnBBAL";

const of = (hash: string) => TXS.find((t) => t.transaction.hash === hash) as IndexedTx;

describe("eventsIn", () => {
  it("reads satchel #7's life from the contract's events", () => {
    const entries = TXS.flatMap((tx) => eventsIn(TESTNET, tx, "7")).sort((a, b) => a.block - b.block);
    expect(entries.map((e) => e.kind)).toEqual(["mint", "sign_evm", "list", "delist", "sale", "transfer"]);
    expect(entries.map(describeEntry)).toEqual([
      "minted to satchel-nft.testnet",
      "satchel-nft.testnet had a send of 0.0001 ETH to 0x000000000000000000000000000000000000dEaD signed on Sepolia, nonce 0",
      "satchel-nft.testnet listed it for 0.5 NEAR",
      "satchel-nft.testnet delisted it",
      "satchel-nft.testnet sold it to buyer.satchel-nft.testnet for 0.5 NEAR",
      "buyer.satchel-nft.testnet gave it to satchel-nft.testnet",
    ]);
    expect(entries[0]).toMatchObject({ tx: "FyT2ELA2jigMegAiVnMVAm3C4ESiVRiMSDJ6CQMBokTh", caller: "satchel-nft.testnet" });
    expect(new Date(entries[0].at).toISOString()).toMatch(/^2026-11-09T15:0/);
  });

  it("shows a sale once, not also as the nft_transfer it logs", () => {
    expect(eventsIn(TESTNET, of(SALE), "7").map((e) => e.kind)).toEqual(["sale"]);
  });

  it("keeps only another token's events out", () => {
    expect(TXS.flatMap((tx) => eventsIn(TESTNET, tx, "1"))).toEqual([]);
    expect(TXS.flatMap((tx) => eventsIn(TESTNET, tx, "70"))).toEqual([]);
  });

  it("ignores a failed receipt, another contract's logs, and the other network's contract", () => {
    const delist = of(DELIST);
    const rolledBack = structuredClone(delist);
    for (const r of rolledBack.receipts) r.execution_outcome.outcome.status = { Failure: { ActionError: {} } };
    expect(eventsIn(TESTNET, rolledBack, "7")).toEqual([]);

    const forged = structuredClone(delist);
    for (const r of forged.receipts) r.execution_outcome.outcome.executor_id = "evil.testnet";
    expect(eventsIn(TESTNET, forged, "7")).toEqual([]);

    expect(eventsIn(MAINNET, delist, "7")).toEqual([]);
    expect(eventsIn(TESTNET, delist, "7").map((e) => e.kind)).toEqual(["delist"]);
  });

  it("skips malformed events instead of failing", () => {
    const tx = structuredClone(of(DELIST));
    const outcome = tx.receipts.find((r) => r.execution_outcome.outcome.logs.length)?.execution_outcome.outcome;
    if (!outcome) throw new Error("the fixture's delist has no log");
    outcome.logs = [
      "EVENT_JSON:{not json",
      'EVENT_JSON:{"standard":"satchel","event":"list","data":[{"token_id":"7","price":"1e24"}]}',
      'EVENT_JSON:{"standard":"satchel","event":"sale","data":[{"token_id":"7","seller":"a","buyer":"b"}]}',
      'EVENT_JSON:{"standard":"satchel","event":"delist","data":{"token_id":"7"}}',
      "plain log",
    ];
    expect(eventsIn(TESTNET, tx, "7")).toEqual([]);
  });
});

describe("tokenHistory", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** An index holding TXS, two account transactions a page, that also counts `extra` it never pages to. */
  function index(extra = 0) {
    const calls: { path: string; body: Record<string, unknown> }[] = [];
    const hashes = TXS.map((t) => t.transaction.hash);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { body: string }) => {
        const path = new URL(url).pathname;
        const body = JSON.parse(init.body);
        calls.push({ path, body });
        if (path === "/v0/account") {
          const from = body.resume_token ? Number(body.resume_token) : 0;
          const page = hashes.slice(from, from + 2).map((transaction_hash) => ({ transaction_hash }));
          const next = from + 2 < hashes.length ? { resume_token: String(from + 2) } : {};
          return Response.json({ account_txs: page, txs_count: hashes.length + extra, ...next });
        }
        if (body.tx_hashes.length > 20) return new Response("too many", { status: 400 });
        return Response.json({ transactions: TXS.filter((t) => body.tx_hashes.includes(t.transaction.hash)) });
      }),
    );
    return calls;
  }

  it("pages through the contract's transactions and keeps the token's events, oldest first", async () => {
    const calls = index();
    const history = await tokenHistory(TESTNET, "7");
    expect(history.entries.map((e) => e.kind)).toEqual(["mint", "sign_evm", "list", "delist", "sale", "transfer"]);
    expect(history).toMatchObject({ scanned: TXS.length, complete: true, source: "https://tx.test.fastnear.com" });
    expect(calls.filter((c) => c.path === "/v0/account").every((c) => c.body.account_id === "v1.satchel-nft.testnet")).toBe(true);
  });

  it("says when it stopped before the oldest transactions", async () => {
    index();
    const history = await tokenHistory(TESTNET, "7", 4);
    expect(history).toMatchObject({ scanned: 4, complete: false });
    index(5);
    expect(await tokenHistory(TESTNET, "7")).toMatchObject({ scanned: TXS.length, complete: false });
  });

  it("fails loudly when the index does", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("down", { status: 503 })),
    );
    await expect(tokenHistory(TESTNET, "7")).rejects.toThrow(/tx.test.fastnear.com\/v0\/account answered 503/);
  });
});

describe("signatureCounts", () => {
  it("compares the signatures the history shows with the record's count", () => {
    const record = { evm: [{ chain_id: "11155111", max_nonce: "0", signatures: 1 }], opaque_signatures: 1 } as SigningRecord;
    const entries = TXS.flatMap((tx) => eventsIn(TESTNET, tx, "7"));
    expect(signatureCounts({ entries, scanned: 7, complete: true, source: "" }, record)).toEqual({ history: 1, record: 2 });
  });
});
