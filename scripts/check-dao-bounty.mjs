// Checks the README's claims about the bounty-board run against NEAR testnet and Sepolia: a Sputnik
// DAO whose council of three posted a bounty by two votes, a contributor who claimed it with a bond
// and reported it done, the one council vote that paid it, the two council votes that then added
// the contributor to the role "trusted" by a proposal citing that bounty, a second, smaller bounty
// the contributor's own trusted vote paid with no council vote, the satchel the DAO owns signing a
// Sepolia send to the contributor's own Chain Signatures address by two votes, the larger payout the
// council turned down, and the two votes that gave the contributor the satchel itself. It reads the
// transactions in deployments/testnet-dao-bounty.json, then prints the DAO's bounty board: who may
// approve what, its bounties, claims, payouts, role changes and each contributor's record, where
// every point links the BountyDone proposal, who approved it in which role, and the transaction that
// paid it, and every role change the proposal that made it and the finished bounty it cites. Node 22
// or later, no install, no wallet, no key.
// Usage: node scripts/check-dao-bounty.mjs
// NEAR_RPC, NEAR_ARCHIVAL_RPC and SEPOLIA_RPC replace the default nodes, and a node that doesn't
// answer is asked again or passed over exactly as in scripts/check-dao.mjs. A claim whose steps
// the file doesn't hold yet reads [WAIT], not [FAIL]; before the run there is no file, and the
// script says so.
import { existsSync, readFileSync } from "node:fs";

const FILE = "deployments/testnet-dao-bounty.json";
const PATH = new URL(`../${FILE}`, import.meta.url);
const RUN = existsSync(PATH) ? JSON.parse(readFileSync(PATH, "utf8")) : null;
const RPC = process.env.NEAR_RPC ?? "https://rpc.testnet.fastnear.com";
const ARCHIVAL = process.env.NEAR_ARCHIVAL_RPC ?? "https://archival-rpc.testnet.fastnear.com";
/** Read only if NEAR_ARCHIVAL_RPC is unset and the default node doesn't answer, as in check-dao.mjs. */
const ARCHIVAL_FALLBACKS = ["https://archival-rpc.testnet.near.org"];
const SEPOLIA_RPC = process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com";
/** Read only if SEPOLIA_RPC is unset and the default node fails, as in check-dao.mjs. */
const SEPOLIA_FALLBACKS = ["https://1rpc.io/sepolia", "https://sepolia.gateway.tenderly.co"];
const SEPOLIA = "11155111";
/** The code the sputnikv2.testnet factory deploys: sputnikdao2 2.3.1, commit 7764926. */
const DAO_CODE_HASH = "AA4nA45vauiac3jdVwJTzSdUP3oj2r1fDaPAb2mHdgcH";
/** The testnet demo satchels the README quotes: the run's satchel is never one of them. */
const FROZEN = new Set(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
const ONE_DAY = "86400000000000";
const NEAR = 10n ** 24n;
const BOUNTY = (NEAR / 2n).toString();
const SMALL_BOUNTY = (NEAR / 5n).toString();
const BOND = (NEAR / 10n).toString();
const TREASURY = (2n * NEAR).toString();
const TURNED_DOWN = NEAR.toString();
/** The role whose members' own vote passes a bounty_done, and all it may do. */
const TRUSTED = "trusted";
const TRUSTED_PERMISSIONS = ["bounty_done:AddProposal", "bounty_done:VoteApprove"];
/**
 * The soonest Sepolia can finalize a block, in seconds: two epochs of 32 slots of 12 s. A block
 * younger than that can't be final; one older may be, which only the "finalized" tag says, and only
 * for now.
 */
const SEPOLIA_FINALITY_S = 2 * 32 * 12;
/** Every proposal kind's label in sputnikdao2 2.3.1 (`to_policy_label`, proposals.rs). */
const LABELS = [
  "config", "policy", "add_member_to_role", "remove_member_from_role", "call", "upgrade_self", "upgrade_remote", "transfer",
  "set_vote_token", "add_bounty", "bounty_done", "vote", "factory_info_update", "policy_add_or_update_role", "policy_remove_role",
  "policy_update_default_vote_policy", "policy_update_parameters",
];

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

/**
 * The archival nodes that answered reads, and the Sepolia nodes that answered a read the default node
 * failed, which the last lines name.
 */
const answeredBy = { archival: new Set(), sepolia: new Set() };

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
/**
 * A Sepolia read from SEPOLIA_RPC or, with it unset, from the default node and then each fallback.
 * A null result, or none, counts as a failed read: every read here asks for something that exists.
 * Only a read no node answered is blamed on the nodes.
 */
async function sepolia(method, params) {
  const urls = process.env.SEPOLIA_RPC ? [SEPOLIA_RPC] : [SEPOLIA_RPC, ...SEPOLIA_FALLBACKS];
  const errors = [];
  let unanswered = 0;
  for (const url of urls) {
    try {
      let result = await rpc(url, method, params);
      if (result == null) {
        await wait(2_000);
        result = await rpc(url, method, params);
      }
      if (result == null) throw new Error(`${method}: ${result === null ? "null" : "no result"} from ${url}`);
      if (url !== SEPOLIA_RPC) answeredBy.sepolia.add(url);
      return result;
    } catch (err) {
      if (err instanceof NoAnswer) unanswered += 1;
      errors.push(err.message);
    }
  }
  const failures = errors.join("; ");
  if (unanswered === urls.length) {
    const nodes = urls.length === 1 ? "That is a Sepolia node" : `Those are ${urls.length} Sepolia nodes`;
    throw new Error(`${failures}. ${nodes} failing, not a change to any satchel: set SEPOLIA_RPC to another Sepolia node and run it again`);
  }
  if (unanswered === 0) {
    // Every node answered, so this is no outage: Sepolia, or every node asked, doesn't have it.
    const [nodes, them] = urls.length === 1 ? ["The Sepolia node answered", "that node"] : [`All ${urls.length} Sepolia nodes answered`, "every one of them"];
    throw new Error(`${failures}. ${nodes} without it: Sepolia may not have it, or ${them} may be missing it. If you trust another Sepolia node, set SEPOLIA_RPC to it and run it again`);
  }
  throw new Error(`${failures}. Some Sepolia nodes did not answer, and the rest answered without it: run it again, or set SEPOLIA_RPC to another node`);
}

/** Calls a view method of `account` now, or at `blockId` on an archival node. */
async function view(account, method, args = {}, blockId) {
  const params = {
    account_id: account,
    request_type: "call_function",
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  };
  const { result } =
    blockId === undefined
      ? await near(RPC, "NEAR_RPC", "query", { finality: "final", ...params })
      : await archival("query", { block_id: blockId, ...params });
  return JSON.parse(Buffer.from(result).toString());
}

/**
 * A transaction as an archival node has it now. With wait_until "FINAL", nearcore holds a request for
 * a transaction it doesn't know about 30 s and answers HTTP 408, so a wrong hash would be blamed on
 * the nodes; with "NONE" it answers UNKNOWN_TRANSACTION at once. One that isn't final fails the claim.
 */
async function tx(hash, sender) {
  const t = await archival("EXPERIMENTAL_tx_status", { tx_hash: hash, sender_account_id: sender, wait_until: "NONE" });
  if (t.final_execution_status !== "FINAL") throw new Error(`${hash.slice(0, 8)}… is ${t.final_execution_status}, not final`);
  return t;
}
const json = (base64) => JSON.parse(Buffer.from(base64, "base64").toString() || "null");

/** The transaction's one function call, to `receiver`, signed by `signer`. */
function callOf(t, signer, receiver) {
  const call = t.transaction.actions.length === 1 ? t.transaction.actions[0].FunctionCall : undefined;
  if (!call || t.transaction.receiver_id !== receiver) throw new Error(`not one call to ${receiver}`);
  if (t.transaction.signer_id !== signer) throw new Error(`signed by ${t.transaction.signer_id}`);
  if (!("SuccessValue" in t.status)) throw new Error(`ended ${JSON.stringify(t.status)}`);
  return { method: call.method_name, args: json(call.args) };
}

/** The function calls `from` made on `to` in the transaction's receipts. */
const callsIn = (t, from, to) =>
  t.receipts
    .filter((r) => r.predecessor_id === from && r.receiver_id === to)
    .flatMap((r) => r.receipt.Action?.actions ?? [])
    .map((a) => a.FunctionCall)
    .filter(Boolean)
    .map((c) => ({ method: c.method_name, rawArgs: c.args, args: json(c.args), deposit: c.deposit, gas: String(c.gas) }));

/** The NEP-297 events `executor` logged in the transaction, parsed, with the block it ran in. */
const eventsBy = (t, executor) =>
  t.receipts_outcome
    .filter((o) => o.outcome.executor_id === executor)
    .flatMap((o) =>
      o.outcome.logs
        .filter((l) => l.startsWith("EVENT_JSON:"))
        .map((l) => ({ ...JSON.parse(l.slice("EVENT_JSON:".length)), block: o.block_hash })),
    );

// ---- What this run adds to check-dao.mjs's reads ----------------------------------------------

const ok = (status) => typeof status === "object" && status !== null && "SuccessValue" in status;

/** The NEAR transfers `from` made to `to` in the transaction's receipts, each with its receipt's outcome. */
function transfersIn(t, from, to) {
  const outcomes = new Map(t.receipts_outcome.map((o) => [o.id, o.outcome.status]));
  return t.receipts
    .filter((r) => r.predecessor_id === from && r.receiver_id === to)
    .flatMap((r) => (r.receipt.Action?.actions ?? []).filter((a) => a.Transfer).map((a) => ({ receipt: r.receipt_id, amount: a.Transfer.deposit, status: outcomes.get(r.receipt_id) })));
}

/** The block the transaction's first receipt ran in: state read there is right after the call. */
const firstBlock = (t) => t.receipts_outcome.find((o) => o.id === t.transaction_outcome.outcome.receipt_ids[0]).block_hash;

/** JSON with object keys sorted and every array of strings sorted: a policy's sets and maps come back in any order. */
function canonical(value) {
  return JSON.stringify(value, (_, v) => {
    if (Array.isArray(v)) return v.every((x) => typeof x === "string") ? [...v].sort() : v;
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)));
    return v;
  });
}

/**
 * The council votes a proposal of kind `label` needs, as sputnikdao2's `proposal_status` counts them
 * for a RoleWeight group (policy.rs): a Weight w is min(w, members), a Ratio n/d is
 * min(n·members/d + 1, members), never less than the quorum.
 */
function votesNeeded(policy, role, label) {
  const found = policy.roles.find((r) => r.name === role);
  const group = found?.kind?.Group;
  if (!Array.isArray(group)) throw new Error(`${role} is not a group role`);
  const vp = found.vote_policy?.[label] ?? policy.default_vote_policy;
  if (vp.weight_kind !== "RoleWeight") throw new Error(`${role}'s ${label} policy is ${vp.weight_kind}`);
  const members = BigInt(new Set(group).size);
  const min = (a, b) => (a < b ? a : b);
  const t = vp.threshold;
  const weight = Array.isArray(t) ? min((BigInt(t[0]) * members) / BigInt(t[1]) + 1n, members) : min(BigInt(t), members);
  return BigInt(vp.quorum) > weight ? BigInt(vp.quorum) : weight;
}

const permits = (role, label, action) => [`${label}:${action}`, `${label}:*`, `*:${action}`, "*:*"].some((p) => role.permissions.includes(p));

/**
 * The roles that let `account` take `action` on a proposal of kind `label`, as policy.rs's
 * `can_execute_action` finds them; a vote counts once in each of them, and nowhere else.
 */
const rolesAllowing = (policy, account, label, action) =>
  policy.roles.filter((r) => (r.kind === "Everyone" || r.kind?.Group?.includes(account)) && permits(r, label, action)).map((r) => r.name);

/**
 * The group roles under which a proposal of kind `label` that no one voted for reads Approved at
 * Finalize, which checks every role: one whose threshold comes to 0, as an empty group's would
 * with quorum 0.
 */
const passesUnvoted = (policy, label) => policy.roles.filter((r) => Array.isArray(r.kind?.Group) && votesNeeded(policy, r.name, label) === 0n).map((r) => r.name);

/** The bounty and BountyDone proposal a trust proposal's description cites, as tools/dao-bounty.mjs writes it, or null. */
function citedBounty(description) {
  const m = /finished bounty (\d+), paid by BountyDone proposal (\d+)\./.exec(description ?? "");
  return m ? { bountyId: Number(m[1]), proposalId: Number(m[2]) } : null;
}

/** "0.5 NEAR". */
function nearAmount(yocto) {
  const v = BigInt(yocto);
  const fraction = (v % NEAR).toString().padStart(24, "0").replace(/0+$/, "");
  return `${v / NEAR}${fraction ? `.${fraction.slice(0, 5)}` : ""} NEAR`;
}

/**
 * Keccak-256, for the two addresses this script derives from keys the MPC contract returns. Node's
 * crypto has SHA3-256, which pads differently. Checked against viem's keccak256 on inputs of 0 to
 * 500 bytes, across the 136-byte block edges.
 */
const KECCAK_ROUNDS = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n, 0x000000000000808bn, 0x0000000080000001n,
  0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n,
  0x000000000000800an, 0x800000008000000an, 0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
/** The rotation of lane (x, y), as KECCAK_ROTATIONS[x][y]. */
const KECCAK_ROTATIONS = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
];
const LANE = (1n << 64n) - 1n;
const rotl = (x, n) => (n === 0 ? x : ((x << BigInt(n)) | (x >> BigInt(64 - n))) & LANE);

function keccak256(bytes) {
  const rate = 136;
  const padded = new Uint8Array((Math.floor(bytes.length / rate) + 1) * rate);
  padded.set(bytes);
  padded[bytes.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;
  const s = new Array(25).fill(0n);
  for (let at = 0; at < padded.length; at += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = 0n;
      for (let b = 7; b >= 0; b--) lane = (lane << 8n) | BigInt(padded[at + 8 * i + b]);
      s[i] ^= lane;
    }
    for (const rc of KECCAK_ROUNDS) {
      const c = [0, 1, 2, 3, 4].map((x) => s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20]);
      for (let x = 0; x < 5; x++) {
        const d = c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1);
        for (let y = 0; y < 25; y += 5) s[x + y] ^= d;
      }
      const b = new Array(25);
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(s[x + 5 * y], KECCAK_ROTATIONS[x][y]);
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) s[x + 5 * y] = b[x + 5 * y] ^ (~b[((x + 1) % 5) + 5 * y] & LANE & b[((x + 2) % 5) + 5 * y]);
      s[0] ^= rc;
    }
  }
  let hex = "";
  for (let i = 0; i < 4; i++) for (let b = 0; b < 8; b++) hex += Number((s[i] >> BigInt(8 * b)) & 0xffn).toString(16).padStart(2, "0");
  return hex;
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Decode(text) {
  let n = 0n;
  for (const c of text) {
    const v = BASE58.indexOf(c);
    if (v < 0) throw new Error(`${text} is not base58`);
    n = n * 58n + BigInt(v);
  }
  const bytes = [];
  for (; n > 0n; n >>= 8n) bytes.unshift(Number(n & 0xffn));
  for (const c of text) {
    if (c !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

/** The EVM address of a key as derived_public_key returns it: the last 20 bytes of keccak256 of its 64 bytes, lowercase. */
function addressOf(publicKey) {
  const bytes = base58Decode(publicKey.replace(/^secp256k1:/, ""));
  if (bytes.length !== 64) throw new Error(`${publicKey} is not a 64-byte key`);
  return `0x${keccak256(bytes).slice(-40)}`;
}

// ---- The claims --------------------------------------------------------------------------------

/**
 * What the claims proved, for the board: the payout of each BountyDone proposal and who approved it
 * in which role, each role change and the bounty it cites, the Sepolia send and the satchel's gift.
 */
const proved = { payouts: new Map(), roleChanges: [], send: null, give: null };

async function check() {
  const CONTRACT = RUN.contract;
  const MPC = RUN.mpc;
  const DAO = RUN.dao;
  const FACTORY = RUN.daoFactory;
  const TOKEN = RUN.tokenId;
  const [A, B, C] = RUN.council;
  const X = RUN.contributor;
  const step = (key) => RUN.steps.find((s) => s.key === key);
  const bountyId = () => step("addBountyVote2").bountyId;
  const smallId = () => step("addBounty2Vote2").bountyId;

  /** The proposal add_proposal filed in step `key`: the id it returned, which the file names, the kind and the description. */
  async function filed(key, signer) {
    const s = step(key);
    const t = await tx(s.tx, signer);
    const call = callOf(t, signer, DAO);
    const id = json(t.status.SuccessValue);
    if (call.method !== "add_proposal" || id !== s.proposalId) throw new Error(`${s.tx.slice(0, 8)}… is ${call.method}, returning ${t.status.SuccessValue}`);
    return { id, kind: call.args.proposal.kind, description: call.args.proposal.description, t };
  }

  /** Throws unless the transaction is `signer`'s act_proposal(`id`, `action`) on the DAO. */
  function act(t, signer, id, action) {
    const call = callOf(t, signer, DAO);
    if (call.method !== "act_proposal" || call.args.id !== id || call.args.action !== action) {
      throw new Error(`${t.transaction.hash.slice(0, 8)}… is ${call.method}(${JSON.stringify(call.args)}), not ${action} on proposal ${id}`);
    }
  }

  const proposalAt = (id, blockId) => view(DAO, "get_proposal", { id }, blockId);
  const votes = (p) => canonical(p.votes ?? {});
  const group = (policy, role) => policy.roles.find((r) => r.name === role)?.kind?.Group;

  /** An AddBounty proposal `proposer` filed, which `first`'s vote left in progress and `second`'s passed, posting `amount`. */
  async function posted(keys, proposer, first, second, amount, bountyOf) {
    const [proposalKey, vote1Key, vote2Key] = keys;
    const { id, kind } = await filed(proposalKey, proposer);
    const bounty = kind.AddBounty?.bounty;
    if (bounty?.amount !== amount || bounty.times !== 1 || bounty.token !== "") throw new Error(`proposal ${id} is ${JSON.stringify(kind)}`);
    const [v1, v2] = await Promise.all([tx(step(vote1Key).tx, first), tx(step(vote2Key).tx, second)]);
    act(v1, first, id, "VoteApprove");
    act(v2, second, id, "VoteApprove");
    const b = bountyOf();
    const [after1, bountiesBefore2, bountiesAfter2, now, onBoard] = await Promise.all([
      proposalAt(id, firstBlock(v1)),
      view(DAO, "get_last_bounty_id", {}, firstBlock(v1)),
      view(DAO, "get_last_bounty_id", {}, firstBlock(v2)),
      view(DAO, "get_proposal", { id }),
      view(DAO, "get_bounty", { id: b }),
    ]);
    if (after1.status !== "InProgress" || votes(after1) !== canonical({ [first]: "Approve" })) throw new Error(`after the first vote, proposal ${id} was ${after1.status}`);
    if (now.status !== "Approved" || votes(now) !== canonical({ [first]: "Approve", [second]: "Approve" }) || canonical(now.kind) !== canonical(kind)) {
      throw new Error(`proposal ${id} is ${now.status}, votes ${JSON.stringify(now.votes)}`);
    }
    if (bountiesBefore2 !== b || bountiesAfter2 !== b + 1) throw new Error(`get_last_bounty_id went from ${bountiesBefore2} to ${bountiesAfter2} with the second vote, not ${b} to ${b + 1}`);
    // times counts down as the bounty is paid, so the rest is compared.
    const fields = ["description", "token", "amount", "max_deadline"];
    if (fields.some((f) => onBoard[f] !== bounty[f])) throw new Error(`bounty ${b} is ${JSON.stringify(onBoard)}`);
    return `${step(proposalKey).tx.slice(0, 8)}… filed proposal ${id}; after ${v1.transaction.hash.slice(0, 8)}… InProgress; ${v2.transaction.hash.slice(0, 8)}… approved it and get_last_bounty_id became ${b + 1}: bounty ${b}, ${nearAmount(bounty.amount)}`;
  }

  /** X's bounty_claim in step `key` on bounty `id`, with the bond. */
  async function claimed(key, id) {
    const s = step(key);
    const t = await tx(s.tx, X);
    const call = callOf(t, X, DAO);
    const deposit = t.transaction.actions[0].FunctionCall.deposit;
    if (call.method !== "bounty_claim" || call.args.id !== id || deposit !== BOND) throw new Error(`${call.method}(${JSON.stringify(call.args)}) with ${deposit}`);
    const claim = (await view(DAO, "get_bounty_claims", { account_id: X }, firstBlock(t))).find((c) => c.bounty_id === id);
    if (!claim || claim.completed) throw new Error(`right after it, ${X}'s claim read ${JSON.stringify(claim)}`);
    return `${s.tx.slice(0, 8)}… bounty_claim(${id}) with ${nearAmount(deposit)}; get_bounty_claims right after: claimed, not completed`;
  }

  /**
   * X's bounty_done in `doneKey` on bounty `id`, and the one vote in `voteKey`, by `voter`, that
   * approved its BountyDone proposal and paid `amount`. The vote counted in `role`: the roles that
   * let the voter approve a bounty_done in the policy read right after bounty_done, before the vote.
   */
  async function paid(doneKey, voteKey, id, voter, role, amount) {
    const s = step(doneKey);
    const v = step(voteKey);
    const [d, t] = await Promise.all([tx(s.tx, X), tx(v.tx, voter)]);
    const report = callOf(d, X, DAO);
    if (report.method !== "bounty_done" || report.args.id !== id) throw new Error(`${report.method}(${JSON.stringify(report.args)})`);
    const pid = v.proposalId;
    act(t, voter, pid, "VoteApprove");
    const [filedNow, policy, p, bounty] = await Promise.all([
      proposalAt(pid, firstBlock(d)),
      view(DAO, "get_policy", {}, firstBlock(d)),
      view(DAO, "get_proposal", { id: pid }),
      view(DAO, "get_bounty", { id }),
    ]);
    const kind = { BountyDone: { bounty_id: id, receiver_id: X } };
    if (filedNow.proposer !== X || filedNow.status !== "InProgress" || canonical(filedNow.kind) !== canonical(kind)) {
      throw new Error(`right after bounty_done, proposal ${pid} was ${JSON.stringify(filedNow)}`);
    }
    const roles = rolesAllowing(policy, voter, "bounty_done", "VoteApprove");
    if (canonical(roles) !== canonical([role]) || votesNeeded(policy, role, "bounty_done") !== 1n) {
      throw new Error(`${voter}'s vote counted in ${roles.join(", ") || "no role"}, which needs ${roles.map((r) => votesNeeded(policy, r, "bounty_done")).join(", ")} votes`);
    }
    if (p.status !== "Approved" || votes(p) !== canonical({ [voter]: "Approve" })) throw new Error(`proposal ${pid} is ${p.status}, votes ${JSON.stringify(p.votes)}`);
    const sent = transfersIn(t, DAO, X);
    const payout = sent.find((x) => x.amount === amount && ok(x.status));
    const bond = sent.find((x) => x.amount === BOND && ok(x.status));
    if (!payout || !bond) throw new Error(`the vote's transfers to ${X}: ${JSON.stringify(sent)}`);
    if (bounty.times !== 0) throw new Error(`bounty ${id} has times ${bounty.times} left`);
    proved.payouts.set(pid, { tx: v.tx, receipt: payout.receipt, amount: payout.amount, bond: bond.receipt, approvers: [{ account: voter, role }] });
    return `${s.tx.slice(0, 8)}… filed proposal ${pid}; ${v.tx.slice(0, 8)}… approved it alone, a vote in "${role}"; receipts ${payout.receipt.slice(0, 8)}… paid ${nearAmount(payout.amount)} and ${bond.receipt.slice(0, 8)}… returned ${nearAmount(bond.amount)}; times left 0`;
  }

  const CLAIMS = [
    {
      claim: `${DAO} is a Sputnik DAO 2.3.1 from the ${FACTORY} factory, with the policy its create call asked for: a council of ${A}, ${B} and ${C}, whose one vote passes a bounty_done proposal and two of three anything else; ${X} may file a bounty_done proposal, and that is all; the role "${TRUSTED}", empty at creation, whose members may file a bounty_done proposal and pass one with their own vote, and nothing else; quorum 1 everywhere, so no kind passes with no votes; bounty bond 0.1 NEAR, proposal bond 0, proposals open for a day. Since then only the trust vote below changed it`,
      needs: ["create"],
      check: async () => {
        const s = step("create");
        const t = await tx(s.tx, A);
        const create = callOf(t, A, FACTORY);
        if (create.method !== "create" || `${create.args.name}.${FACTORY}` !== DAO) throw new Error(`create(${create.args.name})`);
        const asked = json(create.args.args).policy;
        // The policy right after `new` ran, at the block of the DAO's own receipt in the create transaction.
        const init = t.receipts_outcome.find((o) => o.outcome.executor_id === DAO && ok(o.outcome.status));
        if (!init) throw new Error(`the create transaction has no successful receipt on ${DAO}`);
        const [version, atCreation, policy, account] = await Promise.all([
          view(DAO, "version"),
          view(DAO, "get_policy", {}, init.block_hash),
          view(DAO, "get_policy"),
          near(RPC, "NEAR_RPC", "query", { finality: "final", request_type: "view_account", account_id: DAO }),
        ]);
        if (account.code_hash !== DAO_CODE_HASH || version !== "2.3.1") throw new Error(`code ${account.code_hash}, version() ${version}`);
        if (canonical(atCreation) !== canonical(asked)) throw new Error(`get_policy right after create is not what it asked for: ${JSON.stringify(atCreation)}`);
        const trusted = asked.roles.find((r) => r.name === TRUSTED);
        if (canonical(trusted?.kind) !== canonical({ Group: [] }) || canonical(trusted.permissions) !== canonical(TRUSTED_PERMISSIONS)) throw new Error(`"${TRUSTED}" was ${JSON.stringify(trusted)}`);
        const expected = structuredClone(asked);
        if (step("trustVote2")) expected.roles.find((r) => r.name === TRUSTED).kind.Group = [X];
        if (canonical(policy) !== canonical(expected)) throw new Error(`get_policy now is not what create asked for${step("trustVote2") ? ` with ${X} in "${TRUSTED}"` : ""}: ${JSON.stringify(policy)}`);
        const council = policy.roles.find((r) => r.name === "council");
        if (RUN.council.length !== 3 || canonical(council?.kind?.Group) !== canonical(RUN.council)) throw new Error(`the council is ${JSON.stringify(council?.kind)}`);
        const others = policy.roles.filter((r) => r.name !== "council" && r.name !== TRUSTED);
        // A group of the contributor, not Everyone: the DAO returns a BountyDone's bond to its proposer, and add_proposal doesn't check the proposer is the claimer.
        if (others.length !== 1 || canonical(others[0].kind?.Group) !== canonical([X]) || canonical(others[0].permissions) !== canonical(["bounty_done:AddProposal"])) {
          throw new Error(`the other roles are ${JSON.stringify(others)}`);
        }
        const twoOfThree = LABELS.filter((l) => l !== "bounty_done" && votesNeeded(policy, "council", l) !== 2n);
        if (votesNeeded(policy, "council", "bounty_done") !== 1n || twoOfThree.length > 0) throw new Error(`the council's counts differ for bounty_done or ${twoOfThree.join(", ")}`);
        if (votesNeeded(policy, TRUSTED, "bounty_done") !== 1n || votesNeeded(atCreation, TRUSTED, "bounty_done") !== 1n) throw new Error(`"${TRUSTED}" doesn't pass a bounty_done with one vote`);
        // Every vote policy, the default and each role's own, has quorum 1: the counts above don't show it.
        const quorums = [atCreation, policy].flatMap((p) => [p.default_vote_policy, ...p.roles.flatMap((r) => Object.values(r.vote_policy ?? {}))].map((vp) => vp.quorum));
        if (quorums.some((q) => q !== "1")) throw new Error(`the vote policies' quorums are ${[...new Set(quorums)].join(", ")}, not 1 everywhere`);
        const unvoted = [atCreation, policy].flatMap((p) => LABELS.filter((l) => passesUnvoted(p, l).length > 0));
        if (unvoted.length > 0) throw new Error(`a council member could finalize ${[...new Set(unvoted)].join(", ")} with no votes`);
        if (policy.proposal_bond !== "0" || policy.bounty_bond !== BOND || policy.proposal_period !== ONE_DAY) {
          throw new Error(`proposal bond ${policy.proposal_bond}, bounty bond ${policy.bounty_bond}, period ${policy.proposal_period} ns`);
        }
        return `${s.tx.slice(0, 8)}… create; code ${DAO_CODE_HASH.slice(0, 8)}…, version() 2.3.1; votes needed: bounty_done 1 (council) or 1 (${TRUSTED}), every other kind 2 of 3; "${TRUSTED}" empty at creation${step("trustVote2") ? `, ${X} now` : ""}; quorum 1 in every vote policy, at creation and now; no kind passes unvoted; bounty bond 0.1 NEAR`;
      },
    },
    {
      claim: `A council member, ${C}, funded the treasury with 2 NEAR`,
      needs: ["treasury"],
      check: async () => {
        const s = step("treasury");
        const t = await tx(s.tx, C);
        const actions = t.transaction.actions;
        const amount = actions.length === 1 ? actions[0].Transfer?.deposit : undefined;
        if (t.transaction.signer_id !== C || t.transaction.receiver_id !== DAO || amount !== TREASURY || !ok(t.status)) {
          throw new Error(`${t.transaction.signer_id} → ${t.transaction.receiver_id}: ${JSON.stringify(actions)}, ${JSON.stringify(t.status)}`);
        }
        return `${s.tx.slice(0, 8)}… Transfer of ${nearAmount(amount)} from ${C} to ${DAO}`;
      },
    },
    {
      claim: `Satchel #${TOKEN} was minted straight to the DAO; its address ${RUN.address} is the one the MPC contract derives for it`,
      needs: ["mint"],
      check: async () => {
        if (FROZEN.has(TOKEN)) throw new Error(`#${TOKEN} is a demo satchel`);
        const s = step("mint");
        const t = await tx(s.tx, A);
        const mint = callOf(t, A, CONTRACT);
        if (mint.method !== "mint" || mint.args.receiver_id !== DAO) throw new Error(`${mint.method} to ${mint.args.receiver_id}`);
        const event = eventsBy(t, CONTRACT).find((e) => e.standard === "nep171" && e.event === "nft_mint");
        if (event?.data?.[0]?.owner_id !== DAO || event.data[0].token_ids?.join() !== TOKEN) throw new Error(`the contract logged ${JSON.stringify(event)}`);
        const [token, key] = await Promise.all([
          view(CONTRACT, "nft_token", { token_id: TOKEN }, event.block),
          view(MPC, "derived_public_key", { path: `satchel/${TOKEN}`, predecessor: CONTRACT, domain_id: 0 }),
        ]);
        if (token?.owner_id !== DAO) throw new Error(`right after the mint, nft_token said ${token?.owner_id} owned it`);
        if (addressOf(key) !== RUN.address.toLowerCase()) throw new Error(`${MPC} derives ${addressOf(key)} for satchel/${TOKEN}, the file says ${RUN.address}`);
        return `${s.tx.slice(0, 8)}… nft_mint: token ${TOKEN} to ${DAO}; nft_token right after: owner ${DAO}; derived_public_key → ${addressOf(key)}`;
      },
    },
    {
      claim: `Two council votes posted the first bounty: ${A} filed an AddBounty proposal for 0.5 NEAR, done once; ${A}'s own vote left it in progress, and ${B}'s approved it`,
      needs: ["addBounty", "addBountyVote1", "addBountyVote2"],
      check: () => posted(["addBounty", "addBountyVote1", "addBountyVote2"], A, A, B, BOUNTY, bountyId),
    },
    {
      claim: `${X} claimed the first bounty, staking the 0.1 NEAR bond`,
      needs: ["addBountyVote2", "claim"],
      check: () => claimed("claim", bountyId()),
    },
    {
      claim: `Mid-size: ${X} reported the first bounty done, and one council vote, ${C}'s, approved the BountyDone proposal: the DAO paid ${X} 0.5 NEAR and returned the 0.1 NEAR bond`,
      needs: ["addBountyVote2", "done", "doneVote"],
      check: () => paid("done", "doneVote", bountyId(), C, "council", BOUNTY),
    },
    {
      claim: `Earned trust: two council votes added ${X} to "${TRUSTED}" after the first bounty was paid. ${C} filed an AddMemberToRole proposal whose description cites that bounty and its BountyDone proposal; ${C}'s vote left it in progress, ${A}'s passed it`,
      needs: ["addBountyVote2", "doneVote", "trustProposal", "trustVote1", "trustVote2"],
      check: async () => {
        const { id, kind, description, t: f } = await filed("trustProposal", C);
        if (canonical(kind) !== canonical({ AddMemberToRole: { member_id: X, role: TRUSTED } })) throw new Error(`proposal ${id} is ${JSON.stringify(kind)}`);
        const cited = citedBounty(description);
        const paidBy = step("doneVote").proposalId;
        if (cited?.bountyId !== bountyId() || cited.proposalId !== paidBy) throw new Error(`its description cites ${JSON.stringify(cited)}, not bounty ${bountyId()} and proposal ${paidBy}`);
        if (!proved.payouts.has(paidBy)) throw new Error(`the BountyDone proposal it cites, ${paidBy}, has no payout checked above`);
        const [v1, v2] = await Promise.all([tx(step("trustVote1").tx, C), tx(step("trustVote2").tx, A)]);
        act(v1, C, id, "VoteApprove");
        act(v2, A, id, "VoteApprove");
        const [citedThen, after1, policy1, policy2, p] = await Promise.all([
          proposalAt(paidBy, firstBlock(f)),
          proposalAt(id, firstBlock(v1)),
          view(DAO, "get_policy", {}, firstBlock(v1)),
          view(DAO, "get_policy", {}, firstBlock(v2)),
          view(DAO, "get_proposal", { id }),
        ]);
        if (citedThen.status !== "Approved") throw new Error(`when the trust proposal was filed, BountyDone proposal ${paidBy} was ${citedThen.status}`);
        if (after1.status !== "InProgress" || canonical(group(policy1, TRUSTED)) !== canonical([])) throw new Error(`after one vote, proposal ${id} was ${after1.status} and "${TRUSTED}" ${JSON.stringify(group(policy1, TRUSTED))}`);
        if (p.status !== "Approved" || votes(p) !== canonical({ [C]: "Approve", [A]: "Approve" })) throw new Error(`proposal ${id} is ${p.status}, votes ${JSON.stringify(p.votes)}`);
        if (canonical(group(policy2, TRUSTED)) !== canonical([X])) throw new Error(`after the second vote, "${TRUSTED}" was ${JSON.stringify(group(policy2, TRUSTED))}`);
        proved.roleChanges.push({ proposal: id, member: X, role: TRUSTED, tx: v2.transaction.hash, cites: cited, votes: p.votes });
        return `${step("trustProposal").tx.slice(0, 8)}… filed proposal ${id}, citing bounty ${cited.bountyId} and BountyDone proposal ${cited.proposalId}, Approved by then; after ${v1.transaction.hash.slice(0, 8)}… "${TRUSTED}" was empty; ${v2.transaction.hash.slice(0, 8)}… made it [${X}]`;
      },
    },
    {
      claim: `Two council votes posted a second, smaller bounty: ${B} filed an AddBounty proposal for 0.2 NEAR, done once; ${B}'s own vote left it in progress, and ${C}'s approved it`,
      needs: ["addBounty2", "addBounty2Vote1", "addBounty2Vote2"],
      check: () => posted(["addBounty2", "addBounty2Vote1", "addBounty2Vote2"], B, B, C, SMALL_BOUNTY, smallId),
    },
    {
      claim: `${X} claimed the second bounty, staking the 0.1 NEAR bond`,
      needs: ["addBounty2Vote2", "claim2"],
      check: () => claimed("claim2", smallId()),
    },
    {
      claim: `Small: ${X} reported the second bounty done and approved the BountyDone proposal with its own vote in "${TRUSTED}", and no council member voted: the DAO paid ${X} 0.2 NEAR and returned the 0.1 NEAR bond`,
      needs: ["addBounty2Vote2", "trustVote2", "done2", "done2Vote"],
      check: () => paid("done2", "done2Vote", smallId(), X, TRUSTED, SMALL_BOUNTY),
    },
    {
      claim: `Two council votes had satchel #${TOKEN} sign a Sepolia send to ${X}'s own Chain Signatures address: ${A} filed a FunctionCall proposal, ${A}'s vote left it in progress, ${C}'s ran sign_evm as filed and ${MPC} signed`,
      needs: ["mint", "sendProposal", "sendVote1", "sendVote2"],
      check: async () => {
        const { id, kind } = await filed("sendProposal", A);
        const [v1, v2] = await Promise.all([tx(step("sendVote1").tx, A), tx(step("sendVote2").tx, C)]);
        act(v1, A, id, "VoteApprove");
        act(v2, C, id, "VoteApprove");
        if (callsIn(v1, DAO, CONTRACT).length !== 0) throw new Error("the first vote called the contract");
        const [after1, p] = await Promise.all([proposalAt(id, firstBlock(v1)), view(DAO, "get_proposal", { id })]);
        if (after1.status !== "InProgress") throw new Error(`after the first vote, proposal ${id} was ${after1.status}`);
        if (p.status !== "Approved" || votes(p) !== canonical({ [A]: "Approve", [C]: "Approve" }) || canonical(p.kind) !== canonical(kind)) {
          throw new Error(`proposal ${id} is ${p.status}, votes ${JSON.stringify(p.votes)}`);
        }
        // What the vote ran is the proposal as filed: same method, arguments, deposit and gas.
        const actions = kind.FunctionCall?.actions ?? [];
        if (kind.FunctionCall?.receiver_id !== CONTRACT || actions.length !== 1) throw new Error(`proposal ${id} is ${JSON.stringify(kind)}`);
        const ran = callsIn(v2, DAO, CONTRACT);
        const [f] = actions;
        if (ran.length !== 1 || ran[0].method !== f.method_name || ran[0].rawArgs !== f.args || ran[0].deposit !== f.deposit || ran[0].gas !== String(f.gas)) {
          throw new Error(`the vote ran ${JSON.stringify(ran)}, proposal ${id} is ${JSON.stringify(f)}`);
        }
        const call = ran[0];
        if (call.method !== "sign_evm" || call.args.token_id !== TOKEN || call.args.tx.chain_id !== SEPOLIA || call.args.tx.nonce !== "0") {
          throw new Error(`the DAO called ${call.method}(${JSON.stringify(call.args)})`);
        }
        const xKey = await view(MPC, "derived_public_key", { path: RUN.contributorAddress.path, predecessor: X, domain_id: 0 });
        const xAddress = addressOf(xKey);
        if (call.args.tx.to.toLowerCase() !== xAddress || RUN.contributorAddress.address.toLowerCase() !== xAddress) {
          throw new Error(`it sends to ${call.args.tx.to}; ${MPC} derives ${xAddress} for ${X} at ${RUN.contributorAddress.path}`);
        }
        const entry = eventsBy(v2, CONTRACT).find((e) => e.standard === "satchel" && e.event === "sign_evm")?.data?.[0];
        const hash = await view(CONTRACT, "evm_signing_hash", { tx: call.args.tx });
        if (entry?.token_id !== TOKEN || entry.nonce !== call.args.tx.nonce || entry.payload !== hash) {
          throw new Error(`the contract logged ${JSON.stringify(entry)}; the hash of the call is ${hash}`);
        }
        const asked = callsIn(v2, CONTRACT, MPC).find((c) => c.method === "sign")?.args.request;
        if (asked?.path !== `satchel/${TOKEN}` || asked.payload_v2?.Ecdsa !== hash) throw new Error(`asked ${MPC} for ${JSON.stringify(asked)}`);
        const sigs = v2.receipts_outcome
          .filter((o) => o.outcome.executor_id === MPC && "SuccessValue" in o.outcome.status)
          .map((o) => json(o.outcome.status.SuccessValue))
          .filter((x) => x?.big_r?.affine_point);
        if (sigs.length !== 1) throw new Error(`${sigs.length} MPC signatures in the vote's receipts`);
        return `${step("sendProposal").tx.slice(0, 8)}… filed proposal ${id}; ${v2.transaction.hash.slice(0, 8)}… ran it as filed: sign_evm(${TOKEN}), Sepolia nonce 0 to ${xAddress} (derived_public_key for ${X} at "${RUN.contributorAddress.path}"); ${MPC} signed ${hash.slice(0, 10)}…`;
      },
    },
    {
      claim: `Sepolia ran exactly that signed transaction, from satchel #${TOKEN}'s address to ${X}'s, in a block that is now finalized`,
      needs: ["sendVote2", "finish"],
      check: async () => {
        const SEND = step("finish").sepolia;
        // `sepolia` never returns null or nothing: a read no node answers with a result fails the claim.
        const [t, sent, receipt, final] = await Promise.all([
          tx(step("sendVote2").tx, C),
          sepolia("eth_getTransactionByHash", [SEND.tx]),
          sepolia("eth_getTransactionReceipt", [SEND.tx]),
          sepolia("eth_getBlockByNumber", ["finalized", false]),
        ]);
        const signed = callsIn(t, DAO, CONTRACT)[0]?.args.tx;
        if (!signed) throw new Error("the vote made no sign_evm call");
        const fields = {
          chainId: [sent.chainId, signed.chain_id],
          nonce: [sent.nonce, signed.nonce],
          maxPriorityFeePerGas: [sent.maxPriorityFeePerGas, signed.max_priority_fee_per_gas],
          maxFeePerGas: [sent.maxFeePerGas, signed.max_fee_per_gas],
          gas: [sent.gas, signed.gas_limit],
          value: [sent.value, signed.value],
        };
        for (const [name, [onSepolia, inCall]] of Object.entries(fields)) {
          if (BigInt(onSepolia) !== BigInt(inCall)) throw new Error(`${name} is ${BigInt(onSepolia)} on Sepolia, ${inCall} in sign_evm`);
        }
        const data = (signed.data ?? "0x").toLowerCase();
        if (sent.type !== "0x2" || sent.to?.toLowerCase() !== signed.to.toLowerCase() || sent.input !== data || sent.accessList?.length) {
          throw new Error("the transaction on Sepolia is not the one sign_evm built");
        }
        // The signature Sepolia checked is the MPC contract's: r is big_r's x coordinate.
        const sig = t.receipts_outcome
          .filter((o) => o.outcome.executor_id === MPC && "SuccessValue" in o.outcome.status)
          .map((o) => json(o.outcome.status.SuccessValue))
          .find((v) => v?.big_r?.affine_point);
        if (!sig) throw new Error("no MPC signature in the vote's receipts");
        const r = BigInt(`0x${sig.big_r.affine_point.slice(2)}`);
        if (BigInt(sent.r) !== r || BigInt(sent.s) !== BigInt(`0x${sig.s.scalar}`) || Number(sent.yParity ?? sent.v) !== sig.recovery_id) {
          throw new Error(`the signature on Sepolia is not the one ${MPC} returned`);
        }
        if (sent.from.toLowerCase() !== RUN.address.toLowerCase()) throw new Error(`sent from ${sent.from}`);
        if (sent.to.toLowerCase() !== RUN.contributorAddress.address.toLowerCase()) throw new Error(`sent to ${sent.to}`);
        if (receipt.status !== "0x1" || BigInt(receipt.blockNumber) !== BigInt(SEND.block)) {
          throw new Error(`status ${receipt.status} in block ${BigInt(receipt.blockNumber)}`);
        }
        if (BigInt(final.number) < BigInt(receipt.blockNumber)) {
          throw new Error(`Sepolia has finalized up to block ${BigInt(final.number)}, not ${BigInt(receipt.blockNumber)} yet`);
        }
        proved.send = { tx: SEND.tx, value: BigInt(sent.value), to: sent.to, nonce: BigInt(sent.nonce), block: BigInt(receipt.blockNumber) };
        return `${SEND.tx.slice(0, 10)}… from ${RUN.address} to ${sent.to}, nonce ${BigInt(sent.nonce)}, ${BigInt(sent.value)} wei, block ${BigInt(receipt.blockNumber)}, status 1, finalized`;
      },
    },
    {
      claim: `The council turned down a larger payout: ${C} proposed a 1 NEAR Transfer to ${X} and voted for it, which left it in progress, and ${A} and ${B} voted it down`,
      needs: ["rejectProposal", "rejectApprove", "reject1", "reject2"],
      check: async () => {
        const { id, kind } = await filed("rejectProposal", C);
        if (canonical(kind) !== canonical({ Transfer: { token_id: "", receiver_id: X, amount: TURNED_DOWN, msg: null } })) throw new Error(`proposal ${id} is ${JSON.stringify(kind)}`);
        const [a, r1, r2] = await Promise.all([tx(step("rejectApprove").tx, C), tx(step("reject1").tx, A), tx(step("reject2").tx, B)]);
        act(a, C, id, "VoteApprove");
        act(r1, A, id, "VoteReject");
        act(r2, B, id, "VoteReject");
        const [afterApprove, afterReject, p] = await Promise.all([proposalAt(id, firstBlock(a)), proposalAt(id, firstBlock(r1)), view(DAO, "get_proposal", { id })]);
        if (afterApprove.status !== "InProgress" || afterReject.status !== "InProgress") throw new Error(`after one vote it was ${afterApprove.status}, after two ${afterReject.status}`);
        if (p.status !== "Rejected" || votes(p) !== canonical({ [C]: "Approve", [A]: "Reject", [B]: "Reject" })) throw new Error(`proposal ${id} is ${p.status}, votes ${JSON.stringify(p.votes)}`);
        const paidOut = transfersIn(r2, DAO, X).filter((x) => BigInt(x.amount) > 0n);
        if (paidOut.length > 0) throw new Error(`the last vote moved NEAR to ${X}: ${JSON.stringify(paidOut)}`);
        return `${step("rejectProposal").tx.slice(0, 8)}… filed proposal ${id}; 1 approve then 1 reject: InProgress; ${r2.transaction.hash.slice(0, 8)}… made it Rejected; nothing paid`;
      },
    },
    {
      claim: `Paid with a whole wallet: two council votes gave satchel #${TOKEN} to ${X} with nft_transfer once its one signature, Sepolia nonce 0, was spent: the send above was mined at least ${SEPOLIA_FINALITY_S / 60} minutes, the soonest Sepolia finalizes a block, before the transfer ran, and the satchel signed nothing more in between. ${A} filed the FunctionCall proposal, ${A}'s vote left it in progress and ${B}'s ran it as filed. That its report read PROVABLY CLEAN before the filing is the runner's own read, kept in the file`,
      needs: ["finish", "giveProposal", "giveVote1", "giveVote2"],
      check: async () => {
        if (!proved.send) throw new Error("the Sepolia send above didn't check out");
        const { id, kind, t: f } = await filed("giveProposal", A);
        const actions = kind.FunctionCall?.actions ?? [];
        const [g] = actions;
        if (kind.FunctionCall?.receiver_id !== CONTRACT || actions.length !== 1 || g.method_name !== "nft_transfer" || g.deposit !== "1") throw new Error(`proposal ${id} is ${JSON.stringify(kind)}`);
        const args = json(g.args);
        if (canonical(args) !== canonical({ token_id: TOKEN, receiver_id: X })) throw new Error(`it gives ${JSON.stringify(args)}`);
        const [v1, v2] = await Promise.all([tx(step("giveVote1").tx, A), tx(step("giveVote2").tx, B)]);
        act(v1, A, id, "VoteApprove");
        act(v2, B, id, "VoteApprove");
        if (callsIn(v1, DAO, CONTRACT).length !== 0) throw new Error("the first vote called the contract");
        const [after1, p, recordWhenFiled] = await Promise.all([
          proposalAt(id, firstBlock(v1)),
          view(DAO, "get_proposal", { id }),
          view(CONTRACT, "signing_record", { token_id: TOKEN }, firstBlock(f)),
        ]);
        if (after1.status !== "InProgress") throw new Error(`after the first vote, proposal ${id} was ${after1.status}`);
        if (p.status !== "Approved" || votes(p) !== canonical({ [A]: "Approve", [B]: "Approve" })) throw new Error(`proposal ${id} is ${p.status}, votes ${JSON.stringify(p.votes)}`);
        const ran = callsIn(v2, DAO, CONTRACT);
        if (ran.length !== 1 || ran[0].method !== "nft_transfer" || ran[0].rawArgs !== g.args || ran[0].deposit !== g.deposit || ran[0].gas !== String(g.gas)) {
          throw new Error(`the vote ran ${JSON.stringify(ran)}, proposal ${id} is ${JSON.stringify(g)}`);
        }
        const event = eventsBy(v2, CONTRACT).find((e) => e.standard === "nep171" && e.event === "nft_transfer");
        const moved = event?.data?.[0];
        if (moved?.old_owner_id !== DAO || moved.new_owner_id !== X || moved.token_ids?.join() !== TOKEN) throw new Error(`the contract logged ${JSON.stringify(event)}`);
        const [token, recordAtTransfer, transferBlock, sendBlock] = await Promise.all([
          view(CONTRACT, "nft_token", { token_id: TOKEN }, event.block),
          view(CONTRACT, "signing_record", { token_id: TOKEN }, event.block),
          archival("block", { block_id: event.block }),
          sepolia("eth_getBlockByNumber", [`0x${proved.send.block.toString(16)}`, false]),
        ]);
        if (token?.owner_id !== X) throw new Error(`right after the transfer, nft_token said ${token?.owner_id} owned it`);
        // When the proposal was filed, the record held the one send and nothing else.
        const r = recordWhenFiled;
        const signed = r.evm.map((c) => `${c.chain_id}:${c.max_nonce}:${c.signatures}`).join(", ");
        if (signed !== `${SEPOLIA}:0:1` || r.approvals.length || r.approvals_not_itemized || r.unclassified_calls || r.opaque_signatures || proved.send.nonce !== 0n) {
          throw new Error(`when the proposal was filed, the record was ${JSON.stringify(r)}`);
        }
        // And still the same where the transfer ran: nothing was signed between the filing and the gift.
        if (canonical(recordAtTransfer) !== canonical(r)) throw new Error(`where the transfer ran, the record was ${JSON.stringify(recordAtTransfer)}, not ${JSON.stringify(r)} as at the filing`);
        // Both chains' own block times. NEAR's are in nanoseconds, Sepolia's in seconds. This shows the
        // send could have been final when the transfer ran, not that it was: Sepolia's "finalized" tag
        // answers only for now.
        const transferredAt = Number(BigInt(transferBlock.header.timestamp_nanosec ?? transferBlock.header.timestamp) / 1_000_000_000n);
        const minedAt = Number(BigInt(sendBlock.timestamp));
        if (transferredAt - minedAt < SEPOLIA_FINALITY_S) {
          throw new Error(`the send was mined at ${new Date(minedAt * 1000).toISOString()}, ${transferredAt - minedAt} s before the transfer, less than the ${SEPOLIA_FINALITY_S} s Sepolia takes to finalize a block`);
        }
        // The runner's own read of the report before it filed, as the file keeps it: not read again
        // here. checkedAt and sentAt are both the runner's clock.
        const filing = step("giveProposal");
        const before = filing.reportBefore;
        if (before?.verdict !== "clean" || !(Date.parse(before.checkedAt) <= Date.parse(filing.sentAt))) throw new Error(`the file records the report before as ${JSON.stringify(before)}, the filing as sent at ${filing.sentAt}`);
        proved.give = { tx: v2.transaction.hash, proposalId: id };
        return `${filing.tx.slice(0, 8)}… filed proposal ${id}, when the record held Sepolia nonce 0 only, 1 signature, and it still did where ${v2.transaction.hash.slice(0, 8)}… ran nft_transfer as filed: ${DAO} → ${X}, ${Math.floor((transferredAt - minedAt) / 60)} min after Sepolia block ${proved.send.block}; the runner read PROVABLY CLEAN at ${before.checkedAt} and sent the filing at ${filing.sentAt} (in the file)`;
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
  console.log(`\n${held} of ${CLAIMS.length} claims hold${waiting ? `, ${waiting} not run yet` : ""} (${RPC}, archival ${ARCHIVAL}, ${SEPOLIA_RPC})`);
  if (archivalNodes[0] !== ARCHIVAL && answeredBy.archival.size) {
    console.log(`Archival reads came from ${[...answeredBy.archival].join(" and ")}: once ${ARCHIVAL} didn't answer one, later ones went to ${archivalNodes[0]} first`);
  }
  if (answeredBy.sepolia.size) console.log(`Sepolia reads that ${SEPOLIA_RPC} failed came from ${[...answeredBy.sepolia].join(" and ")}`);
  if (step("create")) {
    try {
      await board(DAO, X, step);
    } catch (err) {
      console.log(`\nThe board couldn't be read: ${err.message}`);
    }
  }
  return failed + waiting === 0;
}

// ---- The board ---------------------------------------------------------------------------------

const nearTx = (hash) => `https://testnet.nearblocks.io/txns/${hash}`;

/**
 * The DAO's bounty board, read now from its views. A contributor's point is a BountyDone proposal
 * that is Approved and whose payout the claims above found in the vote's receipts; an approved one
 * without that is listed, not counted. Who approved a payout, and in which role, is what the claims
 * read in the policy right before the vote; for one they didn't check, it is the voter's roles in
 * the policy now. A role change cites a finished bounty in its description, which Sputnik doesn't
 * check: the board says whether the claims above did.
 */
async function board(DAO, X, step) {
  const [lastProposal, lastBounty, available, policy] = await Promise.all([
    view(DAO, "get_last_proposal_id"),
    view(DAO, "get_last_bounty_id"),
    view(DAO, "get_available_amount"),
    view(DAO, "get_policy"),
  ]);
  const [proposals, bounties] = await Promise.all([
    lastProposal > 0 ? view(DAO, "get_proposals", { from_index: 0, limit: lastProposal }) : [],
    lastBounty > 0 ? view(DAO, "get_bounties", { from_index: 0, limit: lastBounty }) : [],
  ]);
  const VOTED = { Approve: "approved", Reject: "rejected", Remove: "removed" };
  const who = (p) => Object.entries(p.votes ?? {}).map(([account, vote]) => `${account} ${VOTED[vote] ?? vote}`).join(", ") || "no votes";
  /** Who approved a BountyDone proposal and in which role: as the claims read it, or from the policy now. */
  const approvers = (p) =>
    proved.payouts.get(p.id)?.approvers.map((a) => `${a.account} (${a.role})`).join(", ") ??
    (Object.entries(p.votes ?? {})
      .filter(([, vote]) => vote === "Approve")
      .map(([account]) => `${account} (${rolesAllowing(policy, account, "bounty_done", "VoteApprove").join(", ") || "no role now"}, by the policy now)`)
      .join(", ") || "no approvals");
  console.log(`\nBounty board of ${DAO}, read now from get_policy, get_bounties, get_proposals and get_bounty_claims`);
  const treasury = step("treasury");
  console.log(`Treasury: ${nearAmount(available)} free after storage and bonds (get_available_amount)${treasury ? `; funded with ${nearAmount(TREASURY)} by ${treasury.signer}, ${nearTx(treasury.tx)}` : ""}`);

  console.log("\nWho approves what (get_policy; Sputnik counts votes per role and proposal kind, not per amount)");
  for (const r of policy.roles) {
    const members = r.kind?.Group;
    if (!Array.isArray(members)) {
      console.log(`  ${r.name}: ${JSON.stringify(r.kind)}`);
      continue;
    }
    const n = (l) => votesNeeded(policy, r.name, l);
    const votable = LABELS.filter((l) => permits(r, l, "VoteApprove"));
    const counts =
      votable.length === 0
        ? "votes on nothing"
        : votable.length === LABELS.length
          ? `votes on every kind: ${n("bounty_done")} of ${members.length} pass a bounty_done, ${n("transfer")} of ${members.length} any other kind`
          : `votes only on ${votable.join(", ")}: ${votable.map((l) => `${n(l)} vote${n(l) === 1n ? "" : "s"}`).join(", ")} pass${votable.length === 1 && n(votable[0]) === 1n ? "es" : ""} it, whoever filed it and whatever the bounty pays`;
    console.log(`  ${r.name} (${members.join(", ") || "empty"}): may ${r.permissions.join(", ")}; ${counts}`);
  }

  console.log("\nBounties");
  if (bounties.length === 0) console.log("  none posted yet");
  const postedBy = new Map(["addBountyVote2", "addBounty2Vote2"].map((k) => step(k)).filter(Boolean).map((s) => [s.bountyId, s.proposalId]));
  for (const b of bounties) {
    const by = proposals.find((p) => p.id === postedBy.get(b.id) && p.kind.AddBounty && p.status === "Approved");
    const hours = Number(BigInt(b.max_deadline) / 3_600_000_000_000n);
    console.log(`  #${b.id}  ${nearAmount(b.amount)}, ${b.times} more payout${b.times === 1 ? "" : "s"} left, a claim may run ${hours} h: "${b.description}"`);
    if (by) console.log(`       posted by proposal ${by.id} (${who(by)})`);
  }

  console.log("\nClaims");
  for (const c of ["claim", "claim2"].map((k) => step(k)).filter(Boolean)) console.log(`  #${c.bountyId}  ${c.signer} staked ${nearAmount(c.deposit)}, ${nearTx(c.tx)}`);
  const open = await view(DAO, "get_bounty_claims", { account_id: X });
  console.log(`  open now for ${X}: ${open.length ? open.map((c) => `#${c.bounty_id}${c.completed ? " (reported done)" : ""}`).join(", ") : "none"}`);

  console.log("\nFinished and paid");
  const finished = proposals.filter((p) => p.kind.BountyDone && p.status === "Approved");
  if (finished.length === 0) console.log("  none yet");
  for (const p of finished) {
    const paidOut = proved.payouts.get(p.id);
    console.log(`  #${p.kind.BountyDone.bounty_id}  ${p.kind.BountyDone.receiver_id}: proposal ${p.id}, approved by ${approvers(p)}${paidOut ? `; paid ${nearAmount(paidOut.amount)} in ${nearTx(paidOut.tx)}` : "; no payout checked above: not counted"}`);
  }

  console.log("\nRole changes");
  const changes = proposals.filter((p) => (p.kind.AddMemberToRole || p.kind.RemoveMemberFromRole) && p.status === "Approved");
  if (changes.length === 0) console.log("  none yet");
  for (const p of changes) {
    const add = p.kind.AddMemberToRole;
    const { member_id, role } = add ?? p.kind.RemoveMemberFromRole;
    const cited = citedBounty(p.description);
    const checked = proved.roleChanges.find((c) => c.proposal === p.id);
    const cites = cited ? `cites bounty #${cited.bountyId}, BountyDone proposal ${cited.proposalId}${checked ? ": finished and paid, checked above" : ": not checked above"}` : "cites no bounty";
    console.log(`  proposal ${p.id}: ${member_id} ${add ? "added to" : "removed from"} "${role}" (${who(p)}); ${cites}`);
  }

  const turnedDown = proposals.filter((p) => p.status === "Rejected");
  if (turnedDown.length) {
    console.log("\nTurned down");
    for (const p of turnedDown) {
      const t = p.kind.Transfer;
      console.log(`  proposal ${p.id}: ${t ? `Transfer ${nearAmount(t.amount)} to ${t.receiver_id}` : Object.keys(p.kind)[0]} (${who(p)})`);
    }
  }

  console.log("\nContributors: one point per bounty finished and paid, each with its BountyDone proposal, who approved it in which role, and the payout");
  const receivers = [...new Set([X, ...finished.map((p) => p.kind.BountyDone.receiver_id)])];
  for (const account of receivers) {
    const points = finished.filter((p) => p.kind.BountyDone.receiver_id === account && proved.payouts.has(p.id));
    const total = points.reduce((sum, p) => sum + BigInt(proved.payouts.get(p.id).amount), 0n);
    const roles = policy.roles.filter((r) => r.kind?.Group?.includes(account)).map((r) => r.name);
    console.log(`  ${account}: ${points.length} point${points.length === 1 ? "" : "s"}, ${nearAmount(total)} from bounties; roles now: ${roles.join(", ") || "none"}`);
    for (const p of points) {
      const paidOut = proved.payouts.get(p.id);
      console.log(`    bounty #${p.kind.BountyDone.bounty_id}: BountyDone proposal ${p.id}, approved by ${approvers(p)}, paid ${nearAmount(paidOut.amount)}, ${nearTx(paidOut.tx)} (receipt ${paidOut.receipt})`);
    }
    for (const c of proved.roleChanges.filter((x) => x.member === account)) {
      console.log(`    joined "${c.role}": proposal ${c.proposal}, for bounty #${c.cites.bountyId} (BountyDone proposal ${c.cites.proposalId}), ${nearTx(c.tx)}`);
    }
    if (account === X && proved.send) {
      console.log(`    also paid by a vote, not a point: ${proved.send.value} wei of Sepolia ETH from the DAO's satchel to its own address ${proved.send.to}, https://sepolia.etherscan.io/tx/${proved.send.tx}`);
    }
    if (account === X && proved.give) {
      console.log(`    and by a vote, not a point: satchel #${RUN.tokenId} itself, the whole wallet, by proposal ${proved.give.proposalId}, ${nearTx(proved.give.tx)}`);
    }
  }
}

if (RUN === null) {
  console.log(`${FILE} doesn't exist yet: the bounty run hasn't been recorded, so there is nothing to check. node tools/dao-bounty-run.mjs prints its plan.`);
  process.exitCode = 1;
} else {
  process.exitCode = (await check()) ? 0 : 1;
}
