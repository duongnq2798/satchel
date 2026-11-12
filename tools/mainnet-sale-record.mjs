// Reads one satchel's sale back from NEAR and from the EVM chain it sent on, checks each step, and
// writes the record that scripts/check-claims.mjs reads (deployments/mainnet-sale.json). The steps,
// each its own transaction: the seller mints the satchel, may fund its address and send from it
// once, lists it, a second account buys it naming the record version the listing pinned, and then
// the seller's sign_evm for it is refused on chain by the owner check.
//
// This script reads NEAR, FastNEAR's transaction index and one EVM chain. It signs nothing, holds no
// key and needs no install: Node 22 or later.
//
//   gate           run just before the seller's refused call: exits 0 only when the buyer owns the
//                  satchel at a final block and it is not listed, so that call can only fail the
//                  owner check. It refuses the demo satchels the README quotes
//   find-refused   the seller's failed sign_evm calls for the satchel, newest first, from FastNEAR's
//                  index: the near CLI prints no transaction hash for a call that fails
//   check          reads every transaction given and prints what each step shows; writes nothing
//   record         the same, then writes --out once every step holds
//
//   node tools/mainnet-sale-record.mjs check --token 3 --seller satchel-nft.near --buyer <account>
//     --mint <tx> [--fund <0x tx>] [--send <tx> --evm-tx <0x tx>] --list <tx> --buy <tx>
//     --refused <tx> [--report-before <file>] --report-after <file> [--price 0.1] [--note <text>]
//
// The reports are what `npx -y satchel-nft@0.2.0 verify --network mainnet <id> --json` prints, saved
// before the buy and after the refused call, as UTF-8 or as the UTF-16 PowerShell 5.1's `>` writes.
// The record takes the satchel's address from them; a send, when given, checks it against the
// address Base recovered from the MPC signature. record needs both reports. Without --send, the
// listing must be at record version 0: nothing was ever signed.
// --network testnet reads testnet: the sale of testnet satchel #7 (deployments/testnet-cli.json)
// checks this script. --chain is the chain the satchel sent on: Base (8453) on mainnet and Sepolia
// on testnet by default. --out defaults to deployments/mainnet-sale.json on mainnet and is needed on
// testnet; a file already there is kept unless --replace.
// NEAR_RPC, NEAR_ARCHIVAL_RPC and RPC_<chain id> replace the default nodes. Each read that fails is
// tried once more, 2 s later, and a transaction or state the regular node no longer keeps is read
// from the archival one.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const NETWORKS = {
  testnet: { contract: "v1.satchel-nft.testnet", mpc: "v1.signer-prod.testnet", txApi: "https://tx.test.fastnear.com", chain: "11155111" },
  mainnet: { contract: "v1.satchel-nft.near", mpc: "v1.signer", txApi: "https://tx.main.fastnear.com", chain: "8453" },
};
/** The public nodes read for each EVM chain, in order; RPC_<chain id> replaces them. Base's own node also serves old blocks. */
const EVM_NODES = {
  8453: ["https://base-rpc.publicnode.com", "https://mainnet.base.org"],
  84532: ["https://base-sepolia-rpc.publicnode.com"],
  11155111: ["https://ethereum-sepolia-rpc.publicnode.com", "https://sepolia.gateway.tenderly.co"],
};
/** The satchels the README quotes, whose state stays as it is until judging ends (web/src/lib/frozen.ts). */
const DEMO = { testnet: new Set(["1", "2", "3", "4", "5", "6", "7", "8", "9"]), mainnet: new Set(["1", "2"]) };
/** yoctoNEAR the contract asks for a mint (0.1 NEAR), as the CLI and the app attach it. */
const MINT_DEPOSIT = "100000000000000000000000";
const DEAD = "0x000000000000000000000000000000000000dead";
const OWNER_CHECK = "Satchel: only the token's owner can do this";
const VERDICT = { clean: "PROVABLY CLEAN", "not-provable": "NOT PROVABLE", unknown: "COULD NOT CHECK EVERYTHING" };

/** The flags each command takes: anything else is refused before any request. */
const SALE_FLAGS = ["mint", "fund", "send", "evm-tx", "list", "buy", "refused", "report-before", "report-after", "price", "chain", "note"];
const USAGE = {
  gate: ["network", "token", "seller", "buyer"],
  "find-refused": ["network", "token", "seller", "limit"],
  check: ["network", "token", "seller", "buyer", ...SALE_FLAGS],
  record: ["network", "token", "seller", "buyer", ...SALE_FLAGS, "out", "replace"],
};

/** A refusal, printed with exit code 1. Thrown rather than process.exit, which can crash Node on Windows while sockets close. */
class Stop extends Error {}
function fail(message) {
  throw new Stop(message);
}

let parsed;
try {
  parsed = parseArgs({
    strict: true,
    allowPositionals: true,
    options: Object.fromEntries(
      [...new Set(Object.values(USAGE).flat())].map((name) => [name, { type: name === "replace" ? "boolean" : "string" }]),
    ),
  });
} catch (err) {
  console.error(err.message);
  process.exit(2);
}
const { values: opts, positionals } = parsed;
const [command] = positionals;
if (!Object.hasOwn(USAGE, command ?? "") || positionals.length !== 1) {
  console.error("usage: node tools/mainnet-sale-record.mjs gate|find-refused|check|record --token <id> --seller <account> [...]; see the top of this file");
  process.exit(2);
}
const stray = Object.keys(opts).filter((key) => !USAGE[command].includes(key));
if (stray.length > 0) {
  console.error(`${command} does not take --${stray.join(", --")}`);
  process.exit(2);
}

const NETWORK = opts.network ?? "mainnet";
if (!Object.hasOwn(NETWORKS, NETWORK)) {
  console.error(`--network is testnet or mainnet, not ${NETWORK}`);
  process.exit(2);
}
const { contract: CONTRACT, mpc: MPC, txApi: TX_API } = NETWORKS[NETWORK];
const RPC = process.env.NEAR_RPC ?? `https://rpc.${NETWORK}.fastnear.com`;
const ARCHIVAL = process.env.NEAR_ARCHIVAL_RPC ?? `https://archival-rpc.${NETWORK}.fastnear.com`;
const TOKEN = opts.token ?? "";
const SELLER = opts.seller ?? "";
const BUYER = opts.buyer ?? "";
const CHAIN = opts.chain ?? NETWORKS[NETWORK].chain;
const EVM_URLS = process.env[`RPC_${CHAIN}`] ? [process.env[`RPC_${CHAIN}`]] : (EVM_NODES[CHAIN] ?? []);
const PATH = `satchel/${TOKEN}`;

const json = (value) => JSON.stringify(value, (_, v) => (typeof v === "bigint" ? String(v) : v), 2);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** NEAR block times are in nanoseconds; the records quote them to the second, as deployments/testnet-cli.json does. */
const iso = (ns) => new Date(Number(BigInt(ns) / 1_000_000n)).toISOString().replace(/\.\d+Z$/, "Z");
const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();

/** "0.1" → yoctoNEAR, as satchel-nft's parseNear reads a price. */
function yocto(text) {
  if (!/^\d+(\.\d{1,24})?$/.test(text)) fail(`--price is an amount in NEAR, like 0.1; not ${text}`);
  const [whole, fraction = ""] = text.split(".");
  const value = BigInt(whole) * 10n ** 24n + BigInt(fraction.padEnd(24, "0"));
  if (value === 0n) fail("--price must be above 0");
  return value.toString();
}

// ---- Reads ------------------------------------------------------------------------------------

/** Runs `read`, and once more 2 s later if it throws: public nodes sometimes drop a request. */
async function twice(read) {
  try {
    return await read();
  } catch {
    await sleep(2_000);
    return read();
  }
}

async function rpcOnce(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "satchel", method, params }),
    signal: AbortSignal.timeout(30_000),
  }).catch((err) => {
    throw new Error(`${method}: ${err.message} from ${url}`);
  });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status} from ${url}`);
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error.cause ?? body.error)} from ${url}`);
  return body.result;
}

const rpc = (url, method, params) => twice(() => rpcOnce(url, method, params));

/**
 * A NEAR read from the regular node, or from the archival one when the regular node has dropped it
 * or fails. The regular node is asked once: for a transaction it no longer keeps, it waits 10 s and
 * answers a timeout, so asking it twice would only wait twice.
 */
async function fromNear(method, params) {
  try {
    return await rpcOnce(RPC, method, params);
  } catch (err) {
    return rpc(ARCHIVAL, method, params).catch((second) => {
      throw new Error(`${err.message}; ${second.message}`);
    });
  }
}

const viewArgs = (method, args) => ({
  request_type: "call_function",
  account_id: CONTRACT,
  method_name: method,
  args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
});
const decodeView = ({ result }) => JSON.parse(Buffer.from(result).toString());
/** A view of the contract at a final block, with that block's height. */
async function viewNow(method, args) {
  const answer = await rpc(RPC, "query", { finality: "final", ...viewArgs(method, args) });
  return { value: decodeView(answer), height: answer.block_height };
}
/** A view of the contract as it was at the end of block `blockHash`. */
const viewAt = async (blockHash, method, args) => decodeView(await fromNear("query", { block_id: blockHash, ...viewArgs(method, args) }));

/** A transaction with every receipt. The RPC wants its signer, which each step knows. */
async function nearTx(hash, sender) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(hash)) fail(`${hash} is not a NEAR transaction hash`);
  const t = await fromNear("EXPERIMENTAL_tx_status", { tx_hash: hash, sender_account_id: sender, wait_until: "FINAL" }).catch((err) => {
    fail(`${hash}, signed by ${sender}: ${err.message}`);
  });
  if (t.transaction.hash !== hash) fail(`the NEAR RPC answered about ${t.transaction.hash}, not ${hash}`);
  return t;
}

const blocks = new Map();
/** A block's height and time. */
function blockOf(hash) {
  if (!blocks.has(hash)) {
    const read = fromNear("block", { block_id: hash }).then(({ header }) => ({ height: header.height, ns: BigInt(header.timestamp), at: iso(header.timestamp) }));
    read.catch(() => blocks.delete(hash));
    blocks.set(hash, read);
  }
  return blocks.get(hash);
}

const nodeChains = new Map();
/** Throws unless `url` serves CHAIN: a node for another chain would answer every read, about the wrong chain. */
function servesChain(url) {
  if (!nodeChains.has(url)) {
    const read = rpc(url, "eth_chainId", []).then((id) => {
      if (BigInt(id) !== BigInt(CHAIN)) throw new Error(`${url} serves chain ${BigInt(id)}, not ${CHAIN}`);
    });
    read.catch(() => nodeChains.delete(url));
    nodeChains.set(url, read);
  }
  return nodeChains.get(url);
}

const evmRead = new Set();
/**
 * An EVM read from the first node that answers it, after that node has said it serves CHAIN. Every
 * read here is of something already mined, so an empty answer counts as a failed one: a public node
 * behind a load balancer can answer null for a transaction another of its nodes knows.
 */
async function evm(method, params) {
  if (EVM_URLS.length === 0) fail(`no default node for chain ${CHAIN}: set RPC_${CHAIN}`);
  const errors = [];
  for (const url of EVM_URLS) {
    try {
      await servesChain(url);
      const result = await twice(async () => {
        const answer = await rpcOnce(url, method, params);
        if (answer === null) throw new Error(`${method}: null from ${url}`);
        return answer;
      });
      evmRead.add(url);
      return result;
    } catch (err) {
      errors.push(err.message);
    }
  }
  fail(`${errors.join("; ")}. That is a node failing, not a change to the satchel: set RPC_${CHAIN} to a node of chain ${CHAIN} and run it again`);
}

/**
 * POSTs to FastNEAR's transaction index. It limits how often it is asked, so a 408, a 429, a 5xx or
 * no answer is sent again, up to 5 sends, after a random wait of up to 0.5, 1, 2 and 4 s, as
 * packages/satchel-nft/src/tx-index.ts does.
 */
async function indexPost(path, body) {
  const url = `${TX_API}${path}`;
  const seen = [];
  for (let tries = 1; ; tries++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    }).catch((err) => {
      seen.push(`no answer (${err.message})`);
      return null;
    });
    if (res?.ok) return res.json();
    if (res && !(res.status === 408 || res.status === 429 || res.status >= 500)) fail(`${url} answered ${res.status}`);
    if (res) {
      seen.push(String(res.status));
      await res.body?.cancel().catch(() => {});
    }
    if (tries >= 5) fail(`${url} failed ${tries} sends in a row: ${seen.join(", ")}. The index limits how often it is asked: try again in a minute.`);
    await sleep(Math.random() * 500 * 2 ** (tries - 1));
  }
}

// ---- What a NEAR transaction shows ------------------------------------------------------------

/** The NEP-297 events a receipt logged, parsed. */
const events = (outcome) =>
  outcome.outcome.logs.filter((l) => l.startsWith("EVENT_JSON:")).map((l) => JSON.parse(l.slice("EVENT_JSON:".length)));
const event = (outcome, standard, name) => events(outcome).find((e) => e.standard === standard && e.event === name)?.data?.[0];
const succeeded = (status) => status !== null && typeof status === "object" && ("SuccessValue" in status || "SuccessReceiptId" in status);
const panicOf = (status) => status?.Failure?.ActionError?.kind?.FunctionCallError?.ExecutionError ?? null;
const resultOf = (t) => JSON.parse(Buffer.from(t.status.SuccessValue ?? "", "base64").toString() || "null");

/**
 * Reads `hash`, which `sender` signed, and returns its one call to the contract with the args
 * decoded, the receipt the contract ran it in, and the blocks of both. Throws if it is anything else.
 */
async function callTo(hash, sender, method) {
  const t = await nearTx(hash, sender);
  if (t.transaction.signer_id !== sender) fail(`${hash} was signed by ${t.transaction.signer_id}, not ${sender}`);
  const call = t.transaction.actions.length === 1 ? t.transaction.actions[0].FunctionCall : undefined;
  if (!call || t.transaction.receiver_id !== CONTRACT) fail(`${hash} is not one function call to ${CONTRACT}`);
  if (call.method_name !== method) fail(`${hash} calls ${call.method_name}, not ${method}`);
  // The first receipt the contract ran is the call itself; a refund or a payment comes after it.
  const ran = t.receipts_outcome.find((o) => o.outcome.executor_id === CONTRACT);
  if (!ran) fail(`no receipt of ${CONTRACT} in ${hash}`);
  const [included, executed] = await Promise.all([blockOf(t.transaction_outcome.block_hash), blockOf(ran.block_hash)]);
  return {
    t,
    args: JSON.parse(Buffer.from(call.args, "base64").toString()),
    deposit: String(call.deposit),
    gas: String(call.gas),
    ran,
    included,
    executed,
  };
}

/** The fields every NEAR step records: the transaction, the block that included it and that block's time. */
const where = (c) => ({ tx: c.t.transaction.hash, block: String(c.included.height), at: c.included.at });

/** Throws unless `later` ran in a later block than `earlier`. */
function after(later, earlier, what) {
  if (earlier && later.executed.height <= earlier.executed.height) {
    fail(`it ran at block ${later.executed.height}, not after the ${what} at ${earlier.executed.height}`);
  }
}

// ---- The steps --------------------------------------------------------------------------------

async function mintStep(hash) {
  const c = await callTo(hash, SELLER, "mint");
  if (Object.keys(c.args).some((k) => k !== "receiver_id") || (c.args.receiver_id != null && c.args.receiver_id !== SELLER)) {
    fail(`mint with args ${JSON.stringify(c.args)}`);
  }
  if (c.deposit !== MINT_DEPOSIT) fail(`attached ${c.deposit} yoctoNEAR, not 0.1 NEAR`);
  if (!succeeded(c.t.status)) fail(`it failed: ${JSON.stringify(c.t.status)}`);
  const token = resultOf(c.t);
  if (token?.token_id !== TOKEN || token.owner_id !== SELLER) fail(`the mint returned satchel #${token?.token_id} to ${token?.owner_id}`);
  const minted = event(c.ran, "nep171", "nft_mint");
  if (minted?.owner_id !== SELLER || !minted.token_ids?.includes(TOKEN)) fail(`the contract logged ${JSON.stringify(minted)}`);
  return {
    c,
    facts: { ...where(c), deposit: c.deposit },
    line: `${hash.slice(0, 8)}… minted #${TOKEN} to ${SELLER} for 0.1 NEAR at block ${c.executed.height} (${c.executed.at})`,
  };
}

/** An EVM transaction to the satchel's address after it was minted: the funding a send then spends. */
async function fundStep(hash, address, mint) {
  const [sent, receipt] = await Promise.all([evm("eth_getTransactionByHash", [hash]), evm("eth_getTransactionReceipt", [hash])]);
  if (!sent || !receipt) fail(`no transaction ${hash} on chain ${CHAIN}`);
  if (BigInt(sent.chainId ?? CHAIN) !== BigInt(CHAIN) || !same(sent.to, address) || BigInt(sent.value) === 0n || receipt.status !== "0x1") {
    fail(`${hash} is not a successful payment to ${address}: ${BigInt(sent.value)} wei to ${sent.to}, status ${receipt.status}`);
  }
  const block = await evm("eth_getBlockByNumber", [receipt.blockNumber, false]);
  const funded = BigInt(block.timestamp) * 1000n;
  // Anyone can mint the next id, so an address funded before its mint could have been someone else's satchel.
  if (mint && funded <= mint.c.executed.ns / 1_000_000n) fail(`funded at ${new Date(Number(funded)).toISOString()}, before the mint ran`);
  return {
    facts: { chainId: CHAIN, tx: hash, from: sent.from, wei: String(BigInt(sent.value)), block: String(BigInt(receipt.blockNumber)), at: iso(funded * 1_000_000n) },
    line: `${hash.slice(0, 10)}… brought ${BigInt(sent.value)} wei from ${sent.from} to ${address} in block ${BigInt(receipt.blockNumber)}, after the mint`,
  };
}

/**
 * The satchel's one send before the sale: its `sign_evm`, the record entry the contract logged at
 * version 1, the hash it asked the MPC contract to sign for the satchel's path, and the chain running
 * exactly that transaction, with that signature, from `address`, in a block that is now finalized.
 */
async function sendStep(nearHash, evmHash, address, mint) {
  const c = await callTo(nearHash, SELLER, "sign_evm");
  const signed = c.args.tx;
  if (c.args.token_id !== TOKEN || signed?.chain_id !== CHAIN) fail(`sign_evm for satchel #${c.args.token_id} on chain ${signed?.chain_id}`);
  if (c.deposit !== "1") fail(`attached ${c.deposit} yoctoNEAR, not 1`);
  if (!succeeded(c.t.status)) fail(`it failed: ${JSON.stringify(c.t.status)}`);
  after(c, mint?.c, "mint");
  const entry = event(c.ran, "satchel", "sign_evm");
  if (entry?.token_id !== TOKEN || entry.chain_id !== CHAIN || entry.nonce !== signed.nonce) fail(`the contract logged ${JSON.stringify(entry)}`);
  // Version 1: the record was empty before this signature, so it is the satchel's first.
  if (entry.record_version !== "1") fail(`record version ${entry.record_version} after it, so it is not the satchel's first signature`);
  const request = c.t.receipts
    .filter((r) => r.predecessor_id === CONTRACT && r.receiver_id === MPC)
    .flatMap((r) => r.receipt.Action?.actions ?? [])
    .map((a) => a.FunctionCall)
    .find((f) => f?.method_name === "sign");
  const asked = request && JSON.parse(Buffer.from(request.args, "base64").toString()).request;
  const hash = (await viewNow("evm_signing_hash", { tx: signed })).value;
  if (asked?.path !== PATH || asked.payload_v2?.Ecdsa !== hash || entry.payload !== hash) {
    fail(`asked ${MPC} for ${JSON.stringify(asked)}; the contract's hash of the call is ${hash}`);
  }
  const sig = resultOf(c.t);
  if (!sig?.big_r?.affine_point) fail(`no MPC signature in the result: ${JSON.stringify(c.t.status)}`);

  if (!/^0x[0-9a-fA-F]{64}$/.test(evmHash)) fail(`--evm-tx ${evmHash} is not a transaction hash`);
  const [sent, receipt, final] = await Promise.all([
    evm("eth_getTransactionByHash", [evmHash]),
    evm("eth_getTransactionReceipt", [evmHash]),
    evm("eth_getBlockByNumber", ["finalized", false]),
  ]);
  if (!sent || !receipt) fail(`no transaction ${evmHash} on chain ${CHAIN}`);
  const fields = {
    chainId: [sent.chainId, signed.chain_id],
    nonce: [sent.nonce, signed.nonce],
    maxPriorityFeePerGas: [sent.maxPriorityFeePerGas, signed.max_priority_fee_per_gas],
    maxFeePerGas: [sent.maxFeePerGas, signed.max_fee_per_gas],
    gas: [sent.gas, signed.gas_limit],
    value: [sent.value, signed.value],
  };
  for (const [name, [onChain, inCall]] of Object.entries(fields)) {
    if (BigInt(onChain) !== BigInt(inCall)) fail(`${name} is ${BigInt(onChain)} on chain ${CHAIN}, ${inCall} in sign_evm`);
  }
  if (sent.type !== "0x2" || !same(sent.to, signed.to) || sent.input !== (signed.data ?? "0x").toLowerCase() || sent.accessList?.length) {
    fail(`${evmHash} is not the transaction sign_evm built`);
  }
  // The signature the chain checked is the one the MPC contract returned: r is big_r's x coordinate.
  const r = BigInt(`0x${sig.big_r.affine_point.slice(2)}`);
  if (BigInt(sent.r) !== r || BigInt(sent.s) !== BigInt(`0x${sig.s.scalar}`) || Number(sent.yParity ?? sent.v) !== sig.recovery_id) {
    fail(`the signature on chain ${CHAIN} is not the one ${MPC} returned`);
  }
  if (!same(sent.from, address)) fail(`sent from ${sent.from}, not the satchel's ${address}`);
  if (receipt.status !== "0x1") fail(`${evmHash} reverted`);
  if (BigInt(final.number) < BigInt(receipt.blockNumber)) {
    fail(`chain ${CHAIN} has finalized up to block ${BigInt(final.number)}, not ${BigInt(receipt.blockNumber)} yet: check again in a few minutes`);
  }
  // The fee includes the L1 data fee Base charges.
  const fee = BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice) + BigInt(receipt.l1Fee ?? 0);
  return {
    c,
    facts: {
      nearTx: nearHash,
      nearBlock: String(c.included.height),
      at: c.included.at,
      chainId: CHAIN,
      evmTx: evmHash,
      block: String(BigInt(receipt.blockNumber)),
      nonce: signed.nonce,
      to: signed.to,
      valueWei: String(BigInt(signed.value)),
      feeWei: String(fee),
      class: entry.class,
      recordVersion: entry.record_version,
    },
    line: `${nearHash.slice(0, 8)}… had nonce ${signed.nonce} signed (${entry.class}, record version 1); ${evmHash.slice(0, 10)}… ran it from ${address} in block ${BigInt(receipt.blockNumber)}, finalized, fee ${fee} wei`,
  };
}

async function listStep(hash, price, mint, send) {
  const c = await callTo(hash, SELLER, "list");
  if (c.args.token_id !== TOKEN || c.args.price !== price) fail(`list with args ${JSON.stringify(c.args)}, not satchel #${TOKEN} at ${price}`);
  if (c.deposit !== "1") fail(`attached ${c.deposit} yoctoNEAR, not 1`);
  if (!succeeded(c.t.status)) fail(`it failed: ${JSON.stringify(c.t.status)}`);
  const listed = event(c.ran, "satchel", "list");
  if (listed?.token_id !== TOKEN || listed.price !== price) fail(`the contract logged ${JSON.stringify(listed)}`);
  // Without a send nothing was ever signed; with one, the satchel's first, nothing else was signed after it.
  const expected = opts.send ? "1" : "0";
  if (listed.record_version !== expected) {
    fail(`listed at record version ${listed.record_version}, not ${expected}${opts.send ? "" : ": give the --send and --evm-tx of what was signed"}`);
  }
  after(c, send?.c ?? mint?.c, send ? "send" : "mint");
  return {
    c,
    facts: { ...where(c), price, recordVersion: listed.record_version },
    line: `${hash.slice(0, 8)}… listed #${TOKEN} for ${price} yoctoNEAR at record version ${listed.record_version}, block ${c.executed.height}`,
  };
}

/** A `verify --json` file: UTF-8, with or without a byte order mark, or the UTF-16 PowerShell 5.1's `>` writes. */
function readReport(file) {
  if (!existsSync(file)) fail(`no file ${file}`);
  const bytes = readFileSync(file);
  const text = bytes[0] === 0xff && bytes[1] === 0xfe ? bytes.subarray(2).toString("utf16le") : bytes.toString("utf8").replace(/^﻿/, "");
  let report;
  try {
    report = JSON.parse(text);
  } catch {
    fail(`${file} is not the JSON that verify --json prints`);
  }
  if (report.error) fail(`${file} holds an error, not a report: ${report.error}`);
  if (report.network !== NETWORK || report.contract !== CONTRACT || report.tokenId !== TOKEN) {
    fail(`${file} is a report on satchel #${report.tokenId} on ${report.contract}, not #${TOKEN} on ${CONTRACT}`);
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(report.address ?? "") || !Array.isArray(report.checks) || typeof report.checkedAt !== "string") {
    fail(`${file} is not a whole report`);
  }
  return report;
}

/** What a saved report shows, in the shape deployments/mainnet-1click-exit.json keeps its "verified" in. */
function reportFacts(report) {
  return {
    command: `npx -y satchel-nft@0.2.0 verify${NETWORK === "mainnet" ? " --network mainnet" : ""} ${TOKEN}`,
    result: VERDICT[report.verdict] ?? report.verdict,
    checkedAt: report.checkedAt,
    owner: report.owner,
    recordVersion: report.recordVersion,
    listing: report.listing,
    pending: report.checks.find((c) => c.id === "pending")?.lines.join("; ") ?? null,
    readFrom: report.sources ?? [],
  };
}

/** The buyer's check: PROVABLY CLEAN on the listing the buy names, read after the listing and before the buy. */
function beforeStep(file, list, buy) {
  const report = readReport(file);
  if (report.verdict !== "clean") fail(`${basename(file)} reads ${VERDICT[report.verdict] ?? report.verdict}`);
  const l = report.listing;
  if (report.owner !== SELLER || l?.seller !== SELLER || (list && (l.price !== list.facts.price || l.record_version !== list.facts.recordVersion))) {
    fail(`${basename(file)} read owner ${report.owner} and listing ${JSON.stringify(l)}`);
  }
  if (list && report.recordVersion !== list.facts.recordVersion) fail(`${basename(file)} read record version ${report.recordVersion}`);
  const checked = BigInt(Date.parse(report.checkedAt)) * 1_000_000n;
  if (list && checked <= list.c.executed.ns) fail(`checked at ${report.checkedAt}, before the listing ran`);
  if (buy && checked >= buy.c.included.ns) fail(`checked at ${report.checkedAt}, not before the buy at ${buy.c.included.at}`);
  return { facts: reportFacts(report), line: `${basename(file)}: PROVABLY CLEAN at ${report.checkedAt}, listed at record version ${report.recordVersion}` };
}

async function buyStep(hash, list) {
  const c = await callTo(hash, BUYER, "buy");
  const { token_id, record_version, price } = c.args;
  if (token_id !== TOKEN || (list && (record_version !== list.facts.recordVersion || price !== list.facts.price))) {
    fail(`buy with args ${JSON.stringify(c.args)}, not the listing's record version and price`);
  }
  if (c.deposit !== price) fail(`attached ${c.deposit} yoctoNEAR, not the price ${price}`);
  if (!succeeded(c.t.status)) fail(`it failed: ${JSON.stringify(c.t.status)}`);
  after(c, list?.c, "listing");
  const moved = event(c.ran, "nep171", "nft_transfer");
  const sale = event(c.ran, "satchel", "sale");
  if (moved?.old_owner_id !== SELLER || moved.new_owner_id !== BUYER || !moved.token_ids?.includes(TOKEN)) {
    fail(`the contract logged the transfer ${JSON.stringify(moved)}`);
  }
  if (sale?.token_id !== TOKEN || sale.seller !== SELLER || sale.buyer !== BUYER || sale.price !== price || sale.record_version !== record_version) {
    fail(`the contract logged the sale ${JSON.stringify(sale)}`);
  }
  // The seller's payment is a transfer receipt the contract's receipt created; it must have run.
  const paid = c.t.receipts.find(
    (r) =>
      r.predecessor_id === CONTRACT &&
      r.receiver_id === SELLER &&
      r.receipt.Action?.actions?.length === 1 &&
      r.receipt.Action.actions[0].Transfer?.deposit === price,
  );
  const ran = paid && c.t.receipts_outcome.find((o) => o.id === paid.receipt_id);
  if (!ran || !succeeded(ran.outcome.status)) fail(`no transfer of ${price} yoctoNEAR from ${CONTRACT} to ${SELLER} ran`);
  const paidBlock = await blockOf(ran.block_hash);
  return {
    c,
    facts: { ...where(c), signer: BUYER, price, recordVersion: record_version, paid: { receipt: paid.receipt_id, to: SELLER, deposit: price, block: String(paidBlock.height) } },
    line: `${hash.slice(0, 8)}… ${BUYER} bought #${TOKEN} naming record version ${record_version}; receipt ${paid.receipt_id.slice(0, 8)}… paid ${SELLER} ${price} yoctoNEAR`,
  };
}

/**
 * The seller's sign_evm for the satchel after the sale: refused by the owner check, with nothing
 * logged, no MPC request, and the satchel's owner, listing and record the same before and after it.
 * The transaction it asks to sign moves nothing: 0 to 0x…dEaD with no data.
 */
async function refusedStep(hash, buy) {
  const c = await callTo(hash, SELLER, "sign_evm");
  const asked = c.args.tx;
  if (c.args.token_id !== TOKEN || asked?.chain_id !== CHAIN) fail(`sign_evm for satchel #${c.args.token_id} on chain ${asked?.chain_id}`);
  if (c.deposit !== "1") fail(`attached ${c.deposit} yoctoNEAR, not 1`);
  const panic = panicOf(c.t.status);
  if (!panic?.endsWith(OWNER_CHECK) || panicOf(c.ran.outcome.status) !== panic) fail(`status ${JSON.stringify(c.t.status)}, not "${OWNER_CHECK}"`);
  if (events(c.ran).length > 0 || c.t.receipts.some((r) => r.predecessor_id === CONTRACT && r.receiver_id === MPC)) {
    fail("the contract logged an event or called the MPC contract");
  }
  after(c, buy?.c, "buy");
  // The state before the receipt ran (the block that included the transaction) and after it.
  const read = (block) =>
    Promise.all([
      viewAt(block, "nft_token", { token_id: TOKEN }),
      viewAt(block, "listing", { token_id: TOKEN }),
      viewAt(block, "signing_record", { token_id: TOKEN }),
    ]);
  const [[ownerBefore, , recordBefore], [token, listing, record]] = await Promise.all([read(c.t.transaction_outcome.block_hash), read(c.ran.block_hash)]);
  if (token?.owner_id !== BUYER || ownerBefore?.owner_id !== BUYER || listing !== null) {
    fail(`at its block ${token?.owner_id} owned #${TOKEN}${listing ? `, listed by ${listing.seller}` : ""}`);
  }
  if (JSON.stringify(record) !== JSON.stringify(recordBefore) || (buy && record.version !== buy.facts.recordVersion)) {
    fail(`record version ${recordBefore.version} before it, ${record.version} after${buy ? `, ${buy.facts.recordVersion} at the sale` : ""}`);
  }
  // Last, so a run on another refused call still shows every check above.
  if (!same(asked.to, DEAD) || BigInt(asked.value) !== 0n || (asked.data ?? "0x") !== "0x") {
    fail(`it asked for ${asked.value} wei to ${asked.to} with data ${asked.data}, not 0 to ${DEAD} with no data`);
  }
  return {
    c,
    facts: {
      ...where(c),
      receiptBlock: String(c.executed.height),
      gas: c.gas,
      deposit: c.deposit,
      args: c.args,
      panic,
      ownerAtBlock: token.owner_id,
      recordVersionAtBlock: record.version,
    },
    line: `${hash.slice(0, 8)}… ${SELLER}'s sign_evm (${BigInt(c.gas) / 10n ** 12n} Tgas): "${panic}" at block ${c.executed.height}; ${BUYER} owned #${TOKEN}, unlisted, record version ${record.version} before and after`,
  };
}

/** The report after the refused call: PROVABLY CLEAN for the buyer, unlisted, at the record version the buy named. */
function afterStep(file, buy, refused) {
  const report = readReport(file);
  if (report.verdict !== "clean") fail(`${basename(file)} reads ${VERDICT[report.verdict] ?? report.verdict}`);
  if (report.owner !== BUYER || report.listing !== null) fail(`${basename(file)} read owner ${report.owner} and listing ${JSON.stringify(report.listing)}`);
  if (buy && report.recordVersion !== buy.facts.recordVersion) fail(`${basename(file)} read record version ${report.recordVersion}, not ${buy.facts.recordVersion}`);
  if (refused && BigInt(Date.parse(report.checkedAt)) * 1_000_000n <= refused.c.executed.ns) {
    fail(`checked at ${report.checkedAt}, before the refused call ran`);
  }
  return { facts: reportFacts(report), line: `${basename(file)}: PROVABLY CLEAN at ${report.checkedAt} for ${BUYER}, not listed, record version ${report.recordVersion}` };
}

// ---- Commands ---------------------------------------------------------------------------------

function needs(...names) {
  const missing = names.filter((n) => !opts[n]);
  if (missing.length > 0) fail(`${command} needs --${missing.join(", --")}`);
  if (!/^\d{1,20}$/.test(TOKEN)) fail(`--token is a satchel id, like 3; not ${TOKEN}`);
}

/** Exits 0 only when the seller's sign_evm for the satchel can be refused only by the owner check. */
async function gate() {
  needs("token", "seller", "buyer");
  if (DEMO[NETWORK].has(TOKEN)) fail(`STOP: the README quotes ${NETWORK} satchel #${TOKEN}; nothing is sent for it until judging ends`);
  if (SELLER === BUYER) fail("STOP: --seller and --buyer are the same account");
  const { value: found, height } = await viewNow("satchel", { token_id: TOKEN });
  if (found === null) fail(`STOP: there is no satchel #${TOKEN} on ${CONTRACT}. Do not send the refused call.`);
  if (found.owner_id !== BUYER || found.listing !== null) {
    const listed = found.listing ? `, listed by ${found.listing.seller}` : "";
    fail(
      `STOP: at final block ${height} ${found.owner_id} owns satchel #${TOKEN}${listed}. Do not send the refused call: it is for after the buy, once ${BUYER} owns it unlisted.`,
    );
  }
  console.log(
    `GO: at final block ${height} ${BUYER} owns satchel #${TOKEN}, it is not listed, and its record is at version ${found.record.version}. ${SELLER} is not its owner, so its sign_evm can only fail the owner check.`,
  );
}

/** The seller's failed sign_evm calls for the satchel among its latest transactions, newest first. */
async function findRefused() {
  needs("token", "seller");
  const limit = Number(opts.limit ?? 50);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) fail("--limit is 1 to 200");
  const page = await indexPost("/v0/account", { account_id: SELLER, limit });
  const hashes = (page.account_txs ?? []).filter((t) => t.is_signer).map((t) => t.transaction_hash);
  const found = [];
  // The index answers at most 20 transactions per request.
  for (let i = 0; i < hashes.length; i += 20) {
    const { transactions = [] } = await indexPost("/v0/transactions", { tx_hashes: hashes.slice(i, i + 20) });
    for (const tx of transactions) {
      const call = tx?.transaction.actions?.[0]?.FunctionCall;
      if (tx?.transaction.receiver_id !== CONTRACT || call?.method_name !== "sign_evm") continue;
      let args;
      try {
        args = JSON.parse(Buffer.from(call.args, "base64").toString());
      } catch {
        continue;
      }
      const ran = tx.receipts?.find((r) => r.execution_outcome.outcome.executor_id === CONTRACT);
      const reason = panicOf(ran?.execution_outcome.outcome.status);
      if (args.token_id === TOKEN && reason) found.push({ hash: tx.transaction.hash, block: ran.execution_outcome.block_height, reason });
    }
  }
  console.log(`${SELLER}'s failed sign_evm calls for satchel #${TOKEN} on ${CONTRACT}, among its latest ${hashes.length} transactions, newest first:`);
  for (const f of found.sort((a, b) => b.block - a.block)) console.log(`  ${f.hash}  block ${f.block}  ${f.reason}`);
  if (found.length === 0) fail("  none. The index can lag a few seconds behind the chain: try again in a minute.");
}

async function sale() {
  const recording = command === "record";
  needs("token", "seller", "buyer", ...(recording ? ["mint", "list", "buy", "refused", "report-before", "report-after"] : []));
  if (SELLER === BUYER) fail("--seller and --buyer are the same account");
  if (Boolean(opts.send) !== Boolean(opts["evm-tx"])) fail("--send and --evm-tx go together: the sign_evm and the transaction the chain ran");
  const price = yocto(opts.price ?? "0.1");
  const out = opts.out ?? (NETWORK === "mainnet" ? fileURLToPath(new URL("../deployments/mainnet-sale.json", import.meta.url)) : null);
  if (recording && out === null) fail("on testnet, give --out: deployments/mainnet-sale.json is mainnet's");
  if (recording && existsSync(out) && !opts.replace) fail(`${out} exists: it is kept unless you pass --replace`);

  // The address comes from the saved reports, which derive it from the MPC root key satchel-nft pins.
  const addresses = [opts["report-before"], opts["report-after"]].filter(Boolean).map((f) => readReport(f).address);
  if (addresses.some((a) => !same(a, addresses[0]))) fail(`the two reports name different addresses: ${addresses.join(", ")}`);
  const address = addresses[0]?.toLowerCase() ?? null;
  if ((opts.fund || opts.send) && address === null) fail("--fund and --send need a report (--report-before or --report-after) for the satchel's address");

  let failed = 0;
  let ran = 0;
  const got = {};
  async function step(name, flag, run) {
    if (!opts[flag]) return null;
    ran += 1;
    try {
      const result = await run();
      console.log(`[PASS] ${name}\n       ${result.line}`);
      got[flag] = result;
      return result;
    } catch (err) {
      failed += 1;
      console.log(`[FAIL] ${name}\n       ${err.message}`);
      return null;
    }
  }
  console.log(`Satchel #${TOKEN} on ${CONTRACT} (${NETWORK}), sold by ${SELLER} to ${BUYER}${address ? `, address ${address}` : ""}\n`);
  const mint = await step(`${SELLER} minted #${TOKEN}`, "mint", () => mintStep(opts.mint));
  await step(`Its address was funded on chain ${CHAIN} after the mint`, "fund", () => fundStep(opts.fund, address, mint));
  const send = await step(`Its one signature before the sale ran on chain ${CHAIN}, finalized`, "send", () =>
    sendStep(opts.send, opts["evm-tx"], address, mint),
  );
  const list = await step(`${SELLER} listed it`, "list", () => listStep(opts.list, price, mint, send));
  // The buy is read before the buyer's report, whose time is checked against it, and shown after it.
  const bought = opts.buy ? await buyStep(opts.buy, list).then((result) => ({ result }), (error) => ({ error })) : null;
  await step("The buyer's report read PROVABLY CLEAN before the buy", "report-before", () => beforeStep(opts["report-before"], list, bought?.result));
  const buy = await step(`${BUYER} bought it at the listed record version, and ${SELLER} was paid`, "buy", async () => {
    if (bought.error) throw bought.error;
    return bought.result;
  });
  const refused = await step(`Then ${SELLER}'s sign_evm for it was refused by the owner check, and changed nothing`, "refused", () =>
    refusedStep(opts.refused, buy),
  );
  await step(`The report after it reads PROVABLY CLEAN for ${BUYER}`, "report-after", () => afterStep(opts["report-after"], buy, refused));

  console.log(`\n${ran - failed} of ${ran} steps hold (${RPC}, archival ${ARCHIVAL}${evmRead.size ? `, ${[...evmRead].join(", ")}` : ""})`);
  if (failed > 0) fail(recording ? `Nothing was written to ${out}.` : "");
  if (!recording) return;
  const record = {
    network: NETWORK,
    contract: CONTRACT,
    mpc: MPC,
    tokenId: TOKEN,
    path: PATH,
    address,
    seller: SELLER,
    buyer: BUYER,
    ...(opts.note ? { note: opts.note } : {}),
    price,
    recordVersion: got.list.facts.recordVersion,
    mint: got.mint.facts,
    ...(got.fund ? { funded: got.fund.facts } : {}),
    ...(got.send ? { send: got.send.facts } : {}),
    list: got.list.facts,
    reportBeforeBuy: got["report-before"].facts,
    buy: got.buy.facts,
    refused: got.refused.facts,
    verified: got["report-after"].facts,
    readFrom: [RPC, ARCHIVAL, ...evmRead],
    recordedAt: new Date().toISOString(),
  };
  // Written whole, so a reader at the same time never sees half of it.
  writeFileSync(`${out}.tmp`, `${json(record)}\n`);
  renameSync(`${out}.tmp`, out);
  console.log(`Wrote ${out}`);
}

const COMMANDS = { gate, "find-refused": findRefused, check: sale, record: sale };
COMMANDS[command]().then(
  () => {
    process.exitCode = 0;
  },
  (err) => {
    if (err.message) console.error(err instanceof Stop ? err.message : `${err.stack ?? err}`);
    process.exitCode = 1;
  },
);
