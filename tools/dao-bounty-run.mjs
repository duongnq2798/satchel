// Runs the bounty-board DAO run on NEAR testnet and Sepolia, step by step (tools/dao-bounty.mjs
// builds the plan). With no flag it prints the plan, reading only --out and no chain: each step,
// who signs, the receiver, the method and its arguments decoded, the deposit, the gas, and what it
// checks first.
//
//   node tools/dao-bounty-run.mjs                 the plan; steps already in --out are marked done
//   node tools/dao-bounty-run.mjs --run           runs every pending step, in order, until one stops
//   node tools/dao-bounty-run.mjs --run --one     runs only the next pending step
//
// Testnet only: every account must end in .testnet, the NEAR RPC must say it serves testnet and
// the near CLI signs with network-config testnet. The near CLI (NEAR_CLI, or ~/.cargo/bin/near.exe,
// or near on PATH) signs every NEAR transaction from the legacy keychain (~/.near-credentials) with
// `display`; this script never reads a key. A function call is checked against what was asked with
// the package's near-cli.ts before it is sent, a transfer with decodeSignedTransfer.
//
// Before each step it reads what the step needs (accounts, balances, the DAO's policy and who it
// lets vote, the proposal's status, the satchel's owner, record and report, the Sepolia balance),
// and after it reads the transaction back with every receipt. Any difference stops the run.
// --out (default deployments/testnet-dao-bounty.json) gets each step as soon as it is read back,
// and a sent transaction's hash under `pending` before it is sent, so a run that stops can be run
// again: it reads that transaction back first. One that ran on chain stays under `pending` until its check
// passes, so it is never sent twice, and each step also refuses what an earlier run already did:
// the DAO exists, the treasury holds 2 NEAR or more, the DAO owns a satchel, an open proposal by
// the same signer asks the same, the signer has voted, the claim is in, the bounty is posted. A
// transaction that failed on chain goes under `failed` and stops every later run until someone has
// looked at it and removed `failed` from the file; the next run then sends that step again, after
// its checks.
//
// Flags: --dao-name, --council <a,b,c>, --contributor, --out, and --funding-tx <Sepolia hash>, the
// OWNER's funding transaction, which the fundSepolia step needs unless the satchel is #10, whose
// funding the OWNER sent before the run (RESERVED). Node 22 or later, after `npm ci` and
// `npm run build --prefix packages/satchel-nft`.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  AMOUNTS,
  CONTRIBUTOR_PATH,
  DAO_CODE,
  FROZEN,
  NEAR,
  PROPOSAL_LABELS,
  RESERVED,
  SEPOLIA,
  TRUSTED,
  assertTransferAsAsked,
  bountyDoneKind,
  bountyPolicy,
  buildPlan,
  canonical,
  citedBounty,
  contributorAddress,
  decodeSignedTransfer,
  done,
  expectedPolicy,
  formatNear,
  nextStep,
  oneVoteRoles,
  passesUnvoted,
  rolesAllowing,
  runConfig,
  sameRun,
  sendFees,
  sendGas,
  tokenIdsIn,
  transferCliArgs,
  unresolved,
  votesNeeded,
} from "./dao-bounty.mjs";

const {
  NEAR_ARCHIVAL_RPC,
  TESTNET,
  TGAS,
  buildReport,
  deriveMpcKey,
  finalOutcome,
  formatBalance,
  fromContractTx,
  maxCost,
  nearChainId,
  nonceClash,
  nearRpc,
  nearRpcUrl,
  outcomeValue,
  recoverSigner,
  satchel,
  setNearRpc,
  signEvmCalls,
  signatureFromReceipts,
  signingHash,
  sputnikDao,
  toContractTx,
  toEvmSignature,
  tokenAddress,
  verifiedClient,
  view,
  viewAccount,
} = await import("../packages/satchel-nft/dist/index.js");
const { OutcomeUnknown, resolveNearCli, signAndSend, signedFromOutput } = await import("../packages/satchel-nft/dist/near-cli.js");

const CLI_BIN = fileURLToPath(new URL("../packages/satchel-nft/bin/satchel-nft.js", import.meta.url));
const ACTION_VOTE = { VoteApprove: "Approve", VoteReject: "Reject" };
/** The steps a check of their own fills in before they are sent: the two reports of work done, and the Sepolia send. */
const LIVE = new Set(["done", "done2", "sendProposal"]);
/** A proposal is voted on only while this much of its period is left: clocks and blocks differ. */
const MARGIN_NS = 10n * 60n * 1_000_000_000n;
const GAS_ROOM = NEAR / 10n;

/** A refusal, printed with exit code 1. Thrown rather than process.exit, which can crash Node on Windows while sockets close. */
class Stop extends Error {}
const stop = (message) => {
  throw new Stop(message);
};

// The flags, the accounts and the evidence file, set by setup() inside the try at the bottom, so a
// wrong flag or file ends with a message, not a stack trace.
let flags;
let OUT;
let cfg;
let A;
let B;
let C;
let X;
let DAO;
let X_ADDRESS;
let run;

function setup() {
  ({ values: flags } = parseArgs({
    strict: true,
    options: {
      run: { type: "boolean" },
      one: { type: "boolean" },
      out: { type: "string" },
      "dao-name": { type: "string" },
      council: { type: "string" },
      contributor: { type: "string" },
      "funding-tx": { type: "string" },
    },
  }));
  OUT = flags.out ?? fileURLToPath(new URL("../deployments/testnet-dao-bounty.json", import.meta.url));
  cfg = runConfig({ daoName: flags["dao-name"], council: flags.council?.split(",").map((s) => s.trim()), contributor: flags.contributor });
  [A, B, C] = cfg.council;
  X = cfg.contributor;
  DAO = cfg.dao;
  X_ADDRESS = contributorAddress(X);
  run = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : fresh();
  if (!sameRun(run, cfg)) {
    stop(`${OUT} is the record of ${run.dao} (council ${run.council?.join(", ")}, contributor ${run.contributor}), not this run's: give another --out`);
  }
}

// ---- The evidence file -------------------------------------------------------------------------

function fresh() {
  return {
    network: "testnet",
    contract: TESTNET.contract,
    mpc: TESTNET.mpc,
    dao: DAO,
    daoFactory: cfg.factory,
    council: cfg.council,
    contributor: X,
    contributorAddress: X_ADDRESS,
    note: IN_PROGRESS,
    steps: [],
  };
}

const IN_PROGRESS = "Written by tools/dao-bounty-run.mjs as each step was read back; the run is not complete yet.";
/** The note once every step is in. */
const COMPLETE =
  "The near CLI signed every NEAR transaction from the legacy keychain, and tools/dao-bounty-run.mjs checked each one against what it asked for before sending it and read it back from the chain after. The near CLI's faucet service created the third council member and the contributor before the run (not recorded here). The OWNER funded the satchel's Sepolia address from another wallet, before the mint; satchel-nft dao finish, built from this repository, broadcast the send. The builder controls every account in this run, the council, the contributor and its trusted vote: it shows Sputnik DAO's flows working, not a community using them.";

/** Writes the file whole, through a temporary file, so a run cut off mid-write leaves the last one. */
function save() {
  const tmp = `${OUT}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(run, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2)}\n`);
  renameSync(tmp, OUT);
}

// ---- Reads -------------------------------------------------------------------------------------

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nowNs = () => BigInt(Date.now()) * 1_000_000n;

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

const dao = () => sputnikDao(TESTNET, DAO);
const daoView = (method, args = {}) => read(`${DAO}.${method}`, () => view(TESTNET, DAO, method, args));
const proposal = (id) => daoView("get_proposal", { id });

/**
 * A transaction with every receipt, once final, or null if no node knows it. Asked with wait_until
 * "NONE", as scripts/check-dao-bounty.mjs asks: with "FINAL", nearcore holds a request for a
 * transaction it doesn't know 30 s and answers HTTP 408, so one that never landed would read as a
 * busy node. The regular node drops a transaction after a day or two, so one it doesn't know is
 * asked of FastNEAR's archival node too, as `dao finish` does, unless NEAR_RPC names another node.
 * Unknown three times in a row, 3 s apart, is unknown: a transaction just sent can take a block to
 * show. A known one is asked again until it is final, for up to a minute.
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

async function blockOf(t) {
  const { header } = await read("block", () => nearRpc(TESTNET, "block", { block_id: t.transaction_outcome.block_hash }));
  return { block: String(header.height), at: new Date(Number(BigInt(header.timestamp_nanosec ?? header.timestamp) / 1_000_000n)).toISOString().replace(/\.\d+Z$/, "Z") };
}

const json = (base64) => JSON.parse(Buffer.from(base64, "base64").toString() || "null");

/** The NEAR transfers `from` made to `to` in a transaction's receipts, each with its receipt's outcome. */
function transfersIn(t, from, to) {
  const outcomes = new Map(t.receipts_outcome.map((o) => [o.id, o.outcome.status]));
  return (t.receipts ?? [])
    .filter((r) => r.predecessor_id === from && r.receiver_id === to)
    .flatMap((r) => (r.receipt.Action?.actions ?? []).filter((a) => a.Transfer).map((a) => ({ receipt: r.receipt_id, amount: a.Transfer.deposit, status: outcomes.get(r.receipt_id) })));
}

/** The function calls `from` made on `to` in a transaction's receipts, each with its receipt's outcome. */
function callsIn(t, from, to) {
  const outcomes = new Map(t.receipts_outcome.map((o) => [o.id, o.outcome.status]));
  return (t.receipts ?? [])
    .filter((r) => r.predecessor_id === from && r.receiver_id === to)
    .flatMap((r) =>
      (r.receipt.Action?.actions ?? [])
        .filter((a) => a.FunctionCall)
        .map((a) => ({ receipt: r.receipt_id, method: a.FunctionCall.method_name, args: a.FunctionCall.args, deposit: a.FunctionCall.deposit, gas: String(a.FunctionCall.gas), status: outcomes.get(r.receipt_id) })),
    );
}

const ok = (status) => typeof status === "object" && status !== null && "SuccessValue" in status;

const sepolia = () => verifiedClient(SEPOLIA);

/** What the evidence file keeps of a clean-transfer report: the verdict, each check's status and lines, and when it was read. */
const reportSummary = (r) => ({
  owner: r.owner,
  verdict: r.verdict,
  recordVersion: r.recordVersion,
  checks: r.checks.map((c) => ({ id: c.id, status: c.status, title: c.title, lines: c.lines })),
  checkedAt: r.checkedAt,
});

// ---- Checks every signed step makes ------------------------------------------------------------

function keyFile(id) {
  // The legacy keychain keeps <id>.json or a folder <id>/ of key files. Only the names are looked at.
  const base = join(homedir(), ".near-credentials", "testnet");
  return existsSync(join(base, `${id}.json`)) || existsSync(join(base, id));
}

async function assertSigner(step) {
  if (!step.signer.endsWith(".testnet") || !step.receiver.endsWith(".testnet")) stop(`${step.key}: ${step.signer} → ${step.receiver} is not testnet`);
  if (unresolved(step)) stop(`${step.key} still holds a <placeholder>: an earlier step's result is missing from ${OUT}`);
  const frozen = tokenIdsIn(step.args ?? {}).filter((id) => FROZEN.has(id));
  if (frozen.length > 0) stop(`${step.key} names satchel #${frozen.join(", #")}, a demo satchel the README quotes: nothing here acts on one`);
  const signer = await read(`view_account ${step.signer}`, () => account(step.signer));
  if (signer === null) stop(`${step.signer} does not exist on testnet`);
  if (!keyFile(step.signer)) stop(`The legacy keychain (~/.near-credentials/testnet) has no key for ${step.signer}`);
  const need = BigInt(step.deposit ?? 0) + GAS_ROOM;
  if (BigInt(signer.amount) < need) stop(`${step.signer} holds ${formatNear(signer.amount)} and ${step.key} needs ${formatNear(need)} with gas`);
}

async function assertOpen(id, signer) {
  const p = await proposal(id);
  if (p.status !== "InProgress") stop(`proposal ${id} is ${p.status}, not InProgress`);
  if (p.votes?.[signer] !== undefined) stop(`${signer} already voted ${p.votes[signer]} on proposal ${id}`);
  const { proposal_period } = await daoView("get_policy");
  if (BigInt(p.submission_time) + BigInt(proposal_period) < nowNs() + MARGIN_NS) stop(`proposal ${id}'s period ends within 10 minutes: file a new one`);
  return p;
}

// ---- Each step: what it reads before, and what it reads back after ------------------------------

const vote = (expected, more = {}) => ({
  before: async (step) => {
    const p = await assertOpen(step.args.id, step.signer);
    if (canonical(p.kind) !== canonical(step.args.proposal)) stop(`proposal ${step.args.id} is ${JSON.stringify(p.kind)}, not the kind it was filed with`);
    return (await more.before?.(step, p)) ?? {};
  },
  after: async (step, t, context) => {
    const p = await proposal(step.args.id);
    if (p.votes?.[step.signer] !== ACTION_VOTE[step.args.action]) throw new Error(`proposal ${step.args.id} records ${step.signer}'s vote as ${p.votes?.[step.signer]}`);
    if (p.status !== expected) throw new Error(`proposal ${step.args.id} is ${p.status} after the vote, not ${expected}`);
    return { proposalId: step.args.id, proposalStatus: p.status, votes: p.votes, ...((await more.after?.(step, t, context, p)) ?? {}) };
  },
});

/**
 * The id add_proposal returned, which must be the last id read before it, with the kind as filed.
 * Before, an open proposal by the same signer with the same kind stops the step: an earlier run
 * filed it. The send proposal's fees differ from one reading to the next, so for it nonceClash is
 * the check that counts.
 */
const filed = {
  before: async (step) => {
    const open = await read("open proposals", () => dao().openProposals());
    const same = open.find((p) => p.proposer === step.signer && canonical(p.kind) === canonical(step.args.proposal.kind));
    if (same) stop(`open proposal ${same.id}, by ${step.signer}, already asks this: an earlier run filed it, so ${step.key} doesn't file it again`);
    return { context: { lastProposalId: await daoView("get_last_proposal_id") } };
  },
  after: async (step, t, context) => {
    const id = outcomeValue(t);
    if (id !== context.lastProposalId) throw new Error(`add_proposal returned ${id}, not ${context.lastProposalId}`);
    const p = await proposal(id);
    if (canonical(p.kind) !== canonical(step.args.proposal.kind) || p.proposer !== step.signer || p.status !== "InProgress") {
      throw new Error(`proposal ${id} is ${p.status}, by ${p.proposer}: ${JSON.stringify(p.kind)}`);
    }
    return { proposalId: id };
  },
};

/**
 * Throws unless the DAO's policy is the one this point of the run expects (expectedPolicy): as
 * created, and with the contributor in "trusted" once the trust proposal has passed.
 */
async function assertDaoPolicy() {
  const policy = await daoView("get_policy");
  if (canonical(policy) !== canonical(expectedPolicy(cfg, run))) stop(`${DAO}'s policy is not the one this run expects here: ${JSON.stringify(policy)}`);
  return policy;
}

async function assertSatchelOwned(tokenId) {
  if (FROZEN.has(tokenId)) stop(`satchel #${tokenId} is a demo satchel the README quotes`);
  const s = await read(`satchel ${tokenId}`, () => satchel(TESTNET).get(tokenId));
  if (s?.owner_id !== DAO) stop(`satchel #${tokenId} is owned by ${s?.owner_id}, not ${DAO}`);
  if (s.listing !== null) stop(`satchel #${tokenId} is listed, and signing is frozen while it is`);
  return s;
}

/**
 * Satchel #N's signing record, read now, which must hold the one send this run broadcast and
 * nothing else: Sepolia max nonce 0, one signature, no approval, no unclassified call, no opaque
 * signature. scripts/check-dao-bounty.mjs reads the same at the gift's filing and its transfer.
 */
async function assertOneSend() {
  const record = await read("signing_record", () => view(TESTNET, TESTNET.contract, "signing_record", { token_id: run.tokenId }));
  const signed = record.evm.map((c) => `${c.chain_id}:${c.max_nonce}:${c.signatures}`).join(", ");
  if (signed !== `${SEPOLIA}:0:1` || record.approvals.length > 0 || record.opaque_signatures || record.unclassified_calls || record.approvals_not_itemized) {
    stop(`satchel #${run.tokenId}'s record is ${JSON.stringify(record)}: not the one send this run signed`);
  }
  return record;
}

/**
 * The gift's votes: satchel #N is still the DAO's, unlisted, and its record is still the one the
 * proposal was filed with, so nothing was signed since its report read PROVABLY CLEAN.
 */
async function assertGiftUnchanged() {
  await assertSatchelOwned(run.tokenId);
  const record = await assertOneSend();
  const filedWith = done(run, "giveProposal").recordBefore;
  if (canonical(record) !== canonical(filedWith)) stop(`satchel #${run.tokenId}'s record is ${JSON.stringify(record)}, not ${JSON.stringify(filedWith)} as when the gift was filed`);
  return {};
}

/** The id of the bounty the vote recorded under `voteKey` posted. */
const postedId = (voteKey) => done(run, voteKey).bountyId;

/** An AddBounty proposal, filed only when the DAO has exactly `expected` bounties: this run's next. */
const addBountyStep = (expected) => ({
  before: async (step) => {
    const policy = await assertDaoPolicy();
    if (step.deposit !== policy.proposal_bond) stop(`the proposal bond is ${policy.proposal_bond}`);
    const want = expected();
    const lastBountyId = await daoView("get_last_bounty_id");
    if (lastBountyId !== want) stop(`${DAO} has ${lastBountyId} bounties, not ${want}: this step posts bounty ${want}`);
    return filed.before(step);
  },
  after: filed.after,
});

/** The vote that passes an AddBounty proposal: get_last_bounty_id goes up by one, to the bounty as filed. */
const postVote = () =>
  vote("Approved", {
    before: async () => ({ context: { lastBountyId: await daoView("get_last_bounty_id") } }),
    after: async (step, t, context) => {
      const id = context.lastBountyId;
      if ((await daoView("get_last_bounty_id")) !== id + 1) throw new Error("the vote posted no bounty");
      const { id: _, ...posted } = await daoView("get_bounty", { id });
      if (canonical(posted) !== canonical(step.args.proposal.AddBounty.bounty)) throw new Error(`bounty ${id} is ${JSON.stringify(posted)}`);
      return { bountyId: id };
    },
  });

/** `bounty_claim` on the bounty posted by `voteKey`'s vote. */
const claimStep = (voteKey) => ({
  before: async (step) => {
    const id = postedId(voteKey);
    const [b, claims, count, policy] = await Promise.all([
      daoView("get_bounty", { id }),
      daoView("get_bounty_claims", { account_id: X }),
      daoView("get_bounty_number_of_claims", { id }),
      daoView("get_policy"),
    ]);
    if (claims.some((c) => c.bounty_id === id)) stop(`${X} already claimed bounty ${id}`);
    if (b.times < 1) stop(`bounty ${id} has times ${b.times}: it is paid out`);
    if (count >= b.times) {
      // bounty_claim checks no permission, only the bond: any account may claim a posted bounty.
      stop(
        `bounty ${id} already has ${count} claim${count === 1 ? "" : "s"} of ${b.times}, none of them ${X}'s: another account claimed it first, and its claim holds the slot until its deadline (at most ${Number(BigInt(b.max_deadline) / 3_600_000_000_000n)} h) passes. Then anyone can free it with bounty_done({ id: ${id}, account_id: <the claimer> }), and this step can run again`,
      );
    }
    if (step.deposit !== policy.bounty_bond) stop(`the bounty bond is ${policy.bounty_bond}, not ${step.deposit}`);
    if (BigInt(step.args.deadline) > BigInt(b.max_deadline)) stop(`the deadline passes the bounty's max_deadline ${b.max_deadline}`);
    return {};
  },
  after: async (step) => {
    const claim = (await daoView("get_bounty_claims", { account_id: X })).find((c) => c.bounty_id === step.args.id);
    if (!claim || claim.completed) throw new Error(`${X}'s claims are ${JSON.stringify(claim)}`);
    return { bountyId: step.args.id, claim };
  },
});

/**
 * `bounty_done` on the claim of the bounty `voteKey` posted. `work(id, policy)` does the bounty's
 * work, read only, and returns the description the BountyDone proposal quotes; the plan step `key`
 * is rebuilt with it before it is signed.
 */
const doneStep = (key, voteKey, work) => ({
  before: async () => {
    const id = postedId(voteKey);
    const claim = (await daoView("get_bounty_claims", { account_id: X })).find((c) => c.bounty_id === id);
    if (!claim || claim.completed) stop(`${X} has no open claim on bounty ${id}: ${JSON.stringify(claim)}`);
    if (BigInt(claim.start_time) + BigInt(claim.deadline) < nowNs() + MARGIN_NS) stop(`${X}'s claim on bounty ${id} is past its deadline: bounty_done would only drop it`);
    const policy = await daoView("get_policy");
    if (rolesAllowing(policy, X, "bounty_done", "AddProposal").length === 0) stop(`the policy doesn't let ${X} file a bounty_done proposal`);
    return {
      live: { [`${key}Description`]: await work(id, policy) },
      context: { lastProposalId: await daoView("get_last_proposal_id") },
    };
  },
  after: async (step, t, context) => {
    const id = context.lastProposalId;
    const p = await proposal(id);
    if (canonical(p.kind) !== canonical(bountyDoneKind(step.args.id, X)) || p.proposer !== X || p.status !== "InProgress") {
      throw new Error(`proposal ${id} is ${p.status}, by ${p.proposer}: ${JSON.stringify(p.kind)}`);
    }
    const claim = (await daoView("get_bounty_claims", { account_id: X })).find((c) => c.bounty_id === step.args.id);
    if (!claim?.completed) throw new Error(`${X}'s claim reads ${JSON.stringify(claim)}`);
    return { proposalId: id, bountyId: step.args.id, kind: p.kind };
  },
});

/**
 * The vote that passes a BountyDone proposal and pays `amount` of the bounty `voteKey` posted. The
 * roles the vote counts in (rolesAllowing, as act_proposal finds them) are recorded with it, so the
 * file says who approved each payout and in which role. `more.before` adds the tier's own checks.
 */
const payoutVote = (voteKey, amount, more) =>
  vote("Approved", {
    before: async (step, p) => {
      const policy = await assertDaoPolicy();
      const available = await daoView("get_available_amount");
      if (BigInt(available) < amount) stop(`${DAO} has ${formatNear(available)} free, less than the bounty`);
      if (p.kind.BountyDone?.receiver_id !== X || p.kind.BountyDone.bounty_id !== postedId(voteKey)) stop(`proposal ${step.args.id} is ${JSON.stringify(p.kind)}`);
      const roles = rolesAllowing(policy, step.signer, "bounty_done", "VoteApprove");
      more.before(step, p, policy, roles);
      return { context: { approvedIn: roles } };
    },
    after: async (step, t, context, p) => {
      const sent = transfersIn(t, DAO, X);
      const payout = sent.find((s) => BigInt(s.amount) === amount);
      const bond = sent.find((s) => BigInt(s.amount) === AMOUNTS.bountyBond);
      if (!payout || !ok(payout.status)) throw new Error(`no successful ${formatNear(amount)} transfer to ${X}: ${JSON.stringify(sent)}`);
      if (!bond || !ok(bond.status)) throw new Error(`the bond did not come back to ${X}: ${JSON.stringify(sent)}`);
      if (Object.keys(p.votes ?? {}).length !== 1) throw new Error(`proposal ${step.args.id} has votes ${JSON.stringify(p.votes)}: one vote should have passed it`);
      const id = postedId(voteKey);
      const [b, claims] = await Promise.all([daoView("get_bounty", { id }), daoView("get_bounty_claims", { account_id: X })]);
      if (b.times !== 0 || claims.some((c) => c.bounty_id === id)) throw new Error(`bounty ${id} has times ${b.times}; ${X}'s claims ${JSON.stringify(claims)}`);
      return { bountyId: id, approvedBy: step.signer, approvedIn: context.approvedIn, payout: { receipt: payout.receipt, amount: payout.amount }, bondReturn: { receipt: bond.receipt, amount: bond.amount } };
    },
  });

const STEPS = {
  create: {
    before: async () => {
      if (await account(DAO)) stop(`${DAO} already exists, so this run doesn't create it. An earlier run's create transaction stays under "pending" in ${OUT} until it is read back; to start over, give another --dao-name and --out`);
      const [hash, metadata] = await Promise.all([
        read("get_default_code_hash", () => view(TESTNET, cfg.factory, "get_default_code_hash")),
        read("get_contracts_metadata", () => view(TESTNET, cfg.factory, "get_contracts_metadata")),
      ]);
      const meta = metadata.find(([h]) => h === hash)?.[1];
      if (hash !== DAO_CODE.codeHash || JSON.stringify(meta?.version) !== JSON.stringify(DAO_CODE.metadataVersion) || meta.commit_id !== DAO_CODE.commit) {
        stop(`${cfg.factory} now deploys ${hash} (${JSON.stringify(meta)}), not ${DAO_CODE.codeHash}: check the new code before using it`);
      }
      for (const id of [...cfg.council, X]) {
        if ((await account(id)) === null) stop(`${id} does not exist yet. The OWNER creates it: near account create-account sponsor-by-faucet-service ${id} autogenerate-new-keypair save-to-legacy-keychain network-config testnet create`);
        if (!keyFile(id)) stop(`The legacy keychain has no key for ${id}`);
      }
      const a = await account(A);
      if (BigInt(a.amount) < AMOUNTS.daoDeposit + 2n * GAS_ROOM) stop(`${A} holds ${formatNear(a.amount)}: the DAO, the mint and gas need 6.2 NEAR`);
      // No kind may pass with no votes, with "trusted" empty as created or once the contributor is in it.
      for (const policy of [bountyPolicy(cfg.council, [X]), bountyPolicy(cfg.council, [X], [X])]) {
        const unvoted = PROPOSAL_LABELS.filter((l) => passesUnvoted(policy, l).length > 0);
        if (unvoted.length > 0) stop(`the policy would let a council member finalize ${unvoted.join(", ")} with no votes`);
      }
      return {};
    },
    after: async (step, t) => {
      const created = t.receipts_outcome.some((o) => o.outcome.executor_id === cfg.factory && ok(o.outcome.status) && json(o.outcome.status.SuccessValue) === true);
      if (!created) throw new Error(`${cfg.factory}'s on_create did not return true: the DAO wasn't created, and the factory refunds the deposit`);
      const acct = await account(DAO);
      if (acct?.code_hash !== DAO_CODE.codeHash) throw new Error(`${DAO} runs ${acct?.code_hash}`);
      const [version, policy, config] = await Promise.all([daoView("version"), daoView("get_policy"), daoView("get_config")]);
      if (version !== DAO_CODE.version) throw new Error(`version() is ${version}`);
      if (canonical(policy) !== canonical(step.decodedArgs.policy)) throw new Error(`get_policy is ${JSON.stringify(policy)}`);
      if (config.name !== cfg.daoName) throw new Error(`get_config's name is ${config.name}`);
      run.daoVersion = `${version}, as the DAO's version() view returns it. The factory's get_contracts_metadata lists the DAO's code hash ${DAO_CODE.codeHash} as version [3,31], commit 7764926`;
      return { storageUsage: acct.storage_usage, balance: acct.amount };
    },
  },
  treasury: {
    before: async () => {
      await assertDaoPolicy();
      // satchel-club, created the same way with 6 NEAR, had 0.587 NEAR free after its storage.
      const availableBefore = await daoView("get_available_amount");
      if (BigInt(availableBefore) >= AMOUNTS.treasury) stop(`${DAO} already has ${formatNear(availableBefore)} free, at least the 2 NEAR this step sends: the treasury was funded, so this run doesn't send again`);
      return { context: { availableBefore } };
    },
    after: async () => {
      const available = await daoView("get_available_amount");
      if (BigInt(available) < AMOUNTS.bounty + AMOUNTS.smallBounty + 2n * GAS_ROOM) throw new Error(`get_available_amount is ${formatNear(available)} after the transfer`);
      return { availableAfter: available };
    },
  },
  mint: {
    before: async () => {
      const owned = await read(`nft_tokens_for_owner ${DAO}`, () => satchel(TESTNET).tokensFor(DAO));
      if (owned.length > 0) stop(`${DAO} already owns satchel #${owned.map((t) => t.token_id).join(", #")}: an earlier run minted it, so this one doesn't mint another`);
      const supply = await read("nft_total_supply", () => satchel(TESTNET).totalSupply());
      const expected = String(supply + 1);
      if (FROZEN.has(expected)) stop(`the next satchel would be #${expected}, a demo satchel`);
      if (expected !== RESERVED.tokenId) {
        stop(`the next satchel would be #${expected}, not #${RESERVED.tokenId}, the one whose Sepolia address ${RESERVED.address} the OWNER funded for this run: someone else minted #${RESERVED.tokenId}. Ask the OWNER before going on with another satchel`);
      }
      return { context: { expected } };
    },
    after: async (step, t, context) => {
      // The id the mint returned is the run's satchel, even if someone minted between the read and
      // the mint: the transaction ran, so a check that refused it would leave it pending for good.
      const token = outcomeValue(t);
      if (typeof token?.token_id !== "string" || FROZEN.has(token.token_id)) throw new Error(`the mint returned ${JSON.stringify(token)}`);
      if (token.token_id !== context.expected) {
        console.log(`   the mint returned #${token.token_id}, not #${context.expected}: someone minted in between. The run goes on with #${token.token_id}, whose Sepolia address the OWNER has not funded`);
      }
      const owner = await read("nft_token", () => view(TESTNET, TESTNET.contract, "nft_token", { token_id: token.token_id }));
      if (owner?.owner_id !== DAO) throw new Error(`satchel #${token.token_id} is owned by ${owner?.owner_id}`);
      const path = `satchel/${token.token_id}`;
      const key = await read("derived_public_key", () => view(TESTNET, TESTNET.mpc, "derived_public_key", { path, predecessor: TESTNET.contract, domain_id: 0 }));
      if (key !== deriveMpcKey(TESTNET.mpcRootKey, TESTNET.contract, path)) throw new Error(`${TESTNET.mpc} derives ${key} for ${path}, not the key derived here`);
      run.tokenId = token.token_id;
      run.address = await tokenAddress(TESTNET, path);
      if (run.tokenId === RESERVED.tokenId) {
        if (run.address.toLowerCase() !== RESERVED.address.toLowerCase()) throw new Error(`satchel #${run.tokenId}'s address is ${run.address}, not ${RESERVED.address}`);
      } else {
        console.log(`\nOWNER: satchel #${run.tokenId}'s Sepolia address is ${run.address}. Fund it with about 0.01 Sepolia ETH; the run stops at fundSepolia until it is given --funding-tx <the funding transaction's hash>.`);
      }
      return { tokenId: token.token_id, address: run.address };
    },
  },
  addBounty: addBountyStep(() => 0),
  addBountyVote1: vote("InProgress"),
  addBountyVote2: postVote(),
  claim: claimStep("addBountyVote2"),
  done: doneStep("done", "addBountyVote2", async (id) => {
    // The work the bounty asks for: the report, read only, from this repository's package.
    const report = await read(`satchel #${run.tokenId}'s report`, () => buildReport(TESTNET, run.tokenId));
    if (report === null) stop(`satchel #${run.tokenId} has no report`);
    return `Bounty ${id} done: satchel #${run.tokenId}'s clean-transfer report reads ${report.verdict} (satchel-nft buildReport, ${new Date().toISOString().slice(0, 16)}Z)`;
  }),
  doneVote: payoutVote("addBountyVote2", AMOUNTS.bounty, {
    // Mid-size: one council vote, for a contributor the council doesn't trust yet.
    before: (step, p, policy, roles) => {
      if (votesNeeded(policy, "council", "bounty_done") !== 1n) stop("the policy no longer passes a bounty_done proposal with one council vote");
      if (canonical(roles) !== canonical(["council"])) stop(`${step.signer}'s vote would count in ${roles.join(", ") || "no role"}, not the council`);
      if (rolesAllowing(policy, X, "bounty_done", "VoteApprove").length > 0) stop(`${X} may already vote on a bounty_done: this step is the council's`);
    },
  }),
  trustProposal: {
    before: async (step) => {
      const policy = await assertDaoPolicy();
      if (step.deposit !== policy.proposal_bond) stop(`the proposal bond is ${policy.proposal_bond}`);
      // The description is the citation; the bounty it cites must be finished and paid to X.
      const id = postedId("addBountyVote2");
      const paidBy = done(run, "doneVote").proposalId;
      const cited = citedBounty(step.args.proposal.description);
      if (cited?.bountyId !== id || cited.proposalId !== paidBy) stop(`the description cites ${JSON.stringify(cited)}, not bounty ${id} and proposal ${paidBy}`);
      const [p, b] = await Promise.all([proposal(paidBy), daoView("get_bounty", { id })]);
      if (p.status !== "Approved" || canonical(p.kind) !== canonical(bountyDoneKind(id, X))) stop(`proposal ${paidBy} is ${p.status}: ${JSON.stringify(p.kind)}`);
      if (b.times !== 0) stop(`bounty ${id} has times ${b.times} left: it isn't finished`);
      return filed.before(step);
    },
    after: filed.after,
  },
  trustVote1: vote("InProgress", {
    after: async () => {
      const { roles } = await daoView("get_policy");
      const trusted = roles.find((r) => r.name === TRUSTED);
      if (trusted?.kind?.Group?.length !== 0) throw new Error(`"${TRUSTED}" is ${JSON.stringify(trusted?.kind)} after one vote`);
    },
  }),
  trustVote2: vote("Approved", {
    after: async () => {
      // AddMemberToRole runs inside the vote. Sputnik logs ERR_ROLE_NOT_FOUND and still reads
      // Approved if the role is missing, so the policy itself is the check.
      const policy = await daoView("get_policy");
      if (canonical(policy) !== canonical(bountyPolicy(cfg.council, [X], [X]))) throw new Error(`get_policy after the vote is ${JSON.stringify(policy)}`);
      return { trustedAfter: policy.roles.find((r) => r.name === TRUSTED).kind.Group };
    },
  }),
  addBounty2: addBountyStep(() => postedId("addBountyVote2") + 1),
  addBounty2Vote1: vote("InProgress"),
  addBounty2Vote2: postVote(),
  claim2: claimStep("addBounty2Vote2"),
  done2: doneStep("done2", "addBounty2Vote2", async (id, policy) => {
    // The work the bounty asks for: the DAO's policy, read back.
    const roles = oneVoteRoles(policy, "bounty_done");
    const names = roles.map((r) => r.name);
    if (!names.includes("council") || !names.includes(TRUSTED)) stop(`get_policy lets one vote pass a bounty_done in ${names.join(", ") || "no role"}`);
    const large = votesNeeded(policy, "council", "transfer");
    const council = policy.roles.find((r) => r.name === "council").kind.Group.length;
    return `Bounty ${id} done: get_policy lets one vote pass a bounty_done in ${roles.map((r) => `${r.name} (${r.kind.Group.join(", ")})`).join(" and ")}; a transfer, a call or a new bounty needs ${large} of the council's ${council} (read ${new Date().toISOString().slice(0, 16)}Z)`;
  }),
  done2Vote: payoutVote("addBounty2Vote2", AMOUNTS.smallBounty, {
    // Small: the trusted contributor's own vote, and no council vote.
    before: (step, p, policy, roles) => {
      if (step.signer !== X || policy.roles.find((r) => r.name === "council").kind.Group.includes(X)) stop(`${step.signer} is not the contributor, or is on the council`);
      if (canonical(roles) !== canonical([TRUSTED])) stop(`${X}'s vote would count in ${roles.join(", ") || "no role"}, not "${TRUSTED}" alone`);
      if (votesNeeded(policy, TRUSTED, "bounty_done") !== 1n) stop(`"${TRUSTED}" no longer passes a bounty_done with one vote`);
      if (Object.keys(p.votes ?? {}).length > 0) stop(`proposal ${step.args.id} already has votes ${JSON.stringify(p.votes)}`);
    },
  }),
  sendProposal: {
    before: async (step) => {
      await assertSatchelOwned(run.tokenId);
      const key = await read("derived_public_key", () => view(TESTNET, TESTNET.mpc, "derived_public_key", { path: CONTRIBUTOR_PATH, predecessor: X, domain_id: 0 }));
      if (key !== X_ADDRESS.publicKey) stop(`${TESTNET.mpc} derives ${key} for ${X} at ${CONTRIBUTOR_PATH}, not ${X_ADDRESS.publicKey}`);
      const c = await sepolia();
      const from = run.address;
      const [latest, pending, block, priority, balance] = await Promise.all([
        c.getTransactionCount({ address: from, blockTag: "latest" }),
        c.getTransactionCount({ address: from, blockTag: "pending" }),
        c.getBlock({ blockTag: "latest" }),
        c.estimateMaxPriorityFeePerGas(),
        c.getBalance({ address: from }),
      ]);
      if (latest !== 0 || pending !== 0) stop(`${from} has sent ${latest} (pending ${pending}) transactions on Sepolia: this run signs nonce 0`);
      // Estimated from the satchel's own address, which the OWNER funded, as tools/lib.mjs does:
      // Sepolia charges about 207k gas to send to an address never used.
      const estimate = await c.estimateGas({ account: from, to: X_ADDRESS.address, value: AMOUNTS.send, data: "0x" });
      const tx = { chainId: SEPOLIA, nonce: 0, ...sendFees(block.baseFeePerGas ?? 0n, priority), gas: sendGas(estimate), to: X_ADDRESS.address, value: AMOUNTS.send, data: "0x" };
      if (balance < maxCost(tx)) stop(`${from} holds ${formatBalance(balance)} Sepolia ETH and the send can cost ${formatBalance(maxCost(tx))}: fund it`);
      const contractTx = toContractTx(tx);
      const onChain = await read("evm_signing_hash", () => satchel(TESTNET).signingHash(contractTx));
      if (`0x${onChain}` !== signingHash(tx)) stop(`the contract hashes the send to 0x${onChain}, viem to ${signingHash(tx)}`);
      const clash = nonceClash(TESTNET, await read("open proposals", () => dao().openProposals()), run.tokenId, String(SEPOLIA), "0");
      if (clash) stop(`open proposal ${clash.id} already signs nonce 0 for satchel #${run.tokenId}`);
      const policy = await assertDaoPolicy();
      if (step.deposit !== policy.proposal_bond) stop(`the proposal bond is ${policy.proposal_bond}`);
      return { live: { sendTx: contractTx }, ...(await filed.before(step)) };
    },
    after: async (step, t, context) => ({ ...(await filed.after(step, t, context)), contractTx: JSON.parse(Buffer.from(step.args.proposal.kind.FunctionCall.actions[0].args, "base64").toString()).tx }),
  },
  sendVote1: vote("InProgress", {
    before: () => assertSatchelOwned(run.tokenId).then(() => ({})),
    after: async (step, t) => {
      if (signEvmCalls(TESTNET, t).length !== 0) throw new Error("the first vote ran sign_evm");
    },
  }),
  sendVote2: vote("Approved", {
    before: () => assertSatchelOwned(run.tokenId).then(() => ({})),
    after: async (step, t) => {
      const calls = signEvmCalls(TESTNET, t);
      const filedTx = done(run, "sendProposal").contractTx;
      if (calls.length !== 1 || calls[0].caller !== DAO || calls[0].tokenId !== run.tokenId || canonical(calls[0].tx) !== canonical(filedTx)) {
        throw new Error(`the vote made ${JSON.stringify(calls)}`);
      }
      if (!ok(calls[0].status) && typeof calls[0].status === "object" && calls[0].status?.Failure) throw new Error(`sign_evm failed: ${JSON.stringify(calls[0].status)}`);
      const signature = signatureFromReceipts(TESTNET, t);
      if (signature === null) throw new Error(`no MPC signature in the vote's receipts`);
      const tx = fromContractTx(filedTx);
      const recovered = await recoverSigner(tx, toEvmSignature(signature));
      if (recovered.toLowerCase() !== run.address.toLowerCase()) throw new Error(`the signature recovers to ${recovered}, not ${run.address}`);
      const record = await read("signing_record", () => view(TESTNET, TESTNET.contract, "signing_record", { token_id: run.tokenId }));
      return { signingHash: signingHash(tx), recovered, signingRecordAfter: { evm: record.evm, opaque_signatures: record.opaque_signatures, version: record.version } };
    },
  }),
  rejectProposal: filed,
  rejectApprove: vote("InProgress", {
    before: async () => {
      const policy = await daoView("get_policy");
      if (votesNeeded(policy, "council", "transfer") !== 2n) stop("the policy no longer needs 2 votes for a transfer");
      return {};
    },
  }),
  reject1: vote("InProgress"),
  reject2: vote("Rejected", {
    after: async (step, t) => {
      const paid = transfersIn(t, DAO, X).filter((s) => BigInt(s.amount) > 0n);
      if (paid.length > 0) throw new Error(`the vote moved NEAR to ${X}: ${JSON.stringify(paid)}`);
    },
  }),
  giveProposal: {
    before: async (step) => {
      await assertSatchelOwned(run.tokenId);
      const policy = await assertDaoPolicy();
      if (step.deposit !== policy.proposal_bond) stop(`the proposal bond is ${policy.proposal_bond}`);
      // Everything the satchel ever signed is the one send this run broadcast, at Sepolia nonce 0.
      const record = await assertOneSend();
      const sent = done(run, "finish").sepolia;
      if (sent.nonce !== "0" || sent.from !== run.address.toLowerCase()) stop(`the send recorded under finish is ${JSON.stringify(sent)}`);
      // PROVABLY CLEAN: the finalized Sepolia nonce of the satchel's address is past the record's 0.
      const report = await read(`satchel #${run.tokenId}'s report`, () => buildReport(TESTNET, run.tokenId));
      if (report === null) stop(`satchel #${run.tokenId} has no report`);
      if (report.verdict !== "clean") {
        const lines = report.checks.filter((c) => c.status !== "pass").flatMap((c) => c.lines);
        stop(`satchel #${run.tokenId}'s report doesn't read PROVABLY CLEAN yet (${report.verdict}: ${lines.join("; ")}). Sepolia finalizes about 13 minutes after the send ${sent.tx}: run this again then`);
      }
      const f = await filed.before(step);
      return { context: { ...f.context, reportBefore: reportSummary(report), recordBefore: record } };
    },
    after: async (step, t, context) => ({ ...(await filed.after(step, t, context)), reportBefore: context.reportBefore, recordBefore: context.recordBefore }),
  },
  giveVote1: vote("InProgress", {
    before: assertGiftUnchanged,
    after: async (step, t) => {
      if (callsIn(t, DAO, TESTNET.contract).length !== 0) throw new Error("the first vote called the contract");
    },
  }),
  giveVote2: vote("Approved", {
    before: assertGiftUnchanged,
    after: async (step, t) => {
      const [filedCall] = done(run, "giveProposal").args.proposal.kind.FunctionCall.actions;
      const calls = callsIn(t, DAO, TESTNET.contract);
      if (calls.length !== 1 || calls[0].method !== "nft_transfer" || calls[0].args !== filedCall.args || calls[0].deposit !== filedCall.deposit || !ok(calls[0].status)) {
        throw new Error(`the vote made ${JSON.stringify(calls)}`);
      }
      const owner = await read("nft_token", () => view(TESTNET, TESTNET.contract, "nft_token", { token_id: run.tokenId }));
      if (owner?.owner_id !== X) throw new Error(`satchel #${run.tokenId} is owned by ${owner?.owner_id}`);
      // The new owner's report, as anyone would read it now.
      const report = await read(`satchel #${run.tokenId}'s report`, () => buildReport(TESTNET, run.tokenId));
      if (report?.owner !== X) throw new Error(`the report reads owner ${report?.owner}`);
      return { ownerAfter: X, nftTransfer: { receipt: calls[0].receipt }, reportAfter: reportSummary(report) };
    },
  }),
};

// ---- Sending -----------------------------------------------------------------------------------

/** Marks `step` as sent before it is, so a run cut off mid-send reads it back instead of sending again. */
function pending(step, hash, context) {
  run.pending = { key: step.key, tx: hash, signer: step.signer, sentAt: new Date().toISOString(), step, context };
  save();
}

async function send(cli, step, context) {
  if (step.action === "Transfer") {
    const signed = spawnSync(cli.bin, transferCliArgs(TESTNET, step.signer, step.receiver, step.deposit), { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 });
    if (signed.error) stop(`Could not run the near CLI (${cli.bin}): ${signed.error.message}`);
    const base64 = signedFromOutput(`${signed.stdout}\n${signed.stderr}`);
    const decoded = decodeSignedTransfer(base64);
    assertTransferAsAsked(decoded, step.signer, step.receiver, step.deposit);
    pending(step, decoded.hash, context);
    try {
      await nearRpc(TESTNET, "send_tx", { signed_tx_base64: base64, wait_until: "NONE" });
      await finalOutcome(TESTNET, decoded.hash, step.signer);
    } catch (err) {
      throw new OutcomeUnknown(decoded.hash, err);
    }
    return decoded.hash;
  }
  const tx = { receiverId: step.receiver, actions: [{ type: "FunctionCall", params: { methodName: step.method, args: step.args, gas: step.gas, deposit: step.deposit } }] };
  const { hash } = await signAndSend(cli, TESTNET, step.signer, tx, (decoded) => pending(step, decoded.hash, context));
  return hash;
}

/**
 * Reads a sent step back, checks it and records it. Its after-check reads are tried 3 times, 3 s
 * apart, for a node a block behind. A transaction that failed on chain goes under `failed`. One
 * that ran but whose check didn't pass stays under `pending`, with the check's error: it did
 * something, so it is never sent again, and every later run reads it back and checks it once more
 * before anything else.
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
  if (!ok(t.status)) failed(`ended ${JSON.stringify(t.status)}`);
  let extra;
  for (let i = 1; ; i += 1) {
    try {
      extra = (await STEPS[step.key].after?.(step, t, context)) ?? {};
      break;
    } catch (err) {
      if (err instanceof Stop) throw err;
      if (i >= 3) {
        const error = err instanceof Error ? err.message : String(err);
        run.pending = { ...(run.pending ?? { key: step.key, tx: hash, signer: step.signer, step, context }), checkFailed: { error, at: new Date().toISOString() } };
        save();
        stop(
          `${step.key} (${hash}) ran on chain, but its check didn't pass: ${error}. It stays under "pending" in ${OUT}, so it is never sent again: run this again to read it back and check it once more. Remove "pending" only if ${TESTNET.nearExplorer}/txns/${hash} shows it changed nothing`,
        );
      }
      await wait(3_000);
    }
  }
  const { key, title, signer, receiver, method, action, args, decodedArgs, deposit, gas } = step;
  // `sentAt` is this machine's clock as it sent the transaction, the clock a report's checkedAt is
  // read on; `at` is the time of the block it landed in.
  const sentAt = run.pending?.tx === hash ? run.pending.sentAt : undefined;
  run.steps.push({
    key,
    step: title,
    tx: hash,
    signer,
    receiver,
    ...(method ? { method, args } : { action }),
    ...(decodedArgs ? { decodedArgs } : {}),
    deposit,
    ...(gas ? { gas } : {}),
    ...(sentAt ? { sentAt } : {}),
    ...(await blockOf(t)),
    status: "success",
    ...extra,
  });
  delete run.pending;
  save();
  console.log(`   done: ${TESTNET.nearExplorer}/txns/${hash}`);
}

/**
 * The OWNER's funding, recorded only with a funding transaction: the transaction to the satchel's
 * address is the evidence, so a balance alone, which may have been sent at any time, doesn't record
 * the step. For satchel #10 it is the one the OWNER sent before the run (RESERVED.fundingTx); for
 * any other the run stops here until --funding-tx names it.
 */
async function ownerStep(step) {
  const c = await sepolia();
  const [balance, nonce] = await Promise.all([c.getBalance({ address: run.address }), c.getTransactionCount({ address: run.address, blockTag: "latest" })]);
  if (nonce !== 0) stop(`${run.address} has already sent ${nonce} transactions on Sepolia`);
  if (balance < AMOUNTS.sepoliaMinimum) {
    stop(`OWNER: send about ${formatBalance(AMOUNTS.sepoliaFunding)} Sepolia ETH to satchel #${run.tokenId}'s address ${run.address} (it holds ${formatBalance(balance)}), then run this again with --funding-tx <the funding transaction's hash>`);
  }
  const reserved = run.tokenId === RESERVED.tokenId && run.address.toLowerCase() === RESERVED.address.toLowerCase();
  const hash = flags["funding-tx"] ?? (reserved ? RESERVED.fundingTx : undefined);
  if (!hash) {
    stop(`${run.address} holds ${formatBalance(balance)} Sepolia ETH. Run this again with --funding-tx <the hash of the transaction that funded it> (https://sepolia.etherscan.io/address/${run.address} lists it): the step is recorded with that transaction, not a balance alone`);
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) stop(`--funding-tx ${hash} is not a transaction hash`);
  let sent;
  let receipt;
  try {
    [sent, receipt] = await read("the funding transaction", () => Promise.all([c.getTransaction({ hash }), c.getTransactionReceipt({ hash })]));
  } catch (err) {
    stop(`--funding-tx ${hash} couldn't be read on Sepolia: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
  }
  if (sent.to?.toLowerCase() !== run.address.toLowerCase() || receipt.status !== "success") stop(`${hash} is to ${sent.to}, ${receipt.status}: not satchel #${run.tokenId}'s funding`);
  const entry = {
    key: step.key,
    step: step.title.replace(/^The OWNER funds/, "Fund"),
    sepolia: {
      tx: hash, block: String(receipt.blockNumber), from: sent.from.toLowerCase(), to: sent.to.toLowerCase(), nonce: String(sent.nonce), valueWei: sent.value.toString(), status: receipt.status,
      address: run.address, balanceWei: balance.toString(), readAt: new Date().toISOString(),
    },
  };
  run.steps.push(entry);
  save();
  console.log(`   done: ${run.address} holds ${formatBalance(balance)} Sepolia ETH`);
}

async function finishStep(step) {
  const voteTx = done(run, "sendVote2").tx;
  const out = spawnSync(process.execPath, [CLI_BIN, "dao", "finish", voteTx, "--yes", "--json", "--network", "testnet"], { encoding: "utf8", timeout: 600_000 });
  if (out.error) stop(`Could not run ${CLI_BIN}: ${out.error.message}`);
  let result = null;
  try {
    result = JSON.parse(out.stdout);
  } catch {
    // Not JSON: the error lines below say why.
  }
  if (out.status !== 0 || result?.status !== "success") {
    stop(`satchel-nft dao finish ended with exit code ${out.status}: ${out.stdout.trim().slice(-600)} ${out.stderr.trim().slice(-600)}. It is safe to run again: it sends nothing already mined`);
  }
  const c = await sepolia();
  const [sent, receipt] = await read("the Sepolia send", () => Promise.all([c.getTransaction({ hash: result.evmTx }), c.getTransactionReceipt({ hash: result.evmTx })]));
  if (sent.from.toLowerCase() !== run.address.toLowerCase() || sent.to?.toLowerCase() !== X_ADDRESS.address.toLowerCase() || sent.nonce !== 0 || sent.value !== AMOUNTS.send) {
    stop(`${result.evmTx} is from ${sent.from} to ${sent.to}, nonce ${sent.nonce}, ${sent.value} wei: not the send the DAO voted`);
  }
  run.steps.push({
    key: step.key,
    step: `satchel-nft dao finish ${voteTx} --yes`,
    sepolia: { tx: result.evmTx, block: String(receipt.blockNumber), from: sent.from.toLowerCase(), to: sent.to.toLowerCase(), nonce: String(sent.nonce), valueWei: sent.value.toString(), status: receipt.status },
    alreadyMined: result.alreadyMined,
  });
  save();
  console.log(`   done: https://sepolia.etherscan.io/tx/${result.evmTx}`);
}

async function runSteps() {
  if (process.env.NEAR_RPC) {
    if (/mainnet/i.test(process.env.NEAR_RPC)) stop(`NEAR_RPC ${process.env.NEAR_RPC} looks like a mainnet node: this run is testnet only`);
    setNearRpc(process.env.NEAR_RPC);
  }
  const chain = await read("status", () => nearChainId(TESTNET));
  if (chain !== "testnet") stop(`the NEAR RPC serves ${chain}, not testnet`);
  if (run.failed?.length) {
    stop(`${OUT} lists a step whose transaction failed on chain (${run.failed.map((f) => f.key).join(", ")}): look at it, then remove "failed" from the file, and the next run sends that step again after its checks`);
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
      console.log(`\nAll ${buildPlan(cfg, run).length} steps are in ${OUT}. Check them: node scripts/check-dao-bounty.mjs`);
      return;
    }
    console.log(`\n== ${step.key}: ${step.title}`);
    if (step.by === "owner") await ownerStep(step);
    else if (step.by === "cli") await finishStep(step);
    else {
      // Only these are filled in by what their own checks read: the two reports of work done, the Sepolia transaction.
      if (unresolved(step) && !LIVE.has(step.key)) stop(`${step.key} still holds a <placeholder>: an earlier step's result is missing from ${OUT}`);
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

/** Arguments as JSON, with every base64 JSON value decoded in place. */
function shown(value) {
  return JSON.stringify(
    value,
    (k, v) => {
      if (k === "args" && typeof v === "string" && v.length > 16) {
        try {
          return { "base64 JSON of": JSON.parse(Buffer.from(v, "base64").toString()) };
        } catch {
          return v;
        }
      }
      return v;
    },
    2,
  ).replace(/\n/g, "\n             ");
}

function printPlan() {
  const plan = buildPlan(cfg, run);
  const line = (label, text) => console.log(`   ${label.padEnd(9)} ${text}`);
  console.log(`Bounty-board DAO run on NEAR testnet and Sepolia: ${plan.length} steps (${OUT}${existsSync(OUT) ? "" : ", not written yet"})`);
  console.log(`DAO ${DAO} from ${cfg.factory} (code ${DAO_CODE.codeHash}, sputnikdao2 ${DAO_CODE.version}, commit ${DAO_CODE.commit.slice(0, 7)})`);
  console.log(`Council ${cfg.council.join(", ")}; contributor ${X}`);
  console.log(`${X}'s own address: ${X_ADDRESS.address}, the key ${TESTNET.mpc} derives for ${X} at path "${CONTRIBUTOR_PATH}"`);
  console.log("Every signed step also checks first: the NEAR RPC serves testnet; the signer exists, has a key in the legacy keychain and");
  console.log("holds the deposit + 0.1 NEAR; the step names no demo satchel (#1 to #9) and nothing still unknown.\n");
  console.log("Payout tiers, by role and proposal kind in the DAO's policy (Sputnik has no tier by amount: the council sets each bounty's):");
  console.log(`   small     a bounty_done passed by the contributor's own vote in "${TRUSTED}", no council vote (bounty 1, 0.2 NEAR)`);
  console.log(`   mid-size  a bounty_done passed by one council vote (bounty 0, 0.5 NEAR)`);
  console.log(`   large     anything else, by 2 of the 3 council members: posting a bounty, adding ${X} to "${TRUSTED}", the Sepolia send,`);
  console.log(`             giving away the satchel; the 1 NEAR Transfer is turned down by 2 of 3\n`);
  console.log("The two new accounts were made with the faucet on 2026-11-12. If one is missing, the OWNER creates it (10 testnet NEAR):");
  for (const id of [C, X]) console.log(`   near account create-account sponsor-by-faucet-service ${id} autogenerate-new-keypair save-to-legacy-keychain network-config testnet create`);
  console.log("What each account attaches, and how many transactions it signs (gas: a few thousandths of a NEAR each, up to 0.03 NEAR for a vote that runs a call):");
  for (const id of [A, B, C, X]) {
    const mine = plan.filter((s) => s.signer === id);
    const attached = mine.reduce((sum, s) => sum + BigInt(s.deposit ?? 0), 0n);
    console.log(`   ${id}: ${formatNear(attached)} attached, ${mine.length} transactions (${mine.map((s) => s.key).join(", ")})`);
  }
  console.log(`   of which: ${A} pays ${formatNear(AMOUNTS.daoDeposit)} for the DAO and 0.1 NEAR for the mint; ${C} sends ${formatNear(AMOUNTS.treasury)} to the treasury;`);
  console.log(`   ${X} stakes the ${formatNear(AMOUNTS.bountyBond)} bond twice, returned each time a bounty is paid, and receives ${formatNear(AMOUNTS.bounty)} + ${formatNear(AMOUNTS.smallBounty)}, the Sepolia send and satchel #${run.tokenId ?? RESERVED.tokenId}`);
  console.log(`   ${DAO}: pays ${formatNear(AMOUNTS.bounty + AMOUNTS.smallBounty)}, and 1 yoctoNEAR each for sign_evm and nft_transfer, from what its storage leaves free`);
  console.log(`   satchel #${RESERVED.tokenId}'s Sepolia address ${RESERVED.address}: ${formatBalance(RESERVED.fundingWei)} Sepolia ETH from the OWNER, sent before the run (${RESERVED.fundingTx}); the send is ${formatBalance(AMOUNTS.send)} ETH plus about 207k gas\n`);
  for (const [i, s] of plan.entries()) {
    const d = done(run, s.key);
    console.log(`${String(i + 1).padStart(2)}. ${s.key} [${d ? `done ${d.tx ?? d.sepolia?.tx ?? ""}` : s.by === "owner" ? "OWNER" : "to run"}]`);
    console.log(`   ${s.title}`);
    if (s.signer) line("signer", s.signer);
    if (s.receiver) line("receiver", s.receiver);
    if (s.method) line("method", s.method);
    if (s.action) line("action", s.action);
    if (s.command) line("command", s.command);
    if (s.args) line("args", shown(s.method === "create" ? { name: s.args.name, args: "(base64 JSON of decodedArgs)" } : s.args));
    if (s.decodedArgs) line("decoded", shown(s.decodedArgs));
    if (s.deposit !== undefined) line("deposit", `${formatNear(s.deposit)} (${s.deposit} yoctoNEAR)`);
    if (s.gas) line("gas", `${BigInt(s.gas) / TGAS} TGas`);
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
