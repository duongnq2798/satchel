import { readFileSync } from "node:fs";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import vectors from "./__fixtures__/nep413-near-cli.json" with { type: "json" };
import { type Cassette, loadFixture, replayRpc } from "./__fixtures__/replay.js";
import { TEST_KEY } from "./__fixtures__/test-key.js";
import {
  type NonceStore,
  type Predicate,
  all,
  base64ToBytes,
  ftBalanceAtLeast,
  memoryNonceStore,
  nep413Hash,
  nftOwner,
  sputnikRole,
  verifyAccountProof,
  verifyNep413,
} from "./account-proof.js";
import { base58Decode } from "./base58.js";
import { TESTNET } from "./config.js";
import { ROOM_RECIPIENT, roomMessage } from "./holder.js";
import { type RpcCall, RpcError, type TxStatusView, functionCalls, receiptsOf } from "./near-rpc.js";
import * as nep413 from "./nep413.js";

// Every answer here is one testnet gave, recorded by scripts/capture-primitive-fixtures.mjs:
// holder-at-buyer-sign.json at the block of the receipt in which Satchel's testnet contract ran the
// buyer's sign_evm (the buyer owned #1 there), and proof-testnet-final.json at a final block after
// Satchel's DAO existed. The two NEP-413 signatures are near-cli-rs's (nep413-near-cli.json). A case
// that needs another answer changes a deep copy, and says so. No testnet account holds a FunctionCall
// key (the capture searched satchel-nft.testnet, buyer.satchel-nft.testnet and
// satchel-council-1112.testnet), so the function-call refusal is an in-test permission change.

const HOLDER = loadFixture<Cassette>("primitives/account-proof/holder-at-buyer-sign.json");
const FINAL = loadFixture<Cassette>("primitives/account-proof/proof-testnet-final.json");
const deployment = (file: string) => JSON.parse(readFileSync(new URL(`../../../deployments/${file}`, import.meta.url), "utf8"));
const CONTRACT = deployment("testnet.json").contract as string;
const E2E = deployment("testnet-e2e.json") as { steps: { tx?: string; tokenId?: string }[] };
const DAO = deployment("testnet-dao.json").dao as string;
const TOKEN = E2E.steps[0].tokenId as string;
const WNEAR = "wrap.testnet";

const SIGN_TX = HOLDER.calls.find((c) => c.method === "EXPERIMENTAL_tx_status")?.result as TxStatusView;
/** The receipt in which the contract ran the buyer's sign_evm: the cassette is pinned to its block. */
const SIGN_RECEIPT = receiptsOf(SIGN_TX).find((r) => r.executorId === CONTRACT && functionCalls(r).some((c) => c.method === "sign_evm"));
const AT_SIGN = { blockHash: SIGN_RECEIPT?.blockHash as string };
const AT_FINAL = { blockHash: FINAL.provenance.block?.hash as string };

type Vector = (typeof vectors.vectors)[number];
const [OWNER_BEFORE, BUYER] = vectors.vectors as [Vector, Vector];
const proofOf = (v: Vector) => ({ accountId: v.accountId, publicKey: v.publicKey, signature: v.signature, nonce: v.nonce });
const expectOf = (v: Vector) => ({ recipient: v.recipient, message: v.message });

type Recorded = Cassette["calls"][number];
const copy = <T>(value: T): T => structuredClone(value);
const params = (c: Recorded) => c.params as Record<string, unknown>;
const keyCall = (cassette: Cassette, account: string, key: string) =>
  cassette.calls.find((c) => params(c).request_type === "view_access_key" && params(c).account_id === account && params(c).public_key === key) as Recorded;
const viewCall = (cassette: Cassette, account: string, method: string) =>
  cassette.calls.find((c) => params(c).account_id === account && params(c).method_name === method) as Recorded;
const encodeJson = (value: unknown) => Array.from(new TextEncoder().encode(JSON.stringify(value)));
const decodeJson = (bytes: unknown) => JSON.parse(new TextDecoder().decode(Uint8Array.from(bytes as number[])));

/** An RpcCall answering from `cassette`, which counts what it was asked. */
function counted(cassette: Cassette) {
  const replay = replayRpc(cassette);
  const asked: string[] = [];
  const call = (async (method: string, p: unknown) => {
    asked.push(method);
    return replay(method, p);
  }) as RpcCall;
  return Object.assign(call, { asked, unused: replay.unused });
}

/** A copy of `cassette` in which `account`'s view_access_key for `key` answers `permission`. */
function withPermission(cassette: Cassette, account: string, key: string, permission: unknown): Cassette {
  const mutated = copy(cassette);
  (keyCall(mutated, account, key).result as { permission: unknown }).permission = permission;
  return mutated;
}

/** A store that records claims and answers what it is told to. */
function store(answer: boolean | Error = true): NonceStore & { claims: { key: string; ttlMs: number }[] } {
  const claims: { key: string; ttlMs: number }[] = [];
  return {
    claims,
    async claim(key, ttlMs) {
      claims.push({ key, ttlMs });
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("the recorded block", () => {
  it("is the block of the receipt in which the contract ran the buyer's sign_evm, found from the transaction", () => {
    expect(SIGN_TX.transaction.hash).toBe(E2E.steps[5].tx);
    expect(SIGN_TX.transaction.signer_id).toBe(BUYER.accountId);
    expect(SIGN_RECEIPT?.blockHash).toBe(HOLDER.provenance.block?.hash);
    // The inclusion block is another one: the cassette is not pinned to it.
    expect(SIGN_TX.transaction_outcome.block_hash).not.toBe(AT_SIGN.blockHash);
  });

  it("re-exports nep413.ts unchanged", () => {
    expect(verifyNep413).toBe(nep413.verifyNep413);
    expect(nep413Hash).toBe(nep413.nep413Hash);
    expect(base64ToBytes).toBe(nep413.base64ToBytes);
  });
});

describe("verifyAccountProof outcomes, at the buyer's sign_evm block", () => {
  it("accepts the buyer's near-cli-rs signature with nftOwner: a full-access key, and the owner at that block", async () => {
    const rpc = counted(HOLDER);
    const result = await verifyAccountProof({ rpc, proof: proofOf(BUYER), expect: expectOf(BUYER), predicate: nftOwner(CONTRACT, TOKEN), at: AT_SIGN });
    expect(result).toEqual({
      ok: true,
      accountId: BUYER.accountId,
      publicKey: BUYER.publicKey,
      permission: { kind: "full-access" },
      block: expect.objectContaining({ hash: AT_SIGN.blockHash, height: HOLDER.provenance.block?.height }),
      facts: { token: { token_id: TOKEN, owner_id: BUYER.accountId } },
    });
    // One block read, the key, the token: nothing else.
    expect(rpc.asked).toEqual(["block", "query", "query"]);
  });

  it("refuses the previous owner's signature with nftOwner: predicate-refused, not-owner, 403", async () => {
    const result = await verifyAccountProof({
      rpc: replayRpc(HOLDER),
      proof: proofOf(OWNER_BEFORE),
      expect: expectOf(OWNER_BEFORE),
      predicate: nftOwner(CONTRACT, TOKEN),
      at: AT_SIGN,
    });
    expect(result).toMatchObject({ ok: false, status: 403, stage: "predicate", code: "predicate-refused", predicateCode: "not-owner" });
    expect(result.ok === false && result.reason).toContain(BUYER.accountId);
    expect(result.ok === false && result.block?.hash).toBe(AT_SIGN.blockHash);
  });

  it("accepts with no predicate, and its result survives a JSON round trip", async () => {
    const result = await verifyAccountProof({ rpc: replayRpc(HOLDER), proof: proofOf(OWNER_BEFORE), expect: expectOf(OWNER_BEFORE), at: AT_SIGN });
    expect(result).toMatchObject({ ok: true, accountId: OWNER_BEFORE.accountId, permission: { kind: "full-access" } });
    const withFacts = await verifyAccountProof({ rpc: replayRpc(HOLDER), proof: proofOf(BUYER), expect: expectOf(BUYER), predicate: nftOwner(CONTRACT, TOKEN), at: AT_SIGN });
    expect(JSON.parse(JSON.stringify(withFacts))).toEqual(withFacts);
    expect(typeof (withFacts.ok && withFacts.block.timestampNs)).toBe("string");
  });

  it("takes the nonce as bytes or base64, and the signature as base64 or ed25519:base58", async () => {
    const bytes = base64ToBytes(BUYER.nonce) as Uint8Array;
    const sig = nep413.bytesToBase64(base58Decode(BUYER.signature.slice("ed25519:".length)));
    for (const proof of [{ ...proofOf(BUYER), nonce: bytes }, { ...proofOf(BUYER), signature: sig }]) {
      expect(await verifyAccountProof({ rpc: replayRpc(HOLDER), proof, expect: expectOf(BUYER), at: AT_SIGN })).toMatchObject({ ok: true });
    }
  });
});

describe("verifyAccountProof shape, time and signature: 400 and 401, with no RPC call", () => {
  type Change = { proof?: object; expect?: object; [k: string]: unknown };
  const run = (change: Change = {}) => {
    const rpc = counted(HOLDER);
    const { proof, expect: expected, ...rest } = change;
    return verifyAccountProof({
      rpc,
      proof: { ...proofOf(BUYER), ...proof } as Parameters<typeof verifyAccountProof>[0]["proof"],
      expect: { ...expectOf(BUYER), ...expected },
      at: AT_SIGN,
      ...rest,
    }).then((result) => ({ result, asked: rpc.asked }));
  };

  it("refuses a malformed proof as 400, never a throw", async () => {
    const cases: Change[] = [
      { proof: { accountId: "Not An Account" } },
      { proof: { accountId: 42 } },
      { proof: { publicKey: null } },
      { proof: { signature: undefined } },
      { proof: { nonce: "AAAA" } },
      { proof: { nonce: new Uint8Array(31) } },
      { proof: { nonce: "%%%" } },
      { proof: { callbackUrl: 7 } },
      { expect: { message: 42 } },
      { expect: { recipient: null } },
    ];
    for (const c of cases) {
      const { result, asked } = await run(c);
      expect(result, JSON.stringify(c)).toMatchObject({ ok: false, status: 400, stage: "shape", code: "malformed" });
      expect(asked).toEqual([]);
    }
    const nothing = await verifyAccountProof({ rpc: replayRpc(HOLDER), proof: null as never, expect: expectOf(BUYER) });
    expect(nothing).toMatchObject({ ok: false, status: 400, code: "malformed" });
  });

  it("refuses an over-long key, signature or message as too-long, counting the message in UTF-8 bytes", async () => {
    expect((await run({ proof: { publicKey: `ed25519:${"1".repeat(121)}` } })).result).toMatchObject({ status: 400, code: "too-long" });
    expect((await run({ proof: { signature: "A".repeat(257) } })).result).toMatchObject({ status: 400, code: "too-long" });
    const bytes = new TextEncoder().encode(BUYER.message).length;
    expect(bytes).toBeGreaterThan(BUYER.message.length);
    expect((await run({ maxMessageBytes: bytes - 1 })).result).toMatchObject({ status: 400, stage: "shape", code: "too-long" });
    expect((await run({ maxMessageBytes: bytes })).result).toMatchObject({ ok: true });
  });

  it("refuses a key type other than ed25519, and a signature over anything else, as 401", async () => {
    const secp = `secp256k1:${BUYER.publicKey.slice("ed25519:".length)}`;
    expect(await run({ proof: { publicKey: secp } })).toMatchObject({ result: { status: 401, stage: "signature", code: "unsupported-key-type" }, asked: [] });
    for (const c of [
      { expect: { recipient: "satchelnft.xyz.evil.com" } },
      { expect: { message: `${BUYER.message} ` } },
      { proof: { nonce: OWNER_BEFORE.nonce } },
      { proof: { callbackUrl: "https://satchelnft.xyz" } },
      { proof: { publicKey: OWNER_BEFORE.publicKey } },
    ]) {
      expect(await run(c), JSON.stringify(c)).toMatchObject({ result: { status: 401, stage: "signature", code: "bad-signature" }, asked: [] });
    }
    expect((await run({ proof: { callbackUrl: null } })).result).toMatchObject({ ok: true });
  });

  it("rejects, as its only throw, a nonceStore without freshness", async () => {
    await expect(
      verifyAccountProof({ rpc: replayRpc(HOLDER), proof: proofOf(BUYER), expect: expectOf(BUYER), nonceStore: memoryNonceStore(), at: AT_SIGN }),
    ).rejects.toThrow(new TypeError("nonceStore needs freshness: without a time bound a nonce TTL means nothing"));
  });
});

describe("verifyAccountProof freshness", () => {
  // The near-cli-rs vectors carry no time, so these use a message that contains one: the buyer's
  // multi-line vector with an "Issued:" line would no longer match its signature, so the time checks
  // (which run before the signature) are what these exercise, and the end-to-end case below signs.
  const issuedAt = "2026-11-09T01:52:00.000Z";
  const now = Date.parse(issuedAt);
  const run = (freshness: object, message = `${BUYER.message}\nIssued: ${issuedAt}`) =>
    verifyAccountProof({ rpc: replayRpc(HOLDER), proof: proofOf(BUYER), expect: { ...expectOf(BUYER), message }, freshness: { issuedAt, now, ...freshness }, at: AT_SIGN });

  it("refuses an issuedAt the signed message does not contain: freshness-unbound, 400", async () => {
    expect(await run({}, BUYER.message)).toMatchObject({ ok: false, status: 400, stage: "time", code: "freshness-unbound" });
  });

  it("refuses a stale proof and one from the future against a fixed now, within the window and skew", async () => {
    expect(await run({ now: now + 300_001 })).toMatchObject({ status: 401, stage: "time", code: "stale" });
    expect(await run({ now: now - 60_001 })).toMatchObject({ status: 401, stage: "time", code: "from-the-future" });
    expect(await run({ now: now + 10_001, windowMs: 10_000 })).toMatchObject({ code: "stale" });
    expect(await run({ now: now - 1_001, skewMs: 1_000 })).toMatchObject({ code: "from-the-future" });
    // At the edges the time passes and the signature is next (this message is not what near-cli-rs signed).
    expect(await run({ now: now + 300_000 })).toMatchObject({ stage: "signature", code: "bad-signature" });
    expect(await run({ now: now - 60_000 })).toMatchObject({ stage: "signature", code: "bad-signature" });
  });

  it("refuses an issuedAt that is not an ISO 8601 UTC time", async () => {
    for (const bad of ["2026-11-09 01:52:00Z", "2026-11-09T01:52:00+00:00", "2026-11-09T01:52Z", "2026-02-30T00:00:00Z", "2026-11-09T24:00:00Z", "yesterday", ""]) {
      const result = await verifyAccountProof({
        rpc: replayRpc(HOLDER),
        proof: proofOf(BUYER),
        expect: { ...expectOf(BUYER), message: `Issued: ${bad}` },
        freshness: { issuedAt: bad, now },
        at: AT_SIGN,
      });
      expect(result, bad).toMatchObject({ ok: false, status: 400, stage: "time", code: "malformed" });
    }
  });

  it("end to end: a holder-room message signed in-test by the test key, fresh, then replayed (in-test cassette entry)", async () => {
    // In-test cassette entry: at the sign_evm block, the buyer's account answers that it holds the
    // test key with full access (the buyer's own recorded answer, under the test key).
    const cassette = copy(HOLDER);
    const own = keyCall(cassette, BUYER.accountId, BUYER.publicKey);
    cassette.calls.push({ ...copy(own), params: { ...params(own), public_key: TEST_KEY.publicKey } });
    const issued = new Date(Date.parse(HOLDER.provenance.capturedAt) - 90_000).toISOString();
    const message = roomMessage(TESTNET, TOKEN, BUYER.accountId, issued);
    const nonce = sha256(new TextEncoder().encode("account-proof e2e nonce"));
    const signature = TEST_KEY.sign(nep413Hash({ message, nonce, recipient: ROOM_RECIPIENT }));
    const nonces = memoryNonceStore();
    const input = {
      rpc: replayRpc(cassette),
      proof: { accountId: BUYER.accountId, publicKey: TEST_KEY.publicKey, signature, nonce: nep413.bytesToBase64(nonce) },
      expect: { recipient: ROOM_RECIPIENT, message },
      predicate: nftOwner(CONTRACT, TOKEN),
      freshness: { issuedAt: issued, now: Date.parse(issued) + 60_000 },
      nonceStore: nonces,
      at: AT_SIGN,
    };
    expect(message).toContain(`Issued: ${issued}`);
    expect(await verifyAccountProof(input)).toMatchObject({ ok: true, publicKey: TEST_KEY.publicKey, facts: { token: { owner_id: BUYER.accountId } } });
    expect(await verifyAccountProof(input)).toMatchObject({ ok: false, status: 409, stage: "replay", code: "replayed" });
    // The same signed message for another recipient is another nonce key, but its signature fails first.
    expect(await verifyAccountProof({ ...input, expect: { ...input.expect, recipient: "other.example" } })).toMatchObject({ code: "bad-signature" });
  });
});

describe("verifyAccountProof block and key: 403 and 502", () => {
  it("refuses a key the account does not hold at the block: key-not-on-account, 403", async () => {
    // NEP-413 signs no account id: the buyer's signature, offered for satchel-nft.testnet.
    const result = await verifyAccountProof({ rpc: replayRpc(HOLDER), proof: { ...proofOf(BUYER), accountId: OWNER_BEFORE.accountId }, expect: expectOf(BUYER), at: AT_SIGN });
    expect(result).toMatchObject({ ok: false, status: 403, stage: "key", code: "key-not-on-account" });
  });

  it("refuses a function-call key unless keyPolicy names its receiver (in-test permission change)", async () => {
    const fc = { FunctionCall: { allowance: "250000000000000000000000", receiver_id: CONTRACT, method_names: [] } };
    const cassette = withPermission(HOLDER, BUYER.accountId, BUYER.publicKey, fc);
    const run = (keyPolicy?: Parameters<typeof verifyAccountProof>[0]["keyPolicy"]) =>
      verifyAccountProof({ rpc: replayRpc(cassette), proof: proofOf(BUYER), expect: expectOf(BUYER), keyPolicy, at: AT_SIGN });
    expect(await run()).toMatchObject({ ok: false, status: 403, stage: "key", code: "function-call-key" });
    expect(await run("full-access")).toMatchObject({ code: "function-call-key" });
    expect(await run({ functionCallReceiver: "other.testnet" })).toMatchObject({ code: "function-call-key" });
    expect(await run({ functionCallReceiver: CONTRACT })).toMatchObject({
      ok: true,
      permission: { kind: "function-call", receiverId: CONTRACT, methodNames: [], allowance: "250000000000000000000000" },
    });
    // A full-access key passes under either policy.
    expect(
      await verifyAccountProof({ rpc: replayRpc(HOLDER), proof: proofOf(BUYER), expect: expectOf(BUYER), keyPolicy: { functionCallReceiver: CONTRACT }, at: AT_SIGN }),
    ).toMatchObject({ ok: true, permission: { kind: "full-access" } });
  });

  it("refuses an unknown permission, takes a gas-key full-access key, and treats a gas-key function-call key as a function-call key (labelled shapes)", async () => {
    const run = (permission: unknown, keyPolicy?: Parameters<typeof verifyAccountProof>[0]["keyPolicy"]) =>
      verifyAccountProof({ rpc: replayRpc(withPermission(HOLDER, BUYER.accountId, BUYER.publicKey, permission)), proof: proofOf(BUYER), expect: expectOf(BUYER), keyPolicy, at: AT_SIGN });
    expect(await run({ SomethingNew: {} })).toMatchObject({ ok: false, status: 403, code: "unknown-permission" });
    // Labelled shapes: no real gas-key answer is recorded yet (Experimental).
    expect(await run({ GasKeyFullAccess: { balance: "0", num_nonces: 1 } })).toMatchObject({ ok: true, permission: { kind: "gas-key-full-access" } });
    const gasFc = { GasKeyFunctionCall: [{ balance: "0", num_nonces: 1 }, { allowance: null, receiver_id: CONTRACT, method_names: [] }] };
    expect(await run(gasFc)).toMatchObject({ ok: false, code: "function-call-key" });
    expect(await run(gasFc, { functionCallReceiver: CONTRACT })).toMatchObject({ ok: true, permission: { kind: "gas-key-function-call" } });
  });

  it("with strictBlock, refuses a key answer with no block hash or another one: wrong-block, 502", async () => {
    const missing = copy(HOLDER);
    delete (keyCall(missing, BUYER.accountId, BUYER.publicKey).result as { block_hash?: string }).block_hash;
    const other = copy(HOLDER);
    (keyCall(other, BUYER.accountId, BUYER.publicKey).result as { block_hash: string }).block_hash = FINAL.provenance.block?.hash as string;
    for (const cassette of [missing, other]) {
      const result = await verifyAccountProof({ rpc: replayRpc(cassette), proof: proofOf(BUYER), expect: expectOf(BUYER), at: AT_SIGN });
      expect(result).toMatchObject({ ok: false, status: 502, stage: "key", code: "wrong-block", block: { hash: AT_SIGN.blockHash } });
      expect(result.ok === false && result.cause).toBeInstanceOf(RpcError);
    }
    // strictBlock false lets an answer with no block hash through, as near.ts does.
    expect(await verifyAccountProof({ rpc: replayRpc(missing), proof: proofOf(BUYER), expect: expectOf(BUYER), strictBlock: false, at: AT_SIGN })).toMatchObject({ ok: true });
  });

  it("reports a block read that fails as rpc-block, and a key read that fails as rpc-key, both 502 with the cause", async () => {
    // In-test changes: the block read, then the key read, answer a JSON-RPC error.
    const error = { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_BLOCK", info: {} }, code: -32000, message: "Server error" };
    const noBlock = copy(HOLDER);
    const block = noBlock.calls.find((c) => c.method === "block") as Recorded;
    block.result = undefined;
    block.error = error;
    const blockResult = await verifyAccountProof({ rpc: replayRpc(noBlock), proof: proofOf(BUYER), expect: expectOf(BUYER), at: AT_SIGN });
    expect(blockResult).toMatchObject({ ok: false, status: 502, stage: "block", code: "rpc-block" });
    expect(blockResult.ok === false && blockResult.cause).toBeInstanceOf(RpcError);
    const noKey = copy(HOLDER);
    const key = keyCall(noKey, BUYER.accountId, BUYER.publicKey);
    key.result = undefined;
    key.error = { ...error, cause: { name: "GARBAGE_COLLECTED_BLOCK", info: {} } };
    expect(await verifyAccountProof({ rpc: replayRpc(noKey), proof: proofOf(BUYER), expect: expectOf(BUYER), at: AT_SIGN })).toMatchObject({
      ok: false,
      status: 502,
      stage: "key",
      code: "rpc-key",
    });
  });
});

describe("predicates, on recorded answers", () => {
  const proofAt = (v: Vector, cassette: Cassette, at: { blockHash: string }, predicate: Predicate<unknown>) =>
    verifyAccountProof({ rpc: replayRpc(cassette), proof: proofOf(v), expect: expectOf(v), predicate, at });

  it("nftOwner: no token is 404, an answer about another token 502 (in-test change), a contract that is not NEP-171 502", async () => {
    expect(await proofAt(BUYER, HOLDER, AT_SIGN, nftOwner(CONTRACT, "1000000"))).toMatchObject({ status: 404, code: "predicate-refused", predicateCode: "no-token" });
    expect(await proofAt(BUYER, HOLDER, AT_SIGN, nftOwner(WNEAR, TOKEN))).toMatchObject({ status: 502, code: "predicate-refused", predicateCode: "not-nep171" });
    // In-test change: the contract answers token "2" when asked for "1".
    const other = copy(HOLDER);
    const call = viewCall(other, CONTRACT, "nft_token");
    const token = decodeJson((call.result as { result: number[] }).result);
    (call.result as { result: number[] }).result = encodeJson({ ...token, token_id: "2" });
    expect(await proofAt(BUYER, other, AT_SIGN, nftOwner(CONTRACT, TOKEN))).toMatchObject({ status: 502, predicateCode: "wrong-token" });
    // At the final block the buyer still owns #1.
    expect(await proofAt(BUYER, FINAL, AT_FINAL, nftOwner(CONTRACT, TOKEN))).toMatchObject({ ok: true, facts: { token: { owner_id: BUYER.accountId } } });
  });

  it("ftBalanceAtLeast compares u128 decimal strings: wrap.testnet's 0 passes a minimum of 0 and fails 1", async () => {
    expect(await proofAt(BUYER, HOLDER, AT_SIGN, ftBalanceAtLeast(WNEAR, 0n))).toMatchObject({ ok: true, facts: { balance: "0" } });
    expect(await proofAt(BUYER, HOLDER, AT_SIGN, ftBalanceAtLeast(WNEAR, "0"))).toMatchObject({ ok: true });
    expect(await proofAt(OWNER_BEFORE, FINAL, AT_FINAL, ftBalanceAtLeast(WNEAR, 1n))).toMatchObject({ status: 403, predicateCode: "below-min" });
    // In-test change: a balance above 2^64, where a JS number would round.
    const rich = copy(HOLDER);
    const call = rich.calls.find((c) => params(c).method_name === "ft_balance_of" && params(c).account_id === WNEAR && atob(params(c).args_base64 as string).includes(BUYER.accountId)) as Recorded;
    (call.result as { result: number[] }).result = encodeJson("340282366920938463463374607431768211455");
    expect(await proofAt(BUYER, rich, AT_SIGN, ftBalanceAtLeast(WNEAR, "340282366920938463463374607431768211455"))).toMatchObject({ ok: true });
    expect(await proofAt(BUYER, rich, AT_SIGN, ftBalanceAtLeast(WNEAR, 340282366920938463463374607431768211456n))).toMatchObject({ predicateCode: "below-min" });
    for (const bad of ["-1", "1.5", "abc", "", -1n]) expect(() => ftBalanceAtLeast(WNEAR, bad as string)).toThrow(TypeError);
  });

  it("sputnikRole: the council Group holds satchel-nft.testnet, not the buyer; an absent role is 404", async () => {
    expect(await proofAt(OWNER_BEFORE, FINAL, AT_FINAL, sputnikRole(DAO, "council"))).toMatchObject({ ok: true, facts: { role: "council", kind: "Group" } });
    expect(await proofAt(BUYER, FINAL, AT_FINAL, sputnikRole(DAO, "council"))).toMatchObject({ status: 403, predicateCode: "not-in-role" });
    expect(await proofAt(BUYER, FINAL, AT_FINAL, sputnikRole(DAO, "members"))).toMatchObject({ status: 404, predicateCode: "no-role" });
    // At the sign_evm block the DAO did not exist yet.
    expect(await proofAt(BUYER, HOLDER, AT_SIGN, sputnikRole(DAO, "council"))).toMatchObject({ status: 502, predicateCode: "not-sputnik" });
  });

  it("sputnikRole: an Everyone role passes, a Member (token-weighted) role is refused as unsupported (in-test changes)", async () => {
    const withKind = (kind: unknown) => {
      const mutated = copy(FINAL);
      const call = viewCall(mutated, DAO, "get_policy");
      const policy = decodeJson((call.result as { result: number[] }).result);
      policy.roles[0].kind = kind;
      (call.result as { result: number[] }).result = encodeJson(policy);
      return mutated;
    };
    expect(await proofAt(BUYER, withKind("Everyone"), AT_FINAL, sputnikRole(DAO, "council"))).toMatchObject({ ok: true, facts: { role: "council", kind: "Everyone" } });
    expect(await proofAt(OWNER_BEFORE, withKind({ Member: "1" }), AT_FINAL, sputnikRole(DAO, "council"))).toMatchObject({
      status: 403,
      predicateCode: "member-role-unsupported",
    });
  });

  it("all() runs in order, stops at the first refusal, and returns the facts in order", async () => {
    const third = vi.fn(async () => ({ ok: true as const, facts: "never" }));
    const refused = await proofAt(BUYER, HOLDER, AT_SIGN, all(nftOwner(CONTRACT, TOKEN), ftBalanceAtLeast(WNEAR, 1n), third));
    expect(refused).toMatchObject({ status: 403, predicateCode: "below-min" });
    expect(third).not.toHaveBeenCalled();
    const passed = await proofAt(BUYER, HOLDER, AT_SIGN, all(nftOwner(CONTRACT, TOKEN), ftBalanceAtLeast(WNEAR, 0n)));
    expect(passed).toMatchObject({ ok: true, facts: [{ token: { owner_id: BUYER.accountId } }, { balance: "0" }] });
  });

  it("a predicate that throws is predicate-rpc, 502; it reads with the pinned reader and the same rpc", async () => {
    const seen: unknown[] = [];
    const throwing: Predicate<never> = async (ctx) => {
      seen.push(ctx.reader.block.hash, ctx.accountId, ctx.publicKey, typeof ctx.rpc);
      throw new Error("boom");
    };
    const result = await proofAt(BUYER, HOLDER, AT_SIGN, throwing);
    expect(result).toMatchObject({ ok: false, status: 502, stage: "predicate", code: "predicate-rpc" });
    expect(seen).toEqual([AT_SIGN.blockHash, BUYER.accountId, BUYER.publicKey, "function"]);
  });
});

describe("the replay guard", () => {
  const issuedAt = new Date(Date.parse(HOLDER.provenance.capturedAt) - 90_000).toISOString();
  const message = `Sign in to example.app\nIssued: ${issuedAt}`;
  const nonce = sha256(new TextEncoder().encode("replay nonce"));
  const signed = () => {
    // In-test cassette entry, as above: the buyer's account holds the test key.
    const cassette = copy(HOLDER);
    const own = keyCall(cassette, BUYER.accountId, BUYER.publicKey);
    cassette.calls.push({ ...copy(own), params: { ...params(own), public_key: TEST_KEY.publicKey } });
    return {
      rpc: replayRpc(cassette),
      proof: { accountId: BUYER.accountId, publicKey: TEST_KEY.publicKey, signature: TEST_KEY.sign(nep413Hash({ message, nonce, recipient: "example.app" })), nonce },
      expect: { recipient: "example.app", message },
      freshness: { issuedAt, now: Date.parse(issuedAt) },
      at: AT_SIGN,
    };
  };

  it("claims account, key, nonce and recipient with the window plus skew as TTL, only after every other check passed", async () => {
    const nonces = store();
    expect(await verifyAccountProof({ ...signed(), nonceStore: nonces })).toMatchObject({ ok: true });
    expect(nonces.claims).toEqual([{ key: `${BUYER.accountId}\n${TEST_KEY.publicKey}\n${bytesToHex(nonce)}\nexample.app`, ttlMs: 360_000 }]);
    const ttl = store();
    await verifyAccountProof({ ...signed(), nonceStore: ttl, nonceTtlMs: 1_000 });
    expect(ttl.claims[0].ttlMs).toBe(1_000);
    // A proof that fails, at any stage, claims nothing.
    const failing = store();
    const input = signed();
    await verifyAccountProof({ ...input, nonceStore: failing, predicate: nftOwner(CONTRACT, "1000000") });
    await verifyAccountProof({ ...input, nonceStore: failing, expect: { ...input.expect, recipient: "other.app" } });
    await verifyAccountProof({ ...input, nonceStore: failing, freshness: { ...input.freshness, now: Date.parse(issuedAt) + 600_000 } });
    expect(failing.claims).toEqual([]);
  });

  it("refuses a second claim with 409, and fails closed with 502 when the store throws", async () => {
    expect(await verifyAccountProof({ ...signed(), nonceStore: store(false) })).toMatchObject({ ok: false, status: 409, stage: "replay", code: "replayed" });
    const broken = await verifyAccountProof({ ...signed(), nonceStore: store(new Error("redis is down")) });
    expect(broken).toMatchObject({ ok: false, status: 502, stage: "replay", code: "replay-store" });
    expect(broken.ok === false && (broken.cause as Error).message).toBe("redis is down");
  });

  it("memoryNonceStore: first use only, until the TTL passes; full of live nonces, it throws (fail closed)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const nonces = memoryNonceStore({ max: 2 });
    expect(await nonces.claim("a", 1_000)).toBe(true);
    expect(await nonces.claim("a", 1_000)).toBe(false);
    vi.setSystemTime(1_001);
    expect(await nonces.claim("a", 1_000)).toBe(true);
    expect(await nonces.claim("b", 1_000)).toBe(true);
    await expect(nonces.claim("c", 1_000)).rejects.toThrow(/full/);
    vi.setSystemTime(2_002);
    expect(await nonces.claim("c", 1_000)).toBe(true);
  });
});
