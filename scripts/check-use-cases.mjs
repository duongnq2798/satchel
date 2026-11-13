// Runs the checks behind each use of Satchel, one case after another, and prints for each: what it
// is, the satchels and network it ran on, a page on satchelnft.xyz to try it with no wallet, and what
// its checks say. The checks are the repository's own, each run as a child process with this
// environment: scripts/check-claims.mjs (once per network, shared by the cases that read it),
// scripts/check-dao.mjs, scripts/check-scan-start.mjs and `satchel-nft verify` from this checkout's
// build. One check is a request of its own: that satchelnft.xyz's /api/room refuses a signature that
// doesn't verify, as the README's holder room section shows with curl. Each one reads; none signs or
// sends anything.
// A check whose script or evidence file isn't in this checkout yet reads "not run yet", with what will
// add it. One that needs the built package when it isn't built reads "skipped". Neither is a failure,
// unless --strict makes a skipped one count as failed.
// Node 22 or later, no install, no wallet, no key.
// Usage: node scripts/check-use-cases.mjs [--case <n>]... [--list] [--strict]
//   --case <n>  run case n (1 to 9); repeat it to run several
//   --list      print the cases, their pages and their checks, and run nothing
//   --strict    count a check skipped for want of the built package as failed
// NEAR_RPC, NEAR_ARCHIVAL_RPC, SEPOLIA_RPC, BASE_RPC, ARBITRUM_RPC and RPC_<chain id> reach every
// check unchanged; each script's header says which it reads. The checks run one at a time, with a
// pause of 3 s between cases: FastNEAR's archival node answers HTTP 429 when two of them read it at
// once (check-dao.mjs's header). Run back to back they can still use up its rate limit, so a check
// that failed only because nodes or the network didn't answer (each failed claim says a node didn't
// answer, timed out or answered HTTP 408, 429 or 5xx; or the script stopped on such an error, or ran
// past the 5 min limit) runs once more, a minute later, and says so. A claim the chain answered
// against fails at once. The bounty case runs check-dao-bounty.mjs with --claims-only: its claims,
// without the board it prints after them. Each case ends with how long it took, and the last line
// gives the total: all nine took about 7 min on 2026-11-14, longer when a check runs again.
// Exit 0 when every case that ran holds, 1 when one failed, 2 on a bad argument.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { BUILD_HINT as BUILD } from "./built.mjs";

const ROOT_URL = new URL("../", import.meta.url);
const ROOT = fileURLToPath(ROOT_URL);
const SITE = "https://satchelnft.xyz";
/** The checkout's `satchel-nft` command; it runs dist/cli.js, which `npm run build -w satchel-nft` makes. */
const CLI = "packages/satchel-nft/bin/satchel-nft.js";
const BUILT = ["packages/satchel-nft/dist/cli.js", "packages/satchel-nft/dist/index.js"];
/** A check still running after this long is stopped, and runs once more as one whose nodes didn't answer. */
const TIMEOUT_MS = 300_000;
/** How long to wait before running a check again whose only failures were nodes not answering. */
const RETRY_MS = 60_000;
/** The pause before each case after the first, so one case's reads don't meet the last one's rate limit. */
const PAUSE_MS = 3_000;

const USAGE = "usage: node scripts/check-use-cases.mjs [--case <n>]... [--list] [--strict]";

/** check-claims.mjs on one network; `titles` are parts of the claims this case rests on. */
const claims = (network, titles, more = {}) => ({
  run: network === "mainnet" ? ["scripts/check-claims.mjs", "--network", "mainnet"] : ["scripts/check-claims.mjs"],
  titles,
  ...more,
});
/** `satchel-nft verify <id>` on testnet from this checkout's build, which should exit `code` and print `expect`. */
const verify = (id, code, expect) => ({ run: [CLI, "verify", id], built: true, code, expect });

/**
 * Each use case: what it is, what it ran on, a page to try it (null when there is none yet), and its
 * checks. A check with `needs` reads "not run yet" while one of those files is missing, and says
 * `later`, what will add it.
 */
const CASES = [
  {
    what: "Sell a wallet with what it holds; once the NFT moves, the seller can't sign for it",
    on: "NEAR mainnet and testnet: mainnet satchel #3, sold to a second account and its old owner refused after the sale; testnet #1, handed over and its old owner refused, and #4, refused a signature while listed",
    page: "/mainnet/satchel/3",
    checks: [
      claims("testnet", ["The previous owner of satchel #1 cannot sign after the transfer", "Signing is frozen while a satchel is listed"]),
      claims("mainnet", ["bought it naming record version", "After the sale,", "provably clean: the buyer's report read so"], {
        needs: ["deployments/mainnet-sale.json"],
        later: "tools/mainnet-sale-record.mjs record writes it after mainnet satchel #3's sale",
      }),
    ],
  },
  {
    what: "Catch a seller who kept a signed send or a live approval, before you pay",
    on: "NEAR testnet and Sepolia: satchel #5, a signed send kept back; #3, an approval left live; #6, its record changed after the buyer checked",
    page: "/satchel/5",
    checks: [
      verify("5", 1, ["[FAIL] A signed transaction may still be pending", "NOT PROVABLE"]),
      verify("3", 1, ["[FAIL] An approval is still live", "NOT PROVABLE"]),
      claims("testnet", ["A buy naming an old record version is refused", "When that buy was refused"]),
    ],
  },
  {
    what: "Clean a wallet before selling it: revoke what it approved and void the sends it signed but never sent",
    on: "NEAR testnet and Sepolia: satchel #9, cleaned from its page on 2026-11-12 with Revoke, then Spend nonce",
    page: "/satchel/9",
    checks: [verify("9", 0, ["PROVABLY CLEAN"])],
  },
  {
    what: "Swap what a wallet holds into a token on another chain, paid to the wallet's own address",
    on: "NEAR mainnet, Base and Arbitrum One: satchel #2 swapped 0.00258 ETH on Base for 5.280549 USDC through NEAR Intents' 1Click",
    page: "/mainnet/satchel/2",
    checks: [
      claims("mainnet", [
        "Satchel #2 was minted",
        "Its first signature is a plain transfer on Base",
        "Base ran exactly that deposit",
        "1Click reports SUCCESS for this deposit",
      ]),
    ],
  },
  {
    what: "A shared treasury: a DAO owns the wallet, which signs what its members vote for",
    on: "NEAR testnet and Sepolia: satchel #8, owned by the Sputnik DAO satchel-club.sputnikv2.testnet until a second vote handed it on",
    page: "/satchel/8",
    checks: [{ run: ["scripts/check-dao.mjs"] }],
  },
  {
    what: "Pay bounties from a DAO's treasury, with trust earned by finished work, and pay with a whole wallet",
    on: "NEAR testnet and Sepolia: the Sputnik DAO satchel-bounty.sputnikv2.testnet paid two bounties, the second on the contributor's own trusted vote, then had satchel #10 pay them on Sepolia and gave them #10 itself",
    page: "/dao/satchel-bounty.sputnikv2.testnet",
    checks: [
      {
        run: ["scripts/check-dao-bounty.mjs", "--claims-only"],
        needs: ["scripts/check-dao-bounty.mjs", "deployments/testnet-dao-bounty.json"],
        later: "the bounty run's branch adds them",
      },
    ],
  },
  {
    what: "Hand a wallet to a named heir when its owner stops checking in",
    on: "NEAR testnet: the estate satchel-estate-1112.testnet held satchel #11 and, after missed check-ins, two guardians' approvals and a waiting period, handed it to its heir",
    page: "/satchel/11",
    checks: [
      {
        run: ["scripts/check-estate.mjs"],
        needs: ["scripts/check-estate.mjs", "deployments/testnet-estate.json"],
        later: "the estate run's branch adds the evidence file",
      },
    ],
  },
  {
    what: "See the USDC, USDT and WETH that came into a wallet, with totals per token and chain",
    on: "Both networks: where the Received card starts reading each chain it scans. Mainnet satchel #2's card shows the 5.280549 USDC it received",
    page: "/mainnet/satchel/2",
    checks: [{ run: ["scripts/check-scan-start.mjs"], built: true }],
  },
  {
    what: "A members' room that opens for whoever holds the NFT now",
    on: "NEAR testnet satchel #4 and mainnet satchel #1, opened with their holders' signatures on 2026-11-10. Opening one takes the holder's wallet, so no command here opens it",
    page: "/satchel/4/room",
    checks: [{ room: true }],
  },
];

let options;
try {
  options = parseArgs({
    options: { case: { type: "string", multiple: true }, list: { type: "boolean" }, strict: { type: "boolean" } },
    strict: true,
    allowPositionals: false,
  }).values;
} catch (err) {
  console.error(`${err.message}\n${USAGE}`);
  process.exit(2);
}
const picked = options.case ?? CASES.map((_, i) => String(i + 1));
if (picked.some((n) => !/^\d+$/.test(n) || Number(n) < 1 || Number(n) > CASES.length)) {
  console.error(`--case takes a number from 1 to ${CASES.length}\n${USAGE}`);
  process.exit(2);
}
const chosen = [...new Set(picked.map(Number))].sort((a, b) => a - b);

const here = (path) => existsSync(new URL(path, ROOT_URL));
const built = () => BUILT.every(here);
const pageUrl = (page) => (page ? `${SITE}${page}` : "not yet");
const command = (check) =>
  check.room
    ? `POST ${SITE}/api/room with a signature that doesn't verify, which it should refuse with 401`
    : `node ${check.run.join(" ")}${check.expect ? `, which should read ${check.expect.at(-1)}` : ""}`;
const missing = (check) => (check.needs ?? []).filter((path) => !here(path));
const notYet = (gone, later) => `not run yet: ${gone.join(" and ")} ${gone.length === 1 ? "isn't" : "aren't"} in this checkout; ${later}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

const LABEL = (name) => `   ${name.padEnd(8)} `;
const INDENT = " ".repeat(12);

function printCase(n) {
  const c = CASES[n - 1];
  console.log(`${n}. ${c.what}`);
  console.log(`${LABEL("Ran on")}${c.on}`);
  console.log(`${LABEL("Try it")}${pageUrl(c.page)}`);
}

if (options.list) {
  console.log("Satchel's use cases and the checks behind each. --list runs nothing.\n");
  for (const n of chosen) {
    printCase(n);
    for (const check of CASES[n - 1].checks) {
      const gone = missing(check);
      const note = gone.length ? ` (${notYet(gone, check.later)})` : check.built && !built() ? ` (needs the built package: ${BUILD})` : "";
      console.log(`${LABEL("Check")}${command(check)}${note}`);
    }
    console.log("");
  }
  console.log(`${plural(chosen.length, "use case")} listed; nothing was run.`);
  process.exit(0);
}

/** Runs `node <args>` from the repository root with this environment, and collects what it prints. */
function run(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: TIMEOUT_MS,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (d) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d) => (stderr += d));
    child.on("error", (err) => resolve({ code: null, stdout, stderr, error: err.message, stopped: false }));
    child.on("close", (code, signal) =>
      resolve({ code, stdout, stderr, error: signal ? `stopped after ${TIMEOUT_MS / 60_000} min (${signal})` : null, stopped: Boolean(signal) }),
    );
  });
}

const lines = (text) => text.split(/\r?\n/);
/** A script's own summary: "13 of 13 claims hold (…)", "All 9 checks pass: …", or a report's verdict. */
const SUMMARY = /^(\d+ of \d+ |All \d+ )|^(PROVABLY CLEAN|NOT PROVABLE|COULD NOT CHECK EVERYTHING) \(/;
function summary(r) {
  const out = lines(r.stdout).filter((l) => l.trim());
  return out.findLast((l) => SUMMARY.test(l)) ?? out.at(-1) ?? "(it printed no summary)";
}
/** The line of `text` that starts with `start`, and the indented lines under it. */
function block(text, start) {
  const all = lines(text);
  const i = all.findIndex((l) => l.startsWith(start));
  if (i === -1) return null;
  const found = [all[i]];
  for (let j = i + 1; j < all.length && /^\s+\S/.test(all[j]); j += 1) found.push(`  ${all[j].trim()}`);
  return found;
}
/** Every failing line a check printed ("[FAIL] …", "[????] …" or "FAIL  …"), each with its indented details. */
function failing(text) {
  const all = lines(text);
  const found = [];
  all.forEach((line, i) => {
    if (!/^\[(FAIL|\?\?\?\?)\] |^FAIL\b/.test(line)) return;
    found.push(line);
    for (let j = i + 1; j < all.length && /^\s+\S/.test(all[j]); j += 1) found.push(`  ${all[j].trim()}`);
  });
  return found;
}

/**
 * A node or the network not answering, as the scripts word it ("not answering", "didn't answer", "not
 * a change to any satchel", an HTTP 408, 429 or 5xx) and as Node does ("fetch failed", a timeout, a
 * connection reset or refused, a name that didn't resolve).
 */
const NO_ANSWER =
  /not a change to any satchel|not answering|didn't answer|did not answer|HTTP (?:408|429|5\d\d)\b|fetch failed|timed? ?out|TimeoutError|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|other side closed/i;

/**
 * Whether a run failed only because NEAR or EVM nodes, or the network, didn't answer, rather than
 * because the chain says something else: every claim it failed says so in its details, or it printed
 * no failed claim and stopped on such an error, or it ran past TIMEOUT_MS. Run back to back, the cases
 * can use up a public node's rate limit.
 */
function nodesBusy(r) {
  if (r.stopped) return true;
  if (r.error !== null || r.code === 0) return false;
  const claims = [];
  for (const line of failing(r.stdout)) {
    if (line.startsWith("  ") && claims.length) claims[claims.length - 1].push(line);
    else claims.push([line]);
  }
  // A claim's title can say anything; what it failed on is in the lines under it.
  if (claims.length) return claims.every(([title, ...details]) => NO_ANSWER.test(details.length ? details.join("\n") : title));
  return NO_ANSWER.test(r.stderr);
}

/** Runs a check, and once more after a minute when its only failures were nodes not answering. */
async function runPatiently(args) {
  const first = await run(args);
  if (!nodesBusy(first)) return first;
  await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
  return { ...(await run(args)), retried: first.stopped ? `ran past ${TIMEOUT_MS / 60_000} min` : "failed only on nodes not answering" };
}

/** The room's server refusing a request whose signature doesn't verify, as the README's curl shows. */
async function room() {
  const body = JSON.stringify({
    network: "testnet",
    tokenId: "4",
    accountId: "satchel-nft.testnet",
    publicKey: `ed25519:${"1".repeat(32)}`,
    signature: Buffer.alloc(64).toString("base64"),
    nonce: Buffer.alloc(32).toString("base64"),
    issuedAt: new Date().toISOString(),
  });
  const ask = () =>
    fetch(`${SITE}/api/room`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(30_000),
    });
  let res;
  try {
    res = await ask().catch(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      return ask();
    });
  } catch (err) {
    return { status: "failed", shown: [`no answer from ${SITE}/api/room: ${err.message}`] };
  }
  const error = await res
    .json()
    .then((j) => j?.error)
    .catch(() => undefined);
  const seen = `${res.status}${typeof error === "string" ? `: ${error}` : ""}`;
  if (res.status === 401 && typeof error === "string") return { status: "holds", shown: [seen] };
  return { status: "failed", shown: [seen, "expected 401, with an error saying the signature doesn't verify"] };
}

/** Each script run once, by its arguments, with the case that ran it: check-claims.mjs is shared. */
const runs = new Map();

async function evaluate(check, n) {
  if (check.room) return room();
  const gone = missing(check);
  if (gone.length) return { status: "not run yet", shown: [notYet(gone, check.later)] };
  if (check.built && !built()) {
    if (options.strict) return { status: "failed", shown: [`failed under --strict: the package isn't built; ${BUILD}`] };
    return { status: "skipped", shown: [`skipped: ${BUILD}`] };
  }
  const key = check.run.join(" ");
  const shared = runs.get(key);
  if (!shared) runs.set(key, { n, result: runPatiently(check.run) });
  const r = await runs.get(key).result;
  if (check.built && r.code === 2 && r.stderr.includes(BUILD)) {
    // The script found the build missing, or a package it imports not installed (scripts/built.mjs).
    if (options.strict) return { status: "failed", shown: [`failed under --strict: the package can't be loaded; ${BUILD}`] };
    return { status: "skipped", shown: [`skipped: ${BUILD}`] };
  }
  const shown = [shared ? `${summary(r)}  [its run for case ${shared.n}]` : summary(r)];
  if (r.retried && !shared) shown.push(`its first run ${r.retried}, so it ran again a minute later`);
  let ok = r.error === null && r.code === (check.code ?? 0);
  for (const title of check.titles ?? []) {
    const line = lines(r.stdout).find((l) => /^\[(PASS|FAIL)\] /.test(l) && l.includes(title));
    if (!line) {
      ok = false;
      shown.push(`no claim with "${title}" in what it printed`);
    } else if (line.startsWith("[PASS]")) shown.push(line);
  }
  for (const start of check.expect ?? []) {
    const found = block(r.stdout, start);
    if (!found) ok = false;
    else if (start.startsWith("[")) shown.push(...found);
  }
  if (ok) return { status: "holds", shown };
  if (check.expect) shown.push(`expected ${check.expect.join(" and ")}, exit ${check.code}; it exited ${r.code}`);
  const fails = failing(r.stdout);
  shown.push(...fails);
  if (!fails.length) {
    // Node's own error ("Error: Cannot find module …") when it has one, or the last lines it wrote.
    const errors = lines(r.stderr).filter((l) => l.trim());
    const thrown = errors.find((l) => /^\w*Error\b/.test(l));
    shown.push(...(thrown ? [thrown] : errors.slice(-5)));
  }
  if (r.error) shown.push(r.error);
  else if (!check.expect) shown.push(`exit ${r.code}`);
  return { status: "failed", shown };
}

/** A run time as "42 s" or "8 min 5 s". */
function took(ms) {
  const s = Math.round(ms / 1_000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

console.log("Satchel's use cases, each with the checks that show it ran. Nothing here signs or sends.\n");
const started = Date.now();
const results = [];
for (const [i, n] of chosen.entries()) {
  if (i > 0) await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
  const caseStarted = Date.now();
  printCase(n);
  const statuses = [];
  for (const check of CASES[n - 1].checks) {
    console.log(`${LABEL("Check")}${command(check)}`);
    const { status, shown } = await evaluate(check, n);
    for (const line of shown) console.log(`${INDENT}${line}`);
    statuses.push(status);
  }
  const result = statuses.includes("failed")
    ? "failed"
    : statuses.includes("skipped")
      ? "skipped"
      : statuses.includes("holds")
        ? "holds"
        : "not run yet";
  console.log(`${LABEL("Result")}${result}, in ${took(Date.now() - caseStarted)}\n`);
  results.push(result);
}

const count = (status) => results.filter((r) => r === status).length;
const held = count("holds");
console.log(
  `${plural(results.length, "use case")}: ${held} hold${held === 1 ? "s" : ""}, ${count("not run yet")} not run yet, ${count("skipped")} skipped, ${count("failed")} failed, in ${took(Date.now() - started)}`,
);
process.exitCode = count("failed") ? 1 : 0;
