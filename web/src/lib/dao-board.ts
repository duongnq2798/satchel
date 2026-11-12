import {
  type DaoBounty,
  type DaoBountyClaim,
  type DaoPolicy,
  type DaoProposal,
  type DaoProposalKind,
  type DaoRole,
  type DaoVotePolicy,
  type IndexedTx,
  type Network,
  chainInfo,
  decodeBase64,
  formatBalance,
  proposedSignatures,
} from "satchel-nft";

/**
 * The bounty board: a Sputnik DAO's policy, bounties, claims and proposals put in plain words. It
 * follows sputnikdao2 2.3.1, the version testnet's `sputnikv2.testnet` factory deploys
 * (github.com/near-daos/sputnik-dao-contract at 7764926: policy.rs, bounties.rs, proposals.rs and
 * views.rs). Everything here shapes answers the page already read; nothing reads or signs.
 */

/** The DAO the bounty run uses, on testnet. */
export const BOUNTY_DAO = "satchel-bounty.sputnikv2.testnet";

/** Every proposal kind, and the label the policy names it by (`to_policy_label`), the bounty kinds first. */
const KINDS: readonly [kind: string, label: string][] = [
  ["BountyDone", "bounty_done"],
  ["AddBounty", "add_bounty"],
  ["Transfer", "transfer"],
  ["FunctionCall", "call"],
  ["AddMemberToRole", "add_member_to_role"],
  ["RemoveMemberFromRole", "remove_member_from_role"],
  ["Vote", "vote"],
  ["ChangeConfig", "config"],
  ["ChangePolicy", "policy"],
  ["ChangePolicyAddOrUpdateRole", "policy_add_or_update_role"],
  ["ChangePolicyRemoveRole", "policy_remove_role"],
  ["ChangePolicyUpdateDefaultVotePolicy", "policy_update_default_vote_policy"],
  ["ChangePolicyUpdateParameters", "policy_update_parameters"],
  ["UpgradeSelf", "upgrade_self"],
  ["UpgradeRemote", "upgrade_remote"],
  ["SetStakingContract", "set_vote_token"],
  ["FactoryInfoUpdate", "factory_info_update"],
];
export const KIND_LABELS: readonly string[] = KINDS.map(([, label]) => label);

/** "BountyDone" for `{ BountyDone: {…} }`, "Vote" for "Vote". */
export function kindName(kind: DaoProposalKind): string {
  if (typeof kind === "string") return kind;
  return Object.keys(kind)[0] ?? "";
}

/** The policy's label for a proposal's kind, or null for a kind 2.3.1 doesn't have. */
export function kindLabel(kind: DaoProposalKind): string | null {
  const name = kindName(kind);
  return KINDS.find(([k]) => k === name)?.[1] ?? null;
}

/** The body of a `{ <name>: body }` kind, or null when the proposal is of another kind. */
function kindBody(p: DaoProposal, name: string): Record<string, unknown> | null {
  const kind = p.kind;
  if (typeof kind !== "object" || kind === null || !(name in kind)) return null;
  const body = (kind as Record<string, unknown>)[name];
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;
}

/** A BountyDone proposal's bounty and the contributor it names, or null for any other proposal. */
export function bountyDone(p: DaoProposal): { bountyId: number; receiver: string } | null {
  const body = kindBody(p, "BountyDone");
  return body && typeof body.bounty_id === "number" && typeof body.receiver_id === "string"
    ? { bountyId: body.bounty_id, receiver: body.receiver_id }
    : null;
}

/**
 * Whether a BountyDone proposal is the contributor's own report: its proposer is the account it
 * names. `bounty_done` always files it that way, but `add_proposal` checks nothing in a BountyDone's
 * body, so anyone the policy lets propose can file one naming anyone.
 */
export function ownReport(p: DaoProposal): boolean {
  return bountyDone(p)?.receiver === p.proposer;
}

/** Whether `role` may take `action` ("VoteApprove", "AddProposal"…) on a proposal labelled `label`, as `can_execute_action` checks. */
export function allows(role: DaoRole, label: string, action: string): boolean {
  const p = new Set(role.permissions);
  return p.has(`${label}:${action}`) || p.has(`${label}:*`) || p.has(`*:${action}`) || p.has("*:*");
}

const groupOf = (role: DaoRole): string[] | null =>
  typeof role.kind === "object" && role.kind !== null && "Group" in role.kind && Array.isArray(role.kind.Group) ? role.kind.Group : null;

/** The delegated balance a role of token holders asks for, or null for any other role. */
const holdersMin = (role: DaoRole): string | null =>
  typeof role.kind === "object" && role.kind !== null && "Member" in role.kind ? String(role.kind.Member) : null;

const big = (text: string): bigint | null => (/^\d{1,39}$/.test(text) ? BigInt(text) : null);
const min = (a: bigint, b: bigint) => (a < b ? a : b);
const max = (a: bigint, b: bigint) => (a > b ? a : b);

// ---- Approval tiers ------------------------------------------------------------------------------

/** One way a proposal passes: enough approve votes inside one role. */
export interface ApprovalWay {
  role: string;
  /** "one council vote", "2 of 3 council votes". */
  words: string;
  /** The approve votes it takes, for a role of named accounts weighed one vote each; null when votes weigh tokens. */
  votes: number | null;
}

/**
 * How the role's approve votes pass a proposal labelled `label`, as `proposal_status` counts them:
 * the role's own vote policy for that label, or the default; for a group weighed by role, the
 * larger of the quorum and the threshold applied to the group's size. A ratio a/b of n members
 * takes a·n/b + 1 votes, rounded down and at most n: 1/2 of 3 takes 2.
 */
function wayFor(policy: DaoPolicy, role: DaoRole, label: string): ApprovalWay {
  const vote: DaoVotePolicy = role.vote_policy?.[label] ?? policy.default_vote_policy;
  const group = groupOf(role);
  const quorum = big(String(vote.quorum)) ?? 0n;
  if (group && vote.weight_kind === "RoleWeight") {
    const size = BigInt(group.length);
    const threshold = Array.isArray(vote.threshold)
      ? Number.isSafeInteger(vote.threshold[0]) && Number.isSafeInteger(vote.threshold[1]) && vote.threshold[0] >= 0 && vote.threshold[1] > 0
        ? min((BigInt(vote.threshold[0]) * size) / BigInt(vote.threshold[1]) + 1n, size)
        : null
      : (() => {
          const weight = big(String(vote.threshold));
          return weight === null ? null : min(weight, size);
        })();
    if (threshold === null) return { role: role.name, votes: null, words: `${role.name} votes, by a threshold this page can't read` };
    const needed = max(quorum, threshold);
    if (size === 0n) return { role: role.name, votes: null, words: `no ${role.name} vote: the role has no members` };
    if (needed === 0n) return { role: role.name, votes: 0, words: `any ${role.name} vote` };
    if (needed > size) {
      return { role: role.name, votes: Number(needed), words: `${needed} ${role.name} votes, more than its ${size} members: not this way` };
    }
    return { role: role.name, votes: Number(needed), words: needed === 1n ? `one ${role.name} vote` : `${needed} of ${size} ${role.name} votes` };
  }
  const floor = quorum > 0n ? `, and at least ${quorum}` : "";
  if (holdersMin(role) !== null && vote.weight_kind === "RoleWeight") {
    // A role of token holders has no size: `proposal_status` measures the threshold against the
    // delegated total, in the token's smallest unit, while `update_votes` counts each vote as one.
    const count = Array.isArray(vote.threshold)
      ? `more ${role.name} votes than ${vote.threshold[0]}/${vote.threshold[1]} of the tokens delegated to the DAO, in their smallest unit`
      : `${vote.threshold} ${role.name} votes, or fewer if less than that is delegated to the DAO, in its token's smallest unit`;
    return { role: role.name, votes: null, words: `${count}${floor}: its vote policy counts each vote as one` };
  }
  // Weighed by tokens: a TokenWeight policy, against the DAO's delegated total.
  const share = Array.isArray(vote.threshold)
    ? `more than ${vote.threshold[0]}/${vote.threshold[1]} of the tokens delegated to the DAO`
    : `${vote.threshold} delegated tokens, in their smallest unit`;
  return { role: role.name, votes: null, words: `${role.name} votes holding ${share}${floor}` };
}

/** Every way a proposal labelled `label` can pass. A role that matches everyone never passes one: `proposal_status` skips it. */
export function approvalWays(policy: DaoPolicy, label: string): ApprovalWay[] {
  return policy.roles.filter((r) => r.kind !== "Everyone" && allows(r, label, "VoteApprove")).map((r) => wayFor(policy, r, label));
}

/** Proposal kinds that pass the same ways. */
export interface ApprovalTier {
  kinds: string[];
  ways: ApprovalWay[];
  /** "one council vote, or one trusted vote"; "no role can vote to approve it" when there is none. */
  words: string;
  /**
   * For the tier with bounty_done: roles in which one vote passes it. `bounty_done` files the
   * proposal with the contributor as its proposer, so a member of such a role can approve their own
   * finished bounty.
   */
  ownVote: string[];
}

/** The policy's approval tiers, the kinds that share one in the order of `KIND_LABELS`. */
export function approvalTiers(policy: DaoPolicy): ApprovalTier[] {
  const tiers = new Map<string, ApprovalTier>();
  for (const label of KIND_LABELS) {
    const ways = approvalWays(policy, label);
    const words = ways.length ? ways.map((w) => w.words).join(", or ") : "no role can vote to approve it";
    const tier = tiers.get(words) ?? { kinds: [], ways, words, ownVote: [] };
    tier.kinds.push(label);
    tiers.set(words, tier);
  }
  const all = [...tiers.values()];
  for (const tier of all) {
    if (tier.kinds.includes("bounty_done")) tier.ownVote = tier.ways.filter((w) => w.votes === 1).map((w) => w.role);
  }
  return all;
}

// ---- Roles ---------------------------------------------------------------------------------------

const ACTIONS: readonly [action: string, words: string][] = [
  ["AddProposal", "propose"],
  ["VoteApprove", "vote to approve"],
  ["VoteReject", "vote to reject"],
  ["VoteRemove", "vote to remove"],
  ["Finalize", "finalize"],
  ["RemoveProposal", "delete outright"],
  ["MoveToHub", "move to a hub"],
];

const joinAnd = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

export interface RoleSummary {
  name: string;
  /** Its accounts, for a group; null for everyone or token holders. */
  members: string[] | null;
  /** "3 members", "anyone", "anyone holding at least 1 delegated token". */
  who: string;
  /** "Propose, vote to approve and finalize: any kind". */
  can: string[];
}

/** What each role is and what it may do, in words. Each permission is checked against every kind label. */
export function roleSummaries(policy: DaoPolicy): RoleSummary[] {
  return policy.roles.map((role) => {
    const group = groupOf(role);
    const who =
      group !== null
        ? `${group.length} member${group.length === 1 ? "" : "s"}`
        : role.kind === "Everyone"
          ? "anyone"
          : `anyone with at least ${holdersMin(role) ?? "?"} delegated tokens, in their smallest unit`;
    // Actions that cover the same kinds share a line.
    const lines = new Map<string, string[]>();
    for (const [action, words] of ACTIONS) {
      const kinds = KIND_LABELS.filter((label) => allows(role, label, action));
      if (kinds.length === 0) continue;
      const on = kinds.length === KIND_LABELS.length ? "any kind" : kinds.join(", ");
      lines.set(on, [...(lines.get(on) ?? []), words]);
    }
    const can = [...lines].map(([on, words]) => {
      const text = joinAnd(words);
      return `${text[0].toUpperCase()}${text.slice(1)}: ${on}`;
    });
    return { name: role.name, members: group ? [...group].sort() : null, who, can };
  });
}

/**
 * The roles in today's policy that count `account`'s `vote` ("Approve") on a proposal labelled
 * `label`: the groups it is in, and any role that matches everyone. Roles of token holders are left
 * to `holderRoles`, since they match by a delegated balance the page doesn't read.
 */
export function voterRoles(policy: DaoPolicy, account: string, label: string, vote: string): string[] {
  return policy.roles
    .filter((r) => (r.kind === "Everyone" || groupOf(r)?.includes(account)) && allows(r, label, `Vote${vote}`))
    .map((r) => r.name);
}

/** The roles of token holders in today's policy that allow `vote` on a proposal labelled `label`: they count it if the voter holds enough delegated tokens. */
export function holderRoles(policy: DaoPolicy, label: string, vote: string): string[] {
  return policy.roles.filter((r) => holdersMin(r) !== null && allows(r, label, `Vote${vote}`)).map((r) => r.name);
}

/** Whether a view's answer is a Sputnik DAO policy: the fields the board reads are there, each of the type it reads. */
export function isDaoPolicy(value: unknown): value is DaoPolicy {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.roles) &&
    v.roles.every(
      (r) =>
        typeof r === "object" &&
        r !== null &&
        typeof r.name === "string" &&
        Array.isArray(r.permissions) &&
        (r.kind === "Everyone" || (typeof r.kind === "object" && r.kind !== null)),
    ) &&
    typeof v.default_vote_policy === "object" &&
    v.default_vote_policy !== null &&
    typeof v.proposal_bond === "string" &&
    typeof v.proposal_period === "string" &&
    typeof v.bounty_bond === "string" &&
    typeof v.bounty_forgiveness_period === "string"
  );
}

// ---- Words for times and amounts -----------------------------------------------------------------

const UNITS: readonly [seconds: bigint, name: string][] = [
  [86_400n, "day"],
  [3_600n, "hour"],
  [60n, "minute"],
  [1n, "second"],
];

/** A duration in nanoseconds, in its two largest units: "14 days", "1 hour 30 minutes". */
export function duration(ns: string | bigint): string {
  let left = (typeof ns === "bigint" ? ns : (big(ns) ?? 0n)) / 1_000_000_000n;
  if (left === 0n) return "under a second";
  const parts: string[] = [];
  for (const [size, name] of UNITS) {
    const n = left / size;
    if (n > 0n && parts.length < 2) parts.push(`${n} ${name}${n === 1n ? "" : "s"}`);
    left %= size;
    if (parts.length > 0 && n === 0n) break;
  }
  return parts.join(" ");
}

/** Nanoseconds since the epoch, as milliseconds. */
export const nsToMs = (ns: string): number => Number((big(ns) ?? 0n) / 1_000_000n);

/** "2026-11-13 09:30 UTC". */
export const utc = (ms: number): string => `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;

/** A fungible token's `ft_metadata`, as far as amounts need it. */
export interface FtMeta {
  symbol: string;
  decimals: number;
}

/** `value` in units of `decimals` places, every digit kept: "0.00005", "25". */
function exactUnits(value: bigint, decimals: number): string {
  const digits = value.toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

/**
 * An amount of NEAR (`token` "") or of a fungible token, in words, to the last digit: a bond is what
 * `add_proposal` and `bounty_claim` want attached exactly. Without the token's metadata, in its
 * smallest unit.
 */
export function tokenAmount(token: string, amount: string, meta?: FtMeta | null): string {
  const value = big(amount);
  if (value === null) return `${amount} (not an amount)`;
  if (token === "") return `${exactUnits(value, 24)} NEAR`;
  if (meta && Number.isInteger(meta.decimals) && meta.decimals >= 0 && meta.decimals <= 36 && meta.symbol) {
    return `${exactUnits(value, meta.decimals)} ${meta.symbol}`;
  }
  return `${value} of ${token}'s smallest unit`;
}

/** Amounts summed per token, in words. */
function totals(payouts: { token: string; amount: string }[], metas: Map<string, FtMeta | null>): string[] {
  const sums = new Map<string, bigint>();
  for (const p of payouts) {
    const value = big(p.amount);
    if (value !== null) sums.set(p.token, (sums.get(p.token) ?? 0n) + value);
  }
  return [...sums].map(([token, sum]) => tokenAmount(token, sum.toString(), metas.get(token)));
}

// ---- The DAO's transactions, from FastNEAR's index ------------------------------------------------

/** A transaction as FastNEAR's index returns it, with the fields the board reads. */
export interface DaoIndexedTx extends IndexedTx {
  transaction: { hash: string };
  receipts: {
    receipt: { predecessor_id: string; receiver_id: string; receipt?: { Action?: { actions?: unknown[] } } };
    execution_outcome: {
      block_height: number;
      block_timestamp: number;
      outcome: { executor_id: string; logs: string[]; status: unknown };
    };
  }[];
}

/** A call some account made to the DAO, from a receipt the DAO ran. */
export interface DaoCall {
  tx: string;
  method: string;
  /** The arguments, when they are a JSON object. */
  args: Record<string, unknown> | null;
  /** The receipt's predecessor: the account that called. */
  caller: string;
  /** Milliseconds since the epoch, from the block that ran the receipt. */
  at: number;
  ok: boolean;
  /** What the receipt returned, as text: `add_proposal` returns the new proposal's id. */
  returned: string | null;
}

/** NEAR or a fungible token the DAO sent, from a receipt it made. */
export interface DaoPayment {
  tx: string;
  to: string;
  /** "" for NEAR, or the token's contract. */
  token: string;
  amount: string;
  ok: boolean;
}

export interface DaoActivity {
  calls: DaoCall[];
  payments: DaoPayment[];
}

function succeeded(status: unknown): boolean {
  return typeof status === "object" && status !== null && ("SuccessValue" in status || "SuccessReceiptId" in status);
}

function jsonObject(base64: unknown): Record<string, unknown> | null {
  if (typeof base64 !== "string") return null;
  try {
    const value = JSON.parse(decodeBase64(base64));
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * The calls to the DAO and the payments from it in `txs`. A call is taken only from a receipt the
 * DAO itself ran, and a payment only from a receipt the DAO made: a NEAR transfer, or an
 * `ft_transfer` (or `ft_transfer_call`) to a token's contract. A refund comes from `system`, so it
 * isn't one. A receipt whose block or time the index got wrong is skipped, as in a satchel's history.
 */
export function daoActivity(daoId: string, txs: DaoIndexedTx[]): DaoActivity {
  const calls: DaoCall[] = [];
  const payments: DaoPayment[] = [];
  for (const tx of txs) {
    for (const { receipt: r, execution_outcome: run } of tx.receipts ?? []) {
      const at = Math.floor(Number(run?.block_timestamp) / 1e6);
      if (!Number.isSafeInteger(run?.block_height) || run.block_height <= 0 || !(at > 0 && at <= 8.64e15)) continue;
      const actions = Array.isArray(r?.receipt?.Action?.actions) ? r.receipt.Action.actions : [];
      const status = run.outcome?.status;
      const ok = succeeded(status);
      if (r.receiver_id === daoId && run.outcome?.executor_id === daoId) {
        let returned: string | null = null;
        const value = (status as { SuccessValue?: unknown } | null)?.SuccessValue;
        if (typeof value === "string") {
          try {
            returned = decodeBase64(value);
          } catch {
            // Not base64: nothing to read from it.
          }
        }
        for (const action of actions) {
          const call = (action as { FunctionCall?: { method_name?: unknown; args?: unknown } } | null)?.FunctionCall;
          if (typeof call?.method_name !== "string") continue;
          calls.push({ tx: tx.transaction.hash, method: call.method_name, args: jsonObject(call.args), caller: r.predecessor_id, at, ok, returned });
        }
      }
      if (r.predecessor_id === daoId && r.receiver_id !== daoId) {
        for (const action of actions) {
          const a = action as { Transfer?: { deposit?: unknown }; FunctionCall?: { method_name?: unknown; args?: unknown } } | null;
          const deposit = typeof a?.Transfer?.deposit === "string" ? big(a.Transfer.deposit) : null;
          if (deposit !== null && deposit > 0n) payments.push({ tx: tx.transaction.hash, to: r.receiver_id, token: "", amount: deposit.toString(), ok });
          const method = a?.FunctionCall?.method_name;
          if (method === "ft_transfer" || method === "ft_transfer_call") {
            const args = jsonObject(a?.FunctionCall?.args);
            if (typeof args?.receiver_id === "string" && typeof args.amount === "string" && big(args.amount) !== null) {
              payments.push({ tx: tx.transaction.hash, to: args.receiver_id, token: r.receiver_id, amount: args.amount, ok });
            }
          }
        }
      }
    }
  }
  return { calls: calls.sort((a, b) => a.at - b.at), payments };
}

/** The transactions the index holds for one proposal. */
export interface ProposalTxs {
  /** The call that filed it: `add_proposal`, or `bounty_done` for a BountyDone. Null when the index doesn't hold it. */
  filed: DaoCall | null;
  /** The `act_proposal` calls on it that succeeded, oldest first: votes and finalizing. */
  acts: DaoCall[];
}

/**
 * Matches a proposal with its calls. `add_proposal` returns the new id. `bounty_done` returns
 * nothing, so its call is the contributor's own, for the same bounty, in the block whose time is
 * the proposal's submission time (the index's times can be off by a fraction of a millisecond).
 */
export function proposalTxs(p: DaoProposal, calls: DaoCall[]): ProposalTxs {
  const done = bountyDone(p);
  const submitted = nsToMs(p.submission_time);
  const filed =
    calls.find((c) => c.ok && c.method === "add_proposal" && c.returned?.trim() === String(p.id)) ??
    (done
      ? calls.find(
          (c) =>
            c.ok &&
            c.method === "bounty_done" &&
            c.caller === done.receiver &&
            (c.args?.account_id ?? c.caller) === done.receiver &&
            Number(c.args?.id) === done.bountyId &&
            Math.abs(c.at - submitted) <= 1,
        )
      : undefined) ??
    null;
  const acts = calls.filter((c) => c.ok && c.method === "act_proposal" && Number(c.args?.id) === p.id);
  return { filed, acts };
}

/** What an approved proposal pays and to whom: a BountyDone the bounty's amount, a Transfer its own. */
function owed(p: DaoProposal, bounties: Map<number, DaoBounty>): { to: string; token: string; amount: string } | null {
  const done = bountyDone(p);
  if (done) {
    const bounty = bounties.get(done.bountyId);
    return bounty ? { to: done.receiver, token: bounty.token, amount: bounty.amount } : null;
  }
  const transfer = kindBody(p, "Transfer");
  if (transfer && typeof transfer.receiver_id === "string" && typeof transfer.amount === "string") {
    return { to: transfer.receiver_id, token: typeof transfer.token_id === "string" ? transfer.token_id : "", amount: transfer.amount };
  }
  return null;
}

/** The payment in one of the proposal's votes that pays what it owes, or null when the index doesn't show one. */
function paymentFor(debt: { to: string; token: string; amount: string }, txs: ProposalTxs, activity: DaoActivity): DaoPayment | null {
  const hashes = new Set(txs.acts.map((a) => a.tx));
  return (
    activity.payments.find((m) => m.ok && hashes.has(m.tx) && m.to === debt.to && m.token === debt.token && m.amount === debt.amount) ?? null
  );
}

// ---- Open bounties -------------------------------------------------------------------------------

export interface ClaimView {
  account: string;
  since: number;
  until: number;
  /** The claimer called `bounty_done`: its BountyDone proposal waits for a vote. */
  completed: boolean;
  /** Past its deadline and not finished: anyone may call `bounty_done` for it, which frees the slot. */
  expired: boolean;
  /** The `bounty_claim` transaction, when the index holds it. */
  tx: string | null;
}

export interface OpenBounty {
  bounty: DaoBounty;
  amount: string;
  /** "14 days": the longest deadline a claim may ask for. */
  maxDeadline: string;
  /** Claims the DAO counts now (`get_bounty_number_of_claims`), or null when that read failed. */
  claimCount: number | null;
  claims: ClaimView[];
  /** Claims the DAO counts that none of the accounts asked about holds. */
  unfound: number;
  /** The approved AddBounty proposal that posted it, when exactly one has the same terms. */
  postedBy: number | null;
}

/**
 * Bounties with times left, each with its claims. The DAO keeps claims by claimer, so `claims`
 * holds the claims of every account the page asked about (`claimCandidates`), and a claim count
 * higher than what they hold is reported as unfound. Bounty ids come in the order the AddBounty
 * proposals passed, so the proposal is matched by its terms: description, token, amount and
 * deadline.
 */
export function openBounties(
  bounties: DaoBounty[],
  counts: Map<number, number>,
  claims: Map<string, DaoBountyClaim[]>,
  proposals: DaoProposal[],
  activity: DaoActivity | null,
  metas: Map<string, FtMeta | null>,
  nowMs: number,
): OpenBounty[] {
  return bounties
    .filter((b) => b.times > 0)
    .map((bounty) => {
      const found: ClaimView[] = [];
      for (const [account, list] of claims) {
        for (const c of list) {
          if (c.bounty_id !== bounty.id) continue;
          const since = nsToMs(c.start_time);
          const until = nsToMs(((big(c.start_time) ?? 0n) + (big(c.deadline) ?? 0n)).toString());
          const call = activity?.calls.find(
            (k) => k.ok && k.method === "bounty_claim" && k.caller === account && Number(k.args?.id) === bounty.id && Math.abs(k.at - since) <= 1,
          );
          found.push({ account, since, until, completed: c.completed, expired: !c.completed && nowMs > until, tx: call?.tx ?? null });
        }
      }
      found.sort((a, b) => a.since - b.since);
      const posted = proposals.filter((p) => {
        const body = kindBody(p, "AddBounty");
        const b = body?.bounty as Partial<DaoBounty> | undefined;
        return (
          p.status === "Approved" &&
          b?.description === bounty.description &&
          b.token === bounty.token &&
          b.amount === bounty.amount &&
          b.max_deadline === bounty.max_deadline
        );
      });
      const count = counts.get(bounty.id) ?? null;
      return {
        bounty,
        amount: tokenAmount(bounty.token, bounty.amount, metas.get(bounty.token)),
        maxDeadline: duration(bounty.max_deadline),
        claimCount: count,
        claims: found,
        unfound: count === null ? 0 : Math.max(0, count - found.length),
        postedBy: posted.length === 1 ? posted[0].id : null,
      };
    });
}

/**
 * The accounts whose claims the page reads: every member of a group role, every proposer, every
 * contributor a proposal names, and every account the index saw claim, finish or give up a bounty.
 */
export function claimCandidates(policy: DaoPolicy, proposals: DaoProposal[], activity: DaoActivity | null): string[] {
  const found = new Set<string>();
  for (const role of policy.roles) for (const m of groupOf(role) ?? []) found.add(m);
  for (const p of proposals) {
    found.add(p.proposer);
    const done = bountyDone(p);
    if (done) found.add(done.receiver);
  }
  for (const c of activity?.calls ?? []) {
    if (c.method === "bounty_claim" || c.method === "bounty_done" || c.method === "bounty_giveup") found.add(c.caller);
  }
  return [...found].sort();
}

// ---- Finished bounties ---------------------------------------------------------------------------

export interface VoteView {
  account: string;
  /** "Approve", "Reject" or "Remove". */
  vote: string;
  /** The roles in today's policy that count this vote: the voter's groups, and a role that matches everyone. */
  roles: string[];
  /** Roles of token holders in today's policy that count it if the voter holds enough delegated tokens, which the page doesn't read. */
  holderRoles: string[];
  /** The `act_proposal` transaction, when the index holds it. */
  tx: string | null;
}

export interface FinishedBounty {
  proposal: DaoProposal;
  bountyId: number;
  /** The bounty, while the DAO stores it. */
  bounty: DaoBounty | null;
  /** The account the proposal names, and pays if it passes. */
  contributor: string;
  /** Whether the contributor filed it (`ownReport`); if not, `proposal.proposer` filed it in their name. */
  ownReport: boolean;
  votes: VoteView[];
  /** "council: 1 approve", from the proposal's vote counts. */
  counts: string[];
  /** For an approved one: what it paid, and the transaction the index shows paying it, if any. */
  payout: { words: string; tx: string | null } | null;
  txs: ProposalTxs | null;
  /** In progress past its voting period (`lapsed`). */
  lapsed: boolean;
}

/**
 * In progress past the policy's voting period: `proposal_status` now answers Expired before it
 * counts any vote, so the proposal can no longer pass. The DAO stores it as InProgress until someone
 * votes or finalizes.
 */
export function lapsed(p: DaoProposal, policy: DaoPolicy, nowMs: number): boolean {
  return p.status === "InProgress" && nsToMs(p.submission_time) + nsToMs(policy.proposal_period) < nowMs;
}

function voteViews(p: DaoProposal, policy: DaoPolicy, txs: ProposalTxs | null): VoteView[] {
  const label = kindLabel(p.kind) ?? "";
  return Object.entries(p.votes ?? {}).map(([account, vote]) => ({
    account,
    vote,
    roles: voterRoles(policy, account, label, vote),
    holderRoles: holderRoles(policy, label, vote),
    tx: txs?.acts.find((a) => a.caller === account && a.args?.action === `Vote${vote}`)?.tx ?? null,
  }));
}

/**
 * The proposal's vote counts per role. A role whose vote policy for the kind weighs tokens counts
 * delegated tokens in their smallest unit, which the RPC's JSON number can't hold to the last digit,
 * so such a count is marked as rounded.
 */
function voteCounts(p: DaoProposal, policy: DaoPolicy): string[] {
  const label = kindLabel(p.kind) ?? "";
  return Object.entries(p.vote_counts ?? {}).map(([role, [approve = 0, reject = 0, remove = 0] = []]) => {
    const r = policy.roles.find((x) => x.name === role);
    const tokens = (r?.vote_policy?.[label] ?? policy.default_vote_policy).weight_kind === "TokenWeight";
    const n = (x: number) => (Number.isSafeInteger(x) ? String(x) : `about ${x}`);
    const parts = [
      [approve, "approve"],
      [reject, "reject"],
      [remove, "remove"],
    ].filter(([x]) => Number(x) > 0);
    const counts = parts.length ? parts.map(([x, w]) => `${n(Number(x))} ${w}`).join(", ") : "no votes";
    return `${role}: ${counts}${tokens && parts.length ? " (delegated tokens, in their smallest unit)" : ""}`;
  });
}

/**
 * Every BountyDone proposal the DAO stores, newest first: who it names as having finished which
 * bounty, and who filed it, how the vote stands, and for an approved one what it paid. The voter's
 * roles are today's: the DAO keeps how many votes each role gave, not which role each voter voted in.
 */
export function finishedBounties(
  proposals: DaoProposal[],
  bounties: DaoBounty[],
  policy: DaoPolicy,
  activity: DaoActivity | null,
  metas: Map<string, FtMeta | null>,
  nowMs: number,
): FinishedBounty[] {
  const byId = new Map(bounties.map((b) => [b.id, b]));
  return proposals
    .flatMap((p) => {
      const done = bountyDone(p);
      if (!done) return [];
      const txs = activity ? proposalTxs(p, activity.calls) : null;
      const bounty = byId.get(done.bountyId) ?? null;
      const debt = p.status === "Approved" ? owed(p, byId) : null;
      const payment = debt && txs && activity ? paymentFor(debt, txs, activity) : null;
      return [
        {
          proposal: p,
          bountyId: done.bountyId,
          bounty,
          contributor: done.receiver,
          ownReport: ownReport(p),
          votes: voteViews(p, policy, txs),
          counts: voteCounts(p, policy),
          payout:
            p.status !== "Approved"
              ? null
              : debt
                ? { words: `${tokenAmount(debt.token, debt.amount, metas.get(debt.token))} to ${debt.to}`, tx: payment?.tx ?? null }
                : { words: `bounty #${done.bountyId}'s amount: the DAO no longer stores the bounty`, tx: null },
          txs,
          lapsed: lapsed(p, policy, nowMs),
        },
      ];
    })
    .sort((a, b) => b.proposal.id - a.proposal.id);
}

// ---- Each contributor's record -------------------------------------------------------------------

/** One point in a record, and the proposal it comes from. */
export interface RecordLine {
  proposalId: number;
  words: string;
  /** The transaction that made it happen, when the index holds it: the payout's, or the vote that passed it. */
  tx: string | null;
}

export interface ContributorRecord {
  account: string;
  /** Approved BountyDone proposals. */
  finished: (RecordLine & { bountyId: number })[];
  /** Their own BountyDone proposals (`ownReport`) still open for votes. */
  waiting: number[];
  /** Their own BountyDone proposals in progress past the voting period (`lapsed`): none can pass now. */
  lapsed: number[];
  /** Approved AddMemberToRole and RemoveMemberFromRole proposals. */
  roles: RecordLine[];
  /** What approved BountyDone and Transfer proposals paid them. */
  payouts: RecordLine[];
  /** The payouts summed, per token. */
  totals: string[];
}

/**
 * Each contributor's record, from the proposals alone: every point is an approved proposal, or a
 * BountyDone one of their own still in progress. One that someone else filed in their name is left
 * out until it passes. A BountyDone counts as finished only once approved, which in sputnikdao2 2.3.1
 * means its payout went through: a failed payout marks it Failed. A role change is checked against
 * today's policy: `add_member_to_role` and `remove_member_from_role` only log, and change nothing,
 * when the role isn't a group.
 */
export function contributorRecords(
  proposals: DaoProposal[],
  bounties: DaoBounty[],
  policy: DaoPolicy,
  activity: DaoActivity | null,
  metas: Map<string, FtMeta | null>,
  nowMs: number,
): ContributorRecord[] {
  const byId = new Map(bounties.map((b) => [b.id, b]));
  const groups = new Set(policy.roles.filter((r) => groupOf(r) !== null).map((r) => r.name));
  const records = new Map<string, ContributorRecord & { paid: { token: string; amount: string }[] }>();
  const of = (account: string) => {
    let r = records.get(account);
    if (!r) {
      r = { account, finished: [], waiting: [], lapsed: [], roles: [], payouts: [], totals: [], paid: [] };
      records.set(account, r);
    }
    return r;
  };
  for (const p of proposals) {
    const txs = activity ? proposalTxs(p, activity.calls) : null;
    const passedIn = txs?.acts.at(-1)?.tx ?? null;
    const done = bountyDone(p);
    if (done && p.status === "InProgress" && ownReport(p)) of(done.receiver)[lapsed(p, policy, nowMs) ? "lapsed" : "waiting"].push(p.id);
    if (p.status !== "Approved") continue;
    const debt = owed(p, byId);
    const payment = debt && txs && activity ? paymentFor(debt, txs, activity) : null;
    if (done) {
      const bounty = byId.get(done.bountyId);
      const what = bounty ? `bounty #${done.bountyId}: ${bounty.description}` : `bounty #${done.bountyId}, which the DAO no longer stores`;
      of(done.receiver).finished.push({
        proposalId: p.id,
        bountyId: done.bountyId,
        words: ownReport(p) ? what : `${what} (filed in their name by ${p.proposer})`,
        tx: payment?.tx ?? passedIn,
      });
    }
    if (debt) {
      const r = of(debt.to);
      r.payouts.push({
        proposalId: p.id,
        words: `${tokenAmount(debt.token, debt.amount, metas.get(debt.token))}, ${done ? `bounty #${done.bountyId}` : "a transfer"}`,
        tx: payment?.tx ?? passedIn,
      });
      r.paid.push(debt);
    } else if (done) {
      of(done.receiver).payouts.push({ proposalId: p.id, words: `bounty #${done.bountyId}'s amount, which the DAO no longer stores`, tx: passedIn });
    }
    for (const [name, change, asked] of [
      ["AddMemberToRole", "added to", "add them to"],
      ["RemoveMemberFromRole", "removed from", "remove them from"],
    ] as const) {
      const body = kindBody(p, name);
      if (typeof body?.member_id === "string" && typeof body.role === "string") {
        const words = groups.has(body.role)
          ? `${change} ${body.role}`
          : `a passed proposal to ${asked} ${body.role}; today's policy has no group by that name, so it may have changed nothing`;
        of(body.member_id).roles.push({ proposalId: p.id, words, tx: passedIn });
      }
    }
  }
  return [...records.values()]
    .map(({ paid, ...r }) => ({ ...r, totals: totals(paid, metas) }))
    .sort((a, b) => b.finished.length - a.finished.length || a.account.localeCompare(b.account));
}

// ---- The DAO's satchels --------------------------------------------------------------------------

/** A proposal that has the DAO have one of its satchels sign an EVM transaction. */
export interface SatchelSigning {
  proposal: DaoProposal;
  tokenId: string;
  /** "nonce 0 on Sepolia: 0.0001 ETH to 0x…dEaD". */
  words: string;
  /** For an approved one, the vote that passed it, when the index holds it. */
  tx: string | null;
}

/** The DAO's `sign_evm` proposals on `net`'s contract, newest first: what each has a satchel send. */
export function satchelSignings(net: Network, proposals: DaoProposal[], activity: DaoActivity | null): SatchelSigning[] {
  return proposals
    .flatMap((p) =>
      proposedSignatures(net, p).map(({ tokenId, tx }) => {
        const chain = chainInfo(Number(tx.chain_id));
        const value = big(String(tx.value));
        const what = value === null ? `${tx.value} wei` : `${formatBalance(value)} ${chain?.symbol ?? "(native coin)"}`;
        const data = tx.data && tx.data !== "0x" ? ", with call data" : "";
        const passed = p.status === "Approved" && activity ? (proposalTxs(p, activity.calls).acts.at(-1)?.tx ?? null) : null;
        return { proposal: p, tokenId, words: `nonce ${tx.nonce} on ${chain?.name ?? `chain ${tx.chain_id}`}: ${what} to ${tx.to}${data}`, tx: passed };
      }),
    )
    .sort((a, b) => b.proposal.id - a.proposal.id);
}

// ---- Words for the page --------------------------------------------------------------------------

/** The fungible tokens the board shows amounts of: bounties' and approved or open Transfer proposals'. "" (NEAR) is left out. */
export function tokensIn(bounties: DaoBounty[], proposals: DaoProposal[]): string[] {
  const found = new Set(bounties.map((b) => b.token));
  for (const p of proposals) {
    const token = kindBody(p, "Transfer")?.token_id;
    if (typeof token === "string") found.add(token);
  }
  found.delete("");
  return [...found].sort();
}

/** What a DAO's board shows, for its description in search results and share cards. */
export function boardDescription(net: Network, daoId: string): string {
  return `The bounty board of ${daoId}, a Sputnik DAO on NEAR ${net.id}: its approval tiers, open bounties and claims, finished bounties and payouts, and each contributor's record, read live from the chain.`;
}

/** Where the board reads each part, for a reader that runs no JavaScript. */
export function boardPageNote(net: Network, daoId: string): string {
  return (
    `This page reads ${daoId} on NEAR ${net.id} in your browser: its config, policy, bounties, claims and proposals ` +
    `from the DAO's own views (sputnikdao2), the satchels it owns from ${net.contract}, and the transactions behind ` +
    "each proposal from FastNEAR's transaction index. It is display only: nothing on it signs or sends anything, and " +
    "it needs no wallet."
  );
}
