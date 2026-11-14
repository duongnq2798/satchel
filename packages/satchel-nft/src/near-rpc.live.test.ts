import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LIVE, LIVE_ARCHIVAL, live, liveArchival, liveRpc, txProjection } from "./__fixtures__/live.js";
import { type Cassette, loadFixture } from "./__fixtures__/replay.js";
import { ENDPOINTS, RpcError, type TxStatusView, blockAt, fastnearSenderLookup, parsePermission, pinnedReader, readTx } from "./near-rpc.js";

// near-rpc against the real chains, through the public endpoints (each can be pointed elsewhere, see
// __fixtures__/live.ts) and readOnlyRpc. Skipped unless SATCHEL_LIVE=1 (final blocks, regular RPC)
// or SATCHEL_LIVE_ARCHIVAL=1 (historical blocks, archival RPC):
//   SATCHEL_LIVE=1 npm test -w satchel-nft -- near-rpc.live
//   SATCHEL_LIVE_ARCHIVAL=1 npm test -w satchel-nft -- near-rpc.live

const deployment = (file: string) =>
  JSON.parse(readFileSync(new URL(`../../../deployments/${file}`, import.meta.url), "utf8")) as { contract: string; code_hash: string };

describe.skipIf(!LIVE)("near-rpc live, final blocks", () => {
  it("reaches mainnet and testnet at ENDPOINTS' regular nodes", async () => {
    for (const network of ["mainnet", "testnet"] as const) {
      const status = await live(() => liveRpc(network)<{ chain_id: string; version: { version: string } }>("status", []));
      expect(status.chain_id).toBe(network);
      expect(status.version.version).toMatch(/^\d+\.\d+\.\d+/);
    }
  });

  it("pages intents.near's keys with limit 2 to the same set one unpaged call gives, at one final block", async () => {
    const rpc = liveRpc("mainnet");
    const reader = await live(() => pinnedReader(rpc));
    const paged = await live(() => reader.accessKeys("intents.near", { pageSize: 2 }));
    const unpaged = await live(() =>
      rpc<{ keys: { public_key: string }[]; last_key?: string; block_hash: string }>("query", {
        request_type: "view_access_key_list",
        block_id: reader.block.hash,
        account_id: "intents.near",
      }),
    );
    expect(unpaged.block_hash).toBe(reader.block.hash);
    expect(unpaged.last_key).toBeUndefined();
    expect(paged.paged).toBe(true);
    expect(paged.pages).toBeGreaterThan(1);
    expect(new Set(paged.keys.map((k) => k.publicKey))).toEqual(new Set(unpaged.keys.map((k) => k.public_key)));
    expect(paged.keys.length).toBe(unpaged.keys.length);
  });

  it("reads the code hash deployments/mainnet.json and testnet.json record, as view_account says and as sha256 of view_code", async () => {
    for (const [network, file] of [
      ["mainnet", "mainnet.json"],
      ["testnet", "testnet.json"],
    ] as const) {
      const { contract, code_hash } = deployment(file);
      const reader = await live(() => pinnedReader(liveRpc(network)));
      expect((await live(() => reader.account(contract)))?.code_hash).toBe(code_hash);
      const code = await live(() => reader.codeSha256(contract));
      expect(code?.base58).toBe(code_hash);
      expect(code?.bytes).toBeGreaterThan(0);
    }
  });

  it("pins the same block by finality, by hash and by height", async () => {
    const rpc = liveRpc("testnet");
    const final = await live(() => blockAt(rpc, "final"));
    expect(await live(() => blockAt(rpc, { blockHash: final.hash }))).toEqual(final);
    expect(await live(() => blockAt(rpc, { height: final.height }))).toEqual(final);
    expect(final.prevHash).not.toBe(final.hash);
  });
});

describe.skipIf(!LIVE_ARCHIVAL)("near-rpc live, historical blocks", () => {
  const intents = loadFixture("primitives/near-rpc/intents-keys-paged.json");
  const recordedBlock = intents.provenance.block as { height: number; hash: string };

  it("re-reads intents.near's recorded pages at the recorded block, with limit 2", async () => {
    const rpc = liveArchival("mainnet");
    expect((await live(() => blockAt(rpc, { height: recordedBlock.height }))).hash).toBe(recordedBlock.hash);
    const reader = await live(() => pinnedReader(rpc, { blockHash: recordedBlock.hash }));
    const listed = await live(() => reader.accessKeys("intents.near", { pageSize: 2 }));
    const recorded = (intents as Cassette).calls
      .filter((c) => (c.params as { limit?: number }).limit === 2)
      .flatMap((c) => (c.result as { keys: { public_key: string; access_key: { permission: unknown } }[] }).keys)
      .map((k) => ({ publicKey: k.public_key, permission: parsePermission(k.access_key.permission) }));
    expect(listed.keys).toMatchObject(recorded);
    expect(listed.pages).toBe((intents as Cassette).calls.filter((c) => (c.params as { limit?: number }).limit === 2).length - 1);
  });

  const ezlx = loadFixture<{ result: TxStatusView }>("primitives/chain-signatures/tx-EZLX.json");
  const senderLookup = fastnearSenderLookup(ENDPOINTS.testnet.txApi);

  it("re-reads testnet EZLX… through the archival node with every receipt as recorded, its sender from FastNEAR's index", async () => {
    const tx = await live(() => readTx(liveArchival("testnet"), ezlx.result.transaction.hash, { senderLookup }));
    expect(txProjection(tx)).toEqual(txProjection(ezlx.result));
  });

  it("falls back to the archival node when the regular node no longer has EZLX…", async () => {
    // The regular node waits 10 to 30 s for a transaction it has dropped, then answers HTTP 408
    // (TIMEOUT_ERROR, NOT_OBSERVED; seen 2026-11-14). With httpRpc's defaults (10 s, 5 tries) that first
    // read alone can take a minute or more, so this first transport does not retry: its timeout or the
    // 408 is the RpcError that sends readTx to the archival node.
    const regular = liveRpc("testnet", { timeoutMs: 15_000, retries: 0 });
    const hash = ezlx.result.transaction.hash;
    const sender = await live(() => senderLookup(hash));
    expect(sender).toBe(ezlx.result.transaction.signer_id);
    const first = await regular("EXPERIMENTAL_tx_status", { tx_hash: hash, sender_account_id: sender, wait_until: "FINAL" }).then(
      () => null,
      (err: unknown) => err,
    );
    expect(first).toBeInstanceOf(RpcError);
    console.log(`regular node on EZLX…: ${(first as RpcError).kind}: ${(first as RpcError).detail}`);
    const tx = await live(() => readTx(regular, hash, { senderLookup, archival: liveArchival("testnet") }));
    expect(txProjection(tx)).toEqual(txProjection(ezlx.result));
  });
});
