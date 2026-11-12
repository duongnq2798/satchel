import { describe, expect, it } from "vitest";
import { type Address, zeroAddress } from "viem";
import { CHAINS, type ChainContents, type ChainInfo, MAINNET, type Network, type SigningRecord, TESTNET, TOKENS, type TokenInfo, chainInfo, sendChains } from "satchel-nft";
import payout from "./__fixtures__/received-logs-2.json" with { type: "json" };
import {
  CREATED,
  type ChainReads,
  LINES_PER_CHAIN,
  type LogFilter,
  NOT_SCANNED,
  type RawLog,
  SCANS,
  TRANSFER_TOPIC,
  type Transfer,
  addressTopic,
  amountText,
  chainName,
  chainReads,
  chunks,
  describeTransfer,
  kindsOn,
  listOf,
  noneCameIn,
  receivedOn,
  scanChain,
  scanPlan,
  totalsOf,
  transferIn,
  transferUrl,
  whyScanned,
} from "./received";

// eth_getLogs as arb1.arbitrum.io answered it on 2026-11-12 for mainnet satchel #2's address, Arbitrum
// One's three tokens and blocks 523,120,115 to 523,220,114, the scan's sixth read there: one log, the
// USDC 1Click paid out from the swap in deployments/mainnet-1click-exit.json.
const SATCHEL_2: Address = "0xf5383275EFedde8B90F59de8E8D15b1E23B4965f";
const PAYOUT = "0x417322bdacc90439ada251ab53ca96117f4c5dcda5ad9671636b2dcd45243209";
const SOLVER: Address = "0x2CfF890f0378a11913B6129B2E97417a2c302680";
const LOG = payout[0] as RawLog;

const chain = (id: number): ChainInfo => {
  const found = chainInfo(id);
  if (!found) throw new Error(`no chain ${id}`);
  return found;
};
const token = (id: number, kind: TokenInfo["kind"]): TokenInfo => {
  const found = TOKENS[id]?.find((t) => t.kind === kind);
  if (!found) throw new Error(`no ${kind} on ${id}`);
  return found;
};
const ARBITRUM = chain(42161);
const BASE = chain(8453);
const word = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}`;
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;

/** A Transfer log of `amount` of `t` to `to`, in `block`. */
function log(t: TokenInfo, amount: bigint, block: bigint, index = 0, to: Address = SATCHEL_2, from: Address = SOLVER): RawLog {
  return {
    address: t.address,
    topics: [TRANSFER_TOPIC, addressTopic(from), addressTopic(to)],
    data: word(amount),
    blockNumber: `0x${block.toString(16)}`,
    transactionHash: hash(Number(block) * 100 + index),
    logIndex: `0x${index.toString(16)}`,
    removed: false,
  };
}

const NO_RECORD: SigningRecord = {
  evm: [],
  approvals: [],
  approvals_not_itemized: 0,
  unclassified_calls: 0,
  opaque_signatures: 0,
  last_opaque_at: "0",
  version: "0",
};
const signedOn = (...ids: number[]): SigningRecord => ({ ...NO_RECORD, evm: ids.map((id) => ({ chain_id: String(id), max_nonce: "0", signatures: 1 })) });

/**
 * What the page read on each of `net`'s chains: every token at 0 but those `held` names, and `null`
 * for a chain in `down`, whose node didn't answer.
 */
function contentsOf(net: Network, held: Record<number, Partial<Record<TokenInfo["kind"], bigint | null>>> = {}, down: number[] = []) {
  const found: Record<number, ChainContents | null> = {};
  for (const c of sendChains(net)) {
    const on = held[c.id] ?? {};
    found[c.id] = down.includes(c.id)
      ? null
      : { chain: c, native: 0n, tokens: (TOKENS[c.id] ?? []).map((t) => ({ token: t, amount: t.kind in on ? (on[t.kind] as bigint | null) : 0n })) };
  }
  return found;
}

/** SCANS's `first` Transfer on `c`, as a node returns it when asked for every Transfer in its block. */
const firstOf = (c: ChainInfo): RawLog => {
  const { block, tx } = SCANS[c.id].first;
  return { ...log((TOKENS[c.id] ?? [])[0], 1n, block, 0, SOLVER, SATCHEL_2), transactionHash: tx };
};

/**
 * A node for `chain` that answers from `logs`, by the blocks each read asks for, with `latest` as its
 * latest block and block n at second n + `shift`. Asked for every Transfer in SCANS's `first`
 * block, it answers `kept`, by default that Transfer. `refuse` names the reads it fails, `noTime`
 * the blocks it can't date. It counts the reads of the scan it gets, and the most at once.
 */
function node(
  c: ChainInfo,
  latest: bigint,
  logs: RawLog[],
  opts: { refuse?: (from: bigint) => unknown; noTime?: bigint[]; id?: number; shift?: bigint; kept?: RawLog[] } = {},
) {
  const asked: LogFilter[] = [];
  const dated: bigint[] = [];
  let open = 0;
  let most = 0;
  const busy = async <T>(read: () => T): Promise<T> => {
    open++;
    most = Math.max(most, open);
    await new Promise((resolve) => setTimeout(resolve, 1));
    open--;
    return read();
  };
  const reads: ChainReads = {
    source: "node.test",
    chainId: async () => opts.id ?? c.id,
    latest: async () => latest,
    getLogs: (filter) =>
      busy(() => {
        if (filter.topics.length === 1) return opts.kept ?? [firstOf(c)];
        asked.push(filter);
        const [from, to] = [BigInt(filter.fromBlock), BigInt(filter.toBlock)];
        const refused = opts.refuse?.(from);
        if (refused) throw refused;
        return logs.filter((l) => l.blockNumber && BigInt(l.blockNumber) >= from && BigInt(l.blockNumber) <= to);
      }),
    blockTime: (block) =>
      busy(() => {
        dated.push(block);
        if (opts.noTime?.includes(block)) throw new Error("no such block");
        return Number(block + (opts.shift ?? 0n)) * 1000;
      }),
  };
  return { reads, asked, dated, most: () => most };
}

describe("SCANS", () => {
  it("covers every chain contents.ts lists tokens on, but BNB Chain, which it says why it doesn't", () => {
    for (const c of CHAINS) expect(c.id in SCANS || c.id in NOT_SCANNED, c.name).toBe((TOKENS[c.id] ?? []).length > 0);
    expect(Object.keys(NOT_SCANNED)).toEqual(["56"]);
    for (const s of Object.values(SCANS)) {
      expect(s.start > 0n && s.span > 0n && s.first.block >= s.start).toBe(true);
      expect(s.first.tx).toMatch(/^0x[0-9a-f]{64}$/);
    }
  });

  it("starts both networks on the day their contracts were created", () => {
    expect(CREATED.mainnet.at).toBe("2026-11-09T08:24:04.262Z");
    expect(CREATED.testnet.at).toBe("2026-11-09T01:38:18.636Z");
  });

  it("reads Ethereum, Sepolia, OP Sepolia and Polygon Amoy from a node that keeps their older logs", () => {
    for (const id of [1, 11155111, 11155420, 80002]) expect(chainReads(chain(id)).source).toBe("gateway.tenderly.co");
    expect(chainReads(ARBITRUM).source).toBe("arb1.arbitrum.io");
    expect(chainReads(BASE).source).toBe("base-rpc.publicnode.com");
  });
});

describe("chunks", () => {
  it("splits a range into spans with both ends counted, the last one shorter", () => {
    expect(chunks(10n, 34n, 10n)).toEqual([
      [10n, 19n],
      [20n, 29n],
      [30n, 34n],
    ]);
    expect(chunks(1n, 20n, 10n)).toEqual([
      [1n, 10n],
      [11n, 20n],
    ]);
  });

  it("reads a single block, and nothing when the range is empty", () => {
    expect(chunks(5n, 5n, 10n)).toEqual([[5n, 5n]]);
    expect(chunks(11n, 10n, 10n)).toEqual([]);
  });

  it("never spans more than the limit and leaves no block out", () => {
    for (const [from, to, span] of [
      [0n, 0n, 1n],
      [3n, 17n, 1n],
      [100n, 1099n, 1000n],
      [100n, 1100n, 1000n],
      [7n, 250_006n, 50_000n],
    ]) {
      const parts = chunks(from, to, span);
      expect(parts[0][0]).toBe(from);
      expect(parts[parts.length - 1][1]).toBe(to);
      parts.forEach(([a, b], i) => {
        expect(b - a + 1n <= span && a <= b).toBe(true);
        if (i > 0) expect(a).toBe(parts[i - 1][1] + 1n);
      });
    }
  });

  it("covers Arbitrum One from its start block in 100,000-block reads", () => {
    const parts = chunks(SCANS[42161].start, 523_608_382n, SCANS[42161].span);
    expect(parts).toHaveLength(10);
    expect(parts[0]).toEqual([522_620_115n, 522_720_114n]);
    expect(parts[5]).toEqual([523_120_115n, 523_220_114n]);
    expect(parts[9]).toEqual([523_520_115n, 523_608_382n]);
  });

  it("refuses a span below one block", () => {
    expect(() => chunks(1n, 2n, 0n)).toThrow(/0 blocks at a time/);
  });
});

describe("transferIn", () => {
  it("reads 1Click's payout to satchel #2 from arb1.arbitrum.io's answer", () => {
    const t = transferIn(ARBITRUM, LOG, SATCHEL_2);
    expect(t).toMatchObject({ from: SOLVER, amount: 5_280_549n, tx: PAYOUT, block: 523_152_635n, logIndex: 6 });
    expect(t?.token).toBe(token(42161, "USDC"));
    expect(t && describeTransfer(t)).toBe(`5.280549 USDC on Arbitrum One from ${SOLVER}`);
    expect(t && transferUrl(t)).toBe(`https://arbiscan.io/tx/${PAYOUT}`);
  });

  it("matches the token, the event and the recipient in any letter case", () => {
    const upper = { ...LOG, address: LOG.address.toUpperCase().replace("0X", "0x"), topics: LOG.topics.map((t) => t.toUpperCase().replace("0X", "0x")) };
    expect(transferIn(ARBITRUM, upper, SATCHEL_2)?.amount).toBe(5_280_549n);
    expect(transferIn(ARBITRUM, LOG, SATCHEL_2.toLowerCase() as Address)?.amount).toBe(5_280_549n);
  });

  it("leaves out a log to another address, by another token or chain, or of another event", () => {
    expect(transferIn(ARBITRUM, LOG, SOLVER)).toBeNull();
    expect(transferIn(BASE, LOG, SATCHEL_2)).toBeNull();
    expect(transferIn(ARBITRUM, { ...LOG, address: "0x0000000000000000000000000000000000000001" }, SATCHEL_2)).toBeNull();
    expect(transferIn(ARBITRUM, { ...LOG, topics: [word(1n), ...LOG.topics.slice(1)] }, SATCHEL_2)).toBeNull();
    // An ERC-721 Transfer indexes the token id as a fourth topic.
    expect(transferIn(ARBITRUM, { ...LOG, topics: [...LOG.topics, word(7n)], data: "0x" }, SATCHEL_2)).toBeNull();
  });

  it("leaves out a transfer of 0, a removed log, and a sender, amount or hash that isn't one", () => {
    expect(transferIn(ARBITRUM, { ...LOG, data: word(0n) }, SATCHEL_2)).toBeNull();
    expect(transferIn(ARBITRUM, { ...LOG, removed: true }, SATCHEL_2)).toBeNull();
    expect(transferIn(ARBITRUM, { ...LOG, data: `${word(1n)}00` }, SATCHEL_2)).toBeNull();
    expect(transferIn(ARBITRUM, { ...LOG, topics: [LOG.topics[0], `0x01${LOG.topics[1].slice(4)}`, LOG.topics[2]] }, SATCHEL_2)).toBeNull();
    expect(transferIn(ARBITRUM, { ...LOG, transactionHash: null }, SATCHEL_2)).toBeNull();
    expect(transferIn(ARBITRUM, { ...LOG, blockNumber: "pending" }, SATCHEL_2)).toBeNull();
  });

  it("reads the largest amount a uint256 holds", () => {
    const max = (1n << 256n) - 1n;
    expect(transferIn(ARBITRUM, { ...LOG, data: word(max) }, SATCHEL_2)?.amount).toBe(max);
  });
});

describe("scanPlan", () => {
  it("scans mainnet satchel #2's Base, for its signature, and Arbitrum One, for its USDC", () => {
    const plan = scanPlan(MAINNET, contentsOf(MAINNET, { 42161: { USDC: 5_280_549n } }), signedOn(8453));
    expect(plan.scan.map((s) => s.chain.name)).toEqual(["Base", "Arbitrum One"]);
    expect(plan.scan.map(whyScanned)).toEqual(["the record has signatures for it", "it holds USDC now"]);
    expect(plan.skipped.map((c) => c.name)).toEqual(["Ethereum", "OP Mainnet", "Polygon", "BNB Chain", "Avalanche", "Aurora"]);
    expect(plan).toMatchObject({ unscanned: [], none: [], raw: false, elsewhere: [] });
  });

  it("scans a chain whose balances couldn't be read, and says why", () => {
    const plan = scanPlan(MAINNET, contentsOf(MAINNET, { 10: { USDT: null }, 8453: { USDC: 1n, WETH: 2n } }, [137]), signedOn(8453));
    expect(plan.scan.map((s) => [s.chain.name, whyScanned(s)])).toEqual([
      ["Base", "it holds USDC and WETH now, and the record has signatures for it"],
      ["OP Mainnet", "a balance there couldn't be read"],
      ["Polygon", "a balance there couldn't be read"],
    ]);
  });

  it("scans every chain when the record has a raw signature", () => {
    const plan = scanPlan(MAINNET, contentsOf(MAINNET), { ...NO_RECORD, opaque_signatures: 1 });
    expect(plan.scan).toHaveLength(7);
    expect(plan.unscanned.map((u) => u.chain.name)).toEqual(["BNB Chain"]);
    expect(plan.raw).toBe(true);
    expect(whyScanned(plan.scan[0])).toBe("the record has a raw signature");
  });

  it("says why it can't scan BNB Chain when it would", () => {
    const plan = scanPlan(MAINNET, contentsOf(MAINNET, { 56: { USDT: 3n } }), NO_RECORD);
    expect(plan.scan).toEqual([]);
    expect(plan.unscanned.map((u) => [u.chain.name, whyScanned(u), u.reason])).toEqual([["BNB Chain", "it holds USDT now", NOT_SCANNED[56]]]);
    expect(plan.skipped.map((c) => c.name)).not.toContain("BNB Chain");
    expect(scanPlan(MAINNET, contentsOf(MAINNET), NO_RECORD).skipped.map((c) => c.name)).toContain("BNB Chain");
  });

  it("never scans a testnet chain contents.ts lists no tokens on", () => {
    const plan = scanPlan(TESTNET, contentsOf(TESTNET), { ...NO_RECORD, opaque_signatures: 1 });
    expect(plan.none.map((c) => c.name)).toEqual(["BNB testnet", "Aurora testnet"]);
    expect(plan.scan).toHaveLength(6);
  });

  it("names the record's chains of the other network, which it doesn't scan", () => {
    const plan = scanPlan(TESTNET, contentsOf(TESTNET), signedOn(11155111, 1));
    expect(plan.scan.map((s) => s.chain.name)).toEqual(["Sepolia"]);
    expect(plan.elsewhere.map(chainName)).toEqual(["Ethereum"]);
  });

  it("scans nothing for a satchel that holds none of the tokens and has signed nothing", () => {
    const plan = scanPlan(TESTNET, contentsOf(TESTNET), NO_RECORD);
    expect(plan.scan).toEqual([]);
    expect(plan.skipped).toHaveLength(6);
  });
});

describe("scanChain", () => {
  const usdc = token(8453, "USDC");
  const weth = token(8453, "WETH");
  const start = SCANS[8453].start;

  it("reads every chunk once, a few at a time, and dates each block once", async () => {
    const latest = start + 4n * 50_000n + 10n;
    const logs = [log(usdc, 1_000_000n, start + 3n, 0), log(weth, 5n, start + 3n, 1), log(usdc, 2n, latest, 4)];
    const n = node(BASE, latest, logs);
    const { scan, transfers, lines } = await scanChain(BASE, SATCHEL_2, n.reads);
    expect(n.asked.map((f) => [BigInt(f.fromBlock), BigInt(f.toBlock)])).toEqual(chunks(start, latest, 50_000n));
    expect(n.asked[0]).toMatchObject({ address: [usdc.address, weth.address], topics: [TRANSFER_TOPIC, null, addressTopic(SATCHEL_2)] });
    expect(n.most()).toBeLessThanOrEqual(3);
    expect(n.dated.sort((a, b) => (a < b ? -1 : 1))).toEqual([start + 3n, latest]);
    expect(scan).toMatchObject({ from: start, to: latest, reads: 5, gaps: [], error: null, found: 3, shown: 3 });
    expect(transfers.map((t) => t.amount)).toEqual([1_000_000n, 5n, 2n]);
    expect(lines.map((l) => l.at)).toEqual([Number(start + 3n) * 1000, Number(start + 3n) * 1000, Number(latest) * 1000]);
  });

  it("keeps what it read when the node refuses one chunk, and names the blocks it didn't read", async () => {
    const latest = start + 120_000n;
    const refusal = Object.assign(new Error("RPC Request failed."), { details: "exceed maximum block range: 50000" });
    const n = node(BASE, latest, [log(usdc, 7n, start + 1n), log(usdc, 9n, start + 60_000n)], { refuse: (from) => from === start + 50_000n && refusal });
    const { scan, transfers } = await scanChain(BASE, SATCHEL_2, n.reads);
    expect(scan.gaps).toEqual([{ from: start + 50_000n, to: start + 99_999n, error: "exceed maximum block range: 50000" }]);
    expect(scan).toMatchObject({ reads: 2, found: 1, error: null });
    expect(transfers.map((t) => t.amount)).toEqual([7n]);
  });

  it("leaves the chain unread when its node serves another chain, doesn't answer, or is behind", async () => {
    expect((await scanChain(BASE, SATCHEL_2, node(BASE, start + 9n, [], { id: 1 }).reads)).scan.error).toBe("node.test serves chain 1, not 8453");
    const down = { ...node(BASE, start, []).reads, latest: () => Promise.reject(new TypeError("Failed to fetch")) };
    expect((await scanChain(BASE, SATCHEL_2, down)).scan).toMatchObject({ error: "Failed to fetch", to: null, reads: 0 });
    expect((await scanChain(BASE, SATCHEL_2, node(BASE, start - 1n, []).reads)).scan.error).toMatch(/latest block, 55111341, is before block 55111342: it is behind/);
  });

  it("drops the full stop viem ends a message with, since the page puts it in a sentence", async () => {
    const http = Object.assign(new Error("HTTP request failed.\n\nURL: https://node.test"), { shortMessage: "HTTP request failed." });
    const down = { ...node(BASE, start, []).reads, latest: () => Promise.reject(http) };
    expect((await scanChain(BASE, SATCHEL_2, down)).scan.error).toBe("HTTP request failed");
    const timeout = Object.assign(new Error("The request took too long to respond."), { details: "The request timed out." });
    const slow = node(BASE, start + 10n, [], { refuse: () => timeout });
    expect((await scanChain(BASE, SATCHEL_2, slow.reads)).scan.gaps.map((g) => g.error)).toEqual(["The request timed out"]);
    const dots = { ...node(BASE, start, []).reads, latest: () => Promise.reject(new Error("try again later...")) };
    expect((await scanChain(BASE, SATCHEL_2, dots)).scan.error).toBe("try again later...");
  });

  it("leaves the chain unread when its node doesn't return the chain's first Transfer, as a pruned node answers", async () => {
    const pruned = node(BASE, start + 10n, [log(usdc, 3n, start + 2n)], { kept: [] });
    const { scan, lines } = await scanChain(BASE, SATCHEL_2, pruned.reads);
    expect(scan.error).toBe("node.test didn't return the Transfer in block 55111342 (0x33937fc8…), so it may not keep Base's logs back to the start");
    expect(pruned.asked).toEqual([]);
    expect(lines).toEqual([]);
    // Another Transfer in that block isn't the one: the node must return `first` itself.
    const other = node(BASE, start + 10n, [], { kept: [{ ...firstOf(BASE), transactionHash: hash(1) }] });
    expect((await scanChain(BASE, SATCHEL_2, other.reads)).scan.error).toMatch(/didn't return the Transfer in block/);
    // The hash may come in any letter case.
    const upper = node(BASE, start + 10n, [], { kept: [{ ...firstOf(BASE), transactionHash: SCANS[8453].first.tx.toUpperCase().replace("0X", "0x") }] });
    expect((await scanChain(BASE, SATCHEL_2, upper.reads)).scan.error).toBeNull();
  });

  it("leaves out a log from outside the blocks asked for, and one the node sends twice", async () => {
    const twice = log(usdc, 3n, start + 2n);
    const n = node(BASE, start + 10n, [twice, twice]);
    const stray = { ...n.reads, getLogs: async (f: LogFilter) => [...(await n.reads.getLogs(f)), log(usdc, 4n, start - 1n)] };
    const { transfers } = await scanChain(BASE, SATCHEL_2, stray);
    expect(transfers.map((t) => t.amount)).toEqual([3n]);
  });

  it("lists the newest transfers, dates only their blocks, and counts them all", async () => {
    const count = LINES_PER_CHAIN + 5;
    const logs = Array.from({ length: count }, (_, i) => log(usdc, BigInt(i + 1), start + BigInt(i)));
    const n = node(BASE, start + 1_000n, logs);
    const { scan, transfers, lines } = await scanChain(BASE, SATCHEL_2, n.reads);
    expect(scan).toMatchObject({ found: count, shown: LINES_PER_CHAIN });
    expect(transfers).toHaveLength(count);
    expect(lines[0].amount).toBe(6n);
    expect(n.dated).toHaveLength(LINES_PER_CHAIN);
  });

  it("lists a transfer whose block it couldn't read, undated", async () => {
    const n = node(BASE, start + 10n, [log(usdc, 3n, start + 2n)], { noTime: [start + 2n] });
    expect((await scanChain(BASE, SATCHEL_2, n.reads)).lines.map((l) => l.at)).toEqual([null]);
  });

  it("finds nothing on a chain where nothing came in", async () => {
    const { scan, lines } = await scanChain(BASE, SATCHEL_2, node(BASE, start + 10n, [log(usdc, 3n, start + 2n, 0, SOLVER)]).reads);
    expect(scan).toMatchObject({ found: 0, shown: 0, gaps: [], error: null, reads: 1 });
    expect(lines).toEqual([]);
  });
});

describe("receivedOn", () => {
  const plan = scanPlan(MAINNET, contentsOf(MAINNET, { 42161: { USDC: 5_280_549n } }), signedOn(8453));
  const baseStart = SCANS[8453].start;

  it("puts every chain's lines in one list, oldest first, with each token's total", async () => {
    // The test nodes date Arbitrum One's block 523,152,635 at that second, Base's first line at the
    // same second (a tie goes to the chain CHAINS lists first) and its other two after it.
    const shift = 523_152_635n - baseStart;
    const usdc = token(8453, "USDC");
    const reads = (c: ChainInfo) =>
      c.id === 42161
        ? node(c, 523_608_382n, [LOG]).reads
        : node(c, baseStart + 100n, [log(usdc, 1n, baseStart), log(usdc, 2_000_000n, baseStart + 1n), log(usdc, 500_000n, baseStart + 5n)], { shift }).reads;
    const view = await receivedOn(plan, SATCHEL_2, reads);
    expect(view.lines.map(describeTransfer)).toEqual([
      `0.000001 USDC on Base from ${SOLVER}`,
      `5.280549 USDC on Arbitrum One from ${SOLVER}`,
      `2 USDC on Base from ${SOLVER}`,
      `0.5 USDC on Base from ${SOLVER}`,
    ]);
    expect(view.totals.map((t) => [t.chain.name, amountText(t.amount, t.token), t.transfers])).toEqual([
      ["Base", "2.500001 USDC", 3],
      ["Arbitrum One", "5.280549 USDC", 1],
    ]);
    expect(view.chains.map((c) => c.chain.name)).toEqual(["Base", "Arbitrum One"]);
  });

  it("keeps a chain that answered beside one that didn't", async () => {
    const reads = (c: ChainInfo) =>
      c.id === 42161 ? node(c, 523_608_382n, [LOG]).reads : { ...node(c, 1n, []).reads, chainId: () => Promise.reject(new Error("down")) };
    const view = await receivedOn(plan, SATCHEL_2, reads);
    expect(view.chains.map((c) => c.error)).toEqual(["down", null]);
    expect(view.totals.map((t) => t.chain.name)).toEqual(["Arbitrum One"]);
  });

  it("hands over each chain as soon as it is done, so a slow node holds back only its own lines", async () => {
    let open = () => {};
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const reads = (c: ChainInfo): ChainReads => {
      if (c.id === 42161) return node(c, 523_608_382n, [LOG]).reads;
      const slow = node(c, baseStart + 100n, []).reads;
      return {
        ...slow,
        chainId: async () => {
          await gate;
          return c.id;
        },
      };
    };
    const seen: [string[], string[]][] = [];
    const view = await receivedOn(plan, SATCHEL_2, reads, (sofar) => {
      seen.push([sofar.chains.map((c) => c.chain.name), sofar.lines.map((l) => l.tx)]);
      open();
    });
    expect(seen).toEqual([
      [["Arbitrum One"], [PAYOUT]],
      [["Base", "Arbitrum One"], [PAYOUT]],
    ]);
    expect(view.chains.map((c) => c.chain.name)).toEqual(["Base", "Arbitrum One"]);
    expect(view.totals.map((t) => amountText(t.amount, t.token))).toEqual(["5.280549 USDC"]);
  });

  it("reads nothing when the plan scans no chain", async () => {
    const view = await receivedOn(scanPlan(TESTNET, contentsOf(TESTNET), NO_RECORD), SATCHEL_2, () => {
      throw new Error("read");
    });
    expect(view).toEqual({ lines: [], totals: [], chains: [] });
  });
});

describe("totals and words", () => {
  it("adds each token up on each chain, in the chains' order", () => {
    const t = (c: ChainInfo, tok: TokenInfo, amount: bigint): Transfer => ({ chain: c, token: tok, from: SOLVER, amount, tx: PAYOUT, block: 1n, logIndex: 0 });
    const totals = totalsOf([t(ARBITRUM, token(42161, "USDT"), 1n), t(BASE, token(8453, "WETH"), 2n), t(ARBITRUM, token(42161, "USDT"), 3n), t(BASE, token(8453, "USDC"), 4n)]);
    expect(totals.map((x) => `${amountText(x.amount, x.token)} on ${x.chain.name} in ${x.transfers}`)).toEqual([
      "0.000004 USDC on Base in 1",
      "0.000000000000000002 WETH on Base in 1",
      "0.000004 USD₮0 on Arbitrum One in 2",
    ]);
  });

  it("writes every decimal a token has, and its symbol as contents.ts gives it", () => {
    expect(amountText(5_280_549n, token(42161, "USDC"))).toBe("5.280549 USDC");
    expect(amountText(1n, token(1, "WETH"))).toBe("0.000000000000000001 WETH");
    expect(amountText(1_500_000_000_000_000_000n, token(56, "WETH"))).toBe("1.5 ETH");
    expect(amountText(12_000_000n, token(43114, "USDT"))).toBe("12 USDt");
  });

  it("calls a transfer from the zero address a mint", () => {
    const t = transferIn(ARBITRUM, log(token(42161, "USDC"), 1_000_000n, 1n, 0, SATCHEL_2, zeroAddress), SATCHEL_2);
    expect(t && describeTransfer(t)).toBe("1 USDC on Arbitrum One minted to it");
  });

  it("lists names as a sentence does", () => {
    expect([listOf([]), listOf(["Base"]), listOf(["Base", "Polygon"]), listOf(["Ethereum", "Base", "Aurora"])]).toEqual([
      "",
      "Base",
      "Base and Polygon",
      "Ethereum, Base and Aurora",
    ]);
    expect(listOf(["USDC", "USDT", "WETH"], "or")).toBe("USDC, USDT or WETH");
    expect(chainName("999")).toBe("chain 999");
  });

  it("names the kinds of token read on each network, which on the testnets has no USDT", () => {
    expect(kindsOn(sendChains(MAINNET))).toEqual(["USDC", "USDT", "WETH"]);
    expect(kindsOn(sendChains(TESTNET))).toEqual(["USDC", "WETH"]);
    expect(kindsOn([chain(43113)])).toEqual(["USDC"]);
    expect(kindsOn([chain(1313161554)])).toEqual(["USDC", "USDT"]);
    expect(kindsOn([chain(97)])).toEqual([]);
  });

  it("says nothing came in naming only the tokens read on each chain", () => {
    const testnet = scanPlan(TESTNET, contentsOf(TESTNET), { ...NO_RECORD, opaque_signatures: 1 }).scan.map((s) => s.chain);
    expect(noneCameIn(testnet)).toBe(
      "No USDC or WETH came in on Sepolia, Base Sepolia, Arbitrum Sepolia, OP Sepolia and Polygon Amoy, and no USDC on Avalanche Fuji",
    );
    expect(noneCameIn([BASE, ARBITRUM])).toBe("No USDC or WETH came in on Base, and no USDC, USDT or WETH on Arbitrum One");
    expect(noneCameIn([chain(1), BASE, chain(1313161554)])).toBe(
      "No USDC, USDT or WETH came in on Ethereum; no USDC or WETH on Base; and no USDC or USDT on Aurora",
    );
    expect(noneCameIn([ARBITRUM])).toBe("No USDC, USDT or WETH came in on Arbitrum One");
  });
});
