// Runs the estate run on NEAR testnet, step by step (tools/estate.mjs builds the plan). With no flag
// it prints the plan, reading only --out, the wasm file and no chain: each step, who signs, the
// receiver, the method and its arguments, the deposit, the gas, and what it checks first.
//
//   node tools/estate-run.mjs                 the plan; steps already in --out are marked done
//   node tools/estate-run.mjs --run           runs every pending step, in order, until one stops
//   node tools/estate-run.mjs --run --one     runs only the next pending step
//
// Testnet only: every account must end in .testnet, the NEAR RPC must say it serves testnet and
// the near CLI signs with network-config testnet. The near CLI (NEAR_CLI, or ~/.cargo/bin/near.exe,
// or near on PATH) signs every transaction from the legacy keychain (~/.near-credentials) with
// `display`; this script never reads a key. A function call is checked against what was asked with
// the package's near-cli.ts before it is sent; the deploy and the lock with tools/estate.mjs's
// decoder, which checks the code's hash and the key deleted.
//
// Waits are real time. A wait step reads the estate's own view for the time it waits for
// (overdue_at or release_at) and waits until a final block's time is past it, up to 10 minutes;
// for longer it stops and says when to run again. A call the chain must refuse goes out only with a
// minute to spare, and is recorded with its failure only if it failed with the expected message.
//
// Three calls must land inside a waiting period: the cancel inside the first, the early finalize
// and the forged callback inside the second. Each goes out only with a minute left before
// release_at; with less, the run stops, and since the rules can't change after init, this estate
// can't have that window again: the run starts over with another --estate and --out. So send each
// round's last approval and the calls after it in one --run, not step by step with --one.
//
// Before each step it reads what the step needs (accounts, keys, balances, the estate's view, the
// satchel's owner), and after it reads the transaction back with every receipt. Any difference
// stops the run. --out (default deployments/testnet-estate.json) gets each step as soon as it is
// read back, and a sent transaction's hash under `pending` before it is sent, so a run that stops
// can be run again: it reads that transaction back first. One that ran on chain stays under
// `pending` until its check passes, so it is never sent twice, and each step also refuses what an
// earlier run already did: the estate runs code, has no key, owns a satchel, the satchel moved. A
// transaction that ended other than the plan says (failed, or ran when it should have been
// refused) goes under `failed` and stops every later run until someone has looked at it.
//
// Flags: --estate, --owner, --guardians <a,b>, --threshold, --heir, --interval and --waiting
// (minutes), --out, --wasm <path> (default contracts/estate/target/near/estate.wasm) and --ci-run
// <url>, the GitHub Actions run whose estate-reproducible-wasm artifact --wasm is: without it the
// evidence says the wasm was built locally. Node 22 or later, after `npm ci` and
// `npm run build --prefix packages/satchel-nft`.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { builtPackage } from "../scripts/built.mjs";
import {
  AMOUNTS,
  EARLY_MARGIN_NS,
  LAST_FROZEN,
  LATE_MARGIN_NS,
  REFUSED,
  assertDeleteKeyAsAsked,
  assertDeployAsAsked,
  buildPlan,
  canonical,
  codeHash,
  decodeSignedActions,
  deleteKeyCliArgs,
  deployCliArgs,
  done,
  formatNear,
  initArgs,
  isoAt,
  minutesNs,
  nextStep,
  runConfig,
  sameRun,
  takeable,
  tokenIdsIn,
  unresolved,
} from "./estate.mjs";

const {
  NEAR_ARCHIVAL_RPC,
  TESTNET,
  TGAS,
  buildReport,
  failureMessage,
  finalOutcome,
  nearChainId,
  nearRpc,
  nearRpcUrl,
  outcomeValue,
  satchel,
  setNearRpc,
  tokenAddress,
  view,
  viewAccount,
} = await builtPackage();
const { OutcomeUnknown, resolveNearCli, signAndSend, signedFromOutput } = await builtPackage("near-cli.js");

const NEAR = 10n ** 24n;
const GAS_ROOM = NEAR / 10n;
/** An account with no contract deployed has this code hash. */
const NO_CODE = "11111111111111111111111111111111";
/** The image the CI's reproducible build ran in, as contracts/estate/Cargo.toml pins it. */
const REPRODUCIBLE_IMAGE = "sourcescan/cargo-near:0.22.0-rust-1.99.1@sha256:c9655eaf7436b90c87ea8b25739f91063032c5c30ba24cfeafe72c142943b5bb";
/** The runner waits this long itself; a longer wait stops the run with the time to run it again. */
const MAX_WAIT_MS = 10 * 60 * 1_000;

/** A refusal, printed with exit code 1. Thrown rather than process.exit, which can crash Node on Windows while sockets close. */
class Stop extends Error {}
const stop = (message) => {
  throw new Stop(message);
};

/**
 * The end of this estate's run when a call missed its waiting period: the rules are fixed at init,
 * and the evidence ties the call to that waiting period, which doesn't come again.
 */
const startOver = (why) =>
  `${why}. This estate can't show that call any more: its rules can't change, and the evidence ties the call to this waiting period. Start over with another --estate account and another --out; the new estate gets the next satchel`;

/** Stops the run unless the estate's view `v` has a minute left before release_at: `what` must land during the waiting period. */
function assertInWindow(v, what) {
  const left = BigInt(v.release_at) - BigInt(v.now);
  if (left < EARLY_MARGIN_NS) {
    const when = left > 0n ? `ends in ${left / 1_000_000_000n} s, too soon` : `ended at ${isoAt(v.release_at)}, too late`;
    stop(startOver(`the waiting period ${when} to send ${what}`));
  }
}

// The flags, the accounts and the evidence file, set by setup() inside the try at the bottom, so a
// wrong flag or file ends with a message, not a stack trace.
let flags;
let OUT;
let WASM;
let cfg;
let ESTATE;
let OWNER;
let HEIR;
let run;

function setup() {
  ({ values: flags } = parseArgs({
    strict: true,
    options: {
      run: { type: "boolean" },
      one: { type: "boolean" },
      out: { type: "string" },
      estate: { type: "string" },
      owner: { type: "string" },
      guardians: { type: "string" },
      threshold: { type: "string" },
      heir: { type: "string" },
      interval: { type: "string" },
      waiting: { type: "string" },
      wasm: { type: "string" },
      "ci-run": { type: "string" },
    },
  }));
  OUT = flags.out ?? fileURLToPath(new URL("../deployments/testnet-estate.json", import.meta.url));
  WASM = resolve(flags.wasm ?? fileURLToPath(new URL("../contracts/estate/target/near/estate.wasm", import.meta.url)));
  if (flags["ci-run"] && !/^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/\d+$/.test(flags["ci-run"])) stop(`--ci-run ${flags["ci-run"]} is not a GitHub Actions run URL`);
  cfg = runConfig({
    estate: flags.estate,
    owner: flags.owner,
    guardians: flags.guardians?.split(",").map((s) => s.trim()),
    threshold: flags.threshold,
    heir: flags.heir,
    intervalMinutes: flags.interval,
    waitingMinutes: flags.waiting,
  });
  ({ estate: ESTATE, owner: OWNER, heir: HEIR } = cfg);
  // One approval step per guardian the threshold needs, in each round; the last one starts the release.
  for (let i = 1; i <= cfg.threshold; i += 1) {
    STEPS[`approve${i}`] = approval(i === cfg.threshold);
    STEPS[`reapprove${i}`] = approval(i === cfg.threshold);
  }
  run = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : fresh();
  if (!sameRun(run, cfg)) {
    stop(`${OUT} is the record of the estate ${run.estate} (owner ${run.owner}, guardians ${run.guardians?.join(", ")}, heir ${run.heir}), not this run's: give another --out`);
  }
}

// ---- The evidence file -------------------------------------------------------------------------

function fresh() {
  return {
    network: "testnet",
    contract: TESTNET.contract,
    mpc: TESTNET.mpc,
    estate: ESTATE,
    owner: OWNER,
    guardians: cfg.guardians,
    threshold: cfg.threshold,
    heir: HEIR,
    checkInIntervalMinutes: cfg.intervalMinutes,
    waitingPeriodMinutes: cfg.waitingMinutes,
    note: IN_PROGRESS,
    steps: [],
  };
}

const IN_PROGRESS = "Written by tools/estate-run.mjs as each step was read back; the run is not complete yet.";
/** The note once every step is in. */
const COMPLETE =
  "The near CLI signed every transaction from the legacy keychain, and tools/estate-run.mjs checked each one against what it asked for before sending it and read it back from the chain after. The near CLI's faucet service created the estate's account before the run (not recorded here). Every wait is real block time. The builder controls every account in this run: it shows the estate's rules working on testnet, not a family using them. contracts/estate is a demo contract, not audited.";

/** Writes the file whole, through a temporary file, so a run cut off mid-write leaves the last one. */
function save() {
  const tmp = `${OUT}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(run, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2)}\n`);
  renameSync(tmp, OUT);
}

// ---- Reads -------------------------------------------------------------------------------------

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A read, tried up to 3 times, 2 s apart: a busy node is not a reason to stop. Never used for a send. */
async function read(what, fn) {
  for (let i = 1; ; i += 1) {
    try {
      return await fn();
    } catch (err) {
      if (i >= 3) throw new Error(`${what}: ${err instanceof Error ? err.message : String(err)}`);
      await wait(2_000);
    }
  }
}

/** An account's view_account, or null if it doesn't exist. */
async function account(id) {
  try {
    return await viewAccount(TESTNET, id);
  } catch (err) {
    if (JSON.stringify(err.cause ?? "").includes("UNKNOWN_ACCOUNT")) return null;
    throw err;
  }
}

/** The estate's access keys, each with its permission. */
const keysOf = async (id) =>
  (await read(`view_access_key_list ${id}`, () => nearRpc(TESTNET, "query", { request_type: "view_access_key_list", finality: "final", account_id: id }))).keys;

/** contracts/estate's one view: its rules, state, phase and the times they change, at a final block. */
const estateView = () => read("estate()", () => view(TESTNET, ESTATE, "estate"));
const nftToken = (tokenId) => read(`nft_token ${tokenId}`, () => view(TESTNET, TESTNET.contract, "nft_token", { token_id: tokenId }));
const finalBlock = () => read("final block", () => nearRpc(TESTNET, "block", { finality: "final" }));

/**
 * A transaction with every receipt, once final, or null if no node knows it. Asked with wait_until
 * "NONE", as scripts/check-estate.mjs asks: with "FINAL", nearcore holds a request for a transaction
 * it doesn't know 30 s and answers HTTP 408, so one that never landed would read as a busy node. The
 * regular node drops a transaction after a day or two, so one it doesn't know is asked of FastNEAR's
 * archival node too, unless NEAR_RPC names another node. Unknown three times in a row, 3 s apart, is
 * unknown: a transaction just sent can take a block to show. A known one is asked again until it is
 * final, for up to a minute.
 */
async function txStatus(hash, signer) {
  const params = { tx_hash: hash, sender_account_id: signer, wait_until: "NONE" };
  const unknown = (err) => JSON.stringify(err?.cause ?? "").includes("UNKNOWN_TRANSACTION");
  const ask = async () => {
    try {
      return await nearRpc(TESTNET, "EXPERIMENTAL_tx_status", params);
    } catch (err) {
      if (!unknown(err) || nearRpcUrl(TESTNET) !== TESTNET.nearRpc) throw err;
      return nearRpc(TESTNET, "EXPERIMENTAL_tx_status", params, undefined, NEAR_ARCHIVAL_RPC.testnet);
    }
  };
  let unknowns = 0;
  let last = "";
  for (let i = 1; i <= 20; i += 1) {
    try {
      const t = await ask();
      if (t.final_execution_status === "FINAL") return t;
      unknowns = 0;
      last = `it is ${t.final_execution_status}, not final yet`;
    } catch (err) {
      unknowns = unknown(err) ? unknowns + 1 : 0;
      if (unknowns >= 3) return null;
      last = err instanceof Error ? err.message : String(err);
    }
    await wait(3_000);
  }
  stop(`${hash} couldn't be read back from ${nearRpcUrl(TESTNET)} in a minute (${last}). It stays under "pending" in ${OUT}: run this again, and it is read back before anything else`);
}

/** A block's height and time, by hash. */
async function blockAt(hash) {
  const { header } = await read("block", () => nearRpc(TESTNET, "block", { block_id: hash }));
  const ns = BigInt(header.timestamp_nanosec ?? header.timestamp);
  return { block: String(header.height), at: isoAt(ns), ns };
}

/** The block the transaction was included in. */
const blockOf = async (t) => {
  const { block, at } = await blockAt(t.transaction_outcome.block_hash);
  return { block, at };
};

/**
 * The block the first receipt `executor` ran in, and its time in nanoseconds: the block time the
 * estate's code saw as `env::block_timestamp()`.
 */
async function ranAt(t, executor) {
  const outcome = t.receipts_outcome.find((o) => o.outcome.executor_id === executor);
  if (!outcome) throw new Error(`no receipt ran on ${executor}`);
  const { block, at, ns } = await blockAt(outcome.block_hash);
  return { block, at, ns: ns.toString() };
}

const json = (base64) => JSON.parse(Buffer.from(base64, "base64").toString() || "null");
const ok = (status) => typeof status === "object" && status !== null && "SuccessValue" in status;

/** The NEP-297 events `executor` logged in the transaction: { standard, event, data }. */
const eventsBy = (t, executor) =>
  t.receipts_outcome
    .filter((o) => o.outcome.executor_id === executor)
    .flatMap((o) => o.outcome.logs.filter((l) => l.startsWith("EVENT_JSON:")).map((l) => JSON.parse(l.slice("EVENT_JSON:".length))));
const estateEvents = (t) => eventsBy(t, ESTATE).filter((e) => e.standard === "satchel_estate").map((e) => e.event);

/** The function calls `from` made on `to` in the transaction's receipts, each with its receipt's outcome. */
function callsIn(t, from, to) {
  const outcomes = new Map(t.receipts_outcome.map((o) => [o.id, o.outcome.status]));
  return (t.receipts ?? [])
    .filter((r) => r.predecessor_id === from && r.receiver_id === to)
    .flatMap((r) =>
      (r.receipt.Action?.actions ?? [])
        .filter((a) => a.FunctionCall)
        .map((a) => ({ receipt: r.receipt_id, method: a.FunctionCall.method_name, args: json(a.FunctionCall.args), deposit: a.FunctionCall.deposit, status: outcomes.get(r.receipt_id) })),
    );
}

// ---- Checks every signed step makes ------------------------------------------------------------

function keyFile(id) {
  // The legacy keychain keeps <id>.json or a folder <id>/ of key files. Only the names are looked at.
  const base = join(homedir(), ".near-credentials", "testnet");
  return existsSync(join(base, `${id}.json`)) || existsSync(join(base, id));
}

async function assertSigner(step) {
  if (!step.signer.endsWith(".testnet") || !step.receiver.endsWith(".testnet")) stop(`${step.key}: ${step.signer} → ${step.receiver} is not testnet`);
  if (unresolved(step)) stop(`${step.key} still holds a <placeholder>: an earlier step's result is missing from ${OUT}`);
  const frozen = tokenIdsIn(step.args ?? {}).filter((id) => !takeable(id));
  if (frozen.length > 0) stop(`${step.key} names satchel #${frozen.join(", #")}, a satchel this run never takes (#1 to #${LAST_FROZEN}, or not a satchel id)`);
  if (run.tokenId !== undefined && !takeable(run.tokenId)) stop(`the estate's satchel is #${run.tokenId}, one this run never takes`);
  const signer = await read(`view_account ${step.signer}`, () => account(step.signer));
  if (signer === null) stop(`${step.signer} does not exist on testnet`);
  if (!keyFile(step.signer)) stop(`The legacy keychain (~/.near-credentials/testnet) has no key for ${step.signer}`);
  const need = BigInt(step.deposit ?? 0) + GAS_ROOM;
  if (BigInt(signer.amount) < need) stop(`${step.signer} holds ${formatNear(signer.amount)} and ${step.key} needs ${formatNear(need)} with gas`);
}

/** The estate's view, stopped unless its phase is one of `phases`. */
async function assertPhase(step, ...phases) {
  const v = await estateView();
  if (!phases.includes(v.phase)) stop(`${step.key}: estate() reads "${v.phase}", not ${phases.map((p) => `"${p}"`).join(" or ")}`);
  if (v.transfer_in_flight) stop(`${step.key}: the estate's transfer to the heir is in flight`);
  return v;
}

/** The estate's satchel, stopped unless `owner` owns it and it is not listed. */
async function assertSatchel(owner) {
  if (!takeable(run.tokenId)) stop(`satchel #${run.tokenId} is one this run never takes`);
  const s = await read(`satchel ${run.tokenId}`, () => satchel(TESTNET).get(run.tokenId));
  if (s?.owner_id !== owner) stop(`satchel #${run.tokenId} is owned by ${s?.owner_id}, not ${owner}`);
  if (s.listing !== null) stop(`satchel #${run.tokenId} is listed`);
  return s;
}

/**
 * The phase of an estate with no release, from the times its view gives: "alive" up to overdue_at,
 * "overdue" after. A check-in read back minutes later reads overdue, and that is no failure.
 */
const idlePhase = (v) => (BigInt(v.now) > BigInt(v.overdue_at) ? "overdue" : "alive");

/**
 * The view after a call: the rules unchanged, and what the step expects of the state. An expected
 * value can be a function of the view, for a field that depends on when it is read.
 */
async function viewAfter(expect) {
  const v = await estateView();
  if (canonical(rulesOf(v)) !== canonical(initArgs(cfg, run.tokenId))) throw new Error(`estate()'s rules are ${JSON.stringify(rulesOf(v))}`);
  for (const [field, expected] of Object.entries(expect)) {
    const want = typeof expected === "function" ? expected(v) : expected;
    if (canonical(v[field]) !== canonical(want)) throw new Error(`estate().${field} is ${JSON.stringify(v[field])}, not ${JSON.stringify(want)}`);
  }
  return v;
}

const rulesOf = (v) => ({
  satchel_contract: v.satchel_contract,
  token_id: v.token_id,
  owner: v.owner,
  guardians: v.guardians,
  threshold: v.threshold,
  heir: v.heir,
  check_in_interval_minutes: v.check_in_interval_minutes,
  waiting_period_minutes: v.waiting_period_minutes,
});

/** The view a snapshot in the evidence keeps: the state and the times, not the rules again. */
const snapshot = (v) => ({
  phase: v.phase,
  now: v.now,
  last_check_in: v.last_check_in,
  overdue_at: v.overdue_at,
  approvals: v.approvals,
  release_started_at: v.release_started_at,
  release_at: v.release_at,
  released_at: v.released_at,
  transfer_in_flight: v.transfer_in_flight,
});

// ---- Each step: what it reads before, and what it reads back after ------------------------------

const approval = (last) => ({
  before: async (step) => {
    const v = await assertPhase(step, "overdue");
    if (v.approvals.includes(step.signer)) stop(`${step.signer} already approved since the last check-in: an earlier run sent this`);
    await assertSatchel(ESTATE);
    return { context: { approvalsBefore: v.approvals } };
  },
  after: async (step, t, context) => {
    const ran = await ranAt(t, ESTATE);
    const approvals = [...context.approvalsBefore, step.signer];
    const events = estateEvents(t);
    if (!last) {
      const v = await viewAfter({ phase: "overdue", approvals, release_started_at: null });
      if (canonical(events) !== canonical(["approve"])) throw new Error(`the estate logged ${events.join(", ")}`);
      return { ran, view: snapshot(v) };
    }
    const releaseAt = (BigInt(ran.ns) + minutesNs(cfg.waitingMinutes)).toString();
    const v = await viewAfter({ phase: "releasing", approvals, release_started_at: ran.ns, release_at: releaseAt });
    if (canonical(events) !== canonical(["approve", "release_started"])) throw new Error(`the estate logged ${events.join(", ")}`);
    return { ran, view: snapshot(v) };
  },
});

/** A call the estate must refuse: before, the phase it is sent in; after, nothing changed. */
const refusal = (phases, more = {}) => ({
  before: async (step) => {
    const v = await assertPhase(step, ...phases);
    await more.before?.(step, v);
    return { context: { viewBefore: snapshot(v) } };
  },
  after: async (step, t, context) => {
    const v = await estateView();
    // With no release, the phase turns from alive to overdue with block time alone: a refusal read
    // back after overdue_at reads overdue, and that is no failure. What the estate stores must not change.
    const phaseOf = (view) => (view.phase === "alive" || view.phase === "overdue" ? "alive or overdue" : view.phase);
    if (phaseOf(v) !== phaseOf(context.viewBefore)) throw new Error(`estate().phase changed from ${JSON.stringify(context.viewBefore.phase)} to ${JSON.stringify(v.phase)}`);
    for (const field of ["approvals", "last_check_in", "release_started_at", "released_at", "transfer_in_flight"]) {
      if (canonical(v[field]) !== canonical(context.viewBefore[field])) throw new Error(`estate().${field} changed from ${JSON.stringify(context.viewBefore[field])} to ${JSON.stringify(v[field])}`);
    }
    const reached = callsIn(t, ESTATE, TESTNET.contract);
    if (reached.length > 0) throw new Error(`the refused call still reached ${TESTNET.contract}: ${JSON.stringify(reached)}`);
    return { ran: await ranAt(t, ESTATE), view: snapshot(v), ...((await more.after?.(step, t, v)) ?? {}) };
  },
});

const checkIn = (phases, cancels) => ({
  before: async (step) => {
    const v = await assertPhase(step, ...phases);
    // The chain takes a check-in until someone finalizes, so a late cancel would still run; the
    // evidence claims one during the waiting period, so it goes out only with a minute left.
    if (cancels) assertInWindow(v, "a cancel that lands during it");
    await assertSatchel(ESTATE);
    return { context: { viewBefore: snapshot(v) } };
  },
  after: async (step, t) => {
    const ran = await ranAt(t, ESTATE);
    const v = await viewAfter({ phase: idlePhase, approvals: [], release_started_at: null, last_check_in: ran.ns });
    const events = estateEvents(t);
    const want = cancels ? ["check_in", "release_cancelled"] : ["check_in"];
    if (canonical(events) !== canonical(want)) throw new Error(`the estate logged ${events.join(", ")}, not ${want.join(", ")}`);
    return { ran, view: snapshot(v) };
  },
});

const STEPS = {
  deploy: {
    before: async () => {
      const acct = await account(ESTATE);
      if (acct === null) stop(`${ESTATE} does not exist yet. Create it first: near account create-account sponsor-by-faucet-service ${ESTATE} autogenerate-new-keypair save-to-legacy-keychain network-config testnet create`);
      if (acct.code_hash !== NO_CODE) stop(`${ESTATE} already runs code ${acct.code_hash}: an earlier run deployed it, so this one doesn't deploy again. Its deploy stays under "pending" in ${OUT} until it is read back`);
      const keys = await keysOf(ESTATE);
      if (keys.length !== 1 || keys[0].access_key.permission !== "FullAccess") stop(`${ESTATE} has ${keys.length} keys (${JSON.stringify(keys.map((k) => k.access_key.permission))}), not one full-access key`);
      if (!existsSync(WASM)) stop(`No wasm at ${WASM}. Build it: cd contracts/estate && cargo near build non-reproducible-wasm --locked, or pass --wasm with the CI's estate-reproducible-wasm artifact and --ci-run`);
      const wasm = readFileSync(WASM);
      const storage = BigInt(wasm.length) * AMOUNTS.storagePerByte + AMOUNTS.estateRoom;
      if (BigInt(acct.amount) < storage + GAS_ROOM) stop(`${ESTATE} holds ${formatNear(acct.amount)}: the code's storage, 0.5 NEAR of room and gas need ${formatNear(storage + GAS_ROOM)}`);
      for (const id of [OWNER, ...cfg.guardians, HEIR]) {
        if ((await account(id)) === null) stop(`${id} does not exist on testnet`);
        if (!keyFile(id)) stop(`The legacy keychain has no key for ${id}`);
      }
      const supply = await read("nft_total_supply", () => satchel(TESTNET).totalSupply());
      // Fails closed: a supply that isn't a whole number would make the next id "NaN", which no check below refuses.
      if (!Number.isSafeInteger(supply) || supply < 0) stop(`nft_total_supply on ${TESTNET.contract} read as ${supply}, not a whole number: the run doesn't guess the next satchel's id`);
      const next = supply + 1;
      if (!takeable(String(next))) stop(`the next satchel would be #${next}: #1 to #9 are the README's demo satchels and #10 is the DAO bounty run's, so the estate waits until #${LAST_FROZEN} exists`);
      return {
        live: { tokenId: String(next) },
        context: { supply, wasm: { path: WASM, codeHash: codeHash(wasm), bytes: wasm.length } },
      };
    },
    after: async (step, t, context) => {
      const acct = await account(ESTATE);
      if (acct?.code_hash !== context.wasm.codeHash) throw new Error(`${ESTATE} runs ${acct?.code_hash}, not ${context.wasm.codeHash}`);
      if (acct.global_contract_hash || acct.global_contract_account_id) throw new Error(`${ESTATE} runs a global contract`);
      run.tokenId = step.args.token_id;
      const ran = await ranAt(t, ESTATE);
      const v = await viewAfter({ phase: idlePhase, approvals: [], release_started_at: null, released_at: null, last_check_in: ran.ns });
      const meta = await read("contract_source_metadata", () => view(TESTNET, ESTATE, "contract_source_metadata"));
      if (flags["ci-run"] && meta.build_info?.build_environment !== REPRODUCIBLE_IMAGE) throw new Error(`--ci-run names a reproducible build, but contract_source_metadata's build_info is ${JSON.stringify(meta.build_info)}`);
      run.code = {
        codeHash: context.wasm.codeHash,
        wasmBytes: context.wasm.bytes,
        build: flags["ci-run"]
          ? { kind: "reproducible", ciRun: flags["ci-run"], artifact: "estate-reproducible-wasm", image: REPRODUCIBLE_IMAGE, sourceCodeSnapshot: meta.build_info.source_code_snapshot }
          : { kind: "local", note: "Built with cargo near build non-reproducible-wasm on the controller's machine, not in the pinned Docker image: the code hash is recorded, but nobody can rebuild it from the source to the same hash." },
        contractSourceMetadata: meta,
      };
      return { ran, view: snapshot(v), code: { codeHash: context.wasm.codeHash, wasmBytes: context.wasm.bytes } };
    },
  },
  lock: {
    before: async () => {
      const acct = await account(ESTATE);
      if (acct?.code_hash !== run.code?.codeHash) stop(`${ESTATE} runs ${acct?.code_hash}, not the code the deploy recorded`);
      const keys = await keysOf(ESTATE);
      if (keys.length === 0) stop(`${ESTATE} has no keys left: an earlier run locked it. Its lock stays under "pending" in ${OUT} until it is read back`);
      if (keys.length !== 1 || keys[0].access_key.permission !== "FullAccess") stop(`${ESTATE} has ${keys.length} keys, not one full-access key`);
      const owned = await read(`nft_tokens_for_owner ${ESTATE}`, () => satchel(TESTNET).tokensFor(ESTATE));
      if (owned.length > 0) stop(`${ESTATE} already owns satchel #${owned.map((s) => s.token_id).join(", #")}: the satchel arrives only after the lock`);
      return { live: { publicKey: keys[0].public_key }, context: { publicKey: keys[0].public_key } };
    },
    after: async (step) => {
      const keys = await keysOf(ESTATE);
      if (keys.length !== 0) throw new Error(`${ESTATE} still has ${keys.length} keys`);
      return { publicKey: step.publicKey, accessKeysAfter: 0 };
    },
  },
  mint: {
    before: async () => {
      const keys = await keysOf(ESTATE);
      if (keys.length !== 0) stop(`${ESTATE} still has ${keys.length} keys: the lock comes first`);
      if (!takeable(run.tokenId)) stop(`the deploy recorded satchel #${run.tokenId}, not an id above #${LAST_FROZEN}`);
      const v = await estateView();
      if (v.token_id !== run.tokenId) stop(`estate() names satchel #${v.token_id}, the deploy recorded #${run.tokenId}`);
      const owned = await read(`nft_tokens_for_owner ${ESTATE}`, () => satchel(TESTNET).tokensFor(ESTATE));
      if (owned.length > 0) stop(`${ESTATE} already owns satchel #${owned.map((s) => s.token_id).join(", #")}: an earlier run minted it`);
      const supply = await read("nft_total_supply", () => satchel(TESTNET).totalSupply());
      if (!Number.isSafeInteger(supply) || supply < 0) stop(`nft_total_supply on ${TESTNET.contract} read as ${supply}, not a whole number: the run doesn't mint without knowing the id it gets`);
      if (String(supply + 1) !== run.tokenId) {
        stop(`the next satchel is #${supply + 1}, but the estate was initialized for #${run.tokenId}: someone minted in between. The estate can never own #${run.tokenId}, and its rules can't change. Start over with another --estate account and --out`);
      }
      return {};
    },
    after: async (step, t) => {
      const token = outcomeValue(t);
      if (token?.token_id !== run.tokenId) throw new Error(`the mint returned ${JSON.stringify(token)}, not #${run.tokenId}`);
      const s = await assertSatchel(ESTATE);
      if (s.record.version !== "0") throw new Error(`satchel #${run.tokenId}'s record is at version ${s.record.version}`);
      run.address = await tokenAddress(TESTNET, s.path);
      return { tokenId: run.tokenId, address: run.address };
    },
  },
  checkIn: checkIn(["alive", "overdue"], false),
  earlyApprove: refusal(["alive", "overdue"], {
    before: async (step, v) => {
      const left = BigInt(v.overdue_at) - BigInt(v.now);
      if (v.phase !== "alive" || left < EARLY_MARGIN_NS) {
        const when = left > 0n ? `is overdue in ${left / 1_000_000_000n} s, too soon` : `has been overdue since ${isoAt(v.overdue_at)}, too late`;
        stop(`the owner ${when} to send an approval the chain must refuse. Remove the checkIn step from ${OUT} and run again: the owner checks in again, then this goes out`);
      }
    },
  }),
  cancel: checkIn(["releasing"], true),
  earlyFinalize: refusal(["releasing"], {
    before: async (step, v) => {
      assertInWindow(v, "a finalize the chain must refuse");
      await assertSatchel(ESTATE);
    },
    after: async () => ({ satchelOwner: (await assertSatchel(ESTATE)).owner_id }),
  }),
  forgedRelease: refusal(["releasing"], {
    // near-sdk refuses a private call at any time; the evidence says it was refused during the waiting period.
    before: async (step, v) => assertInWindow(v, "a forged callback that lands during it"),
  }),
  finalize: {
    before: async (step) => {
      const v = await assertPhase(step, "releasing");
      const now = BigInt((await finalBlock()).header.timestamp_nanosec);
      if (now <= BigInt(v.release_at)) stop(`the waiting period ends at ${isoAt(v.release_at)}; the latest final block is at ${isoAt(now)}`);
      await assertSatchel(ESTATE);
      return {};
    },
    after: async (step, t) => {
      const sent = callsIn(t, ESTATE, TESTNET.contract);
      const transfer = sent.find((c) => c.method === "nft_transfer");
      if (sent.length !== 1 || !transfer) throw new Error(`the estate called ${JSON.stringify(sent)}`);
      if (canonical(transfer.args) !== canonical({ receiver_id: HEIR, token_id: run.tokenId }) || transfer.deposit !== "1" || !ok(transfer.status)) {
        throw new Error(`nft_transfer was ${JSON.stringify(transfer)}`);
      }
      const moved = eventsBy(t, TESTNET.contract).find((e) => e.standard === "nep171" && e.event === "nft_transfer")?.data?.[0];
      if (moved?.old_owner_id !== ESTATE || moved.new_owner_id !== HEIR || moved.token_ids?.join() !== run.tokenId) throw new Error(`the Satchel contract logged ${JSON.stringify(moved)}`);
      if (outcomeValue(t) !== true) throw new Error(`finalize_release resolved to ${JSON.stringify(outcomeValue(t))}, not true`);
      const events = estateEvents(t);
      if (canonical(events) !== canonical(["release_sent", "released"])) throw new Error(`the estate logged ${events.join(", ")}`);
      const v = await viewAfter({ phase: "released", transfer_in_flight: false });
      const owner = await nftToken(run.tokenId);
      if (owner?.owner_id !== HEIR) throw new Error(`satchel #${run.tokenId} is owned by ${owner?.owner_id}`);
      return { ran: await ranAt(t, ESTATE), view: snapshot(v), transferReceipt: transfer.receipt, satchelOwner: HEIR };
    },
  },
  lateSign: refusal(["released"], {
    before: async () => {
      const owner = await nftToken(run.tokenId);
      if (owner?.owner_id !== HEIR) stop(`satchel #${run.tokenId} is owned by ${owner?.owner_id}, not the heir`);
    },
    after: async () => {
      const record = await read("signing_record", () => view(TESTNET, TESTNET.contract, "signing_record", { token_id: run.tokenId }));
      if (record.version !== "0") throw new Error(`satchel #${run.tokenId}'s record is at version ${record.version}`);
      return { signingRecordVersion: record.version };
    },
  }),
};

// ---- Sending -----------------------------------------------------------------------------------

/** Marks `step` as sent before it is, so a run cut off mid-send reads it back instead of sending again. */
function pending(step, hash, context) {
  run.pending = { key: step.key, tx: hash, signer: step.signer, sentAt: new Date().toISOString(), step, context };
  save();
}

/** Signs with the near CLI (`display`), checks what it signed with `check`, then sends it. */
async function sendSigned(cli, step, context, cliArgs, check) {
  const signed = spawnSync(cli.bin, cliArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
  if (signed.error) stop(`Could not run the near CLI (${cli.bin}): ${signed.error.message}`);
  const base64 = signedFromOutput(`${signed.stdout}\n${signed.stderr}`);
  const decoded = decodeSignedActions(base64);
  check(decoded);
  pending(step, decoded.hash, context);
  try {
    await nearRpc(TESTNET, "send_tx", { signed_tx_base64: base64, wait_until: "NONE" });
    await finalOutcome(TESTNET, decoded.hash, step.signer);
  } catch (err) {
    throw new OutcomeUnknown(decoded.hash, err);
  }
  return decoded.hash;
}

async function send(cli, step, context) {
  if (step.key === "deploy") {
    return sendSigned(cli, step, context, deployCliArgs(TESTNET, ESTATE, context.wasm.path, step.args, step.gas), (d) => assertDeployAsAsked(d, step, context.wasm.codeHash));
  }
  if (step.key === "lock") {
    return sendSigned(cli, step, context, deleteKeyCliArgs(TESTNET, ESTATE, context.publicKey), (d) => assertDeleteKeyAsAsked(d, step, context.publicKey));
  }
  const tx = { receiverId: step.receiver, actions: [{ type: "FunctionCall", params: { methodName: step.method, args: step.args, gas: step.gas, deposit: step.deposit } }] };
  const { hash } = await signAndSend(cli, TESTNET, step.signer, tx, (decoded) => pending(step, decoded.hash, context));
  return hash;
}

/**
 * Reads a sent step back, checks it and records it. Its after-check reads are tried 3 times, 3 s
 * apart, for a node a block behind. A transaction that ended other than planned goes under
 * `failed`: one that failed, or for a step the estate must refuse, one that ran or failed with
 * another message. One that ended as planned but whose check didn't pass stays under `pending`,
 * with the check's error: it did what it did, so it is never sent again, and every later run reads
 * it back and checks it once more before anything else.
 */
async function record(step, hash, context) {
  const t = await txStatus(hash, step.signer);
  if (t === null) stop(`${hash} (${step.key}) is not known to ${nearRpcUrl(TESTNET)} or the archival node. Look it up on ${TESTNET.nearExplorer}/txns/${hash}; if it never landed, remove "pending" from ${OUT} and run again`);
  const failed = (message) => {
    run.failed = [...(run.failed ?? []), { key: step.key, tx: hash, signer: step.signer, error: message, at: new Date().toISOString() }];
    delete run.pending;
    save();
    stop(`${step.key} (${hash}): ${message}. Recorded under "failed" in ${OUT}; nothing more runs until someone has looked at it`);
  };
  if (t.transaction.signer_id !== step.signer || t.transaction.receiver_id !== step.receiver) failed(`signed by ${t.transaction.signer_id} for ${t.transaction.receiver_id}`);
  let error;
  if (step.refused) {
    if (ok(t.status)) failed(`ran, but the estate should have refused it with "${step.refused}"`);
    error = failureMessage(t.status.Failure);
    if (error !== step.refused) failed(`failed with "${error}", not "${step.refused}"`);
  } else if (!ok(t.status)) {
    failed(`ended ${JSON.stringify(t.status)}`);
  }
  let extra;
  for (let i = 1; ; i += 1) {
    try {
      extra = (await STEPS[step.key].after?.(step, t, context)) ?? {};
      break;
    } catch (err) {
      if (err instanceof Stop) throw err;
      if (i >= 3) {
        const message = err instanceof Error ? err.message : String(err);
        run.pending = { ...(run.pending ?? { key: step.key, tx: hash, signer: step.signer, step, context }), checkFailed: { error: message, at: new Date().toISOString() } };
        save();
        stop(
          `${step.key} (${hash}) ran on chain, but its check didn't pass: ${message}. It stays under "pending" in ${OUT}, so it is never sent again: run this again to read it back and check it once more. Remove "pending" only if ${TESTNET.nearExplorer}/txns/${hash} shows it changed nothing`,
        );
      }
      await wait(3_000);
    }
  }
  const { key, title, signer, receiver, method, actions, args, deposit, gas } = step;
  run.steps.push({
    key,
    step: title,
    tx: hash,
    signer,
    receiver,
    ...(actions ? { actions } : {}),
    ...(method ? { method } : {}),
    ...(args ? { args } : {}),
    ...(key === "deploy" ? { decodedArgs: args } : {}),
    deposit,
    ...(gas ? { gas } : {}),
    ...(await blockOf(t)),
    status: step.refused ? "failure" : "success",
    ...(step.refused ? { error } : {}),
    ...extra,
  });
  delete run.pending;
  save();
  console.log(`   ${step.refused ? `refused as planned ("${error}")` : "done"}: ${TESTNET.nearExplorer}/txns/${hash}`);
}

/**
 * A wait: the time comes from the estate's own view (overdue_at, or release_at while releasing),
 * plus 15 s, and the wait ends at the first final block past it. Up to 10 minutes are waited here;
 * a longer wait stops the run with the time to run it again.
 */
async function waitStep(step) {
  const v = step.key === "waitRelease" ? await assertPhase(step, "releasing") : await assertPhase(step, "alive", "overdue");
  const base = BigInt(step.key === "waitRelease" ? v.release_at : v.overdue_at);
  const until = base + LATE_MARGIN_NS;
  for (;;) {
    const { header } = await finalBlock();
    const now = BigInt(header.timestamp_nanosec);
    if (now > until) {
      run.steps.push({ key: step.key, step: step.title, waitedFor: step.key === "waitRelease" ? "release_at" : "overdue_at", target: base.toString(), until: isoAt(until), block: String(header.height), at: isoAt(now) });
      save();
      console.log(`   done: block ${header.height} at ${isoAt(now)}, past ${isoAt(base)}`);
      return;
    }
    const left = Number((until - now) / 1_000_000n);
    if (left > MAX_WAIT_MS) stop(`${step.key}: block time passes ${isoAt(until)} in ${Math.ceil(left / 60_000)} minutes. Run this again after then`);
    console.log(`   ${Math.ceil(left / 1_000)} s until ${isoAt(until)}`);
    await wait(Math.min(left + 1_000, 15_000));
  }
}

/** The heir's report on the satchel, read with the package as the web app and `satchel-nft verify` read it. */
async function reportStep(step) {
  const report = await read(`satchel #${run.tokenId}'s report`, () => buildReport(TESTNET, run.tokenId));
  if (report === null) stop(`satchel #${run.tokenId} has no report`);
  if (report.owner !== HEIR) stop(`satchel #${run.tokenId}'s report names ${report.owner} as its owner, not ${HEIR}`);
  if (report.verdict !== "clean") {
    stop(`satchel #${run.tokenId}'s report reads ${report.verdict}: ${report.checks.map((c) => `${c.id} ${c.status}`).join(", ")}. A node that didn't answer reads unknown: run this again`);
  }
  run.steps.push({
    key: step.key,
    step: step.title,
    tokenId: report.tokenId,
    owner: report.owner,
    address: report.address,
    recordVersion: report.recordVersion,
    verdict: report.verdict,
    checks: report.checks.map((c) => ({ id: c.id, status: c.status, title: c.title })),
    checkedAt: report.checkedAt,
  });
  save();
  console.log(`   done: PROVABLY CLEAN, owner ${report.owner}, record version ${report.recordVersion}`);
}

async function runSteps() {
  if (process.env.NEAR_RPC) {
    if (/mainnet/i.test(process.env.NEAR_RPC)) stop(`NEAR_RPC ${process.env.NEAR_RPC} looks like a mainnet node: this run is testnet only`);
    setNearRpc(process.env.NEAR_RPC);
  }
  const chain = await read("status", () => nearChainId(TESTNET));
  if (chain !== "testnet") stop(`the NEAR RPC serves ${chain}, not testnet`);
  if (run.failed?.length) {
    stop(`${OUT} lists a step that ended other than planned (${run.failed.map((f) => f.key).join(", ")}): look at it, then remove "failed" from the file, and the next run sends that step again after its checks`);
  }
  const home = join(homedir(), ".cargo", "bin", process.platform === "win32" ? "near.exe" : "near");
  const cli = { bin: resolveNearCli(process.env.NEAR_CLI ?? (existsSync(home) ? home : "near")), keychain: "legacy" };
  if (!run.nearCli) {
    const version = spawnSync(cli.bin, ["--version"], { encoding: "utf8" }).stdout?.trim();
    run.nearCli = `${version || cli.bin}, legacy keychain (~/.near-credentials)`;
  }
  if (run.pending) {
    const last = run.pending.checkFailed ? `; its check didn't pass last time: ${run.pending.checkFailed.error}` : "";
    console.log(`Reading back ${run.pending.key}, sent as ${run.pending.tx}${last}`);
    await record(run.pending.step, run.pending.tx, run.pending.context);
  }
  for (;;) {
    let step = nextStep(buildPlan(cfg, run), run);
    if (!step) {
      if (run.note !== COMPLETE) {
        run.note = COMPLETE;
        save();
      }
      console.log(`\nAll ${buildPlan(cfg, run).length} steps are in ${OUT}. Check them: node scripts/check-estate.mjs`);
      return;
    }
    console.log(`\n== ${step.key}: ${step.title}`);
    if (step.by === "wait") await waitStep(step);
    else if (step.by === "read") await reportStep(step);
    else {
      // Only the deploy and the lock are filled in by what their own checks read: the next id, the key.
      if (unresolved(step) && step.key !== "deploy" && step.key !== "lock") stop(`${step.key} still holds a <placeholder>: an earlier step's result is missing from ${OUT}`);
      const { live, context } = (await STEPS[step.key].before?.(step)) ?? {};
      if (live) step = buildPlan(cfg, run, live).find((s) => s.key === step.key);
      await assertSigner(step);
      try {
        await record(step, await send(cli, step, context ?? {}), context ?? {});
      } catch (err) {
        if (err instanceof OutcomeUnknown) stop(`${err.message}. Run this again: it reads ${err.hash} back before anything else, and sends nothing twice`);
        throw err;
      }
    }
    if (flags.one) return;
  }
}

// ---- The plan, printed -------------------------------------------------------------------------

function printPlan() {
  const plan = buildPlan(cfg, run);
  const line = (label, text) => console.log(`   ${label.padEnd(9)} ${text}`);
  console.log(`Estate run on NEAR testnet: ${plan.length} steps (${OUT}${existsSync(OUT) ? "" : ", not written yet"})`);
  console.log(`Estate ${ESTATE}: owner ${OWNER}; guardians ${cfg.guardians.join(", ")}, ${cfg.threshold} must approve; heir ${HEIR}`);
  console.log(`Check-in interval ${cfg.intervalMinutes} minutes, waiting period ${cfg.waitingMinutes} minutes; the satchel is on ${TESTNET.contract}, which the run does not change`);
  if (existsSync(WASM)) {
    const wasm = readFileSync(WASM);
    console.log(`Wasm ${WASM}: ${wasm.length} bytes, code hash ${codeHash(wasm)}, ${flags["ci-run"] ? `the CI's reproducible build from ${flags["ci-run"]}` : "built locally (not reproducible)"}`);
  } else {
    console.log(`Wasm ${WASM}: not built yet`);
  }
  console.log("Every signed step also checks first: the NEAR RPC serves testnet; the signer exists, has a key in the legacy keychain and");
  console.log(`holds the deposit + 0.1 NEAR; the step names no satchel from #1 to #${LAST_FROZEN} and nothing still unknown.\n`);
  console.log(`The estate's account is created first, with the faucet (10 testnet NEAR), by the controller:`);
  console.log(`   near account create-account sponsor-by-faucet-service ${ESTATE} autogenerate-new-keypair save-to-legacy-keychain network-config testnet create`);
  console.log("What each account spends, besides gas (a few thousandths of a NEAR per transaction):");
  console.log(`   ${ESTATE}: the code's storage (1 NEAR per 100 kB), and 1 yoctoNEAR for nft_transfer`);
  console.log(`   ${OWNER}: ${formatNear(AMOUNTS.mint)} for the mint, 1 yoctoNEAR with the refused sign_evm`);
  console.log(`   ${cfg.guardians.join(", ")}, ${HEIR}: gas only`);
  console.log(`Expected refusals: ${Object.values(REFUSED).map((m) => `"${m}"`).join(", ")}\n`);
  for (const [i, s] of plan.entries()) {
    const d = done(run, s.key);
    console.log(`${String(i + 1).padStart(2)}. ${s.key} [${d ? `done ${d.tx ?? d.at ?? ""}` : s.by === "wait" ? "wait" : s.by === "read" ? "read" : "to run"}]`);
    console.log(`   ${s.title}`);
    if (s.signer) line("signer", s.signer);
    if (s.receiver) line("receiver", s.receiver);
    if (s.actions) line("actions", s.actions.join(", "));
    if (s.method) line("method", s.method);
    if (s.publicKey) line("key", s.publicKey);
    if (s.args) line("args", JSON.stringify(s.args, null, 2).replace(/\n/g, "\n             "));
    if (s.deposit !== undefined) line("deposit", `${formatNear(s.deposit)} (${s.deposit} yoctoNEAR)`);
    if (s.gas) line("gas", `${BigInt(s.gas) / TGAS} TGas`);
    if (s.until) line("until", s.until);
    if (s.refused) line("refused", `the chain must refuse it: "${s.refused}"`);
    for (const c of s.checks ?? []) line("checks", c);
    for (const e of s.expects ?? []) line("expects", e);
    console.log("");
  }
}

try {
  setup();
  if (flags.run) await runSteps();
  else printPlan();
} catch (err) {
  console.error(err instanceof Stop ? err.message : err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exitCode = 1;
}
