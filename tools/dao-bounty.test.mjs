// Unit tests for dao-bounty.mjs. node:test, so nothing to install: after `npm run build` in
// packages/satchel-nft, run `node --test tools/dao-bounty.test.mjs` from the repository root.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  AMOUNTS,
  DAY_NS,
  FROZEN,
  PROPOSAL_LABELS,
  RESERVED,
  TRUSTED,
  addBountyProposal,
  addSmallBountyProposal,
  assertTransferAsAsked,
  bountyPolicy,
  buildPlan,
  canonical,
  citedBounty,
  claimArgs,
  contributorAddress,
  createArgs,
  decodeSignedTransfer,
  done,
  doneArgs,
  expectedPolicy,
  nextStep,
  oneVoteRoles,
  passesAlone,
  passesUnvoted,
  rolesAllowing,
  runConfig,
  sameRun,
  sendFees,
  sendGas,
  tokenIdsIn,
  transferCliArgs,
  transferProposal,
  trustProposal,
  unresolved,
  votesNeeded,
} from "./dao-bounty.mjs";

const { TESTNET, addressFromMpcKey, base58Encode, decodeBase64, deriveMpcKey } = await import("../packages/satchel-nft/dist/index.js");

const cfg = runConfig();
const [A, B, C] = cfg.council;
const X = cfg.contributor;
const GWEI = 10n ** 9n;

describe("the run's accounts", () => {
  it("defaults to the DAO satchel-bounty.sputnikv2.testnet, a council of three and a contributor", () => {
    assert.equal(cfg.dao, "satchel-bounty.sputnikv2.testnet");
    assert.deepEqual(cfg.council, ["satchel-nft.testnet", "buyer.satchel-nft.testnet", "satchel-council-1112.testnet"]);
    assert.equal(X, "satchel-builder-1112.testnet");
  });

  it("takes other accounts as parameters", () => {
    const other = runConfig({ daoName: "bounty-two", council: ["a1.testnet", "b2.testnet", "c3.testnet"], contributor: "d4.testnet" });
    assert.equal(other.dao, "bounty-two.sputnikv2.testnet");
    assert.equal(other.council[2], "c3.testnet");
  });

  it("refuses a mainnet account anywhere", () => {
    assert.throws(() => runConfig({ contributor: "builder.near" }), /not a testnet account/);
    assert.throws(() => runConfig({ council: ["a.testnet", "b.testnet", "c.near"] }), /not a testnet account/);
    assert.throws(() => runConfig({ factory: "sputnik-dao.near" }), /not a testnet account/);
  });

  it("refuses a council that isn't three different accounts, or that includes the contributor", () => {
    assert.throws(() => runConfig({ council: ["a.testnet", "b.testnet"] }), /three accounts/);
    assert.throws(() => runConfig({ council: ["a.testnet", "a.testnet", "b.testnet"] }), /names an account twice/);
    assert.throws(() => runConfig({ contributor: "satchel-nft.testnet" }), /is on the council/);
  });

  it("refuses a DAO name the factory can't create as one label", () => {
    assert.throws(() => runConfig({ daoName: "two.labels" }), /not a name/);
  });

  it("takes an evidence file as this run's only with the council in the same order: A, B and C each sign their own steps", () => {
    const file = { dao: cfg.dao, council: [...cfg.council], contributor: X };
    assert.equal(sameRun(file, cfg), true);
    assert.equal(sameRun({ ...file, council: [...cfg.council].reverse() }, cfg), false);
    assert.equal(sameRun({ ...file, contributor: "someone-else.testnet" }, cfg), false);
    assert.equal(sameRun({ ...file, dao: "satchel-club.sputnikv2.testnet" }, cfg), false);
  });
});

describe("the DAO's policy", () => {
  const policy = bountyPolicy(cfg.council, [X]);

  it("has a bounty_done proposal pass with one council vote and every other kind with 2 of 3", () => {
    assert.equal(votesNeeded(policy, "council", "bounty_done"), 1n);
    for (const label of PROPOSAL_LABELS.filter((l) => l !== "bounty_done")) {
      assert.equal(votesNeeded(policy, "council", label), 2n, label);
    }
  });

  it("writes a Weight threshold as a U128 string and a Ratio as a pair, as sputnikdao2's untagged WeightOrRatio reads them", () => {
    assert.equal(policy.roles[0].vote_policy.bounty_done.threshold, "1");
    assert.equal(policy.roles[2].vote_policy.bounty_done.threshold, "1");
    assert.deepEqual(policy.default_vote_policy.threshold, [1, 2]);
  });

  it("counts votes as policy.rs's to_weight does", () => {
    const group = (n) => Array.from({ length: n }, (_, i) => `m${i}.testnet`);
    const with_ = (members, threshold, quorum = "0") => ({
      roles: [{ name: "council", kind: { Group: group(members) }, permissions: [], vote_policy: {} }],
      default_vote_policy: { weight_kind: "RoleWeight", quorum, threshold },
    });
    // policy.rs's own test: Ratio(1, 2) of 2 is 2, of 5 is 3; Ratio(1, 1) of 5 is 5; Weight(100) caps at the group.
    assert.equal(votesNeeded(with_(2, [1, 2]), "council", "x"), 2n);
    assert.equal(votesNeeded(with_(5, [1, 2]), "council", "x"), 3n);
    assert.equal(votesNeeded(with_(5, [1, 1]), "council", "x"), 5n);
    assert.equal(votesNeeded(with_(3, "100"), "council", "x"), 3n);
    // The first DAO run: one member, [1, 2] is one vote.
    assert.equal(votesNeeded(with_(1, [1, 2]), "council", "x"), 1n);
    assert.equal(votesNeeded(with_(3, "1", "2"), "council", "x"), 2n, "the quorum is a floor");
  });

  it("gives the contributor, as a group and not Everyone, one permission: adding a bounty_done proposal, which bounty_done needs; bounty_claim needs none", () => {
    const contributors = policy.roles.find((r) => r.name === "contributors");
    assert.deepEqual(contributors.kind, { Group: [X] });
    assert.deepEqual(contributors.permissions, ["bounty_done:AddProposal"]);
    assert.deepEqual(contributors.vote_policy, {});
    assert.equal(policy.roles.some((r) => r.kind === "Everyone"), false);
    assert.equal(createArgs(cfg).decodedArgs.policy.roles[1].kind.Group[0], X);
  });

  it("never lets the contributors group pass a proposal: its threshold is 1 of 1, and it has no vote permission", () => {
    // proposal_status counts every role at Finalize; a group whose threshold came to 0 would pass anything.
    assert.equal(votesNeeded(policy, "contributors", "bounty_done"), 1n);
    assert.equal(votesNeeded(policy, "contributors", "transfer"), 1n);
    assert.equal(policy.roles[1].permissions.some((p) => /Vote|Finalize/.test(p)), false);
    assert.throws(() => bountyPolicy(cfg.council, []), /at least one account/);
  });

  it("sets bond 0 for proposals, 0.1 NEAR for a claim, and one day for proposals and forgiveness", () => {
    assert.equal(policy.proposal_bond, "0");
    assert.equal(policy.bounty_bond, "100000000000000000000000");
    assert.equal(policy.proposal_period, "86400000000000");
    assert.equal(policy.bounty_forgiveness_period, "86400000000000");
  });

  it("passes the policy to the factory as base64 JSON, with the same object as decodedArgs", () => {
    const { args, decodedArgs } = createArgs(cfg);
    assert.equal(args.name, "satchel-bounty");
    assert.deepEqual(JSON.parse(decodeBase64(args.args)), decodedArgs);
    assert.deepEqual(decodedArgs.policy, policy);
    assert.equal(decodedArgs.config.metadata, "");
  });

  it("compares policies whatever order get_policy returns the sets and maps in", () => {
    const shuffled = structuredClone(policy);
    shuffled.roles[0].kind.Group.reverse();
    shuffled.roles[0].permissions = [...shuffled.roles[0].permissions].reverse();
    const reordered = Object.fromEntries(Object.entries(shuffled).reverse());
    assert.equal(canonical(reordered), canonical(policy));
    shuffled.roles[0].vote_policy.bounty_done.threshold = "2";
    assert.notEqual(canonical(shuffled), canonical(policy));
  });
});

describe("the payout tiers", () => {
  const before = bountyPolicy(cfg.council, [X]);
  const after = bountyPolicy(cfg.council, [X], [X]);

  it("creates the role trusted empty, with two permissions: file a bounty_done and approve one", () => {
    const trusted = before.roles.find((r) => r.name === TRUSTED);
    assert.deepEqual(trusted.kind, { Group: [] });
    assert.deepEqual(trusted.permissions, ["bounty_done:AddProposal", "bounty_done:VoteApprove"]);
    assert.deepEqual(Object.keys(trusted.vote_policy), ["bounty_done"]);
    assert.deepEqual(createArgs(cfg).decodedArgs.policy, before);
  });

  it("mid-size: one council vote passes a bounty_done, and no other kind", () => {
    for (const member of cfg.council) {
      assert.deepEqual(rolesAllowing(before, member, "bounty_done", "VoteApprove"), ["council"]);
      assert.equal(passesAlone(before, member, "bounty_done"), true, member);
      for (const label of PROPOSAL_LABELS.filter((l) => l !== "bounty_done")) assert.equal(passesAlone(before, member, label), false, `${member} ${label}`);
    }
  });

  it("before the trust vote, the contributor may file a bounty_done and vote on nothing", () => {
    assert.deepEqual(rolesAllowing(before, X, "bounty_done", "AddProposal"), ["contributors"]);
    for (const label of PROPOSAL_LABELS) {
      for (const action of ["VoteApprove", "VoteReject", "VoteRemove", "Finalize"]) assert.deepEqual(rolesAllowing(before, X, label, action), [], `${label}:${action}`);
    }
  });

  it("small: once trusted, the contributor's own vote passes a bounty_done, counted in trusted alone", () => {
    assert.deepEqual(rolesAllowing(after, X, "bounty_done", "VoteApprove"), [TRUSTED]);
    assert.equal(votesNeeded(after, TRUSTED, "bounty_done"), 1n);
    assert.equal(passesAlone(after, X, "bounty_done"), true);
  });

  it("a trusted member can't file, vote on or finalize any other kind, so it passes nothing else", () => {
    for (const label of PROPOSAL_LABELS.filter((l) => l !== "bounty_done")) {
      for (const action of ["AddProposal", "VoteApprove", "VoteReject", "VoteRemove", "Finalize", "RemoveProposal"]) {
        assert.deepEqual(rolesAllowing(after, X, label, action), [], `${label}:${action}`);
      }
      assert.equal(passesAlone(after, X, label), false, label);
    }
    // Nor reject or finalize a bounty_done: it approves, and the council does the rest.
    for (const action of ["VoteReject", "VoteRemove", "Finalize"]) assert.deepEqual(rolesAllowing(after, X, "bounty_done", action), [], action);
  });

  it("large: anything but a bounty_done needs 2 of the 3 council members, and adding to trusted changes no council count", () => {
    for (const label of PROPOSAL_LABELS.filter((l) => l !== "bounty_done")) assert.equal(votesNeeded(after, "council", label), 2n, label);
    assert.equal(votesNeeded(after, "council", "bounty_done"), 1n);
  });

  it("lets no kind pass with no votes when a council member finalizes it, trusted empty or not: every quorum is 1", () => {
    for (const p of [before, after]) for (const label of PROPOSAL_LABELS) assert.deepEqual(passesUnvoted(p, label), [], label);
    assert.equal(votesNeeded(before, TRUSTED, "bounty_done"), 1n, "an empty group still needs one vote");
    assert.equal(votesNeeded(before, TRUSTED, "transfer"), 1n);
  });

  it("shows why: with quorum 0, an empty trusted group would read no votes as enough for every kind", () => {
    const open = structuredClone(before);
    open.default_vote_policy.quorum = "0";
    for (const r of open.roles) for (const vp of Object.values(r.vote_policy)) vp.quorum = "0";
    for (const label of PROPOSAL_LABELS) assert.deepEqual(passesUnvoted(open, label), [TRUSTED], label);
    assert.deepEqual(passesUnvoted(bountyPolicy(cfg.council, [X], [X]), "transfer"), []);
  });

  it("names the roles whose one vote passes a bounty_done, as the second bounty's work reads them", () => {
    assert.deepEqual(oneVoteRoles(before, "bounty_done").map((r) => r.name), ["council"]);
    assert.deepEqual(oneVoteRoles(after, "bounty_done").map((r) => r.name), ["council", TRUSTED]);
    assert.deepEqual(oneVoteRoles(after, "transfer"), []);
  });

  it("expects the created policy until the trust vote is in, then the same with the contributor in trusted", () => {
    assert.deepEqual(expectedPolicy(cfg, { steps: [{ key: "trustVote1" }] }), before);
    assert.deepEqual(expectedPolicy(cfg, { steps: [{ key: "trustVote2" }] }), after);
    const changed = after.roles.filter((r, i) => canonical(r) !== canonical(before.roles[i]));
    assert.deepEqual(changed.map((r) => r.name), [TRUSTED]);
  });

  it("refuses a role it can't match by name, as a Member role by token balance", () => {
    const member = structuredClone(before);
    member.roles.push({ name: "holders", kind: { Member: "1" }, permissions: ["*:VoteApprove"], vote_policy: {} });
    assert.throws(() => rolesAllowing(member, X, "transfer", "VoteApprove"), /doesn't use/);
  });
});

describe("the bounty's calls", () => {
  it("posts 0.5 NEAR, paid in NEAR, done once, within a day of a claim", () => {
    const { proposal } = addBountyProposal("10");
    const b = proposal.kind.AddBounty.bounty;
    assert.deepEqual(Object.keys(b), ["description", "token", "amount", "times", "max_deadline"]);
    assert.equal(b.token, "");
    assert.equal(b.amount, "500000000000000000000000");
    assert.equal(b.times, 1);
    assert.equal(b.max_deadline, DAY_NS.toString());
  });

  it("claims with a deadline no later than the bounty's, and reports done without account_id", () => {
    assert.deepEqual(claimArgs(0), { id: 0, deadline: "86400000000000" });
    assert.deepEqual(doneArgs(0, "done"), { id: 0, description: "done" });
  });

  it("files the payout it turns down as a NEAR Transfer with the fields in get_proposal's order", () => {
    const { proposal } = transferProposal(X, AMOUNTS.rejected, "more");
    assert.deepEqual(proposal.kind, { Transfer: { token_id: "", receiver_id: X, amount: "1000000000000000000000000", msg: null } });
  });

  it("keeps both bounties and the bond apart, so a payout and a bond return can be told apart in the receipts", () => {
    assert.equal(new Set([AMOUNTS.bounty, AMOUNTS.smallBounty, AMOUNTS.bountyBond]).size, 3);
    assert.ok(AMOUNTS.rejected > AMOUNTS.bounty);
  });

  it("posts the second bounty smaller: 0.2 NEAR, done once, within a day of a claim", () => {
    const b = addSmallBountyProposal().proposal.kind.AddBounty.bounty;
    assert.deepEqual(Object.keys(b), ["description", "token", "amount", "times", "max_deadline"]);
    assert.equal(b.amount, "200000000000000000000000");
    assert.ok(AMOUNTS.smallBounty < AMOUNTS.bounty);
    assert.equal(b.token, "");
    assert.equal(b.times, 1);
  });

  it("adds the contributor to trusted by AddMemberToRole, citing the finished bounty and its BountyDone proposal", () => {
    const { proposal } = trustProposal(X, 0, 1);
    assert.deepEqual(proposal.kind, { AddMemberToRole: { member_id: X, role: "trusted" } });
    assert.deepEqual(citedBounty(proposal.description), { bountyId: 0, proposalId: 1 });
    assert.equal(citedBounty("Add someone to trusted"), null);
  });
});

describe("the satchel the run mints", () => {
  it("is #10, whose Sepolia address the OWNER funded: the address derived for satchel/10", () => {
    assert.equal(RESERVED.tokenId, "10");
    assert.equal(addressFromMpcKey(deriveMpcKey(TESTNET.mpcRootKey, TESTNET.contract, "satchel/10")), RESERVED.address);
    assert.equal(FROZEN.has(RESERVED.tokenId), false);
    assert.match(RESERVED.fundingTx, /^0x[0-9a-f]{64}$/);
  });

  it("is given to the contributor as the first DAO run gave #8: nft_transfer, 1 yoctoNEAR, 30 TGas, token_id then receiver_id", () => {
    const first = JSON.parse(readFileSync(new URL("../deployments/testnet-dao.json", import.meta.url), "utf8")).steps.find((s) => s.step?.startsWith("Proposal 1"));
    const [was] = first.args.proposal.kind.FunctionCall.actions;
    const run = { steps: [{ key: "mint", tokenId: "10" }] };
    const step = buildPlan(cfg, run).find((s) => s.key === "giveProposal");
    const { receiver_id, actions } = step.args.proposal.kind.FunctionCall;
    assert.equal(receiver_id, first.args.proposal.kind.FunctionCall.receiver_id);
    assert.equal(actions.length, 1);
    assert.equal(actions[0].method_name, was.method_name);
    assert.equal(actions[0].deposit, "1");
    assert.equal(actions[0].gas, was.gas);
    assert.deepEqual(Object.keys(JSON.parse(decodeBase64(actions[0].args))), Object.keys(JSON.parse(decodeBase64(was.args))));
    assert.deepEqual(JSON.parse(decodeBase64(actions[0].args)), { token_id: "10", receiver_id: X });
    assert.deepEqual(tokenIdsIn(step.args), ["10"]);
  });
});

describe("the contributor's own address", () => {
  it("is the key the MPC network derives for the contributor's account at ethereum-1", () => {
    const x = contributorAddress(X);
    assert.equal(x.path, "ethereum-1");
    // derived_public_key({ path: "ethereum-1", predecessor: "satchel-builder-1112.testnet", domain_id: 0 })
    // on v1.signer-prod.testnet, read 2026-11-12.
    assert.equal(x.publicKey, "secp256k1:2KZL5upDLaCXuv2Up48izS11KBXFBJUHqLhz63HjzRD3gamWU3NzexU516X8ZFTStkiEhChntd9qR2JUAZwBTatz");
    assert.equal(x.address, "0x705be1e37589c13a461f67461Fd407739d02d1da");
  });

  it("differs from the address the same path gives another account", () => {
    assert.notEqual(contributorAddress("someone-else.testnet").address, contributorAddress(X).address);
  });
});

describe("the Sepolia send's fees and gas", () => {
  it("never caps fees below the first DAO run's: 1 gwei tip, 5 gwei cap", () => {
    assert.deepEqual(sendFees(23n, 4n), { maxPriorityFeePerGas: GWEI, maxFeePerGas: 5n * GWEI });
  });

  it("follows a high base fee: twice it plus the tip", () => {
    assert.deepEqual(sendFees(10n * GWEI, 2n * GWEI), { maxPriorityFeePerGas: 2n * GWEI, maxFeePerGas: 22n * GWEI });
  });

  it("adds 20% to the estimate, and never goes under 21000", () => {
    assert.equal(sendGas(207_391n), 248_869n);
    assert.equal(sendGas(21_000n), 21_000n);
    assert.equal(sendGas(1n), 21_000n);
  });
});

/** A borsh SignedTransaction V0 with the given actions' bytes, signed with zeros. */
function signedTx({ signer = C, receiver = cfg.dao, keyType = 0, actions }) {
  const str = (s) => {
    const b = Buffer.from(s);
    const n = Buffer.alloc(4);
    n.writeUInt32LE(b.length);
    return Buffer.concat([n, b]);
  };
  const u64 = (v) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(v);
    return b;
  };
  const count = Buffer.alloc(4);
  count.writeUInt32LE(actions.length);
  const unsigned = Buffer.concat([
    str(signer),
    Buffer.from([keyType]),
    Buffer.alloc(keyType === 0 ? 32 : 64, 7),
    u64(42n),
    str(receiver),
    Buffer.alloc(32, 9),
    count,
    ...actions,
  ]);
  const signature = Buffer.concat([Buffer.from([keyType]), Buffer.alloc(keyType === 0 ? 64 : 65)]);
  return { base64: Buffer.concat([unsigned, signature]).toString("base64"), unsigned };
}
const transfer = (yocto) => Buffer.concat([Buffer.from([3]), (() => {
  const b = Buffer.alloc(16);
  b.writeBigUInt64LE(yocto & ((1n << 64n) - 1n), 0);
  b.writeBigUInt64LE(yocto >> 64n, 8);
  return b;
})()]);

describe("the treasury transfer, signed by the near CLI", () => {
  it("asks the near CLI to sign a NEAR transfer on testnet without sending it", () => {
    assert.deepEqual(transferCliArgs(TESTNET, C, cfg.dao, AMOUNTS.treasury), [
      "tokens", C, "send-near", cfg.dao, "2000000000000000000000000 yoctonear",
      "network-config", "testnet", "sign-with-legacy-keychain", "display",
    ]);
  });

  it("decodes the signed transfer and hashes it as NEAR does, sha256 of the unsigned bytes", () => {
    const { base64, unsigned } = signedTx({ actions: [transfer(AMOUNTS.treasury)] });
    const decoded = decodeSignedTransfer(base64);
    assert.equal(decoded.signerId, C);
    assert.equal(decoded.receiverId, cfg.dao);
    assert.equal(decoded.deposit, AMOUNTS.treasury);
    assert.equal(decoded.nonce, 42n);
    assert.equal(decoded.hash, base58Encode(createHash("sha256").update(unsigned).digest()));
    assertTransferAsAsked(decoded, C, cfg.dao, AMOUNTS.treasury);
  });

  it("reads a deposit past 64 bits", () => {
    const big = (1n << 100n) + 5n;
    assert.equal(decodeSignedTransfer(signedTx({ actions: [transfer(big)] }).base64).deposit, big);
  });

  it("refuses anything that isn't one transfer: another action, two actions, trailing bytes, a V1 transaction", () => {
    const call = Buffer.from([2, 0, 0, 0, 0]);
    assert.throws(() => decodeSignedTransfer(signedTx({ actions: [call] }).base64), /not a transfer|ends early/);
    assert.throws(() => decodeSignedTransfer(signedTx({ actions: [transfer(1n), transfer(1n)] }).base64), /exactly one action/);
    const { base64 } = signedTx({ actions: [transfer(1n)] });
    assert.throws(() => decodeSignedTransfer(Buffer.concat([Buffer.from(base64, "base64"), Buffer.from([0])]).toString("base64")), /trailing bytes/);
    assert.throws(() => decodeSignedTransfer(Buffer.concat([Buffer.from([1]), Buffer.from(base64, "base64")]).toString("base64")), /V1/);
  });

  it("refuses a transfer to anyone else, from anyone else, or of another amount", () => {
    const decoded = decodeSignedTransfer(signedTx({ actions: [transfer(AMOUNTS.treasury)] }).base64);
    assert.throws(() => assertTransferAsAsked(decoded, A, cfg.dao, AMOUNTS.treasury), /the signer is/);
    assert.throws(() => assertTransferAsAsked(decoded, C, "elsewhere.testnet", AMOUNTS.treasury), /the receiver is/);
    assert.throws(() => assertTransferAsAsked(decoded, C, cfg.dao, AMOUNTS.treasury + 1n), /the amount is/);
  });
});

describe("the plan", () => {
  const plan = buildPlan(cfg);
  const keys = plan.map((s) => s.key);

  it("runs Sputnik's flows in order: create, fund, mint, post, claim, finish, pay, trust, pay again, sign, broadcast, turn down, give", () => {
    assert.deepEqual(keys, [
      "create", "treasury", "mint", "addBounty", "addBountyVote1", "addBountyVote2", "claim", "done", "doneVote",
      "trustProposal", "trustVote1", "trustVote2", "addBounty2", "addBounty2Vote1", "addBounty2Vote2", "claim2", "done2", "done2Vote",
      "fundSepolia", "sendProposal", "sendVote1", "sendVote2", "finish", "rejectProposal", "rejectApprove", "reject1", "reject2",
      "giveProposal", "giveVote1", "giveVote2",
    ]);
    assert.equal(new Set(keys).size, keys.length);
  });

  it("has each council member and the contributor sign what the policy lets them", () => {
    const by = Object.fromEntries(plan.map((s) => [s.key, s.signer]));
    assert.deepEqual([by.addBountyVote1, by.addBountyVote2], [A, B]);
    assert.deepEqual([by.claim, by.done], [X, X]);
    assert.equal(by.doneVote, C);
    assert.deepEqual([by.trustProposal, by.trustVote1, by.trustVote2], [C, C, A]);
    assert.deepEqual([by.addBounty2, by.addBounty2Vote1, by.addBounty2Vote2], [B, B, C]);
    assert.deepEqual([by.claim2, by.done2, by.done2Vote], [X, X, X]);
    assert.deepEqual([by.sendVote1, by.sendVote2], [A, C]);
    assert.deepEqual([by.rejectProposal, by.rejectApprove, by.reject1, by.reject2], [C, C, A, B]);
    assert.deepEqual([by.giveProposal, by.giveVote1, by.giveVote2], [A, A, B]);
    assert.equal(plan.find((s) => s.key === "fundSepolia").by, "owner");
    assert.equal(plan.find((s) => s.key === "finish").by, "cli");
  });

  it("has every vote and proposal come from an account the policy lets act on that kind at that point of the run", () => {
    const LABEL = { AddBounty: "add_bounty", AddMemberToRole: "add_member_to_role", FunctionCall: "call", Transfer: "transfer" };
    const labelOf = (s) => (s.method === "bounty_done" ? "bounty_done" : LABEL[Object.keys(s.args.proposal.kind)[0]]);
    const run = { steps: [] };
    for (const s of plan) {
      const policy = expectedPolicy(cfg, run);
      if (s.method === "act_proposal") {
        const label = labelOf(plan.find((p) => p.key === s.proposalOf));
        assert.ok(rolesAllowing(policy, s.signer, label, s.args.action).length > 0, `${s.key}: ${s.signer} may not ${s.args.action} a ${label}`);
      } else if (s.method === "add_proposal" || s.method === "bounty_done") {
        assert.ok(rolesAllowing(policy, s.signer, labelOf(s), "AddProposal").length > 0, `${s.key}: ${s.signer} may not file a ${labelOf(s)}`);
      }
      run.steps.push({ key: s.key });
    }
    // The vote that pays bounty 1 is the contributor's, in trusted, with the trust vote before it.
    assert.ok(keys.indexOf("trustVote2") < keys.indexOf("done2Vote"));
    assert.ok(keys.indexOf("doneVote") < keys.indexOf("trustProposal"), "trust comes after a finished bounty");
    assert.ok(keys.indexOf("finish") < keys.indexOf("giveProposal"), "the satchel is given after its send is broadcast");
  });

  it("attaches exactly the bonds the policy names: 0 to every proposal, 0.1 NEAR to each claim", () => {
    for (const s of plan.filter((p) => p.method === "add_proposal" || p.method === "bounty_done" || p.method === "act_proposal")) {
      assert.equal(s.deposit, "0", s.key);
    }
    for (const key of ["claim", "claim2"]) assert.equal(plan.find((s) => s.key === key).deposit, bountyPolicy(cfg.council, [X]).bounty_bond, key);
    assert.equal(plan.find((s) => s.key === "create").deposit, "6000000000000000000000000");
    assert.equal(plan.find((s) => s.key === "mint").deposit, "100000000000000000000000");
  });

  it("gives every call a whole number of Tgas, and the votes that run a FunctionCall 300 TGas", () => {
    for (const s of plan.filter((p) => p.gas)) assert.equal(BigInt(s.gas) % 10n ** 12n, 0n, s.key);
    for (const key of ["sendVote1", "sendVote2", "giveVote1", "giveVote2"]) assert.equal(plan.find((s) => s.key === key).gas, "300000000000000", key);
    assert.equal(plan.find((s) => s.key === "sendProposal").args.proposal.kind.FunctionCall.actions[0].gas, "150000000000000");
  });

  it("shows what isn't known yet as placeholders, and the runner never sends such a step", () => {
    assert.ok(unresolved(plan.find((s) => s.key === "addBounty")), "the bounty names the satchel the mint returns");
    assert.ok(unresolved(plan.find((s) => s.key === "addBountyVote1")), "the vote names the proposal add_proposal returns");
    assert.ok(unresolved(plan.find((s) => s.key === "trustProposal")), "the trust proposal cites the BountyDone proposal bounty_done files");
    assert.ok(unresolved(plan.find((s) => s.key === "done2")), "the report of work done quotes what the contributor read");
    assert.ok(unresolved(plan.find((s) => s.key === "giveProposal")), "the gift names the satchel the mint returns");
    assert.equal(unresolved(plan.find((s) => s.key === "create")), false);
    assert.equal(unresolved(plan.find((s) => s.key === "mint")), false);
    assert.equal(unresolved(plan.find((s) => s.key === "addBounty2")), false);
  });

  it("cites the finished bounty in the trust proposal once bounty_done has filed its proposal", () => {
    const run = { steps: [{ key: "addBountyVote2", bountyId: 0 }, { key: "done", proposalId: 1, kind: { BountyDone: { bounty_id: 0, receiver_id: X } } }] };
    const step = buildPlan(cfg, run).find((s) => s.key === "trustProposal");
    assert.equal(unresolved(step), false);
    assert.deepEqual(citedBounty(step.args.proposal.description), { bountyId: 0, proposalId: 1 });
    const vote = buildPlan(cfg, run).find((s) => s.key === "doneVote");
    assert.deepEqual(vote.args, { id: 1, action: "VoteApprove", proposal: { BountyDone: { bounty_id: 0, receiver_id: X } } });
  });

  it("reads satchel #10's funding back without a flag", () => {
    const fund = buildPlan(cfg, { address: RESERVED.address, steps: [{ key: "mint", tokenId: "10" }] }).find((s) => s.key === "fundSepolia");
    assert.ok(fund.checks.some((c) => c.includes(RESERVED.fundingTx)));
  });

  it("sees a placeholder inside a FunctionCall proposal's base64 arguments: the send's fees before they are read", () => {
    const run = { address: "0xcbd17720A542e151c8E5884659B5a8e5B3973500", steps: [{ key: "mint", tokenId: "10" }] };
    const step = buildPlan(cfg, run).find((s) => s.key === "sendProposal");
    assert.equal(JSON.stringify(step.args).includes("<"), false, "the placeholders are only in the base64");
    assert.ok(unresolved(step));
  });

  it("asks the OWNER for the funding transaction, not only a balance", () => {
    const fund = plan.find((s) => s.key === "fundSepolia");
    assert.ok(fund.checks.some((c) => c.includes("--funding-tx")));
  });

  it("fills in ids and kinds from the steps already run", () => {
    const run = {
      address: "0xcbd17720A542e151c8E5884659B5a8e5B3973500",
      steps: [
        { key: "mint", tokenId: "10" },
        { key: "addBounty", proposalId: 0, args: addBountyProposal("10") },
      ],
    };
    const p = buildPlan(cfg, run);
    const vote = p.find((s) => s.key === "addBountyVote1");
    assert.deepEqual(vote.args, { id: 0, action: "VoteApprove", proposal: addBountyProposal("10").proposal.kind });
    assert.equal(unresolved(vote), false);
    assert.equal(nextStep(p, run).key, "create");
    assert.equal(done(run, "mint").tokenId, "10");
  });

  it("has the DAO's satchel send to the contributor's own address at nonce 0, on Sepolia", () => {
    const run = { steps: [{ key: "mint", tokenId: "10" }] };
    const sendTx = {
      chain_id: "11155111", nonce: "0", max_priority_fee_per_gas: "1000000000", max_fee_per_gas: "5000000000",
      gas_limit: "248869", to: contributorAddress(X).address, value: AMOUNTS.send.toString(), data: "0x",
    };
    const step = buildPlan(cfg, run, { sendTx }).find((s) => s.key === "sendProposal");
    const action = step.args.proposal.kind.FunctionCall.actions[0];
    assert.equal(step.args.proposal.kind.FunctionCall.receiver_id, "v1.satchel-nft.testnet");
    assert.deepEqual(JSON.parse(decodeBase64(action.args)), { token_id: "10", tx: sendTx });
    assert.equal(unresolved(step), false);
  });

  it("finds every token id an action names, inside a proposal's base64 arguments too", () => {
    const run = { steps: [{ key: "mint", tokenId: "10" }] };
    const step = buildPlan(cfg, run).find((s) => s.key === "sendProposal");
    assert.deepEqual(tokenIdsIn(step.args), ["10"]);
    assert.deepEqual(tokenIdsIn({ proposal: { kind: { FunctionCall: { actions: [{ args: Buffer.from('{"token_id":"8"}').toString("base64") }] } } } }), ["8"]);
    assert.deepEqual(tokenIdsIn(buildPlan(cfg).find((s) => s.key === "create").args), []);
    assert.ok(FROZEN.has("8") && FROZEN.has("9") && !FROZEN.has("10"));
  });

  it("matches the first DAO run's create call: same factory, method, deposit and gas", () => {
    const first = JSON.parse(readFileSync(new URL("../deployments/testnet-dao.json", import.meta.url), "utf8")).steps[2];
    const create = plan[0];
    assert.equal(create.receiver, first.receiver);
    assert.equal(create.method, first.method);
    assert.equal(create.deposit, first.deposit);
    assert.equal(create.gas, first.gas);
    assert.deepEqual(Object.keys(create.args), Object.keys(first.args));
    assert.deepEqual(Object.keys(create.decodedArgs.policy), Object.keys(first.decodedArgs.policy));
  });
});
