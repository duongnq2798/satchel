import { type Address, type Hex, type PublicClient, createPublicClient, formatUnits, getAddress, http, toHex, zeroAddress } from "viem";
import {
  CHAINS,
  type ChainContents,
  type ChainInfo,
  type Network,
  type NetworkId,
  type SigningRecord,
  TOKENS,
  type TokenInfo,
  chainInfo,
  limiter,
  sendChains,
} from "satchel-nft";

/*
 * What came into a satchel's address: the ERC-20 Transfer events to it, for the USDC, USDT and WETH
 * contents.ts lists, read now from each chain's logs. For display: the report, the fix plan, the
 * deployment guard and the record checks read none of it, and nothing here signs or sends. A plain
 * send of a chain's coin (ETH, POL, BNB, AVAX) logs no event, so it isn't here; the balance shows
 * it. Nor is WETH the satchel wrapped from its own ETH where the WETH contract is WETH9, as on
 * Ethereum, Base and OP Mainnet: it logs a Deposit, not a Transfer, and the wrap took a signature
 * the record counts. Other tokens aren't read: anyone can send any token to any address, spam
 * included.
 */

/** keccak256("Transfer(address,address,uint256)"): an ERC-20 Transfer's first topic. */
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/**
 * When each network's Satchel contract account was created: the NEAR block that ran its
 * CreateAccount receipt (view_account answers "unknown account" at the block before it) and that
 * block's time, read from FastNEAR's archival RPC on 2026-11-12. Mainnet's is the receipt of
 * deployments/mainnet.json's contract_create_tx; testnet's file names no creation, so its
 * transaction is the contract's oldest in FastNEAR's index. Anyone could work out a satchel's
 * address before then, but no satchel existed to own it, so nothing sent there earlier was sent to
 * a satchel. A token's mint would be no tighter bound: an address is fixed by its id before the
 * token exists, and mainnet satchel #1's was funded before its mint.
 * `node scripts/check-scan-start.mjs` reads these back from NEAR.
 */
export const CREATED: Readonly<Record<NetworkId, { tx: string; nearBlock: number; at: string }>> = {
  testnet: { tx: "Byt9sR7RYo71BufyZxELduyP3htHmoaJhiWuKPDn22vt", nearBlock: 276855267, at: "2026-11-09T01:38:18.636Z" },
  mainnet: { tx: "BFGbXYUnLJQ7ZbGYde467Uzn481zXF4ymmz1MR3tWg1k", nearBlock: 223741631, at: "2026-11-09T08:24:04.262Z" },
};

/** Where one chain's logs are read from, and how. */
export interface ScanSource {
  /** The first block whose timestamp is at or after the second the network's contract was created. */
  start: bigint;
  /** The most blocks one eth_getLogs may span on the node, both ends counted. */
  span: bigint;
  /** The first Transfer of the chain's tokens, from anyone to anyone, at or after `start`. */
  first: { block: bigint; tx: Hex };
  /** The node, where config.ts's can't read these logs. */
  rpc?: string;
}

/**
 * Each chain with tokens in contents.ts but those in NOT_SCANNED. BNB testnet and Aurora testnet
 * have none there, so nothing is read on them.
 *
 * `start`: for each network's creation second (CREATED), a search back from the latest block with
 * eth_getBlockByNumber, on 2026-11-12, for the first block whose timestamp is at or after it.
 *
 * `first`: found on the chain's node, and found the same on a second node, with none before it. A
 * node can answer an old range with no logs instead of an error: on 2026-11-12 rpc.flashbots.net
 * returned no USDC Transfer for 3 blocks at Ethereum's start block, where rpc.mevblocker.io
 * returned 1,099, and bsc-rpc.publicnode.com none for 3 blocks at BNB Chain's, where three other
 * nodes returned 169. So a scan first asks its node for `first`, and a node that doesn't return it
 * leaves the chain unread. A node that drops old logs drops the oldest first, so one that still has
 * `first` has the logs after it, unless it lost some in between, which this can't see; before
 * `first` there is nothing to miss.
 *
 * `span` and `rpc`, measured on 2026-11-12 with eth_getLogs filtered as the scan filters it (the
 * chain's tokens, the Transfer topic, mainnet satchel #2's address), over the latest blocks and from
 * the start block:
 * - arb1.arbitrum.io and sepolia-rollup.arbitrum.io answered 100,000 blocks and refused 100,001.
 * - publicnode.com's nodes for Base, Base Sepolia, Avalanche and Avalanche Fuji refused 100,000
 *   ("exceed maximum block range: 50000"), and its Polygon node 20,000 ("exceed maximum block range:
 *   10000"). Its Base node answers logs from block 51,000,000 on, its Base Sepolia node from
 *   46,500,000, and its Polygon node for the latest 2,300,000 blocks only, a window that passes
 *   Polygon's start block about 40 days after 2026-11-12.
 * - mainnet.optimism.io refused 20,000 ("eth_getLogs is limited to a 10,000 range").
 * - mainnet.aurora.dev answered 2,000,000 blocks, the span used; nothing larger was tried.
 * - gateway.tenderly.co answered 5,000,000 blocks on Ethereum, Sepolia, OP Sepolia and Polygon Amoy
 *   (1,000,000 is used), and 429 to some of 12 reads sent at once. On these chains config.ts's nodes
 *   don't do: ethereum-rpc.publicnode.com refused reads a few thousand blocks back ("Archive requests
 *   require a personal token"), ethereum-sepolia-rpc.publicnode.com and
 *   optimism-sepolia-rpc.publicnode.com answered "pruned history unavailable" at the start block,
 *   and polygon-amoy-bor-rpc.publicnode.com answered "no available nodes found" all day.
 * - Other free Ethereum nodes, with no key, did worse: rpc.flashbots.net as above;
 *   rpc.mevblocker.io answered "service temporarily unavailable" to about a third of the reads;
 *   eth.drpc.org refused every read ("not supported on free plan"); 1rpc.io, nodies.app,
 *   eth.blockrazor.xyz, blastapi.io and tatum.io allow 10 to 100 blocks a read;
 *   ethereum-rpc.polkachu.com sends no CORS header, so a browser can't read it.
 * Each node used sends Access-Control-Allow-Origin, so a browser can read it. A node may change its
 * limits or drop older blocks later: a read it refuses shows on the page as blocks not read.
 * `node scripts/check-scan-start.mjs` reads each start block's timestamp and the block before's,
 * and each `first` from the node, with nothing before it.
 *
 * The start is fixed and nothing is kept between visits, so every scan reads from it again, and a
 * chain's reads grow with its blocks. Measured from the start blocks on 2026-11-12: Base and Base
 * Sepolia make a block every 0.2 s, 8.6 reads of 50,000 blocks more a day; Polygon 1.5 s, 5.8 reads
 * of 10,000; OP Mainnet 2 s, 4.3; Arbitrum One and Arbitrum Sepolia about 0.28 s, 3 to 3.2; Avalanche
 * and Avalanche Fuji 1 s and 1.6 s, 1.8 and 1.1; the chains read 1,000,000 or 2,000,000 blocks at a
 * time well under 1. A scan on every mainnet chain, for a raw signature, so adds about 24 reads a
 * day, and Base's 30 on 2026-11-12 come to about 290 thirty days later. A node with a larger span
 * on Base, or a scan kept in the browser between visits, would cut that; neither is built.
 */
export const SCANS: Readonly<Record<number, ScanSource>> = {
  1: { start: 26376116n, span: 1000000n, first: { block: 26376116n, tx: "0xb9a9d06f461ee79f66274368ee3cac4ca64d1011e469915d7c20dba90dca4854" }, rpc: "https://gateway.tenderly.co/public/mainnet" },
  11155111: { start: 12094298n, span: 1000000n, first: { block: 12094298n, tx: "0x5d12d89699681aac3f942162a954db9421789e427ca5180aaa9c16c9e3b263e2" }, rpc: "https://gateway.tenderly.co/public/sepolia" },
  8453: { start: 55111342n, span: 50000n, first: { block: 55111342n, tx: "0x33937fc8364a6dadae6c37173656aa58173ac8573bdc438acea49bbdf7991fb7" } },
  84532: { start: 56332146n, span: 50000n, first: { block: 56332147n, tx: "0x6270736f6e5286075fab893a7d7548abe68a5cfaac9b8010880b6da43d9a9454" } },
  42161: { start: 522620115n, span: 100000n, first: { block: 522620116n, tx: "0x79ed14fdc10f12d796095fa19a1c6ff7ceece7d4a2343181f140bb3d016bdd93" } },
  421614: { start: 327411701n, span: 100000n, first: { block: 327411739n, tx: "0xbcd4d903b2c50577a3e9fbb6eca4f39ff05a564a7669a7d6774e0793260ee215" } },
  10: { start: 159306934n, span: 10000n, first: { block: 159306934n, tx: "0x67c1dfb885ae34224912a6e50fd08850db7bd2a55d8174025dfbd843581d2fb1" } },
  11155420: { start: 51192879n, span: 1000000n, first: { block: 51192881n, tx: "0xece190ffc324ac44f3394f3c1f9eff3c30e9583b96ec397c43bc06b387547e4b" }, rpc: "https://gateway.tenderly.co/public/optimism-sepolia" },
  137: { start: 97004792n, span: 10000n, first: { block: 97004792n, tx: "0x51c29f42f95ce46431372ecf5fea3e7434a38daaebade7a7bd26b7d0a23ac394" } },
  80002: { start: 52365680n, span: 1000000n, first: { block: 52365693n, tx: "0xd5a0deb640a5d22b988069932a05bfe327964ed059540d975b0e97e38a3bb692" }, rpc: "https://gateway.tenderly.co/public/polygon-amoy" },
  43114: { start: 99834556n, span: 50000n, first: { block: 99834556n, tx: "0xc077c997cc78bb391ba5b072346018c0e945cc1419511e42b4b47ffeef6f4d91" } },
  43113: { start: 60758495n, span: 50000n, first: { block: 60758602n, tx: "0x05497527f66368fcb30dcf1b719d51b428e01a13faca613cd81aafba23bcff02" } },
  1313161554: { start: 223741631n, span: 2000000n, first: { block: 223744155n, tx: "0x0bccc2eb4554533dfcd02850c6a96f7adc8df27e94e5116f1a59d0d38cdd66cb" } },
};

/**
 * Chains with tokens in contents.ts that the card doesn't scan, and why, as the page says it.
 * BNB Chain, on 2026-11-12: its start block is 132,551,984, found as the others were, but
 * bsc-rpc.publicnode.com answered no logs for blocks more than about a day old (none for 3 blocks at
 * the start block, where rpc-bsc.48.club, 56.rpc.thirdweb.com and bsc.blockrazor.xyz each returned
 * 169); rpc-bsc.48.club answered correctly but 5,000 blocks a read, and took 530 s for the 128 reads
 * from the start block; the other free nodes tried allow 25 to 1,000 blocks a read, refuse
 * eth_getLogs, or want a key.
 */
export const NOT_SCANNED: Readonly<Record<number, string>> = {
  56: "no free node tried on 2026-11-12 read its logs back to the contract's creation both correctly and in reasonable time",
};

/** [from, to] in spans of at most `span` blocks, both ends counted; the last one may be shorter. */
export function chunks(from: bigint, to: bigint, span: bigint): [bigint, bigint][] {
  if (span < 1n) throw new Error(`can't read logs ${span} blocks at a time`);
  const out: [bigint, bigint][] = [];
  for (let start = from; start <= to; start += span) {
    const end = start + span - 1n;
    out.push([start, end < to ? end : to]);
  }
  return out;
}

/** A log as eth_getLogs returns it, with only the fields read here. */
export interface RawLog {
  address: string;
  topics: readonly string[];
  data: string;
  blockNumber: string | null;
  transactionHash: string | null;
  logIndex: string | null;
  removed?: boolean;
}

/** One ERC-20 Transfer into a satchel's address. */
export interface Transfer {
  chain: ChainInfo;
  token: TokenInfo;
  from: Address;
  amount: bigint;
  tx: Hex;
  block: bigint;
  logIndex: number;
}

/** `address` as a 32-byte topic: twelve zero bytes, then its twenty. */
export const addressTopic = (address: Address): Hex => `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`;

const WORD = /^0x[0-9a-f]{64}$/;
const QUANTITY = /^0x[0-9a-f]{1,16}$/;

/**
 * The transfer one log records, if it is an ERC-20 Transfer to `to` by one of the chain's tokens in
 * contents.ts; null for anything else. The node chose the logs, so each one is checked again here,
 * in any letter case: the token, the event, the recipient, three topics (an ERC-721 Transfer has
 * four), a 32-byte amount. A log the node marks removed, from a block a reorganization dropped, is
 * left out. So is a transfer of 0: anyone can log one to any address, which is how a look-alike
 * address gets into a wallet's history.
 */
export function transferIn(chain: ChainInfo, log: RawLog, to: Address): Transfer | null {
  if (log.removed === true || log.topics.length !== 3) return null;
  const token = (TOKENS[chain.id] ?? []).find((t) => t.address.toLowerCase() === log.address.toLowerCase());
  const [event, sender, recipient] = log.topics.map((t) => t.toLowerCase());
  const [data, block, index, tx] = [log.data, log.blockNumber, log.logIndex, log.transactionHash].map((v) => (v ?? "").toLowerCase());
  if (!token || event !== TRANSFER_TOPIC || recipient !== addressTopic(to)) return null;
  if (!WORD.test(sender) || !sender.startsWith(`0x${"0".repeat(24)}`) || !WORD.test(data) || !WORD.test(tx)) return null;
  if (!QUANTITY.test(block) || !QUANTITY.test(index)) return null;
  const amount = BigInt(data);
  if (amount === 0n) return null;
  return {
    chain,
    token,
    from: getAddress(`0x${sender.slice(26)}`),
    amount,
    tx: tx as Hex,
    block: BigInt(block),
    logIndex: Number(BigInt(index)),
  };
}

/** One of the network's chains to scan, and why. */
export interface ChainToScan {
  chain: ChainInfo;
  /** The tokens the page shows a balance above 0 for, now. */
  holds: TokenInfo[];
  /** A balance there couldn't be read. */
  unread: boolean;
  /** The signing record counts signatures for it. */
  signed: boolean;
}

export interface ScanPlan {
  scan: ChainToScan[];
  /** Chains with tokens to read that weren't scanned: none held now, none unread, nothing on the record. */
  skipped: ChainInfo[];
  /** Chains that would be scanned but can't be, with NOT_SCANNED's reason. */
  unscanned: (ChainToScan & { reason: string })[];
  /** Chains where contents.ts lists no USDC, USDT or WETH, so there is nothing to read. */
  none: ChainInfo[];
  /**
   * The record has a raw signature, which could be for any chain, so every one of the network's
   * chains with tokens to read is chosen: those in SCANS go in `scan`, the others in `unscanned`.
   */
  raw: boolean;
  /** Chain ids the record has signatures for that aren't this network's: the page reads nothing there. */
  elsewhere: string[];
}

/**
 * Which of `net`'s chains to scan: where the page shows a USDC, USDT or WETH balance above 0 now,
 * where a balance couldn't be read, and where the signing record has signatures. A token that came
 * in and left again needed the satchel's key to leave, a transfer or an approval someone then used,
 * and the record counts every signature by chain, so on any other chain none of them can have come
 * in and gone out through the satchel, unless its issuer took them, as some can. A raw signature
 * could be for any chain, so a record with one has every chain with tokens chosen, and those
 * NOT_SCANNED names are said to be unread. Signatures on a chain with no tokens to read, or on the
 * other network's chains, choose nothing: `none` and `elsewhere` name them. This bounds the reads:
 * mainnet satchel #2 scans Arbitrum One, for its USDC, and Base, for its signature.
 */
export function scanPlan(net: Network, contents: Readonly<Record<number, ChainContents | null>>, record: SigningRecord): ScanPlan {
  const raw = record.opaque_signatures > 0;
  const chains = sendChains(net);
  const signedOn = new Set(record.evm.filter((c) => c.signatures > 0).map((c) => Number(c.chain_id)));
  const plan: ScanPlan = { scan: [], skipped: [], unscanned: [], none: [], raw, elsewhere: [] };
  for (const chain of chains) {
    if ((TOKENS[chain.id] ?? []).length === 0) {
      plan.none.push(chain);
      continue;
    }
    const c = contents[chain.id];
    const holds = c?.tokens.filter((t) => t.amount !== null && t.amount > 0n).map((t) => t.token) ?? [];
    const unread = !c || c.tokens.some((t) => t.amount === null);
    const signed = signedOn.has(chain.id);
    if (!(raw || holds.length > 0 || unread || signed)) plan.skipped.push(chain);
    else if (SCANS[chain.id]) plan.scan.push({ chain, holds, unread, signed });
    else plan.unscanned.push({ chain, holds, unread, signed, reason: NOT_SCANNED[chain.id] ?? "no node is set for it" });
  }
  plan.elsewhere = record.evm
    .filter((c) => c.signatures > 0 && !chains.some((chain) => chain.id === Number(c.chain_id)))
    .map((c) => c.chain_id);
  return plan;
}

/** "a", "a and b", "a, b and c"; with "or", "a, b or c". */
export function listOf(items: readonly string[], and = "and"): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} ${and} ${items[items.length - 1]}`;
}

const KINDS: readonly TokenInfo["kind"][] = ["USDC", "USDT", "WETH"];

/**
 * The kinds of token contents.ts lists on any of `chains`, USDC, USDT, WETH in that order: on the
 * testnets USDC and WETH, since none has a USDT there, and on Avalanche Fuji USDC only.
 */
export function kindsOn(chains: readonly ChainInfo[]): TokenInfo["kind"][] {
  return KINDS.filter((kind) => chains.some((c) => (TOKENS[c.id] ?? []).some((t) => t.kind === kind)));
}

/**
 * That nothing came in on `chains`, naming on each only the tokens read there: "No USDC or WETH
 * came in on Sepolia and Base Sepolia, and no USDC on Avalanche Fuji."
 */
export function noneCameIn(chains: readonly ChainInfo[]): string {
  const groups: { kinds: string; names: string[] }[] = [];
  for (const c of chains) {
    const kinds = listOf(kindsOn([c]), "or");
    const same = groups.find((g) => g.kinds === kinds);
    if (same) same.names.push(c.name);
    else groups.push({ kinds, names: [c.name] });
  }
  const parts = groups.map((g, i) => (i === 0 ? `No ${g.kinds} came in on ${listOf(g.names)}` : `no ${g.kinds} on ${listOf(g.names)}`));
  return parts.length <= 2 ? parts.join(", and ") : `${parts.slice(0, -1).join("; ")}; and ${parts[parts.length - 1]}`;
}

/** Why a chain was scanned, in words: "it holds USDC now, and the record has signatures for it". */
export function whyScanned(c: ChainToScan): string {
  const why = [
    c.holds.length > 0 && `it holds ${listOf(c.holds.map((t) => t.symbol))} now`,
    c.unread && "a balance there couldn't be read",
    c.signed && "the record has signatures for it",
  ].filter((w): w is string => typeof w === "string");
  return why.length > 0 ? why.join(", and ") : "the record has a raw signature";
}

/** Block ranges a chain's node didn't answer for: anything sent in them isn't listed or counted. */
export interface Gap {
  from: bigint;
  to: bigint;
  error: string;
}

/** What was read on one chain. */
export interface ChainScan {
  chain: ChainInfo;
  /** The node's host. */
  source: string;
  from: bigint;
  /** The chain's latest block when the scan began; null when nothing was read. */
  to: bigint | null;
  /** eth_getLogs reads the node answered. */
  reads: number;
  gaps: Gap[];
  /** Why nothing on the chain was read: the node didn't answer, serves another chain, or is behind. */
  error: string | null;
  /** Transfers found; the newest `shown` of them are listed. */
  found: number;
  shown: number;
}

export interface Line extends Transfer {
  /** Milliseconds since the epoch, from the block; null when the block couldn't be read. */
  at: number | null;
}

/** All of one token received on one chain. */
export interface Total {
  chain: ChainInfo;
  token: TokenInfo;
  amount: bigint;
  transfers: number;
}

export interface ReceivedView {
  /** Oldest first, across the chains scanned. */
  lines: Line[];
  totals: Total[];
  chains: ChainScan[];
}

/** An eth_getLogs filter, as the node takes it. */
export interface LogFilter {
  address: Address[];
  topics: (Hex | null)[];
  fromBlock: Hex;
  toBlock: Hex;
}

/** The reads a scan sends to one chain's node. Tests pass their own. */
export interface ChainReads {
  /** The node's host. */
  source: string;
  chainId(): Promise<number>;
  latest(): Promise<bigint>;
  getLogs(filter: LogFilter): Promise<RawLog[]>;
  /** The block's timestamp, in milliseconds. */
  blockTime(block: bigint): Promise<number>;
}

const nodes = new Map<string, PublicClient>();

/**
 * `chain`'s node for these reads: SCANS's, or else config.ts's. Every read goes through viem's
 * retry, as the package's `client()` does, with two sends more here, 1 and then 2 s later, since a
 * scan sends one node dozens of reads: a 408, a 429, a 5xx or a node error is sent again, a refusal
 * such as a span over the node's limit is not. The timeout is 30 s: BNB Chain's node took 10 s for
 * one 50,000-block read on 2026-11-12.
 */
export function chainReads(chain: ChainInfo): ChainReads {
  const url = SCANS[chain.id]?.rpc ?? chain.rpc;
  let node = nodes.get(url);
  if (!node) {
    node = createPublicClient({ transport: http(url, { timeout: 30_000, retryCount: 2, retryDelay: 1_000 }) }) as PublicClient;
    nodes.set(url, node);
  }
  const c = node;
  return {
    source: new URL(url).host,
    chainId: () => c.getChainId(),
    latest: () => c.getBlockNumber(),
    getLogs: (filter) => c.request({ method: "eth_getLogs", params: [filter] }),
    // arb1.arbitrum.io's logs carry a blockTimestamp of 0x0, so the time comes from the block.
    blockTime: async (block) => Number((await c.getBlock({ blockNumber: block })).timestamp) * 1000,
  };
}

/** Transfers listed per chain at most, the newest; the totals count every one. */
export const LINES_PER_CHAIN = 50;
/** Reads at once to one chain's node. */
const AT_ONCE = 3;

/**
 * A failed read in the node's words when it gave some: viem's `details`, else its short message.
 * Its own full stop goes ("The request timed out." becomes "The request timed out"), since the
 * page puts it inside a sentence.
 */
function said(err: unknown): string {
  const e = (typeof err === "object" && err !== null ? err : {}) as { details?: unknown; shortMessage?: unknown; message?: unknown };
  const text = [e.details, e.shortMessage, e.message].find((t): t is string => typeof t === "string" && t !== "") ?? String(err);
  return text.split("\n")[0].slice(0, 200).replace(/(?<!\.)\.$/, "");
}

const byBlock = (a: Transfer, b: Transfer) => (a.block < b.block ? -1 : a.block > b.block ? 1 : a.logIndex - b.logIndex);

/**
 * Reads one chain: its Transfer logs into `to` from SCANS's start block to the latest, in chunks of
 * its span, at most AT_ONCE at a time, then the blocks of the newest LINES_PER_CHAIN, one read per
 * block. A chunk the node doesn't answer becomes a gap and the rest still count. A node that
 * doesn't answer at all, serves another chain, or doesn't return the chain's `first` Transfer, so
 * may have dropped older logs without saying so, leaves the chain unread.
 */
export async function scanChain(chain: ChainInfo, to: Address, reads: ChainReads = chainReads(chain)): Promise<{ scan: ChainScan; transfers: Transfer[]; lines: Line[] }> {
  const source = SCANS[chain.id];
  const tokens = (TOKENS[chain.id] ?? []).map((t) => t.address);
  const scan: ChainScan = { chain, source: reads.source, from: source?.start ?? 0n, to: null, reads: 0, gaps: [], error: null, found: 0, shown: 0 };
  const unread = (error: string) => ({ scan: { ...scan, error }, transfers: [], lines: [] });
  if (!source || tokens.length === 0) return unread(`${chain.name} has no USDC, USDT or WETH to read`);
  let latest: bigint;
  try {
    const id = await reads.chainId();
    if (id !== chain.id) return unread(`${reads.source} serves chain ${id}, not ${chain.id}`);
    latest = await reads.latest();
    if (latest < source.first.block) return unread(`${reads.source}'s latest block, ${latest}, is before block ${source.first.block}: it is behind`);
    const kept = await reads.getLogs({
      address: [...tokens],
      topics: [TRANSFER_TOPIC],
      fromBlock: toHex(source.first.block),
      toBlock: toHex(source.first.block),
    });
    if (!Array.isArray(kept) || !kept.some((log) => log.transactionHash?.toLowerCase() === source.first.tx)) {
      return unread(
        `${reads.source} didn't return the Transfer in block ${source.first.block} (${source.first.tx.slice(0, 10)}…), so it may not keep ${chain.name}'s logs back to the start`,
      );
    }
  } catch (err) {
    return unread(said(err));
  }
  scan.to = latest;

  const limit = limiter(AT_ONCE);
  const topics: (Hex | null)[] = [TRANSFER_TOPIC, null, addressTopic(to)];
  const found = new Map<string, Transfer>();
  await Promise.all(
    chunks(source.start, latest, source.span).map(([from, end]) =>
      limit(async () => {
        try {
          const logs = await reads.getLogs({ address: [...tokens], topics, fromBlock: toHex(from), toBlock: toHex(end) });
          if (!Array.isArray(logs)) throw new Error(`${reads.source} didn't answer with a list of logs`);
          scan.reads++;
          for (const log of logs) {
            const t = transferIn(chain, log, to);
            // A log outside the blocks asked for is left out; the read for its own blocks has it.
            if (t && t.block >= from && t.block <= end) found.set(`${t.tx}:${t.logIndex}`, t);
          }
        } catch (err) {
          scan.gaps.push({ from, to: end, error: said(err) });
        }
      }),
    ),
  );
  scan.gaps.sort((a, b) => (a.from < b.from ? -1 : 1));

  const transfers = [...found.values()].sort(byBlock);
  const newest = transfers.slice(-LINES_PER_CHAIN);
  const blocks = [...new Set(newest.map((t) => t.block))];
  const times = new Map(
    await Promise.all(
      blocks.map((block) =>
        limit(() =>
          reads.blockTime(block).then(
            (ms) => [block, ms > 0 && ms <= 8.64e15 ? ms : null] as const,
            () => [block, null] as const,
          ),
        ),
      ),
    ),
  );
  scan.found = transfers.length;
  scan.shown = newest.length;
  return { scan, transfers, lines: newest.map((t) => ({ ...t, at: times.get(t.block) ?? null })) };
}

/** Each token's total on each chain, in CHAINS's order, then contents.ts's. */
export function totalsOf(transfers: readonly Transfer[]): Total[] {
  const totals: Total[] = [];
  for (const chain of CHAINS) {
    for (const token of TOKENS[chain.id] ?? []) {
      const of = transfers.filter((t) => t.chain.id === chain.id && t.token.address === token.address);
      if (of.length > 0) totals.push({ chain, token, amount: of.reduce((sum, t) => sum + t.amount, 0n), transfers: of.length });
    }
  }
  return totals;
}

const order = (chain: ChainInfo) => CHAINS.findIndex((c) => c.id === chain.id);

/** Oldest first; a line whose block couldn't be read goes after the dated ones. */
function byTime(a: Line, b: Line): number {
  if (a.at !== b.at) return a.at === null ? 1 : b.at === null ? -1 : a.at - b.at;
  return order(a.chain) - order(b.chain) || byBlock(a, b);
}

type Scanned = Awaited<ReturnType<typeof scanChain>>;

/** The chains scanned so far, in CHAINS's order, with their lines in one list and their totals. */
function viewOf(scanned: readonly Scanned[]): ReceivedView {
  return {
    lines: scanned.flatMap((s) => s.lines).sort(byTime),
    totals: totalsOf(scanned.flatMap((s) => s.transfers)),
    chains: scanned.map((s) => s.scan).sort((a, b) => order(a.chain) - order(b.chain)),
  };
}

/**
 * Scans the plan's chains at once, each from its own node, and puts their lines in one list.
 * `onChain`, each time a chain is done, gets the view of the chains done so far, so a slow node
 * holds back only its own chain's lines: one read can take 93 s before it fails (a 30 s timeout,
 * sent three times, 1 and 2 s apart), longer when a 429 names a later time to come back.
 */
export async function receivedOn(
  plan: ScanPlan,
  to: Address,
  readsFor: (chain: ChainInfo) => ChainReads = chainReads,
  onChain?: (sofar: ReceivedView) => void,
): Promise<ReceivedView> {
  const done: Scanned[] = [];
  await Promise.all(
    plan.scan.map(({ chain }) =>
      scanChain(chain, to, readsFor(chain)).then((s) => {
        done.push(s);
        onChain?.(viewOf(done));
      }),
    ),
  );
  return viewOf(done);
}

/** An amount with every decimal its token has, and the symbol contents.ts gives it: "5.280549 USDC". */
export function amountText(amount: bigint, token: TokenInfo): string {
  return `${formatUnits(amount, token.decimals)} ${token.symbol}`;
}

/**
 * One line: "5.280549 USDC on Arbitrum One from 0x2CfF890f0378a11913B6129B2E97417a2c302680", the
 * sender in full. A transfer from the zero address is a mint.
 */
export function describeTransfer(t: Transfer): string {
  return `${amountText(t.amount, t.token)} on ${t.chain.name} ${t.from === zeroAddress ? "minted to it" : `from ${t.from}`}`;
}

export function transferUrl(t: Transfer): string {
  return `${t.chain.explorer}/tx/${t.tx}`;
}

/** A chain id the record gives, by name when the app knows it. */
export function chainName(id: string): string {
  return chainInfo(Number(id))?.name ?? `chain ${id}`;
}
