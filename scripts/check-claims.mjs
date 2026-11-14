// Checks the README's on-chain claims about a deployment against NEAR RPC: the contract's lock, code
// and signer, the transactions that deployed and locked it, the MPC root key the package derives
// addresses from; on testnet, the calls it refused; on mainnet, satchel #1 and its first send on
// Base, satchel #2's ETH on Base swapped through 1Click into USDC at its address on Arbitrum One,
// and, once deployments/mainnet-sale.json holds it, a satchel sold to a second account and its
// seller's sign_evm refused after the sale.
// Node 22 or later, no install, no wallet, no key.
// Usage: node scripts/check-claims.mjs [--network testnet|mainnet]   (testnet by default)
// NEAR_RPC and NEAR_ARCHIVAL_RPC replace the default nodes; old transactions need an archival one.
// With NEAR_ARCHIVAL_RPC unset, an archival read FastNEAR's node doesn't answer goes to NEAR's own,
// and once that answers, later reads ask it first, until FastNEAR's answers one it didn't; the last
// line then says so. A node whose Retry-After asks for more than 30 s isn't asked again for that read.
// BASE_RPC and ARBITRUM_RPC replace the Base and Arbitrum One nodes the mainnet run reads; with
// BASE_RPC unset, a Base read the default node fails goes to Base's own public node. The last claim
// about satchel #2 also reads 1Click's public status for its deposit. A node read that fails because
// the node is busy (HTTP 408, 429 or 5xx, or a failed connection) is sent up to 7 times with backoff;
// any other failed read is tried once more, 2 s later, before its claim fails. Archival reads go out
// one at a time.
import { existsSync, readFileSync } from "node:fs";

const flag = process.argv.indexOf("--network");
const NETWORK = flag === -1 ? "testnet" : process.argv[flag + 1];
if (NETWORK !== "testnet" && NETWORK !== "mainnet") {
  console.error("usage: node scripts/check-claims.mjs [--network testnet|mainnet]");
  process.exit(2);
}
const deployment = JSON.parse(readFileSync(new URL(`../deployments/${NETWORK}.json`, import.meta.url), "utf8"));
const RPC = process.env.NEAR_RPC ?? `https://rpc.${NETWORK}.fastnear.com`;
const ARCHIVAL = process.env.NEAR_ARCHIVAL_RPC ?? `https://archival-rpc.${NETWORK}.fastnear.com`;
/** Read only if NEAR_ARCHIVAL_RPC is unset and the default node doesn't answer, as in check-dao.mjs. */
const ARCHIVAL_FALLBACKS = [`https://archival-rpc.${NETWORK}.near.org`];
const CONTRACT = deployment.contract;
// Testnet only: the accounts behind the demo satchels and the refused calls.
const OWNER = "satchel-nft.testnet";
const BUYER = "buyer.satchel-nft.testnet";
const ONE_NEAR = "1000000000000000000000000";
/** Satchel #1's mint, the contract's first (deployments/testnet-e2e.json). Token ids start at 1. */
const FIRST_MINT_TX = "3kBMVhva8pagScLwGJDNwF6Bfbzno9LxAVN5JKENvPxo";
/** Satchel #1 moving from its first owner to the buyer, before the refused `sign_evm`. */
const TRANSFER_TX = "3sLuGS9pEnvURpha3QQBtumExxKC2f3GMJSRaccvNBwB";
const STALE_BUY_TX = "7HQPu9qeJauNrJLaMNCUuMJVska3u3uYsoGyp7gsCfWv";
// Mainnet only: satchel #1, minted after the lock, and its first send (deployments/mainnet-first-send.json).
const FIRST =
  NETWORK === "mainnet" ? JSON.parse(readFileSync(new URL("../deployments/mainnet-first-send.json", import.meta.url), "utf8")) : null;
// Mainnet only: satchel #2 and its exit through NEAR Intents' 1Click (deployments/mainnet-1click-exit.json).
const EXIT =
  NETWORK === "mainnet" ? JSON.parse(readFileSync(new URL("../deployments/mainnet-1click-exit.json", import.meta.url), "utf8")) : null;
// Mainnet only, once it has run: a satchel's sale and the refused call after it
// (deployments/mainnet-sale.json, written by tools/mainnet-sale-record.mjs). Until the file exists,
// the mainnet run checks what it checked before.
const SALE_FILE = new URL("../deployments/mainnet-sale.json", import.meta.url);
const SALE = NETWORK === "mainnet" && existsSync(SALE_FILE) ? JSON.parse(readFileSync(SALE_FILE, "utf8")) : null;
const BASE_RPC = process.env.BASE_RPC ?? "https://base-rpc.publicnode.com";
/** Base's own public node, which also serves old state: read only if BASE_RPC is unset and the default node fails. */
const BASE_FALLBACK = "https://mainnet.base.org";
const ARBITRUM_RPC = process.env.ARBITRUM_RPC ?? "https://arb1.arbitrum.io/rpc";

/** Runs `read`, and once more 2 s later if it throws: public nodes sometimes drop a request. */
async function twice(read) {
  try {
    return await read();
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    return read();
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A node that didn't answer. `busy` (HTTP 408, 429 or 5xx, or a failed connection) marks one worth
 * asking again soon; a timeout, any other HTTP error but a 400 with a JSON-RPC error, or a reply that
 * isn't JSON is not.
 */
class NoAnswer extends Error {
  constructor(message, { busy = false, retryAfter = null } = {}) {
    super(message);
    this.busy = busy;
    this.retryAfter = retryAfter;
  }
}

async function rpcOnce(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "satchel", method, params }),
    signal: AbortSignal.timeout(30_000),
  }).catch((err) => {
    // A request that timed out after 30 s gets one more try, like any other failure, not three.
    throw new NoAnswer(`${method}: ${err.message} from ${url}`, { busy: err.name !== "TimeoutError" });
  });
  if (res.status === 408 || res.status === 429 || res.status >= 500) {
    // Retry-After in seconds; a date, or no header, leaves the backoff as it is.
    const header = res.headers.get("retry-after");
    const seconds = header === null || header.trim() === "" ? Number.NaN : Number(header);
    throw new NoAnswer(`${method}: HTTP ${res.status} from ${url}`, {
      busy: true,
      retryAfter: Number.isFinite(seconds) && seconds >= 0 ? seconds : null,
    });
  }
  if (!res.ok) {
    // nearcore answers 400, with a JSON error, to a request it can't parse: the request is wrong, not
    // the node. Any other error page, a 403 or a 404, is a node not answering.
    const error = res.status === 400 ? (await res.json().catch(() => null))?.error : undefined;
    if (error) throw new Error(`${method}: HTTP 400, ${JSON.stringify(error.cause ?? error)} from ${url}`);
    throw new NoAnswer(`${method}: HTTP ${res.status} from ${url}`);
  }
  const body = await res.json().catch((err) => {
    // A body that stalls past the timeout, or a connection cut off partway, is not "not JSON".
    throw err.name === "SyntaxError"
      ? new NoAnswer(`${method}: a reply that is not JSON from ${url}`)
      : new NoAnswer(`${method}: ${err.message} from ${url}`, { busy: err.name !== "TimeoutError" });
  });
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error.cause ?? body.error)} from ${url}`);
  return body.result;
}

/**
 * Sends a read, and again while the node is busy: up to 7 sends, 1, 2 and 4 s apart and then 8 s, or
 * longer if its Retry-After asks, up to 8 s. A node whose Retry-After asks for more than 30 s isn't
 * asked again for this read. Any other failure is tried once more, 2 s later.
 */
async function rpc(url, method, params) {
  for (let sent = 1; ; sent += 1) {
    try {
      return await rpcOnce(url, method, params);
    } catch (err) {
      const busy = err instanceof NoAnswer && err.busy;
      // NEAR's archival node asked for 329 s on 2026-11-14: more sends only met more 429s.
      if (sent >= (busy ? 7 : 2) || (busy && (err.retryAfter ?? 0) > 30)) throw err;
      const backoff = 1_000 * 2 ** (sent - 1);
      // A Retry-After can only make the wait longer: FastNEAR's archival node sends `retry-after: 0`
      // with its 429s, and asking again at once only meets another 429.
      await wait(busy ? Math.min(Math.max(backoff, (err.retryAfter ?? 0) * 1_000), 8_000) : 2_000);
    }
  }
}

/** The archival nodes that answered reads, which the last line names when a fallback did. */
const answeredBy = new Set();

/**
 * The archival nodes in the order a read asks them: NEAR_ARCHIVAL_RPC alone or, with it unset,
 * FastNEAR's and then NEAR's own. The node that answered the last read, with a result or an error,
 * is asked first: once a fallback answers a read FastNEAR's didn't, later reads ask it first and
 * FastNEAR's last, until FastNEAR's answers one the fallback didn't.
 */
let archivalNodes = process.env.NEAR_ARCHIVAL_RPC ? [ARCHIVAL] : [ARCHIVAL, ...ARCHIVAL_FALLBACKS];

function answered(url) {
  if (archivalNodes[0] !== url) archivalNodes = [url, ...archivalNodes.filter((u) => u !== url)];
}

/**
 * Archival reads go out one at a time, in the order they were asked for. On 2026-11-14 FastNEAR's
 * archival node let about 8 reads through at once and then about one every 5 s: reads sent together
 * only raced for the same few, and the one that lost every race used up its sends.
 */
let archivalTurn = Promise.resolve();

function archival(method, params) {
  const read = archivalTurn.then(() => archivalRead(method, params));
  archivalTurn = read.catch(() => {});
  return read;
}

/**
 * An archival read from the first of `archivalNodes` that answers. Only a node that doesn't answer is
 * passed over. An error the first node asked answers with fails the claim. One a later node answers
 * with fails it too, and names the nodes before it that didn't answer: no other node checked it.
 */
async function archivalRead(method, params) {
  const urls = archivalNodes;
  const errors = [];
  for (const [i, url] of urls.entries()) {
    try {
      const result = await rpc(url, method, params);
      answered(url);
      answeredBy.add(url);
      return result;
    } catch (err) {
      if (!(err instanceof NoAnswer)) {
        answered(url);
        if (i === 0) throw err;
        throw new Error(`${[...errors, err.message].join("; ")}. ${urls.slice(0, i).join(" and ")} did not answer, and ${url} answered with that error: run it again, or set NEAR_ARCHIVAL_RPC to an archival node you trust`);
      }
      errors.push(err.message);
    }
  }
  const nodes = urls.length === 1 ? "That is a NEAR node" : `Those are ${urls.length} NEAR nodes`;
  throw new Error(`${errors.join("; ")}. ${nodes} not answering, not a change to any satchel: wait a minute and run it again, or set NEAR_ARCHIVAL_RPC to another archival node`);
}

/** Whether a Base read came from BASE_FALLBACK, which the last line then says. */
let fellBack = false;
/**
 * A Base mainnet read from BASE_RPC or, with it unset, from the default node and then Base's own.
 * `node` names the kind of node the read needs, for the error when none answers.
 */
async function fromBase(method, params, node = "a Base mainnet node") {
  const errors = [];
  for (const url of process.env.BASE_RPC ? [BASE_RPC] : [BASE_RPC, BASE_FALLBACK]) {
    try {
      const result = await rpc(url, method, params);
      if (url !== BASE_RPC) fellBack = true;
      return result;
    } catch (err) {
      errors.push(err.message);
    }
  }
  throw new Error(`${errors.join("; ")}. That is a Base node failing, not a change to any satchel: set BASE_RPC to ${node} and run it again`);
}

const query = (params) => rpc(RPC, "query", { finality: "final", account_id: CONTRACT, ...params });

/** Calls a view method of another account now. */
async function viewOn(account, method, args) {
  const { result } = await rpc(RPC, "query", {
    finality: "final",
    account_id: account,
    request_type: "call_function",
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  });
  return JSON.parse(Buffer.from(result).toString());
}

/** Calls a view method now, or at `blockId` on the archival node. */
async function view(method, args = {}, blockId) {
  const params = {
    request_type: "call_function",
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  };
  const { result } =
    blockId === undefined
      ? await query(params)
      : await archival("query", { block_id: blockId, account_id: CONTRACT, ...params });
  return JSON.parse(Buffer.from(result).toString());
}

const tx = (hash, sender) =>
  archival("EXPERIMENTAL_tx_status", { tx_hash: hash, sender_account_id: sender, wait_until: "FINAL" });

/** The height of the block that included a transaction. */
const height = async (t) => (await archival("block", { block_id: t.transaction_outcome.block_hash })).header.height;
const actionNames = (t) => t.transaction.actions.map((a) => (typeof a === "string" ? a : Object.keys(a)[0]));
const panic = (t) => t.status.Failure?.ActionError?.kind?.FunctionCallError?.ExecutionError ?? null;
/** The transaction's one function call, with its args decoded, or an error if it is anything else. */
function callOf(t) {
  const call = t.transaction.actions.length === 1 ? t.transaction.actions[0].FunctionCall : undefined;
  if (!call || t.transaction.receiver_id !== CONTRACT) throw new Error(`not one call to ${CONTRACT}`);
  return { method: call.method_name, args: JSON.parse(Buffer.from(call.args, "base64").toString()) };
}

/** Throws unless the call is `method` and every field in `expected` equals its argument of that name. */
function expectArgs(call, method, expected) {
  if (call.method !== method) throw new Error(`calls ${call.method}, not ${method}`);
  for (const [key, value] of Object.entries(expected)) {
    if (call.args[key] !== value) throw new Error(`${method} with ${key} = ${JSON.stringify(call.args[key])}`);
  }
}

/** The NEP-297 events a receipt logged, parsed. */
const events = (outcome) =>
  outcome.outcome.logs.filter((l) => l.startsWith("EVENT_JSON:")).map((l) => JSON.parse(l.slice("EVENT_JSON:".length)));

const refunds = (t, to) =>
  t.receipts
    .filter((r) => r.predecessor_id === "system" && r.receiver_id === to)
    .flatMap((r) => r.receipt.Action?.actions ?? [])
    .map((a) => a.Transfer?.deposit);

/** Each claim: the README's words, and a check that returns what it saw or throws. */
const DEPLOYMENT = [
  {
    claim: `${CONTRACT} has no access keys, so no one can redeploy it or sign as it`,
    check: async () => {
      const { keys } = await query({ request_type: "view_access_key_list" });
      if (keys.length !== 0) throw new Error(`${keys.length} access key(s)`);
      return "0 access keys";
    },
  },
  {
    claim: "Its code is the reproducible build, not a global contract",
    check: async () => {
      const account = await query({ request_type: "view_account" });
      if (account.global_contract_hash || account.global_contract_account_id) throw new Error("runs a global contract");
      if (account.code_hash !== deployment.code_hash) throw new Error(`code hash ${account.code_hash}`);
      return `code hash ${account.code_hash}`;
    },
  },
  {
    claim: `Its NEP-330 metadata names commit ${deployment.source_commit.slice(0, 7)} and the pinned Docker image`,
    check: async () => {
      const meta = await view("contract_source_metadata");
      if (!meta.link?.endsWith(deployment.source_commit)) throw new Error(`link ${meta.link}`);
      if (meta.build_info?.build_environment !== deployment.build.image) throw new Error(`image ${meta.build_info?.build_environment}`);
      return meta.link;
    },
  },
  {
    claim: `It signs only through ${deployment.mpc_contract}`,
    check: async () => {
      const mpc = await view("mpc_contract");
      if (mpc !== deployment.mpc_contract) throw new Error(`mpc_contract() is ${mpc}`);
      return `mpc_contract() = ${mpc}`;
    },
  },
  {
    claim: `The package derives every satchel's address from ${deployment.mpc_contract}'s root key, and pins that key`,
    check: async () => {
      const config = readFileSync(new URL("../packages/satchel-nft/src/config.ts", import.meta.url), "utf8");
      const block = config.match(new RegExp(`export const ${NETWORK.toUpperCase()}: Network = \\{([\\s\\S]*?)\\n\\};`))?.[1] ?? "";
      const pinned = block.match(/^\s*mpcRootKey:\s*"([^"]+)"/m)?.[1];
      const root = await viewOn(deployment.mpc_contract, "public_key", { domain_id: 0 });
      if (pinned !== root) throw new Error(`config.ts pins ${pinned}, public_key({ domain_id: 0 }) is ${root}`);
      return `public_key({ domain_id: 0 }) = ${root.slice(0, 22)}…, as config.ts pins it`;
    },
  },
  {
    claim: `The keys the package's tests derive are the ones ${deployment.mpc_contract} gives for each satchel`,
    check: async () => {
      const fixture = new URL("../packages/satchel-nft/src/__fixtures__/derived-keys.json", import.meta.url);
      const { contract, keys } = JSON.parse(readFileSync(fixture, "utf8"))[NETWORK];
      if (contract !== CONTRACT) throw new Error(`the fixture is for ${contract}`);
      if (Object.keys(keys).length === 0) throw new Error("the fixture holds no keys");
      for (const [path, key] of Object.entries(keys)) {
        const chain = await viewOn(deployment.mpc_contract, "derived_public_key", { path, predecessor: CONTRACT, domain_id: 0 });
        if (chain !== key) throw new Error(`${path}: derived_public_key is ${chain}, the fixture has ${key}`);
      }
      return `derived_public_key matches for ${Object.keys(keys).join(", ")}`;
    },
  },
  {
    claim: "It was deployed and initialized in one transaction",
    check: async () => {
      const t = await tx(deployment.deploy_and_init_tx, CONTRACT);
      const names = actionNames(t).join(", ");
      if (names !== "DeployContract, FunctionCall" || !("SuccessValue" in t.status)) throw new Error(`actions ${names}`);
      const init = t.transaction.actions[1].FunctionCall;
      const args = JSON.parse(Buffer.from(init.args, "base64").toString());
      if (init.method_name !== "new" || args.mpc_contract !== deployment.mpc_contract) throw new Error(`init ${init.method_name}`);
      return `${names}, new({ mpc_contract: "${args.mpc_contract}" })`;
    },
  },
];

/** On mainnet: no satchel existed once the key was gone, read from the supply at the block that deleted it. */
const MAINNET_LOCK = {
  claim: "Its only key was deleted before any satchel was minted",
  check: async () => {
    const lock = await tx(deployment.lock_tx, CONTRACT);
    if (actionNames(lock).join() !== "DeleteKey" || !("SuccessValue" in lock.status)) throw new Error("not a successful DeleteKey");
    // The block that ran the DeleteKey; the supply only grows, so 0 there means no mint came first.
    const ran = lock.receipts_outcome[0].block_hash;
    const supply = await view("nft_total_supply", {}, ran);
    if (supply !== "0") throw new Error(`${supply} satchel(s) minted by the block that deleted the key`);
    return `DeleteKey at block ${await height(lock)}, nft_total_supply() = 0 there`;
  },
};

const TESTNET = [
  {
    claim: "Its only key was deleted before the first mint",
    check: async () => {
      const [lock, mint] = await Promise.all([tx(deployment.lock_tx, CONTRACT), tx(FIRST_MINT_TX, OWNER)]);
      if (actionNames(lock).join() !== "DeleteKey" || !("SuccessValue" in lock.status)) throw new Error("not a successful DeleteKey");
      expectArgs(callOf(mint), "mint", {});
      const token = JSON.parse(Buffer.from(mint.status.SuccessValue ?? "", "base64").toString() || "null");
      if (token?.token_id !== "1") throw new Error(`the mint returned token ${token?.token_id}, not the first one`);
      const [locked, minted] = await Promise.all([height(lock), height(mint)]);
      if (locked >= minted) throw new Error(`deleted at block ${locked}, first mint at ${minted}`);
      return `DeleteKey at block ${locked}, first mint at block ${minted}`;
    },
  },
  ...[
    {
      claim: "The previous owner of satchel #1 cannot sign after the transfer",
      hash: "GqFsnmFLcpDjJVC1b4qUPYxHRTP1Rw2vcVKxga3PVRvU",
      sender: OWNER,
      method: "sign_evm",
      args: { token_id: "1" },
      message: "Satchel: only the token's owner can do this",
      /** The sender owned #1 until this transfer, in an earlier block. */
      after: async (refused) => {
        const transfer = await tx(TRANSFER_TX, OWNER);
        expectArgs(callOf(transfer), "nft_transfer", { token_id: "1", receiver_id: BUYER });
        if (!("SuccessValue" in transfer.status)) throw new Error("the transfer failed");
        const [moved, signed] = await Promise.all([height(transfer), height(refused)]);
        if (moved >= signed) throw new Error(`transfer at block ${moved}, refused call at ${signed}`);
        return `, after ${TRANSFER_TX.slice(0, 8)}… moved #1 to ${BUYER}`;
      },
    },
    {
      claim: "No one else can call new() to re-initialize it",
      hash: "BeoXbii9WeodnG2XZarxZidtvqS6RzzA9KNqJnZRLrWv",
      sender: OWNER,
      method: "new",
      args: {},
      message: "Method new is private",
    },
    {
      claim: "Signing is frozen while a satchel is listed (satchel #4)",
      hash: "5ZaKqJUxEUauvpENMMp4KQoCwWRNqmAyHskpTF6Axft8",
      sender: OWNER,
      method: "sign_evm",
      args: { token_id: "4" },
      message: "Satchel: signing is frozen while the token is listed",
    },
    {
      claim: "A buy naming an old record version is refused, and the buyer keeps the NEAR (satchel #6)",
      hash: STALE_BUY_TX,
      sender: BUYER,
      method: "buy",
      args: { token_id: "6", record_version: "0" },
      message: "Satchel: the signing record changed since you checked it",
      refund: ONE_NEAR,
    },
  ].map(({ claim, hash, sender, method, args, message, refund, after }) => ({
    claim,
    check: async () => {
      const t = await tx(hash, sender);
      if (t.transaction.signer_id !== sender) throw new Error(`signed by ${t.transaction.signer_id}`);
      expectArgs(callOf(t), method, args);
      const seen = panic(t);
      if (!seen?.endsWith(message)) throw new Error(`status ${JSON.stringify(t.status)}`);
      if (refund && !refunds(t, sender).includes(refund)) throw new Error("no refund of the attached deposit");
      const extra = after ? await after(t) : "";
      return `${hash.slice(0, 8)}… ${method} by ${sender}: "${message}"${refund ? ", 1 NEAR refunded" : ""}${extra}`;
    },
  })),
  {
    claim: "When that buy was refused, satchel #6 had one raw signature on record and was listed at the version after it",
    check: async () => {
      const at = (await tx(STALE_BUY_TX, BUYER)).transaction_outcome.block_hash;
      const record = await view("signing_record", { token_id: "6" }, at);
      if (record.opaque_signatures !== 1 || record.version !== "1") throw new Error(`record ${JSON.stringify(record)}`);
      const listing = await view("listing", { token_id: "6" }, at);
      if (listing?.record_version !== "1") throw new Error(`listing ${JSON.stringify(listing)}`);
      return `opaque_signatures 1, record version 1, listed at record version 1 (block ${at.slice(0, 8)}…)`;
    },
  },
];

/** The first mainnet satchel: its mint, its one signature, and that signature run on Base. */
const MAINNET_FIRST = [
  {
    claim: "Satchel #1, the first on mainnet, was minted by satchel-nft.near after the lock",
    check: async () => {
      if (FIRST.contract !== CONTRACT || FIRST.mpc !== deployment.mpc_contract) throw new Error("mainnet-first-send.json names another deployment");
      const [lock, mint] = await Promise.all([tx(deployment.lock_tx, CONTRACT), tx(FIRST.mintTx, FIRST.signer)]);
      if (mint.transaction.signer_id !== FIRST.signer) throw new Error(`signed by ${mint.transaction.signer_id}`);
      expectArgs(callOf(mint), "mint", {});
      const token = JSON.parse(Buffer.from(mint.status.SuccessValue ?? "", "base64").toString() || "null");
      if (token?.token_id !== FIRST.tokenId || token.owner_id !== FIRST.signer) {
        throw new Error(`the mint returned token ${token?.token_id} to ${token?.owner_id}`);
      }
      const [locked, minted] = await Promise.all([height(lock), height(mint)]);
      if (locked >= minted) throw new Error(`deleted at block ${locked}, minted at ${minted}`);
      return `${FIRST.mintTx.slice(0, 8)}… minted #1 to ${FIRST.signer} at block ${minted}, after the DeleteKey at ${locked}`;
    },
  },
  {
    claim: "Its first signature is a Base transaction at nonce 0, recorded by the contract before v1.signer signed it",
    check: async () => (await signedFirst(FIRST)).seen,
  },
  {
    claim: "Base ran exactly that signed transaction, in a block that is now finalized",
    check: () => ranOnBase(FIRST),
  },
];

/**
 * A satchel's first `sign_evm`: the call, the record entry the contract logged at version 1, and the
 * hash it asked the MPC contract to sign for the satchel's path. `s` names the satchel and the send.
 */
async function signedFirst(s) {
  const t = await tx(s.nearTx, s.signer);
  if (t.transaction.signer_id !== s.signer) throw new Error(`signed by ${t.transaction.signer_id}`);
  const call = callOf(t);
  expectArgs(call, "sign_evm", { token_id: s.tokenId });
  if (call.args.tx.chain_id !== s.chainId || call.args.tx.nonce !== s.nonce) {
    throw new Error(`signs chain ${call.args.tx.chain_id} at nonce ${call.args.tx.nonce}`);
  }
  // The contract's receipt writes the record and logs it, then calls the MPC contract, whose
  // receipt comes after it; the MPC contract's answer is the transaction's result.
  const ours = t.receipts_outcome.find((o) => o.outcome.executor_id === CONTRACT);
  const entry = ours && events(ours).find((e) => e.standard === "satchel" && e.event === "sign_evm")?.data?.[0];
  if (entry?.token_id !== s.tokenId || entry.chain_id !== s.chainId || entry.nonce !== s.nonce) {
    throw new Error(`the contract logged ${JSON.stringify(entry)}`);
  }
  // Version 1: the record was empty before this signature, so it is the token's first.
  if (entry.record_version !== "1") throw new Error(`record version ${entry.record_version} after it`);
  // What the contract asked the MPC contract to sign: the satchel's key, over the hash the contract
  // computes for exactly these fields.
  const request = t.receipts
    .filter((r) => r.predecessor_id === CONTRACT && r.receiver_id === deployment.mpc_contract)
    .flatMap((r) => r.receipt.Action?.actions ?? [])
    .map((a) => a.FunctionCall)
    .find((c) => c?.method_name === "sign");
  const asked = request && JSON.parse(Buffer.from(request.args, "base64").toString()).request;
  const hash = await view("evm_signing_hash", { tx: call.args.tx });
  if (asked?.path !== s.path || asked.payload_v2?.Ecdsa !== hash || entry.payload !== hash) {
    throw new Error(`asked ${deployment.mpc_contract} for ${JSON.stringify(asked)}, the hash of the call is ${hash}`);
  }
  const sig = JSON.parse(Buffer.from(t.status.SuccessValue ?? "", "base64").toString() || "null");
  if (!sig?.big_r?.affine_point) throw new Error(`result ${JSON.stringify(t.status)}`);
  const seen = `${s.nearTx.slice(0, 8)}… sign_evm: chain ${entry.chain_id}, nonce ${entry.nonce}, ${entry.class}, record version 1; ${deployment.mpc_contract} signed ${hash.slice(0, 8)}… for ${asked.path}`;
  return { signed: call.args.tx, entry, seen };
}

/** Base ran the transaction `s.nearTx` signed, field for field, with that signature, in a finalized block. */
async function ranOnBase(s) {
  const [t, sent, receipt, final] = await Promise.all([
    tx(s.nearTx, s.signer),
    fromBase("eth_getTransactionByHash", [s.baseTx]),
    fromBase("eth_getTransactionReceipt", [s.baseTx]),
    fromBase("eth_getBlockByNumber", ["finalized", false]),
  ]);
  if (!sent || !receipt) throw new Error(`${BASE_RPC} has no transaction ${s.baseTx}`);
  const call = callOf(t);
  expectArgs(call, "sign_evm", { token_id: s.tokenId });
  const signed = call.args.tx;
  const fields = {
    chainId: [sent.chainId, signed.chain_id],
    nonce: [sent.nonce, signed.nonce],
    maxPriorityFeePerGas: [sent.maxPriorityFeePerGas, signed.max_priority_fee_per_gas],
    maxFeePerGas: [sent.maxFeePerGas, signed.max_fee_per_gas],
    gas: [sent.gas, signed.gas_limit],
    value: [sent.value, signed.value],
  };
  for (const [name, [onBase, inCall]] of Object.entries(fields)) {
    if (BigInt(onBase) !== BigInt(inCall)) throw new Error(`${name} is ${BigInt(onBase)} on Base, ${inCall} in sign_evm`);
  }
  const data = (signed.data ?? "0x").toLowerCase();
  if (sent.type !== "0x2" || sent.to?.toLowerCase() !== signed.to.toLowerCase() || sent.input !== data || sent.accessList?.length) {
    throw new Error("the transaction on Base is not the one sign_evm built");
  }
  // The signature Base checked is the one the MPC contract returned: r is big_r's x coordinate.
  const sig = JSON.parse(Buffer.from(t.status.SuccessValue ?? "", "base64").toString() || "null");
  if (!sig?.big_r?.affine_point) throw new Error(`result ${JSON.stringify(t.status)}`);
  const r = BigInt(`0x${sig.big_r.affine_point.slice(2)}`);
  if (BigInt(sent.r) !== r || BigInt(sent.s) !== BigInt(`0x${sig.s.scalar}`) || Number(sent.yParity ?? sent.v) !== sig.recovery_id) {
    throw new Error(`the signature on Base is not the one ${deployment.mpc_contract} returned`);
  }
  if (sent.from.toLowerCase() !== s.address) throw new Error(`sent from ${sent.from}`);
  // The block, value and fee the README cites; the fee includes the L1 data fee Base charges.
  const fee = BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice) + BigInt(receipt.l1Fee ?? 0);
  if (receipt.status !== "0x1" || BigInt(receipt.blockNumber) !== BigInt(s.block)) {
    throw new Error(`status ${receipt.status} in block ${BigInt(receipt.blockNumber)}`);
  }
  if (BigInt(sent.value) !== BigInt(s.valueWei) || fee !== BigInt(s.feeWei)) throw new Error(`value ${BigInt(sent.value)}, fee ${fee}`);
  if (BigInt(final.number) < BigInt(receipt.blockNumber)) {
    throw new Error(`Base has finalized up to block ${BigInt(final.number)}, not ${BigInt(receipt.blockNumber)} yet: check again in a few minutes`);
  }
  return `${s.baseTx.slice(0, 10)}… from ${s.address}, block ${BigInt(receipt.blockNumber)}, status 1, fee ${fee} wei, finalized`;
}

/** Satchel #2's send, in the shape `signedFirst` and `ranOnBase` read. */
const exitSend = () => {
  if (EXIT.contract !== CONTRACT || EXIT.network !== NETWORK) throw new Error("mainnet-1click-exit.json names another deployment");
  return {
    tokenId: EXIT.tokenId,
    path: EXIT.path,
    signer: EXIT.owner,
    address: EXIT.address.toLowerCase(),
    nearTx: EXIT.deposit.nearTx,
    chainId: EXIT.deposit.chainId,
    nonce: EXIT.deposit.nonce,
    baseTx: EXIT.deposit.tx,
    block: EXIT.deposit.block,
    valueWei: EXIT.quote.quote.amountIn,
    feeWei: EXIT.deposit.feeWei,
  };
};
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
/** Circle's USDC on Arbitrum One. */
const ARBITRUM_USDC = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const usdc = (units) => (Number(units) / 1e6).toFixed(6);
const hex = (n) => `0x${BigInt(n).toString(16)}`;
/** 1Click's public status for one deposit address: no key, read at each run. */
const ONE_CLICK = "https://1click.chaindefuser.com";
async function oneClickStatus(depositAddress) {
  const url = `${ONE_CLICK}/v0/status?depositAddress=${depositAddress}`;
  return twice(async () => {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) }).catch((err) => {
      throw new Error(`${err.message} from ${url}`);
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return res.json();
  }).catch((err) => {
    throw new Error(`1Click was unreachable (${err.message}). That is not a change to any satchel: run the check again later`);
  });
}
/** ETH on Base in, Circle's USDC on Arbitrum One out, as 1Click names them. */
const EXIT_ROUTE = { swapType: "EXACT_INPUT", originAsset: "nep141:base.omft.near", destinationAsset: `nep141:arb-${ARBITRUM_USDC}.omft.near` };

/** Satchel #2: minted before its address held any ETH on Base, then one transfer into 1Click and USDC back. */
const MAINNET_EXIT = [
  {
    claim: "Satchel #2 was minted by satchel-nft.near before its Base address held any ETH",
    check: async () => {
      const s = exitSend();
      const mint = await tx(EXIT.mint.tx, s.signer);
      if (mint.transaction.signer_id !== s.signer) throw new Error(`signed by ${mint.transaction.signer_id}`);
      expectArgs(callOf(mint), "mint", {});
      const token = JSON.parse(Buffer.from(mint.status.SuccessValue ?? "", "base64").toString() || "null");
      if (token?.token_id !== s.tokenId || token.owner_id !== s.signer) throw new Error(`the mint returned token ${token?.token_id} to ${token?.owner_id}`);
      // The token exists from the receipt the contract ran, which can be a block after the transaction's.
      const ran = mint.receipts_outcome.find((o) => o.outcome.executor_id === CONTRACT);
      if (!ran) throw new Error(`no receipt of ${CONTRACT} in ${EXIT.mint.tx}`);
      const before = BigInt(EXIT.funded.block) - 1n;
      // Balances and nonces at past blocks: both default nodes serve them, a pruned one doesn't.
      const past = (method, block) => fromBase(method, [s.address, hex(block)], `an archive node of Base mainnet (this reads its state at block ${block})`);
      const [block, funding, receipt, fundBlock, held, sent, heldAfter] = await Promise.all([
        archival("block", { block_id: ran.block_hash }),
        fromBase("eth_getTransactionByHash", [EXIT.funded.tx]),
        fromBase("eth_getTransactionReceipt", [EXIT.funded.tx]),
        fromBase("eth_getBlockByNumber", [hex(EXIT.funded.block), false]),
        past("eth_getBalance", before),
        past("eth_getTransactionCount", before),
        past("eth_getBalance", EXIT.funded.block),
      ]);
      if (funding?.to?.toLowerCase() !== s.address || BigInt(funding.value) !== BigInt(EXIT.funded.wei) || receipt?.status !== "0x1" || BigInt(receipt.blockNumber) !== BigInt(EXIT.funded.block)) {
        throw new Error(`${EXIT.funded.tx} is not a successful ${EXIT.funded.wei} wei to ${s.address} in block ${EXIT.funded.block}`);
      }
      // Empty and never sent from before that block, holding exactly the funding after it: an address
      // whose nonce is 0 has sent nothing, so a balance of 0 means nothing ever came in.
      if (BigInt(held) !== 0n || BigInt(sent) !== 0n || BigInt(heldAfter) !== BigInt(EXIT.funded.wei)) {
        throw new Error(`${s.address} held ${BigInt(held)} wei at nonce ${BigInt(sent)} at block ${before}, and ${BigInt(heldAfter)} at ${EXIT.funded.block}`);
      }
      // NEAR block timestamps are in nanoseconds, Base's in seconds.
      const minted = Number(BigInt(block.header.timestamp) / 1_000_000n);
      const funded = Number(BigInt(fundBlock.timestamp)) * 1000;
      if (minted >= funded) throw new Error(`minted at ${new Date(minted).toISOString()}, funded at ${new Date(funded).toISOString()}`);
      return `${EXIT.mint.tx.slice(0, 8)}… minted #2 at ${new Date(minted).toISOString()}; 0 wei and nonce 0 at Base block ${before}, then ${EXIT.funded.tx.slice(0, 10)}… brought ${Number(EXIT.funded.wei) / 1e18} ETH at ${new Date(funded).toISOString()}`;
    },
  },
  {
    claim: "Its first signature is a plain transfer on Base at nonce 0, of the amount 1Click quoted, to the deposit address it quoted",
    check: async () => {
      const s = exitSend();
      const q = EXIT.quote.quote;
      const { signed, entry, seen } = await signedFirst(s);
      if (signed.to.toLowerCase() !== q.depositAddress.toLowerCase() || BigInt(signed.value) !== BigInt(q.amountIn) || (signed.data ?? "0x") !== "0x") {
        throw new Error(`signs ${signed.value} wei to ${signed.to} with data ${signed.data}, not ${q.amountIn} to ${q.depositAddress}`);
      }
      if (entry.class !== "value_transfer") throw new Error(`the contract classed it ${entry.class}`);
      return `${seen}, ${signed.value} wei to ${q.depositAddress}`;
    },
  },
  {
    claim: "Base ran exactly that deposit, in a block that is now finalized",
    check: () => ranOnBase(exitSend()),
  },
  {
    // Which Arbitrum One transaction pays out which deposit is 1Click's word, read from its status;
    // the chain shows only that the payout reached this address.
    claim: "1Click reports SUCCESS for this deposit, and the payout it names sent the same address more USDC on Arbitrum One than the quote's minimum",
    check: async () => {
      const s = exitSend();
      const got = EXIT.arrival;
      const q = EXIT.quote.quote;
      if (got.token.toLowerCase() !== ARBITRUM_USDC || got.txs.length === 0) throw new Error(`the record names ${got.token} in ${got.txs.length} transaction(s)`);
      const [status, receipts, deposit] = await Promise.all([
        oneClickStatus(q.depositAddress),
        Promise.all(got.txs.map((t) => rpc(ARBITRUM_RPC, "eth_getTransactionReceipt", [t.hash]))),
        fromBase("eth_getBlockByNumber", [hex(s.block), false]),
      ]);
      const answered = status.quoteResponse ?? {};
      const hashes = (list) => (list ?? []).map((h) => h.hash.toLowerCase()).sort().join(",");
      if (status.status !== "SUCCESS") throw new Error(`1Click reads ${status.status} for ${q.depositAddress}`);
      // The record's quote and 1Click's answer are both the route this claim names, and the same quote.
      const route = (r) => Object.entries(EXIT_ROUTE).every(([k, v]) => r?.[k] === v);
      if (
        !route(EXIT.quote.quoteRequest) ||
        !route(answered.quoteRequest) ||
        answered.quote?.depositAddress?.toLowerCase() !== q.depositAddress.toLowerCase() ||
        answered.quote.amountIn !== q.amountIn ||
        answered.quote.minAmountOut !== q.minAmountOut ||
        answered.quoteRequest.recipient?.toLowerCase() !== s.address ||
        answered.quoteRequest.refundTo?.toLowerCase() !== s.address
      ) {
        const { depositAddress, amountIn, minAmountOut } = answered.quote ?? {};
        const { swapType, originAsset, destinationAsset, recipient, refundTo } = answered.quoteRequest ?? {};
        throw new Error(
          `1Click's quote for ${q.depositAddress} is not the record's, or not ETH on Base to USDC on Arbitrum One: ` +
            JSON.stringify({ swapType, originAsset, destinationAsset, depositAddress, amountIn, minAmountOut, recipient, refundTo }),
        );
      }
      const origin = hashes(status.swapDetails?.originChainTxHashes);
      const payout = hashes(status.swapDetails?.destinationChainTxHashes);
      if (origin !== EXIT.deposit.tx.toLowerCase() || payout !== hashes(got.txs)) {
        throw new Error(`1Click names deposit ${origin} and payout ${payout}, the record ${EXIT.deposit.tx} and ${hashes(got.txs)}`);
      }
      const to = `0x${s.address.slice(2).padStart(64, "0")}`;
      let paid = 0n;
      for (const [i, receipt] of receipts.entries()) {
        if (receipt?.status !== "0x1") throw new Error(`${ARBITRUM_RPC}: ${got.txs[i].hash} ${receipt ? `status ${receipt.status}` : "not found"}`);
        paid += receipt.logs
          .filter((l) => l.address.toLowerCase() === ARBITRUM_USDC && l.topics[0] === TRANSFER_TOPIC && l.topics[2]?.toLowerCase() === to)
          .reduce((sum, l) => sum + BigInt(l.data), 0n);
      }
      if (paid !== BigInt(got.received) || paid <= BigInt(q.minAmountOut)) {
        throw new Error(`${usdc(paid)} USDC to ${s.address}, expected ${usdc(got.received)}, more than ${usdc(q.minAmountOut)}`);
      }
      const blocks = await Promise.all(receipts.map((r) => rpc(ARBITRUM_RPC, "eth_getBlockByNumber", [r.blockNumber, false])));
      const after = Math.min(...blocks.map((b) => Number(BigInt(b.timestamp)))) - Number(BigInt(deposit.timestamp));
      if (after < 0) throw new Error("the USDC came before the deposit");
      return `1Click: SUCCESS, deposit ${EXIT.deposit.tx.slice(0, 10)}…, payout ${got.txs.map((t) => `${t.hash.slice(0, 10)}…`).join(", ")}; ${usdc(paid)} USDC (${ARBITRUM_USDC.slice(0, 10)}…) to ${s.address}, ${after} s after the deposit; minimum ${usdc(q.minAmountOut)}`;
    },
  },
];

const BASE_CHAIN = "8453";
const DEAD = "0x000000000000000000000000000000000000dead";
const OWNER_CHECK = "Satchel: only the token's owner can do this";
const MINT_DEPOSIT = "100000000000000000000000";
const nearAmount = (yocto) => `${Number(BigInt(yocto) / 10n ** 18n) / 1e6} NEAR`;
const succeeded = (status) => "SuccessValue" in status || "SuccessReceiptId" in status;

/**
 * A transaction `sender` signed: its one call to the contract, checked against `method` and
 * `expected`, the attached deposit, the receipt the contract ran it in, and that receipt's block and time.
 */
async function ranCall(hash, sender, method, expected) {
  const t = await tx(hash, sender);
  if (t.transaction.signer_id !== sender) throw new Error(`${hash.slice(0, 8)}… signed by ${t.transaction.signer_id}`);
  const call = callOf(t);
  expectArgs(call, method, expected);
  // The first receipt the contract ran is the call itself; a refund or a payment comes after it.
  const ran = t.receipts_outcome.find((o) => o.outcome.executor_id === CONTRACT);
  if (!ran) throw new Error(`no receipt of ${CONTRACT} in ${hash}`);
  const { header } = await archival("block", { block_id: ran.block_hash });
  return { t, args: call.args, deposit: t.transaction.actions[0].FunctionCall.deposit, ran, height: header.height, ns: BigInt(header.timestamp) };
}

/** The sale's one send before it, in the shape `signedFirst` and `ranOnBase` read. */
const saleSend = (s) => {
  if (s.send.chainId !== BASE_CHAIN) throw new Error(`mainnet-sale.json's send is on chain ${s.send.chainId}, which this script doesn't read`);
  return {
    tokenId: s.tokenId,
    path: s.path,
    signer: s.seller,
    address: s.address.toLowerCase(),
    nearTx: s.send.nearTx,
    chainId: s.send.chainId,
    nonce: s.send.nonce,
    baseTx: s.send.evmTx,
    block: s.send.block,
    valueWei: s.send.valueWei,
    feeWei: s.send.feeWei,
  };
};

/**
 * A satchel minted by the seller, optionally sent from once, listed, bought by a second account
 * naming the listing's record version, and then the seller's `sign_evm` refused. Every claim reads
 * the chain, at the blocks the transactions ran in where it reads state, so a later signature or
 * sale by the buyer doesn't change any of them.
 */
function saleClaims(s) {
  const id = s.tokenId;
  const v = s.recordVersion;
  return [
    {
      claim: `Satchel #${id} was minted by ${s.seller} after the lock, for 0.1 NEAR`,
      check: async () => {
        if (s.contract !== CONTRACT || s.network !== NETWORK || s.path !== `satchel/${id}`) throw new Error("mainnet-sale.json names another deployment");
        const [lock, mint] = await Promise.all([tx(deployment.lock_tx, CONTRACT), ranCall(s.mint.tx, s.seller, "mint", {})]);
        if (mint.deposit !== MINT_DEPOSIT || !succeeded(mint.t.status)) throw new Error(`attached ${mint.deposit}, status ${JSON.stringify(mint.t.status)}`);
        const token = JSON.parse(Buffer.from(mint.t.status.SuccessValue ?? "", "base64").toString() || "null");
        if (token?.token_id !== id || token.owner_id !== s.seller) throw new Error(`the mint returned token ${token?.token_id} to ${token?.owner_id}`);
        const locked = await height(lock);
        if (locked >= mint.height) throw new Error(`deleted at block ${locked}, minted at ${mint.height}`);
        return `${s.mint.tx.slice(0, 8)}… minted #${id} to ${s.seller} at block ${mint.height}, after the DeleteKey at ${locked}`;
      },
    },
    ...(s.send
      ? [
          {
            claim: `Before the sale, its one signature was a plain send on Base at nonce ${s.send.nonce}, recorded by the contract before ${deployment.mpc_contract} signed it`,
            check: async () => {
              const { entry, seen } = await signedFirst(saleSend(s));
              if (entry.class !== "value_transfer") throw new Error(`the contract classed it ${entry.class}`);
              return seen;
            },
          },
          {
            claim: "Base ran exactly that send, in a block that is now finalized",
            check: () => ranOnBase(saleSend(s)),
          },
        ]
      : []),
    {
      claim: `${s.seller} listed it for ${nearAmount(s.price)} at record version ${v}`,
      check: async () => {
        const list = await ranCall(s.list.tx, s.seller, "list", { token_id: id, price: s.price });
        if (list.deposit !== "1" || !succeeded(list.t.status)) throw new Error(`attached ${list.deposit}, status ${JSON.stringify(list.t.status)}`);
        const listed = events(list.ran).find((e) => e.standard === "satchel" && e.event === "list")?.data?.[0];
        if (listed?.token_id !== id || listed.price !== s.price || listed.record_version !== v) throw new Error(`the contract logged ${JSON.stringify(listed)}`);
        // Version 0: nothing was ever signed; version 1: the one send above, and nothing after it.
        if (v !== (s.send ? "1" : "0")) throw new Error(`record version ${v} with ${s.send ? "one send" : "no send"} on record`);
        return `${s.list.tx.slice(0, 8)}… list: ${listed.price} yoctoNEAR, record version ${v}, block ${list.height}`;
      },
    },
    {
      claim: `${s.buyer} bought it naming record version ${v}, it moved to them in that receipt, and ${s.seller} was paid ${nearAmount(s.price)}`,
      check: async () => {
        const [list, buy] = await Promise.all([
          ranCall(s.list.tx, s.seller, "list", { token_id: id }),
          ranCall(s.buy.tx, s.buyer, "buy", { token_id: id, record_version: v, price: s.price }),
        ]);
        if (buy.deposit !== s.price || !succeeded(buy.t.status)) throw new Error(`attached ${buy.deposit}, status ${JSON.stringify(buy.t.status)}`);
        if (buy.height <= list.height) throw new Error(`bought at block ${buy.height}, listed at ${list.height}`);
        const logged = events(buy.ran);
        const moved = logged.find((e) => e.standard === "nep171" && e.event === "nft_transfer")?.data?.[0];
        const sale = logged.find((e) => e.standard === "satchel" && e.event === "sale")?.data?.[0];
        if (moved?.old_owner_id !== s.seller || moved.new_owner_id !== s.buyer || !moved.token_ids?.includes(id)) throw new Error(`transfer ${JSON.stringify(moved)}`);
        if (sale?.seller !== s.seller || sale.buyer !== s.buyer || sale.price !== s.price || sale.record_version !== v) throw new Error(`sale ${JSON.stringify(sale)}`);
        // The seller's payment is a transfer receipt the contract's receipt created; it must have run.
        const paid = buy.t.receipts.find(
          (r) => r.predecessor_id === CONTRACT && r.receiver_id === s.seller && r.receipt.Action?.actions?.[0]?.Transfer?.deposit === s.price,
        );
        const ran = paid && buy.t.receipts_outcome.find((o) => o.id === paid.receipt_id);
        if (!ran || !succeeded(ran.outcome.status)) throw new Error(`no transfer of ${s.price} yoctoNEAR to ${s.seller} ran`);
        return `${s.buy.tx.slice(0, 8)}… buy at block ${buy.height}: nft_transfer ${s.seller} → ${s.buyer}, sale at record version ${v}; receipt ${paid.receipt_id.slice(0, 8)}… paid ${s.seller} ${nearAmount(s.price)}`;
      },
    },
    {
      claim: `After the sale, ${s.seller}'s sign_evm for #${id} was refused by the owner check, and changed nothing`,
      check: async () => {
        const [buy, refused] = await Promise.all([
          ranCall(s.buy.tx, s.buyer, "buy", { token_id: id }),
          ranCall(s.refused.tx, s.seller, "sign_evm", { token_id: id }),
        ]);
        const seen = panic(refused.t);
        if (refused.deposit !== "1" || !seen?.endsWith(OWNER_CHECK)) throw new Error(`attached ${refused.deposit}, status ${JSON.stringify(refused.t.status)}`);
        // What it asked to sign moves nothing, even if it had been signed: 0 to 0x…dEaD, no data.
        const asked = refused.args.tx;
        if (asked?.to?.toLowerCase() !== DEAD || BigInt(asked.value) !== 0n || (asked.data ?? "0x") !== "0x") throw new Error(`it asked for ${JSON.stringify(asked)}`);
        if (events(refused.ran).length > 0 || refused.t.receipts.some((r) => r.predecessor_id === CONTRACT && r.receiver_id === deployment.mpc_contract)) {
          throw new Error("the contract logged an event or called the MPC contract");
        }
        if (refused.height <= buy.height) throw new Error(`refused at block ${refused.height}, bought at ${buy.height}`);
        // Before its receipt ran (the block that included it) and after: the buyer's, unlisted, record version v.
        const [before, owner, listing, record] = await Promise.all([
          view("signing_record", { token_id: id }, refused.t.transaction_outcome.block_hash),
          view("nft_token", { token_id: id }, refused.ran.block_hash),
          view("listing", { token_id: id }, refused.ran.block_hash),
          view("signing_record", { token_id: id }, refused.ran.block_hash),
        ]);
        if (owner?.owner_id !== s.buyer || listing !== null || before.version !== v || record.version !== v) {
          throw new Error(`at its block: owner ${owner?.owner_id}, listing ${JSON.stringify(listing)}, record version ${before.version} then ${record.version}`);
        }
        const tgas = BigInt(refused.t.transaction.actions[0].FunctionCall.gas) / 10n ** 12n;
        return `${s.refused.tx.slice(0, 8)}… sign_evm (${tgas} Tgas, 1 yoctoNEAR) by ${s.seller}: "${OWNER_CHECK}", block ${refused.height}; ${s.buyer} owned #${id}, unlisted, record version ${v} before and after`;
      },
    },
    {
      // The report's four checks, from the chain: check 1 is the deployment claims above; checks 2 to 4
      // read the record as it was when the buyer got the satchel. The two saved reports are checked for
      // what they read and, against the chain, when they were saved; not for which program wrote them.
      claim: `Satchel #${id} reached ${s.buyer} provably clean: the buyer's report read so before the buy, every nonce it signed is spent in a finalized block, no approval, nothing unexplained`,
      check: async () => {
        const [list, buy] = await Promise.all([
          ranCall(s.list.tx, s.seller, "list", { token_id: id }),
          ranCall(s.buy.tx, s.buyer, "buy", { token_id: id }),
        ]);
        const record = await view("signing_record", { token_id: id }, buy.ran.block_hash);
        const unexplained = record.approvals.length + record.approvals_not_itemized + record.unclassified_calls + record.opaque_signatures;
        if (record.version !== v || unexplained !== 0) throw new Error(`record at the sale: ${JSON.stringify(record)}`);
        const spent = [];
        for (const c of record.evm) {
          if (c.chain_id !== BASE_CHAIN) throw new Error(`signed on chain ${c.chain_id}, which this script doesn't read`);
          const finalized = BigInt(await fromBase("eth_getTransactionCount", [s.address, "finalized"]));
          if (finalized <= BigInt(c.max_nonce)) throw new Error(`Base: signed up to nonce ${c.max_nonce}, finalized nonce is ${finalized}`);
          spent.push(`Base: signed up to nonce ${c.max_nonce}, finalized nonce is ${finalized}`);
        }
        // The buyer's report: on the listing the buy names, saved after the listing ran and before the
        // block that included the buy.
        const saved = s.reportBeforeBuy;
        const l = saved?.listing;
        if (saved?.result !== "PROVABLY CLEAN" || saved.owner !== s.seller || saved.recordVersion !== v || l?.seller !== s.seller || l.price !== s.price || l.record_version !== v) {
          throw new Error(`the report saved before the buy reads ${saved?.result} for ${saved?.owner}, listing ${JSON.stringify(l)}`);
        }
        const { header: sent } = await archival("block", { block_id: buy.t.transaction_outcome.block_hash });
        const checked = BigInt(Date.parse(saved.checkedAt)) * 1_000_000n;
        if (checked <= list.ns || checked >= BigInt(sent.timestamp)) throw new Error(`the report before the buy was saved at ${saved.checkedAt}, not between the listing and the buy`);
        if (s.verified?.result !== "PROVABLY CLEAN" || s.verified.owner !== s.buyer) throw new Error(`the saved report reads ${s.verified?.result} for ${s.verified?.owner}`);
        return `record version ${v} at the sale's block: ${spent.join(", ") || "nothing ever signed"}; 0 approvals, 0 unclassified calls, 0 raw signatures. The reports saved at ${saved.checkedAt}, before the buy, and at ${s.verified.checkedAt} read PROVABLY CLEAN`;
      },
    },
  ];
}

const CLAIMS = [
  ...DEPLOYMENT,
  ...(NETWORK === "testnet" ? TESTNET : [MAINNET_LOCK, ...MAINNET_FIRST, ...MAINNET_EXIT, ...(SALE ? saleClaims(SALE) : [])]),
];

let failed = 0;
for (const { claim, check } of CLAIMS) {
  try {
    console.log(`[PASS] ${claim}\n       ${await check()}`);
  } catch (err) {
    failed += 1;
    console.log(`[FAIL] ${claim}\n       ${err.message}`);
  }
}
console.log(`\n${CLAIMS.length - failed} of ${CLAIMS.length} claims hold (${RPC}, archival ${ARCHIVAL})`);
if ([...answeredBy].some((u) => u !== ARCHIVAL)) {
  console.log(`Archival reads came from ${[...answeredBy].join(" and ")}: a read one of them didn't answer went to the next, and later reads to the one that answered last first`);
}
if (fellBack) console.log(`Base reads that ${BASE_RPC} failed came from ${BASE_FALLBACK}`);
process.exitCode = failed ? 1 : 0;
