// The estate run on NEAR testnet, for the Open Innovation track's inheritance prompt. A demo contract,
// contracts/estate, is deployed to its own account and locked; the owner mints a new satchel
// straight to it. The owner checks in, a guardian's approval before the owner is overdue is
// refused, both guardians approve once the 3-minute interval has passed and the 5-minute waiting
// period starts, the owner cancels it by checking in, the guardians approve again after the next
// interval, the heir's early finalize and forged callback are refused, and once the waiting period
// is over the heir finalizes: the estate transfers the satchel to the heir. Last, the old owner's
// sign_evm through the estate is refused, and the satchel's report, read for the heir, reads
// PROVABLY CLEAN: it never signed. The Satchel contract is not changed; the estate owns the
// satchel the way the Sputnik DAO in deployments/testnet-dao.json did.
//
// This module only builds things: the rules, the init arguments, each call, the plan, and the
// decoder that checks what the near CLI signed for the deploy and the lock. It reads nothing and
// signs nothing. tools/estate-run.mjs runs the plan.
import { createHash } from "node:crypto";
import { builtPackage } from "../scripts/built.mjs";

const { MINT_DEPOSIT, ONE_YOCTO, TESTNET, TGAS, base58Encode, isAccountId } = await builtPackage();

export const NEAR = 10n ** 24n;
const NANOS_PER_MINUTE = 60_000_000_000n;
/** contracts/estate's MAX_MINUTES: ten 365-day years. */
export const MAX_MINUTES = 10 * 365 * 24 * 60;

/**
 * The accounts and timers of the run. The estate's account is created with the near CLI's faucet
 * before the run; the other four have keys in the legacy keychain, and the runner checks each still
 * exists. The waiting period is longer than the interval: the cancel lands inside the first one,
 * the early finalize and the forged callback inside the second, each with a minute to spare, and
 * the rules can't change after init, so a window missed means a new estate. Five minutes leave
 * room for a slow read-back.
 */
export const DEFAULTS = {
  estate: "satchel-estate-1112.testnet",
  owner: "buyer.satchel-nft.testnet",
  guardians: ["satchel-nft.testnet", "satchel-council-1112.testnet"],
  threshold: 2,
  heir: "satchel-builder-1112.testnet",
  intervalMinutes: 3,
  waitingMinutes: 5,
};

/**
 * The testnet satchels the run never takes: #1 to #9 are the demo satchels the README quotes, and
 * #10 is the DAO bounty run's. The estate's satchel is the next mint after them.
 */
export const FROZEN = new Set(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
/** The highest id in FROZEN: the run refuses to deploy while the next satchel would be this or lower. */
export const LAST_FROZEN = 10;

/**
 * Whether `id` is a satchel id the run may take: a string of digits with no leading zero, above
 * #LAST_FROZEN. Anything else, "NaN" from a supply that wasn't a number included, is refused.
 */
export const takeable = (id) => typeof id === "string" && /^[1-9]\d*$/.test(id) && Number(id) > LAST_FROZEN;

export const AMOUNTS = {
  mint: MINT_DEPOSIT,
  /** NEAR's storage price: 10^19 yoctoNEAR a byte, so 1 NEAR per 100 kB. */
  storagePerByte: 10n ** 19n,
  /** What the estate keeps free besides its code's storage: its state, 1 yoctoNEAR per finalize, room. */
  estateRoom: NEAR / 2n,
};

/** Gas for each call. Unused gas comes back to the signer. */
export const GAS = {
  /** `new` in the deploy transaction, as the Satchel contract's own deploy attached. */
  init: 100n * TGAS,
  mint: 50n * TGAS,
  checkIn: 30n * TGAS,
  approve: 30n * TGAS,
  /** The estate refuses less than 60 TGas: 30 for nft_transfer, 10 for its callback, its own work. */
  finalize: 100n * TGAS,
  callback: 30n * TGAS,
  /** The estate refuses less than 200 TGas; the Satchel contract's own sign_evm transactions attach 300. */
  sign: 300n * TGAS,
};

/** The panic messages of the calls the run expects the chain to refuse, as contracts/estate words them. */
export const REFUSED = {
  early: "Estate: the owner is not overdue yet",
  waiting: "Estate: the waiting period has not passed yet",
  privateCallback: "Method on_release is private",
  released: "Estate: the satchel was released to the heir",
};

/**
 * Margins around block time. A refused-too-early call goes out only with at least a minute left
 * before the chain would accept it, and a call that must land inside a waiting period (the cancel,
 * the forged callback) only with at least a minute left before release_at; a wait ends 15 s past
 * its time, since a transaction's receipt runs a block or two after the block the runner read.
 */
export const EARLY_MARGIN_NS = 60n * 1_000_000_000n;
export const LATE_MARGIN_NS = 15n * 1_000_000_000n;

/** The run's accounts and timers, from the defaults and the flags, checked. */
export function runConfig(overrides = {}) {
  const cfg = { ...DEFAULTS, ...Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined && v !== null)) };
  cfg.threshold = Number(cfg.threshold);
  cfg.intervalMinutes = Number(cfg.intervalMinutes);
  cfg.waitingMinutes = Number(cfg.waitingMinutes);
  cfg.satchel = TESTNET.contract;
  assertRules(cfg);
  return cfg;
}

/**
 * Throws unless every account is a valid NEAR account id ending in `.testnet` (the run never names a
 * mainnet account) and the rules are ones contracts/estate's `new` accepts: 1 to 5 distinct
 * guardians, none of them the owner, the heir or the estate; a threshold from 1 to their number; an
 * heir who is not the owner; both timers whole minutes from 1 to MAX_MINUTES.
 */
export function assertRules(cfg) {
  const { estate, owner, guardians, heir, threshold } = cfg;
  if (!Array.isArray(guardians) || guardians.length < 1 || guardians.length > 5) throw new Error(`name 1 to 5 guardians, not ${JSON.stringify(guardians)}`);
  if (new Set(guardians).size !== guardians.length) throw new Error(`a guardian is named twice: ${guardians.join(", ")}`);
  for (const id of [estate, owner, heir, ...guardians, cfg.satchel]) {
    if (typeof id !== "string" || !isAccountId(id) || !id.endsWith(".testnet")) throw new Error(`${id} is not a testnet account: this run is testnet only`);
  }
  if (heir === owner) throw new Error(`the heir ${heir} is the owner`);
  if (guardians.includes(owner)) throw new Error(`the owner ${owner} is a guardian`);
  if (guardians.includes(heir)) throw new Error(`the heir ${heir} is a guardian`);
  if ([owner, heir, ...guardians].includes(estate)) throw new Error(`the estate ${estate} is its own owner, heir or guardian`);
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > guardians.length) throw new Error(`the threshold ${threshold} is not from 1 to ${guardians.length}`);
  for (const [name, minutes] of [["interval", cfg.intervalMinutes], ["waiting period", cfg.waitingMinutes]]) {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MINUTES) throw new Error(`the ${name} is ${minutes} minutes, not 1 to ${MAX_MINUTES}`);
  }
}

/** contracts/estate's `new` arguments for satchel `tokenId`. */
export const initArgs = (cfg, tokenId) => ({
  satchel_contract: cfg.satchel,
  token_id: tokenId,
  owner: cfg.owner,
  guardians: [...cfg.guardians],
  threshold: cfg.threshold,
  heir: cfg.heir,
  check_in_interval_minutes: cfg.intervalMinutes,
  waiting_period_minutes: cfg.waitingMinutes,
});

export const minutesNs = (minutes) => BigInt(minutes) * NANOS_PER_MINUTE;

/**
 * The Sepolia transaction the old owner asks the estate to have signed after the release: nothing,
 * to 0x…dEaD, at nonce 0. The estate refuses it before it calls the Satchel contract; if it didn't,
 * the Satchel contract would, since the estate no longer owns the satchel.
 */
export const LATE_TX = {
  chain_id: "11155111",
  nonce: "0",
  max_priority_fee_per_gas: "1000000000",
  max_fee_per_gas: "5000000000",
  gas_limit: "21000",
  to: "0x000000000000000000000000000000000000dEaD",
  value: "0",
  data: "0x",
};

// ---- What the near CLI signs for the deploy and the lock ---------------------------------------

/** The near CLI arguments that sign the deploy and `new`, in one transaction, without sending it (`display`). */
export function deployCliArgs(net, estate, wasmPath, args, gas = GAS.init, keychain = "legacy") {
  if (BigInt(gas) % TGAS !== 0n) throw new Error(`gas ${gas} is not a whole number of Tgas`);
  return [
    "contract",
    "deploy",
    estate,
    "use-file",
    wasmPath,
    "with-init-call",
    "new",
    "json-args",
    JSON.stringify(args),
    "prepaid-gas",
    `${BigInt(gas) / TGAS} Tgas`,
    "attached-deposit",
    "0 yoctoNEAR",
    "network-config",
    net.id,
    keychain === "os" ? "sign-with-keychain" : "sign-with-legacy-keychain",
    "display",
  ];
}

/** The near CLI arguments that sign the deletion of `publicKey`, the estate's only key, without sending it. */
export function deleteKeyCliArgs(net, estate, publicKey, keychain = "legacy") {
  return [
    "account",
    "delete-keys",
    estate,
    "public-keys",
    publicKey,
    "network-config",
    net.id,
    keychain === "os" ? "sign-with-keychain" : "sign-with-legacy-keychain",
    "display",
  ];
}

/** NEAR's code hash of a wasm: base58(sha256(code)), what `view_account` returns as `code_hash`. */
export const codeHash = (bytes) => base58Encode(createHash("sha256").update(bytes).digest());

const KEY_LENGTH = { 0: 32, 1: 64 };
const SIGNATURE_LENGTH = { 0: 64, 1: 65 };
const ACTION = { DeployContract: 1, FunctionCall: 2, Transfer: 3, DeleteKey: 6 };

/**
 * Decodes a borsh SignedTransaction (V0) whose actions are DeployContract, FunctionCall, Transfer
 * or DeleteKey, as near-cli.ts's `decodeSignedTx` does for one function call. Any other action, a
 * V1 transaction or trailing bytes is refused rather than skipped. A deploy's code is returned as
 * its code hash and length, not its bytes.
 */
export function decodeSignedActions(base64) {
  const bytes = Uint8Array.from(Buffer.from(base64, "base64"));
  let at = 0;
  const take = (n) => {
    if (at + n > bytes.length) throw new Error("The signed transaction ends early");
    const out = bytes.subarray(at, at + n);
    at += n;
    return out;
  };
  const u8 = () => take(1)[0];
  const u32 = () => Buffer.from(take(4)).readUInt32LE(0);
  const u64 = () => Buffer.from(take(8)).readBigUInt64LE(0);
  const u128 = () => {
    const lo = u64();
    return (u64() << 64n) | lo;
  };
  const utf8 = (b) => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(b);
  const string = () => utf8(take(u32()));
  const key = () => {
    const type = u8();
    if (KEY_LENGTH[type] === undefined) throw new Error(`Unknown key type ${type}`);
    return { type, text: `${type === 0 ? "ed25519" : "secp256k1"}:${base58Encode(take(KEY_LENGTH[type]))}` };
  };

  if (bytes[0] === 1) throw new Error("The near CLI signed a V1 transaction; sign with a full access key");
  const signerId = string();
  const signingKey = key();
  const nonce = u64();
  const receiverId = string();
  take(32); // block hash
  const count = u32();
  if (count < 1 || count > 2) throw new Error(`The signed transaction holds ${count} actions, not one or two`);
  const actions = [];
  for (let i = 0; i < count; i += 1) {
    const kind = u8();
    if (kind === ACTION.DeployContract) {
      const code = take(u32());
      actions.push({ type: "DeployContract", codeHash: codeHash(code), codeBytes: code.length });
    } else if (kind === ACTION.FunctionCall) {
      const methodName = string();
      const args = utf8(take(u32()));
      const gas = u64();
      actions.push({ type: "FunctionCall", methodName, args, gas, deposit: u128() });
    } else if (kind === ACTION.Transfer) {
      actions.push({ type: "Transfer", deposit: u128() });
    } else if (kind === ACTION.DeleteKey) {
      actions.push({ type: "DeleteKey", publicKey: key().text });
    } else {
      throw new Error(`The signed transaction holds action ${kind}, which this run never signs`);
    }
  }
  const unsigned = bytes.subarray(0, at);
  if (u8() !== signingKey.type) throw new Error("The signature's type is not the key's");
  take(SIGNATURE_LENGTH[signingKey.type]);
  if (at !== bytes.length) throw new Error("The signed transaction has trailing bytes");
  const hash = base58Encode(createHash("sha256").update(unsigned).digest());
  return { signerId, publicKey: signingKey.text, nonce, receiverId, actions, hash };
}

/** JSON with object keys sorted, so two encodings of the same value compare equal. */
export function canonical(value) {
  return JSON.stringify(value, (_, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v));
}

/**
 * Throws unless the near CLI signed exactly the deploy and `new` the step asks for: the estate signs
 * for itself, the code is the wasm's, then one call to `new` with these arguments, gas and no deposit.
 */
export function assertDeployAsAsked(decoded, step, wasmHash) {
  const differences = [];
  if (decoded.signerId !== step.signer || decoded.receiverId !== step.receiver) differences.push(`${decoded.signerId} signed for ${decoded.receiverId}, not ${step.signer} for ${step.receiver}`);
  const [deploy, init, ...more] = decoded.actions;
  if (deploy?.type !== "DeployContract" || init?.type !== "FunctionCall" || more.length > 0) {
    differences.push(`the actions are ${decoded.actions.map((a) => a.type).join(", ")}, not DeployContract, FunctionCall`);
  } else {
    if (deploy.codeHash !== wasmHash) differences.push(`the code's hash is ${deploy.codeHash}, not ${wasmHash}`);
    if (init.methodName !== "new") differences.push(`the call is ${init.methodName}, not new`);
    if (init.gas !== BigInt(step.gas)) differences.push(`the gas is ${init.gas}, not ${step.gas}`);
    if (init.deposit !== 0n) differences.push(`the deposit is ${init.deposit}, not 0`);
    let args;
    try {
      args = JSON.parse(init.args);
    } catch {
      args = init.args;
    }
    if (canonical(args) !== canonical(step.args)) differences.push(`the arguments are ${init.args}, not ${JSON.stringify(step.args)}`);
  }
  if (differences.length > 0) throw new Error(`The near CLI signed something else, so nothing was sent: ${differences.join("; ")}`);
}

/**
 * Throws unless the near CLI signed exactly one DeleteKey of `publicKey` on the estate, signed with
 * that same key: the estate's only key deletes itself.
 */
export function assertDeleteKeyAsAsked(decoded, step, publicKey) {
  const differences = [];
  if (decoded.signerId !== step.signer || decoded.receiverId !== step.receiver) differences.push(`${decoded.signerId} signed for ${decoded.receiverId}, not ${step.signer} for ${step.receiver}`);
  if (decoded.actions.length !== 1 || decoded.actions[0].type !== "DeleteKey") differences.push(`the actions are ${decoded.actions.map((a) => a.type).join(", ")}, not DeleteKey`);
  else if (decoded.actions[0].publicKey !== publicKey) differences.push(`it deletes ${decoded.actions[0].publicKey}, not ${publicKey}`);
  if (decoded.publicKey !== publicKey) differences.push(`it is signed with ${decoded.publicKey}, not the key it deletes, ${publicKey}`);
  if (differences.length > 0) throw new Error(`The near CLI signed something else, so nothing was sent: ${differences.join("; ")}`);
}

// ---- The plan -----------------------------------------------------------------------------------

/** "0.1 NEAR", "2 NEAR", "0.000000000000000000000001 NEAR". */
export function formatNear(yocto) {
  const v = BigInt(yocto);
  const whole = v / NEAR;
  const fraction = (v % NEAR).toString().padStart(24, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""} NEAR`;
}

/** Block time in nanoseconds as an ISO time, to the second. */
export const isoAt = (ns) => new Date(Number(BigInt(ns) / 1_000_000n)).toISOString().replace(/\.\d+Z$/, "Z");

/** The step of `run` with `key`, or undefined. */
export const done = (run, key) => run.steps?.find((s) => s.key === key);

/**
 * Every token id a step names: `token_id` anywhere in its arguments. The runner refuses a step that
 * names a frozen satchel.
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
  walk(value);
  return found;
}

/**
 * The run, step by step, from what `run` (deployments/testnet-estate.json) already holds and what
 * the runner read live: `live.tokenId`, the next satchel's id read before the deploy, and
 * `live.publicKey`, the estate's only key read before the lock. A value not known yet is shown as a
 * <placeholder>; the runner never sends a step that still holds one.
 *
 * Each step: key, title, by ("controller" signs with the near CLI, "wait" waits for block time to
 * pass a time the estate's view gives, "read" only reads), signer, receiver, method or actions,
 * args, deposit, gas, refused (the panic message a call the chain must refuse ends with), checks
 * (read before it runs) and expects (read back after).
 */
export function buildPlan(cfg, run = {}, live = {}) {
  const { estate, owner, guardians, heir, threshold } = cfg;
  const net = TESTNET;
  const deployed = done(run, "deploy");
  const tokenId = deployed?.decodedArgs?.token_id ?? live.tokenId ?? "<N, nft_total_supply + 1, read before the deploy>";
  /** The satchel in titles and checks: its id once known, N before. */
  const N = deployed?.decodedArgs?.token_id ?? live.tokenId ?? "N";
  const interval = `${cfg.intervalMinutes}-minute interval`;
  const waiting = `${cfg.waitingMinutes}-minute waiting period`;
  const approvers = guardians.slice(0, threshold);
  const call = (key, title, signer, receiver, method, args, deposit, gas, checks, expects, extra = {}) => ({
    key, title, by: "controller", signer, receiver, method, args, deposit: deposit.toString(), gas: gas.toString(), checks, expects, ...extra,
  });
  const approvals = (round, prefix) =>
    approvers.map((g, i) => {
      const last = i === approvers.length - 1;
      return call(
        `${prefix}${i + 1}`,
        `Approval ${i + 1} of ${threshold}${round}, by guardian ${g}${last ? ": the waiting period starts" : ""}`,
        g, estate, "approve_release", {}, 0n, GAS.approve,
        [`estate() reads "overdue": block time is past last_check_in + the interval, no release has started, and ${g} hasn't approved since the last check-in`],
        [last
          ? `estate() reads "releasing": approvals ${approvers.join(", ")}; release_started_at is the block time the call ran at, release_at that plus the waiting period; the receipt logged approve and release_started`
          : `estate() still reads "overdue", with ${i + 1} approval${i === 0 ? "" : "s"}: the release has not started`],
      );
    });
  const wait = (key, title, until, checks) => ({ key, title, by: "wait", until, checks, expects: ["the latest final block's time is past it; the block is recorded"] });
  const keyLabel = live.publicKey ?? done(run, "lock")?.publicKey ?? "<the estate's only key, read from view_access_key_list>";

  return [
    {
      key: "deploy",
      title: `Deploy contracts/estate to ${estate} and call new in the same transaction: owner ${owner}, guardians ${guardians.join(" and ")} (${threshold} must approve), heir ${heir}, a ${interval}, a ${waiting}, satchel #${N} on ${net.contract}`,
      by: "controller",
      signer: estate,
      receiver: estate,
      actions: ["DeployContract", "FunctionCall"],
      method: "new",
      args: initArgs(cfg, tokenId),
      deposit: "0",
      gas: GAS.init.toString(),
      checks: [
        "the NEAR RPC serves testnet (status chain_id) and every account named is a .testnet account",
        `${estate} exists, runs no code, has exactly one key, a full-access one, and the legacy keychain has a key file for it`,
        `${estate} holds enough for the code's storage (1 NEAR per 100 kB) + 0.5 NEAR`,
        `${owner}, ${guardians.join(", ")} and ${heir} exist, and the legacy keychain has a key file for each`,
        `nft_total_supply + 1 on ${net.contract} is above ${LAST_FROZEN}: #1 to #9 are the README's demo satchels and #10 is the DAO bounty run's. That id goes into new as token_id`,
        "the near CLI signed DeployContract with the wasm's code hash, then new with these arguments, gas and no deposit, and nothing else",
      ],
      expects: [
        `view_account(${estate}).code_hash is the wasm's code hash`,
        `estate() returns these rules, no approvals, and last_check_in the block time new ran at`,
      ],
    },
    {
      key: "lock",
      title: `Lock ${estate}: delete its only key, ${keyLabel}, so nobody can change the code or the rules`,
      by: "controller",
      signer: estate,
      receiver: estate,
      actions: ["DeleteKey"],
      publicKey: keyLabel,
      deposit: "0",
      checks: [
        `${estate} runs the code the deploy step recorded and has exactly one key, a full-access one`,
        `${estate} owns no satchel yet: it arrives only after the lock`,
        "the near CLI signed one DeleteKey of that key, with that key",
      ],
      expects: [`view_access_key_list(${estate}) is empty`],
    },
    call(
      "mint",
      `The owner mints satchel #${N} straight to the estate`,
      owner, net.contract, "mint", { receiver_id: estate }, AMOUNTS.mint, GAS.mint,
      [
        `${estate} has no keys and estate() names satchel #${N}`,
        `nft_total_supply + 1 is ${N}, the id new was given: if someone minted in between, the estate would manage a satchel it can never own, so the run stops`,
        `${owner} holds at least 0.2 NEAR`,
      ],
      [`the mint returned #${N}; nft_token shows ${estate} as its owner; its signing record is empty (version 0) and it is not listed`],
    ),
    call(
      "checkIn",
      `The owner checks in: the ${interval} restarts`,
      owner, estate, "check_in", {}, 0n, GAS.checkIn,
      [`${estate} owns satchel #${N}; estate() reads "alive" or "overdue"`],
      ["estate() reads \"alive\", last_check_in is the block time the call ran at, no approvals; the receipt logged check_in"],
    ),
    call(
      "earlyApprove",
      `Guardian ${guardians[0]} tries to approve before the owner is overdue: the estate refuses`,
      guardians[0], estate, "approve_release", {}, 0n, GAS.approve,
      [`estate() reads "alive" with at least a minute left before overdue_at, so the call lands before the owner is overdue`],
      [`the transaction fails with "${REFUSED.early}"; estate() still has no approvals`],
      { refused: REFUSED.early },
    ),
    wait("waitOverdue", `Wait until the owner is overdue: block time past the last check-in + the ${interval}`, "overdue_at + 15 s", [
      "estate() reads \"alive\" or \"overdue\"; the runner waits up to 10 minutes itself, and for longer says when to run again",
    ]),
    ...approvals(" (first round)", "approve"),
    call(
      "cancel",
      `The owner checks in while the release waits: the check-in cancels it`,
      owner, estate, "check_in", {}, 0n, GAS.checkIn,
      ["estate() reads \"releasing\" with at least a minute left before release_at, so the cancel lands during the waiting period, and the transfer is not in flight"],
      ["estate() reads \"alive\": no approvals, no release_started_at, last_check_in the block time the call ran at; the receipt logged check_in and release_cancelled"],
    ),
    wait("waitOverdue2", `Wait until the owner is overdue again: block time past that check-in + the ${interval}`, "overdue_at + 15 s", [
      "estate() reads \"alive\" or \"overdue\"",
    ]),
    ...approvals(" (second round)", "reapprove"),
    call(
      "earlyFinalize",
      `The heir tries to finalize during the ${waiting}: the estate refuses`,
      heir, estate, "finalize_release", {}, 0n, GAS.finalize,
      [`estate() reads "releasing" with at least a minute left before release_at`],
      [`the transaction fails with "${REFUSED.waiting}"; estate() still reads "releasing", nothing in flight, and the satchel is still the estate's`],
      { refused: REFUSED.waiting },
    ),
    call(
      "forgedRelease",
      "The heir calls the estate's callback on_release directly, as if a transfer had succeeded: the estate refuses",
      heir, estate, "on_release", {}, 0n, GAS.callback,
      ["estate() reads \"releasing\" with at least a minute left before release_at, so the call lands during the waiting period, and nothing is in flight"],
      [`the transaction fails with "${REFUSED.privateCallback}"; estate() still reads "releasing", released_at is still null`],
      { refused: REFUSED.privateCallback },
    ),
    wait("waitRelease", `Wait out the ${waiting}: block time past release_at`, "release_at + 15 s", ["estate() reads \"releasing\""]),
    call(
      "finalize",
      `The heir finalizes: the estate calls nft_transfer on ${net.contract} and satchel #${N} moves to the heir`,
      heir, estate, "finalize_release", {}, 0n, GAS.finalize,
      [`estate() reads "releasing", block time is past release_at and nothing is in flight; ${estate} owns satchel #${N}, which is not listed`],
      [
        `the estate called nft_transfer({ receiver_id: ${heir}, token_id: ${N} }) on ${net.contract} with 1 yoctoNEAR and it succeeded; nft_transfer logged ${estate} → ${heir}`,
        `on_release returned true and logged released; estate() reads "released"; nft_token shows ${heir} as the owner`,
      ],
    ),
    call(
      "lateSign",
      `The old owner asks the estate to have satchel #${N} sign a Sepolia transaction: the estate refuses`,
      owner, estate, "sign_evm", { tx: LATE_TX }, ONE_YOCTO, GAS.sign,
      [`estate() reads "released" and nft_token shows ${heir} as the owner of satchel #${N}`],
      [`the transaction fails with "${REFUSED.released}" and none of its receipts reached ${net.contract}; satchel #${N}'s signing record is still version 0`],
      { refused: REFUSED.released },
    ),
    {
      key: "heirReport",
      title: `The heir reads satchel #${N}'s clean-transfer report: PROVABLY CLEAN, it never signed`,
      by: "read",
      checks: [`satchel-nft's buildReport(testnet, "${N}"), read only, the report the web app and \`satchel-nft verify\` show`],
      expects: [`the report's owner is ${heir} and its verdict is "clean" (PROVABLY CLEAN), all four checks pass`],
    },
  ];
}

/**
 * Whether the evidence file `run` is the record of the run `cfg` describes: the same estate,
 * owner, heir, timers and threshold, and the guardians in the same order, since each signs its own
 * steps and scripts/check-estate.mjs reads them from the file in that order.
 */
export const sameRun = (run, cfg) =>
  run.estate === cfg.estate &&
  run.owner === cfg.owner &&
  run.heir === cfg.heir &&
  JSON.stringify(run.guardians) === JSON.stringify(cfg.guardians) &&
  run.threshold === cfg.threshold &&
  run.checkInIntervalMinutes === cfg.intervalMinutes &&
  run.waitingPeriodMinutes === cfg.waitingMinutes;

/** The first step `run` doesn't hold yet, or undefined once the run is complete. */
export const nextStep = (plan, run) => plan.find((s) => !done(run, s.key));

/** Whether a step still holds a <placeholder> in its arguments, signer, receiver or key: such a step is never sent. */
export const unresolved = (step) => /<[^>]*>/.test(JSON.stringify([step.args ?? null, step.receiver ?? null, step.signer ?? null, step.publicKey ?? null]));
