// Unit tests for estate.mjs. node:test, so nothing to install: after `npm run build` in
// packages/satchel-nft, run `node --test tools/estate.test.mjs` from the repository root.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { builtPackage } from "../scripts/built.mjs";
import { codeHash as scriptCodeHash } from "../scripts/code-hash.mjs";
import {
  EARLY_MARGIN_NS,
  FROZEN,
  GAS,
  LAST_FROZEN,
  LATE_MARGIN_NS,
  LATE_TX,
  MAX_MINUTES,
  REFUSED,
  assertDeleteKeyAsAsked,
  assertDeployAsAsked,
  buildPlan,
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

const { TESTNET, TGAS, base58Encode } = await builtPackage();

const cfg = runConfig();
const LIB = readFileSync(new URL("../contracts/estate/src/lib.rs", import.meta.url), "utf8");

describe("the run's accounts and rules", () => {
  it("defaults to the estate satchel-estate-1112.testnet, two guardians who must both approve, a 3-minute interval and a 5-minute waiting period", () => {
    assert.equal(cfg.estate, "satchel-estate-1112.testnet");
    assert.equal(cfg.owner, "buyer.satchel-nft.testnet");
    assert.deepEqual(cfg.guardians, ["satchel-nft.testnet", "satchel-council-1112.testnet"]);
    assert.equal(cfg.threshold, 2);
    assert.equal(cfg.heir, "satchel-builder-1112.testnet");
    assert.equal(cfg.intervalMinutes, 3);
    assert.equal(cfg.waitingMinutes, 5);
    assert.equal(cfg.satchel, TESTNET.contract);
  });

  it("leaves the waiting period minutes past the margin, for the calls that must land inside it", () => {
    assert.ok(minutesNs(cfg.waitingMinutes) - EARLY_MARGIN_NS >= minutesNs(4));
    assert.ok(cfg.waitingMinutes > cfg.intervalMinutes);
  });

  it("takes other accounts and timers as parameters, the numbers as the flags give them", () => {
    const other = runConfig({ estate: "e2.testnet", guardians: ["g1.testnet"], threshold: "1", intervalMinutes: "5", waitingMinutes: "7" });
    assert.equal(other.estate, "e2.testnet");
    assert.equal(other.threshold, 1);
    assert.equal(other.intervalMinutes, 5);
    assert.equal(other.waitingMinutes, 7);
  });

  it("refuses a mainnet account anywhere", () => {
    assert.throws(() => runConfig({ estate: "estate.near" }), /not a testnet account/);
    assert.throws(() => runConfig({ owner: "owner.near" }), /not a testnet account/);
    assert.throws(() => runConfig({ heir: "heir.near" }), /not a testnet account/);
    assert.throws(() => runConfig({ guardians: ["a.testnet", "b.near"] }), /not a testnet account/);
  });

  it("refuses the rules contracts/estate's new refuses", () => {
    assert.throws(() => runConfig({ guardians: [] }), /1 to 5 guardians/);
    assert.throws(() => runConfig({ guardians: ["a.testnet", "b.testnet", "c.testnet", "d.testnet", "e.testnet", "f.testnet"] }), /1 to 5 guardians/);
    assert.throws(() => runConfig({ guardians: ["a.testnet", "a.testnet"] }), /named twice/);
    assert.throws(() => runConfig({ guardians: ["a.testnet", cfg.owner] }), /owner .* is a guardian/);
    assert.throws(() => runConfig({ guardians: ["a.testnet", cfg.heir] }), /heir .* is a guardian/);
    assert.throws(() => runConfig({ heir: cfg.owner }), /is the owner/);
    assert.throws(() => runConfig({ heir: cfg.estate }), /its own owner, heir or guardian/);
    assert.throws(() => runConfig({ threshold: 0 }), /threshold 0/);
    assert.throws(() => runConfig({ threshold: 3 }), /threshold 3/);
    assert.throws(() => runConfig({ threshold: 1.5 }), /threshold 1.5/);
    assert.throws(() => runConfig({ intervalMinutes: 0 }), /interval is 0 minutes/);
    assert.throws(() => runConfig({ waitingMinutes: MAX_MINUTES + 1 }), /waiting period is/);
    assert.equal(runConfig({ waitingMinutes: MAX_MINUTES }).waitingMinutes, MAX_MINUTES);
  });

  it("takes an evidence file as this run's only with the same estate, people, timers and guardians in order", () => {
    const file = {
      estate: cfg.estate, owner: cfg.owner, heir: cfg.heir, guardians: [...cfg.guardians], threshold: 2, checkInIntervalMinutes: 3, waitingPeriodMinutes: 5,
    };
    assert.equal(sameRun(file, cfg), true);
    assert.equal(sameRun({ ...file, guardians: [...cfg.guardians].reverse() }, cfg), false);
    assert.equal(sameRun({ ...file, heir: "someone-else.testnet" }, cfg), false);
    assert.equal(sameRun({ ...file, waitingPeriodMinutes: 4 }, cfg), false);
    assert.equal(sameRun({ ...file, estate: "other-estate.testnet" }, cfg), false);
  });
});

describe("what the contract and the run agree on", () => {
  it("names new's arguments as contracts/estate's new takes them, in order", () => {
    const params = LIB.match(/pub fn new\(([\s\S]*?)\) -> Self/)[1].split(",").map((p) => p.trim().split(":")[0]).filter(Boolean);
    assert.deepEqual(Object.keys(initArgs(cfg, "11")), params);
  });

  it("expects the panic messages contracts/estate words, and near-sdk's for a private method", () => {
    for (const message of [REFUSED.early, REFUSED.waiting, REFUSED.released]) assert.ok(LIB.includes(`"${message}"`), message);
    assert.match(LIB, /#\[private\]\s*pub fn on_release/);
    assert.equal(REFUSED.privateCallback, "Method on_release is private");
  });

  it("caps the timers as the contract does", () => {
    assert.equal(MAX_MINUTES, 5_256_000);
    assert.match(LIB, /pub const MAX_MINUTES: u32 = 10 \* 365 \* 24 \* 60;/);
    assert.ok(LIB.includes("must be 1 to 5256000 minutes"));
  });

  it("attaches at least the gas the contract asks for", () => {
    const tgas = (name) => BigInt(LIB.match(new RegExp(`pub const ${name}: Gas = Gas::from_tgas\\((\\d+)\\);`))[1]) * TGAS;
    assert.ok(GAS.finalize >= tgas("MIN_FINALIZE_GAS"));
    assert.ok(GAS.sign >= tgas("MIN_SIGN_GAS"));
    assert.ok(tgas("MIN_FINALIZE_GAS") >= tgas("TRANSFER_GAS") + tgas("CALLBACK_GAS"));
    assert.ok(tgas("MIN_SIGN_GAS") > tgas("SATCHEL_SIGN_GAS"));
  });

  it("sends the old owner's late transaction with exactly the fields of the contract's EvmTx", () => {
    const fields = [...LIB.match(/pub struct EvmTx \{([\s\S]*?)\n\}/)[1].matchAll(/pub (\w+):/g)].map((m) => m[1]);
    assert.deepEqual(Object.keys(LATE_TX), fields);
  });

  it("converts minutes to nanoseconds of block time", () => {
    assert.equal(minutesNs(3), 180_000_000_000n);
    assert.equal(isoAt(1_700_000_000_000_000_000n), "2023-11-14T22:13:20Z");
    assert.ok(EARLY_MARGIN_NS > LATE_MARGIN_NS);
  });
});

describe("the plan", () => {
  const keys = (plan) => plan.map((s) => s.key);

  it("runs the steps in order: deploy, lock, mint, check-ins, approvals, refusals, waits, finalize, the late sign and the report", () => {
    assert.deepEqual(keys(buildPlan(cfg)), [
      "deploy", "lock", "mint", "checkIn", "earlyApprove", "waitOverdue", "approve1", "approve2", "cancel", "waitOverdue2",
      "reapprove1", "reapprove2", "earlyFinalize", "forgedRelease", "waitRelease", "finalize", "lateSign", "heirReport",
    ]);
  });

  it("has one approval per guardian the threshold needs, by the guardians in order", () => {
    const one = runConfig({ threshold: 1 });
    const plan = buildPlan(one);
    assert.deepEqual(keys(plan).filter((k) => /approve\d/.test(k)), ["approve1", "reapprove1"]);
    assert.equal(plan.find((s) => s.key === "approve1").signer, cfg.guardians[0]);
    assert.match(plan.find((s) => s.key === "approve1").title, /the waiting period starts/);
    const two = buildPlan(cfg);
    assert.equal(two.find((s) => s.key === "approve2").signer, cfg.guardians[1]);
    assert.doesNotMatch(two.find((s) => s.key === "approve1").title, /starts/);
  });

  it("holds placeholders until the deploy and the lock read what they need, and never sends a step that holds one", () => {
    const plan = buildPlan(cfg);
    assert.equal(unresolved(plan.find((s) => s.key === "deploy")), true);
    assert.equal(unresolved(plan.find((s) => s.key === "lock")), true);
    const live = buildPlan(cfg, {}, { tokenId: "11", publicKey: "ed25519:abc" });
    assert.equal(unresolved(live.find((s) => s.key === "deploy")), false);
    assert.equal(live.find((s) => s.key === "deploy").args.token_id, "11");
    assert.equal(unresolved(live.find((s) => s.key === "lock")), false);
    assert.equal(live.find((s) => s.key === "lock").publicKey, "ed25519:abc");
  });

  it("takes the satchel's id from the deploy the evidence file recorded", () => {
    const run = { steps: [{ key: "deploy", decodedArgs: initArgs(cfg, "12") }] };
    const plan = buildPlan(cfg, run);
    assert.equal(plan.find((s) => s.key === "deploy").args.token_id, "12");
    assert.match(plan.find((s) => s.key === "mint").title, /satchel #12/);
    assert.equal(nextStep(plan, run).key, "lock");
    assert.equal(done(run, "deploy").decodedArgs.token_id, "12");
  });

  it("mints straight to the estate with the mint deposit, and has every other call go to the estate", () => {
    const plan = buildPlan(cfg, {}, { tokenId: "11" });
    const mint = plan.find((s) => s.key === "mint");
    assert.equal(mint.receiver, TESTNET.contract);
    assert.deepEqual(mint.args, { receiver_id: cfg.estate });
    assert.equal(mint.deposit, "100000000000000000000000");
    for (const s of plan.filter((p) => p.by === "controller" && p.key !== "mint")) assert.equal(s.receiver, cfg.estate, s.key);
  });

  it("expects the chain to refuse exactly four calls, each with the contract's message", () => {
    const refused = buildPlan(cfg).filter((s) => s.refused);
    assert.deepEqual(refused.map((s) => [s.key, s.signer, s.method, s.refused]), [
      ["earlyApprove", cfg.guardians[0], "approve_release", REFUSED.early],
      ["earlyFinalize", cfg.heir, "finalize_release", REFUSED.waiting],
      ["forgedRelease", cfg.heir, "on_release", REFUSED.privateCallback],
      ["lateSign", cfg.owner, "sign_evm", REFUSED.released],
    ]);
  });

  it("has the old owner's sign_evm attach 1 yoctoNEAR and 300 TGas, so only the release can refuse it", () => {
    const late = buildPlan(cfg).find((s) => s.key === "lateSign");
    assert.equal(late.deposit, "1");
    assert.equal(late.gas, (300n * TGAS).toString());
    assert.deepEqual(late.args, { tx: LATE_TX });
  });

  it("names no frozen satchel and no mainnet account", () => {
    assert.deepEqual([...FROZEN], ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    assert.equal(LAST_FROZEN, 10);
    for (const s of buildPlan(cfg, {}, { tokenId: "11", publicKey: "ed25519:abc" })) {
      assert.deepEqual(tokenIdsIn(s.args ?? {}).filter((id) => FROZEN.has(id)), [], s.key);
      for (const id of [s.signer, s.receiver].filter(Boolean)) assert.ok(id.endsWith(".testnet"), `${s.key}: ${id}`);
    }
    assert.deepEqual(tokenIdsIn({ a: { token_id: "10" }, b: [{ token_id: 3 }] }), ["10", "3"]);
  });

  it("takes only a satchel id above #10, and refuses anything that isn't one, as a supply that wasn't a number gives", () => {
    for (const id of ["11", "12", "1000"]) assert.equal(takeable(id), true, id);
    for (const id of [...FROZEN, "0", "011", "NaN", "Infinity", "-12", "11.5", " 11", "", undefined, null, 11]) assert.equal(takeable(id), false, String(id));
    assert.equal(takeable(String(Number.NaN + 1)), false);
  });

  it("sends the cancel, the early finalize and the forged callback only with a minute left in the waiting period", () => {
    const plan = buildPlan(cfg);
    for (const key of ["cancel", "earlyFinalize", "forgedRelease"]) {
      assert.match(plan.find((s) => s.key === key).checks.join(" "), /at least a minute left before release_at/, key);
    }
  });

  it("waits on the estate's own times", () => {
    const plan = buildPlan(cfg);
    assert.deepEqual(plan.filter((s) => s.by === "wait").map((s) => [s.key, s.until]), [
      ["waitOverdue", "overdue_at + 15 s"],
      ["waitOverdue2", "overdue_at + 15 s"],
      ["waitRelease", "release_at + 15 s"],
    ]);
  });

  it("formats NEAR amounts", () => {
    assert.equal(formatNear(100000000000000000000000n), "0.1 NEAR");
    assert.equal(formatNear("1"), "0.000000000000000000000001 NEAR");
    assert.equal(formatNear(2n * 10n ** 24n), "2 NEAR");
  });
});

// ---- Signed transactions, built here as borsh the way NEAR serializes them ----------------------

const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
const u64 = (n) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};
const u128 = (n) => Buffer.concat([u64(BigInt(n) & ((1n << 64n) - 1n)), u64(BigInt(n) >> 64n)]);
const str = (s) => Buffer.concat([u32(Buffer.byteLength(s)), Buffer.from(s)]);
const bytes = (b) => Buffer.concat([u32(b.length), b]);
const KEY = Buffer.alloc(32, 7);
const OTHER_KEY = Buffer.alloc(32, 9);
const keyText = (k) => `ed25519:${base58Encode(k)}`;

const action = {
  deploy: (code) => Buffer.concat([Buffer.from([1]), bytes(code)]),
  call: (method, args, gas, deposit) => Buffer.concat([Buffer.from([2]), str(method), bytes(Buffer.from(JSON.stringify(args))), u64(gas), u128(deposit)]),
  transfer: (deposit) => Buffer.concat([Buffer.from([3]), u128(deposit)]),
  deleteKey: (key) => Buffer.concat([Buffer.from([6, 0]), key]),
  addKey: () => Buffer.from([5]),
};

function signed({ signer = cfg.estate, receiver = cfg.estate, key = KEY, actions, trailing = Buffer.alloc(0) }) {
  const unsigned = Buffer.concat([str(signer), Buffer.from([0]), key, u64(42), str(receiver), Buffer.alloc(32, 1), u32(actions.length), ...actions]);
  const hash = base58Encode(createHash("sha256").update(unsigned).digest());
  return { base64: Buffer.concat([unsigned, Buffer.from([0]), Buffer.alloc(64, 3), trailing]).toString("base64"), hash };
}

describe("what the near CLI signs for the deploy and the lock", () => {
  const code = Buffer.from("\0asm fake contract for the test");
  const step = buildPlan(cfg, {}, { tokenId: "11", publicKey: keyText(KEY) }).find((s) => s.key === "deploy");
  const lock = buildPlan(cfg, {}, { tokenId: "11", publicKey: keyText(KEY) }).find((s) => s.key === "lock");

  it("computes NEAR's code hash as scripts/code-hash.mjs does", () => {
    assert.equal(codeHash(code), scriptCodeHash(code));
  });

  it("decodes a deploy and its init call, with the code as its hash", () => {
    const tx = signed({ actions: [action.deploy(code), action.call("new", step.args, GAS.init, 0n)] });
    const d = decodeSignedActions(tx.base64);
    assert.equal(d.signerId, cfg.estate);
    assert.equal(d.receiverId, cfg.estate);
    assert.equal(d.publicKey, keyText(KEY));
    assert.equal(d.nonce, 42n);
    assert.equal(d.hash, tx.hash);
    assert.deepEqual(d.actions[0], { type: "DeployContract", codeHash: codeHash(code), codeBytes: code.length });
    assert.equal(d.actions[1].methodName, "new");
    assert.deepEqual(JSON.parse(d.actions[1].args), step.args);
    assert.doesNotThrow(() => assertDeployAsAsked(d, step, codeHash(code)));
  });

  it("refuses a deploy of other code, other arguments, a deposit or one more action", () => {
    const deploy = (actions) => decodeSignedActions(signed({ actions }).base64);
    const init = action.call("new", step.args, GAS.init, 0n);
    assert.throws(() => assertDeployAsAsked(deploy([action.deploy(Buffer.from("other")), init]), step, codeHash(code)), /the code's hash is/);
    assert.throws(() => assertDeployAsAsked(deploy([action.deploy(code), action.call("new", { ...step.args, heir: "x.testnet" }, GAS.init, 0n)]), step, codeHash(code)), /the arguments are/);
    assert.throws(() => assertDeployAsAsked(deploy([action.deploy(code), action.call("new", step.args, GAS.init, 1n)]), step, codeHash(code)), /the deposit is 1/);
    assert.throws(() => assertDeployAsAsked(deploy([action.deploy(code), action.call("new", step.args, 30n * TGAS, 0n)]), step, codeHash(code)), /the gas is/);
    assert.throws(() => assertDeployAsAsked(deploy([action.deploy(code)]), step, codeHash(code)), /not DeployContract, FunctionCall/);
    assert.throws(() => assertDeployAsAsked(decodeSignedActions(signed({ signer: cfg.owner, actions: [action.deploy(code), init] }).base64), step, codeHash(code)), /signed for/);
  });

  it("decodes the lock and accepts it only as the estate's key deleting itself", () => {
    const d = decodeSignedActions(signed({ actions: [action.deleteKey(KEY)] }).base64);
    assert.deepEqual(d.actions, [{ type: "DeleteKey", publicKey: keyText(KEY) }]);
    assert.doesNotThrow(() => assertDeleteKeyAsAsked(d, lock, keyText(KEY)));
    const other = decodeSignedActions(signed({ actions: [action.deleteKey(OTHER_KEY)] }).base64);
    assert.throws(() => assertDeleteKeyAsAsked(other, lock, keyText(KEY)), /it deletes/);
    const signedByOther = decodeSignedActions(signed({ key: OTHER_KEY, actions: [action.deleteKey(KEY)] }).base64);
    assert.throws(() => assertDeleteKeyAsAsked(signedByOther, lock, keyText(KEY)), /signed with/);
    const transfer = decodeSignedActions(signed({ actions: [action.transfer(5n)] }).base64);
    assert.throws(() => assertDeleteKeyAsAsked(transfer, lock, keyText(KEY)), /not DeleteKey/);
  });

  it("refuses an action the run never signs, three actions, a V1 transaction and trailing bytes", () => {
    assert.throws(() => decodeSignedActions(signed({ actions: [action.addKey()] }).base64), /action 5/);
    assert.throws(() => decodeSignedActions(signed({ actions: [action.transfer(1n), action.transfer(1n), action.transfer(1n)] }).base64), /3 actions/);
    assert.throws(() => decodeSignedActions(Buffer.concat([Buffer.from([1]), Buffer.from(signed({ actions: [action.transfer(1n)] }).base64, "base64")]).toString("base64")), /V1/);
    assert.throws(() => decodeSignedActions(signed({ actions: [action.transfer(1n)], trailing: Buffer.from([0]) }).base64), /trailing bytes/);
  });

  it("builds the near CLI arguments that sign without sending", () => {
    const deploy = deployCliArgs(TESTNET, cfg.estate, "E:/x/estate.wasm", step.args);
    assert.deepEqual(deploy.slice(0, 8), ["contract", "deploy", cfg.estate, "use-file", "E:/x/estate.wasm", "with-init-call", "new", "json-args"]);
    assert.deepEqual(JSON.parse(deploy[8]), step.args);
    assert.deepEqual(deploy.slice(9), ["prepaid-gas", "100 Tgas", "attached-deposit", "0 yoctoNEAR", "network-config", "testnet", "sign-with-legacy-keychain", "display"]);
    assert.throws(() => deployCliArgs(TESTNET, cfg.estate, "x.wasm", {}, 1n), /whole number of Tgas/);
    assert.deepEqual(deleteKeyCliArgs(TESTNET, cfg.estate, "ed25519:abc"), [
      "account", "delete-keys", cfg.estate, "public-keys", "ed25519:abc", "network-config", "testnet", "sign-with-legacy-keychain", "display",
    ]);
    assert.equal(deleteKeyCliArgs(TESTNET, cfg.estate, "ed25519:abc", "os").at(-2), "sign-with-keychain");
  });
});
