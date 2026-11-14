#!/usr/bin/env node
// A NEP-413 sign-in turned into a decision at one block: the signature, the key on the account (full
// access), and an on-chain condition at that same block: here, that the account owns the satchel.
// It only reads.
//
//   node packages/satchel-nft/examples/account-proof.mjs [testnet] [signEvmTxHash]
//
// It checks the two NEP-413 signatures near-cli-rs made (src/__fixtures__/nep413-near-cli.json), by
// satchel-nft.testnet, who sold testnet satchel #1, and buyer.satchel-nft.testnet, who bought it, at
// the block of the receipt in which Satchel's contract ran the buyer's sign_evm (default
// 9GYTuZJoQAKcYib8NCEKXtcqDkRjGfy9nLavajkGaLnM, deployments/testnet-e2e.json steps[5].tx). The block
// and the token come from that transaction's receipts. Run `npm run build -w satchel-nft` first. Reads
// go through readOnlyRpc to FastNEAR's archival node, with NEAR's own archival node as the fallback;
// the sender comes from FastNEAR's transaction index. It exits 0 whatever the decisions, and 1 only
// when a read fails, printing the error's kind.
import { readFileSync } from "node:fs";
import { nftOwner, verifyAccountProof } from "satchel-nft/account-proof";
import {
  ENDPOINTS,
  ReadTxError,
  RpcError,
  decodeBase64,
  fastnearSenderLookup,
  functionCalls,
  httpRpc,
  readOnlyRpc,
  readTx,
  receiptsOf,
  redactUrl,
  withFallback,
} from "satchel-nft/near-rpc";

const [network = "testnet", hash = "9GYTuZJoQAKcYib8NCEKXtcqDkRjGfy9nLavajkGaLnM", ...extra] = process.argv.slice(2);
if (network !== "testnet" || extra.length > 0) {
  console.error("usage: node packages/satchel-nft/examples/account-proof.mjs [testnet] [signEvmTxHash]\n(the near-cli-rs vectors are testnet accounts)");
  process.exit(2);
}

const contract = JSON.parse(readFileSync(new URL("../../../deployments/testnet.json", import.meta.url), "utf8")).contract;
const { vectors } = JSON.parse(readFileSync(new URL("../src/__fixtures__/nep413-near-cli.json", import.meta.url), "utf8"));
const { archival, nearArchival, txApi } = ENDPOINTS[network];
const rpc = readOnlyRpc(withFallback(httpRpc(archival), httpRpc(nearArchival)));

function readFailed(err) {
  if (err instanceof RpcError) console.error(`read failed (${err.kind}): ${err.message}`);
  else if (err instanceof ReadTxError) console.error(`read failed (${err.code}): ${err.message}`);
  else console.error(`read failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

let tx;
try {
  tx = await readTx(rpc, hash, { senderLookup: fastnearSenderLookup(txApi) });
} catch (err) {
  readFailed(err);
}
const receipt = receiptsOf(tx).find((r) => r.executorId === contract && functionCalls(r).some((c) => c.method === "sign_evm"));
if (!receipt?.blockHash) {
  console.error(`${hash} has no receipt in which ${contract} ran sign_evm`);
  process.exit(2);
}
const call = functionCalls(receipt).find((c) => c.method === "sign_evm");
const tokenId = String(JSON.parse(decodeBase64(call.argsBase64)).token_id);
const at = { blockHash: receipt.blockHash };

console.log(`network        ${network}`);
console.log(`read from      ${redactUrl(archival)} (fallback ${redactUrl(nearArchival)})`);
console.log(`tx             ${hash}, signed by ${tx.transaction.signer_id}`);
console.log(`receipt        ${receipt.receiptId}: ${contract} ran sign_evm for satchel #${tokenId}`);
console.log(`pinned to      that receipt's block ${receipt.blockHash}`);
console.log(`predicate      nftOwner(${contract}, "${tokenId}")`);

for (const v of vectors) {
  const result = await verifyAccountProof({
    rpc,
    proof: { accountId: v.accountId, publicKey: v.publicKey, signature: v.signature, nonce: v.nonce },
    expect: { recipient: v.recipient, message: v.message },
    predicate: nftOwner(contract, tokenId),
    at,
  });
  if (!result.ok && result.status === 502 && result.cause instanceof RpcError) readFailed(result.cause);
  console.log(`proof by       ${v.accountId}`);
  console.log(`  key          ${v.publicKey}`);
  console.log(`  message      ${JSON.stringify(v.message)}, for ${v.recipient}`);
  if (result.ok) {
    console.log(`  block        ${result.block.height} (${result.block.hash}), ${result.block.timestamp}`);
    console.log(`  permission   ${result.permission.kind}`);
    console.log(`  owner        ${result.facts.token.owner_id} owns #${result.facts.token.token_id}`);
    console.log("  result       ok");
  } else {
    if (result.block) console.log(`  block        ${result.block.height} (${result.block.hash}), ${result.block.timestamp}`);
    console.log(`  result       ${result.status} ${result.stage} ${result.code}${result.predicateCode ? ` (${result.predicateCode})` : ""}`);
    console.log(`  reason       ${result.reason}`);
  }
}
