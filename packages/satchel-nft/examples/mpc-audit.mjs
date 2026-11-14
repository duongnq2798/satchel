#!/usr/bin/env node
// What a NEAR transaction asked NEAR's MPC network (Chain Signatures) to sign, what it got back, and
// whether each answer is a valid signature by the key derived for its caller and path. It only reads.
//
//   node packages/satchel-nft/examples/mpc-audit.mjs [testnet|mainnet] [txHash]
//
// Defaults: testnet EZLXcvf43jqHYFUJm7gt3Ris5yM1Ru2FPihiEqJW1GUo (deployments/testnet-e2e.json
// steps[1].tx, satchel #1's sign_evm). Run `npm run build -w satchel-nft` first. Reads go through
// readOnlyRpc to FastNEAR's archival node, with NEAR's own archival node as the fallback, at FINAL;
// the sender comes from FastNEAR's transaction index. The root keys are the pinned MPC_ROOT_KEYS.
// It exits 0 whatever the verdict, and 1 only when a read fails, printing the error's kind.
import { MPC_CONTRACTS, MPC_ROOT_KEYS, auditSignTx } from "satchel-nft/chain-signatures";
import { ENDPOINTS, ReadTxError, RpcError, fastnearSenderLookup, httpRpc, readOnlyRpc, redactUrl, withFallback } from "satchel-nft/near-rpc";

const [network = "testnet", hash = "EZLXcvf43jqHYFUJm7gt3Ris5yM1Ru2FPihiEqJW1GUo", ...extra] = process.argv.slice(2);
if ((network !== "testnet" && network !== "mainnet") || extra.length > 0) {
  console.error("usage: node packages/satchel-nft/examples/mpc-audit.mjs [testnet|mainnet] [txHash]");
  process.exit(2);
}

const { archival, nearArchival, txApi } = ENDPOINTS[network];
const rpc = readOnlyRpc(withFallback(httpRpc(archival), httpRpc(nearArchival)));
const mpcContract = MPC_CONTRACTS[network];

let audit;
try {
  audit = await auditSignTx(rpc, hash, { senderLookup: fastnearSenderLookup(txApi), mpcContract, rootKeys: MPC_ROOT_KEYS[network] });
} catch (err) {
  if (err instanceof RpcError) console.error(`read failed (${err.kind}): ${err.message}`);
  else if (err instanceof ReadTxError) console.error(`read failed (${err.code}): ${err.message}`);
  else console.error(`read failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

const DOMAINS = { 0: "0 (secp256k1 ECDSA)", 1: "1 (ed25519 EdDSA)" };
const row = (label, value) => console.log(`  ${label.padEnd(13)}${value}`);

console.log(`network        ${network}, MPC contract ${mpcContract}`);
console.log(`read from      ${redactUrl(archival)} (fallback ${redactUrl(nearArchival)}), FINAL`);
console.log(`tx             ${audit.tx}`);
console.log(`signer         ${audit.signerId}`);
console.log(`block          ${audit.block}`);
console.log(`requests       ${audit.requests.length}`);
for (const [i, r] of audit.requests.entries()) {
  console.log(`request ${i}`);
  row("receipt", r.request.receiptId);
  row("predecessor", r.request.predecessor);
  row("path", JSON.stringify(r.request.path));
  row("domain", r.request.domain === null ? "not mapped" : DOMAINS[r.request.domain]);
  row("form", r.request.form);
  row("payload", `${r.request.payload.kind} ${r.request.payload.hex}`);
  row("deposit", `${String(r.request.deposit)} yoctoNEAR`);
  row("status", r.status);
  if (r.detail !== null) row("detail", r.detail);
  row("hops", r.hops.join(" -> "));
  if (r.callback !== null) row("callback", r.callback.receiptId);
  row("derived key", r.derivedKey ?? "none (no root key for this domain)");
  row("verify", r.verify === null ? "not checked" : r.verify.reason);
  if (r.verify?.evm) row("r, s, parity", `${r.verify.evm.r}, ${r.verify.evm.s}, ${String(r.verify.evm.yParity)}${r.verify.evm.highS ? " (s was high)" : ""}`);
  if (r.evmAddress !== null) row("evm address", r.evmAddress);
}
console.log(`orphan answers ${String(audit.orphanResponses)}`);
console.log(`verdict        ${audit.verdict}`);
