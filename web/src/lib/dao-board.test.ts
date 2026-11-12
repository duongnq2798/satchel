import { type DaoBounty, type DaoBountyClaim, type DaoPolicy, type DaoProposal, type DaoVotePolicy, TESTNET, encodeArgs } from "satchel-nft";
import { describe, expect, it } from "vitest";
import clubTxs from "./__fixtures__/satchel-club-txs.json" with { type: "json" };
import club from "./__fixtures__/satchel-club-views.json" with { type: "json" };
import {
  BOUNTY_DAO,
  type DaoIndexedTx,
  KIND_LABELS,
  approvalTiers,
  approvalWays,
  boardPageNote,
  claimCandidates,
  contributorRecords,
  daoActivity,
  duration,
  finishedBounties,
  isDaoPolicy,
  openBounties,
  proposalTxs,
  proposedGifts,
  roleSummaries,
  satchelGifts,
  satchelSignings,
  tokenAmount,
  tokensIn,
  utc,
} from "./dao-board";
import { appPath } from "./routes";

// satchel-club.sputnikv2.testnet's views (sputnikdao2 2.3.1) and FastNEAR's index of its account,
// read on 2026-11-13: one council member, two FunctionCall proposals (satchel #8's Sepolia send and
// its hand-off), no bounties. Its transactions are in deployments/testnet-dao.json.
const CLUB = "satchel-club.sputnikv2.testnet";
const CLUB_POLICY = club.get_policy as DaoPolicy;
const CLUB_PROPOSALS = club.get_proposals as DaoProposal[];
const CLUB_TXS = clubTxs.transactions as DaoIndexedTx[];

// ---- A DAO with bounties ------------------------------------------------------------------------
// Not read from a chain: satchel-club has no bounties. Made in the shape of sputnikdao2 2.3.1's
// answers (views.rs and bounties.rs at 7764926), with the fields FastNEAR's index answers.

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 13, 12);
const DAO = "board.sputnikv2.testnet";
const USDC = "usdc.fakes.testnet";
const ns = (ms: number, extra = 0n) => (BigInt(ms) * 1_000_000n + extra).toString();
const NEAR = (n: string) => `${n}${"0".repeat(24)}`;

const BOARD_POLICY: DaoPolicy = {
  roles: [
    {
      name: "council",
      kind: { Group: ["council-1.testnet", "council-2.testnet", "council-3.testnet"] },
      permissions: ["*:AddProposal", "*:VoteApprove", "*:VoteReject", "*:VoteRemove", "*:Finalize"],
      vote_policy: { bounty_done: { weight_kind: "RoleWeight", quorum: "0", threshold: "1" } },
    },
    {
      name: "trusted",
      kind: { Group: ["helper.testnet", "builder.testnet"] },
      permissions: ["bounty_done:AddProposal", "add_bounty:AddProposal", "bounty_done:VoteApprove"],
      vote_policy: { bounty_done: { weight_kind: "RoleWeight", quorum: "0", threshold: "1" } },
    },
    { name: "all", kind: "Everyone", permissions: ["*:AddProposal"], vote_policy: {} },
  ],
  default_vote_policy: { weight_kind: "RoleWeight", quorum: "0", threshold: [1, 2] },
  proposal_bond: "0",
  proposal_period: ns(7 * DAY),
  bounty_bond: "0",
  bounty_forgiveness_period: ns(DAY),
};

const bounty = (id: number, description: string, token: string, amount: string, times: number, days: number): DaoBounty => ({
  id,
  description,
  token,
  amount,
  times,
  max_deadline: ns(days * DAY),
});
const BOUNTIES: DaoBounty[] = [
  // Posted for one time and paid once, so none left.
  bounty(0, "Translate the quickstart", "", NEAR("1"), 0, 7),
  bounty(1, "Add a dark theme screenshot", "", "500000000000000000000000", 2, 3),
  bounty(2, "Review the threat model", USDC, "25000000", 1, 14),
];

const CLAIMS = new Map<string, DaoBountyClaim[]>([
  ["builder.testnet", [{ bounty_id: 1, start_time: ns(NOW - DAY, 77n), deadline: ns(2 * DAY), completed: true }]],
  ["helper.testnet", [{ bounty_id: 1, start_time: ns(NOW - 2 * DAY), deadline: ns(DAY), completed: false }]],
]);

const proposal = (
  id: number,
  proposer: string,
  kind: DaoProposal["kind"],
  status: DaoProposal["status"],
  at: number,
  votes: Record<string, string> = {},
  vote_counts: Record<string, number[]> = {},
): DaoProposal => ({ id, proposer, description: "", kind, status, submission_time: ns(at, 4_321n), votes, vote_counts });
const terms = (b: DaoBounty) => ({ description: b.description, token: b.token, amount: b.amount, times: 1, max_deadline: b.max_deadline });
const PROPOSALS: DaoProposal[] = [
  proposal(0, "council-1.testnet", { AddBounty: { bounty: terms(BOUNTIES[0]) } }, "Approved", NOW - 6 * DAY),
  proposal(1, "council-1.testnet", { AddBounty: { bounty: { ...terms(BOUNTIES[1]), times: 2 } } }, "Approved", NOW - 6 * DAY),
  proposal(2, "council-1.testnet", { AddMemberToRole: { member_id: "builder.testnet", role: "trusted" } }, "Approved", NOW - 5 * DAY),
  proposal(3, "builder.testnet", { BountyDone: { bounty_id: 0, receiver_id: "builder.testnet" } }, "Approved", NOW - 4 * DAY, { "builder.testnet": "Approve" }, { trusted: [1, 0, 0] }),
  proposal(4, "council-2.testnet", { AddBounty: { bounty: terms(BOUNTIES[2]) } }, "Approved", NOW - 3 * DAY),
  proposal(5, "builder.testnet", { BountyDone: { bounty_id: 1, receiver_id: "builder.testnet" } }, "InProgress", NOW - 2 * 3_600_000),
  proposal(6, "council-1.testnet", { Transfer: { token_id: "", receiver_id: "helper.testnet", amount: "200000000000000000000000", msg: null } }, "Approved", NOW - 3 * DAY, { "council-1.testnet": "Approve", "council-2.testnet": "Approve" }, { council: [2, 0, 0] }),
  proposal(7, "helper.testnet", { BountyDone: { bounty_id: 1, receiver_id: "helper.testnet" } }, "Rejected", NOW - 3 * DAY, { "council-1.testnet": "Reject", "council-2.testnet": "Reject" }, { council: [0, 2, 0] }),
];

type Receipt = {
  from: string;
  to: string;
  executor?: string;
  call?: [string, Record<string, unknown>];
  transfer?: string;
  returns?: string;
  failed?: boolean;
};
/** One transaction as FastNEAR's index answers it, its receipts all in the block at `ms`. */
function indexed(hash: string, ms: number, receipts: Receipt[]): DaoIndexedTx {
  return {
    transaction: { hash },
    receipts: receipts.map((r, i) => ({
      receipt: {
        predecessor_id: r.from,
        receiver_id: r.to,
        receipt: {
          Action: {
            actions: [
              r.call
                ? { FunctionCall: { method_name: r.call[0], args: encodeArgs(r.call[1]), deposit: "0" } }
                : { Transfer: { deposit: r.transfer ?? "0" } },
            ],
          },
        },
      },
      execution_outcome: {
        block_height: 280_000_000 + i,
        // The index answers the time as a JSON number, which can't hold every nanosecond.
        block_timestamp: Number(ns(ms, 4_321n)),
        outcome: {
          executor_id: r.executor ?? r.to,
          logs: [],
          status: r.failed ? { Failure: { ActionError: {} } } : { SuccessValue: r.returns === undefined ? "" : btoa(r.returns) },
        },
      },
    })),
  };
}
const at = (id: number) => Number(BigInt(PROPOSALS[id].submission_time) / 1_000_000n);
const BOARD_TXS: DaoIndexedTx[] = [
  indexed("AddMember2", at(2), [{ from: "council-1.testnet", to: DAO, call: ["add_proposal", { proposal: {} }], returns: "2" }]),
  indexed("VoteMember2a", at(2) + 60_000, [{ from: "council-1.testnet", to: DAO, call: ["act_proposal", { id: 2, action: "VoteApprove" }] }]),
  indexed("VoteMember2b", at(2) + 120_000, [{ from: "council-2.testnet", to: DAO, call: ["act_proposal", { id: 2, action: "VoteApprove" }] }]),
  indexed("DoneBuilder0", at(3), [{ from: "builder.testnet", to: DAO, call: ["bounty_done", { id: 0, description: "Translated" }] }]),
  indexed("VoteBuilder3", at(3) + 60_000, [
    { from: "builder.testnet", to: DAO, call: ["act_proposal", { id: 3, action: "VoteApprove" }] },
    { from: DAO, to: "builder.testnet", transfer: NEAR("1") },
    { from: DAO, to: DAO, call: ["on_proposal_callback", { proposal_id: 3 }] },
    { from: DAO, to: "builder.testnet", transfer: "0" },
  ]),
  indexed("VoteTransfer6", at(6) + 60_000, [
    { from: "council-2.testnet", to: DAO, call: ["act_proposal", { id: 6, action: "VoteApprove" }] },
    { from: DAO, to: "helper.testnet", transfer: "200000000000000000000000" },
  ]),
  indexed("ClaimBuilder1", NOW - DAY, [{ from: "builder.testnet", to: DAO, call: ["bounty_claim", { id: 1, deadline: ns(2 * DAY) }] }]),
];

describe("the DAO's policy in words", () => {
  it("reads satchel-club's: one council member, one vote passes any kind", () => {
    expect(isDaoPolicy(CLUB_POLICY)).toBe(true);
    const tiers = approvalTiers(CLUB_POLICY);
    expect(tiers).toHaveLength(1);
    expect(tiers[0].kinds).toEqual(KIND_LABELS);
    expect(tiers[0].words).toBe("one council vote");
    expect(tiers[0].ownVote).toEqual(["council"]);
    expect(roleSummaries(CLUB_POLICY)).toEqual([
      {
        name: "council",
        members: ["satchel-nft.testnet"],
        who: "1 member",
        can: ["Propose, vote to approve, vote to reject, vote to remove and finalize: any kind"],
      },
    ]);
  });

  it("splits a bounty policy into tiers: one vote for bounty_done, 2 of 3 council for the rest", () => {
    const tiers = approvalTiers(BOARD_POLICY);
    expect(tiers.map((t) => [t.kinds.slice(0, 3), t.words])).toEqual([
      [["bounty_done"], "one council vote, or one trusted vote"],
      [["add_bounty", "transfer", "call"], "2 of 3 council votes"],
    ]);
    expect(tiers[1].kinds).toHaveLength(KIND_LABELS.length - 1);
    expect(tiers[0].ownVote).toEqual(["council", "trusted"]);
    expect(tiers[1].ownVote).toEqual([]);
    expect(roleSummaries(BOARD_POLICY).map((r) => [r.name, r.who, r.can])).toEqual([
      ["council", "3 members", ["Propose, vote to approve, vote to reject, vote to remove and finalize: any kind"]],
      ["trusted", "2 members", ["Propose: bounty_done, add_bounty", "Vote to approve: bounty_done"]],
      ["all", "anyone", ["Propose: any kind"]],
    ]);
  });

  it("counts votes the way proposal_status does", () => {
    const council = (members: number, vote: DaoPolicy["default_vote_policy"]): DaoPolicy => ({
      ...CLUB_POLICY,
      roles: [{ ...CLUB_POLICY.roles[0], kind: { Group: Array.from({ length: members }, (_, i) => `m${i}.testnet`) } }],
      default_vote_policy: vote,
    });
    const words = (p: DaoPolicy) => approvalWays(p, "transfer").map((w) => w.words);
    const half: DaoVotePolicy = { weight_kind: "RoleWeight", quorum: "0", threshold: [1, 2] };
    // a/b of n is a·n/b + 1, rounded down, at most n.
    expect(words(council(1, half))).toEqual(["one council vote"]);
    expect(words(council(2, half))).toEqual(["2 of 2 council votes"]);
    expect(words(council(3, half))).toEqual(["2 of 3 council votes"]);
    expect(words(council(4, half))).toEqual(["3 of 4 council votes"]);
    expect(words(council(3, { ...half, quorum: "3" }))).toEqual(["3 of 3 council votes"]);
    expect(words(council(3, { ...half, quorum: "4" }))).toEqual(["4 council votes, more than its 3 members: not this way"]);
    expect(words(council(3, { ...half, threshold: "5" }))).toEqual(["3 of 3 council votes"]);
    expect(words(council(0, half))).toEqual(["no council vote: the role has no members"]);
    expect(words(council(3, { ...half, weight_kind: "TokenWeight" }))).toEqual([
      "council votes holding more than 1/2 of the tokens delegated to the DAO",
    ]);
    // A role that matches everyone is skipped; one without VoteApprove can't pass anything.
    const noVoters: DaoPolicy = { ...CLUB_POLICY, roles: [{ name: "all", kind: "Everyone", permissions: ["*:*"], vote_policy: {} }] };
    expect(approvalTiers(noVoters).map((t) => t.words)).toEqual(["no role can vote to approve it"]);
  });

  it("refuses an answer that isn't a Sputnik policy", () => {
    expect(isDaoPolicy({ proposal_bond: "0", proposal_period: "1" })).toBe(false);
    expect(isDaoPolicy({ ...CLUB_POLICY, roles: [null] })).toBe(false);
    // A role whose kind is null would break every role summary.
    expect(isDaoPolicy({ ...CLUB_POLICY, roles: [{ ...CLUB_POLICY.roles[0], kind: null }] })).toBe(false);
    expect(isDaoPolicy([])).toBe(false);
    expect(isDaoPolicy(null)).toBe(false);
  });
});

describe("words for times and amounts", () => {
  it("puts a duration in its two largest units", () => {
    expect(duration(CLUB_POLICY.proposal_period)).toBe("1 hour");
    expect(duration(`${14 * DAY}000000`)).toBe("14 days");
    expect(duration(`${90 * 60_000}000000`)).toBe("1 hour 30 minutes");
    expect(duration(`${DAY + 3_600_000 + 60_000}000000`)).toBe("1 day 1 hour");
    expect(duration(`${DAY + 60_000}000000`)).toBe("1 day");
    expect(duration("0")).toBe("under a second");
    expect(utc(Date.UTC(2026, 10, 13, 9, 30))).toBe("2026-11-13 09:30 UTC");
  });

  it("shows NEAR, a token with its metadata, and one without, to the last digit", () => {
    expect(tokenAmount("", "1000000000000000000000000")).toBe("1 NEAR");
    expect(tokenAmount("", "0")).toBe("0 NEAR");
    // A bond must be attached exactly, so nothing is cut: not 0.1234 NEAR, not 0 NEAR.
    expect(tokenAmount("", "123450000000000000000000")).toBe("0.12345 NEAR");
    expect(tokenAmount("", "50000000000000000000")).toBe("0.00005 NEAR");
    expect(tokenAmount("", "1")).toBe("0.000000000000000000000001 NEAR");
    expect(tokenAmount(USDC, "25000000", { symbol: "USDC", decimals: 6 })).toBe("25 USDC");
    expect(tokenAmount(USDC, "25000001", { symbol: "USDC", decimals: 6 })).toBe("25.000001 USDC");
    expect(tokenAmount(USDC, "7", { symbol: "T0", decimals: 0 })).toBe("7 T0");
    expect(tokenAmount(USDC, "25000000", null)).toBe(`25000000 of ${USDC}'s smallest unit`);
    expect(tokenAmount("", "1e24")).toBe("1e24 (not an amount)");
    expect(tokensIn(BOUNTIES, PROPOSALS)).toEqual([USDC]);
  });
});

describe("the DAO's transactions, from FastNEAR's index", () => {
  it("finds who filed and who voted satchel-club's two proposals", () => {
    const activity = daoActivity(CLUB, CLUB_TXS);
    // The factory's `new`, then each proposal filed and voted; each vote ran it, and its callback came back to the DAO.
    expect(activity.calls.map((c) => [c.method, c.caller])).toEqual([
      ["new", "sputnikv2.testnet"],
      ["add_proposal", "satchel-nft.testnet"],
      ["act_proposal", "satchel-nft.testnet"],
      ["on_proposal_callback", CLUB],
      ["add_proposal", "satchel-nft.testnet"],
      ["act_proposal", "satchel-nft.testnet"],
      ["on_proposal_callback", CLUB],
    ]);
    // The DAO only sent zero-NEAR bond returns and its calls to the Satchel contract: no payment.
    expect(activity.payments).toEqual([]);
    const [first, second] = CLUB_PROPOSALS.map((p) => proposalTxs(p, activity.calls));
    expect(first.filed?.tx).toBe("5wqriE9Ur3vGxcZ2G9pg4CMJZPjP6ZUxzHZVJMK4xtmH");
    expect(first.acts.map((a) => [a.tx, a.args?.action])).toEqual([["2ryQpsJRq8zQwxCdHzJszi5dBBxjECF4Jt59J1NmPG4M", "VoteApprove"]]);
    expect(second.filed?.tx).toBe("A5YMQQp2jPeDBhZzsaK4Bu2AoTSfLCSa81ZYnSZYqHfy");
    expect(second.acts.map((a) => a.tx)).toEqual(["6GSVLR17camU72fkcVyt58Ryo9SpscNE3RhdDo5rHABg"]);
  });

  it("shows satchel-club's vote that had satchel #8 sign, the one that gave it away, and nothing for its bounties", () => {
    const activity = daoActivity(CLUB, CLUB_TXS);
    expect(satchelSignings(TESTNET, CLUB_PROPOSALS, activity).map((s) => [s.proposal.id, s.tokenId, s.words, s.tx])).toEqual([
      [0, "8", "nonce 0 on Sepolia: 0.0001 ETH to 0x000000000000000000000000000000000000dEaD", "2ryQpsJRq8zQwxCdHzJszi5dBBxjECF4Jt59J1NmPG4M"],
    ]);
    const bounties = club.get_bounties as DaoBounty[];
    expect(finishedBounties(CLUB_PROPOSALS, bounties, CLUB_POLICY, activity, new Map(), NOW)).toEqual([]);
    expect(satchelGifts(TESTNET, CLUB_PROPOSALS, activity).map((g) => [g.proposal.id, g.tokenId, g.receiver, g.tx])).toEqual([
      [1, "8", "buyer.satchel-nft.testnet", "6GSVLR17camU72fkcVyt58Ryo9SpscNE3RhdDo5rHABg"],
    ]);
    // The only record is the account the DAO gave satchel #8 to: no bounty, role or NEAR.
    expect(contributorRecords(TESTNET, CLUB_PROPOSALS, bounties, CLUB_POLICY, activity, new Map(), NOW)).toEqual([
      {
        account: "buyer.satchel-nft.testnet",
        finished: [],
        waiting: [],
        lapsed: [],
        roles: [],
        payouts: [{ proposalId: 1, words: "satchel #8 itself: its address and all it holds", tx: "6GSVLR17camU72fkcVyt58Ryo9SpscNE3RhdDo5rHABg" }],
        satchels: ["8"],
        totals: [],
      },
    ]);
    expect(openBounties(bounties, new Map(), new Map(), CLUB_PROPOSALS, activity, new Map(), NOW)).toEqual([]);
    expect(claimCandidates(CLUB_POLICY, CLUB_PROPOSALS, activity)).toEqual(["satchel-nft.testnet"]);
  });

  it("takes calls only from receipts the DAO ran, and payments only from receipts it made", () => {
    const tx = indexed("Mixed", NOW, [
      { from: "builder.testnet", to: DAO, call: ["bounty_claim", { id: 1, deadline: "1" }] },
      // Failed, so it is a call that didn't go through.
      { from: "builder.testnet", to: DAO, call: ["bounty_claim", { id: 2, deadline: "1" }], failed: true },
      // Another contract that names the DAO as its receiver can't run a receipt for it.
      { from: "builder.testnet", to: DAO, executor: "evil.testnet", call: ["add_proposal", {}] },
      { from: DAO, to: "builder.testnet", transfer: "1000000000000000000000000" },
      { from: DAO, to: "builder.testnet", transfer: "0" },
      { from: "system", to: "builder.testnet", transfer: "5" },
      { from: DAO, to: USDC, call: ["ft_transfer", { receiver_id: "helper.testnet", amount: "25000000", memo: "Bounty 2 payout" }] },
      { from: DAO, to: USDC, call: ["ft_transfer", { receiver_id: "helper.testnet", amount: "lots" }] },
    ]);
    const activity = daoActivity(DAO, [tx]);
    expect(activity.calls.map((c) => [c.method, c.ok, Number(c.args?.id)])).toEqual([
      ["bounty_claim", true, 1],
      ["bounty_claim", false, 2],
    ]);
    expect(activity.payments).toEqual([
      { tx: "Mixed", to: "builder.testnet", token: "", amount: "1000000000000000000000000", ok: true },
      { tx: "Mixed", to: "helper.testnet", token: USDC, amount: "25000000", ok: true },
    ]);
    // A receipt whose time the index got wrong is skipped.
    const broken = structuredClone(tx);
    for (const r of broken.receipts) r.execution_outcome.block_timestamp = Number.NaN;
    expect(daoActivity(DAO, [broken])).toEqual({ calls: [], payments: [] });
  });

  it("matches bounty_done to its proposal by contributor, bounty and block time", () => {
    const done = PROPOSALS[3];
    const submitted = at(3);
    const call = (who: string, id: number, ms: number) =>
      daoActivity(DAO, [indexed(`Done-${who}-${id}-${ms}`, ms, [{ from: who, to: DAO, call: ["bounty_done", { id, description: "done" }] }])]).calls;
    expect(proposalTxs(done, call("builder.testnet", 0, submitted)).filed?.method).toBe("bounty_done");
    expect(proposalTxs(done, call("builder.testnet", 0, submitted + 5)).filed).toBeNull();
    expect(proposalTxs(done, call("helper.testnet", 0, submitted)).filed).toBeNull();
    expect(proposalTxs(done, call("builder.testnet", 1, submitted)).filed).toBeNull();
  });
});

describe("the board of a DAO with bounties", () => {
  const activity = daoActivity(DAO, BOARD_TXS);
  const metas = new Map([[USDC, { symbol: "USDC", decimals: 6 }]]);

  it("lists bounties with times left, their claims, and the proposal that posted each", () => {
    const open = openBounties(BOUNTIES, new Map([[1, 2], [2, 0]]), CLAIMS, PROPOSALS, activity, metas, NOW);
    expect(open.map((o) => [o.bounty.id, o.amount, o.maxDeadline, o.claimCount, o.unfound, o.postedBy])).toEqual([
      [1, "0.5 NEAR", "3 days", 2, 0, 1],
      [2, "25 USDC", "14 days", 0, 0, 4],
    ]);
    expect(open[0].claims).toEqual([
      { account: "helper.testnet", since: NOW - 2 * DAY, until: NOW - DAY, completed: false, expired: true, tx: null },
      { account: "builder.testnet", since: NOW - DAY, until: NOW + DAY, completed: true, expired: false, tx: "ClaimBuilder1" },
    ]);
    // The DAO counts two claims; with only the builder's read, one is unfound.
    const partial = openBounties(BOUNTIES, new Map([[1, 2]]), new Map([["builder.testnet", CLAIMS.get("builder.testnet") ?? []]]), PROPOSALS, null, metas, NOW);
    expect(partial[0]).toMatchObject({ unfound: 1, claims: [{ account: "builder.testnet", tx: null }] });
    expect(partial[1]).toMatchObject({ claimCount: null, unfound: 0 });
    expect(claimCandidates(BOARD_POLICY, PROPOSALS, activity)).toEqual([
      "builder.testnet",
      "council-1.testnet",
      "council-2.testnet",
      "council-3.testnet",
      "helper.testnet",
    ]);
  });

  it("shows each BountyDone proposal: its status, the contributor, the votes and roles, and the payout", () => {
    const finished = finishedBounties(PROPOSALS, BOUNTIES, BOARD_POLICY, activity, metas, NOW);
    expect(finished.map((f) => [f.proposal.id, f.proposal.status, f.bountyId, f.contributor, f.lapsed])).toEqual([
      [7, "Rejected", 1, "helper.testnet", false],
      [5, "InProgress", 1, "builder.testnet", false],
      [3, "Approved", 0, "builder.testnet", false],
    ]);
    const [rejected, waiting, paid] = finished;
    expect(finished.every((f) => f.ownReport)).toBe(true);
    expect(rejected.votes).toEqual([
      { account: "council-1.testnet", vote: "Reject", roles: ["council"], holderRoles: [], tx: null },
      { account: "council-2.testnet", vote: "Reject", roles: ["council"], holderRoles: [], tx: null },
    ]);
    expect(rejected.counts).toEqual(["council: 2 reject"]);
    expect(rejected.payout).toBeNull();
    expect(waiting).toMatchObject({ votes: [], payout: null, txs: { filed: null, acts: [] } });
    expect(paid.votes).toEqual([{ account: "builder.testnet", vote: "Approve", roles: ["trusted"], holderRoles: [], tx: "VoteBuilder3" }]);
    expect(paid.counts).toEqual(["trusted: 1 approve"]);
    expect(paid.payout).toEqual({ words: "1 NEAR to builder.testnet", tx: "VoteBuilder3" });
    expect(paid.txs?.filed?.tx).toBe("DoneBuilder0");
    expect(paid.bounty?.description).toBe("Translate the quickstart");

    // Without the index, the same proposals with no transaction; past its period, one still open lapses.
    const later = finishedBounties(PROPOSALS, BOUNTIES, BOARD_POLICY, null, metas, NOW + 8 * DAY);
    expect(later.map((f) => [f.proposal.id, f.lapsed, f.txs, f.payout?.tx ?? null])).toEqual([
      [7, false, null, null],
      [5, true, null, null],
      [3, false, null, null],
    ]);
  });

  it("builds each contributor's record from approved proposals, each point with its proposal", () => {
    const records = contributorRecords(TESTNET, PROPOSALS, BOUNTIES, BOARD_POLICY, activity, metas, NOW);
    expect(records.map((r) => r.account)).toEqual(["builder.testnet", "helper.testnet"]);
    const [builder, helper] = records;
    expect(builder).toEqual({
      account: "builder.testnet",
      finished: [{ proposalId: 3, bountyId: 0, words: "bounty #0: Translate the quickstart", tx: "VoteBuilder3" }],
      waiting: [5],
      lapsed: [],
      roles: [{ proposalId: 2, words: "added to trusted", tx: "VoteMember2b" }],
      payouts: [{ proposalId: 3, words: "1 NEAR, bounty #0", tx: "VoteBuilder3" }],
      satchels: [],
      totals: ["1 NEAR"],
    });
    expect(helper).toEqual({
      account: "helper.testnet",
      finished: [],
      waiting: [],
      lapsed: [],
      roles: [],
      payouts: [{ proposalId: 6, words: "0.2 NEAR, a transfer", tx: "VoteTransfer6" }],
      satchels: [],
      totals: ["0.2 NEAR"],
    });
    // A bounty the DAO no longer stores still counts as finished, with no amount to add up.
    const gone = contributorRecords(TESTNET, PROPOSALS, BOUNTIES.slice(1), BOARD_POLICY, null, metas, NOW)[0];
    expect(gone.finished[0].words).toBe("bounty #0, which the DAO no longer stores");
    expect(gone.totals).toEqual([]);
    // Past its voting period, the builder's open report can no longer pass: it moves from waiting to lapsed.
    const later = contributorRecords(TESTNET, PROPOSALS, BOUNTIES, BOARD_POLICY, null, metas, NOW + 8 * DAY)[0];
    expect([later.waiting, later.lapsed]).toEqual([[], [5]]);
  });

  it("doesn't take a BountyDone that someone else filed as the contributor's own report", () => {
    // add_proposal checks nothing in a BountyDone's body, and the policy lets anyone propose.
    const forged: DaoProposal = {
      ...proposal(8, "stranger.testnet", { BountyDone: { bounty_id: 2, receiver_id: "builder.testnet" } }, "InProgress", NOW - 3_600_000),
      description: "I gave up, pay me anyway",
    };
    const all = [...PROPOSALS, forged];
    const [f] = finishedBounties(all, BOUNTIES, BOARD_POLICY, activity, metas, NOW);
    expect(f).toMatchObject({ contributor: "builder.testnet", ownReport: false, lapsed: false });
    expect(f.proposal.proposer).toBe("stranger.testnet");
    // It stays out of the builder's waiting list, open or lapsed.
    const builder = contributorRecords(TESTNET, all, BOUNTIES, BOARD_POLICY, activity, metas, NOW).find((r) => r.account === "builder.testnet");
    expect([builder?.waiting, builder?.lapsed]).toEqual([[5], []]);
    const later = contributorRecords(TESTNET, all, BOUNTIES, BOARD_POLICY, null, metas, NOW + 8 * DAY).find((r) => r.account === "builder.testnet");
    expect([later?.waiting, later?.lapsed]).toEqual([[], [5]]);
    // Once the DAO approves one, it paid the account it names, and the record says who filed it.
    const passed = contributorRecords(TESTNET, [...PROPOSALS, { ...forged, status: "Approved" }], BOUNTIES, BOARD_POLICY, null, metas, NOW);
    expect(passed.find((r) => r.account === "builder.testnet")?.finished.at(-1)).toEqual({
      proposalId: 8,
      bountyId: 2,
      words: "bounty #2: Review the threat model (filed in their name by stranger.testnet)",
      tx: null,
    });
    expect(passed.find((r) => r.account === "stranger.testnet")).toBeUndefined();
  });

  it("reads a satchel gift only from nft_transfer on this network's contract, and records it once approved", () => {
    const call = (receiver_id: string, method_name: string, args: string) => ({
      FunctionCall: { receiver_id, actions: [{ method_name, args, deposit: "1", gas: "30000000000000" }] },
    });
    const give = encodeArgs({ token_id: "10", receiver_id: "builder.testnet" });
    const gift = proposal(8, "council-1.testnet", call(TESTNET.contract, "nft_transfer", give), "InProgress", NOW - 3_600_000);
    expect(proposedGifts(TESTNET, gift)).toEqual([{ tokenId: "10", receiver: "builder.testnet" }]);
    // Another contract's nft_transfer, nft_transfer_call, and arguments that aren't JSON give no satchel.
    expect(proposedGifts(TESTNET, proposal(9, "council-1.testnet", call("other.testnet", "nft_transfer", give), "Approved", NOW))).toEqual([]);
    expect(proposedGifts(TESTNET, proposal(9, "council-1.testnet", call(TESTNET.contract, "nft_transfer_call", give), "Approved", NOW))).toEqual([]);
    expect(proposedGifts(TESTNET, proposal(9, "council-1.testnet", call(TESTNET.contract, "nft_transfer", "bm90IGpzb24="), "Approved", NOW))).toEqual([]);
    // Listed while open, but in no record until it passes.
    expect(satchelGifts(TESTNET, [...PROPOSALS, gift], null).map((g) => [g.proposal.id, g.tokenId, g.tx])).toEqual([[8, "10", null]]);
    const open = contributorRecords(TESTNET, [...PROPOSALS, gift], BOUNTIES, BOARD_POLICY, null, metas, NOW).find((r) => r.account === "builder.testnet");
    expect(open?.satchels).toEqual([]);
    const passed = contributorRecords(TESTNET, [...PROPOSALS, { ...gift, status: "Approved" }], BOUNTIES, BOARD_POLICY, null, metas, NOW).find(
      (r) => r.account === "builder.testnet",
    );
    expect(passed?.satchels).toEqual(["10"]);
    expect(passed?.payouts.at(-1)).toEqual({ proposalId: 8, words: "satchel #10 itself: its address and all it holds", tx: null });
    // A satchel is no amount: the totals stay what the NEAR payouts add up to.
    expect(passed?.totals).toEqual(["1 NEAR"]);
  });

  it("doesn't record a role change for a role today's policy has no group by", () => {
    const misnamed = proposal(8, "council-1.testnet", { AddMemberToRole: { member_id: "helper.testnet", role: "Council" } }, "Approved", NOW - DAY);
    const removed = proposal(9, "council-1.testnet", { RemoveMemberFromRole: { member_id: "helper.testnet", role: "all" } }, "Approved", NOW - DAY);
    const helper = contributorRecords(TESTNET, [...PROPOSALS, misnamed, removed], BOUNTIES, BOARD_POLICY, null, metas, NOW).find(
      (r) => r.account === "helper.testnet",
    );
    expect(helper?.roles.map((r) => r.words)).toEqual([
      "a passed proposal to add them to Council; today's policy has no group by that name, so it may have changed nothing",
      "a passed proposal to remove them from all; today's policy has no group by that name, so it may have changed nothing",
    ]);
  });

  it("marks a role of token holders, and token-weighted vote counts, for what they are", () => {
    const holders: DaoPolicy = {
      ...BOARD_POLICY,
      roles: [...BOARD_POLICY.roles, { name: "holders", kind: { Member: "1" }, permissions: ["*:VoteApprove"], vote_policy: {} }],
    };
    // Under the default RoleWeight policy, each holder's vote counts one against a share of the delegated tokens.
    expect(approvalWays(holders, "transfer").map((w) => w.words)).toEqual([
      "2 of 3 council votes",
      "more holders votes than 1/2 of the tokens delegated to the DAO, in their smallest unit: its vote policy counts each vote as one",
    ]);
    expect(approvalWays({ ...holders, default_vote_policy: { weight_kind: "RoleWeight", quorum: "2", threshold: "3" } }, "transfer")[1].words).toBe(
      "3 holders votes, or fewer if less than that is delegated to the DAO, in its token's smallest unit, and at least 2: its vote policy counts each vote as one",
    );
    expect(roleSummaries(holders)[3].who).toBe("anyone with at least 1 delegated tokens, in their smallest unit");
    // A holder's vote counts in their role only if they hold enough, which the page doesn't read.
    const done = { BountyDone: { bounty_id: 1, receiver_id: "alice.testnet" } };
    const report = proposal(8, "alice.testnet", done, "InProgress", NOW, { "alice.testnet": "Approve" }, { holders: [1, 0, 0] });
    const [f] = finishedBounties([report], BOUNTIES, holders, null, metas, NOW);
    expect(f.votes).toEqual([{ account: "alice.testnet", vote: "Approve", roles: [], holderRoles: ["holders"], tx: null }]);
    expect(f.counts).toEqual(["holders: 1 approve"]);
    // Weighed by tokens, a count is in the token's smallest unit, past what a JSON number holds exactly.
    const weighed: DaoPolicy = {
      ...holders,
      roles: holders.roles.map((r) =>
        r.name === "holders" ? { ...r, vote_policy: { bounty_done: { weight_kind: "TokenWeight", quorum: "0", threshold: [1, 2] } } } : r,
      ),
    };
    const big = { ...report, vote_counts: { holders: [1.5e24, 0, 0] } };
    expect(finishedBounties([big], BOUNTIES, weighed, null, metas, NOW)[0].counts).toEqual([
      "holders: about 1.5e+24 approve (delegated tokens, in their smallest unit)",
    ]);
  });
});

describe("the board's page", () => {
  it("lives at /dao/<account> on testnet, the bounty DAO's included", () => {
    expect(appPath(TESTNET, `/dao/${BOUNTY_DAO}`)).toBe("/dao/satchel-bounty.sputnikv2.testnet");
    expect(boardPageNote(TESTNET, BOUNTY_DAO)).toMatch(/nothing on it signs or sends anything/);
  });
});
