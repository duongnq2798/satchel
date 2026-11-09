import { afterEach, describe, expect, it, vi } from "vitest";
import { MAINNET, TESTNET } from "./config";
import { assertDeployment, assertReceiver, assertTxFor } from "./guard";
import { satchelTx } from "./satchel";

/** A NEAR RPC that answers `query` from `answer`, by request type, and records what it was asked. */
function stubRpc(answer: (params: Record<string, string>) => { result?: unknown; error?: unknown }) {
  const asked: Record<string, string>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      const { params } = JSON.parse(init.body) as { params: Record<string, string> };
      asked.push(params);
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: "satchel", ...answer(params) }));
    }),
  );
  return asked;
}

const UNKNOWN = { error: { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_ACCOUNT" } } };
const bytes = (value: unknown) => [...new TextEncoder().encode(JSON.stringify(value))];

/** The deployment as the RPC reports it, locked and canonical unless overridden. */
function deployment(net: typeof MAINNET, over: { keys?: number; mpc?: string } = {}) {
  return stubRpc((p) => {
    if (p.request_type === "view_access_key_list") return { result: { keys: Array(over.keys ?? 0).fill({}) } };
    if (p.request_type === "view_account") return { result: { code_hash: net.build.codeHash } };
    return { result: { result: bytes(over.mpc ?? net.mpc) } };
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("assertTxFor", () => {
  const tx = satchelTx(MAINNET).mint();

  it("signs only for a connected account on the page's network, calling its contract", () => {
    expect(() => assertTxFor(MAINNET, tx, "alice.near")).not.toThrow();
    expect(() => assertTxFor(MAINNET, tx, null)).toThrow("Connect a NEAR mainnet wallet first");
    expect(() => assertTxFor(MAINNET, tx, "alice.testnet")).toThrow("alice.testnet is not a NEAR mainnet account");
    expect(() => assertTxFor(TESTNET, tx, "alice.testnet")).toThrow("This page signs only for v1.satchel-nft.testnet");
  });
});

describe("assertDeployment", () => {
  it("passes a locked contract running the build through the canonical signer", async () => {
    deployment(MAINNET);
    await expect(assertDeployment(MAINNET)).resolves.toBeUndefined();
  });

  it("refuses a contract that doesn't exist yet, and reads again next time", async () => {
    stubRpc(() => UNKNOWN);
    await expect(assertDeployment(TESTNET)).rejects.toThrow("v1.satchel-nft.testnet doesn't exist yet");
    deployment(TESTNET, { keys: 1 });
    await expect(assertDeployment(TESTNET)).rejects.toThrow("doesn't pass the contract check: 1 access key(s)");
    deployment(TESTNET, { mpc: "v1.signer-prod.testnet" });
    await expect(assertDeployment(TESTNET)).resolves.toBeUndefined();
  });
});

describe("assertReceiver", () => {
  it("takes an account that exists on the network", async () => {
    const asked = stubRpc(() => ({ result: { code_hash: "11111111111111111111111111111111" } }));
    await expect(assertReceiver(MAINNET, "bob.near")).resolves.toBeUndefined();
    expect(asked[0]).toMatchObject({ request_type: "view_account", account_id: "bob.near" });
  });

  it("refuses an account that doesn't exist, since anyone could register it later or no one ever can", async () => {
    stubRpc(() => UNKNOWN);
    await expect(assertReceiver(MAINNET, "frend.near")).rejects.toThrow("frend.near doesn't exist on NEAR mainnet");
    await expect(assertReceiver(MAINNET, "bob.nera")).rejects.toThrow("doesn't exist");
  });

  it("refuses malformed names and accounts that can never transfer it out, without asking the RPC", async () => {
    const asked = stubRpc(() => ({ result: {} }));
    for (const bad of ["", "a", "Bob.near", "bob..near", ".bob.near", "bob.near.", "bob_.near", "a".repeat(65)]) {
      await expect(assertReceiver(MAINNET, bad)).rejects.toThrow("Enter the receiver's NEAR account, like friend.near");
    }
    await expect(assertReceiver(TESTNET, "x")).rejects.toThrow("like friend.testnet");
    await expect(assertReceiver(MAINNET, "v1.satchel-nft.near")).rejects.toThrow("can never transfer a satchel out");
    await expect(assertReceiver(MAINNET, "v1.signer")).rejects.toThrow("can never transfer a satchel out");
    expect(asked).toHaveLength(0);
  });

  it("says when it couldn't check, instead of guessing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 502 })));
    await expect(assertReceiver(MAINNET, "bob.near")).rejects.toThrow("Couldn't check that bob.near exists");
  });
});
