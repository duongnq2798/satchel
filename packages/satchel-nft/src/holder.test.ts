import { ed25519 } from "@noble/curves/ed25519";
import { describe, expect, it, vi } from "vitest";
import { MAINNET, type Network, TESTNET } from "./config.js";
import { base58Encode } from "./evm.js";
import { ROOM_RECIPIENT, ROOM_SKEW_MS, ROOM_WINDOW_MS, type RoomProof, checkHolder, roomMessage } from "./holder.js";
import { type AccessKeyPermission, NearRpcError, type RpcCall, rpcFor } from "./near.js";
import { bytesToBase64, nep413Hash } from "./nep413.js";

// Fixed keys, so a failure reads the same on every run. The signature format itself is checked
// against near-cli-rs in nep413.test.ts.
const HOLDER_KEY = new Uint8Array(32).fill(1);
const OTHER_KEY = new Uint8Array(32).fill(2);
const keyOf = (secret: Uint8Array) => `ed25519:${base58Encode(ed25519.getPublicKey(secret))}`;

const NOW = Date.parse("2026-11-10T09:30:00.000Z");
const NONCE = Uint8Array.from({ length: 32 }, (_, i) => i);
const BLOCK = {
  height: 277040964,
  hash: "FTKRp8oyXHyaBCSd5KVhSrw6kvq3uq5THeBRWkFN13pt",
  timestamp: 1794298173615230200,
  timestamp_nanosec: "1794298173615230256",
};

interface Signing {
  net?: Network;
  tokenId?: string;
  accountId?: string;
  issuedAt?: string;
  secret?: Uint8Array;
}

/** A proof as a wallet would make it: the room message for `net` and `tokenId`, signed with `secret`. */
function prove({ net = TESTNET, tokenId = "4", accountId = "holder.testnet", issuedAt = new Date(NOW).toISOString(), secret = HOLDER_KEY }: Signing = {}): RoomProof {
  const message = roomMessage(net, tokenId, accountId, issuedAt);
  const signature = ed25519.sign(nep413Hash({ message, nonce: NONCE, recipient: ROOM_RECIPIENT }), secret);
  return { tokenId, accountId, publicKey: keyOf(secret), signature: bytesToBase64(signature), nonce: bytesToBase64(NONCE), issuedAt };
}

interface Chain {
  owner?: string;
  /** Each key the account has, and its permission. */
  keys?: Record<string, AccessKeyPermission>;
  /** The `satchel` view's answer, if not the usual one. */
  satchel?: unknown;
  /** Make one read fail. */
  fail?: "block" | "view_access_key" | "call_function";
  /** How the node says a key doesn't exist: in `result.error`, or as an RPC error. */
  missingKey?: "result" | "error";
}

/** A NEAR RPC at one final block, recording every call. */
function chain({ owner = "holder.testnet", keys = { [keyOf(HOLDER_KEY)]: "FullAccess" }, satchel, fail, missingKey = "result" }: Chain = {}) {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const rpc: RpcCall = async <T,>(method: string, params: unknown) => {
    const p = params as Record<string, unknown>;
    calls.push({ method, params: p });
    const kind = method === "block" ? "block" : (p.request_type as string);
    if (kind === fail) throw new NearRpcError(method, "HTTP 503");
    if (method === "block") return { header: BLOCK } as T;
    const at = { block_hash: p.block_id, block_height: BLOCK.height };
    if (kind === "view_access_key") {
      const permission = keys[p.public_key as string];
      if (permission !== undefined) return { ...at, nonce: 1, permission } as T;
      if (missingKey === "error") throw new NearRpcError("query", { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_ACCESS_KEY", info: {} } });
      return { ...at, error: `access key ${p.public_key} does not exist while viewing`, logs: [] } as T;
    }
    const args = JSON.parse(atob(p.args_base64 as string));
    const view = satchel !== undefined ? satchel : { token_id: args.token_id, owner_id: owner, path: `satchel/${args.token_id}`, record: {}, listing: null };
    return { ...at, logs: [], result: [...new TextEncoder().encode(JSON.stringify(view))] } as T;
  };
  return { rpc, calls };
}

const check = (proof: RoomProof, c = chain(), net: Network = TESTNET, now = NOW) => checkHolder(net, proof, { now, rpc: c.rpc });

describe("checkHolder", () => {
  it("opens the room for the owner's full-access key, with the block it read", async () => {
    const result = await check(prove());
    expect(result).toMatchObject({
      ok: true,
      holder: {
        network: "testnet",
        contract: "v1.satchel-nft.testnet",
        tokenId: "4",
        accountId: "holder.testnet",
        publicKey: keyOf(HOLDER_KEY),
        block: { height: BLOCK.height, hash: BLOCK.hash, timestamp: "2026-11-10T08:09:33.615Z" },
      },
      satchel: { token_id: "4", owner_id: "holder.testnet" },
    });
  });

  it("reads the key and the owner at the same final block", async () => {
    const c = chain();
    await check(prove(), c);
    expect(c.calls.map((x) => x.method)).toEqual(["block", "query", "query"]);
    expect(c.calls[0].params).toEqual({ finality: "final" });
    const [, key, view] = c.calls;
    expect(key.params).toMatchObject({ request_type: "view_access_key", block_id: BLOCK.hash, account_id: "holder.testnet" });
    expect(view.params).toMatchObject({ request_type: "call_function", block_id: BLOCK.hash, account_id: "v1.satchel-nft.testnet", method_name: "satchel" });
    expect(key.params).not.toHaveProperty("finality");
    expect(view.params).not.toHaveProperty("finality");
  });

  it("refuses a former holder after a sale, naming who owns it at that block", async () => {
    const result = await check(prove(), chain({ owner: "buyer.testnet" }));
    expect(result).toEqual({
      ok: false,
      status: 403,
      reason: `buyer.testnet owns satchel #4 at block ${BLOCK.height}, not holder.testnet. Only its current holder can open the room.`,
    });
  });

  it("refuses a function-call key, the kind a site you signed in to keeps", async () => {
    const functionCall = { FunctionCall: { allowance: "250000000000000000000000", receiver_id: "some-dapp.testnet", method_names: [] } };
    const result = await check(prove(), chain({ keys: { [keyOf(HOLDER_KEY)]: functionCall } }));
    expect(result).toMatchObject({ ok: false, status: 403, reason: expect.stringMatching(/function-call key of holder\.testnet/) });
  });

  it("refuses a key the account doesn't have, however the node says so", async () => {
    for (const missingKey of ["result", "error"] as const) {
      const result = await check(prove({ secret: OTHER_KEY }), chain({ missingKey }));
      expect(result).toEqual({ ok: false, status: 403, reason: `${keyOf(OTHER_KEY)} is not a key of holder.testnet at block ${BLOCK.height}` });
    }
  });

  it("refuses a proof signed more than 5 minutes ago, or more than a minute ahead", async () => {
    const at = (ms: number) => new Date(NOW + ms).toISOString();
    // A clock more than 5 minutes slow makes every proof look old: the reason names the server's time.
    expect(await check(prove({ issuedAt: at(-ROOM_WINDOW_MS - 1) }))).toMatchObject({
      ok: false,
      status: 401,
      reason: "This proof was signed at 2026-11-10T09:24:59.999Z, more than 5 minutes before the server's time, 2026-11-10T09:30:00.000Z. Sign again; if this repeats, check your device's clock.",
    });
    expect(await check(prove({ issuedAt: at(ROOM_SKEW_MS + 1) }))).toMatchObject({ ok: false, status: 401, reason: expect.stringMatching(/Check your device's clock/) });
    // The edges of the window still open it.
    expect(await check(prove({ issuedAt: at(-ROOM_WINDOW_MS) }))).toMatchObject({ ok: true });
    expect(await check(prove({ issuedAt: at(ROOM_SKEW_MS) }))).toMatchObject({ ok: true });
  });

  it("refuses a tampered signature, or a signature by another key than the one sent", async () => {
    const proof = prove();
    const bytes = Uint8Array.from(atob(proof.signature), (c) => c.charCodeAt(0));
    bytes[0] ^= 1;
    expect(await check({ ...proof, signature: bytesToBase64(bytes) })).toMatchObject({ ok: false, status: 401 });
    expect(await check({ ...proof, publicKey: keyOf(OTHER_KEY) })).toMatchObject({ ok: false, status: 401 });
    expect(await check({ ...proof, nonce: bytesToBase64(new Uint8Array(32)) })).toMatchObject({ ok: false, status: 401 });
  });

  it("refuses a message signed for another token, network or account", async () => {
    expect(await check({ ...prove({ tokenId: "5" }), tokenId: "4" })).toMatchObject({ ok: false, status: 401 });
    expect(await check({ ...prove({ accountId: "other.testnet" }), accountId: "holder.testnet" })).toMatchObject({ ok: false, status: 401 });
    // An implicit account exists on both networks, so only the message tells them apart.
    const implicit = "a".repeat(64);
    const mainnetChain = chain({ owner: implicit });
    expect(await check(prove({ net: TESTNET, accountId: implicit }), mainnetChain, MAINNET)).toMatchObject({ ok: false, status: 401 });
    expect(await check(prove({ net: MAINNET, accountId: implicit }), mainnetChain, MAINNET)).toMatchObject({ ok: true });
    expect(mainnetChain.calls.find((c) => c.params.request_type === "call_function")?.params.account_id).toBe("v1.satchel-nft.near");
  });

  it("refuses an account of the other network as malformed", async () => {
    expect(await check(prove({ accountId: "holder.near" }))).toEqual({ ok: false, status: 400, reason: "holder.near is not a NEAR testnet account" });
    expect(await check(prove({ net: MAINNET }), chain(), MAINNET)).toEqual({ ok: false, status: 400, reason: "holder.testnet is not a NEAR mainnet account" });
  });

  it("refuses malformed proofs before anything else", async () => {
    const good = prove();
    const bad: [Partial<Record<keyof RoomProof, unknown>>, RegExp][] = [
      [{ tokenId: 4 }, /tokenId must be a string/],
      [{ tokenId: "04x" }, /satchel id/],
      [{ tokenId: "1".repeat(20) }, /satchel id/],
      [{ accountId: "Holder.testnet" }, /not a NEAR account id/],
      [{ nonce: bytesToBase64(new Uint8Array(31)) }, /32 bytes/],
      [{ nonce: "not base64!" }, /32 bytes/],
      [{ issuedAt: "2026-11-10T09:30:00Z" }, /toISOString/],
      [{ issuedAt: "2026-11-10T10:30:00.000+01:00" }, /toISOString/],
      [{ issuedAt: "yesterday" }, /toISOString/],
      [{ signature: "A".repeat(300) }, /too long/],
    ];
    for (const [change, reason] of bad) {
      expect(await check({ ...good, ...change } as RoomProof)).toMatchObject({ ok: false, status: 400, reason: expect.stringMatching(reason) });
    }
    expect(await check(null as unknown as RoomProof)).toMatchObject({ ok: false, status: 400 });
  });

  it("fetches nothing until the signature verifies", async () => {
    const proof = prove();
    const refused = [
      { ...proof, signature: prove({ secret: OTHER_KEY }).signature },
      { ...proof, issuedAt: new Date(NOW - ROOM_WINDOW_MS - 1).toISOString() },
      { ...proof, accountId: "holder.near" },
      { ...proof, tokenId: "x" },
    ];
    for (const p of refused) {
      const c = chain();
      expect((await check(p, c)).ok).toBe(false);
      expect(c.calls).toEqual([]);
    }
  });

  it("says no satchel for an id that has none", async () => {
    expect(await check(prove({ tokenId: "999" }), chain({ satchel: null }))).toEqual({
      ok: false,
      status: 404,
      reason: "No satchel #999 on v1.satchel-nft.testnet",
    });
  });

  it("answers 502 when the RPC fails, or answers about another token or block", async () => {
    for (const fail of ["block", "view_access_key", "call_function"] as const) {
      expect(await check(prove(), chain({ fail }))).toMatchObject({ ok: false, status: 502 });
    }
    const other = { token_id: "7", owner_id: "holder.testnet", path: "satchel/7", record: {}, listing: null };
    expect(await check(prove(), chain({ satchel: other }))).toMatchObject({ ok: false, status: 502, reason: expect.stringMatching(/answered for satchel #7/) });
    // A node that answers the key at another block than the one asked for.
    const c = chain();
    const shifted: RpcCall = async <T,>(method: string, params: unknown) => {
      const answer = await c.rpc<Record<string, unknown>>(method, params);
      return (method === "query" ? { ...answer, block_hash: "11111111111111111111111111111111" } : answer) as T;
    };
    expect(await checkHolder(TESTNET, prove(), { now: NOW, rpc: shifted })).toMatchObject({ ok: false, status: 502, reason: expect.stringMatching(/answered at block/) });
  });

  it("answers 502 when the NEAR RPC never answers, once rpcFor's timeout passes", async () => {
    // A node that takes the request and never replies: only the abort ends it.
    const hang = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason))));
    vi.stubGlobal("fetch", hang);
    try {
      const result = await checkHolder(TESTNET, prove(), { now: NOW, rpc: rpcFor(TESTNET, 20) });
      expect(result).toEqual({ ok: false, status: 502, reason: "Couldn't read a final block from NEAR testnet: NEAR RPC block failed: no answer in 0.02 s" });
      expect(hang).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("roomMessage", () => {
  it("names the satchel, the network, the contract, the account and the time, one per line", () => {
    expect(roomMessage(MAINNET, "1", "satchel-nft.near", "2026-11-10T09:30:00.000Z")).toBe(
      [
        "Open the holder room of Satchel #1",
        "Network: mainnet",
        "Contract: v1.satchel-nft.near",
        "Account: satchel-nft.near",
        "Issued: 2026-11-10T09:30:00.000Z",
      ].join("\n"),
    );
  });
});
