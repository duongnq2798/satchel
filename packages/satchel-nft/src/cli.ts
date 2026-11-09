#!/usr/bin/env node
// The satchel-nft command line. Read commands need no keys. Sign commands have the near CLI sign
// from its keychain, decode what it signed, show it, and send only once you agree (or --yes).
//
// Exit codes: 0 done (verify: PROVABLY CLEAN), 1 the answer is no (not clean, refused, failed on
// chain), 2 it could not run (bad arguments, an RPC for the wrong network, no near CLI), 3 it sent a
// transaction but couldn't read what happened to it (check it before running the command again).
import { createRequire } from "node:module";
import { createInterface } from "node:readline/promises";
import { formatEther } from "viem";
import { type CliArgs, USAGE, parseCli, sendInputs } from "./cli-args.js";
import { CHAINS, NETWORKS, type Network, chainInfo, nearTxUrl, sendChains } from "./config.js";
import { type MpcSignature, client, formatBalance, tokenAddress } from "./evm.js";
import { assertDeployment, assertReceiver, assertTxFor } from "./guard.js";
import { limiter } from "./limit.js";
import { type ExecutionOutcome, type SatchelView, type Token, nearChainId, nearRpcUrl, outcomeValue, setNearRpc } from "./near.js";
import { type DecodedTx, type NearCli, OutcomeUnknown, resolveNearCli, signAndSend } from "./near-cli.js";
import { type Report, buildReport, contractFacts } from "./report.js";
import { type WalletTx, formatNear, parseNear, satchel, satchelTx } from "./satchel.js";
import { type SendStep, liveSendDeps, sendFromSatchel } from "./send.js";

/** Ends the run with `code` and `message`, and `extra` beside the error in `--json` mode. */
class Exit extends Error {
  constructor(
    readonly code: 1 | 2 | 3,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const json = (value: unknown) => JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2);
const out = (line = "") => process.stdout.write(`${line}\n`);
const note = (line = "") => process.stderr.write(`${line}\n`);

function applyRpcOverrides() {
  if (process.env.NEAR_RPC) setNearRpc(process.env.NEAR_RPC);
  for (const chain of CHAINS) {
    const url = process.env[`RPC_${chain.id}`];
    if (url) chain.rpc = url;
  }
}

// ---- Read commands ----------------------------------------------------------------------------

const MARK = { pass: "PASS", fail: "FAIL", unknown: "????" } as const;
const VERDICT = { clean: "PROVABLY CLEAN", "not-provable": "NOT PROVABLE", unknown: "COULD NOT CHECK EVERYTHING" } as const;

function printReport(net: Network, report: Report) {
  out(`Satchel #${report.tokenId} on ${net.contract} (${net.id})`);
  out(`owner ${report.owner}, address ${report.address}, record version ${report.recordVersion}`);
  if (report.listing) out(`listed by ${report.listing.seller} at record version ${report.listing.record_version}`);
  for (const check of report.checks) {
    out(`\n[${MARK[check.status]}] ${check.title}`);
    for (const line of check.lines) out(`       ${line}`);
  }
  out(`\n${VERDICT[report.verdict]} (checked ${report.checkedAt})`);
  out(`read from ${report.sources?.join(", ")}`);
}

async function verify(net: Network, args: CliArgs): Promise<number> {
  const report = await buildReport(net, args.tokenId as string);
  if (report === null) throw new Exit(1, `No satchel #${args.tokenId} on ${net.contract}`);
  if (args.json) out(json(report));
  else printReport(net, report);
  return report.verdict === "clean" ? 0 : 1;
}

async function token(net: Network, tokenId: string): Promise<SatchelView> {
  const found = await satchel(net).get(tokenId);
  if (found === null) throw new Exit(1, `No satchel #${tokenId} on ${net.contract}`);
  return found;
}

async function show(net: Network, args: CliArgs): Promise<number> {
  const view = await token(net, args.tokenId as string);
  // Until the contract passes its check its account could hold anyone's code, so no address is shown.
  await assertDeployment(net);
  const address = await tokenAddress(net, view.path);
  const balances = await Promise.all(
    sendChains(net).map(async (chain) => ({
      chainId: chain.id,
      name: chain.name,
      symbol: chain.symbol,
      wei: await client(chain.id)
        .getBalance({ address })
        .catch(() => null),
    })),
  );
  if (args.json) {
    const { token_id, owner_id, path, record, listing } = view;
    out(json({ network: net.id, contract: net.contract, tokenId: token_id, owner: owner_id, path, address, recordVersion: record.version, listing, balances }));
    return 0;
  }
  out(`Satchel #${view.token_id} on ${net.contract} (${net.id})`);
  out(`owner ${view.owner_id}, path ${view.path}, record version ${view.record.version}`);
  out(`address ${address}`);
  out(
    view.listing
      ? `listed for ${formatNear(view.listing.price)} NEAR by ${view.listing.seller} at record version ${view.listing.record_version}`
      : "not listed",
  );
  out();
  const width = Math.max(...balances.map((b) => b.name.length));
  for (const b of balances) out(`${b.name.padEnd(width)}  ${b.wei === null ? "unavailable" : `${formatBalance(b.wei)} ${b.symbol}`}`);
  out(`\nBefore you buy it: satchel-nft verify${net.id === "mainnet" ? " --network mainnet" : ""} ${view.token_id}`);
  return 0;
}

async function record(net: Network, args: CliArgs): Promise<number> {
  const view = await token(net, args.tokenId as string);
  const r = view.record;
  if (args.json) {
    out(json({ network: net.id, contract: net.contract, tokenId: view.token_id, owner: view.owner_id, record: r }));
    return 0;
  }
  const chainName = (id: string) => `${chainInfo(Number(id))?.name ?? "chain"} (${id})`;
  out(`Satchel #${view.token_id}'s signing record on ${net.contract} (${net.id}), version ${r.version}`);
  out(`\nSigned through sign_evm:${r.evm.length === 0 ? " nothing" : ""}`);
  for (const c of r.evm) out(`  ${chainName(c.chain_id)}: ${c.signatures} signature(s), up to nonce ${c.max_nonce}`);
  out(`\nApprovals signed:${r.approvals.length === 0 ? " none" : ""}`);
  for (const a of r.approvals) {
    const token = a.token === null ? "" : `, token ${a.token}`;
    out(`  ${chainName(a.chain_id)}: ${a.kind} on ${a.contract} for ${a.spender}${token}, argument ${a.arg}`);
  }
  const lastRaw = r.opaque_signatures > 0 ? `, the last at ${new Date(Number(BigInt(r.last_opaque_at) / 1_000_000n)).toISOString()}` : "";
  out(
    `\n${r.approvals_not_itemized} approval(s) over the cap, ${r.unclassified_calls} unclassified call(s), ${r.opaque_signatures} raw signature(s)${lastRaw}`,
  );
  return 0;
}

async function market(net: Network, args: CliArgs): Promise<number> {
  const listings: [string, NonNullable<SatchelView["listing"]>][] = [];
  for (let from = 0; ; from += 100) {
    const page = await satchel(net).listings(from, 100);
    listings.push(...page);
    if (page.length < 100) break;
  }
  // One read of the contract's own facts for every report, and three reports at a time.
  const facts = contractFacts(net);
  const limit = limiter(3);
  const rows = await Promise.all(
    listings.map(async ([tokenId, listing]) => {
      const report = await limit(() => buildReport(net, tokenId, facts)).catch(() => null);
      return { tokenId, ...listing, verdict: report?.verdict ?? "unknown", recordVersion: report?.recordVersion ?? null };
    }),
  );
  if (args.json) {
    out(json({ network: net.id, contract: net.contract, listings: rows }));
    return 0;
  }
  out(`${rows.length} satchel(s) for sale on ${net.contract} (${net.id})`);
  for (const r of rows) {
    out(`  #${r.tokenId}  ${formatNear(r.price)} NEAR  by ${r.seller}  record version ${r.record_version}  ${VERDICT[r.verdict]}`);
  }
  return 0;
}

// ---- Sign commands ----------------------------------------------------------------------------

function nearCli(args: CliArgs): NearCli {
  try {
    return { bin: resolveNearCli(args.nearCli ?? process.env.NEAR_CLI ?? "near"), keychain: args.keychain };
  } catch (err) {
    throw new Exit(2, `${err instanceof Error ? err.message : err}. Nothing was signed.`);
  }
}

/** Asking needs a terminal both ways: the transaction and the question go to stderr, the answer comes on stdin. */
function assertCanAsk(args: CliArgs) {
  if (args.yes || (process.stdin.isTTY && process.stderr.isTTY)) return;
  throw new Exit(
    2,
    "There is no terminal to ask in, or stderr is redirected. In Git Bash's mintty window, try PowerShell or cmd; or pass --yes to sign without asking. Nothing was signed.",
  );
}

async function confirm(args: CliArgs) {
  if (args.yes) return;
  assertCanAsk(args);
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  // Input that ends before an answer (Ctrl+D, a closed terminal) is a no, not a silent exit.
  const closed = new Promise<never>((_, reject) => rl.once("close", () => reject(new Exit(1, "Not sent."))));
  closed.catch(() => {});
  try {
    const answer = await Promise.race([rl.question("Send it? Type yes to send: "), closed]);
    if (answer.trim().toLowerCase() !== "yes") throw new Exit(1, "Not sent.");
  } finally {
    rl.close();
  }
}

function describe(net: Network, cli: NearCli, decoded: DecodedTx, what: string[]) {
  const deposit = decoded.deposit === 1n ? "1 yoctoNEAR" : `${formatNear(decoded.deposit, 24)} NEAR`;
  note(`\nThe near CLI (${cli.bin}) signed, on NEAR ${net.id}, as ${decoded.signerId} (key ${decoded.publicKey}):`);
  note(`  ${decoded.receiverId}.${decoded.methodName}(${decoded.args})`);
  note(`  deposit ${deposit}, gas ${decoded.gas / 1_000_000_000_000n} Tgas`);
  for (const line of what) note(`  ${line}`);
  if (net.id === "mainnet") note("  This is NEAR mainnet: real NEAR, and for a send, real funds on that chain.");
}

/**
 * Signs `tx` as the `--as` account through the near CLI, shows what it signed, asks, sends it and
 * returns the value the call resolved to. A call the contract refuses throws with its reason.
 */
async function submit<T>(net: Network, args: CliArgs, tx: WalletTx, what: string[]): Promise<{ hash: string; value: T | null }> {
  const signer = args.signer as string;
  assertTxFor(net, tx, signer);
  assertCanAsk(args);
  const cli = nearCli(args);
  // Like the app: nothing is signed for a contract that could hold anyone's code.
  await assertDeployment(net);
  let sent: { hash: string; outcome: ExecutionOutcome };
  try {
    sent = await signAndSend(cli, net, signer, tx, async (decoded) => {
      describe(net, cli, decoded, what);
      await confirm(args);
      note(`Sending ${decoded.hash}…`);
    });
  } catch (err) {
    if (err instanceof Exit) throw err;
    if (err instanceof OutcomeUnknown) {
      throw new Exit(3, `${err.message}. Check ${nearTxUrl(net, err.hash)} before you run this again.`, {
        status: "unknown",
        nearTx: err.hash,
      });
    }
    throw new Exit(2, err instanceof Error ? err.message : String(err));
  }
  try {
    return { hash: sent.hash, value: outcomeValue<T>(sent.outcome) };
  } catch (err) {
    throw new Exit(1, `${err instanceof Error ? err.message : err} (${nearTxUrl(net, sent.hash)})`);
  }
}

/** Refuses early, with a plain reason, what the contract would refuse for anyone but the owner. */
async function owned(net: Network, args: CliArgs): Promise<SatchelView> {
  const view = await token(net, args.tokenId as string);
  if (view.owner_id !== args.signer) throw new Exit(1, `${view.owner_id} owns satchel #${view.token_id}, not ${args.signer}`);
  return view;
}

function done(args: CliArgs, net: Network, result: Record<string, unknown>, lines: string[]): number {
  if (args.json) out(json({ network: net.id, contract: net.contract, ...result }));
  else for (const line of lines) out(line);
  return 0;
}

async function mint(net: Network, args: CliArgs): Promise<number> {
  const { hash, value } = await submit<Token>(net, args, satchelTx(net).mint(), [
    `Mints a satchel to ${args.signer} for 0.1 NEAR.`,
    "Its address is known before it exists, but anyone can mint the next id: fund it only after this mint.",
  ]);
  if (value === null) throw new Exit(1, `mint returned no token (${nearTxUrl(net, hash)})`);
  const address = await tokenAddress(net, (await token(net, value.token_id)).path);
  return done(args, net, { tokenId: value.token_id, owner: value.owner_id, address, nearTx: hash }, [
    `Minted satchel #${value.token_id} to ${value.owner_id}: ${nearTxUrl(net, hash)}`,
    `Its address on every EVM chain: ${address}`,
  ]);
}

async function list(net: Network, args: CliArgs): Promise<number> {
  let price: bigint;
  try {
    price = parseNear(args.price as string);
  } catch (err) {
    throw new Exit(2, err instanceof Error ? err.message : String(err));
  }
  const view = await owned(net, args);
  const { hash } = await submit(net, args, satchelTx(net).list(view.token_id, price), [
    `Lists satchel #${view.token_id} for ${formatNear(price, 24)} NEAR at record version ${view.record.version}.`,
    "It can't sign anything until it is sold, delisted or transferred.",
  ]);
  return done(args, net, { tokenId: view.token_id, price: price.toString(), nearTx: hash }, [
    `Listed satchel #${view.token_id} for ${formatNear(price, 24)} NEAR: ${nearTxUrl(net, hash)}`,
  ]);
}

async function delist(net: Network, args: CliArgs): Promise<number> {
  const view = await owned(net, args);
  if (view.listing === null) throw new Exit(1, `Satchel #${view.token_id} is not listed`);
  const { hash } = await submit(net, args, satchelTx(net).delist(view.token_id), [`Takes satchel #${view.token_id} off the market.`]);
  return done(args, net, { tokenId: view.token_id, nearTx: hash }, [`Delisted satchel #${view.token_id}: ${nearTxUrl(net, hash)}`]);
}

async function transfer(net: Network, args: CliArgs): Promise<number> {
  const receiver = args.receiver as string;
  const view = await owned(net, args);
  try {
    await assertReceiver(net, receiver);
  } catch (err) {
    throw new Exit(1, err instanceof Error ? err.message : String(err));
  }
  const { hash } = await submit(net, args, satchelTx(net).transfer(view.token_id, receiver), [
    `Gives satchel #${view.token_id}, and whatever its address holds on every chain, to ${receiver}.`,
  ]);
  return done(args, net, { tokenId: view.token_id, receiver, nearTx: hash }, [
    `Sent satchel #${view.token_id} to ${receiver}: ${nearTxUrl(net, hash)}`,
  ]);
}

async function buy(net: Network, args: CliArgs): Promise<number> {
  const id = args.tokenId as string;
  const report = await buildReport(net, id);
  if (report === null) throw new Exit(1, `No satchel #${id} on ${net.contract}`);
  const listing = report.listing;
  if (listing === null) throw new Exit(1, `Satchel #${id} is not listed`);
  if (listing.seller === args.signer) throw new Exit(1, `${args.signer} is the seller`);
  if (listing.record_version !== report.recordVersion) {
    throw new Exit(1, `Satchel #${id} was listed at record version ${listing.record_version} and is now at ${report.recordVersion}; the contract refuses that sale`);
  }
  if (!args.json) printReport(net, report);
  if (report.verdict !== "clean" && !args.acceptNotClean) {
    throw new Exit(1, `Not buying: the report reads ${VERDICT[report.verdict]}. Pass --accept-not-clean to buy it anyway.`);
  }
  const price = BigInt(listing.price);
  const { hash } = await submit(net, args, satchelTx(net).buy(id, report.recordVersion, price), [
    `Buys satchel #${id} from ${listing.seller} for ${formatNear(price, 24)} NEAR.`,
    `Names record version ${report.recordVersion}, the one this report read: if anything is signed before the sale, the contract refuses it and refunds you.`,
    `The report read ${VERDICT[report.verdict]} at ${report.checkedAt}.`,
  ]);
  return done(args, net, { tokenId: id, price: listing.price, recordVersion: report.recordVersion, verdict: report.verdict, nearTx: hash }, [
    `Bought satchel #${id}: ${nearTxUrl(net, hash)}`,
  ]);
}

const STEP_NOTES: Record<SendStep, string> = {
  build: "Building the transaction and checking the balance",
  hash: "Checking the contract hashes it the same way",
  wallet: "Signing sign_evm with the near CLI",
  recover: "Checking the MPC signature recovers to the satchel's address",
  broadcast: "Broadcasting",
  confirm: "Waiting for the receipt",
};

async function send(net: Network, args: CliArgs): Promise<number> {
  const inputs = sendInputs(net, args);
  if ("error" in inputs) throw new Exit(2, inputs.error);
  const { chain, to, value, data } = inputs;

  const view = await owned(net, args);
  await assertDeployment(net);
  const from = await tokenAddress(net, view.path);
  let fee = 0n;
  let nonce = "";
  let reached: SendStep = "build";
  let evmTx = "";
  const signWithWallet = async (tx: WalletTx) => {
    nonce = (tx.actions[0].params.args.tx as { nonce: string }).nonce;
    const { hash, value: signature } = await submit<MpcSignature>(net, args, tx, [
      `Sends ${formatEther(value)} ${chain.symbol} on ${chain.name} from satchel #${view.token_id}'s address ${from}`,
      `to ${to}${data === "0x" ? "" : `, with data ${data.length > 74 ? `${data.slice(0, 74)}…` : data}`}; fees up to ${formatEther(fee)} ${chain.symbol}.`,
      `The contract records nonce ${nonce} on ${chain.name}, then ${net.mpc} signs. Once signed, anyone can broadcast it.`,
    ]);
    return { hash, signature };
  };
  const result = await sendFromSatchel(
    { net, tokenId: view.token_id, from, chain, to, value, data },
    liveSendDeps(net, signWithWallet),
    (step, detail) => {
      reached = step;
      if (step === "wallet" && detail) fee = BigInt(detail);
      if ((step === "broadcast" || step === "confirm") && detail) evmTx = detail;
      note(`${STEP_NOTES[step]}${(step === "broadcast" || step === "confirm") && detail ? ` ${detail}` : ""}…`);
    },
  ).catch((err: unknown) => {
    if (err instanceof Exit) throw err;
    const message = err instanceof Error ? err.message : String(err);
    // Once broadcast, the transaction may be on its way: sending again could pay twice.
    if (reached === "broadcast" || reached === "confirm") {
      throw new Exit(
        3,
        `Broadcast ${evmTx} on ${chain.name}, but ${message}. Check ${chain.explorer}/tx/${evmTx} before you send again: the signature for nonce ${nonce} is public, so anyone can broadcast it until that nonce is spent.`,
        { status: "unknown", chainId: chain.id, evmTx, nonce },
      );
    }
    throw new Exit(1, message);
  });
  const evmUrl = `${chain.explorer}/tx/${result.evmTx}`;
  done(args, net, { tokenId: view.token_id, chainId: chain.id, from, to, value: value.toString(), ...result }, [
    `${result.status === "success" ? "Sent" : "Reverted:"} ${formatEther(value)} ${chain.symbol} on ${chain.name} from satchel #${view.token_id}: ${evmUrl}`,
    `Signed in ${nearTxUrl(net, result.nearTx)}`,
  ]);
  return result.status === "success" ? 0 : 1;
}

// ---- Main -------------------------------------------------------------------------------------

const COMMANDS = { verify, show, record, market, mint, list, delist, buy, transfer, send } as const;

async function main(argv: string[]): Promise<number> {
  const parsed = parseCli(argv);
  if (parsed.kind === "help") {
    out(USAGE);
    return 0;
  }
  if (parsed.kind === "version") {
    out((createRequire(import.meta.url)("../package.json") as { version: string }).version);
    return 0;
  }
  if (parsed.kind === "error") {
    if (argv.includes("--json")) out(json({ error: parsed.message }));
    else note(`${parsed.message}\n\nsatchel-nft --help lists the commands and options.`);
    return 2;
  }
  const { args } = parsed;
  const net = NETWORKS[args.network];
  applyRpcOverrides();
  // An RPC for the other network would answer every read, about the wrong chain.
  const chain = await nearChainId(net);
  if (chain !== net.id) throw new Exit(2, `${nearRpcUrl(net)} serves NEAR ${chain}, not ${net.id}`);
  return COMMANDS[args.command](net, args);
}

// Exit codes go through process.exitCode: process.exit() with fetches still open aborts on Windows.
const jsonMode = process.argv.includes("--json");
main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    if (jsonMode) out(json({ error: message, ...(err instanceof Exit ? err.extra : {}) }));
    else note(message);
    process.exitCode = err instanceof Exit ? err.code : 2;
  },
);
