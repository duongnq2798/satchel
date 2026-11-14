// Records the chain data the primitives' unit tests replay, into
// packages/satchel-nft/src/__fixtures__/primitives/<primitive>/<name>.json, each with its provenance:
// which network and node answered, which deployments file and JSON path named the value, the block,
// when, and the node's version. A fixture is frozen once captured: an existing file is kept unless
// --force is given.
// Node 22 or later, no install, no wallet, no key. Run `npm run build -w satchel-nft` first: the
// reads go through the built satchel-nft/near-rpc (packages/satchel-nft/dist/near-rpc.js).
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
//    nodes; and FastNEAR's read-only REST calls (POST <txApi>/v0/transactions,
//    GET https://api.fastnear.com/v1/account/<id>/nft). Anything else throws before any network
//    access, so broadcast_tx_*, send_tx, eth_sendRawTransaction and every signing method are refused
//    twice. (There is no EVM capture yet; guard 2 already covers EVM reads.)
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
};

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
const EVM_URLS = new Set([chainInfo(8453)?.rpc, chainInfo(11155111)?.rpc].filter(Boolean));
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
    {
      name: "tx-EZLX",
      /** The owner's direct sign_evm on testnet: the full EXPERIMENTAL_tx_status answer at FINAL, from archival. */
      async run() {
        const tx = fromDeployment("testnet-e2e.json", "steps[1].tx");
        const { answered, archival } = transports("testnet");
        const rec = recorder(archival);
        const senderLookup = fastnearSenderLookup(ENDPOINTS.testnet.txApi, { fetch: guardedFetch });
        const result = await readTx(rec, tx.value, { senderLookup });
        const block = await blockAt(archival, { blockHash: result.transaction_outcome.block_hash });
        const [call] = rec.calls;
        return {
          provenance: provenance({
            network: "testnet",
            rpc: [...answered].join(", "),
            source: `${tx.source}; sender from ${redactUrl(ENDPOINTS.testnet.txApi)}/v0/transactions`,
            method: call.method,
            params: call.params,
            block: { height: block.height, hash: block.hash, why: "the block that included the transaction" },
            nodeVersion: await nodeVersions(answered),
          }),
          result,
        };
      },
    },
  ],
};

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
  const post = (method, params) => ({ method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: "satchel", method, params }) });
  const cases = [
    ["readOnlyRpc: broadcast_tx_commit to the testnet node", () => transports("testnet").regular("broadcast_tx_commit", ["AAAA"])],
    ["readOnlyRpc: send_tx to the mainnet archival nodes", () => transports("mainnet").archival("send_tx", { signed_tx_base64: "AAAA", wait_until: "NONE" })],
    ["readOnlyRpc: a query that is not a view", () => transports("testnet").regular("query", { request_type: "sandbox_patch", finality: "final" })],
    ["guardedFetch: broadcast_tx_async to a NEAR node", () => guardedFetch(ENDPOINTS.testnet.rpc, post("broadcast_tx_async", ["AAAA"]))],
    ["guardedFetch: eth_sendRawTransaction of testnet-e2e.json steps[2].raw to Sepolia", () => guardedFetch(chainInfo(11155111).rpc, post("eth_sendRawTransaction", [raw]))],
    ["guardedFetch: eth_sendTransaction to Base", () => guardedFetch(chainInfo(8453).rpc, post("eth_sendTransaction", [{}]))],
    ["guardedFetch: a host outside the lists", () => guardedFetch("https://rpc.example.org", post("status", []))],
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
