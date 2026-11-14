#!/usr/bin/env node
// Whether an EVM transaction is exactly the one an MPC answer in a NEAR transaction signed: the
// NEAR transaction is audited (as mpc-audit.mjs does), then the EVM transaction, its receipt and the
// node's finalized block are read and every check is printed. It only reads.
//
//   node packages/satchel-nft/examples/prove-evm-tx.mjs [testnet|mainnet] [nearTx] [chainId] [evmTxHash] [evmRpcUrl]
//
// Defaults: mainnet 2xqwe8AAWwvssHNCMUioME2SCJeYAKcneV8iVCpa1Cj4 8453
// 0x8044dd8cd53ea5aa7165b031098450d64a6c6910fc0cc9c3e138a480e6ac9532 (deployments/mainnet-first-send.json:
// satchel #1's Base send). The EVM node defaults to the chain's URL in satchel-nft's chainInfo, and is
// read only through readOnlyEvmClient, which refuses anything but four read methods. Run
// `npm run build -w satchel-nft` first. It exits 0 whatever the verdict, and 1 only when a read fails,
// printing the error's kind.
import { chainInfo } from "satchel-nft";
import { MPC_CONTRACTS, MPC_ROOT_KEYS, auditSignTx, proveEvmTx, readOnlyEvmClient } from "satchel-nft/chain-signatures";
import { ENDPOINTS, ReadTxError, RpcError, fastnearSenderLookup, httpRpc, readOnlyRpc, redactUrl, withFallback } from "satchel-nft/near-rpc";
import { defineChain } from "viem";
import * as chains from "viem/chains";

const usage = "usage: node packages/satchel-nft/examples/prove-evm-tx.mjs [testnet|mainnet] [nearTx] [chainId] [evmTxHash] [evmRpcUrl]";
const [
  network = "mainnet",
  nearTx = "2xqwe8AAWwvssHNCMUioME2SCJeYAKcneV8iVCpa1Cj4",
  chainIdText = "8453",
  evmTx = "0x8044dd8cd53ea5aa7165b031098450d64a6c6910fc0cc9c3e138a480e6ac9532",
  rpcArg,
  ...extra
] = process.argv.slice(2);
const chainId = Number(chainIdText);
if ((network !== "testnet" && network !== "mainnet") || !Number.isSafeInteger(chainId) || !/^0x[0-9a-fA-F]{64}$/.test(evmTx) || extra.length > 0) {
  console.error(usage);
  process.exit(2);
}
const info = chainInfo(chainId);
const evmUrl = rpcArg ?? info?.rpc;
if (!evmUrl) {
  console.error(`satchel-nft's chainInfo has no chain ${chainId}: pass its RPC URL as the fifth argument\n${usage}`);
  process.exit(2);
}
const chain =
  Object.values(chains).find((c) => c?.id === chainId) ??
  defineChain({ id: chainId, name: `chain ${chainId}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [evmUrl] } } });

const { archival, nearArchival, txApi } = ENDPOINTS[network];
const rpc = readOnlyRpc(withFallback(httpRpc(archival), httpRpc(nearArchival)));

/** A read failure's kind: near-rpc's RpcError and ReadTxError, or viem's error name for the EVM node. */
function failed(err) {
  if (err instanceof RpcError) return `${err.kind}: ${err.message}`;
  if (err instanceof ReadTxError) return `${err.code}: ${err.message}`;
  if (err instanceof Error) return `${err.name}: ${err.shortMessage ?? err.message}`;
  return String(err);
}

let audit;
let proof;
try {
  audit = await auditSignTx(rpc, nearTx, { senderLookup: fastnearSenderLookup(txApi), mpcContract: MPC_CONTRACTS[network], rootKeys: MPC_ROOT_KEYS[network] });
  proof = await proveEvmTx({ audit, client: readOnlyEvmClient(chain, evmUrl), hash: evmTx, expectedChainId: chainId });
} catch (err) {
  console.error(`read failed (${failed(err)})`);
  process.exit(1);
}

console.log(`near           ${network} ${proof.near.tx}, audit ${audit.verdict}`);
console.log(`request        ${proof.near.receiptId || "none"}, predecessor ${proof.near.predecessor || "none"}, path ${JSON.stringify(proof.near.path)}`);
console.log(`evm            chain ${String(chainId)}${info ? ` (${info.name})` : ""}, tx ${proof.evm.hash}`);
console.log(`evm node       ${redactUrl(evmUrl)}`);
for (const check of proof.checks) console.log(`${check.ok ? "ok  " : "FAIL"} ${check.id.padEnd(14)}${check.detail}`);
console.log(`from           ${proof.evm.from ?? "unknown"}, nonce ${String(proof.evm.nonce)}, block ${proof.evm.blockNumber ?? "none"}, status ${proof.evm.status ?? "none"}`);
console.log(`verdict        ${proof.verdict}`);
