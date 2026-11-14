import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LIVE, LIVE_ARCHIVAL, live, liveArchival, liveRpc, txProjection } from "./__fixtures__/live.js";
import vectors from "./__fixtures__/nep413-near-cli.json" with { type: "json" };
import { type Cassette, loadFixture } from "./__fixtures__/replay.js";
import { ftBalanceAtLeast, nftOwner, sputnikRole, verifyAccountProof } from "./account-proof.js";
import { ENDPOINTS, RpcError, type TxStatusView, fastnearSenderLookup, functionCalls, readTx, receiptsOf } from "./near-rpc.js";

// account-proof against testnet, through the public endpoints (each can be pointed elsewhere, see
// __fixtures__/live.ts) and readOnlyRpc. The two signatures are near-cli-rs's
// (nep413-near-cli.json); nothing here signs or sends. Skipped unless SATCHEL_LIVE=1 (final blocks,
// regular RPC) or SATCHEL_LIVE_ARCHIVAL=1 (the sign_evm receipt block and the recorded cassettes,
// archival RPC):
//   SATCHEL_LIVE=1 npm test -w satchel-nft -- account-proof.live
//   SATCHEL_LIVE_ARCHIVAL=1 npm test -w satchel-nft -- account-proof.live
// The final-block checks assume satchel-nft.testnet and buyer.satchel-nft.testnet keep the keys they
// signed with, and that the buyer keeps testnet satchel #1; if that changes, update the test with the
// date and the reason.

const deployment = (file: string) => JSON.parse(readFileSync(new URL(`../../../deployments/${file}`, import.meta.url), "utf8"));
const CONTRACT = deployment("testnet.json").contract as string;
const E2E = deployment("testnet-e2e.json") as { steps: { tx?: string; tokenId?: string }[] };
const DAO = deployment("testnet-dao.json").dao as string;
const TOKEN = E2E.steps[0].tokenId as string;
const WNEAR = "wrap.testnet";

type Vector = (typeof vectors.vectors)[number];
const [OWNER_BEFORE, BUYER] = vectors.vectors as [Vector, Vector];
const proofOf = (v: Vector) => ({ accountId: v.accountId, publicKey: v.publicKey, signature: v.signature, nonce: v.nonce });
const expectOf = (v: Vector) => ({ recipient: v.recipient, message: v.message });

/** A result that failed on the RPC: rethrown, so rate limiting is reported as such by live(). */
function transportOf<T extends { ok: boolean; cause?: unknown; status?: number }>(result: T): T {
  if (!result.ok && result.status === 502 && result.cause instanceof RpcError) throw result.cause;
  return result;
}

const proof = (v: Vector, rpc: ReturnType<typeof liveRpc>, more: Partial<Parameters<typeof verifyAccountProof>[0]> = {}) =>
  live(async () => transportOf(await verifyAccountProof({ rpc, proof: proofOf(v), expect: expectOf(v), ...more })));

describe.skipIf(!LIVE)("account-proof live, final block on testnet", () => {
  it("accepts satchel-nft.testnet's near-cli-rs signature with no predicate and no freshness: a full-access key", async () => {
    const result = await proof(OWNER_BEFORE, liveRpc("testnet"));
    expect(result).toMatchObject({ ok: true, accountId: OWNER_BEFORE.accountId, publicKey: OWNER_BEFORE.publicKey, permission: { kind: "full-access" } });
    if (result.ok) console.log(`satchel-nft.testnet's key is full access at block ${result.block.height} (${result.block.hash})`);
  });

  it("reads the predicates at the final block: the buyer owns #1, satchel-nft.testnet is in the DAO's council, wrap.testnet balances", async () => {
    const rpc = liveRpc("testnet");
    const owner = await proof(BUYER, rpc, { predicate: nftOwner(CONTRACT, TOKEN) });
    expect(owner).toMatchObject({ ok: true, facts: { token: { token_id: TOKEN, owner_id: BUYER.accountId } } });
    const council = await proof(OWNER_BEFORE, rpc, { predicate: sputnikRole(DAO, "council") });
    expect(council).toMatchObject({ ok: true, facts: { role: "council", kind: "Group" } });
    const notCouncil = await proof(BUYER, rpc, { predicate: sputnikRole(DAO, "council") });
    expect(notCouncil).toMatchObject({ ok: false, status: 403, code: "predicate-refused", predicateCode: "not-in-role" });
    const balance = await proof(BUYER, rpc, { predicate: ftBalanceAtLeast(WNEAR, 0n) });
    expect(balance).toMatchObject({ ok: true, facts: { balance: expect.stringMatching(/^\d+$/) } });
    if (balance.ok) console.log(`buyer.satchel-nft.testnet holds ${(balance.facts as { balance: string }).balance} of ${WNEAR} at block ${balance.block.height}`);
  });
});

describe.skipIf(!LIVE_ARCHIVAL)("account-proof live, the buyer's sign_evm receipt block on testnet", () => {
  it("at the block of the receipt that ran the buyer's sign_evm: the buyer's signature with nftOwner passes, satchel-nft.testnet's is refused", async () => {
    const rpc = liveArchival("testnet");
    const tx = await live(() => readTx(rpc, E2E.steps[5].tx as string, { senderLookup: fastnearSenderLookup(ENDPOINTS.testnet.txApi) }));
    const receipt = receiptsOf(tx).find((r) => r.executorId === CONTRACT && functionCalls(r).some((c) => c.method === "sign_evm"));
    expect(receipt?.blockHash).toBeTruthy();
    const at = { blockHash: receipt?.blockHash as string };
    const buyer = await proof(BUYER, rpc, { predicate: nftOwner(CONTRACT, TOKEN), at });
    expect(buyer).toMatchObject({ ok: true, permission: { kind: "full-access" }, block: { hash: at.blockHash }, facts: { token: { owner_id: BUYER.accountId } } });
    const before = await proof(OWNER_BEFORE, rpc, { predicate: nftOwner(CONTRACT, TOKEN), at });
    expect(before).toMatchObject({ ok: false, status: 403, code: "predicate-refused", predicateCode: "not-owner" });
    if (buyer.ok) console.log(`receipt ${receipt?.receiptId} at block ${buyer.block.height} (${buyer.block.hash}): buyer ok, satchel-nft.testnet 403`);
  });

  it("re-reads every call of the recorded account-proof cassettes with the answers they hold", async () => {
    const rpc = liveArchival("testnet");
    for (const name of ["holder-at-buyer-sign", "proof-testnet-final", "nep641-testnet-final"]) {
      const cassette = loadFixture<Cassette>(`primitives/account-proof/${name}.json`);
      for (const call of cassette.calls) {
        const label = `${name}: ${call.method} ${JSON.stringify(call.params).slice(0, 160)}`;
        if (call.error !== undefined) {
          const err = await live(() => rpc(call.method, call.params).then(() => null, (e: unknown) => e));
          expect(err, label).toBeInstanceOf(RpcError);
          const cause = (error: unknown) => (error as { cause?: { name?: string } } | null)?.cause?.name;
          expect(cause((err as RpcError).data), label).toBe(cause(call.error));
          continue;
        }
        const answer = await live(() => rpc(call.method, call.params));
        if (call.method === "EXPERIMENTAL_tx_status") expect(txProjection(answer as TxStatusView), label).toEqual(txProjection(call.result as TxStatusView));
        else expect(answer, label).toMatchObject(call.result as object);
      }
    }
  });
});
