import { type Holder, type SatchelView, buildReport, checkHolder } from "satchel-nft";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/room/route";
import { REPORT_DEADLINE_MS, ROOM_BODY_LIMIT, parseRoomBody, readRoomRequest } from "./room-request";

// The real checkHolder and buildReport, unless a test answers for them.
vi.mock("satchel-nft", async (importOriginal) => {
  const actual = await importOriginal<typeof import("satchel-nft")>();
  return { ...actual, checkHolder: vi.fn(actual.checkHolder), buildReport: vi.fn(actual.buildReport) };
});

const PROOF = {
  tokenId: "4",
  accountId: "holder.testnet",
  publicKey: "ed25519:4UKgqHFuJtHVSMUD6nsvxGsByuBPVLN8WRdigoqaYoEU",
  signature: "A".repeat(86),
  nonce: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
  issuedAt: new Date().toISOString(),
};

const post = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request("https://satchelnft.xyz/api/room", { method: "POST", body, headers: { "content-type": "application/json", ...headers } });

describe("the room's request", () => {
  it("takes a network and every proof field as a string, and ignores the rest", () => {
    expect(parseRoomBody(JSON.stringify({ network: "mainnet", ...PROOF, message: "ignored" }))).toEqual({ ok: true, network: "mainnet", proof: PROOF });
  });

  it("refuses a body that isn't a JSON object, an unknown network, or a field that isn't a string", () => {
    expect(parseRoomBody("{")).toMatchObject({ ok: false, status: 400, error: "The body must be JSON" });
    expect(parseRoomBody("[]")).toMatchObject({ ok: false, status: 400 });
    expect(parseRoomBody(JSON.stringify({ ...PROOF }))).toMatchObject({ ok: false, status: 400, error: 'network must be "testnet" or "mainnet"' });
    expect(parseRoomBody(JSON.stringify({ network: "betanet", ...PROOF }))).toMatchObject({ ok: false, status: 400 });
    expect(parseRoomBody(JSON.stringify({ network: "testnet", ...PROOF, tokenId: 4 }))).toMatchObject({ error: "tokenId must be a string" });
    const { nonce: _, ...noNonce } = PROOF;
    expect(parseRoomBody(JSON.stringify({ network: "testnet", ...noNonce }))).toMatchObject({ error: "nonce must be a string" });
  });

  it("stops reading a body over 4 KB, whatever its content-length says", async () => {
    const big = JSON.stringify({ network: "testnet", ...PROOF, pad: "x".repeat(ROOM_BODY_LIMIT) });
    expect(await readRoomRequest(post(big))).toMatchObject({ ok: false, status: 413 });
    expect(await readRoomRequest(post(big, { "content-length": "100" }))).toMatchObject({ ok: false, status: 413 });
    // A stream that never says how long it is.
    const stream = new ReadableStream({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(1024)));
      },
    });
    const streamed = new Request("https://satchelnft.xyz/api/room", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    expect(await readRoomRequest(streamed)).toMatchObject({ ok: false, status: 413 });
    expect(await readRoomRequest(post(new Uint8Array([0x7b, 0xff, 0x7d])))).toMatchObject({ ok: false, status: 400 });
  });
});

describe("POST /api/room", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("answers each refusal with its status, as JSON that is never cached, before reading NEAR", async () => {
    const cases: [Request, number, RegExp][] = [
      [post("not json"), 400, /must be JSON/],
      [post("x".repeat(ROOM_BODY_LIMIT + 1)), 413, /over 4096 bytes/],
      [post(JSON.stringify({ network: "testnet", ...PROOF, accountId: "holder.near" })), 400, /not a NEAR testnet account/],
      [post(JSON.stringify({ network: "testnet", ...PROOF, issuedAt: "2020-01-01T00:00:00.000Z" })), 401, /more than 5 minutes before the server's time/],
      // The right shape, but not a signature anyone made: refused before any RPC.
      [post(JSON.stringify({ network: "testnet", ...PROOF })), 401, /signature doesn't verify/],
    ];
    const fetch = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    for (const [request, status, error] of cases) {
      const res = await POST(request);
      expect(res.status).toBe(status);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect((await res.json()).error).toMatch(error);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("still opens the room, with no report, when the report doesn't answer in time", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const holder: Holder = {
        network: "testnet",
        contract: "v1.satchel-nft.testnet",
        tokenId: "4",
        accountId: "holder.testnet",
        publicKey: PROOF.publicKey,
        block: { height: 277040964, hash: "FTKRp8oyXHyaBCSd5KVhSrw6kvq3uq5THeBRWkFN13pt", timestamp: "2026-11-10T08:09:33.615Z" },
      };
      const satchel = { token_id: "4", owner_id: "holder.testnet", path: "satchel/4", record: {}, listing: null } as unknown as SatchelView;
      vi.mocked(checkHolder).mockResolvedValueOnce({ ok: true, holder, satchel });
      // An EVM RPC that takes the request and never answers.
      vi.mocked(buildReport).mockReturnValueOnce(new Promise(() => {}));
      const answer = POST(post(JSON.stringify({ network: "testnet", ...PROOF })));
      await vi.advanceTimersByTimeAsync(REPORT_DEADLINE_MS);
      const res = await answer;
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ holder, satchel, report: null, reportError: "Couldn't read the report: no answer in 20 s", kit: null });
    } finally {
      vi.useRealTimers();
    }
  });
});
