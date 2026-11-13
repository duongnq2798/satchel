// Checks the README's claims about the estate run against NEAR testnet: a demo contract,
// contracts/estate, deployed and locked on its own account, which owned a new satchel and handed it
// to a named heir after its owner stopped checking in. It reads the transactions in
// deployments/testnet-estate.json and the chain now: the locked account and its code, the rules
// new was given, the mint, each check-in and approval and the block time each ran at, the calls
// the estate refused and their panic messages, the transfer to the heir, and the satchel's owner
// and signing record. Node 22 or later, no install, no wallet, no key.
// Usage: node scripts/check-estate.mjs
// NEAR_RPC and NEAR_ARCHIVAL_RPC replace the default nodes, and a node that doesn't answer is asked
// again or passed over exactly as in scripts/check-dao.mjs. A claim whose steps the file doesn't
// hold yet reads [WAIT], not [FAIL]; before the run there is no file, and the script says so.
import { existsSync, readFileSync } from "node:fs";

const FILE = "deployments/testnet-estate.json";
const PATH = new URL(`../${FILE}`, import.meta.url);
const RUN = existsSync(PATH) ? JSON.parse(readFileSync(PATH, "utf8")) : null;
const RPC = process.env.NEAR_RPC ?? "https://rpc.testnet.fastnear.com";
const ARCHIVAL = process.env.NEAR_ARCHIVAL_RPC ?? "https://archival-rpc.testnet.fastnear.com";
/** Read only if NEAR_ARCHIVAL_RPC is unset and the default node doesn't answer, as in check-dao.mjs. */
const ARCHIVAL_FALLBACKS = ["https://archival-rpc.testnet.near.org"];
/** The testnet satchels the run never takes: #1 to #9 are the README's demo satchels, #10 the DAO bounty run's. */
const LAST_FROZEN = 10;
/** The image contracts/estate/Cargo.toml pins for its reproducible build. */
const REPRODUCIBLE_IMAGE = "sourcescan/cargo-near:0.22.0-rust-1.99.1@sha256:c9655eaf7436b90c87ea8b25739f91063032c5c30ba24cfeafe72c142943b5bb";
const NANOS_PER_MINUTE = 60_000_000_000n;
/** The panic messages contracts/estate words, and near-sdk's for a call to a private method. */
const REFUSED = {
  early: "Estate: the owner is not overdue yet",
  waiting: "Estate: the waiting period has not passed yet",
  privateCallback: "Method on_release is private",
  released: "Estate: the satchel was released to the heir",
};

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
 * Sends a read, and again while the node is busy: up to 4 sends, 1, 2 and 4 s apart, or longer if its
 * Retry-After asks, up to 8 s. Any other failure is tried once more, 2 s later.
 */
async function rpc(url, method, params) {
  for (let sent = 1; ; sent += 1) {
    try {
      return await rpcOnce(url, method, params);
    } catch (err) {
      const busy = err instanceof NoAnswer && err.busy;
      if (sent >= (busy ? 4 : 2)) throw err;
      const backoff = 1_000 * 2 ** (sent - 1);
      // A Retry-After can only make the wait longer: FastNEAR's archival node sends `retry-after: 0`
      // with its 429s, and asking again at once only meets another 429.
      await wait(busy ? Math.min(Math.max(backoff, (err.retryAfter ?? 0) * 1_000), 8_000) : 2_000);
    }
  }
}

/**
 * A NEAR read from `url`, which the variable `name` sets. A node that still doesn't answer fails the
 * claim with a line that says so.
 */
async function near(url, name, method, params) {
  try {
    return await rpc(url, method, params);
  } catch (err) {
    if (!(err instanceof NoAnswer)) throw err;
    throw new Error(`${err.message}. That is a NEAR node not answering, not a change to any satchel: wait a minute and run it again, or set ${name} to another node`);
  }
}

/** The archival nodes that answered reads, which the last lines name. */
const answeredBy = { archival: new Set() };

/**
 * The archival nodes in the order a read asks them: NEAR_ARCHIVAL_RPC alone or, with it unset,
 * FastNEAR's and then NEAR's own. Once a fallback answers a read, with a result or an error, later
 * reads ask it first and FastNEAR's last.
 */
let archivalNodes = process.env.NEAR_ARCHIVAL_RPC ? [ARCHIVAL] : [ARCHIVAL, ...ARCHIVAL_FALLBACKS];

function answered(url) {
  if (url !== ARCHIVAL && archivalNodes[0] !== url) {
    archivalNodes = [url, ...ARCHIVAL_FALLBACKS.filter((u) => u !== url), ARCHIVAL];
  }
}

/**
 * An archival read from the first of `archivalNodes` that answers. Only a node that doesn't answer is
 * passed over. An error the first node asked answers with fails the claim. One a later node answers
 * with fails it too, and names the nodes before it that didn't answer: no other node checked it.
 */
async function archival(method, params) {
  const urls = archivalNodes;
  const errors = [];
  for (const [i, url] of urls.entries()) {
    try {
      const result = await rpc(url, method, params);
      answered(url);
      answeredBy.archival.add(url);
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

/** A read through NEAR_RPC at a final block: an account, its keys, a view. */
const query = (params) => near(RPC, "NEAR_RPC", "query", { finality: "final", ...params });

/** Calls a view method of `account` now, or at `blockId` on an archival node. */
async function view(account, method, args = {}, blockId) {
  const params = {
    account_id: account,
    request_type: "call_function",
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  };
  const { result } = blockId === undefined ? await query(params) : await archival("query", { block_id: blockId, ...params });
  return JSON.parse(Buffer.from(result).toString());
}

/**
 * A transaction as an archival node has it now, read once per hash. With wait_until "FINAL",
 * nearcore holds a request for a transaction it doesn't know about 30 s and answers HTTP 408, so a
 * wrong hash would be blamed on the nodes; with "NONE" it answers UNKNOWN_TRANSACTION at once. One
 * that isn't final fails the claim.
 */
const read = new Map();
function tx(hash, sender) {
  if (!read.has(hash)) {
    read.set(
      hash,
      archival("EXPERIMENTAL_tx_status", { tx_hash: hash, sender_account_id: sender, wait_until: "NONE" }).then((t) => {
        if (t.final_execution_status !== "FINAL") throw new Error(`${hash.slice(0, 8)}… is ${t.final_execution_status}, not final`);
        return t;
      }),
    );
    // A read that failed is asked again by the next claim that needs it.
    read.get(hash).catch(() => read.delete(hash));
  }
  return read.get(hash);
}
const json = (base64) => JSON.parse(Buffer.from(base64, "base64").toString() || "null");
const ok = (status) => typeof status === "object" && status !== null && "SuccessValue" in status;

/** JSON with object keys sorted, so two encodings of the same value compare equal. */
const canonical = (value) =>
  JSON.stringify(value, (_, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v));

/** The transaction's one function call, to `receiver`, signed by `signer`: its method, arguments and deposit. */
function callOf(t, signer, receiver) {
  const call = t.transaction.actions.length === 1 ? t.transaction.actions[0].FunctionCall : undefined;
  if (!call || t.transaction.receiver_id !== receiver) throw new Error(`${t.transaction.hash.slice(0, 8)}… is not one call to ${receiver}`);
  if (t.transaction.signer_id !== signer) throw new Error(`${t.transaction.hash.slice(0, 8)}… is signed by ${t.transaction.signer_id}, not ${signer}`);
  return { method: call.method_name, args: json(call.args), deposit: call.deposit };
}

/** Like callOf, for a call that succeeded. */
function succeeded(t, signer, receiver, method) {
  const call = callOf(t, signer, receiver);
  if (call.method !== method) throw new Error(`${t.transaction.hash.slice(0, 8)}… calls ${call.method}, not ${method}`);
  if (!ok(t.status)) throw new Error(`${t.transaction.hash.slice(0, 8)}… ended ${JSON.stringify(t.status)}`);
  return call;
}

/**
 * The panic message of a failed transaction, read as the package's failureMessage reads it for the
 * runner, or null if it succeeded.
 */
function panicOf(t) {
  if (ok(t.status)) return null;
  const text = JSON.stringify(t.status);
  return text.match(/Smart contract panicked: ([^"\\]+)/)?.[1] ?? text;
}

/** The function calls `from` made on `to` in the transaction's receipts, each with its receipt's outcome. */
function callsIn(t, from, to) {
  const outcomes = new Map(t.receipts_outcome.map((o) => [o.id, o.outcome.status]));
  return t.receipts
    .filter((r) => r.predecessor_id === from && r.receiver_id === to)
    .flatMap((r) =>
      (r.receipt.Action?.actions ?? [])
        .map((a) => a.FunctionCall)
        .filter(Boolean)
        .map((c) => ({ receipt: r.receipt_id, method: c.method_name, args: json(c.args), deposit: c.deposit, status: outcomes.get(r.receipt_id) })),
    );
}

/** The NEP-297 events `executor` logged in the transaction, parsed, in the order its receipts ran. */
const eventsBy = (t, executor, standard) =>
  t.receipts_outcome
    .filter((o) => o.outcome.executor_id === executor)
    .flatMap((o) => o.outcome.logs.filter((l) => l.startsWith("EVENT_JSON:")).map((l) => JSON.parse(l.slice("EVENT_JSON:".length))))
    .filter((e) => e.standard === standard);

/** A block's height and time in nanoseconds, by hash, read once. */
const blocks = new Map();
function block(hash) {
  if (!blocks.has(hash)) {
    blocks.set(
      hash,
      archival("block", { block_id: hash }).then(({ header }) => ({ height: BigInt(header.height), ns: BigInt(header.timestamp_nanosec ?? header.timestamp) })),
    );
    blocks.get(hash).catch(() => blocks.delete(hash));
  }
  return blocks.get(hash);
}

/**
 * Where the first receipt `executor` ran: its block hash, height, and the block time its code saw
 * as `env::block_timestamp()`.
 */
async function ranAt(t, executor) {
  const outcome = t.receipts_outcome.find((o) => o.outcome.executor_id === executor);
  if (!outcome) throw new Error(`no receipt of ${t.transaction.hash.slice(0, 8)}… ran on ${executor}`);
  return { hash: outcome.block_hash, ...(await block(outcome.block_hash)) };
}

/** Block time in nanoseconds, as an ISO time to the second. */
const iso = (ns) => new Date(Number(BigInt(ns) / 1_000_000n)).toISOString().replace(/\.\d+Z$/, "Z");
const short = (hash) => `${hash.slice(0, 8)}…`;

/** base58, for a code hash: the DeployContract action reads back as base64 of sha256(code). */
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes) {
  let n = BigInt(`0x${Buffer.from(bytes).toString("hex") || "0"}`);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

async function check() {
  const CONTRACT = RUN.contract;
  const E = RUN.estate;
  const OWNER = RUN.owner;
  const HEIR = RUN.heir;
  const GUARDIANS = RUN.guardians;
  const TOKEN = RUN.tokenId;
  const INTERVAL = BigInt(RUN.checkInIntervalMinutes) * NANOS_PER_MINUTE;
  const WAITING = BigInt(RUN.waitingPeriodMinutes) * NANOS_PER_MINUTE;
  const step = (key) => RUN.steps.find((s) => s.key === key);
  const approvals = (prefix) => GUARDIANS.slice(0, RUN.threshold).map((_, i) => `${prefix}${i + 1}`);
  const ROUND1 = approvals("approve");
  const ROUND2 = approvals("reapprove");
  /** The steps that are transactions, in the plan's order: the order they must have run in. */
  const ORDER = ["deploy", "lock", "mint", "checkIn", "earlyApprove", ...ROUND1, "cancel", ...ROUND2, "earlyFinalize", "forgedRelease", "finalize", "lateSign"];
  const RULES = {
    satchel_contract: CONTRACT,
    token_id: TOKEN,
    owner: OWNER,
    guardians: GUARDIANS,
    threshold: RUN.threshold,
    heir: HEIR,
    check_in_interval_minutes: RUN.checkInIntervalMinutes,
    waiting_period_minutes: RUN.waitingPeriodMinutes,
  };
  const t = (key) => tx(step(key).tx, step(key).signer);

  /** The estate's events in step `key`'s transaction, by name. */
  const estateEvents = async (key) => eventsBy(await t(key), E, "satchel_estate");

  /**
   * Step `key`, a call by `signer` the estate refused with `message`: the transaction failed with
   * that panic, in the estate's own receipt, and none of its receipts reached the Satchel contract.
   */
  async function refused(key, signer, method, message) {
    const r = await t(key);
    const call = callOf(r, signer, E);
    if (call.method !== method) throw new Error(`${short(r.transaction.hash)} calls ${call.method}, not ${method}`);
    const panic = panicOf(r);
    if (panic !== message) throw new Error(`${short(r.transaction.hash)} ${panic === null ? "succeeded" : `failed with "${panic}"`}, not "${message}"`);
    const reached = callsIn(r, E, CONTRACT);
    if (reached.length > 0) throw new Error(`${short(r.transaction.hash)} still called ${CONTRACT}: ${JSON.stringify(reached)}`);
    return { tx: r, call, ran: await ranAt(r, E) };
  }

  /** A check-in by the owner in step `key`: check_in succeeded and logged its block time; `cancels` adds release_cancelled. */
  async function checkedIn(key, cancels) {
    const c = await t(key);
    succeeded(c, OWNER, E, "check_in");
    const ran = await ranAt(c, E);
    const events = await estateEvents(key);
    const names = events.map((e) => e.event);
    if (canonical(names) !== canonical(cancels ? ["check_in", "release_cancelled"] : ["check_in"])) throw new Error(`${short(c.transaction.hash)} logged ${names.join(", ")}`);
    const data = events[0].data[0];
    if (data.at !== ran.ns.toString() || data.overdue_at !== (ran.ns + INTERVAL).toString()) {
      throw new Error(`check_in logged at ${data.at}, overdue_at ${data.overdue_at}; its block time is ${ran.ns}`);
    }
    return { ran, events };
  }

  /**
   * One round of approvals, after the check-in in step `afterKey`: each by the next guardian, each
   * in a block past that check-in's time plus the interval, and the last one starting the release.
   */
  async function approved(keys, afterKey) {
    const since = (await ranAt(await t(afterKey), E)).ns;
    let started;
    for (const [i, key] of keys.entries()) {
      const a = await t(key);
      succeeded(a, GUARDIANS[i], E, "approve_release");
      const ran = await ranAt(a, E);
      if (ran.ns <= since + INTERVAL) throw new Error(`${short(a.transaction.hash)} ran at ${iso(ran.ns)}, not past the check-in at ${iso(since)} + the interval`);
      const events = await estateEvents(key);
      const names = events.map((e) => e.event);
      const last = i === keys.length - 1;
      if (canonical(names) !== canonical(last ? ["approve", "release_started"] : ["approve"])) throw new Error(`${short(a.transaction.hash)} logged ${names.join(", ")}`);
      if (events[0].data[0].guardian !== GUARDIANS[i] || events[0].data[0].approvals !== i + 1) throw new Error(`approve logged ${JSON.stringify(events[0].data[0])}`);
      if (last) {
        const s = events[1].data[0];
        if (s.at !== ran.ns.toString() || s.release_at !== (ran.ns + WAITING).toString() || canonical(s.approvals) !== canonical(GUARDIANS.slice(0, keys.length))) {
          throw new Error(`release_started logged ${JSON.stringify(s)}; the block time is ${ran.ns}`);
        }
        started = { ns: ran.ns, releaseAt: ran.ns + WAITING, tx: a.transaction.hash };
      }
    }
    return { since, started };
  }

  /** How that code was built, as the deploy step recorded it. */
  const BUILT = { reproducible: ", the CI's reproducible build,", local: ", a local build (not a reproducible one)," }[RUN.code?.build?.kind] ?? "";

  const CLAIMS = [
    {
      claim: `${E} has no access keys, so nobody can change its code or its rules`,
      needs: ["lock"],
      check: async () => {
        const { keys } = await query({ request_type: "view_access_key_list", account_id: E });
        if (keys.length !== 0) throw new Error(`${keys.length} access key(s)`);
        return "view_access_key_list: 0 keys";
      },
    },
    {
      claim: `It runs the code the run deployed${BUILT} and not a global contract`,
      needs: ["deploy"],
      check: async () => {
        const account = await query({ request_type: "view_account", account_id: E });
        if (account.global_contract_hash || account.global_contract_account_id) throw new Error("runs a global contract");
        if (account.code_hash !== RUN.code.codeHash) throw new Error(`code hash ${account.code_hash}, the file records ${RUN.code.codeHash}`);
        const meta = await view(E, "contract_source_metadata");
        if (!meta.standards?.some((s) => s.standard === "nep297")) throw new Error(`contract_source_metadata lists ${JSON.stringify(meta.standards)}`);
        if (RUN.code.build.kind === "reproducible") {
          if (meta.build_info?.build_environment !== REPRODUCIBLE_IMAGE) throw new Error(`build_info is ${JSON.stringify(meta.build_info)}`);
          if (meta.build_info.source_code_snapshot !== RUN.code.build.sourceCodeSnapshot) throw new Error(`source ${meta.build_info.source_code_snapshot}`);
          return `code hash ${account.code_hash}; NEP-330: ${meta.build_info.source_code_snapshot}, ${meta.build_info.build_environment.split("@")[0]}`;
        }
        return `code hash ${account.code_hash}; NEP-330 build_info ${meta.build_info == null ? "none, as for any local build" : JSON.stringify(meta.build_info)}`;
      },
    },
    {
      claim:
        `It was deployed and initialized in one transaction: satchel #${TOKEN} on ${CONTRACT}, owner ${OWNER}, guardians ${GUARDIANS.join(" and ")} ` +
        `(${RUN.threshold} must approve), heir ${HEIR}, a ${RUN.checkInIntervalMinutes}-minute check-in interval and a ${RUN.waitingPeriodMinutes}-minute ` +
        "waiting period; its view returns the same rules now",
      needs: ["deploy"],
      check: async () => {
        const d = await t("deploy");
        const actions = d.transaction.actions.map((a) => Object.keys(a)[0]);
        if (d.transaction.signer_id !== E || d.transaction.receiver_id !== E || actions.join() !== "DeployContract,FunctionCall") {
          throw new Error(`${d.transaction.signer_id} → ${d.transaction.receiver_id}: ${actions.join(", ")}`);
        }
        if (!ok(d.status)) throw new Error(`ended ${JSON.stringify(d.status)}`);
        const deployed = base58(Buffer.from(d.transaction.actions[0].DeployContract.code, "base64"));
        if (deployed !== RUN.code.codeHash) throw new Error(`the transaction deployed ${deployed}`);
        const init = d.transaction.actions[1].FunctionCall;
        if (init.method_name !== "new" || canonical(json(init.args)) !== canonical(RULES)) throw new Error(`${init.method_name}(${Buffer.from(init.args, "base64").toString()})`);
        const v = await view(E, "estate");
        const now = Object.fromEntries(Object.keys(RULES).map((k) => [k, v[k]]));
        if (canonical(now) !== canonical(RULES)) throw new Error(`estate() reads ${JSON.stringify(now)}`);
        return `${short(d.transaction.hash)} DeployContract ${deployed.slice(0, 8)}…, then new with these ${Object.keys(RULES).length} rules; estate() returns the same`;
      },
    },
    {
      claim: `Its only key was deleted, with that key, before the satchel was minted to it`,
      needs: ["lock", "mint"],
      check: async () => {
        const [l, m] = await Promise.all([t("lock"), t("mint")]);
        const actions = l.transaction.actions;
        const deleted = actions.length === 1 ? actions[0].DeleteKey?.public_key : undefined;
        if (l.transaction.signer_id !== E || l.transaction.receiver_id !== E || !deleted || !ok(l.status)) {
          throw new Error(`${short(l.transaction.hash)} is not a successful DeleteKey by ${E}`);
        }
        if (l.transaction.public_key !== deleted) throw new Error(`signed with ${l.transaction.public_key}, deleting ${deleted}`);
        const [locked, minted] = await Promise.all([ranAt(l, E), ranAt(m, CONTRACT)]);
        if (locked.height >= minted.height) throw new Error(`DeleteKey at block ${locked.height}, mint at ${minted.height}`);
        return `${short(l.transaction.hash)} DeleteKey ${deleted.slice(0, 16)}… at block ${locked.height}; the mint ran at block ${minted.height}`;
      },
    },
    {
      claim: `${OWNER} minted satchel #${TOKEN}, a satchel after #${LAST_FROZEN}, straight to the estate, with an empty signing record`,
      needs: ["mint"],
      check: async () => {
        const m = await t("mint");
        const call = succeeded(m, OWNER, CONTRACT, "mint");
        if (call.args.receiver_id !== E) throw new Error(`minted to ${call.args.receiver_id}`);
        if (json(m.status.SuccessValue)?.token_id !== TOKEN || !(Number(TOKEN) > LAST_FROZEN)) throw new Error(`the mint returned ${m.status.SuccessValue}`);
        const event = eventsBy(m, CONTRACT, "nep171").find((e) => e.event === "nft_mint")?.data?.[0];
        if (event?.owner_id !== E || event.token_ids?.join() !== TOKEN) throw new Error(`the contract logged ${JSON.stringify(event)}`);
        const at = (await ranAt(m, CONTRACT)).hash;
        const [token, record] = await Promise.all([view(CONTRACT, "nft_token", { token_id: TOKEN }, at), view(CONTRACT, "signing_record", { token_id: TOKEN }, at)]);
        if (token?.owner_id !== E || record.version !== "0") throw new Error(`right after it: owner ${token?.owner_id}, record version ${record.version}`);
        return `${short(m.transaction.hash)} nft_mint: #${TOKEN} to ${E}; right after: owner ${E}, record version 0`;
      },
    },
    {
      claim: `The owner checked in, and ${GUARDIANS[0]}'s approval before the interval had passed was refused: "${REFUSED.early}"`,
      needs: ["checkIn", "earlyApprove"],
      check: async () => {
        const { ran } = await checkedIn("checkIn", false);
        const early = await refused("earlyApprove", GUARDIANS[0], "approve_release", REFUSED.early);
        if (early.ran.ns <= ran.ns || early.ran.ns > ran.ns + INTERVAL) throw new Error(`the refused approval ran at ${iso(early.ran.ns)}, the check-in at ${iso(ran.ns)}`);
        const left = (ran.ns + INTERVAL - early.ran.ns) / 1_000_000_000n;
        return `${short(step("checkIn").tx)} check_in at ${iso(ran.ns)}; ${short(step("earlyApprove").tx)} refused at ${iso(early.ran.ns)}, ${left} s before the owner was overdue`;
      },
    },
    {
      claim: `Once the interval had passed, ${GUARDIANS.slice(0, RUN.threshold).join(" and ")} approved and the ${RUN.waitingPeriodMinutes}-minute waiting period started`,
      needs: ["checkIn", ...ROUND1],
      check: async () => {
        const { since, started } = await approved(ROUND1, "checkIn");
        return `check-in at ${iso(since)}; approvals after ${iso(since + INTERVAL)}; ${short(started.tx)} started the release at ${iso(started.ns)}, release_at ${iso(started.releaseAt)}`;
      },
    },
    {
      claim: "The owner cancelled that release by checking in during the waiting period",
      needs: ["checkIn", ...ROUND1, "cancel"],
      check: async () => {
        const { started } = await approved(ROUND1, "checkIn");
        const { ran, events } = await checkedIn("cancel", true);
        const cancelled = events[1].data[0];
        if (cancelled.started_at !== started.ns.toString() || ran.ns >= started.releaseAt) {
          throw new Error(`release_cancelled logged ${JSON.stringify(cancelled)} at ${iso(ran.ns)}; the release started at ${iso(started.ns)}, release_at ${iso(started.releaseAt)}`);
        }
        return `${short(step("cancel").tx)} check_in at ${iso(ran.ns)}, ${(started.releaseAt - ran.ns) / 1_000_000_000n} s before release_at: release_cancelled`;
      },
    },
    {
      claim: "After the next interval the guardians approved again, and the waiting period started again",
      needs: ["cancel", ...ROUND2],
      check: async () => {
        const { since, started } = await approved(ROUND2, "cancel");
        return `the cancel's check-in at ${iso(since)}; approvals after ${iso(since + INTERVAL)}; ${short(started.tx)} started it again at ${iso(started.ns)}, release_at ${iso(started.releaseAt)}`;
      },
    },
    {
      claim: `During that waiting period the heir's finalize was refused ("${REFUSED.waiting}"), and so was the heir's direct call to the estate's callback ("${REFUSED.privateCallback}")`,
      needs: ["cancel", ...ROUND2, "earlyFinalize", "forgedRelease"],
      check: async () => {
        const { started } = await approved(ROUND2, "cancel");
        const early = await refused("earlyFinalize", HEIR, "finalize_release", REFUSED.waiting);
        const forged = await refused("forgedRelease", HEIR, "on_release", REFUSED.privateCallback);
        // near-sdk refuses a private call at any time, so the forged one's block time is checked too.
        for (const [what, r] of [["finalize", early], ["call to on_release", forged]]) {
          if (r.ran.ns <= started.ns || r.ran.ns > started.releaseAt) {
            throw new Error(`the refused ${what} ran at ${iso(r.ran.ns)}, the waiting period ran from ${iso(started.ns)} to ${iso(started.releaseAt)}`);
          }
        }
        const left = (r) => (started.releaseAt - r.ran.ns) / 1_000_000_000n;
        return `${short(early.tx.transaction.hash)} refused at ${iso(early.ran.ns)}, ${left(early)} s before release_at; ${short(forged.tx.transaction.hash)} refused at ${iso(forged.ran.ns)}, ${left(forged)} s before`;
      },
    },
    {
      claim:
        `After the waiting period the heir finalized: the estate called nft_transfer on ${CONTRACT} with 1 yoctoNEAR, satchel #${TOKEN} moved to ${HEIR}, ` +
        "and the estate recorded the release only in the callback that saw it succeed",
      needs: ["cancel", ...ROUND2, "finalize"],
      check: async () => {
        const { started } = await approved(ROUND2, "cancel");
        const f = await t("finalize");
        succeeded(f, HEIR, E, "finalize_release");
        const ran = await ranAt(f, E);
        if (ran.ns <= started.releaseAt) throw new Error(`finalize ran at ${iso(ran.ns)}, not past release_at ${iso(started.releaseAt)}`);
        const sent = callsIn(f, E, CONTRACT);
        const asked = canonical({ receiver_id: HEIR, token_id: TOKEN });
        if (sent.length !== 1 || sent[0].method !== "nft_transfer" || canonical(sent[0].args) !== asked || sent[0].deposit !== "1" || !ok(sent[0].status)) {
          throw new Error(`the estate called ${JSON.stringify(sent)}`);
        }
        const moved = eventsBy(f, CONTRACT, "nep171").find((e) => e.event === "nft_transfer")?.data?.[0];
        if (moved?.old_owner_id !== E || moved.new_owner_id !== HEIR || moved.token_ids?.join() !== TOKEN) throw new Error(`the Satchel contract logged ${JSON.stringify(moved)}`);
        const callback = callsIn(f, E, E).find((c) => c.method === "on_release");
        if (!callback || json(callback.status?.SuccessValue ?? "") !== true) throw new Error(`on_release: ${JSON.stringify(callback)}`);
        const names = (await estateEvents("finalize")).map((e) => e.event);
        if (canonical(names) !== canonical(["release_sent", "released"])) throw new Error(`the estate logged ${names.join(", ")}`);
        if (json(f.status.SuccessValue) !== true) throw new Error(`finalize_release resolved to ${f.status.SuccessValue}`);
        const v = await view(E, "estate");
        if (v.phase !== "released" || v.transfer_in_flight || v.released_at === null) throw new Error(`estate() reads ${v.phase}, released_at ${v.released_at}`);
        const late = (ran.ns - started.releaseAt) / 1_000_000_000n;
        return `${short(f.transaction.hash)} at ${iso(ran.ns)}, ${late} s past release_at: nft_transfer ${E} → ${HEIR}, on_release returned true; estate() reads "released"`;
      },
    },
    {
      claim: `After the release the old owner's sign_evm through the estate was refused ("${REFUSED.released}") and reached nothing`,
      needs: ["finalize", "lateSign"],
      check: async () => {
        const late = await refused("lateSign", OWNER, "sign_evm", REFUSED.released);
        if (late.call.deposit !== "1") throw new Error(`it attached ${late.call.deposit} yoctoNEAR`);
        const released = await ranAt(await t("finalize"), E);
        if (late.ran.height <= released.height) throw new Error(`the refused call ran at block ${late.ran.height}, the release at ${released.height}`);
        return `${short(late.tx.transaction.hash)} refused at block ${late.ran.height}, after the release at ${released.height}; no receipt to ${CONTRACT}`;
      },
    },
    {
      claim: `Satchel #${TOKEN} is ${HEIR}'s and its signing record is empty: nothing was ever signed for it, and the report the run read for the heir said PROVABLY CLEAN`,
      needs: ["finalize", "heirReport"],
      check: async () => {
        const [token, record] = await Promise.all([view(CONTRACT, "nft_token", { token_id: TOKEN }), view(CONTRACT, "signing_record", { token_id: TOKEN })]);
        if (token?.owner_id !== HEIR) throw new Error(`owned by ${token?.owner_id}`);
        const empty = { evm: [], approvals: [], approvals_not_itemized: 0, unclassified_calls: 0, opaque_signatures: 0, last_opaque_at: "0", version: "0" };
        if (canonical(record) !== canonical(empty)) throw new Error(`signing_record is ${JSON.stringify(record)}`);
        const report = step("heirReport");
        if (report.verdict !== "clean" || report.owner !== HEIR || report.recordVersion !== "0" || report.checks.some((c) => c.status !== "pass")) {
          throw new Error(`the file's report reads ${report.verdict} for ${report.owner}: ${JSON.stringify(report.checks)}`);
        }
        return `nft_token: ${HEIR}; signing_record version 0, nothing on it; the report read at ${report.checkedAt}: clean, ${report.checks.length} checks pass`;
      },
    },
    {
      claim: "Every transaction of the run ran in the plan's order",
      needs: ORDER,
      check: async () => {
        const heights = [];
        for (const key of ORDER) {
          const r = await t(key);
          heights.push((await block(r.transaction_outcome.block_hash)).height);
        }
        for (let i = 1; i < heights.length; i += 1) {
          if (heights[i] <= heights[i - 1]) throw new Error(`${ORDER[i]} is in block ${heights[i]}, not after ${ORDER[i - 1]}'s ${heights[i - 1]}`);
        }
        return `${ORDER.length} transactions, blocks ${heights[0]} to ${heights.at(-1)}`;
      },
    },
  ];

  let failed = 0;
  let waiting = 0;
  for (const { claim, needs, check: run } of CLAIMS) {
    const missing = needs.filter((key) => !step(key));
    if (missing.length > 0) {
      waiting += 1;
      console.log(`[WAIT] ${claim}\n       not run yet: ${FILE} has no step ${missing.join(", ")}`);
      continue;
    }
    try {
      console.log(`[PASS] ${claim}\n       ${await run()}`);
    } catch (err) {
      failed += 1;
      console.log(`[FAIL] ${claim}\n       ${err.message}`);
    }
  }
  const held = CLAIMS.length - failed - waiting;
  console.log(`\n${held} of ${CLAIMS.length} claims hold${waiting ? `, ${waiting} not run yet` : ""} (${RPC}, archival ${ARCHIVAL})`);
  if (archivalNodes[0] !== ARCHIVAL && answeredBy.archival.size) {
    console.log(`Archival reads came from ${[...answeredBy.archival].join(" and ")}: once ${ARCHIVAL} didn't answer one, later ones went to ${archivalNodes[0]} first`);
  }
  return failed + waiting === 0;
}

if (RUN === null) {
  console.log(`${FILE} doesn't exist yet: the estate run hasn't been recorded, so there is nothing to check. node tools/estate-run.mjs prints its plan.`);
  process.exitCode = 1;
} else {
  process.exitCode = (await check()) ? 0 : 1;
}
