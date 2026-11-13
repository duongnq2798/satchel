// The second testnet DAO run, for the Social Money track: a bounty board with earned trust, on Sputnik
// DAO's own flows. A new DAO with a council of three posts a bounty (an AddBounty proposal, two
// votes), a contributor claims it with a bond and reports it done (bounty_claim, bounty_done), and one
// council vote approves the BountyDone proposal, so the DAO pays the contributor in NEAR and returns
// the bond. Two council votes then add the contributor to the role "trusted", by a proposal that
// cites the finished bounty, and post a smaller bounty, which the contributor claims, finishes and
// approves with its own trusted vote: paid with no council vote. The same DAO owns a new satchel, and
// a FunctionCall proposal that two council members approve has it sign a Sepolia send to the
// contributor's own Chain Signatures address. The council turns down a larger payout, and last, once
// the satchel's report reads PROVABLY CLEAN, two council votes give the contributor the satchel
// itself, the whole wallet. No new contract: every rule here is the DAO's policy.
//
// This module only builds things: the policy, each call's arguments, the plan, a contributor's
// address. It reads nothing and signs nothing. tools/dao-bounty-run.mjs runs the plan.
import { createHash } from "node:crypto";
import { builtPackage } from "../scripts/built.mjs";

const {
  DAO_SIGN_EVM_GAS,
  DAO_VOTE_GAS,
  MINT_DEPOSIT,
  TESTNET,
  TGAS,
  addressFromMpcKey,
  base58Encode,
  daoProposal,
  daoVote,
  decodeBase64,
  deriveMpcKey,
  encodeArgs,
  isAccountId,
} = await builtPackage();

export const NEAR = 10n ** 24n;
const GWEI = 10n ** 9n;
/** One day in nanoseconds, as Sputnik counts every period and deadline. */
export const DAY_NS = 86_400_000_000_000n;

/**
 * The factory's default code, as `get_default_code_hash` and `get_contracts_metadata` on
 * sputnikv2.testnet returned it on 2026-11-12: the same code satchel-club.sputnikv2.testnet runs.
 */
export const DAO_CODE = {
  factory: "sputnikv2.testnet",
  codeHash: "AA4nA45vauiac3jdVwJTzSdUP3oj2r1fDaPAb2mHdgcH",
  metadataVersion: [3, 31],
  commit: "7764926cfd3c47f62b5fcde231c251f3c3892887",
  version: "2.3.1",
};

/**
 * The accounts of the run. The third council member and the contributor were created with the
 * near CLI's faucet on 2026-11-12, 10 testnet NEAR each; the runner checks they still exist.
 */
export const DEFAULTS = {
  daoName: "satchel-bounty",
  factory: DAO_CODE.factory,
  council: ["satchel-nft.testnet", "buyer.satchel-nft.testnet", "satchel-council-1112.testnet"],
  contributor: "satchel-builder-1112.testnet",
};

/**
 * The testnet demo satchels the README quotes. They sign nothing, list nothing and move nowhere
 * until judging ends, so nothing here takes one of their ids.
 */
export const FROZEN = new Set(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);

/**
 * The satchel this run mints. A satchel's address follows from its id alone, so the OWNER funded
 * #10's Sepolia address before the mint, from another wallet; the mint goes ahead only if #10 is
 * next, and the funding step reads this transaction back instead of asking for one.
 */
export const RESERVED = {
  tokenId: "10",
  address: "0xcbd17720A542e151c8E5884659B5a8e5B3973500",
  fundingTx: "0x5d826ed0e8ff59f9250f0c3f901177d7e1e00c06fe7f8a3df02b95286a76063f",
  fundingWei: 5n * 10n ** 16n,
};

export const AMOUNTS = {
  /** What `create` attaches. satchel-club, created with 6 NEAR, kept 0.587 NEAR free of its storage. */
  daoDeposit: 6n * NEAR,
  /** What the third council member sends the treasury, so the payouts don't eat into storage. */
  treasury: 2n * NEAR,
  /** The first bounty, which one council vote pays. */
  bounty: NEAR / 2n,
  /** The second, smaller bounty, which the trusted contributor's own vote pays. */
  smallBounty: NEAR / 5n,
  /** The stake a claim locks. The DAO returns it when the BountyDone proposal passes or is rejected. */
  bountyBond: NEAR / 10n,
  /** The payout the council turns down: twice the first bounty, which the treasury could pay. */
  rejected: NEAR,
  /** Wei the DAO's satchel sends the contributor on Sepolia. */
  send: 10n ** 15n,
  /** What the OWNER is asked to send a satchel's Sepolia address that holds too little, and the least the run goes on with. */
  sepoliaFunding: 10n ** 16n,
  sepoliaMinimum: 5n * 10n ** 15n,
};

/**
 * Gas for each call. Unused gas comes back to the signer; a vote that runs a FunctionCall proposal
 * gets the same 300 TGas as the first run's (DAO_VOTE_GAS), so a policy that passed it early could
 * still pay for the call.
 */
export const GAS = {
  create: 150n * TGAS,
  mint: 50n * TGAS,
  propose: 100n * TGAS,
  vote: 150n * TGAS,
  callVote: DAO_VOTE_GAS,
  claim: 50n * TGAS,
  done: 100n * TGAS,
};

/** The Chain Signatures path the contributor's own Ethereum address is derived on, as NEAR's docs name it. */
export const CONTRIBUTOR_PATH = "ethereum-1";
export const SEPOLIA = 11155111;

/** The run's accounts, from the defaults and the flags, checked to be testnet names. */
export function runConfig(overrides = {}) {
  const cfg = { ...DEFAULTS, ...Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined && v !== null)) };
  cfg.dao = `${cfg.daoName}.${cfg.factory}`;
  assertTestnet(cfg);
  return cfg;
}

/**
 * Throws unless every account is a valid NEAR account id ending in `.testnet`, the council is three
 * different accounts and the contributor isn't one of them: the run never names a mainnet account.
 */
export function assertTestnet(cfg) {
  if (!Array.isArray(cfg.council) || cfg.council.length !== 3) throw new Error(`the council is three accounts, not ${JSON.stringify(cfg.council)}`);
  if (new Set(cfg.council).size !== 3) throw new Error(`the council names an account twice: ${cfg.council.join(", ")}`);
  if (cfg.council.includes(cfg.contributor)) throw new Error(`the contributor ${cfg.contributor} is on the council`);
  if (!/^[a-z\d]+(?:[-_][a-z\d]+)*$/.test(cfg.daoName)) throw new Error(`${cfg.daoName} is not a name the factory can create`);
  for (const id of [cfg.factory, cfg.dao, ...cfg.council, cfg.contributor]) {
    if (typeof id !== "string" || !isAccountId(id) || !id.endsWith(".testnet")) throw new Error(`${id} is not a testnet account: this run is testnet only`);
  }
}

// ---- The DAO's policy ---------------------------------------------------------------------------

const COUNCIL_PERMISSIONS = ["*:AddProposal", "*:VoteApprove", "*:VoteReject", "*:VoteRemove", "*:Finalize"];
/** The role whose members' own vote passes a bounty_done. Empty until a council vote adds someone. */
export const TRUSTED = "trusted";
const TRUSTED_PERMISSIONS = ["bounty_done:AddProposal", "bounty_done:VoteApprove"];

/** Every proposal kind's label in sputnikdao2 2.3.1 (`to_policy_label`, proposals.rs). */
export const PROPOSAL_LABELS = [
  "config", "policy", "add_member_to_role", "remove_member_from_role", "call", "upgrade_self", "upgrade_remote", "transfer",
  "set_vote_token", "add_bounty", "bounty_done", "vote", "factory_info_update", "policy_add_or_update_role", "policy_remove_role",
  "policy_update_default_vote_policy", "policy_update_parameters",
];

/**
 * The policy `create` passes (sputnikdao2 `Policy`, policy.rs). Three approval tiers, set by role and
 * proposal kind in each role's `vote_policy`:
 *
 *   small     bounty_done   one vote of a member of `trusted`, the contributor's own: a Weight "1"
 *   mid-size  bounty_done   one council vote, for any contributor: a Weight "1"
 *   large     anything else 2 of the 3 council members: the default Ratio [1, 2], 3 / 2 + 1 = 2.
 *                           Posting a bounty, a Transfer, a FunctionCall (the satchel's calls) and
 *                           adding a member to a role are all this tier
 *
 * How a vote counts (proposals.rs, `act_proposal`): `can_execute_action` finds every role of the
 * voter's whose permissions allow this action on this kind, `update_votes` adds 1 (RoleWeight) to
 * each of those roles, and `proposal_status` checks only those roles, each against its own vote
 * policy for the kind. So a trusted member's VoteApprove on a bounty_done counts in `trusted` and
 * passes at its threshold of one vote; on any other kind `trusted` allows nothing, and the vote is
 * refused (ERR_PERMISSION_DENIED). `trusted` may also file a bounty_done proposal, and nothing else.
 *
 * What the tiers are not: Sputnik's vote policy is per role and per kind, never per amount. A
 * bounty_done files no amount; the DAO pays the bounty's, which the council fixed when it posted the
 * bounty by two votes. A trusted member's vote passes the BountyDone of any bounty the council has
 * posted, its own claim or another contributor's, so the council keeps trusted payouts small by the
 * bounties it posts (here 0.2 NEAR, against 0.5 NEAR for the one a council vote paid).
 *
 * `trusted` starts as an empty group. Sputnik accepts that (`new` checks nothing in the policy), but
 * `Finalize` checks every role of the policy, not just the voter's, and an empty group's threshold,
 * min(1, 0) = 0 with quorum 0, would read no votes as enough: any council member could pass any open
 * proposal alone by finalizing it. So every vote policy here has quorum 1, the least number of votes
 * a role passes anything with, and no role ever passes a proposal no one voted for (passesUnvoted).
 * Quorum 1 changes no other count: the council still needs 2 of 3, and one vote for a bounty_done.
 *
 * `bounty_done` files its proposal through `add_proposal`, which checks the caller may add a
 * `bounty_done` proposal, so the `contributors` role, a group of the run's contributors, gets that
 * one permission and nothing else. Only an account whose roles allow bounty_done:AddProposal can
 * report its own claim done: a contributor, a trusted member, or a council member (*:AddProposal).
 * `bounty_claim` checks no permission, only the bond, the deadline and that the bounty has a claim
 * left: any account can claim a posted bounty. Each bounty here is done once, so a stranger who
 * claims one first holds it until that claim's deadline, at most a day, passes; then anyone can free
 * it with `bounty_done(id, account_id)` (bounties.rs), and the run's claim step can go on. Not
 * Everyone: `add_proposal` doesn't check that a BountyDone's proposer is its receiver, and the DAO
 * returns the claim's bond to the proposer, so any account could file one on someone else's claim
 * and, at the council's one vote on it or once it expired and was finalized, take that bond. A
 * trusted member could do the same and pass it with its own vote: that is part of the trust the
 * council gives. The bonds and periods:
 *
 *   proposal_bond 0          add_proposal and bounty_done must attach exactly this
 *   bounty_bond 0.1 NEAR     bounty_claim must attach exactly this
 *   proposal_period 1 day    each proposal is voted within minutes of the run filing it; a day lets
 *                            a run that stops partway go on later, and nothing stays open for long
 *   bounty_forgiveness 1 day giving up within a day of claiming returns the bond
 */
export function bountyPolicy(council, contributors, trusted = []) {
  if (!Array.isArray(contributors) || contributors.length === 0) throw new Error("the contributors role needs at least one account");
  const oneVote = () => ({ weight_kind: "RoleWeight", quorum: "1", threshold: "1" });
  return {
    roles: [
      { name: "council", kind: { Group: [...council] }, permissions: COUNCIL_PERMISSIONS, vote_policy: { bounty_done: oneVote() } },
      { name: "contributors", kind: { Group: [...contributors] }, permissions: ["bounty_done:AddProposal"], vote_policy: {} },
      { name: TRUSTED, kind: { Group: [...trusted] }, permissions: TRUSTED_PERMISSIONS, vote_policy: { bounty_done: oneVote() } },
    ],
    default_vote_policy: { weight_kind: "RoleWeight", quorum: "1", threshold: [1, 2] },
    proposal_bond: "0",
    proposal_period: DAY_NS.toString(),
    bounty_bond: AMOUNTS.bountyBond.toString(),
    bounty_forgiveness_period: DAY_NS.toString(),
  };
}

/**
 * The policy the DAO should hold at this point of `run`: the one it was created with, and the
 * contributor in `trusted` once the council's second vote on the trust proposal is in.
 */
export const expectedPolicy = (cfg, run = {}) => bountyPolicy(cfg.council, [cfg.contributor], done(run, "trustVote2") ? [cfg.contributor] : []);

/**
 * The votes a proposal of kind `label` needs within `role`, as sputnikdao2's `proposal_status`
 * counts them for a RoleWeight group: a Weight w is min(w, members), a Ratio n/d is min(n·members/d
 * + 1, members), and never less than the quorum. A role that isn't a group, or a TokenWeight policy,
 * throws: this run uses neither.
 */
export function votesNeeded(policy, role, label) {
  const found = policy.roles.find((r) => r.name === role);
  const group = found?.kind?.Group;
  if (!Array.isArray(group)) throw new Error(`${role} is not a group role`);
  const vp = found.vote_policy?.[label] ?? policy.default_vote_policy;
  if (vp.weight_kind !== "RoleWeight") throw new Error(`${role}'s ${label} policy is ${vp.weight_kind}, not RoleWeight`);
  const members = BigInt(new Set(group).size);
  const min = (a, b) => (a < b ? a : b);
  const t = vp.threshold;
  const weight = Array.isArray(t) ? min((BigInt(t[0]) * members) / BigInt(t[1]) + 1n, members) : min(BigInt(t), members);
  const quorum = BigInt(vp.quorum);
  return quorum > weight ? quorum : weight;
}

const permits = (role, label, action) => [`${label}:${action}`, `${label}:*`, `*:${action}`, "*:*"].some((p) => role.permissions.includes(p));

/**
 * The roles that let `account` take `action` ("AddProposal", "VoteApprove", ...) on a proposal of
 * kind `label`, as policy.rs's `can_execute_action` finds them: each role the account is in whose
 * permissions hold "label:action", "label:*", "*:action" or "*:*". A Member role, matched by token
 * balance, throws: this run has none.
 */
export function rolesAllowing(policy, account, label, action) {
  return policy.roles
    .filter((r) => {
      if (r.kind === "Everyone") return true;
      if (Array.isArray(r.kind?.Group)) return r.kind.Group.includes(account);
      throw new Error(`${r.name} is a ${JSON.stringify(r.kind)} role, which this run doesn't use`);
    })
    .filter((r) => permits(r, label, action))
    .map((r) => r.name);
}

/**
 * Whether one VoteApprove by `account` passes a new proposal of kind `label`: the vote adds 1 to each
 * of its roles (rolesAllowing) and passes if any of them needs only one vote. `proposal_status`
 * skips an Everyone role, which has no size. False when no role lets the account vote on the kind,
 * where act_proposal panics.
 */
export const passesAlone = (policy, account, label) =>
  rolesAllowing(policy, account, label, "VoteApprove").some((name) => policy.roles.find((r) => r.name === name).kind !== "Everyone" && votesNeeded(policy, name, label) <= 1n);

/**
 * The roles under which a proposal of kind `label` that no one voted for reads Approved when a
 * council member calls Finalize, which checks every group role of the policy: one whose threshold
 * comes to 0, an empty group with quorum 0, passes it. The run's policy has quorum 1, so none.
 */
export const passesUnvoted = (policy, label) =>
  policy.roles.filter((r) => Array.isArray(r.kind?.Group) && votesNeeded(policy, r.name, label) === 0n).map((r) => r.name);

/**
 * The roles in which one member's vote passes a proposal of kind `label`, as get_policy reads: a
 * group with at least one member, allowed to approve the kind, that needs one vote. The second
 * bounty's work is to read this back.
 */
export const oneVoteRoles = (policy, label) =>
  policy.roles.filter((r) => Array.isArray(r.kind?.Group) && r.kind.Group.length > 0 && permits(r, label, "VoteApprove") && votesNeeded(policy, r.name, label) === 1n);

/** JSON with object keys sorted and every array of strings sorted: a policy's sets and maps come back in any order. */
export function canonical(value) {
  return JSON.stringify(value, (_, v) => {
    if (Array.isArray(v)) return v.every((x) => typeof x === "string") ? [...v].sort() : v;
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)));
    return v;
  });
}

/** The factory's `create` arguments: the DAO's `new` arguments, base64 JSON, and the same decoded. */
export function createArgs(cfg) {
  const decoded = {
    config: {
      name: cfg.daoName,
      purpose: "A Sputnik DAO bounty board whose treasury owns a satchel: one wallet on 16 EVM chains (satchelnft.xyz)",
      metadata: "",
    },
    policy: bountyPolicy(cfg.council, [cfg.contributor]),
  };
  return { args: { name: cfg.daoName, args: encodeArgs(decoded) }, decodedArgs: decoded };
}

// ---- Proposals and bounty calls -----------------------------------------------------------------

/** A bounty as an AddBounty proposal posts it (sputnikdao2 `Bounty`): NEAR (token ""), done once, a day from claim. */
const bountyOf = (description, amount) => ({ description, token: "", amount: amount.toString(), times: 1, max_deadline: DAY_NS.toString() });

/** The first bounty: 0.5 NEAR, which one council vote pays. */
export const bounty = (tokenId) => bountyOf(`Testnet demo bounty: read satchel #${tokenId}'s clean-transfer report and post its verdict`, AMOUNTS.bounty);

/** The second: 0.2 NEAR, small enough for the council to let a trusted contributor's own vote pay it. */
export const smallBounty = () => bountyOf("Testnet demo bounty: read the DAO's policy back and post who can pass a bounty_done with one vote", AMOUNTS.smallBounty);

export const addBountyProposal = (tokenId) => ({
  proposal: { description: `Post a bounty of 0.5 NEAR: satchel #${tokenId}'s clean-transfer report`, kind: { AddBounty: { bounty: bounty(tokenId) } } },
});

export const addSmallBountyProposal = () => ({
  proposal: { description: "Post a bounty of 0.2 NEAR, for a trusted contributor's own vote: read the DAO's policy back", kind: { AddBounty: { bounty: smallBounty() } } },
});

/**
 * The AddMemberToRole proposal that makes `member` trusted. Its description cites the finished
 * bounty and the BountyDone proposal that paid it; Sputnik checks nothing in a description, so
 * scripts/check-dao-bounty.mjs reads the citation back (citedBounty) and checks it.
 */
export const trustProposal = (member, bountyId, doneProposalId) => ({
  proposal: {
    description: `Earned trust: ${member} finished bounty ${bountyId}, paid by BountyDone proposal ${doneProposalId}. Add ${member} to "${TRUSTED}", whose own vote passes a bounty_done`,
    kind: { AddMemberToRole: { member_id: member, role: TRUSTED } },
  },
});

/** The bounty and the BountyDone proposal a trust proposal's description cites, or null. */
export function citedBounty(description) {
  const m = /finished bounty (\d+), paid by BountyDone proposal (\d+)\./.exec(description ?? "");
  return m ? { bountyId: Number(m[1]), proposalId: Number(m[2]) } : null;
}

/** A NEAR payout by proposal (token_id "" is NEAR, and NEAR takes no msg). The run's council turns this one down. */
export const transferProposal = (receiver, amount, description) => ({
  proposal: { description, kind: { Transfer: { token_id: "", receiver_id: receiver, amount: amount.toString(), msg: null } } },
});

/** `bounty_claim`: the claimer's deadline, which must not pass the bounty's `max_deadline`. */
export const claimArgs = (bountyId) => ({ id: bountyId, deadline: DAY_NS.toString() });

/** `bounty_done` without `account_id`: the claimer reports their own claim, which files a BountyDone proposal. */
export const doneArgs = (bountyId, description) => ({ id: bountyId, description });

/** The kind a BountyDone proposal has in `get_proposal`. */
export const bountyDoneKind = (bountyId, receiver) => ({ BountyDone: { bounty_id: bountyId, receiver_id: receiver } });

// ---- The contributor's address and the Sepolia send ---------------------------------------------

/**
 * The address `account` controls on every EVM chain through Chain Signatures, at `path`: the key
 * the MPC network derives when `account` itself asks `net.mpc` to sign. It is derived here from
 * the root key the package pins; the runner also checks `derived_public_key` returns the same key.
 */
export function contributorAddress(account, net = TESTNET, path = CONTRIBUTOR_PATH) {
  const publicKey = deriveMpcKey(net.mpcRootKey, account, path);
  return { account, path, mpc: net.mpc, publicKey, address: addressFromMpcKey(publicKey) };
}

/**
 * Fees for a send the DAO votes on. The transaction is fixed when the proposal is filed and goes
 * out after two votes, so the fee cap leaves room: at least 5 gwei, with a 1 gwei tip, the first
 * DAO run's fees, or twice the base fee plus the tip if that is more.
 */
export function sendFees(baseFee, priorityEstimate) {
  const priority = priorityEstimate > GWEI ? priorityEstimate : GWEI;
  const cap = 2n * baseFee + priority;
  return { maxPriorityFeePerGas: priority, maxFeePerGas: cap > 5n * GWEI ? cap : 5n * GWEI };
}

/** The node's estimate plus 20%. Sepolia charged about 207k gas on 2026-11-12 to send to an address never used, not 21000. */
export const sendGas = (estimate) => (estimate <= 21_000n ? 21_000n : (estimate * 12n) / 10n);

// ---- The treasury's NEAR, sent with the near CLI ------------------------------------------------

/** The near CLI arguments that sign a NEAR transfer as `signer` without sending it (`display`). */
export function transferCliArgs(net, signer, receiver, yocto, keychain = "legacy") {
  return [
    "tokens",
    signer,
    "send-near",
    receiver,
    `${BigInt(yocto)} yoctonear`,
    "network-config",
    net.id,
    keychain === "os" ? "sign-with-keychain" : "sign-with-legacy-keychain",
    "display",
  ];
}

const KEY_LENGTH = { 0: 32, 1: 64 };
const SIGNATURE_LENGTH = { 0: 64, 1: 65 };
const TRANSFER = 3;

/**
 * Decodes a borsh SignedTransaction (V0) that holds exactly one Transfer, as near-cli.ts's
 * `decodeSignedTx` does for a function call. Anything else is refused rather than skipped.
 */
export function decodeSignedTransfer(base64) {
  const bytes = Uint8Array.from(Buffer.from(base64, "base64"));
  let at = 0;
  const take = (n) => {
    if (at + n > bytes.length) throw new Error("The signed transaction ends early");
    const out = bytes.subarray(at, at + n);
    at += n;
    return out;
  };
  const u32 = () => Buffer.from(take(4)).readUInt32LE(0);
  const u64 = () => Buffer.from(take(8)).readBigUInt64LE(0);
  const string = () => new TextDecoder("utf-8", { fatal: true }).decode(take(u32()));
  if (bytes[0] === 1) throw new Error("The near CLI signed a V1 transaction; sign with a full access key");
  const signerId = string();
  const keyType = take(1)[0];
  if (KEY_LENGTH[keyType] === undefined) throw new Error(`Unknown key type ${keyType}`);
  const publicKey = `${keyType === 0 ? "ed25519" : "secp256k1"}:${base58Encode(take(KEY_LENGTH[keyType]))}`;
  const nonce = u64();
  const receiverId = string();
  take(32); // block hash
  if (u32() !== 1) throw new Error("The signed transaction must hold exactly one action");
  if (take(1)[0] !== TRANSFER) throw new Error("The signed transaction's action is not a transfer");
  const lo = u64();
  const deposit = (u64() << 64n) | lo;
  const unsigned = bytes.subarray(0, at);
  if (take(1)[0] !== keyType) throw new Error("The signature's type is not the key's");
  take(SIGNATURE_LENGTH[keyType]);
  if (at !== bytes.length) throw new Error("The signed transaction has trailing bytes");
  const hash = base58Encode(createHash("sha256").update(unsigned).digest());
  return { signerId, publicKey, nonce, receiverId, deposit, hash };
}

/** Throws unless the near CLI signed exactly this transfer, and nothing else. */
export function assertTransferAsAsked(decoded, signer, receiver, yocto) {
  const differences = [];
  if (decoded.signerId !== signer) differences.push(`the signer is ${decoded.signerId}, not ${signer}`);
  if (decoded.receiverId !== receiver) differences.push(`the receiver is ${decoded.receiverId}, not ${receiver}`);
  if (decoded.deposit !== BigInt(yocto)) differences.push(`the amount is ${decoded.deposit}, not ${yocto}`);
  if (differences.length > 0) throw new Error(`The near CLI signed something else, so nothing was sent: ${differences.join("; ")}`);
}

// ---- The plan -----------------------------------------------------------------------------------

/** "0.5 NEAR", "6 NEAR", "0.000000000000000000000001 NEAR". */
export function formatNear(yocto) {
  const v = BigInt(yocto);
  const whole = v / NEAR;
  const fraction = (v % NEAR).toString().padStart(24, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""} NEAR`;
}

/** The step of `run` with `key`, or undefined. */
export const done = (run, key) => run.steps?.find((s) => s.key === key);

/**
 * `value` with every base64 JSON `args` string decoded in place: a FunctionCall proposal's
 * arguments, the factory's. A string that isn't base64 JSON is left as it is.
 */
export function argsDecoded(value) {
  if (Array.isArray(value)) return value.map(argsDecoded);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([k, x]) => {
      if (k !== "args" || typeof x !== "string") return [k, argsDecoded(x)];
      try {
        return [k, argsDecoded(JSON.parse(decodeBase64(x)))];
      } catch {
        // Not base64 JSON: the factory's `args` is, and a call's always is here.
        return [k, x];
      }
    }),
  );
}

/**
 * Every token id an action names: `token_id` anywhere in its arguments, inside a FunctionCall
 * proposal's base64 arguments too. The runner refuses an action that names a frozen satchel.
 */
export function tokenIdsIn(value) {
  const found = [];
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v)) {
      if (k === "token_id" && (typeof x === "string" || typeof x === "number")) found.push(String(x));
      else walk(x);
    }
  };
  walk(argsDecoded(value));
  return found;
}

/**
 * The run, step by step, from what `run` (deployments/testnet-dao-bounty.json) already holds and
 * what the runner read live (`live.sendTx`, the Sepolia transaction for the send proposal; the
 * two `bounty_done` descriptions, which quote what the contributor read). A value not known yet,
 * such as the id the mint returns, is shown as a <placeholder>; the runner never sends a step that
 * still holds one.
 *
 * Each step: key, title, by ("controller" signs with the near CLI, "owner" is done by hand, "cli"
 * runs satchel-nft from this repository), signer, receiver, method or action, args, deposit, gas,
 * checks (read before it runs) and expects (read back after).
 */
export function buildPlan(cfg, run = {}, live = {}) {
  const [A, B, C] = cfg.council;
  const X = cfg.contributor;
  const DAO = cfg.dao;
  const net = TESTNET;
  const minted = done(run, "mint")?.tokenId;
  const tokenId = minted ?? "<N, the id the mint returns>";
  /** The satchel in titles and checks: its id once minted, N before. */
  const N = minted ?? "N";
  const satchelAddress = run.address ?? "<the satchel's address>";
  /** Whether the satchel is the one whose address the OWNER funded before the run (or will be, before the mint). */
  const reserved = (minted ?? RESERVED.tokenId) === RESERVED.tokenId;
  const x = contributorAddress(X);
  const proposalId = (key) => done(run, key)?.proposalId ?? `<id ${key} returns>`;
  const bountyId = done(run, "addBountyVote2")?.bountyId ?? 0;
  const smallId = done(run, "addBounty2Vote2")?.bountyId ?? 1;
  // bounty_done files its proposal itself, so that step records the kind get_proposal returned.
  const filedKind = (key, fallback) => done(run, key)?.args?.proposal?.kind ?? done(run, key)?.kind ?? fallback;
  const call = (key, title, signer, receiver, method, args, deposit, gas, checks, expects, extra = {}) => ({
    key, title, by: "controller", signer, receiver, method, args, deposit: deposit.toString(), gas: gas.toString(), checks, expects, ...extra,
  });
  const vote = (key, title, signer, filedBy, action, checks, expects, gas = GAS.vote) =>
    call(key, title, signer, DAO, "act_proposal", daoVote(proposalId(filedBy), filedKind(filedBy, `<the kind ${filedBy} filed>`), action), 0n, gas, checks, expects, { proposalOf: filedBy });
  const open = (filedBy) => `the proposal ${filedBy} filed is InProgress, inside its one-day period, and this signer hasn't voted on it`;
  const created = createArgs(cfg);
  const sendTx = live.sendTx ?? done(run, "sendProposal")?.contractTx ?? {
    chain_id: String(SEPOLIA),
    nonce: "0",
    max_priority_fee_per_gas: "<the node's tip, at least 1 gwei>",
    max_fee_per_gas: "<twice the base fee plus the tip, at least 5 gwei>",
    gas_limit: "<eth_estimateGas from the funded address, plus 20%>",
    to: x.address,
    value: AMOUNTS.send.toString(),
    data: "0x",
  };
  const sendProposal = daoProposal(net).signEvm(tokenId, sendTx);
  const giveProposal = daoProposal(net).transfer(tokenId, X, `Pay ${X} with satchel #${N}, the whole wallet: nft_transfer, after its clean-transfer report read PROVABLY CLEAN`);
  const later = `Bounty ${bountyId} was paid: satchel #${N}'s report was read and posted`;
  const stillOneSend = `satchel #${N}'s signing_record is still the one the gift was filed with: Sepolia nonce 0, one signature, nothing else`;
  const description = (key, fallback) => live[`${key}Description`] ?? done(run, key)?.args?.description ?? fallback;

  return [
    call(
      "create",
      `Create the DAO ${DAO}: council ${A}, ${B} and ${C}, whose one vote passes a bounty_done proposal and two of three anything else; the contributor ${X} may file a bounty_done proposal and nothing else; the role "${TRUSTED}", empty, whose members may file a bounty_done proposal and pass one with their own vote, and nothing else; quorum 1 in every vote policy; bounty bond 0.1 NEAR, proposal bond 0, proposals open for one day`,
      A, cfg.factory, "create", created.args, AMOUNTS.daoDeposit, GAS.create,
      [
        "the NEAR RPC serves testnet (status chain_id) and every account named is a .testnet account",
        `${DAO} does not exist yet`,
        `${cfg.factory}'s get_default_code_hash is ${DAO_CODE.codeHash}, which get_contracts_metadata lists as version [3,31], commit 7764926`,
        `${A}, ${B}, ${C} and ${X} exist, and the legacy keychain has a key file for each`,
        `${A} holds at least 6 NEAR + 0.1 NEAR for the mint + 0.1 NEAR for gas`,
      ],
      [`${DAO} runs code ${DAO_CODE.codeHash}, version() is 2.3.1`, `get_policy equals the policy above (roles, sets and maps in any order), with "${TRUSTED}" empty`],
      { decodedArgs: created.decodedArgs },
    ),
    {
      key: "treasury",
      title: `A member funds the treasury: ${C} sends 2 NEAR to ${DAO}`,
      by: "controller", signer: C, receiver: DAO, action: "Transfer", deposit: AMOUNTS.treasury.toString(),
      checks: [`${DAO} exists with the policy above`, `${C} holds at least 2.1 NEAR`],
      expects: [`get_available_amount on ${DAO} is at least 0.5 NEAR + 0.2 NEAR + 0.2 NEAR, after its storage and bonds`],
    },
    call(
      "mint",
      `Mint satchel #${N} straight to the DAO`,
      A, net.contract, "mint", { receiver_id: DAO }, MINT_DEPOSIT, GAS.mint,
      [
        `nft_total_supply + 1 is the id the mint will return, and it is #${RESERVED.tokenId}, whose Sepolia address ${RESERVED.address} the OWNER funded for this run: never a demo satchel (#1 to #9)`,
        `${A} holds at least 0.2 NEAR`,
      ],
      [`the mint returned that id, nft_token shows ${DAO} as its owner`, "its address is derived for satchel/<N>, and derived_public_key on the MPC contract returns the same key"],
    ),
    call(
      "addBounty",
      `Proposal: post bounty ${bountyId}, 0.5 NEAR, done once, within a day of a claim`,
      A, DAO, "add_proposal", addBountyProposal(tokenId), 0n, GAS.propose,
      [`get_policy's proposal_bond is 0, the deposit attached`, `get_last_bounty_id is ${bountyId}`],
      ["add_proposal returns the new id; get_proposal shows the kind as filed, InProgress"],
    ),
    vote("addBountyVote1", `Vote 1 of 2 approving the AddBounty proposal, by ${A}`, A, "addBounty", "VoteApprove", [open("addBounty")], [
      "the proposal is still InProgress: one council vote does not post a bounty",
    ]),
    vote("addBountyVote2", `Vote 2 of 2 approving the AddBounty proposal, by ${B}: the DAO posts bounty ${bountyId}`, B, "addBounty", "VoteApprove", [open("addBounty")], [
      `the proposal is Approved; get_last_bounty_id is ${bountyId + 1}; get_bounty(${bountyId}) is the bounty as filed`,
    ]),
    call(
      "claim",
      `${X} claims bounty ${bountyId}, staking the 0.1 NEAR bond`,
      X, DAO, "bounty_claim", claimArgs(bountyId), AMOUNTS.bountyBond, GAS.claim,
      [`get_bounty(${bountyId}) has times 1 and no claims yet`, "the deposit is get_policy's bounty_bond, exactly", `${X} holds at least 0.2 NEAR`],
      [`get_bounty_claims(${X}) holds bounty ${bountyId}, not completed`],
    ),
    call(
      "done",
      `${X} reports bounty ${bountyId} done: bounty_done files a BountyDone proposal`,
      X, DAO, "bounty_done", doneArgs(bountyId, description("done", `<Bounty ${bountyId} done: satchel #${N}'s clean-transfer report reads (the verdict)>`)), 0n, GAS.done,
      [`${X}'s claim is open and its deadline a day away`, `the satchel-nft package reads satchel #${N}'s report (buildReport, read only) for the verdict the description quotes`],
      [`get_proposal(get_last_proposal_id before the call) is BountyDone { bounty_id: ${bountyId}, receiver_id: ${X} }, filed by ${X}, InProgress; the claim reads completed`],
    ),
    vote("doneVote", `Mid-size: one council vote approves the BountyDone proposal, by ${C}: the DAO pays ${X} 0.5 NEAR and returns the bond`, C, "done", "VoteApprove", [
      open("done"),
      `get_available_amount on ${DAO} covers 0.5 NEAR`,
      `${X} is not in "${TRUSTED}" yet, so its own vote couldn't pass this proposal`,
    ], [
      `the proposal is Approved with one vote; the vote's receipts hold a 0.5 NEAR transfer and a 0.1 NEAR transfer from ${DAO} to ${X}, both successful`,
      `get_bounty(${bountyId}) has times 0 and ${X} has no claim left`,
    ]),
    call(
      "trustProposal",
      `Proposal: earned trust. ${C} proposes adding ${X} to "${TRUSTED}", citing bounty ${bountyId} and the BountyDone proposal that paid it`,
      C, DAO, "add_proposal", trustProposal(X, bountyId, proposalId("done")), 0n, GAS.propose,
      [
        `the BountyDone proposal the description cites is Approved, for bounty ${bountyId}, paid to ${X}; get_bounty(${bountyId}) has times 0`,
        `get_policy has the role "${TRUSTED}" with only ${TRUSTED_PERMISSIONS.join(" and ")}, and ${X} isn't in it`,
      ],
      ["add_proposal returns the new id; get_proposal shows the kind as filed"],
    ),
    vote("trustVote1", `Vote 1 of 2 approving the trust proposal, by ${C}`, C, "trustProposal", "VoteApprove", [open("trustProposal")], [
      `the proposal is still InProgress: one council vote does not change a role, and "${TRUSTED}" is still empty`,
    ]),
    vote("trustVote2", `Vote 2 of 2 approving the trust proposal, by ${A}: ${X} joins "${TRUSTED}"`, A, "trustProposal", "VoteApprove", [open("trustProposal")], [
      `the proposal is Approved; get_policy is the created one with ${X} in "${TRUSTED}", and nothing else changed`,
    ]),
    call(
      "addBounty2",
      `Proposal: post bounty ${smallId}, 0.2 NEAR, done once, within a day of a claim: small enough for a trusted contributor's own vote`,
      B, DAO, "add_proposal", addSmallBountyProposal(), 0n, GAS.propose,
      [`get_policy is the created one with ${X} in "${TRUSTED}"; its proposal_bond is 0, the deposit attached`, `get_last_bounty_id is ${smallId}`],
      ["add_proposal returns the new id; get_proposal shows the kind as filed, InProgress"],
    ),
    vote("addBounty2Vote1", `Vote 1 of 2 approving the second AddBounty proposal, by ${B}`, B, "addBounty2", "VoteApprove", [open("addBounty2")], [
      "the proposal is still InProgress",
    ]),
    vote("addBounty2Vote2", `Vote 2 of 2 approving the second AddBounty proposal, by ${C}: the DAO posts bounty ${smallId}`, C, "addBounty2", "VoteApprove", [open("addBounty2")], [
      `the proposal is Approved; get_last_bounty_id is ${smallId + 1}; get_bounty(${smallId}) is the bounty as filed`,
    ]),
    call(
      "claim2",
      `${X} claims bounty ${smallId}, staking the 0.1 NEAR bond`,
      X, DAO, "bounty_claim", claimArgs(smallId), AMOUNTS.bountyBond, GAS.claim,
      [`get_bounty(${smallId}) has times 1 and no claims yet`, "the deposit is get_policy's bounty_bond, exactly", `${X} holds at least 0.2 NEAR`],
      [`get_bounty_claims(${X}) holds bounty ${smallId}, not completed`],
    ),
    call(
      "done2",
      `${X} reports bounty ${smallId} done: bounty_done files a BountyDone proposal`,
      X, DAO, "bounty_done", doneArgs(smallId, description("done2", `<Bounty ${smallId} done: who get_policy says passes a bounty_done with one vote>`)), 0n, GAS.done,
      [`${X}'s claim is open and its deadline a day away`, "the runner reads get_policy for the roles whose one vote passes a bounty_done, which the description quotes"],
      [`get_proposal(get_last_proposal_id before the call) is BountyDone { bounty_id: ${smallId}, receiver_id: ${X} }, filed by ${X}, InProgress; the claim reads completed`],
    ),
    vote("done2Vote", `Small: ${X} approves its own BountyDone proposal with its "${TRUSTED}" vote, and no council member votes: the DAO pays ${X} 0.2 NEAR and returns the bond`, X, "done2", "VoteApprove", [
      open("done2"),
      `get_policy has ${X} in "${TRUSTED}", not on the council, and "${TRUSTED}" needs one vote for a bounty_done: the vote counts in "${TRUSTED}" only`,
      `no one has voted on the proposal; get_available_amount on ${DAO} covers 0.2 NEAR`,
    ], [
      `the proposal is Approved with ${X}'s vote alone; the vote's receipts hold a 0.2 NEAR transfer and a 0.1 NEAR transfer from ${DAO} to ${X}, both successful`,
      `get_bounty(${smallId}) has times 0 and ${X} has no claim left`,
    ]),
    {
      key: "fundSepolia",
      title: reserved
        ? `The OWNER funded satchel #${N}'s address ${RESERVED.address} with 0.05 Sepolia ETH before the run (${RESERVED.fundingTx.slice(0, 10)}…): the run reads that transaction back`
        : `The OWNER funds satchel #${N}'s address ${satchelAddress} on Sepolia with about 0.01 Sepolia ETH`,
      by: "owner",
      checks: [
        `${satchelAddress} holds at least 0.005 Sepolia ETH (eth_getBalance), and has sent nothing (nonce 0)`,
        reserved
          ? `${RESERVED.fundingTx} is a successful Sepolia transaction to ${RESERVED.address}; --funding-tx <hash> names another`
          : `--funding-tx <hash> names a successful Sepolia transaction to ${satchelAddress}: without it the step is not recorded, and the run stops here`,
      ],
      expects: ["the funding transaction is read back and recorded, with the balance read"],
    },
    call(
      "sendProposal",
      `Proposal: the DAO has satchel #${N} sign ${AMOUNTS.send} wei on Sepolia at nonce 0 to ${X}'s own Chain Signatures address ${x.address} (path ${CONTRIBUTOR_PATH})`,
      A, DAO, "add_proposal", sendProposal, 0n, GAS.propose,
      [
        `satchel #${N} is owned by ${DAO}, not listed, and not a demo satchel`,
        `${x.address} is the address of the key derived_public_key({ path: "${CONTRIBUTOR_PATH}", predecessor: "${X}" }) returns on ${net.mpc}`,
        `${satchelAddress}'s next nonce on Sepolia is 0 and it can pay the most this costs; no open proposal signs nonce 0 for satchel #${N} (nonceClash)`,
        "evm_signing_hash of the transaction equals viem's signing hash of it",
      ],
      ["add_proposal returns the new id; get_proposal shows the kind as filed"],
      { decodedArgs: { token_id: tokenId, tx: sendTx }, actionGas: DAO_SIGN_EVM_GAS.toString() },
    ),
    vote("sendVote1", `Vote 1 of 2 approving the send, by ${A}`, A, "sendProposal", "VoteApprove", [open("sendProposal")], [
      "the proposal is still InProgress and the vote made no sign_evm call",
    ], GAS.callVote),
    vote("sendVote2", `Vote 2 of 2 approving the send, by ${C}: the DAO calls sign_evm and ${net.mpc} signs`, C, "sendProposal", "VoteApprove", [open("sendProposal")], [
      "the proposal is Approved; one sign_evm call by the DAO for the transaction as filed; the MPC signature recovers to the satchel's address",
    ], GAS.callVote),
    {
      key: "finish",
      title: `satchel-nft dao finish <sendVote2's transaction> --yes: broadcast the signed send on Sepolia`,
      by: "cli",
      command: `node packages/satchel-nft/bin/satchel-nft.js dao finish ${done(run, "sendVote2")?.tx ?? "<sendVote2's transaction>"} --yes --json --network testnet`,
      checks: [`dao finish checks, before it sends: the contract hashes the transaction as viem does, the MPC signature recovers to ${satchelAddress}, nonce 0 is its next nonce and its balance covers the most the send can cost`],
      expects: [`Sepolia mined it: from ${satchelAddress} to ${x.address}, nonce 0, ${AMOUNTS.send} wei, status 1`],
    },
    call(
      "rejectProposal",
      `Proposal: ${C} asks the DAO to pay ${X} 1 NEAR more, by Transfer`,
      C, DAO, "add_proposal", transferProposal(X, AMOUNTS.rejected, `${later}. Pay ${X} 1 NEAR more for it`), 0n, GAS.propose,
      ["get_policy's proposal_bond is 0"],
      ["add_proposal returns the new id; get_proposal shows the kind as filed"],
    ),
    vote("rejectApprove", `${C} votes to approve the transfer`, C, "rejectProposal", "VoteApprove", [open("rejectProposal")], [
      "the proposal is still InProgress: one council vote passes a bounty_done, not a transfer",
    ]),
    vote("reject1", `${A} votes to reject the transfer`, A, "rejectProposal", "VoteReject", [open("rejectProposal")], ["the proposal is still InProgress"]),
    vote("reject2", `${B} votes to reject the transfer: 2 of 3 turn it down`, B, "rejectProposal", "VoteReject", [open("rejectProposal")], [
      `the proposal is Rejected, and the vote's receipts move no NEAR to ${X}`,
    ]),
    call(
      "giveProposal",
      `Proposal: pay ${X} with a whole wallet. ${A} proposes the DAO give satchel #${N} to ${X} with nft_transfer (1 yoctoNEAR), as the first DAO run's proposal 1 did`,
      A, DAO, "add_proposal", giveProposal, 0n, GAS.propose,
      [
        `satchel #${N} is owned by ${DAO}, not listed, and not a demo satchel`,
        `its record lists one signature, Sepolia nonce 0, the send above, and nothing else, and its clean-transfer report (buildReport) reads PROVABLY CLEAN: Sepolia's finalized nonce for ${satchelAddress} is past 0. Sepolia finalizes about 13 minutes after the send; until then the step stops and is run again`,
      ],
      ["add_proposal returns the new id; get_proposal shows the kind as filed; the report read before is recorded, and the record it was read with"],
    ),
    vote("giveVote1", `Vote 1 of 2 approving the gift, by ${A}`, A, "giveProposal", "VoteApprove", [open("giveProposal"), `satchel #${N} is still ${DAO}'s, not listed`, stillOneSend], [
      "the proposal is still InProgress and the vote made no nft_transfer call",
    ], GAS.callVote),
    vote("giveVote2", `Vote 2 of 2 approving the gift, by ${B}: the DAO calls nft_transfer and ${X} owns satchel #${N}`, B, "giveProposal", "VoteApprove", [open("giveProposal"), `satchel #${N} is still ${DAO}'s, not listed`, stillOneSend], [
      `the proposal is Approved; one nft_transfer call by the DAO, as filed, successful; nft_token shows ${X} as the owner`,
      `${X}'s report on satchel #${N} (buildReport) is read and recorded`,
    ], GAS.callVote),
  ];
}

/**
 * Whether the evidence file `run` is the record of the run `cfg` describes: the same DAO and
 * contributor, and the council in the same order, not as a set, since A, B and C each sign their
 * own steps and scripts/check-dao-bounty.mjs reads them from the file in that order.
 */
export const sameRun = (run, cfg) => run.dao === cfg.dao && JSON.stringify(run.council) === JSON.stringify(cfg.council) && run.contributor === cfg.contributor;

/** The first step `run` doesn't hold yet, or undefined once the run is complete. */
export const nextStep = (plan, run) => plan.find((s) => !done(run, s.key));

/**
 * Whether a step still holds a <placeholder> anywhere, inside a FunctionCall proposal's base64
 * arguments too (the send proposal's fees before they are read): such a step is never sent.
 */
export const unresolved = (step) => /<[^>]*>/.test(JSON.stringify(argsDecoded([step.args, step.receiver, step.signer, step.command ?? null])));
