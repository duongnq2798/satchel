import { readFileSync } from "node:fs";
import { bytesToHex } from "@noble/hashes/utils";
import { describe, expect, it } from "vitest";
import { type Cassette, loadFixture, replayRpc } from "./__fixtures__/replay.js";
import { TEST_KEY } from "./__fixtures__/test-key.js";
import { base58Encode } from "./base58.js";
import type { RpcCall } from "./near-rpc.js";
import { nep413Hash } from "./nep413.js";
import { NEP641_LIMITS, type OffchainMessage, encodeOffchainMessage, nep641Hash, nep641ToNep413, parseAccessKeyAuthorization, verifyNep641Leaf } from "./nep641.js";

// The codec is checked against the two doc-test vectors of near/intents' reference implementation
// (nep641-vectors.json, copied with URL and commit). The resolver runs on nep641-testnet-final.json,
// what testnet answered at one final block about the unit tests' key (__fixtures__/test-key.ts): its
// implicit account does not exist, Satchel's contract exists and does not hold it, and a sub-account
// of the contract can never exist. A case that needs another answer changes a deep copy and says so.

interface Vectors {
  result: {
    domainSeparator: string;
    hash: { msg: OffchainMessage; hash: string };
    nep413: { msg: OffchainMessage; callbackUrl: string; payload: { message: string; nonce: string; recipient: string; callbackUrl: string } };
  };
}

const VECTORS = loadFixture<Vectors>("primitives/account-proof/nep641-vectors.json").result;
const CASSETTE = loadFixture<Cassette>("primitives/account-proof/nep641-testnet-final.json");
const BLOCK_HASH = CASSETTE.provenance.block?.hash as string;
const AT = { blockHash: BLOCK_HASH };
const CONTRACT = (JSON.parse(readFileSync(new URL("../../../deployments/testnet.json", import.meta.url), "utf8")) as { contract: string }).contract;
const MISSING = `missing.${CONTRACT}`;

type Recorded = Cassette["calls"][number];
const copy = <T>(value: T): T => structuredClone(value);
const params = (c: Recorded) => c.params as Record<string, unknown>;

/** The block's timestamp in nanoseconds, from the recorded `block` answer. */
const BLOCK_NS = BigInt((CASSETTE.calls.find((c) => c.method === "block")?.result as { header: { timestamp_nanosec: string } }).header.timestamp_nanosec);

/** `ns` as RFC 3339 with nine fractional digits and a Z. */
function rfc3339(ns: bigint): string {
  const seconds = new Date(Number(ns / 1_000_000_000n) * 1000).toISOString().slice(0, 19);
  return `${seconds}.${String(ns % 1_000_000_000n).padStart(9, "0")}Z`;
}

/** A leaf message for the test key, one minute before the cassette's block unless changed. */
const message = (change: Partial<OffchainMessage> = {}): OffchainMessage => ({
  chain_id: "testnet",
  signer_id: TEST_KEY.implicit,
  timestamp: rfc3339(BLOCK_NS - 60_000_000_000n),
  payload: JSON.stringify({ domain: "satchelnft.xyz", action: "Login", msg: "unit test" }),
  ...change,
});

/** An AccessKeyAuthorization of `msg`, signed by the test key over its NEP-413 mapping. */
function leaf(msg: OffchainMessage, callbackUrl?: string) {
  return {
    msg,
    via: callbackUrl === undefined ? { schema: "nep413" } : { schema: "nep413", extra: { callback_url: callbackUrl } },
    access_key: TEST_KEY.publicKey,
    signature: TEST_KEY.sign(nep413Hash(nep641ToNep413(msg, callbackUrl))),
  };
}

/** An RpcCall that answers from `cassette` and counts what it was asked. */
function counted(cassette: Cassette = CASSETTE) {
  const replay = replayRpc(cassette);
  const asked: string[] = [];
  const call = (async (method: string, p: unknown) => {
    asked.push(method);
    return replay(method, p);
  }) as RpcCall;
  return Object.assign(call, { asked, unused: replay.unused });
}

const expectTestnet = (signerId: string = TEST_KEY.implicit, path?: string[]) => ({ chainId: "testnet" as const, signerId, ...(path ? { path } : {}) });

/** A copy of the cassette in which the test key's view_access_key on `account` answers `permission`. */
function holding(account: string, permission: unknown): Cassette {
  const mutated = copy(CASSETTE);
  const call = mutated.calls.find((c) => params(c).request_type === "view_access_key" && params(c).account_id === account);
  if (!call) throw new Error(`no recorded view_access_key for ${account}`);
  call.result = { block_hash: BLOCK_HASH, block_height: CASSETTE.provenance.block?.height, nonce: 0, permission };
  return mutated;
}

describe("the NEP-641 codec, on near/intents' doc-test vectors", () => {
  it("hashes the message as sha3_256(domain separator || borsh(msg))", () => {
    expect(bytesToHex(nep641Hash(VECTORS.hash.msg))).toBe(VECTORS.hash.hash);
  });

  it("lays out borsh: chain_id, signer_id, path, the timestamp as u64 nanoseconds, payload", () => {
    const bytes = encodeOffchainMessage(VECTORS.hash.msg);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const text = (at: number) => {
      const n = view.getUint32(at, true);
      return { value: new TextDecoder().decode(bytes.subarray(at + 4, at + 4 + n)), next: at + 4 + n };
    };
    const chain = text(0);
    const signer = text(chain.next);
    expect([chain.value, signer.value]).toEqual(["mainnet", "extension.near"]);
    expect(view.getUint32(signer.next, true)).toBe(1);
    const path0 = text(signer.next + 4);
    expect(path0.value).toBe("wallet.near");
    const ns = BigInt(Date.parse("2026-08-05T07:28:00Z")) * 1_000_000n + 123_456_789n;
    expect(view.getBigUint64(path0.next, true)).toBe(ns);
    const payload = text(path0.next + 8);
    expect(payload).toEqual({ value: "Hello, Near!", next: bytes.length });
  });

  it("maps a message to NEP-413: payload as message, the hash as nonce, the path and the time in seconds in the recipient", () => {
    const { msg, callbackUrl, payload } = VECTORS.nep413;
    const mapped = nep641ToNep413(msg, callbackUrl);
    expect(mapped.message).toBe(payload.message);
    expect(bytesToHex(mapped.nonce)).toBe(payload.nonce);
    expect(mapped.recipient).toBe(payload.recipient);
    expect(mapped.callbackUrl).toBe(payload.callbackUrl);
    expect(nep641ToNep413(msg).callbackUrl).toBeNull();
    // The nonce is the hash of this (two-hop) message, not of the hash vector's.
    expect(bytesToHex(nep641Hash(msg))).toBe(payload.nonce);
  });

  it("binds the timestamp to the nanosecond through the hash, while the recipient shows whole seconds", () => {
    const base = { ...VECTORS.hash.msg, path: [] };
    const plain = nep641ToNep413({ ...base, timestamp: "2026-08-05T07:28:00Z" });
    const tenth = nep641ToNep413({ ...base, timestamp: "2026-08-05T07:28:00.1Z" });
    const oneNs = nep641ToNep413({ ...base, timestamp: "2026-08-05T07:28:00.000000001Z" });
    expect(plain.recipient).toBe("mainnet: extension.near @ 2026-08-05T07:28:00Z");
    expect(tenth.recipient).toBe(plain.recipient);
    expect(oneNs.recipient).toBe(plain.recipient);
    expect(bytesToHex(plain.nonce)).not.toBe(bytesToHex(oneNs.nonce));
    expect(bytesToHex(tenth.nonce)).toBe(bytesToHex(nep641Hash({ ...base, timestamp: "2026-08-05T07:28:00.100000000Z" })));
    // An omitted path and an empty one encode the same.
    const { path: _drop, ...noPath } = base;
    expect(encodeOffchainMessage(noPath)).toEqual(encodeOffchainMessage(base));
  });

  it("throws on a timestamp it cannot encode", () => {
    for (const timestamp of ["2026-08-05T07:28:00+00:00", "2026-08-05 07:28:00Z", "1969-12-31T23:59:59Z", "2026-02-30T00:00:00Z", "not a time"]) {
      expect(() => encodeOffchainMessage({ ...VECTORS.hash.msg, timestamp }), timestamp).toThrow(/timestamp/);
    }
  });
});

describe("parseAccessKeyAuthorization", () => {
  it("takes the authorization as JSON or as the blob string, with or without path and extra", () => {
    const signed = leaf(message(), "https://satchelnft.xyz/callback");
    const parsed = parseAccessKeyAuthorization(signed);
    expect(parsed).toEqual({ ok: true, value: { ...signed, msg: { ...signed.msg, path: [] } } });
    expect(parseAccessKeyAuthorization(JSON.stringify(signed))).toEqual(parsed);
    const withPath = leaf(message({ path: [] }));
    expect(parseAccessKeyAuthorization(withPath)).toMatchObject({ ok: true, value: { msg: { path: [] }, via: { schema: "nep413" } } });
    expect(parseAccessKeyAuthorization({ ...withPath, via: { schema: "nep413", extra: {} } }).ok).toBe(true);
    expect(parseAccessKeyAuthorization({ ...withPath, via: { schema: "nep413", extra: { callback_url: null } } }).ok).toBe(true);
  });

  it("refuses an unknown field at every level", () => {
    const signed = leaf(message(), "https://satchelnft.xyz/callback");
    const cases = [
      { ...signed, extra: 1 },
      { ...signed, msg: { ...signed.msg, nonce: "x" } },
      { ...signed, via: { ...signed.via, version: 2 } },
      { ...signed, via: { schema: "nep413", extra: { callback_url: "https://satchelnft.xyz/callback", state: "x" } } },
    ];
    for (const c of cases) expect(parseAccessKeyAuthorization(c)).toMatchObject({ ok: false, code: "unknown-field" });
  });

  it("refuses a timestamp that is not RFC 3339 in UTC with a Z, or that borsh cannot hold", () => {
    const signed = leaf(message());
    for (const timestamp of [
      "2026-08-05T07:28:00+00:00",
      "2026-08-05T07:28:00+07:00",
      "2026-08-05T07:28:00z",
      "2026-08-05T07:28Z",
      "2026-08-05T07:28:00.1234567890Z",
      "2026-02-30T00:00:00Z",
      "2026-08-05T24:00:00Z",
      "1969-12-31T23:59:59Z",
      "2600-01-01T00:00:00Z",
    ]) {
      expect(parseAccessKeyAuthorization({ ...signed, msg: { ...signed.msg, timestamp } }), timestamp).toMatchObject({ ok: false, code: "timestamp-format" });
    }
  });

  it("refuses a schema other than nep413", () => {
    const signed = leaf(message());
    expect(parseAccessKeyAuthorization({ ...signed, via: { schema: "nep461" } })).toMatchObject({ ok: false, code: "wrong-schema" });
    expect(parseAccessKeyAuthorization({ ...signed, via: { schema: "Nep413" } })).toMatchObject({ ok: false, code: "wrong-schema" });
  });

  it("refuses malformed input as a value, never a throw", () => {
    const signed = leaf(message());
    const { payload: _payload, ...noPayload } = signed.msg;
    const cases: unknown[] = [
      null,
      42,
      "not json",
      "[]",
      [],
      {},
      { ...signed, msg: noPayload },
      { ...signed, msg: { ...signed.msg, payload: 1 } },
      { ...signed, msg: { ...signed.msg, signer_id: "Not An Account" } },
      { ...signed, msg: { ...signed.msg, path: ["ok.testnet", "-bad"] } },
      { ...signed, msg: { ...signed.msg, path: "ok.testnet" } },
      { ...signed, msg: { ...signed.msg, path: null } },
      { ...signed, access_key: "constructor:abc" },
      { ...signed, msg: { ...signed.msg, timestamp: 1786951680 } },
      { ...signed, via: "nep413" },
      { ...signed, via: { schema: "nep413", extra: { callback_url: 1 } } },
      { ...signed, via: { schema: "nep413", extra: null } },
      { ...signed, access_key: TEST_KEY.publicKey.slice("ed25519:".length) },
      { ...signed, access_key: "ed25519:0OIl" },
      { ...signed, access_key: `ed25519:${TEST_KEY.publicKey.slice(9, 30)}` },
      { ...signed, signature: signed.signature.slice(0, 40) },
      { ...signed, signature: "rsa:abc" },
    ];
    for (const c of cases) {
      const parsed = parseAccessKeyAuthorization(c);
      expect(parsed.ok, JSON.stringify(c)?.slice(0, 120)).toBe(false);
      if (!parsed.ok) expect(parsed.reason.length).toBeGreaterThan(0);
    }
  });

  it("caps every size before decoding or hashing anything (too-long), and takes what is just within the caps", () => {
    const signed = leaf(message());
    const big = (n: number) => "a".repeat(n);
    const tooLong: [string, unknown][] = [
      ["a blob string over 6 × 8192 + 32768 characters", JSON.stringify({ ...signed, msg: { ...signed.msg, payload: big(6 * 8192 + 32_768) } })],
      ["a payload over 8192 bytes", { ...signed, msg: { ...signed.msg, payload: big(8193) } }],
      ["a payload over 8192 bytes in UTF-8, under it in characters", { ...signed, msg: { ...signed.msg, payload: "é".repeat(4097) } }],
      ["a path over 16 entries", { ...signed, msg: { ...signed.msg, path: Array.from({ length: 17 }, (_, i) => `a${i}.testnet`) } }],
      ["a chain_id over 64 characters", { ...signed, msg: { ...signed.msg, chain_id: big(65) } }],
      ["an access_key over 128 characters", { ...signed, access_key: `ed25519:${big(121)}` }],
      ["a signature over 256 characters", { ...signed, signature: `ed25519:${big(249)}` }],
      ["a callback_url over 2048 characters", { ...signed, via: { schema: "nep413", extra: { callback_url: `https://example.app/${big(2029)}` } } }],
    ];
    for (const [what, c] of tooLong) expect(parseAccessKeyAuthorization(c), what).toMatchObject({ ok: false, code: "too-long" });
    // A caller's own cap.
    expect(parseAccessKeyAuthorization({ ...signed, msg: { ...signed.msg, payload: big(101) } }, { maxPayloadBytes: 100 })).toMatchObject({ ok: false, code: "too-long" });
    expect(parseAccessKeyAuthorization({ ...signed, msg: { ...signed.msg, payload: big(100) } }, { maxPayloadBytes: 100 })).toMatchObject({ ok: true });
    // Just within: they parse (the signature then fails at step 4, which is not this function's).
    for (const c of [
      { ...signed, msg: { ...signed.msg, payload: big(8192) } },
      { ...signed, msg: { ...signed.msg, path: Array.from({ length: 16 }, (_, i) => `a${i}.testnet`) } },
      { ...signed, via: { schema: "nep413", extra: { callback_url: `https://example.app/${big(2028)}` } } },
    ]) {
      expect(parseAccessKeyAuthorization(c)).toMatchObject({ ok: true });
    }
    expect(NEP641_LIMITS).toEqual({ payloadBytes: 8192, pathEntries: 16, chainIdChars: 64, accessKeyChars: 128, signatureChars: 256, callbackUrlChars: 2048, blobSlackChars: 32_768 });
  });
});

describe("verifyNep641Leaf, steps 0-6 on testnet answers", () => {
  it("accepts a leaf for the key's implicit account, which does not exist at the block (step 6, NEP-641's rule)", async () => {
    const rpc = counted();
    const signed = leaf(message());
    const result = await verifyNep641Leaf({ rpc, authorization: JSON.stringify(signed), expect: expectTestnet(), at: AT });
    expect(result).toMatchObject({ ok: true, payload: signed.msg.payload, signerId: TEST_KEY.implicit, implicit: true, block: { hash: BLOCK_HASH } });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(rpc.asked).toEqual(["block", "query"]);
  });

  it("refuses at step 0 what does not parse, with no RPC call", async () => {
    const rpc = counted();
    const result = await verifyNep641Leaf({ rpc, authorization: { ...leaf(message()), extra: true }, expect: expectTestnet(), at: AT });
    expect(result).toMatchObject({ ok: false, step: 0, code: "unknown-field" });
    expect(rpc.asked).toEqual([]);
  });

  it("refuses at step 1 another chain, step 2 another signer, step 3 another path, all before any RPC call", async () => {
    const rpc = counted();
    const run = (authorization: unknown, expected: Parameters<typeof verifyNep641Leaf>[0]["expect"]) =>
      verifyNep641Leaf({ rpc, authorization, expect: expected, at: AT });
    expect(await run(leaf(message()), { chainId: "mainnet", signerId: TEST_KEY.implicit })).toMatchObject({ ok: false, step: 1, code: "wrong-chain" });
    expect(await run(leaf(message({ chain_id: "mainnet" })), expectTestnet())).toMatchObject({ ok: false, step: 1, code: "wrong-chain" });
    expect(await run(leaf(message()), expectTestnet(CONTRACT))).toMatchObject({ ok: false, step: 2, code: "wrong-signer" });
    const twoHops = leaf(message({ path: ["wallet.testnet", "v1.signer-prod.testnet"] }));
    expect(await run(twoHops, expectTestnet())).toMatchObject({ ok: false, step: 3, code: "wrong-path" });
    expect(await run(twoHops, expectTestnet(TEST_KEY.implicit, ["v1.signer-prod.testnet", "wallet.testnet"]))).toMatchObject({ ok: false, step: 3 });
    expect(await run(twoHops, expectTestnet(TEST_KEY.implicit, ["wallet.testnet"]))).toMatchObject({ ok: false, step: 3 });
    expect(await run(leaf(message()), expectTestnet(TEST_KEY.implicit, ["wallet.testnet"]))).toMatchObject({ ok: false, step: 3 });
    expect(rpc.asked).toEqual([]);
  });

  it("refuses at step 4 a signature over anything else, and a key type other than ed25519, before any RPC call", async () => {
    const rpc = counted();
    const signed = leaf(message());
    const run = (authorization: unknown) => verifyNep641Leaf({ rpc, authorization, expect: expectTestnet(), at: AT });
    expect(await run({ ...signed, msg: { ...signed.msg, payload: `${signed.msg.payload} ` } })).toMatchObject({ ok: false, step: 4, code: "bad-signature" });
    // The same message, signed with a callback URL the authorization does not carry.
    expect(await run({ ...leaf(signed.msg, "https://satchelnft.xyz/cb"), via: { schema: "nep413" } })).toMatchObject({ ok: false, step: 4, code: "bad-signature" });
    // One nanosecond later: the recipient is the same, the nonce is not.
    const later = rfc3339(BLOCK_NS - 60_000_000_000n + 1n);
    expect(await run({ ...signed, msg: { ...signed.msg, timestamp: later } })).toMatchObject({ ok: false, step: 4, code: "bad-signature" });
    // A well-formed secp256k1 key (64 bytes): NEP-413 secp256k1 signatures are Planned, so it is refused.
    const secp = `secp256k1:${base58Encode(new Uint8Array(64).fill(7))}`;
    expect(parseAccessKeyAuthorization({ ...signed, access_key: secp }).ok).toBe(true);
    expect(await run({ ...signed, access_key: secp })).toMatchObject({ ok: false, step: 4, code: "unsupported-key-type" });
    expect(rpc.asked).toEqual([]);
  });

  it("refuses at step 5 a timestamp after the block, and accepts one equal to it", async () => {
    const after = await verifyNep641Leaf({ rpc: counted(), authorization: leaf(message({ timestamp: rfc3339(BLOCK_NS + 1n) })), expect: expectTestnet(), at: AT });
    expect(after).toMatchObject({ ok: false, step: 5, code: "timestamp-after-block" });
    const equal = await verifyNep641Leaf({ rpc: counted(), authorization: leaf(message({ timestamp: rfc3339(BLOCK_NS) })), expect: expectTestnet(), at: AT });
    expect(equal).toMatchObject({ ok: true, implicit: true });
  });

  it("refuses at step 6 an existing account that does not hold the key, and a missing account that is not the key's implicit one", async () => {
    const existing = await verifyNep641Leaf({ rpc: counted(), authorization: leaf(message({ signer_id: CONTRACT })), expect: expectTestnet(CONTRACT), at: AT });
    expect(existing).toMatchObject({ ok: false, step: 6, code: "key-not-on-account" });
    const missing = await verifyNep641Leaf({ rpc: counted(), authorization: leaf(message({ signer_id: MISSING })), expect: expectTestnet(MISSING), at: AT });
    expect(missing).toMatchObject({ ok: false, step: 6, code: "no-account" });
  });

  it("at step 6 takes a full-access key (gas-key full access too) and refuses a function-call or unknown permission (in-test changes)", async () => {
    const run = (cassette: Cassette) =>
      verifyNep641Leaf({ rpc: replayRpc(cassette), authorization: leaf(message({ signer_id: CONTRACT })), expect: expectTestnet(CONTRACT), at: AT });
    // In-test changes: the contract's account answers that it holds the test key, with each permission.
    expect(await run(holding(CONTRACT, "FullAccess"))).toMatchObject({ ok: true, implicit: false, signerId: CONTRACT });
    expect(await run(holding(CONTRACT, { GasKeyFullAccess: { balance: "0", num_nonces: 1 } }))).toMatchObject({ ok: true, implicit: false });
    expect(await run(holding(CONTRACT, { FunctionCall: { allowance: null, receiver_id: CONTRACT, method_names: [] } }))).toMatchObject({
      ok: false,
      step: 6,
      code: "function-call-key",
    });
    expect(await run(holding(CONTRACT, { GasKeyFunctionCall: [{ balance: "0", num_nonces: 1 }, { receiver_id: CONTRACT, method_names: [] }] }))).toMatchObject({
      ok: false,
      step: 6,
      code: "function-call-key",
    });
    expect(await run(holding(CONTRACT, { NewKind: {} }))).toMatchObject({ ok: false, step: 6, code: "unknown-permission" });
  });

  it("reports an RPC that fails, or answers about another block, as a value", async () => {
    // In-test change: the block read answers an error.
    const noBlock = copy(CASSETTE);
    const block = noBlock.calls.find((c) => c.method === "block") as Recorded;
    block.result = undefined;
    block.error = { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_BLOCK", info: {} }, code: -32000, message: "Server error" };
    const failed = await verifyNep641Leaf({ rpc: replayRpc(noBlock), authorization: leaf(message()), expect: expectTestnet(), at: AT });
    expect(failed).toMatchObject({ ok: false, step: 5, code: "rpc-block" });
    // In-test change: the contract's view_account answers about another block.
    const other = copy(CASSETTE);
    const view = other.calls.find((c) => params(c).request_type === "view_account" && params(c).account_id === CONTRACT) as Recorded;
    (view.result as { block_hash: string }).block_hash = "11111111111111111111111111111111";
    const wrong = await verifyNep641Leaf({ rpc: replayRpc(other), authorization: leaf(message({ signer_id: CONTRACT })), expect: expectTestnet(CONTRACT), at: AT });
    expect(wrong).toMatchObject({ ok: false, step: 6, code: "wrong-block" });
  });

  it("never accepts the implicit account on an UNKNOWN_ACCOUNT error about another block, or (strict) about no block", async () => {
    // In-test changes to the recorded UNKNOWN_ACCOUNT error for the test key's implicit account: its
    // cause.info.block_hash, which names the pinned block, is changed or deleted.
    const withError = (change: (info: Record<string, unknown>) => void) => {
      const cassette = copy(CASSETTE);
      const call = cassette.calls.find((c) => params(c).request_type === "view_account" && params(c).account_id === TEST_KEY.implicit) as Recorded & {
        error: { cause: { name: string; info: Record<string, unknown> } };
      };
      expect(call.error.cause).toMatchObject({ name: "UNKNOWN_ACCOUNT", info: { block_hash: BLOCK_HASH } });
      change(call.error.cause.info);
      return cassette;
    };
    const other = withError((info) => {
      info.block_hash = "11111111111111111111111111111111";
    });
    const none = withError((info) => {
      delete info.block_hash;
    });
    const run = (cassette: Cassette, strictBlock?: boolean) =>
      verifyNep641Leaf({ rpc: replayRpc(cassette), authorization: leaf(message()), expect: expectTestnet(), at: AT, ...(strictBlock === undefined ? {} : { strictBlock }) });
    for (const strictBlock of [undefined, false]) {
      const result = await run(other, strictBlock);
      expect(result).toMatchObject({ ok: false, step: 6, code: "wrong-block" });
      expect(result.ok ? "" : result.reason).toContain("answered at block 11111111111111111111111111111111");
    }
    expect(await run(none)).toMatchObject({ ok: false, step: 6, code: "wrong-block", reason: expect.stringContaining("answered without a block hash") });
    expect(await run(none, false)).toMatchObject({ ok: true, implicit: true });
  });

  it("refuses at step 0, before the signature is hashed, a payload over maxPayloadBytes", async () => {
    const rpc = counted();
    const signed = leaf(message({ payload: "a".repeat(200) }));
    expect(await verifyNep641Leaf({ rpc, authorization: signed, expect: expectTestnet(), at: AT, maxPayloadBytes: 100 })).toMatchObject({ ok: false, step: 0, code: "too-long" });
    expect(rpc.asked).toEqual([]);
    expect(await verifyNep641Leaf({ rpc, authorization: signed, expect: expectTestnet(), at: AT })).toMatchObject({ ok: true, implicit: true });
  });
});
