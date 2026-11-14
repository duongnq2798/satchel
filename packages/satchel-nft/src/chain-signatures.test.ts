import { readFileSync } from "node:fs";
import { ed25519 } from "@noble/curves/ed25519";
import { secp256k1 } from "@noble/curves/secp256k1";
import { hexToBytes } from "@noble/hashes/utils";
import { type Hex, createPublicClient, custom, getAddress, keccak256, parseTransaction } from "viem";
import { base, sepolia } from "viem/chains";
import { describe, expect, it, vi } from "vitest";
import derived from "./__fixtures__/derived-keys.json" with { type: "json" };
import outcome from "./__fixtures__/sign-evm-outcome.json" with { type: "json" };
import { type Cassette, type OneCall, cassetteOf, loadFixture, replayEvm, replayRpc } from "./__fixtures__/replay.js";
import { base58Encode } from "./base58.js";
import {
  EVM_READ_METHODS,
  MPC_CONTRACTS,
  MPC_ROOT_KEYS,
  type MpcResponse,
  type SignTxAudit,
  auditSignTx,
  crossCheckDerivation,
  deriveKey,
  deriveTweak,
  evmAddress,
  evmJsonRpc,
  mpcRequests,
  normalizeEcdsa,
  proveEvmTx,
  proveRawTx,
  readOnlyEvm,
  readOnlyEvmClient,
  scanMpcResponses,
  verifySignature,
} from "./chain-signatures.js";
import { MAINNET, TESTNET } from "./config.js";
import { type TxStatus, signatureFromReceipts } from "./dao.js";
import { type MpcSignature, addressFromMpcKey, toEvmSignature } from "./evm.js";
import { outcomeValue } from "./near.js";
import { ReadOnlyError, type TxStatusView, decodeBase64, encodeArgs } from "./near-rpc.js";

// Every transaction here is a full EXPERIMENTAL_tx_status answer recorded from testnet or mainnet by
// scripts/capture-primitive-fixtures.mjs, and every EVM answer was recorded from Sepolia or Base the
// same way. A test that needs a broken input changes a deep copy and says what it changed; the fixture
// files are never edited.

type TxFixture = OneCall<TxStatusView>;
const txFixture = (name: string) => loadFixture<TxFixture>(`primitives/chain-signatures/tx-${name}.json`);
const TX = {
  EZLX: txFixture("EZLX"),
  "2ryQps": txFixture("2ryQps"),
  GqFsnm: txFixture("GqFsnm"),
  "2xqwe8": txFixture("2xqwe8"),
  FnFSMSh1: txFixture("FnFSMSh1"),
  "33UTwy": txFixture("33UTwy"),
  FgbW: txFixture("FgbW"),
  "9FsA": txFixture("9FsA"),
  HthQSVE: txFixture("HthQSVE"),
};
type TxName = keyof typeof TX;
const evmCassette = (name: string) => loadFixture<Cassette>(`primitives/chain-signatures/${name}.json`);
const DERIVED = {
  testnet: loadFixture<Cassette>("primitives/chain-signatures/derived-keys-domains-testnet.json"),
  mainnet: loadFixture<Cassette>("primitives/chain-signatures/derived-keys-domains-mainnet.json"),
};
const DAO_VOTE_TRIMMED = loadFixture<TxStatusView>("dao-vote-outcome.json");

const deployment = (file: string) => JSON.parse(readFileSync(new URL(`../../../deployments/${file}`, import.meta.url), "utf8"));
const E2E = deployment("testnet-e2e.json");
const DAO = deployment("testnet-dao.json");
const FIRST_SEND = deployment("mainnet-first-send.json");
const EXIT = deployment("mainnet-1click-exit.json");
/** testnet-e2e.json steps[2].raw: token 1's signed Sepolia transaction, never broadcast. */
const RAW = E2E.steps[2].raw as Hex;
const TOKEN_1 = E2E.steps[1].recovered as string;

const SECP256K1_N = secp256k1.CURVE.n;
const SECP256K1_P = secp256k1.CURVE.Fp.ORDER;
const TX_BENCH_ED25519 = "ed25519:pJisEEQe9mw8Ew2faGNAHzu6wijjtUhjorKGReGTkpi";

const copy = <T>(value: T): T => structuredClone(value);
const senderOf = (f: TxFixture) => (f.provenance.params as { sender_account_id: string }).sender_account_id;
/** A replaying RpcCall for a transaction answer (the recorded one, or a changed copy). */
const replayTx = (f: TxFixture, result: TxStatusView = f.result) => replayRpc(cassetteOf({ provenance: f.provenance, result }));
const auditOf = (name: TxName, network: "testnet" | "mainnet", options: { result?: TxStatusView; rootKeys?: Partial<Record<0 | 1, string>> } = {}) =>
  auditSignTx(replayTx(TX[name], options.result), TX[name].result.transaction.hash, {
    sender: senderOf(TX[name]),
    mpcContract: MPC_CONTRACTS[network],
    rootKeys: options.rootKeys ?? MPC_ROOT_KEYS[network],
  });

function outcomeOf(tx: TxStatusView, id: string) {
  const found = tx.receipts_outcome.find((r) => r.id === id);
  if (!found) throw new Error(`no outcome ${id}`);
  return found;
}
function functionCallOf(tx: TxStatusView, id: string) {
  const receipt = tx.receipts?.find((r) => r.receipt_id === id);
  const call = (receipt?.receipt as { Action: { actions: { FunctionCall: { args: string; method_name: string } }[] } } | undefined)?.Action.actions[0].FunctionCall;
  if (!call) throw new Error(`no function call in ${id}`);
  return call;
}
const answerOf = (tx: TxStatusView, id: string) => JSON.parse(decodeBase64((outcomeOf(tx, id).outcome.status as { SuccessValue: string }).SuccessValue)) as MpcResponse;

/** The sign and callback receipts of each recorded request, as the chain explorer lists them. */
const SIGNED = {
  EZLX: { network: "testnet", sign: "DPZUErJtm9JMBFX9aTccZvow5TZERKYYv2WqvXQySkCz", callback: "Ckp54UmUjQZ4MYnXnBNymMh84ghyF1o74kfVaHn22RcH" },
  "2ryQps": { network: "testnet", sign: "FWa3axK2KxKWq2tf1YpNNLNeb8QPf8dayhbBhZSJpDYv", callback: "5Y8LFFZm63VdfMLWumJxA4eZ55dzdCEWNXc5rvGBxP4a" },
  FgbW: { network: "testnet", sign: "72QAGETW7mbpRDGzdz1vb3P2C1jo3pD4J6sgoVHzaW34", callback: "R4d3x2MWc3hb9nMqf75ha1of2LWfsZfKka3zDLzki2q" },
  "9FsA": { network: "testnet", sign: "12uxgkYYh1aYc8Gf8ju8hay5NrsE3SkJu7uZiQVVSGiF", callback: "Hayhr8Ad529xqNputX5umXrB9tEUm1DQDSRq2hxQxHZY" },
  HthQSVE: { network: "testnet", sign: "9eg3Scj9Hn2fLF8oWYLcQVNEomHk9L6arfNSxS9uDuXk", callback: "ADhpWuTHsdMsDu72yhRR2KSpmmQfFAVJ1gWJEz1gn6P5" },
  "2xqwe8": { network: "mainnet", sign: "HbiReFfuC2MpPjkntyhuNQX8c5RjW279v8gZq27XyFiv", callback: "7MJKGLfPALtvw1pUiHQ6vsT8SpgFySq5eXpNggsDfTV1" },
  FnFSMSh1: { network: "mainnet", sign: "EHymicMTK2Ez5gtpWQPe2UuXQtNwxMqSM4jUXR8oj9cY", callback: "6F1evncsJDniwKSHMUmGykEBPVvwyXJB95u591wkzXUb" },
} as const;
const SECP_SIGNED = ["EZLX", "2ryQps", "9FsA", "2xqwe8", "FnFSMSh1"] as const;
const ED_SIGNED = ["FgbW", "HthQSVE"] as const;

/** The key a recorded request was signed with, derived from the pinned root key. */
function keyFor(name: keyof typeof SIGNED): string {
  const [request] = mpcRequests(TX[name].result, MPC_CONTRACTS[SIGNED[name].network]);
  const domain = request.request.domain as 0 | 1;
  return deriveKey(MPC_ROOT_KEYS[SIGNED[name].network][domain], request.request.predecessor, request.request.path, domain);
}
const payloadOf = (name: TxName) => hexToBytes(mpcRequests(TX[name].result, MPC_CONTRACTS[name in SIGNED ? SIGNED[name as keyof typeof SIGNED].network : "testnet"])[0].request.payload.hex);

// ---- Root keys, addresses and the live derivation check -------------------------------------------

describe("MPC_CONTRACTS, MPC_ROOT_KEYS and evmAddress", () => {
  it("name config.ts's MPC contracts, and the root keys each contract's public_key gave at the recorded block", () => {
    expect(MPC_CONTRACTS).toEqual({ mainnet: MAINNET.mpc, testnet: TESTNET.mpc });
    expect(MPC_ROOT_KEYS.testnet[0]).toBe(TESTNET.mpcRootKey);
    expect(MPC_ROOT_KEYS.mainnet[0]).toBe(MAINNET.mpcRootKey);
    for (const network of ["testnet", "mainnet"] as const) {
      const roots = DERIVED[network].calls
        .filter((c) => (c.params as { method_name?: string }).method_name === "public_key")
        .map((c) => [
          JSON.parse(decodeBase64((c.params as { args_base64: string }).args_base64)).domain_id,
          JSON.parse(new TextDecoder().decode(Uint8Array.from((c.result as { result: number[] }).result))),
        ]);
      expect(Object.fromEntries(roots)).toEqual(MPC_ROOT_KEYS[network]);
    }
  });

  it("gives addressFromMpcKey's address for every key derived-keys.json and the domain fixtures hold", () => {
    const keys = [...Object.values(derived.testnet.keys), ...Object.values(derived.mainnet.keys), keyFor("9FsA")];
    for (const key of keys) expect(evmAddress(key)).toBe(addressFromMpcKey(key));
    expect(evmAddress(derived.testnet.keys["satchel/1"])).toBe(TOKEN_1);
    expect(() => evmAddress(TX_BENCH_ED25519)).toThrow(`not a secp256k1 key: ${TX_BENCH_ED25519}`);
    expect(() => evmAddress("secp256k1:2")).toThrow("expected a 64-byte key, got 1");
  });
});

describe("crossCheckDerivation, on the recorded final blocks", () => {
  const testnetCases = [
    ...Array.from({ length: 11 }, (_, i) => ({ predecessor: TESTNET.contract, path: `satchel/${i + 1}`, domain: 0 as const })),
    { predecessor: "tx-bench.testnet", path: "", domain: 1 as const },
    { predecessor: "tx-bench.testnet", path: "", domain: 0 as const },
  ];

  it("derives every recorded testnet key locally from the root key read at that block, both domains", async () => {
    const rpc = replayRpc(DERIVED.testnet);
    const at = { blockHash: DERIVED.testnet.provenance.block?.hash as string };
    const check = await crossCheckDerivation(rpc, MPC_CONTRACTS.testnet, testnetCases, at);
    expect(check.block.hash).toBe(at.blockHash);
    expect(check.block.height).toBe(DERIVED.testnet.provenance.block?.height);
    expect(check.rootKeys).toEqual(MPC_ROOT_KEYS.testnet);
    expect(check.results.map((r) => r.match)).toEqual(testnetCases.map(() => true));
    expect(check.results[0].contract).toBe(derived.testnet.keys["satchel/1"]);
    expect(check.results[11]).toMatchObject({ predecessor: "tx-bench.testnet", path: "", domain: 1, local: TX_BENCH_ED25519, contract: TX_BENCH_ED25519 });
    expect(rpc.unused()).toEqual([]);
  });

  it("derives mainnet's satchel #1-#3 keys the same way", async () => {
    const cases = [1, 2, 3].map((i) => ({ predecessor: MAINNET.contract, path: `satchel/${i}`, domain: 0 as const }));
    const rpc = replayRpc(DERIVED.mainnet);
    const check = await crossCheckDerivation(rpc, MPC_CONTRACTS.mainnet, cases, { blockHash: DERIVED.mainnet.provenance.block?.hash as string });
    expect(check.results.every((r) => r.match)).toBe(true);
    expect(check.results[0].local).toBe(derived.mainnet.keys["satchel/1"]);
    expect(check.rootKeys).toEqual({ 0: MPC_ROOT_KEYS.mainnet[0] });
  });

  it("reports a contract key that differs as match: false, from that block's own root key", async () => {
    // In-test change: the contract's answer for satchel/2 is replaced by its answer for satchel/1.
    const changed = copy(DERIVED.testnet);
    const derivedViews = changed.calls.filter((c) => (c.params as { method_name?: string }).method_name === "derived_public_key");
    (derivedViews[1].result as { result: number[] }).result = (derivedViews[0].result as { result: number[] }).result;
    const check = await crossCheckDerivation(replayRpc(changed), MPC_CONTRACTS.testnet, testnetCases.slice(0, 2), {
      blockHash: changed.provenance.block?.hash as string,
    });
    expect(check.results.map((r) => r.match)).toEqual([true, false]);
    expect(check.results[1].local).toBe(derived.testnet.keys["satchel/2"]);
  });
});

// ---- Requests and answers, receipt by receipt -----------------------------------------------------

describe("mpcRequests, on the recorded transactions", () => {
  it("finds the owner's direct sign_evm on testnet EZLX…: one hop from sign to the callback", () => {
    const tx = TX.EZLX.result;
    const [found, ...more] = mpcRequests(tx, MPC_CONTRACTS.testnet);
    expect(more).toEqual([]);
    expect(found.request).toEqual({
      receiptId: SIGNED.EZLX.sign,
      blockHash: outcomeOf(tx, SIGNED.EZLX.sign).block_hash,
      signerId: "satchel-nft.testnet",
      predecessor: "v1.satchel-nft.testnet",
      path: "satchel/1",
      domain: 0,
      payload: { kind: "ecdsa", hex: "db23d1f97d37db73f8043be1db8d96ec494e5711fc845fab444b8f91e0601154" },
      form: "payload_v2",
      deposit: "1",
    });
    expect(found.status).toBe("signed");
    expect(found.detail).toBeNull();
    expect(found.hops).toEqual([SIGNED.EZLX.sign, SIGNED.EZLX.callback]);
    expect(found.callback).toEqual({
      receiptId: SIGNED.EZLX.callback,
      blockHash: outcomeOf(tx, SIGNED.EZLX.callback).block_hash,
      tweak: Array.from(deriveTweak("v1.satchel-nft.testnet", "satchel/1")),
      payload: { Ecdsa: "db23d1f97d37db73f8043be1db8d96ec494e5711fc845fab444b8f91e0601154" },
      domainId: 0,
    });
    // The answer is the one sign-evm-outcome.json (the same transaction, trimmed to its status) holds.
    expect(found.response).toEqual(outcomeValue(outcome));
  });

  it("follows the DAO vote 2ryQps… from the DAO, through Satchel's contract, to the MPC contract's callback", () => {
    const [found, ...more] = mpcRequests(TX["2ryQps"].result, MPC_CONTRACTS.testnet);
    expect(more).toEqual([]);
    expect(found.request).toMatchObject({
      receiptId: SIGNED["2ryQps"].sign,
      signerId: "satchel-nft.testnet",
      predecessor: "v1.satchel-nft.testnet",
      path: "satchel/8",
      domain: 0,
      payload: { kind: "ecdsa", hex: DAO.steps[5].signingHash.slice(2) },
      form: "payload_v2",
    });
    expect(found).toMatchObject({ status: "signed", hops: [SIGNED["2ryQps"].sign, SIGNED["2ryQps"].callback] });
    expect(found.callback?.tweak).toEqual(Array.from(deriveTweak("v1.satchel-nft.testnet", "satchel/8")));
  });

  it("reads the same request from the trimmed dao-vote-outcome.json, which has no block hashes", () => {
    const [full] = mpcRequests(TX["2ryQps"].result, MPC_CONTRACTS.testnet);
    const [trimmed] = mpcRequests(DAO_VOTE_TRIMMED, MPC_CONTRACTS.testnet);
    expect(trimmed.request).toEqual({ ...full.request, blockHash: null });
    expect(trimmed).toMatchObject({ status: "signed", hops: full.hops, response: full.response });
    expect(trimmed.callback).toEqual({ ...full.callback, blockHash: null });
  });

  it("finds tx-bench.testnet's ed25519 (domain 1) request FgbW… with an empty path", () => {
    const [found] = mpcRequests(TX.FgbW.result, MPC_CONTRACTS.testnet);
    expect(found.request).toMatchObject({
      receiptId: SIGNED.FgbW.sign,
      signerId: "tx-bench.testnet",
      predecessor: "tx-bench.testnet",
      path: "",
      domain: 1,
      payload: { kind: "eddsa", hex: "7e2b493e288257e87e31b17500f513fb59c1c4a5f61cd08ba57759dacdbd4829" },
      form: "payload_v2",
      deposit: "1",
    });
    expect(found.status).toBe("signed");
    expect(found.callback).toMatchObject({ receiptId: SIGNED.FgbW.callback, domainId: 1, payload: { Eddsa: found.request.payload.hex } });
    expect(found.response).toMatchObject({ scheme: "Ed25519" });
    expect((found.response as { signature: number[] }).signature).toHaveLength(64);
  });

  it("records HthQSVE… as it is: a second signed ed25519 request, not a timeout", () => {
    const [found] = mpcRequests(TX.HthQSVE.result, MPC_CONTRACTS.testnet);
    expect(found).toMatchObject({ status: "signed", hops: [SIGNED.HthQSVE.sign, SIGNED.HthQSVE.callback] });
    expect(found.request).toMatchObject({ domain: 1, path: "", predecessor: "tx-bench.testnet" });
  });

  it("finds the secp256k1 request with an empty path, 9FsA…, and mainnet satchel #1's and #2's requests on v1.signer", () => {
    expect(mpcRequests(TX["9FsA"].result, MPC_CONTRACTS.testnet)[0].request).toMatchObject({ domain: 0, path: "", predecessor: "tx-bench.testnet" });
    for (const [name, path] of [
      ["2xqwe8", "satchel/1"],
      ["FnFSMSh1", "satchel/2"],
    ] as const) {
      const [found, ...more] = mpcRequests(TX[name].result, MPC_CONTRACTS.mainnet);
      expect(more).toEqual([]);
      expect(found.request).toMatchObject({ receiptId: SIGNED[name].sign, predecessor: MAINNET.contract, signerId: "satchel-nft.near", path, domain: 0 });
      expect(found).toMatchObject({ status: "signed", hops: [SIGNED[name].sign, SIGNED[name].callback] });
    }
  });

  it("finds no request in a refused sign_evm that never reached the MPC contract, or on another MPC contract", () => {
    expect(mpcRequests(TX.GqFsnm.result, MPC_CONTRACTS.testnet)).toEqual([]);
    expect(mpcRequests(TX["33UTwy"].result, MPC_CONTRACTS.mainnet)).toEqual([]);
    expect(mpcRequests(TX.EZLX.result, MPC_CONTRACTS.mainnet)).toEqual([]);
  });

  it("reports a sign receipt that failed", () => {
    // In-test change: EZLX's sign receipt fails, as a sign with too little deposit would.
    const tx = copy(TX.EZLX.result);
    outcomeOf(tx, SIGNED.EZLX.sign).outcome.status = {
      Failure: { ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: Attached deposit is lower than required" } } } },
    };
    const [found] = mpcRequests(tx, MPC_CONTRACTS.testnet);
    expect(found).toMatchObject({ status: "failed", detail: "Smart contract panicked: Attached deposit is lower than required", response: null, callback: null });
    expect(found.hops).toEqual([SIGNED.EZLX.sign]);
  });

  it("reports a timed-out request: the callback goes to fail_on_timeout, which fails (Experimental: no real one is recorded)", () => {
    // In-test change (HthQSVE… turned out to be signed): FgbW's callback hands on to a new receipt that
    // runs fail_on_timeout on the MPC contract and fails, as sign.rs schedules on a timeout.
    const tx = copy(TX.FgbW.result);
    const timeoutId = "TimeoutReceipt1111111111111111111111111111";
    outcomeOf(tx, SIGNED.FgbW.callback).outcome.status = { SuccessReceiptId: timeoutId };
    tx.receipts_outcome.push({
      id: timeoutId,
      block_hash: outcomeOf(tx, SIGNED.FgbW.callback).block_hash,
      outcome: {
        executor_id: MPC_CONTRACTS.testnet,
        logs: [],
        receipt_ids: [],
        status: { Failure: { ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: Signature request has timed out." } } } } },
      },
    });
    tx.receipts?.push({
      receipt_id: timeoutId,
      predecessor_id: MPC_CONTRACTS.testnet,
      receiver_id: MPC_CONTRACTS.testnet,
      receipt: { Action: { actions: [{ FunctionCall: { method_name: "fail_on_timeout", args: "", deposit: "0", gas: 1 } }] } },
    });
    const [found] = mpcRequests(tx, MPC_CONTRACTS.testnet);
    expect(found).toMatchObject({ status: "timed-out", detail: "Smart contract panicked: Signature request has timed out.", response: null });
    expect(found.hops).toEqual([SIGNED.FgbW.sign, SIGNED.FgbW.callback, timeoutId]);

    // fail_on_timeout that did not fail is not a timeout.
    outcomeOf(tx, timeoutId).outcome.status = { SuccessValue: "" };
    expect(mpcRequests(tx, MPC_CONTRACTS.testnet)[0]).toMatchObject({ status: "inconsistent" });
  });

  it("reports a request whose callback has not run yet as pending", () => {
    // In-test change: EZLX as it looked before the MPC network answered: no callback outcome yet.
    const tx = copy(TX.EZLX.result);
    tx.receipts_outcome = tx.receipts_outcome.filter((r) => r.id !== SIGNED.EZLX.callback);
    expect(mpcRequests(tx, MPC_CONTRACTS.testnet)[0]).toMatchObject({ status: "pending", response: null });
    outcomeOf(tx, SIGNED.EZLX.sign).outcome.status = "Unknown";
    expect(mpcRequests(tx, MPC_CONTRACTS.testnet)[0]).toMatchObject({ status: "pending" });
  });

  it("calls a callback that does not match its request inconsistent, naming the field", () => {
    const callbackArgs = (tx: TxStatusView) => JSON.parse(decodeBase64(functionCallOf(tx, SIGNED.EZLX.callback).args));
    const withCallback = (change: (args: { tweak: number[]; payload: Record<string, string>; domain_id: number }[]) => void) => {
      const tx = copy(TX.EZLX.result);
      const args = callbackArgs(tx);
      change(args);
      functionCallOf(tx, SIGNED.EZLX.callback).args = encodeArgs(args);
      return mpcRequests(tx, MPC_CONTRACTS.testnet)[0];
    };
    // In-test changes to the callback's arguments, one at a time.
    expect(withCallback((a) => (a[0].tweak[0] ^= 1))).toMatchObject({ status: "inconsistent", detail: expect.stringContaining("tweak") });
    expect(withCallback((a) => (a[0].payload = { Ecdsa: `${"00".repeat(31)}01` }))).toMatchObject({ status: "inconsistent", detail: expect.stringContaining("payload") });
    expect(withCallback((a) => (a[0].payload = { Eddsa: a[0].payload.Ecdsa }))).toMatchObject({ status: "inconsistent", detail: expect.stringContaining("payload") });
    expect(withCallback((a) => (a[0].domain_id = 1))).toMatchObject({ status: "inconsistent", detail: expect.stringContaining("domain_id") });
    // Hex is compared without regard to case.
    expect(withCallback((a) => (a[0].payload = { Ecdsa: a[0].payload.Ecdsa.toUpperCase() }))).toMatchObject({ status: "signed" });
    // Not a one-element array.
    expect(withCallback((a) => a.push(a[0]))).toMatchObject({ status: "inconsistent" });
  });

  it("calls a hop that leaves the MPC contract, an answer that is not a signature, or a value with no callback inconsistent", () => {
    // In-test changes, one per case.
    const leaves = copy(TX.EZLX.result);
    outcomeOf(leaves, SIGNED.EZLX.callback).outcome.executor_id = "v1.satchel-nft.testnet";
    expect(mpcRequests(leaves, MPC_CONTRACTS.testnet)[0]).toMatchObject({ status: "inconsistent", detail: "a hop left the MPC contract" });

    const notSignature = copy(TX.EZLX.result);
    outcomeOf(notSignature, SIGNED.EZLX.callback).outcome.status = { SuccessValue: encodeArgs({ hello: "world" }) };
    expect(mpcRequests(notSignature, MPC_CONTRACTS.testnet)[0]).toMatchObject({ status: "inconsistent", response: null });

    const ed = copy(TX.EZLX.result);
    outcomeOf(ed, SIGNED.EZLX.callback).outcome.status = outcomeOf(TX.FgbW.result, SIGNED.FgbW.callback).outcome.status;
    expect(mpcRequests(ed, MPC_CONTRACTS.testnet)[0]).toMatchObject({ status: "inconsistent" });

    const value = copy(TX.EZLX.result);
    outcomeOf(value, SIGNED.EZLX.sign).outcome.status = { SuccessValue: "" };
    expect(mpcRequests(value, MPC_CONTRACTS.testnet)[0]).toMatchObject({ status: "inconsistent", hops: [SIGNED.EZLX.sign] });

    expect(mpcRequests(TX.EZLX.result, MPC_CONTRACTS.testnet, { maxHops: 0 })[0]).toMatchObject({ status: "inconsistent" });
  });

  it("returns two requests in one transaction in receipt order, where signatureFromReceipts refuses", () => {
    // In-test change: 9FsA's receipts appended to EZLX's, as one transaction holding both requests.
    const tx = copy(TX.EZLX.result);
    tx.receipts_outcome.push(...copy(TX["9FsA"].result.receipts_outcome));
    tx.receipts?.push(...copy(TX["9FsA"].result.receipts ?? []));
    const found = mpcRequests(tx, MPC_CONTRACTS.testnet);
    expect(found.map((f) => [f.request.receiptId, f.status])).toEqual([
      [SIGNED.EZLX.sign, "signed"],
      [SIGNED["9FsA"].sign, "signed"],
    ]);
    expect(() => signatureFromReceipts(TESTNET, tx as unknown as TxStatus)).toThrow(/holds 2 MPC signatures/);
  });

  it("reads the legacy request form (Experimental: none recorded), with key_version as near/mpc maps it", () => {
    // In-test changes: EZLX's request rewritten in the legacy form, `payload` as 32 numbers and
    // `key_version` for the domain. near/mpc reads key_version n as domain n.
    const legacy = (keyVersion: number) => {
      const tx = copy(TX.EZLX.result);
      const call = functionCallOf(tx, SIGNED.EZLX.sign);
      const { request } = JSON.parse(decodeBase64(call.args));
      call.args = encodeArgs({ request: { path: request.path, payload: Array.from(hexToBytes(request.payload_v2.Ecdsa)), key_version: keyVersion } });
      return mpcRequests(tx, MPC_CONTRACTS.testnet)[0];
    };
    expect(legacy(0)).toMatchObject({ status: "signed", request: { form: "legacy", domain: 0, payload: { kind: "ecdsa" } } });
    expect(legacy(5)).toMatchObject({ status: "inconsistent", detail: "legacy key_version 5 is not mapped", request: { domain: null } });
    // key_version 1 is domain 1 (ed25519), which a legacy (ECDSA) payload does not fit.
    expect(legacy(1)).toMatchObject({ status: "inconsistent", request: { domain: 1, payload: { kind: "ecdsa" } } });
  });

  it("calls a payload that does not fit its domain inconsistent", () => {
    // In-test change: EZLX's request asks for an Eddsa payload in domain 0.
    const tx = copy(TX.EZLX.result);
    const call = functionCallOf(tx, SIGNED.EZLX.sign);
    const { request } = JSON.parse(decodeBase64(call.args));
    call.args = encodeArgs({ request: { ...request, payload_v2: { Eddsa: request.payload_v2.Ecdsa } } });
    expect(mpcRequests(tx, MPC_CONTRACTS.testnet)[0]).toMatchObject({ status: "inconsistent", request: { domain: 0, payload: { kind: "eddsa" } } });
  });
});

describe("scanMpcResponses, parity with signatureFromReceipts (dao.ts)", () => {
  it("gives the answer signatureFromReceipts finds, on dao-vote-outcome.json and on EZLX… (sign-evm-outcome.json's transaction in full)", () => {
    for (const tx of [DAO_VOTE_TRIMMED, TX.EZLX.result, TX["2ryQps"].result]) {
      expect(scanMpcResponses(tx, TESTNET.mpc)).toEqual([signatureFromReceipts(TESTNET, tx as unknown as TxStatus)]);
    }
    // sign-evm-outcome.json keeps only EZLX's status: the answer is the same one.
    expect(scanMpcResponses(TX.EZLX.result, TESTNET.mpc)).toEqual([outcomeValue(outcome)]);
    expect(scanMpcResponses(TX["2xqwe8"].result, MAINNET.mpc)).toEqual([signatureFromReceipts(MAINNET, TX["2xqwe8"].result as unknown as TxStatus)]);
  });

  it("takes an answer without a scheme, as isMpcSignature does, and no ed25519 answer", () => {
    // In-test change: the scheme field dropped from EZLX's answer.
    const tx = copy(TX.EZLX.result);
    const answer = answerOf(tx, SIGNED.EZLX.callback) as Record<string, unknown>;
    delete answer.scheme;
    outcomeOf(tx, SIGNED.EZLX.callback).outcome.status = { SuccessValue: encodeArgs(answer) };
    expect(scanMpcResponses(tx, TESTNET.mpc)).toEqual([answer]);
    expect(scanMpcResponses(tx, TESTNET.mpc)).toEqual([signatureFromReceipts(TESTNET, tx as unknown as TxStatus)]);
    expect(scanMpcResponses(TX.FgbW.result, TESTNET.mpc)).toEqual([]);
  });
});

// ---- Signatures ---------------------------------------------------------------------------------

describe("verifySignature", () => {
  it("accepts every recorded MPC answer under the key derived from the pinned root key", () => {
    for (const name of [...SECP_SIGNED, ...ED_SIGNED]) {
      const response = answerOf(TX[name].result, SIGNED[name].callback);
      const result = verifySignature({ key: keyFor(name), payload: payloadOf(name), response });
      expect(result, name).toMatchObject({ ok: true, reason: "ok" });
    }
    expect(keyFor("FgbW")).toBe(TX_BENCH_ED25519);
  });

  it("gives the low-s EVM signature, which is the one in testnet-e2e.json's raw transaction", () => {
    const result = verifySignature({ key: keyFor("EZLX"), payload: payloadOf("EZLX"), response: answerOf(TX.EZLX.result, SIGNED.EZLX.callback) });
    const raw = parseTransaction(RAW);
    expect(result.evm).toEqual({ r: raw.r, s: raw.s, yParity: raw.yParity, highS: false });
  });

  it("normalizes a high s and flips the parity, so the same key recovers", () => {
    // In-test change: s replaced by n - s, and recovery_id flipped, as an MPC answer with high s would be.
    const response = answerOf(TX.EZLX.result, SIGNED.EZLX.callback) as Extract<MpcResponse, { big_r: unknown }>;
    const high = { ...response, s: { scalar: (SECP256K1_N - BigInt(`0x${response.s.scalar}`)).toString(16).padStart(64, "0") }, recovery_id: response.recovery_id ^ 1 };
    const low = verifySignature({ key: keyFor("EZLX"), payload: payloadOf("EZLX"), response });
    const flipped = verifySignature({ key: keyFor("EZLX"), payload: payloadOf("EZLX"), response: high });
    expect(flipped).toEqual({ ok: true, reason: "ok", evm: { ...low.evm, highS: true } });
  });

  describe("refuses, with a reason for each (in-test changes to recorded answers)", () => {
    const secpKey = keyFor("EZLX");
    const secpPayload = payloadOf("EZLX");
    const secp = answerOf(TX.EZLX.result, SIGNED.EZLX.callback) as Extract<MpcResponse, { big_r: unknown }>;
    const edPayload = payloadOf("FgbW");
    const ed = answerOf(TX.FgbW.result, SIGNED.FgbW.callback) as Extract<MpcResponse, { scheme: "Ed25519" }>;
    const reason = (input: { key?: string; payload?: Uint8Array; response?: unknown }, curve: "secp" | "ed" = "secp") =>
      verifySignature({
        key: input.key ?? (curve === "secp" ? secpKey : TX_BENCH_ED25519),
        payload: input.payload ?? (curve === "secp" ? secpPayload : edPayload),
        response: ("response" in input ? input.response : curve === "secp" ? secp : ed) as MpcResponse,
      }).reason;
    const withR = (hex: string) => ({ ...secp, big_r: { affine_point: hex } });
    const withS = (s: bigint) => ({ ...secp, s: { scalar: s.toString(16).padStart(64, "0") } });
    const hex64 = (n: bigint) => n.toString(16).padStart(64, "0");
    /** The first x at or above `from` that is (or is not) the x of a point on secp256k1. */
    const findX = (from: bigint, onCurve: boolean) => {
      for (let x = from; ; x++) {
        let ok = true;
        try {
          secp256k1.ProjectivePoint.fromHex(`02${hex64(x)}`);
        } catch {
          ok = false;
        }
        if (ok === onCurve) return x;
      }
    };

    it("scheme-mismatch and malformed-response", () => {
      expect(reason({ response: ed })).toBe("scheme-mismatch");
      expect(reason({ response: secp }, "ed")).toBe("scheme-mismatch");
      expect(reason({ response: { scheme: "Secp256k1" } })).toBe("malformed-response");
      expect(reason({ response: { ...secp, s: { scalar: "not hex" } } })).toBe("malformed-response");
      expect(reason({ response: null })).toBe("malformed-response");
      expect(reason({ response: { scheme: "Ed25519" } }, "ed")).toBe("malformed-response");
    });

    it("malformed-key, identity-key and small-order-key, on both curves", () => {
      expect(reason({ key: "secp256k1:2" })).toBe("malformed-key");
      expect(reason({ key: `secp256k1:${base58Encode(new Uint8Array(64).fill(1))}` })).toBe("malformed-key");
      expect(reason({ key: "ed25519:0OIl" }, "ed")).toBe("malformed-key");
      expect(reason({ key: "rsa:abc" })).toBe("malformed-key");
      // The identity, as 64 zero bytes on secp256k1 (near/mpc#4608), and as y = 1 on ed25519.
      expect(reason({ key: `secp256k1:${base58Encode(new Uint8Array(64))}` })).toBe("identity-key");
      const edIdentity = new Uint8Array(32);
      edIdentity[0] = 1;
      expect(reason({ key: `ed25519:${base58Encode(edIdentity)}` }, "ed")).toBe("identity-key");
      // Points of order 2 (y = -1) and 4 (y = 0).
      const order2 = hexToBytes("ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f");
      expect(ed25519.ExtendedPoint.fromHex(order2).isSmallOrder()).toBe(true);
      expect(reason({ key: `ed25519:${base58Encode(order2)}` }, "ed")).toBe("small-order-key");
      expect(reason({ key: `ed25519:${base58Encode(new Uint8Array(32))}` }, "ed")).toBe("small-order-key");
    });

    it("malformed-big-r and r-out-of-range, with an x(R) at or above n refused, not reduced", () => {
      expect(reason({ response: withR(`04${secp.big_r.affine_point.slice(2)}`) })).toBe("malformed-big-r");
      expect(reason({ response: withR(secp.big_r.affine_point.slice(0, 64)) })).toBe("malformed-big-r");
      expect(reason({ response: withR(`02${hex64(findX(1n, false))}`) })).toBe("malformed-big-r");
      expect(reason({ response: withR(`02${hex64(0n)}`) })).toBe("r-out-of-range");
      const xAboveN = findX(SECP256K1_N, true);
      expect(xAboveN < SECP256K1_P).toBe(true);
      expect(reason({ response: withR(`02${hex64(xAboveN)}`) })).toBe("r-out-of-range");
    });

    it("s-out-of-range and bad-recovery-id", () => {
      expect(reason({ response: withS(0n) })).toBe("s-out-of-range");
      expect(reason({ response: withS(SECP256K1_N) })).toBe("s-out-of-range");
      expect(reason({ response: { ...secp, recovery_id: 2 } })).toBe("bad-recovery-id");
      expect(reason({ response: { ...secp, recovery_id: 3 } })).toBe("bad-recovery-id");
    });

    it("payload-not-32-bytes and payload-not-scalar (sign.rs refuses an ECDSA payload that is not a scalar)", () => {
      expect(reason({ payload: secpPayload.subarray(1) })).toBe("payload-not-32-bytes");
      expect(reason({ payload: hexToBytes(hex64(SECP256K1_N)) })).toBe("payload-not-scalar");
    });

    it("malformed-signature, invalid-signature and recovery-mismatch", () => {
      expect(reason({ response: { ...ed, signature: ed.signature.slice(1) } }, "ed")).toBe("malformed-signature");
      expect(reason({ response: { ...ed, signature: [256, ...ed.signature.slice(1)] } }, "ed")).toBe("malformed-signature");
      const flipped = Uint8Array.from(secpPayload);
      flipped[31] ^= 1;
      expect(reason({ payload: flipped })).toBe("invalid-signature");
      const edFlipped = Uint8Array.from(edPayload);
      edFlipped[0] ^= 1;
      expect(reason({ payload: edFlipped }, "ed")).toBe("invalid-signature");
      expect(reason({ key: keyFor("9FsA") })).toBe("invalid-signature");
      // The same (r, s) verifies, but recovery_id names the other R: it recovers another key.
      expect(reason({ response: { ...secp, recovery_id: secp.recovery_id ^ 1 } })).toBe("recovery-mismatch");
    });

    it("never throws, whatever it is given", () => {
      for (const input of [{}, { key: 5 }, { key: secpKey, payload: "x" }, { key: TX_BENCH_ED25519, payload: edPayload, response: { scheme: "Ed25519", signature: "no" } }]) {
        expect(() => verifySignature(input as never)).not.toThrow();
        expect(verifySignature(input as never).ok).toBe(false);
      }
    });
  });
});

describe("normalizeEcdsa, parity with toEvmSignature (evm.ts)", () => {
  it("gives toEvmSignature's s and yParity for every recorded answer and a high-s change of each", () => {
    for (const name of SECP_SIGNED) {
      const answer = answerOf(TX[name].result, SIGNED[name].callback) as MpcSignature;
      // In-test change: the high-s twin of the same answer.
      const high = { ...answer, s: { scalar: (SECP256K1_N - BigInt(`0x${answer.s.scalar}`)).toString(16).padStart(64, "0") }, recovery_id: answer.recovery_id ^ 1 };
      for (const a of [answer, high]) {
        const ours = normalizeEcdsa(a.s.scalar, a.recovery_id);
        const theirs = toEvmSignature(a);
        expect(ours.s).toBe(BigInt(theirs.s));
        expect(ours.yParity).toBe(theirs.yParity);
      }
      expect(normalizeEcdsa(high.s.scalar, high.recovery_id).highS).toBe(true);
      expect(normalizeEcdsa(answer.s.scalar, answer.recovery_id).highS).toBe(false);
    }
    expect(() => normalizeEcdsa("01", 2)).toThrow(/recovery_id/);
  });
});

// ---- Audits -------------------------------------------------------------------------------------

describe("auditSignTx, through replayRpc", () => {
  it("verifies the owner's sign_evm EZLX…: satchel #1's key and address", async () => {
    const audit = await auditOf("EZLX", "testnet");
    expect(audit).toMatchObject({ tx: TX.EZLX.result.transaction.hash, signerId: "satchel-nft.testnet", block: TX.EZLX.result.transaction_outcome.block_hash });
    expect(audit.verdict).toBe("all-verified");
    expect(audit.orphanResponses).toBe(0);
    expect(audit.requests).toHaveLength(1);
    expect(audit.requests[0]).toMatchObject({
      status: "signed",
      derivedKey: derived.testnet.keys["satchel/1"],
      verify: { ok: true, reason: "ok" },
      evmAddress: TOKEN_1,
    });
    expect(JSON.parse(JSON.stringify(audit))).toEqual(audit);
  });

  it("verifies the DAO vote 2ryQps…: satchel #8's address, as testnet-dao.json records it", async () => {
    const audit = await auditOf("2ryQps", "testnet");
    expect(audit.verdict).toBe("all-verified");
    expect(audit.requests[0].request.receiptId).toBe(SIGNED["2ryQps"].sign);
    expect(audit.requests[0].callback?.receiptId).toBe(SIGNED["2ryQps"].callback);
    expect(audit.requests[0].evmAddress).toBe(getAddress(DAO.address));
  });

  it("verifies tx-bench.testnet's requests in both domains: FgbW…, HthQSVE… (ed25519) and 9FsA… (secp256k1)", async () => {
    for (const name of ["FgbW", "HthQSVE"] as const) {
      const audit = await auditOf(name, "testnet");
      expect(audit.verdict).toBe("all-verified");
      expect(audit.requests[0]).toMatchObject({ derivedKey: TX_BENCH_ED25519, evmAddress: null, verify: { ok: true } });
    }
    const audit = await auditOf("9FsA", "testnet");
    expect(audit.verdict).toBe("all-verified");
    expect(audit.requests[0].derivedKey).toBe(keyFor("9FsA"));
  });

  it("verifies mainnet satchel #1's and #2's sign_evm, with the addresses deployments records", async () => {
    const first = await auditOf("2xqwe8", "mainnet");
    expect(first.verdict).toBe("all-verified");
    expect(first.requests[0].evmAddress).toBe(getAddress(FIRST_SEND.address));
    const exit = await auditOf("FnFSMSh1", "mainnet");
    expect(exit.verdict).toBe("all-verified");
    expect(exit.requests[0].evmAddress).toBe(getAddress(EXIT.address));
  });

  it("gives no-requests for the refused sign_evm calls GqFsnm… (testnet) and 33UTwy… (mainnet)", async () => {
    for (const [name, network] of [
      ["GqFsnm", "testnet"],
      ["33UTwy", "mainnet"],
    ] as const) {
      const audit = await auditOf(name, network);
      expect(audit).toMatchObject({ requests: [], verdict: "no-requests", orphanResponses: 0 });
    }
  });

  it("verifies only the domains whose root key was passed, and never fetches one", async () => {
    const audit = await auditOf("FgbW", "testnet", { rootKeys: { 0: MPC_ROOT_KEYS.testnet[0] } });
    expect(audit.requests[0]).toMatchObject({ status: "signed", derivedKey: null, verify: null, evmAddress: null });
    expect(audit.verdict).toBe("some-unverified");
  });

  it("gives the first verdict that applies: inconsistent, then failed, then pending, then unverified", async () => {
    // In-test changes to EZLX with 9FsA's receipts appended: one request changed per case.
    const two = copy(TX.EZLX.result);
    two.receipts_outcome.push(...copy(TX["9FsA"].result.receipts_outcome));
    two.receipts?.push(...copy(TX["9FsA"].result.receipts ?? []));
    const failure = { Failure: { ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: no" } } } } };

    const failed = copy(two);
    outcomeOf(failed, SIGNED["9FsA"].sign).outcome.status = failure;
    expect((await auditOf("EZLX", "testnet", { result: failed })).verdict).toBe("has-failed");

    const pending = copy(two);
    pending.receipts_outcome = pending.receipts_outcome.filter((r) => r.id !== SIGNED["9FsA"].callback);
    expect((await auditOf("EZLX", "testnet", { result: pending })).verdict).toBe("has-pending");

    const inconsistent = copy(failed);
    outcomeOf(inconsistent, SIGNED.EZLX.callback).outcome.executor_id = "someone.testnet";
    expect((await auditOf("EZLX", "testnet", { result: inconsistent })).verdict).toBe("has-inconsistent");

    const unverified = copy(two);
    const answer = answerOf(unverified, SIGNED["9FsA"].callback) as Extract<MpcResponse, { big_r: unknown }>;
    outcomeOf(unverified, SIGNED["9FsA"].callback).outcome.status = { SuccessValue: encodeArgs({ ...answer, recovery_id: answer.recovery_id ^ 1 }) };
    const audit = await auditOf("EZLX", "testnet", { result: unverified });
    expect(audit.verdict).toBe("some-unverified");
    expect(audit.requests[1].verify?.reason).toBe("recovery-mismatch");
  });

  it("counts an MPC answer no request reaches as an orphan", async () => {
    // In-test change: an extra receipt the MPC contract ran, returning 9FsA's answer, reached by no request.
    const tx = copy(TX.EZLX.result);
    tx.receipts_outcome.push({ ...copy(outcomeOf(TX["9FsA"].result, SIGNED["9FsA"].callback)), id: "Orphan11111111111111111111111111111111111111" });
    const audit = await auditOf("EZLX", "testnet", { result: tx });
    expect(audit.orphanResponses).toBe(1);
    expect(audit.verdict).toBe("all-verified");
  });
});

// ---- EVM proofs ---------------------------------------------------------------------------------

/** A viem client that answers from an EVM cassette (or a changed copy), through readOnlyEvm. */
const replayClient = (cassette: Cassette, chain = sepolia) => createPublicClient({ chain, transport: custom({ request: readOnlyEvm(replayEvm(cassette)) }, { retryCount: 0 }) });
const callOf = (cassette: Cassette, method: string) => {
  const call = cassette.calls.find((c) => c.method === method);
  if (!call) throw new Error(`no ${method} in the cassette`);
  return call;
};
const EVM = {
  sepolia: { cassette: evmCassette("evm-sepolia-27e3"), hash: DAO.steps[7].sepolia.tx as Hex, chainId: 11155111, chain: sepolia, near: "2ryQps" as const, network: "testnet" as const },
  base8044: { cassette: evmCassette("evm-base-8044"), hash: FIRST_SEND.baseTx as Hex, chainId: 8453, chain: base, near: "2xqwe8" as const, network: "mainnet" as const },
  base2d9b: { cassette: evmCassette("evm-base-2d9b"), hash: EXIT.deposit.tx as Hex, chainId: 8453, chain: base, near: "FnFSMSh1" as const, network: "mainnet" as const },
};
const ALL_CHECKS = ["node-chain-id", "tx-chain-id", "tx-type", "tx-hash", "signing-hash", "r", "s", "y-parity", "sender", "receipt", "finalized"];
const failing = (proof: { checks: { id: string; ok: boolean }[] }) => proof.checks.filter((c) => !c.ok).map((c) => c.id);

describe("proveEvmTx, on the recorded Sepolia and Base cassettes", () => {
  const prove = async (key: keyof typeof EVM, cassette = EVM[key].cassette, audit?: SignTxAudit) =>
    proveEvmTx({
      audit: audit ?? (await auditOf(EVM[key].near, EVM[key].network)),
      client: replayClient(cassette, EVM[key].chain as typeof sepolia),
      hash: EVM[key].hash,
      expectedChainId: EVM[key].chainId,
    });

  it("proves satchel #8's Sepolia send 0x27e3…5ba3 is what the DAO vote's MPC answer signed", async () => {
    const proof = await prove("sepolia");
    expect(proof.checks.map((c) => c.id)).toEqual(ALL_CHECKS);
    expect(failing(proof)).toEqual([]);
    expect(proof.verdict).toBe("proven");
    expect(proof.evm).toEqual({ chainId: 11155111, hash: EVM.sepolia.hash, from: getAddress(DAO.address), nonce: 0, blockNumber: "12102812", status: "success" });
    expect(proof.near).toEqual({ tx: TX["2ryQps"].result.transaction.hash, receiptId: SIGNED["2ryQps"].sign, predecessor: TESTNET.contract, path: "satchel/8" });
    expect(JSON.parse(JSON.stringify(proof))).toEqual(proof);
  });

  it("proves mainnet satchel #1's Base send 0x8044…9532 and satchel #2's 1Click deposit 0x2d9b…7d74", async () => {
    const first = await prove("base8044");
    expect(first.verdict).toBe("proven");
    expect(first.evm).toMatchObject({ from: getAddress(FIRST_SEND.address), nonce: 0, blockNumber: "55178996", status: "success" });
    const exit = await prove("base2d9b");
    expect(exit.verdict).toBe("proven");
    expect(exit.evm).toMatchObject({ from: getAddress(EXIT.address), blockNumber: "55860595" });
  });

  it("is not proven when the node serves another chain, or the transaction names another chain", async () => {
    // In-test changes to the Sepolia cassette: the node answers chain 1; then the transaction's chainId is 1.
    const node = copy(EVM.sepolia.cassette);
    callOf(node, "eth_chainId").result = "0x1";
    const onOther = await prove("sepolia", node);
    expect(onOther.verdict).toBe("not-proven");
    expect(failing(onOther)).toEqual(["node-chain-id"]);

    const txChain = copy(EVM.sepolia.cassette);
    (callOf(txChain, "eth_getTransactionByHash").result as Record<string, unknown>).chainId = "0x1";
    const proof = await prove("sepolia", txChain);
    expect(proof.verdict).toBe("not-proven");
    expect(failing(proof)).toEqual(expect.arrayContaining(["tx-chain-id", "tx-hash"]));
  });

  it("refuses a blob (type 3) transaction, whose signing covers more than is rebuilt here", async () => {
    // In-test change: the transaction relabelled type 3, with a blob fee and a blob hash.
    const blob = copy(EVM.sepolia.cassette);
    Object.assign(callOf(blob, "eth_getTransactionByHash").result as Record<string, unknown>, {
      type: "0x3",
      maxFeePerBlobGas: "0x1",
      blobVersionedHashes: [`0x01${"00".repeat(31)}`],
    });
    const proof = await prove("sepolia", blob);
    expect(proof.verdict).toBe("not-proven");
    expect(failing(proof)).toEqual(expect.arrayContaining(["tx-type", "tx-hash", "signing-hash"]));
  });

  it("is not proven when a field differs from what was hashed, or the block is not finalized yet", async () => {
    // In-test change: the node reports one more wei of value than the signed transaction carries.
    const changed = copy(EVM.sepolia.cassette);
    const tx = callOf(changed, "eth_getTransactionByHash").result as { value: string };
    tx.value = `0x${(BigInt(tx.value) + 1n).toString(16)}`;
    const proof = await prove("sepolia", changed);
    expect(proof.verdict).toBe("not-proven");
    expect(failing(proof)).toContain("tx-hash");

    // In-test change: the finalized block is one below the transaction's block.
    const early = copy(EVM.sepolia.cassette);
    (callOf(early, "eth_getBlockByNumber").result as { number: string }).number = `0x${(12102812n - 1n).toString(16)}`;
    const notFinal = await prove("sepolia", early);
    expect(failing(notFinal)).toEqual(["finalized"]);
    expect(notFinal.verdict).toBe("not-proven");
  });

  it("is not proven against another NEAR request's answer", async () => {
    const proof = await prove("sepolia", EVM.sepolia.cassette, await auditOf("EZLX", "testnet"));
    expect(proof.verdict).toBe("not-proven");
    expect(failing(proof)).toEqual(expect.arrayContaining(["signing-hash", "r", "s", "sender"]));
    const none = await prove("sepolia", EVM.sepolia.cassette, await auditOf("GqFsnm", "testnet"));
    expect(none.verdict).toBe("not-proven");
  });

  it("fails tx-chain-id for a pre-EIP-155 legacy transaction (Experimental: none recorded)", async () => {
    // In-test change: the Sepolia transaction rewritten as a legacy one with v = 28 and no chain id.
    const legacy = copy(EVM.sepolia.cassette);
    const tx = callOf(legacy, "eth_getTransactionByHash").result as Record<string, unknown>;
    Object.assign(tx, { type: "0x0", gasPrice: tx.maxFeePerGas, v: "0x1c" });
    for (const field of ["chainId", "maxFeePerGas", "maxPriorityFeePerGas", "accessList", "yParity"]) delete tx[field];
    const proof = await prove("sepolia", legacy);
    expect(proof.verdict).toBe("not-proven");
    expect(failing(proof)).toContain("tx-chain-id");
    expect(proof.checks.find((c) => c.id === "tx-type")).toMatchObject({ ok: true, detail: expect.stringContaining("Experimental") });
  });
});

describe("proveRawTx", () => {
  it("proves testnet-e2e.json's never-broadcast raw transaction is signed by EZLX…'s MPC answer", async () => {
    const audit = await auditOf("EZLX", "testnet");
    const proof = proveRawTx({ audit, raw: RAW, expectedChainId: 11155111 });
    expect(proof.checks.map((c) => c.id)).toEqual(["tx-chain-id", "tx-type", "signing-hash", "r", "s", "y-parity", "sender"]);
    expect(failing(proof)).toEqual([]);
    expect(proof.verdict).toBe("proven");
    expect(proof.evm).toEqual({ chainId: 11155111, hash: keccak256(RAW), from: TOKEN_1, nonce: 0, blockNumber: null, status: null });
  });

  it("is not proven for another chain, another request, or bytes that are not a transaction", async () => {
    const audit = await auditOf("EZLX", "testnet");
    expect(failing(proveRawTx({ audit, raw: RAW, expectedChainId: 1 }))).toEqual(["tx-chain-id"]);
    const other = proveRawTx({ audit: await auditOf("9FsA", "testnet"), raw: RAW, expectedChainId: 11155111 });
    expect(other.verdict).toBe("not-proven");
    expect(proveRawTx({ audit, raw: "0x1234", expectedChainId: 11155111 }).verdict).toBe("not-proven");
  });
});

// ---- The EVM read-only guard --------------------------------------------------------------------

describe("readOnlyEvm, readOnlyEvmClient and evmJsonRpc", () => {
  it("refuses eth_sendRawTransaction of the real raw transaction, and every signing method, before calling the node", async () => {
    const request = vi.fn(async () => "0x1");
    const guarded = readOnlyEvm(request);
    for (const [method, params] of [
      ["eth_sendRawTransaction", [RAW]],
      ["eth_sendTransaction", [{}]],
      ["eth_sign", []],
      ["personal_sign", []],
      ["eth_signTransaction", [{}]],
      ["eth_signTypedData_v4", []],
      ["eth_call", []],
    ] as const) {
      await expect(guarded({ method, params })).rejects.toBeInstanceOf(ReadOnlyError);
    }
    expect(request).not.toHaveBeenCalled();
    for (const method of EVM_READ_METHODS) await guarded({ method, params: [] });
    expect(request).toHaveBeenCalledTimes(EVM_READ_METHODS.length);
  });

  it("gives a client whose sendRawTransaction rejects with ReadOnlyError, and no fetch happens", async () => {
    const fetch = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    try {
      const client = readOnlyEvmClient(sepolia, "http://127.0.0.1:9");
      const err = await client.sendRawTransaction({ serializedTransaction: RAW }).then(
        () => null,
        (e: unknown) => e,
      );
      const chain: unknown[] = [];
      for (let e = err as { cause?: unknown } | undefined; e; e = e.cause as { cause?: unknown } | undefined) chain.push(e);
      expect(chain.some((e) => e instanceof ReadOnlyError)).toBe(true);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("posts plain JSON-RPC and names only the node's origin in errors (transport, fake fetch)", async () => {
    const seen: { url: string; body: unknown }[] = [];
    const answers = [
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0xaa36a7" })),
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 2, error: { code: -32000, message: "header not found" } })),
      new Response("busy", { status: 429 }),
    ];
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return answers.shift() as Response;
    });
    const request = evmJsonRpc("https://rpc.example.org/v2/SECRET-KEY", { fetch: fetch as unknown as typeof globalThis.fetch });
    expect(await request({ method: "eth_chainId" })).toBe("0xaa36a7");
    expect(seen[0]).toMatchObject({ url: "https://rpc.example.org/v2/SECRET-KEY", body: { jsonrpc: "2.0", method: "eth_chainId" } });
    const rpcError = await request({ method: "eth_getTransactionByHash", params: ["0x01"] }).catch((e: unknown) => e);
    expect(rpcError).toMatchObject({ code: -32000 });
    const httpError = await request({ method: "eth_chainId" }).catch((e: unknown) => e as Error);
    expect(httpError).toMatchObject({ status: 429 });
    for (const e of [rpcError, httpError]) expect(`${(e as Error).message} ${JSON.stringify(e)}`).not.toContain("SECRET-KEY");
  });
});

it("the recorded EVM cassettes hold only the four read methods", () => {
  for (const { cassette } of Object.values(EVM)) {
    expect(new Set(cassette.calls.map((c) => c.method))).toEqual(new Set(EVM_READ_METHODS));
  }
});
