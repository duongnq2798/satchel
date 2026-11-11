// Moves a mainnet satchel's ETH on Base into USDC on Arbitrum One, at the same satchel's address,
// through the 1Click API of NEAR Intents. The quote's recipient and refundTo are both the satchel:
// what comes out, and any refund, lands back in it. The deposit is a plain transfer that the owner
// sends with the app's Send panel, so the contract records it like any other send.
//
// This script asks 1Click for quotes and reads NEAR, Base and Arbitrum. It signs nothing, holds no
// key and needs no API key. Mainnet only: 1Click has no testnet.
//
//   plan <id>                  checks the satchel and asks for a dry quote (no deposit address)
//   quote <id>                 asks for the real quote and saves it to --out
//   ready                      run just before sending: is the saved quote still safe to send to?
//   submit <base tx> [--near-tx <hash>]   checks the deposit on Base, saves it, tells 1Click
//   status [--wait]            asks 1Click how the swap stands; on SUCCESS reads the USDC on Arbitrum
//
// Node 22 or later, after `npm ci` and `npm run build -w satchel-nft` at the repository root:
//   node tools/oneclick-exit.mjs plan 2
// --amount <ETH> sends that instead of the whole balance less fees. --out defaults to
// deployments/mainnet-1click-exit.json.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { formatEther, getAddress, isAddress, parseEther } from "viem";

const {
  MAINNET,
  TOKENS,
  buildReport,
  chainInfo,
  fromContractTx,
  l1Fee,
  maxCost,
  prepareTx,
  readTxStatus,
  satchel,
  sendChains,
  signEvmCalls,
  tokenAddress,
  verifiedClient,
} = await import("../packages/satchel-nft/dist/index.js");

const ONE_CLICK = "https://1click.chaindefuser.com";
const BASE = 8453;
const ARBITRUM = 42161;
/** The demo satchel the README quotes: it signs nothing until judging ends (docs/DEMO.md). */
const DEMO = new Set(["1"]);
const SLIPPAGE_BPS = 100;
/** The deadline asked for. 1Click starts refunding at it, so the deposit must land well before. */
const QUOTE_MINUTES = 60;
/** Time kept before that deadline, besides the quote's own time estimate: NEAR, the MPC network and Base. */
const SEND_MARGIN_MS = 10 * 60_000;
/** 1Click's documented fee without an API key is 25 bps; anything above it is refused. */
const MAX_FEE_BPS = 25;
/** The amount sent is rounded down to a millionth of an ETH, so it can be typed. */
const STEP = 10n ** 12n;
/** Fee room kept in the satchel: three times what the Send panel would budget now, and never under this. */
const FEE_HEADROOM = 3n;
const FEE_FLOOR = parseEther("0.00002");
/** INCOMPLETE_DEPOSIT is not here: under EXACT_INPUT a short deposit is refunded at the deadline. */
const TERMINAL = new Set(["SUCCESS", "REFUNDED", "FAILED"]);
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const DEAD = "0x000000000000000000000000000000000000dEaD";

const [command, first] = process.argv.slice(2);
const OUT = arg("--out") ?? fileURLToPath(new URL("../deployments/mainnet-1click-exit.json", import.meta.url));
/** This script's command line for a next step, with the same --out. */
const cmd = (rest) => {
  const out = arg("--out");
  return `node tools/oneclick-exit.mjs ${rest}${out === null ? "" : ` --out ${/\s/.test(out) ? JSON.stringify(out) : out}`}`;
};

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
}

/** A refusal, printed with exit code 1. Thrown rather than process.exit, which can crash Node on Windows while sockets close. */
class Stop extends Error {
  constructor(message, httpStatus) {
    super(message);
    this.httpStatus = httpStatus;
  }
}
function fail(message, httpStatus) {
  throw new Stop(message, httpStatus);
}

/** An error worth asking again after: 1Click busy or down, or the network. */
const transient = (err) =>
  (err instanceof Stop && (err.httpStatus === 429 || err.httpStatus >= 500)) ||
  (err instanceof TypeError && /fetch failed|terminated/i.test(err.message)) ||
  err?.name === "TimeoutError" ||
  err?.name === "AbortError";

const json = (value) => JSON.stringify(value, (_, v) => (typeof v === "bigint" ? String(v) : v), 2);
const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
const when = (ms) => `${new Date(ms).toISOString()} (${new Date(ms).toLocaleString()} here)`;

async function oneClick(path, init) {
  const res = await fetch(`${ONE_CLICK}${path}`, { ...init, signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) fail(`1Click ${path} answered ${res.status}: ${typeof body === "string" ? body : json(body)}`, res.status);
  return body;
}

/** 1Click's status for a deposit address. An answer without one counts as a 502, so a wait asks again and saves nothing. */
async function statusOf(depositAddress) {
  const body = await oneClick(`/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`);
  if (typeof body?.status !== "string") {
    fail(`1Click /v0/status answered without a status: ${typeof body === "string" ? body.slice(0, 200) : JSON.stringify(body)}`, 502);
  }
  return body;
}

function readSaved() {
  if (!existsSync(OUT)) fail(`there is no saved quote at ${OUT}: run quote first`);
  return JSON.parse(readFileSync(OUT, "utf8"));
}

/** Writes the file whole, so a run reading it at the same time never sees half of it. */
function save(record) {
  writeFileSync(`${OUT}.tmp`, `${json(record)}\n`);
  renameSync(`${OUT}.tmp`, OUT);
}

/** Re-reads the file, refuses if another run replaced its quote, and saves `change` into it. */
function update(depositAddress, change) {
  const fresh = readSaved();
  if (!same(fresh.quote?.quote?.depositAddress, depositAddress)) {
    fail(`${OUT} now holds the quote for ${fresh.quote?.quote?.depositAddress}, not ${depositAddress}: run this again`);
  }
  save({ ...fresh, ...change });
}

/** The two assets, from 1Click's own list: native ETH on Base, and the USDC that contents.ts lists on Arbitrum. */
async function route() {
  const tokens = await oneClick("/v0/tokens");
  const usdc = TOKENS[ARBITRUM].find((t) => t.kind === "USDC");
  const origin = tokens.filter((t) => t.blockchain === "base" && t.symbol === "ETH" && !t.contractAddress);
  const destination = tokens.filter((t) => t.blockchain === "arb" && same(t.contractAddress, usdc.address));
  if (origin.length !== 1) fail(`1Click lists ${origin.length} native ETH assets on Base, not one`);
  if (destination.length !== 1 || destination[0].decimals !== 6) fail(`1Click doesn't list Arbitrum's USDC ${usdc.address} once, with 6 decimals`);
  return { origin: origin[0], destination: destination[0], usdc: usdc.address };
}

/** The satchel, refused if the Send panel couldn't send from it, with its address and Base balance. */
async function satchelOnBase(tokenId) {
  if (!/^\d+$/.test(tokenId ?? "")) fail("give a satchel id, such as 2");
  if (DEMO.has(tokenId)) fail(`mainnet satchel #${tokenId} is a demo satchel: it signs nothing until 2026-11-25 (docs/DEMO.md). Mint a new one.`);
  const found = await satchel(MAINNET).get(tokenId);
  if (found === null) fail(`there is no satchel #${tokenId} on ${MAINNET.contract}`);
  if (found.listing !== null) fail(`satchel #${tokenId} is listed, and signing is frozen while it is. Delist it first.`);
  const chain = sendChains(MAINNET).find((c) => c.id === BASE);
  if (!chain) fail("the app doesn't send on Base");
  const address = await tokenAddress(MAINNET, found.path);
  const balance = await (await verifiedClient(BASE)).getBalance({ address });
  return { tokenId, owner: found.owner_id, path: found.path, recordVersion: found.record.version, address, chain, balance };
}

/** What the Send panel will check: the value plus gas at its fee cap plus Base's doubled L1 fee. */
async function sendCost(s, to, value) {
  const tx = await prepareTx(s.chain, s.address, to, value, "0x");
  return { tx, cost: maxCost(tx, await l1Fee(tx)) };
}

const feeRoom = (fee) => (fee * FEE_HEADROOM > FEE_FLOOR ? fee * FEE_HEADROOM : FEE_FLOOR);

/** The whole balance less the fee room, rounded down to STEP; or --amount. */
async function amountToSend(s) {
  const { tx, cost } = await sendCost(s, DEAD, 0n);
  const room = feeRoom(cost);
  const given = arg("--amount");
  const amount = given ? parseEther(given) : ((s.balance - room) / STEP) * STEP;
  if (amount <= 0n) fail(`satchel #${s.tokenId} holds ${formatEther(s.balance)} ETH on Base, not enough to send after ${formatEther(room)} ETH of fee room`);
  if (amount + room > s.balance) fail(`sending ${formatEther(amount)} ETH leaves less than ${formatEther(room)} ETH for fees`);
  return { amount, room, gas: tx.gas };
}

function quoteRequest(r, s, amount, dry) {
  return {
    dry,
    swapType: "EXACT_INPUT",
    slippageTolerance: SLIPPAGE_BPS,
    originAsset: r.origin.assetId,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: r.destination.assetId,
    amount: amount.toString(),
    recipient: s.address,
    recipientType: "DESTINATION_CHAIN",
    refundTo: s.address,
    refundType: "ORIGIN_CHAIN",
    deadline: new Date(Date.now() + QUOTE_MINUTES * 60_000).toISOString(),
    referral: "satchel",
  };
}

/** Refuses a quote that isn't the one asked for: other assets, amount, deadline, recipient, refund address or a fee above 25 bps. */
function checkQuote(asked, answer) {
  const echo = answer.quoteRequest ?? {};
  const fields = ["dry", "swapType", "originAsset", "destinationAsset", "amount", "depositType", "recipientType", "refundType", "slippageTolerance", "deadline"];
  for (const field of fields) {
    if (echo[field] !== asked[field]) fail(`the quote's ${field} is ${json(echo[field])}, not ${json(asked[field])}`);
  }
  if (!same(echo.recipient, asked.recipient) || !same(echo.refundTo, asked.refundTo)) {
    fail(`the quote pays ${echo.recipient} and refunds ${echo.refundTo}, not the satchel's ${asked.recipient}`);
  }
  const q = answer.quote ?? {};
  if (q.amountIn !== asked.amount) fail(`the quote takes ${q.amountIn} wei, not ${asked.amount}`);
  const out = BigInt(q.amountOut ?? 0);
  const min = BigInt(q.minAmountOut ?? 0);
  if (min <= 0n || min > out || min * 10_000n < out * BigInt(10_000 - SLIPPAGE_BPS) - 10_000n) {
    fail(`the quote's minimum out (${q.minAmountOut}) doesn't match ${SLIPPAGE_BPS} bps of slippage on ${q.amountOut}`);
  }
  const fees = echo.appFees ?? [];
  const feeBps = fees.reduce((sum, f) => sum + Number(f.fee), 0);
  if (!(feeBps <= MAX_FEE_BPS)) fail(`the quote carries ${feeBps} bps of fees (${json(fees)}), more than ${MAX_FEE_BPS}`);
  return { feeBps, fees };
}

/**
 * The last moment to press Send. Refunds start at the deadline the script asked for (1Click's own
 * `quote.deadline` comes back later: until then the address still takes refunds), so the deposit
 * must arrive and be swapped before it.
 */
function sendBy(answer) {
  const q = answer.quote;
  const ends = [answer.quoteRequest.deadline, q.deadline, q.timeWhenInactive].filter(Boolean).map((t) => Date.parse(t));
  return Math.min(...ends) - Number(q.timeEstimate ?? 0) * 1000 - SEND_MARGIN_MS;
}

function printQuote(answer, check, r) {
  const q = answer.quote;
  console.log(`  In:            ${q.amountInFormatted} ETH on Base (about $${Number(q.amountInUsd).toFixed(2)})`);
  console.log(`  Out:           ${q.amountOutFormatted} USDC on Arbitrum One, at least ${(Number(q.minAmountOut) / 1e6).toFixed(6)} (about $${Number(q.amountOutUsd).toFixed(2)})`);
  console.log(`  Fees:          ${check.feeBps} bps to ${check.fees.map((f) => f.recipient).join(", ") || "no one"}; the out amount already has the ${(Number(q.withdrawFee ?? 0) / 1e6).toFixed(6)} USDC withdrawal fee taken off; a refund would cost ${formatEther(BigInt(q.refundFee ?? 0))} ETH`);
  console.log(`  Time estimate: ${q.timeEstimate} s after the deposit is seen`);
  console.log(`  Assets:        ${r.origin.assetId} -> ${r.destination.assetId}`);
  if (q.deadline) {
    console.log(`  Refunds from:  ${answer.quoteRequest.deadline}, if the swap hasn't run by then`);
    console.log(`  Address open:  until ${q.deadline}; a deposit after that may be lost`);
  }
}

function printSend(saved, ms) {
  const q = saved.quote.quote;
  console.log(`\nSend it before ${when(ms)}, ${Math.floor((ms - Date.now()) / 60_000)} minutes from now,`);
  console.log(`from https://satchelnft.xyz/mainnet/satchel/${saved.tokenId}, "Send from this satchel":`);
  console.log("  Chain:     Base");
  console.log(`  To:        ${getAddress(q.depositAddress)}`);
  console.log(`  Amount:    ${formatEther(BigInt(q.amountIn))}`);
  console.log("  Calldata:  0x (leave it)");
  console.log("Type exactly that amount: less is refunded to the satchel at the deadline, minus the refund fee.");
  console.log("If the panel refuses because of fees, don't lower the amount: wait a few minutes, or add a little ETH, and send the same amount.");
}

/**
 * Refuses when the saved quote may already have its deposit: one is saved, or the satchel has sent
 * from Base since the quote. 1Click can take minutes to see a deposit, so the nonce says it first.
 */
async function refuseIfSent(saved, what) {
  if (saved.deposit) fail(`the deposit ${saved.deposit.tx} is already saved: ${what}. Run ${cmd("status")}.`);
  if (saved.nonceBefore === undefined) return;
  const nonce = await (await verifiedClient(BASE)).getTransactionCount({ address: saved.address, blockTag: "pending" });
  if (nonce !== saved.nonceBefore) {
    fail(
      `satchel #${saved.tokenId} has sent from Base since the quote (nonce ${saved.nonceBefore} then, ${nonce} now), so a deposit may be on its way: ${what}. ` +
        `Run ${cmd("submit <the Base tx hash>")}, or ${cmd("status")}. If that send was something else, move ${OUT} first.`,
    );
  }
}

async function plan(tokenId) {
  const s = await satchelOnBase(tokenId);
  console.log(`Satchel #${s.tokenId} on ${MAINNET.contract}, owned by ${s.owner}, record version ${s.recordVersion}`);
  console.log(`  Address:  ${s.address} (derived from the pinned MPC root key and ${s.path})`);
  console.log(`  On Base:  ${formatEther(s.balance)} ETH`);
  const report = await buildReport(MAINNET, tokenId).catch((err) => ({ verdict: `couldn't read (${err instanceof Error ? err.message : err})` }));
  console.log(`  Report:   ${report?.verdict ?? "none"}${report?.verdict !== "clean" ? " (the exit is evidence only if the report reads clean after it)" : ""}`);
  const { amount, room, gas } = await amountToSend(s);
  console.log(`  To send:  ${formatEther(amount)} ETH, keeping ${formatEther(s.balance - amount)} ETH (${formatEther(room)} of room for a ${gas}-gas send)`);
  const r = await route();
  const asked = quoteRequest(r, s, amount, true);
  const answer = await oneClick("/v0/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(asked) });
  const check = checkQuote(asked, answer);
  console.log("\nDry quote (no deposit address, nothing reserved):");
  printQuote(answer, check, r);
  console.log(`\nNext: ${cmd(`quote ${tokenId}${arg("--amount") ? ` --amount ${arg("--amount")}` : ""}`)}`);
}

async function quote(tokenId) {
  let replaced = null;
  if (!existsSync(dirname(OUT))) fail(`the folder for ${OUT} doesn't exist; create it or pass --out`);
  if (existsSync(OUT)) {
    // A new quote replaces the saved one only while 1Click has seen nothing sent to the old address,
    // and, while that address is still open, only when asked to: a deposit can take minutes to show.
    const saved = JSON.parse(readFileSync(OUT, "utf8"));
    const old = saved.quote?.quote;
    if (old?.depositAddress) {
      const now = await statusOf(old.depositAddress);
      if (now.status !== "PENDING_DEPOSIT") {
        fail(`1Click reads ${now.status} for the saved quote's ${old.depositAddress}: don't send to it. Keep ${OUT}; move it before asking again.`);
      }
      await refuseIfSent(saved, "don't ask for a new quote");
      if (Date.parse(old.deadline) > Date.now() && !process.argv.includes("--replace")) {
        fail(
          sendBy(saved.quote) - Date.now() > 2 * 60_000
            ? `${OUT} holds a quote for ${old.depositAddress} that 1Click still waits on. To use it: ${cmd("ready")}, then send. Pass --replace only if nothing was sent.`
            : `${OUT} holds a quote for ${old.depositAddress} whose refunds start at ${saved.quote.quoteRequest.deadline}: don't send to it. Pass --replace if nothing was sent to it.`,
        );
      }
    }
    replaced = saved;
  }
  const s = await satchelOnBase(tokenId);
  const { amount } = await amountToSend(s);
  const r = await route();
  const asked = quoteRequest(r, s, amount, false);
  const answer = await oneClick("/v0/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(asked) });
  const check = checkQuote(asked, answer);
  const q = answer.quote;
  if (!isAddress(q.depositAddress ?? "", { strict: false })) fail(`the deposit address ${q.depositAddress} is not an EVM address`);
  const deposit = getAddress(q.depositAddress);
  if (same(deposit, s.address)) fail("the deposit address is the satchel's own");
  if (q.depositMemo) fail(`the quote asks for a memo (${q.depositMemo}), which a plain transfer can't carry`);
  const by = sendBy(answer);
  if (!(by - Date.now() > 15 * 60_000)) fail(`the quote leaves ${((by - Date.now()) / 60_000).toFixed(1)} minutes to send`);
  const code = await (await verifiedClient(BASE)).getCode({ address: deposit });
  // The panel reads fees again when it sends: this is its check, with the real recipient, and room to spare.
  const { tx, cost } = await sendCost(s, deposit, amount);
  if (amount + feeRoom(cost - amount) > s.balance) {
    fail(`the send would cost up to ${formatEther(cost - amount)} ETH in fees, too close to the ${formatEther(s.balance - amount)} ETH left: ask again with a smaller amount: ${cmd(`quote ${tokenId} --replace --amount <ETH>`)}`);
  }
  const record = {
    network: "mainnet",
    contract: MAINNET.contract,
    tokenId: s.tokenId,
    path: s.path,
    owner: s.owner,
    address: s.address,
    recordVersionBefore: s.recordVersion,
    // The satchel's next Base nonce: the deposit's, until something else is sent first.
    nonceBefore: tx.nonce,
    balanceBefore: { chainId: String(BASE), wei: s.balance },
    route: { origin: r.origin, destination: r.destination },
    depositIsContract: code !== undefined && code !== "0x",
    quotedAt: new Date().toISOString(),
    ...(arg("--amount") ? { amountGiven: arg("--amount") } : {}),
    quote: answer,
  };
  // The quote it replaces stays beside it, so its address can still be looked up.
  if (replaced) renameSync(OUT, `${OUT}.replaced-${String(replaced.quotedAt ?? "").replace(/[^0-9TZ]/g, "")}.json`);
  save(record);
  console.log(`Quote ${answer.correlationId}, saved to ${OUT}:`);
  printQuote(answer, check, r);
  if (record.depositIsContract) console.log(`  Note: the deposit address holds code on Base; the send budgets ${tx.gas} gas.`);
  printSend(record, by);
  console.log(`\nJust before you press Send: ${cmd("ready")}`);
  console.log(`Once it is sent: ${cmd("submit <the Base tx hash> --near-tx <the sign_evm hash>")}`);
}

async function ready() {
  const saved = readSaved();
  const q = saved.quote.quote;
  const now = await statusOf(q.depositAddress);
  if (now.status !== "PENDING_DEPOSIT") fail(`1Click reads ${now.status} for ${q.depositAddress}: don't send again. Run ${cmd("status")}.`);
  await refuseIfSent(saved, "don't send again or top up");
  const balance = await (await verifiedClient(BASE)).getBalance({ address: saved.address });
  if (balance < BigInt(q.amountIn)) fail(`the satchel holds ${formatEther(balance)} ETH on Base, less than ${q.amountInFormatted}: don't send.`);
  const by = sendBy(saved.quote);
  if (!(by - Date.now() > 2 * 60_000)) {
    const again = `quote ${saved.tokenId} --replace${saved.amountGiven ? ` --amount ${saved.amountGiven}` : ""}`;
    fail(`it is too close to ${saved.quote.quoteRequest.deadline}, when refunds start: don't send. Ask again: ${cmd(again)}`);
  }
  console.log(`1Click is waiting for the deposit (${now.status}).`);
  printSend(saved, by);
}

async function submit(hash) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash ?? "")) fail("give the Base transaction hash the Send panel linked");
  const nearTx = arg("--near-tx");
  if (nearTx !== null && !/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(nearTx)) fail(`${nearTx} is not a NEAR transaction hash`);
  const saved = readSaved();
  const q = saved.quote.quote;
  const base = await verifiedClient(BASE);
  const tx = await base.getTransaction({ hash });
  if (!same(tx.from, saved.address) || !same(tx.to, q.depositAddress) || tx.value !== BigInt(q.amountIn) || tx.input !== "0x") {
    fail(`${hash} sends ${tx.value} wei from ${tx.from} to ${tx.to}, not ${q.amountIn} from the satchel to ${q.depositAddress}`);
  }
  const receipt = await base.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success") fail(`${hash} reverted on Base`);
  let near = {};
  if (nearTx !== null) {
    // Saved only if it is the sign_evm that built this very transaction for this satchel.
    const t = await readTxStatus(MAINNET, nearTx);
    const succeeded = (st) => typeof st === "object" && st !== null && !("Failure" in st);
    const built = signEvmCalls(MAINNET, t).filter((c) => {
      if (c.tokenId !== saved.tokenId || !succeeded(c.status) || c.tx === null) return false;
      let e;
      try {
        e = fromContractTx(c.tx);
      } catch {
        return false;
      }
      return (
        e.chainId === BASE &&
        e.nonce === tx.nonce &&
        same(e.to, tx.to) &&
        e.value === tx.value &&
        e.data.toLowerCase() === tx.input.toLowerCase() &&
        e.gas === tx.gas &&
        e.maxFeePerGas === tx.maxFeePerGas &&
        e.maxPriorityFeePerGas === tx.maxPriorityFeePerGas
      );
    });
    if (built.length !== 1) fail(`${nearTx} has no successful sign_evm for satchel #${saved.tokenId} that built ${hash}: pass the hash of the panel's "sign_evm on NEAR" link, or leave --near-tx out`);
    near = { nearTx, nearSigner: t.transaction.signer_id, nearBlockHash: t.transaction_outcome?.block_hash };
  }
  const answer = await oneClick("/v0/deposit/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ txHash: hash, depositAddress: q.depositAddress }),
  });
  const deposit = {
    chainId: String(BASE),
    tx: hash,
    nonce: String(tx.nonce),
    block: receipt.blockNumber,
    // Base's L1 data fee, which viem returns as a bigint or leaves as hex depending on the chain it knows.
    feeWei: receipt.gasUsed * receipt.effectiveGasPrice + BigInt(receipt.l1Fee ?? 0),
    ...near,
  };
  update(q.depositAddress, { deposit });
  console.log(`Base has the deposit in block ${receipt.blockNumber}; 1Click answered ${answer.status ?? json(answer)}. Next: ${cmd("status --wait")}`);
}

/** The USDC Transfer logs to the satchel in 1Click's destination transactions, read from Arbitrum itself. */
async function arrival(saved, details) {
  const usdc = TOKENS[ARBITRUM].find((t) => t.kind === "USDC").address;
  const arb = await verifiedClient(ARBITRUM);
  const txs = [];
  let received = 0n;
  for (const { hash } of details.destinationChainTxHashes ?? []) {
    const receipt = await arb.getTransactionReceipt({ hash });
    if (receipt.status !== "success") continue;
    for (const log of receipt.logs) {
      if (same(log.address, usdc) && log.topics[0] === TRANSFER && same(`0x${log.topics[2]?.slice(26)}`, saved.address)) {
        received += BigInt(log.data);
        txs.push({ hash, block: receipt.blockNumber, logIndex: log.logIndex, value: BigInt(log.data) });
      }
    }
  }
  if (received === 0n) fail("no USDC transfer to the satchel in 1Click's destination transactions on Arbitrum");
  const min = BigInt(saved.quote.quote.minAmountOut);
  if (received < min) fail(`the satchel got ${received} USDC units on Arbitrum, under the quote's minimum ${min}`);
  return { chainId: String(ARBITRUM), token: usdc, received, txs };
}

async function status() {
  const saved = readSaved();
  const q = saved.quote.quote;
  const wait = process.argv.includes("--wait");
  const until = Math.max(Date.now() + 45 * 60_000, Date.parse(saved.quote.quoteRequest.deadline) + 30 * 60_000);
  let now;
  let shown = null;
  for (;;) {
    try {
      now = await statusOf(q.depositAddress);
    } catch (err) {
      // 1Click carries on either way: a wait outlives a busy or unreachable API.
      if (!wait || !transient(err)) throw err;
      console.error(`${new Date().toISOString()}  couldn't read 1Click (${err.message}); trying again`);
      if (Date.now() > until) break;
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      continue;
    }
    if (now.status !== shown) {
      shown = now.status;
      console.log(`${new Date().toISOString()}  ${now.status}`);
      const d = now.swapDetails ?? {};
      for (const h of d.originChainTxHashes ?? []) console.log(`  origin:      ${h.explorerUrl || h.hash}`);
      for (const h of d.destinationChainTxHashes ?? []) console.log(`  destination: ${h.explorerUrl || h.hash}`);
      if (d.amountOutFormatted) console.log(`  out:         ${d.amountOutFormatted}`);
      if (d.refundedAmount && d.refundedAmount !== "0") console.log(`  refunded:    ${d.refundedAmount} (${d.refundReason ?? "no reason given"})`);
      if (now.status === "INCOMPLETE_DEPOSIT") console.log(`  1Click saw less than ${q.amountInFormatted} ETH; it refunds the satchel from ${saved.quote.quoteRequest.deadline}.`);
    }
    update(q.depositAddress, { status: now, statusReadAt: new Date().toISOString() });
    if (!wait || TERMINAL.has(now.status) || Date.now() > until) break;
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  if (now === undefined) {
    console.error(`Stopped waiting: 1Click couldn't be read; run ${cmd("status --wait")} again later.`);
    process.exitCode = 1;
  } else if (now.status === "SUCCESS") {
    const got = await arrival(saved, now.swapDetails ?? {});
    update(q.depositAddress, { arrival: got });
    console.log(`Arbitrum One: the satchel received ${(Number(got.received) / 1e6).toFixed(6)} USDC (${got.txs.map((t) => t.hash).join(", ")}).`);
    console.log(`Base finalizes the deposit about 20 minutes after it was sent. Then: npx -y satchel-nft@0.2.0 verify --network mainnet ${saved.tokenId}`);
  } else if (now.status === "REFUNDED" || now.status === "FAILED") {
    console.error(`The swap ended ${now.status}: the exit didn't happen.`);
    process.exitCode = 1;
  } else if (wait) {
    console.error(`Stopped waiting at ${now.status}; run ${cmd("status --wait")} again later.`);
    process.exitCode = 1;
  }
}

try {
  if (chainInfo(BASE)?.name !== "Base" || chainInfo(ARBITRUM)?.name !== "Arbitrum One") fail("the package's chain list changed");
  if (command === "plan") await plan(first);
  else if (command === "quote") await quote(first);
  else if (command === "ready") await ready();
  else if (command === "submit") await submit(first);
  else if (command === "status") await status();
  else fail("usage: node tools/oneclick-exit.mjs plan <id> | quote <id> | ready | submit <base tx> [--near-tx <hash>] | status [--wait]");
} catch (err) {
  if (err instanceof Stop) console.error(`\nStopped: ${err.message}`);
  else if (transient(err)) console.error(`\nStopped: couldn't reach a server (${err.message}); run the same command again.`);
  else throw err;
  process.exitCode = 1;
}
