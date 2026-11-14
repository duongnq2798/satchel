import { readFileSync } from "node:fs";
import { ed25519 } from "@noble/curves/ed25519";
import { bytesToHex } from "@noble/hashes/utils";
import { describe, expect, it } from "vitest";
import { LIVE, live, liveRpc } from "./__fixtures__/live.js";
import { base58Encode } from "./base58.js";
import { RpcError } from "./near-rpc.js";
import { nep413Hash } from "./nep413.js";
import { type OffchainMessage, nep641ToNep413, verifyNep641Leaf } from "./nep641.js";

// The NEP-641 leaf resolver against testnet at a final block, through the public RPC (see
// __fixtures__/live.ts) and readOnlyRpc. The key is made in process for this run: it signs these
// messages only, never a transaction, and no account holds it. Skipped unless SATCHEL_LIVE=1:
//   SATCHEL_LIVE=1 npm test -w satchel-nft -- nep641.live

const CONTRACT = (JSON.parse(readFileSync(new URL("../../../deployments/testnet.json", import.meta.url), "utf8")) as { contract: string }).contract;

const secret = ed25519.utils.randomPrivateKey();
const publicBytes = ed25519.getPublicKey(secret);
const publicKey = `ed25519:${base58Encode(publicBytes)}`;
const implicit = bytesToHex(publicBytes);

/** A leaf for `signerId`, signed by this run's key, timestamped `offsetMs` from now (default a minute early, as the NEP advises). */
function leaf(signerId: string, offsetMs = -60_000) {
  const msg: OffchainMessage = {
    chain_id: "testnet",
    signer_id: signerId,
    timestamp: new Date(Date.now() + offsetMs).toISOString(),
    payload: JSON.stringify({ domain: "satchelnft.xyz", action: "Login", msg: `live test ${new Date().toISOString()}` }),
  };
  return { msg, via: { schema: "nep413" }, access_key: publicKey, signature: `ed25519:${base58Encode(ed25519.sign(nep413Hash(nep641ToNep413(msg)), secret))}` };
}

/** Resolves on testnet; a result that failed on the RPC is rethrown, so rate limiting is reported as such by live(). */
const resolve = (authorization: ReturnType<typeof leaf>, signerId: string) =>
  live(async () => {
    const result = await verifyNep641Leaf({ rpc: liveRpc("testnet"), authorization, expect: { chainId: "testnet", signerId } });
    if (!result.ok && result.cause instanceof RpcError) throw result.cause;
    return result;
  });

describe.skipIf(!LIVE)("NEP-641 leaf live, final block on testnet", () => {
  it("accepts a leaf for the key's implicit account, which does not exist", async () => {
    const result = await resolve(leaf(implicit), implicit);
    expect(result).toMatchObject({ ok: true, implicit: true, signerId: implicit });
    if (result.ok) console.log(`${implicit} (no account) accepted at block ${result.block.height} (${result.block.hash})`);
  });

  it("refuses the same kind of leaf for v1.satchel-nft.testnet, which exists and holds no key, at step 6", async () => {
    expect(await resolve(leaf(CONTRACT), CONTRACT)).toMatchObject({ ok: false, step: 6, code: "key-not-on-account" });
  });

  it("refuses a leaf timestamped one hour in the future at step 5", async () => {
    expect(await resolve(leaf(implicit, 3_600_000), implicit)).toMatchObject({ ok: false, step: 5, code: "timestamp-after-block" });
  });
});
