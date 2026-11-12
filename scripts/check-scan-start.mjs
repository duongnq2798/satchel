// Checks where the satchel page's Received card starts reading each chain's logs
// (web/src/lib/received.ts). On NEAR: each network's Satchel contract account doesn't exist at the
// block before CREATED's block and does at it, and that block's time is CREATED's. On each chain,
// from the node the card reads that chain's logs from: SCANS's start block is the first whose
// timestamp is at or after that second, so its own timestamp is and the previous block's isn't;
// `first` is a Transfer of the chain's tokens in the block it names, and the node has none of
// them from the start block to the block before. Every chain with tokens is in SCANS or
// NOT_SCANNED. It reads received.ts as text, as check-claims.mjs reads config.ts, and the chains
// from the built package, so build it first. Node 22 or later, no wallet, no key.
// Usage: npm run build -w satchel-nft && node scripts/check-scan-start.mjs
import { readFileSync } from "node:fs";

const { CHAINS, NEAR_ARCHIVAL_RPC, NETWORKS, TOKENS } = await import("../packages/satchel-nft/dist/index.js");

const source = readFileSync(new URL("../web/src/lib/received.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const block = (name) => source.match(new RegExp(`export const ${name}\\b[^=]*= \\{\\n([\\s\\S]*?)\\n\\};`))?.[1] ?? "";
const CREATED = Object.fromEntries(
  [...block("CREATED").matchAll(/^\s*(testnet|mainnet): \{ tx: "(\w+)", nearBlock: (\d+), at: "([^"]+)" \},$/gm)].map(
    ([, net, tx, height, at]) => [net, { tx, nearBlock: Number(height), at }],
  ),
);
const SCANS = [
  ...block("SCANS").matchAll(
    /^\s*(\d+): \{ start: (\d+)n, span: (\d+)n, first: \{ block: (\d+)n, tx: "(0x[0-9a-f]{64})" \}(?:, rpc: "([^"]+)")? \},$/gm,
  ),
].map(([, id, start, span, first, tx, rpc]) => ({ id: Number(id), start: BigInt(start), span: BigInt(span), first: { block: BigInt(first), tx }, rpc }));
const NOT_SCANNED = [...block("NOT_SCANNED").matchAll(/^\s*(\d+): "[^"]+",$/gm)].map(([, id]) => Number(id));
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A JSON-RPC read. One a node answers with HTTP 408, 429 or 5xx, or that gets no answer, is sent up
 * to 3 more times, 1, 2 and 4 s apart: FastNEAR's archival node rate-limits.
 */
async function rpc(url, method, params) {
  for (let tries = 1; ; tries++) {
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      if (tries >= 4) throw new Error(`${method}: no answer (${err.message})`);
      await wait(1_000 * 2 ** (tries - 1));
      continue;
    }
    if ((res.status === 408 || res.status === 429 || res.status >= 500) && tries < 4) {
      await res.body?.cancel().catch(() => {});
      await wait(1_000 * 2 ** (tries - 1));
      continue;
    }
    const body = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
    if (body.error) throw Object.assign(new Error(`${method}: ${body.error.message}`), { cause: body.error });
    return body.result;
  }
}

/** Whether `account` exists at NEAR block `height`; false only when the node says it doesn't. */
async function exists(net, account, height) {
  try {
    await rpc(NEAR_ARCHIVAL_RPC[net], "query", { request_type: "view_account", account_id: account, block_id: height });
    return true;
  } catch (err) {
    if (err.cause?.cause?.name === "UNKNOWN_ACCOUNT") return false;
    throw err;
  }
}

const rows = [];

for (const net of ["testnet", "mainnet"]) {
  const created = CREATED[net];
  const contract = NETWORKS[net].contract;
  const where = `NEAR ${net} ${contract}`;
  if (!created) {
    rows.push({ ok: false, line: `FAIL  ${where}  received.ts has no CREATED.${net} this script can read` });
    continue;
  }
  try {
    const before = await exists(net, contract, created.nearBlock - 1);
    const at = await exists(net, contract, created.nearBlock);
    const header = (await rpc(NEAR_ARCHIVAL_RPC[net], "block", { block_id: created.nearBlock })).header;
    const time = new Date(Number(BigInt(header.timestamp_nanosec) / 1_000_000n)).toISOString();
    const wrong = [
      before && `it already exists at block ${created.nearBlock - 1}`,
      !at && `it doesn't exist at block ${created.nearBlock}`,
      time !== created.at && `block ${created.nearBlock} is at ${time}, received.ts says ${created.at}`,
    ].filter(Boolean);
    rows.push({
      ok: wrong.length === 0,
      line: `${wrong.length ? "FAIL" : "ok  "}  ${where}  ${wrong.join("; ") || `created at block ${created.nearBlock}, ${time}`}`,
    });
  } catch (err) {
    rows.push({ ok: false, line: `FAIL  ${where}  ${err.message}` });
  }
}

// Every chain contents.ts lists tokens on is in SCANS or NOT_SCANNED, and no other chain is.
for (const chain of CHAINS) {
  const listed = (TOKENS[chain.id] ?? []).length > 0;
  const scanned = SCANS.some((s) => s.id === chain.id);
  const said = NOT_SCANNED.includes(chain.id);
  if (listed !== (scanned || said) || (scanned && said)) {
    const why = !listed
      ? "is in SCANS or NOT_SCANNED but has no tokens"
      : scanned && said
        ? "is in both SCANS and NOT_SCANNED"
        : "has tokens but is in neither SCANS nor NOT_SCANNED";
    rows.push({ ok: false, line: `FAIL  ${chain.name}  ${why}` });
  }
}
for (const s of SCANS.filter((s) => !CHAINS.some((c) => c.id === s.id))) {
  rows.push({ ok: false, line: `FAIL  chain ${s.id}  is in SCANS but not a chain the package knows` });
}

const hex = (n) => `0x${n.toString(16)}`;
const timestamp = async (url, n) => BigInt((await rpc(url, "eth_getBlockByNumber", [hex(n), false])).timestamp);

/** Every Transfer log of `tokens`, from anyone to anyone, in blocks [from, to], read `span` blocks at a time. */
async function transfers(url, tokens, from, to, span) {
  const logs = [];
  for (let a = from; a <= to; a += span) {
    const b = a + span - 1n < to ? a + span - 1n : to;
    logs.push(...(await rpc(url, "eth_getLogs", [{ address: tokens, topics: [TRANSFER], fromBlock: hex(a), toBlock: hex(b) }])));
  }
  return logs;
}

rows.push(
  ...(await Promise.all(
    SCANS.filter((s) => CHAINS.some((c) => c.id === s.id)).map(async (s) => {
      const chain = CHAINS.find((c) => c.id === s.id);
      const net = chain.testnet ? "testnet" : "mainnet";
      const url = s.rpc ?? chain.rpc;
      const where = `${chain.name} block ${s.start} (${new URL(url).host})`;
      const created = CREATED[net];
      if (!created) return { ok: false, line: `FAIL  ${where}  no creation time for ${net}` };
      const second = BigInt(Math.floor(Date.parse(created.at) / 1000));
      try {
        const id = Number(BigInt(await rpc(url, "eth_chainId", [])));
        const [own, previous] = await Promise.all([timestamp(url, s.start), timestamp(url, s.start - 1n)]);
        const tokens = TOKENS[chain.id].map((t) => t.address);
        const [inFirst, before] = await Promise.all([
          transfers(url, tokens, s.first.block, s.first.block, 1n),
          transfers(url, tokens, s.start, s.first.block - 1n, s.span),
        ]);
        const first = inFirst.find((l) => l.transactionHash.toLowerCase() === s.first.tx);
        const wrong = [
          id !== chain.id && `the node serves chain ${id}`,
          own < second && `its timestamp, ${own}, is before ${second}`,
          previous >= second && `block ${s.start - 1n}'s timestamp, ${previous}, isn't before ${second}: the start is later than it should be`,
          s.first.block < s.start && `first, block ${s.first.block}, is before the start`,
          (!first || first.topics.length !== 3) && `the node has no ERC-20 Transfer ${s.first.tx} in block ${s.first.block}`,
          before.length > 0 && `the node has ${before.length} Transfer(s) before first, the earliest in block ${BigInt(before[0].blockNumber)}`,
        ].filter(Boolean);
        const fine = `at ${own}, the block before at ${previous}; ${net}'s contract was created at ${second}; first Transfer in block ${s.first.block}`;
        return { ok: wrong.length === 0, line: `${wrong.length ? "FAIL" : "ok  "}  ${where}  ${wrong.join("; ") || fine}` };
      } catch (err) {
        return { ok: false, line: `FAIL  ${where}  ${err.message}` };
      }
    }),
  )),
);

for (const row of rows) console.log(row.line);
const failed = rows.filter((r) => !r.ok).length;
console.log(
  failed
    ? `\n${failed} of ${rows.length} checks failed.`
    : `\nAll ${rows.length} checks pass: both creation times, and ${SCANS.length} start blocks with their first Transfers.`,
);
process.exit(failed ? 1 : 0);
