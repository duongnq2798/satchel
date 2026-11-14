#!/usr/bin/env node
// A NEP-641 access-key authorization (a leaf), made and resolved. It makes an ed25519 key in this
// process (it signs these messages only, never a transaction), builds an OffchainMessage for the
// key's implicit account, prints the NEP-413 payload a wallet would sign for it, and resolves it at a
// final block. NEP-641 accepts a leaf for an implicit account that does not exist yet; it refuses
// the same kind of leaf for an account that exists without the key.
//
//   node packages/satchel-nft/examples/nep641-leaf.mjs [testnet|mainnet] [existingAccount]
//
// Defaults: testnet, and Satchel's contract from deployments/<network>.json (it exists and holds no
// key) for the refusal. Run `npm run build -w satchel-nft` first. Reads go through readOnlyRpc to
// FastNEAR's regular node. It exits 0 whatever the decisions, and 1 only when a read fails, printing
// the error's kind.
import { readFileSync } from "node:fs";
import { ed25519 } from "@noble/curves/ed25519";
import { bytesToHex } from "@noble/hashes/utils";
import { base58Encode } from "satchel-nft";
import { nep413Hash, nep641ToNep413, verifyNep641Leaf } from "satchel-nft/account-proof";
import { ENDPOINTS, RpcError, httpRpc, readOnlyRpc, redactUrl } from "satchel-nft/near-rpc";

const [network = "testnet", ...rest] = process.argv.slice(2);
if ((network !== "testnet" && network !== "mainnet") || rest.length > 1) {
  console.error("usage: node packages/satchel-nft/examples/nep641-leaf.mjs [testnet|mainnet] [existingAccount]");
  process.exit(2);
}
const existing = rest[0] ?? JSON.parse(readFileSync(new URL(`../../../deployments/${network}.json`, import.meta.url), "utf8")).contract;

const secret = ed25519.utils.randomPrivateKey();
const publicBytes = ed25519.getPublicKey(secret);
const publicKey = `ed25519:${base58Encode(publicBytes)}`;
const implicit = bytesToHex(publicBytes);
const rpc = readOnlyRpc(httpRpc(ENDPOINTS[network].rpc));

/** A leaf for `signerId`, timestamped a minute early, as the NEP advises for clock skew and block lag. */
function leaf(signerId) {
  const msg = {
    chain_id: network,
    signer_id: signerId,
    timestamp: new Date(Date.now() - 60_000).toISOString(),
    payload: JSON.stringify({ domain: "example.app", action: "Login", msg: "nep641-leaf.mjs" }),
  };
  const payload = nep641ToNep413(msg);
  const signature = `ed25519:${base58Encode(ed25519.sign(nep413Hash(payload), secret))}`;
  return { authorization: { msg, via: { schema: "nep413" }, access_key: publicKey, signature }, payload };
}

async function show(label, signerId) {
  const { authorization, payload } = leaf(signerId);
  console.log(label);
  console.log(`  signer_id    ${signerId}`);
  console.log(`  timestamp    ${authorization.msg.timestamp}`);
  console.log(`  payload      ${authorization.msg.payload}`);
  console.log("  NEP-413 payload the wallet signs:");
  console.log("    message    the payload above");
  console.log(`    nonce      ${bytesToHex(payload.nonce)} (sha3_256 of NEAR_NEP641_OFFCHAIN_MESSAGE/V1 and borsh(msg))`);
  console.log(`    recipient  ${payload.recipient}`);
  const result = await verifyNep641Leaf({ rpc, authorization: JSON.stringify(authorization), expect: { chainId: network, signerId } });
  if (!result.ok && result.cause instanceof RpcError) {
    console.error(`read failed (${result.cause.kind}): ${result.cause.message}`);
    process.exit(1);
  }
  if (result.ok) {
    console.log(`  block        ${result.block.height} (${result.block.hash}), ${result.block.timestamp}`);
    console.log(`  result       ok: the payload is authorized by ${result.signerId}${result.implicit ? " (an implicit account, not created yet)" : ""}`);
  } else {
    console.log(`  result       refused at step ${result.step}: ${result.code}`);
    console.log(`  reason       ${result.reason}`);
  }
}

console.log(`network        ${network}, read from ${redactUrl(ENDPOINTS[network].rpc)} at a final block`);
console.log(`key            ${publicKey} (made in this process; it signs these two messages only)`);
console.log(`implicit id    ${implicit}`);
await show("leaf 1: the key's implicit account", implicit);
await show(`leaf 2: ${existing}, an account that exists without this key`, existing);
