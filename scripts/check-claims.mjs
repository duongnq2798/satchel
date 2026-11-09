// Checks the README's on-chain claims about the testnet deployment against NEAR RPC: the contract's
// lock, code and signer, the transactions that deployed and locked it, and the calls it refused.
// Node 22 or later, no install, no wallet, no key. Usage: node scripts/check-claims.mjs
// NEAR_RPC and NEAR_ARCHIVAL_RPC replace the default nodes; old transactions need an archival one.
import { readFileSync } from "node:fs";

const deployment = JSON.parse(readFileSync(new URL("../deployments/testnet.json", import.meta.url), "utf8"));
const RPC = process.env.NEAR_RPC ?? "https://rpc.testnet.fastnear.com";
const ARCHIVAL = process.env.NEAR_ARCHIVAL_RPC ?? "https://archival-rpc.testnet.fastnear.com";
const CONTRACT = deployment.contract;
const OWNER = "satchel-nft.testnet";
const BUYER = "buyer.satchel-nft.testnet";
const ONE_NEAR = "1000000000000000000000000";
/** Satchel #1's mint, the contract's first (deployments/testnet-e2e.json). Token ids start at 1. */
const FIRST_MINT_TX = "3kBMVhva8pagScLwGJDNwF6Bfbzno9LxAVN5JKENvPxo";
/** Satchel #1 moving from its first owner to the buyer, before the refused `sign_evm`. */
const TRANSFER_TX = "3sLuGS9pEnvURpha3QQBtumExxKC2f3GMJSRaccvNBwB";
const STALE_BUY_TX = "7HQPu9qeJauNrJLaMNCUuMJVska3u3uYsoGyp7gsCfWv";

async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "satchel", method, params }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status} from ${url}`);
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error.cause ?? body.error)}`);
  return body.result;
}

const query = (params) => rpc(RPC, "query", { finality: "final", account_id: CONTRACT, ...params });

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
      : await rpc(ARCHIVAL, "query", { block_id: blockId, account_id: CONTRACT, ...params });
  return JSON.parse(Buffer.from(result).toString());
}

const tx = (hash, sender) =>
  rpc(ARCHIVAL, "EXPERIMENTAL_tx_status", { tx_hash: hash, sender_account_id: sender, wait_until: "FINAL" });

/** The height of the block that included a transaction. */
const height = async (t) => (await rpc(ARCHIVAL, "block", { block_id: t.transaction_outcome.block_hash })).header.height;
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

const refunds = (t, to) =>
  t.receipts
    .filter((r) => r.predecessor_id === "system" && r.receiver_id === to)
    .flatMap((r) => r.receipt.Action?.actions ?? [])
    .map((a) => a.Transfer?.deposit);

/** Each claim: the README's words, and a check that returns what it saw or throws. */
const CLAIMS = [
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
process.exitCode = failed ? 1 : 0;
