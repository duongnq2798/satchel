// Records the chain data the primitives' unit tests replay, into
// packages/satchel-nft/src/__fixtures__/primitives/<primitive>/<name>.json, each with its provenance:
// which network and node answered, which deployments file and JSON path named the value, the block,
// when, and the node's version. A fixture is frozen once captured: an existing file is kept unless
// --force is given.
// Node 22 or later, no install, no wallet, no key. Run `npm run build -w satchel-nft` first: the
// reads go through the built satchel-nft/near-rpc and satchel-nft/chain-signatures
// (packages/satchel-nft/dist/near-rpc.js and chain-signatures.js).
// Usage: node scripts/capture-primitive-fixtures.mjs [--only <primitive>] [--force]
//        node scripts/capture-primitive-fixtures.mjs --check-guards   (offline: both guards refuse writes)
//
// It only reads. Two guards stand between it and every node:
// 1. Every NEAR read goes through near-rpc's readOnlyRpc, which refuses any method but block, status,
//    query (view_account, view_access_key, view_access_key_list, view_code, call_function),
//    EXPERIMENTAL_tx_status and tx_status before anything is sent. Archival reads go to FastNEAR's
//    archival node with NEAR's own as the fallback; final reads go to the regular node.
// 2. Every request leaves through guardedFetch, which lets out only: JSON-RPC reads (the same list)
//    to the NEAR nodes in ENDPOINTS; EVM JSON-RPC reads (eth_chainId, eth_getTransactionByHash,
//    eth_getTransactionReceipt, eth_getBlockByNumber) to config.ts's publicnode Base and Sepolia
//    nodes and THIRD_PARTY.sepoliaReceipts; and FastNEAR's read-only REST calls
//    (POST <txApi>/v0/transactions, GET https://api.fastnear.com/v1/account/<id>/nft). Anything else
//    throws before any network access, so broadcast_tx_*, send_tx, eth_sendRawTransaction and every
//    signing method are refused twice. EVM reads also go through chain-signatures' readOnlyEvmClient,
//    whose readOnlyEvm guard refuses any method but those four before its transport is called.
// Calls run one at a time. No header or API key is ever written to a fixture.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { builtPackage } from "./built.mjs";

const { ENDPOINTS, READ_METHODS, READ_QUERY_TYPES, ReadOnlyError, RpcError, blockAt, fastnearSenderLookup, httpRpc, pinnedReader, readOnlyRpc, readTx, redactUrl, withFallback } =
  await builtPackage("near-rpc.js");
const { chainInfo } = await builtPackage("index.js");

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const force = args.includes("--force");
for (const [i, a] of args.entries()) {
  if (a === "--force" || a === "--check-guards" || a === "--only" || args[i - 1] === "--only") continue;
  console.error(`unknown argument ${a}\nusage: node scripts/capture-primitive-fixtures.mjs [--only <primitive>] [--force] | --check-guards`);
  process.exit(2);
}

const ROOT = new URL("../", import.meta.url);
const FIXTURES = new URL("packages/satchel-nft/src/__fixtures__/primitives/", ROOT);
const CAPTURED_BY = "scripts/capture-primitive-fixtures.mjs";

/**
 * Third-party values, each with how it was found. They may appear in fixtures and in docs/primitives,
 * never in the README.
 */
const THIRD_PARTY = {
  // NEAR Intents' contract on mainnet: an account with more keys than one page of 2, all of them
  // function-call keys, so `limit: 2` gives several real pages with real `last_key` values. Found by
  // listing its keys with view_access_key_list (9 keys on 2026-11-14).
  intents: "intents.near",
  // Sign requests tx-bench.testnet sent v1.signer-prod.testnet directly, found in FastNEAR's
  // transaction index (tx.test.fastnear.com) of v1.signer-prod.testnet on 2026-11-14: public
  // Chain Signatures traffic, with ed25519 (domain 1) requests no Satchel transaction makes.
  txBench: {
    account: "tx-bench.testnet",
    // Domain 1 (ed25519), path "", Eddsa payload 7e2b493e…4829, included at block 277610643.
    eddsa: "FgbWCHbK6AAYAJ31tBNZHph3M7V3Ltt4aGrX7mvGtKWm",
    // Domain 0 (secp256k1), path "".
    ecdsa: "9FsAULuTHAmYXKanZKntNGwPYK1ydnCBFeXrs2huPSmM",
    // Domain 1, included at block 277610675. Recorded with whatever status it has.
    eddsaLater: "HthQSVE5dEbQwTH6UPRRTykFJkijPodv3RWSjsdiMhzk",
  },
  // A public Sepolia node that serves the receipt of testnet-dao.json steps[7].sepolia.tx: on
  // 2026-11-14 config.ts's publicnode Sepolia node (and 1rpc.io's) answered that transaction but a
  // null receipt for it, while this one answered the receipt (status 0x1). Reads only, as the others.
  sepoliaReceipts: "https://sepolia.gateway.tenderly.co",
};

/** Satchel tokens minted on each network (testnet #1-#11, mainnet #1-#3), whose keys the derived-key fixtures read. */
const SATCHEL_TOKENS = { testnet: 11, mainnet: 3 };

// ---- Satchel values, from deployments/*.json --------------------------------------------------

function deployment(file) {
  return JSON.parse(readFileSync(new URL(`deployments/${file}`, ROOT), "utf8"));
}

/** The value at `path` ("steps[1].tx") in deployments/`file`, or a stop naming the path. */
function fromDeployment(file, path) {
  let value = deployment(file);
  for (const part of path.split(".").flatMap((p) => p.split(/\[(\d+)\]/).filter(Boolean))) {
    value = value?.[/^\d+$/.test(part) ? Number(part) : part];
  }
  if (value === undefined || value === null || value === "") {
    console.error(`deployments/${file} has no ${path}: the capture needs it`);
    process.exit(1);
  }
  return { value, source: `deployments/${file} ${path}` };
}

// ---- Guard 2: what may leave this process -----------------------------------------------------

const EVM_READ_METHODS = ["eth_chainId", "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getBlockByNumber"];
const NEAR_URLS = new Set(Object.values(ENDPOINTS).flatMap((e) => [e.rpc, e.archival, e.nearArchival]));
const EVM_URLS = new Set([chainInfo(8453)?.rpc, chainInfo(11155111)?.rpc, THIRD_PARTY.sepoliaReceipts].filter(Boolean));
const TX_INDEX_URLS = new Set(Object.values(ENDPOINTS).map((e) => `${e.txApi}/v0/transactions`));
const NFT_INDEX = /^https:\/\/api\.fastnear\.com\/v1\/account\/[a-z0-9._-]+\/nft$/;

function refuse(method, detail) {
  throw new ReadOnlyError(method, `capture guard: ${detail}`);
}

function checkNearBody(body) {
  for (const call of Array.isArray(body) ? body : [body]) {
    if (!READ_METHODS.includes(call?.method)) refuse(String(call?.method), "not a NEAR read method");
    if (call.method === "query" && !READ_QUERY_TYPES.includes(call.params?.request_type)) {
      refuse("query", `request_type ${JSON.stringify(call.params?.request_type ?? null)} is not a read`);
    }
  }
}

function checkEvmBody(body) {
  for (const call of Array.isArray(body) ? body : [body]) {
    if (!EVM_READ_METHODS.includes(call?.method)) refuse(String(call?.method), "not an EVM read method");
  }
}

async function guardedFetch(input, init = {}) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init.method ?? "GET").toUpperCase();
  const where = url.replace(/\/+$/, "");
  if (method === "POST" && NEAR_URLS.has(where)) checkNearBody(JSON.parse(String(init.body)));
  else if (method === "POST" && EVM_URLS.has(where)) checkEvmBody(JSON.parse(String(init.body)));
  else if (method === "POST" && TX_INDEX_URLS.has(where)) {
    const body = JSON.parse(String(init.body));
    if (!Array.isArray(body?.tx_hashes) || Object.keys(body).length !== 1) refuse("POST /v0/transactions", "only {tx_hashes} is read");
  } else if (!(method === "GET" && NFT_INDEX.test(where))) refuse(`${method} ${redactUrl(url)}`, "not an allowed read");
  return fetch(input, init);
}

// ---- Guard 1, and recording ---------------------------------------------------------------------

/** httpRpc through guardedFetch, noting each origin that answered (a result or a JSON-RPC error). */
function tracked(url, answered) {
  const rpc = httpRpc(url, { fetch: guardedFetch });
  return async (method, params) => {
    try {
      const result = await rpc(method, params);
      answered.add(redactUrl(url));
      return result;
    } catch (err) {
      if (err instanceof RpcError && err.kind === "rpc-error") answered.add(redactUrl(url));
      throw err;
    }
  };
}

/** The regular node for final reads, and archival with NEAR's own node as the fallback, both read-only. */
function transports(network) {
  const answered = new Set();
  const e = ENDPOINTS[network];
  return {
    answered,
    regular: readOnlyRpc(tracked(e.rpc, answered)),
    archival: readOnlyRpc(withFallback(tracked(e.archival, answered), tracked(e.nearArchival, answered))),
  };
}

/** An RpcCall that records every call `rpc` answered, a JSON-RPC error included. */
function recorder(rpc) {
  const calls = [];
  const call = async (method, params) => {
    try {
      const result = await rpc(method, params);
      calls.push({ method, params, result });
      return result;
    } catch (err) {
      if (err instanceof RpcError && err.kind === "rpc-error") calls.push({ method, params, error: err.data });
      throw err;
    }
  };
  return Object.assign(call, { calls });
}

/** `status` version and build of each node that answered. */
async function nodeVersions(answered) {
  const out = [];
  for (const origin of answered) {
    const status = await readOnlyRpc(httpRpc(origin, { fetch: guardedFetch }))("status", []);
    out.push(`${status.version.version} (build ${status.version.build}) at ${origin}`);
  }
  return out.join("; ");
}

const provenance = (fields) => ({ ...fields, capturedAt: new Date().toISOString(), capturedBy: CAPTURED_BY, modified: false });

function write(primitive, name, fixture) {
  const dir = new URL(`${primitive}/`, FIXTURES);
  const file = new URL(`${name}.json`, dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`wrote ${file.pathname.replace(/^\/([A-Za-z]:)/, "$1")}`);
}

const exists = (primitive, name) => existsSync(new URL(`${primitive}/${name}.json`, FIXTURES));

/** Ignores the JSON-RPC error a read is expected to answer (a missing account, say); throws anything else. */
async function expectAnswer(promise) {
  try {
    return await promise;
  } catch (err) {
    if (err?.name === "ViewError" || (err instanceof RpcError && err.kind === "rpc-error")) return err;
    throw err;
  }
}

// ---- The fixtures -------------------------------------------------------------------------------

const JOBS = {
  "near-rpc": [
    {
      name: "intents-keys-paged",
      /** intents.near's key list at one final block, read through archival with limit 2, plus the page after the last key and the unpaged list. */
      async run() {
        const { answered, archival } = transports("mainnet");
        const final = await blockAt(archival, "final");
        const rec = recorder(archival);
        const reader = await pinnedReader(rec, { blockHash: final.hash });
        const paged = await reader.accessKeys(THIRD_PARTY.intents, { pageSize: 2 });
        const lastKey = paged.keys.at(-1)?.publicKey;
        // The real answer after the last key: an empty page.
        await rec("query", { request_type: "view_access_key_list", block_id: final.hash, account_id: THIRD_PARTY.intents, limit: 2, after_key: lastKey });
        // The whole list in one call, which a node 2.14 or later still serves under its limit (100).
        await rec("query", { request_type: "view_access_key_list", block_id: final.hash, account_id: THIRD_PARTY.intents });
        const version = await nodeVersions(answered);
        const sawLastKey = rec.calls.some((c) => typeof c.result?.last_key === "string");
        const v = /^(\d+)\.(\d+)\./.exec(version);
        const pagingNode = v !== null && (Number(v[1]) > 2 || (Number(v[1]) === 2 && Number(v[2]) >= 14));
        return {
          provenance: provenance({
            network: "mainnet",
            rpc: [...answered].join(", "),
            source: `THIRD_PARTY.intents (${THIRD_PARTY.intents}), key list with limit 2`,
            method: "query",
            params: { request_type: "view_access_key_list", account_id: THIRD_PARTY.intents, limit: 2 },
            block: { height: final.height, hash: final.hash, why: "a final block at capture, read through the archival node so it can be read again later" },
            nodeVersion: version,
            notes: pagingNode && sawLastKey ? "paged" : "not paged: the node is older than 2.14.0 or sent no last_key",
          }),
          calls: rec.calls,
        };
      },
    },
    {
      name: "views-mainnet",
      /** At one final block on mainnet: Satchel's contract and its parent account, read every way near-rpc reads. */
      async run() {
        const contract = fromDeployment("mainnet.json", "contract");
        const parent = fromDeployment("mainnet.json", "parent_account");
        // A sub-account of the locked contract: it has no key, so no such account can ever be created.
        const missing = `missing.${contract.value}`;
        const noKey = "ed25519:11111111111111111111111111111111";
        const { answered, regular } = transports("mainnet");
        const final = await blockAt(regular, "final");
        const rec = recorder(regular);
        const reader = await pinnedReader(rec, { blockHash: final.hash });
        await reader.account(contract.value);
        await reader.account(missing);
        await reader.view(contract.value, "mpc_contract");
        await expectAnswer(reader.view(contract.value, "evm_signing_hash"));
        await expectAnswer(reader.view(contract.value, "no_such_view"));
        await expectAnswer(reader.view(parent.value, "mpc_contract"));
        await expectAnswer(reader.view(missing, "mpc_contract"));
        const listed = await reader.accessKeys(parent.value);
        if (listed.keys.length === 0) throw new Error(`${parent.value} lists no key: the full-access case needs one`);
        await reader.accessKey(parent.value, listed.keys[0].publicKey);
        await reader.accessKey(parent.value, noKey);
        await reader.accessKey(missing, noKey);
        await reader.accessKeys(contract.value);
        await reader.codeSha256(parent.value);
        return {
          provenance: provenance({
            network: "mainnet",
            rpc: [...answered].join(", "),
            source: `${contract.source}, ${parent.source}; ${missing} (no key can create it) and ${noKey} (all-zero, held by no one)`,
            block: { height: final.height, hash: final.hash, why: "a final block at capture" },
            nodeVersion: await nodeVersions(answered),
          }),
          calls: rec.calls,
        };
      },
    },
  ],
  "chain-signatures": [
    // NEAR transactions: each the full EXPERIMENTAL_tx_status answer at FINAL, from archival, untrimmed.
    txJob("tx-EZLX", "testnet", () => fromDeployment("testnet-e2e.json", "steps[1].tx"), "the owner's direct sign_evm (satchel #1)"),
    txJob("tx-2ryQps", "testnet", () => fromDeployment("testnet-dao.json", "steps[5].tx"), "the DAO vote that had satchel #8 sign through v1.satchel-nft.testnet"),
    txJob("tx-GqFsnm", "testnet", () => fromDeployment("testnet-e2e.json", "steps[4].tx"), "the previous owner's sign_evm, refused"),
    txJob("tx-2xqwe8", "mainnet", () => fromDeployment("mainnet-first-send.json", "nearTx"), "mainnet satchel #1's sign_evm for its Base send"),
    txJob("tx-FnFSMSh1", "mainnet", () => fromDeployment("mainnet-1click-exit.json", "deposit.nearTx"), "mainnet satchel #2's sign_evm for its 1Click deposit on Base"),
    txJob("tx-33UTwy", "mainnet", () => fromDeployment("mainnet-sale.json", "refused.tx"), "the seller's sign_evm after the sale, refused"),
    txJob("tx-FgbW", "testnet", () => thirdParty("txBench.eddsa"), "tx-bench.testnet's ed25519 (domain 1) request, path \"\""),
    txJob("tx-9FsA", "testnet", () => thirdParty("txBench.ecdsa"), "tx-bench.testnet's secp256k1 (domain 0) request, path \"\""),
    txJob("tx-HthQSVE", "testnet", () => thirdParty("txBench.eddsaLater"), "tx-bench.testnet's later ed25519 (domain 1) request"),
    // The MPC root keys and derived keys at one final block on each network.
    derivedKeysJob("testnet"),
    derivedKeysJob("mainnet"),
    // EVM transactions the MPC answers signed, read through readOnlyEvmClient: Base at config.ts's
    // publicnode node, Sepolia at THIRD_PARTY.sepoliaReceipts (publicnode answers no receipt for it).
    evmJob(
      "evm-sepolia-27e3",
      "sepolia",
      11155111,
      () => fromDeployment("testnet-dao.json", "steps[7].sepolia.tx"),
      "satchel #8's Sepolia send, signed through the DAO vote",
      "sepoliaReceipts",
    ),
    evmJob("evm-base-8044", "base", 8453, () => fromDeployment("mainnet-first-send.json", "baseTx"), "mainnet satchel #1's Base send"),
    evmJob("evm-base-2d9b", "base", 8453, () => fromDeployment("mainnet-1click-exit.json", "deposit.tx"), "mainnet satchel #2's 1Click deposit on Base"),
  ],
};

/** A third-party value by its path in THIRD_PARTY, with that path as its source. */
function thirdParty(path) {
  let value = THIRD_PARTY;
  for (const part of path.split(".")) value = value?.[part];
  if (typeof value !== "string") throw new Error(`THIRD_PARTY has no ${path}`);
  return { value, source: `THIRD_PARTY.${path}` };
}

/** A transaction's full EXPERIMENTAL_tx_status answer at FINAL, read through archival, its sender from FastNEAR's index. */
function txJob(name, network, pick, what) {
  return {
    name,
    async run() {
      const tx = pick();
      const { answered, archival } = transports(network);
      const rec = recorder(archival);
      const senderLookup = fastnearSenderLookup(ENDPOINTS[network].txApi, { fetch: guardedFetch });
      const result = await readTx(rec, tx.value, { senderLookup });
      const block = await blockAt(archival, { blockHash: result.transaction_outcome.block_hash });
      const call = rec.calls.at(-1);
      return {
        provenance: provenance({
          network,
          rpc: [...answered].join(", "),
          source: `${tx.source}; sender from ${redactUrl(ENDPOINTS[network].txApi)}/v0/transactions`,
          method: call.method,
          params: call.params,
          block: { height: block.height, hash: block.hash, why: "the block that included the transaction" },
          nodeVersion: await nodeVersions(answered),
          notes: what,
        }),
        result,
      };
    },
  };
}

/**
 * At one final block: the MPC contract's `public_key` for domains 0 and 1, and `derived_public_key` for
 * Satchel's contract and each minted token's path (domain 0); on testnet also tx-bench.testnet with
 * the empty path, in both domains. The values in MPC_ROOT_KEYS must equal what was read here.
 */
function derivedKeysJob(network) {
  return {
    name: `derived-keys-domains-${network}`,
    async run() {
      const file = `${network}.json`;
      const contract = fromDeployment(file, "contract");
      const mpc = fromDeployment(file, "mpc_contract");
      const { answered, regular } = transports(network);
      const final = await blockAt(regular, "final");
      const rec = recorder(regular);
      const reader = await pinnedReader(rec, { blockHash: final.hash });
      for (const domain of [0, 1]) await reader.view(mpc.value, "public_key", { domain_id: domain });
      for (let i = 1; i <= SATCHEL_TOKENS[network]; i++) {
        await reader.view(mpc.value, "derived_public_key", { path: `satchel/${i}`, predecessor: contract.value, domain_id: 0 });
      }
      const sources = [contract.source, mpc.source];
      if (network === "testnet") {
        for (const domain of [1, 0]) await reader.view(mpc.value, "derived_public_key", { path: "", predecessor: THIRD_PARTY.txBench.account, domain_id: domain });
        sources.push("THIRD_PARTY.txBench.account");
      }
      return {
        provenance: provenance({
          network,
          rpc: [...answered].join(", "),
          source: `${sources.join(", ")}; tokens 1-${SATCHEL_TOKENS[network]} (SATCHEL_TOKENS)`,
          block: { height: final.height, hash: final.hash, why: "a final block at capture: MPC_ROOT_KEYS names it" },
          nodeVersion: await nodeVersions(answered),
        }),
        calls: rec.calls,
      };
    },
  };
}

/**
 * An EVM transaction's eth_chainId, eth_getTransactionByHash, eth_getTransactionReceipt and the
 * finalized block, read through satchel-nft/chain-signatures' readOnlyEvmClient (guard 1 for EVM) over
 * guardedFetch (guard 2), recorded as the node answered them.
 */
function evmJob(name, network, chainId, pick, what, node = null) {
  return {
    name,
    async run() {
      const { readOnlyEvmClient } = await builtPackage("chain-signatures.js");
      const chains = await import("viem/chains");
      const chain = network === "base" ? chains.base : chains.sepolia;
      const tx = pick();
      const url = node === null ? chainInfo(chainId)?.rpc : THIRD_PARTY[node];
      if (!url) throw new Error(`config.ts has no chain ${chainId}`);
      const calls = [];
      const recording = async (input, init = {}) => {
        const res = await guardedFetch(input, init);
        const asked = JSON.parse(String(init.body));
        const text = await res.clone().text();
        let answer = null;
        try {
          answer = JSON.parse(text);
        } catch {
          // Not JSON: nothing to record; the client reports it.
        }
        if (answer && answer.result !== undefined) calls.push({ method: asked.method, params: asked.params ?? [], result: answer.result });
        else if (answer && answer.error !== undefined) calls.push({ method: asked.method, params: asked.params ?? [], error: answer.error });
        return res;
      };
      const client = readOnlyEvmClient(chain, url, { fetch: recording });
      await client.getChainId();
      const read = await client.getTransaction({ hash: tx.value });
      await client.getTransactionReceipt({ hash: tx.value });
      const finalized = await client.getBlock({ blockTag: "finalized" });
      return {
        provenance: provenance({
          network,
          rpc: redactUrl(url),
          source: `${tx.source}; node from ${node === null ? `config.ts chainInfo(${chainId}).rpc` : `THIRD_PARTY.${node}`}`,
          block: { height: Number(read.blockNumber), hash: read.blockHash, why: "the block that included the transaction" },
          notes: `${what}; the finalized block was ${finalized.number} at capture`,
        }),
        calls,
      };
    },
  };
}

// ---- --check-guards: both guards, offline ------------------------------------------------------

/**
 * Sends writes at both guards with the network replaced by a function that fails, so nothing can
 * leave even if a guard let a call through. Each must throw ReadOnlyError. Exits 0 when all do.
 */
async function checkGuards() {
  globalThis.fetch = async () => {
    throw new Error("the network was reached");
  };
  const raw = fromDeployment("testnet-e2e.json", "steps[2].raw").value;
  const { readOnlyEvmClient } = await builtPackage("chain-signatures.js");
  const { sepolia } = await import("viem/chains");
  // viem wraps what its transport throws, so the ReadOnlyError is somewhere on the cause chain.
  const readOnlyCause = (e) => {
    for (let at = e; at; at = at.cause) if (at instanceof ReadOnlyError) return at;
    return e;
  };
  const post = (method, params) => ({ method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: "satchel", method, params }) });
  const cases = [
    ["readOnlyRpc: broadcast_tx_commit to the testnet node", () => transports("testnet").regular("broadcast_tx_commit", ["AAAA"])],
    ["readOnlyRpc: send_tx to the mainnet archival nodes", () => transports("mainnet").archival("send_tx", { signed_tx_base64: "AAAA", wait_until: "NONE" })],
    ["readOnlyRpc: a query that is not a view", () => transports("testnet").regular("query", { request_type: "sandbox_patch", finality: "final" })],
    ["guardedFetch: broadcast_tx_async to a NEAR node", () => guardedFetch(ENDPOINTS.testnet.rpc, post("broadcast_tx_async", ["AAAA"]))],
    ["guardedFetch: eth_sendRawTransaction of testnet-e2e.json steps[2].raw to Sepolia", () => guardedFetch(chainInfo(11155111).rpc, post("eth_sendRawTransaction", [raw]))],
    ["guardedFetch: eth_sendTransaction to Base", () => guardedFetch(chainInfo(8453).rpc, post("eth_sendTransaction", [{}]))],
    ["guardedFetch: a host outside the lists", () => guardedFetch("https://rpc.example.org", post("status", []))],
    [
      "readOnlyEvmClient: sendRawTransaction of testnet-e2e.json steps[2].raw to Sepolia",
      () =>
        readOnlyEvmClient(sepolia, chainInfo(11155111).rpc, { fetch: guardedFetch })
          .sendRawTransaction({ serializedTransaction: raw })
          .catch((e) => Promise.reject(readOnlyCause(e))),
    ],
  ];
  let through = 0;
  for (const [name, attempt] of cases) {
    const err = await attempt().then(
      () => null,
      (e) => e,
    );
    const refused = err instanceof ReadOnlyError;
    if (!refused) through++;
    console.log(refused ? `refused      ${name}` : `NOT REFUSED  ${name}: ${err?.message ?? "it answered"}`);
  }
  console.log(through === 0 ? `both guards refused all ${cases.length} writes; nothing reached the network` : `${through} of ${cases.length} writes got past a guard`);
  return through === 0 ? 0 : 1;
}

if (args.includes("--check-guards")) process.exit(await checkGuards());

if (only !== null && !(only in JOBS)) {
  console.error(`no fixtures for ${only}; known: ${Object.keys(JOBS).join(", ")}`);
  process.exit(2);
}

let failed = 0;
for (const [primitive, jobs] of Object.entries(JOBS)) {
  if (only !== null && primitive !== only) continue;
  for (const job of jobs) {
    if (exists(primitive, job.name) && !force) {
      console.log(`kept ${primitive}/${job.name}.json (frozen; --force replaces it)`);
      continue;
    }
    try {
      write(primitive, job.name, await job.run());
    } catch (err) {
      failed++;
      const kind = err instanceof RpcError ? ` (${err.kind})` : "";
      console.error(`${primitive}/${job.name}: ${err instanceof Error ? err.message : String(err)}${kind}`);
    }
  }
}
process.exit(failed === 0 ? 0 : 1);
