import { type Address, formatUnits, getAddress, isAddress, parseUnits } from "viem";
import { type ChainContents, type ChainInfo, type HistoryEntry, MAINNET, TOKENS, type TokenInfo, chainInfo, sendChains } from "satchel-nft";
import { ONECLICK_EXIT } from "./showcase";

/*
 * NEAR Intents' 1Click API, for dry quotes and for a deposit address's status. The quote logic is
 * ported from tools/oneclick-exit.mjs, which ran mainnet satchel #2's swap, minus everything that
 * moves funds: every quote asked here has `dry: true`, so 1Click returns no deposit address, and
 * nothing here signs or sends. 1Click answers a browser directly
 * (Access-Control-Allow-Origin: *), with no API key. For display: the report reads none of it.
 */
export const ONE_CLICK = "https://1click.chaindefuser.com";

/** 1Click's `blockchain` for each of the satchel's mainnets it lists. It lists no Aurora. */
export const BLOCKCHAINS: Readonly<Record<number, string>> = {
  1: "eth",
  8453: "base",
  42161: "arb",
  10: "op",
  137: "pol",
  56: "bsc",
  43114: "avax",
};

/** As tools/oneclick-exit.mjs asks: 1 % of slippage, and a deadline an hour out. */
export const SLIPPAGE_BPS = 100;
/** The slippage limits, in basis points, the panel offers: 0.5 %, 1 % (the default) and 3 %. */
export const SLIPPAGE_CHOICES: readonly number[] = [50, SLIPPAGE_BPS, 300];
export const QUOTE_MINUTES = 60;
/** How many of a satchel's latest sends its history can ask 1Click about. */
export const STATUS_LOOKUPS = 5;
const TIMEOUT_MS = 20_000;

const same = (a: unknown, b: unknown) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
const record = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
/** An amount 1Click writes as a decimal string of the asset's smallest unit. */
const units = (v: unknown): bigint | null => (typeof v === "string" && /^\d{1,78}$/.test(v) ? BigInt(v) : null);
const usd = (v: unknown): number | null => {
  const n = typeof v === "string" || typeof v === "number" ? Number(v) : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** 1Click refused, answered with an error, or didn't answer. `status` is the HTTP status, when there was one. */
export class OneClickError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "OneClickError";
    this.status = status;
  }
}

/** 1Click answered, but not with the quote asked for, so it isn't shown. */
export class QuoteRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuoteRefused";
  }
}

/** 1Click's own words for an error: its `message`, or the start of the body. */
function said(body: unknown): string {
  const message = record(body)?.message;
  if (typeof message === "string") return message;
  return (typeof body === "string" ? body : JSON.stringify(body)).slice(0, 200);
}

async function call(path: string, init?: RequestInit): Promise<unknown> {
  const { res, text } = await fetch(`${ONE_CLICK}${path}`, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
    .then(async (res) => ({ res, text: await res.text() }))
    .catch((err: unknown) => {
      throw new OneClickError(`1Click didn't answer (${err instanceof Error ? err.message : String(err)})`);
    });
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON: the text is the answer.
  }
  if (!res.ok) throw new OneClickError(`1Click answered ${res.status}: ${said(body)}`, res.status);
  return body;
}

/** A coin a satchel can hold on one of those chains: the native coin (`token` null), or USDC or USDT from contents.ts. */
export interface Asset {
  chain: ChainInfo;
  token: TokenInfo | null;
}

/** The assets the quote panel offers, chain by chain: the native coin, then USDC and USDT where contents.ts lists them. */
export function quotableAssets(): Asset[] {
  return sendChains(MAINNET)
    .filter((chain) => BLOCKCHAINS[chain.id] !== undefined)
    .flatMap((chain) => [
      { chain, token: null },
      ...(TOKENS[chain.id] ?? []).filter((t) => t.kind !== "WETH").map((token) => ({ chain, token })),
    ]);
}

export const assetKey = (a: Asset) => `${a.chain.id}:${a.token ? a.token.address.toLowerCase() : "native"}`;
export const assetSymbol = (a: Asset) => a.token?.symbol ?? a.chain.symbol;
export const assetDecimals = (a: Asset) => a.token?.decimals ?? 18;
export const assetName = (a: Asset) => `${assetSymbol(a)} on ${a.chain.name}`;

/** An entry of 1Click's /v0/tokens, with the fields read here. */
export interface OneClickToken {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  /** 1Click's price in USD, or null when it gives none. */
  price: number | null;
  /** Null for a chain's native coin. */
  contractAddress: string | null;
}

/** The entries of 1Click's token list that have what the panel needs; others are left out. */
export function parseTokens(body: unknown): OneClickToken[] {
  if (!Array.isArray(body)) throw new OneClickError("1Click's token list isn't a list");
  return body.flatMap((entry) => {
    const t = record(entry);
    const [assetId, blockchain, symbol] = [str(t?.assetId), str(t?.blockchain), str(t?.symbol)];
    if (!t || !assetId || !blockchain || !symbol || !Number.isInteger(t.decimals)) return [];
    return [{ assetId, blockchain, symbol, decimals: t.decimals as number, price: usd(t.price), contractAddress: str(t.contractAddress) }];
  });
}

let listed: Promise<OneClickToken[]> | null = null;

/** 1Click's token list, read once per page load; after a failed read, the next call asks again. */
export function oneClickTokens(): Promise<OneClickToken[]> {
  if (listed) return listed;
  const read = call("/v0/tokens").then(parseTokens);
  listed = read;
  read.catch(() => {
    if (listed === read) listed = null;
  });
  return read;
}

/** Forgets the token list read so far, so the next call reads it again. */
export function forgetTokens(): void {
  listed = null;
}

/**
 * 1Click's entry for `asset`, matched by blockchain and contract address (or by having none, for the
 * native coin), never built by hand. Null unless 1Click lists it exactly once with the decimals
 * contents.ts has. 1Click keeps entries for older bridges of some coins, with "(DEPRECATED)" in their
 * symbol; those are left out.
 */
export function findListed(tokens: readonly OneClickToken[], asset: Asset): OneClickToken | null {
  const blockchain = BLOCKCHAINS[asset.chain.id];
  if (blockchain === undefined) return null;
  const found = tokens.filter(
    (t) =>
      t.blockchain === blockchain &&
      !t.symbol.includes("DEPRECATED") &&
      (asset.token ? same(t.contractAddress, asset.token.address) : t.contractAddress === null),
  );
  return found.length === 1 && found[0].decimals === assetDecimals(asset) ? found[0] : null;
}

/** A balance the satchel holds of an asset 1Click lists. */
export interface Holding {
  asset: Asset;
  listed: OneClickToken;
  amount: bigint;
}

const worth = (h: Holding) => (h.listed.price === null ? -1 : Number(formatUnits(h.amount, h.listed.decimals)) * h.listed.price);

/**
 * What the satchel holds of each asset the panel offers and 1Click lists, read by the package's
 * `chainContents`, largest to smallest at 1Click's prices. Zero balances, and balances a chain didn't
 * answer for, are left out.
 */
export function holdingsFrom(found: readonly ChainContents[], tokens: readonly OneClickToken[]): Holding[] {
  const out: Holding[] = [];
  for (const asset of quotableAssets()) {
    const c = found.find((x) => x.chain.id === asset.chain.id);
    const token = asset.token;
    const amount = !c ? null : token === null ? c.native : (c.tokens.find((t) => same(t.token.address, token.address))?.amount ?? null);
    const entry = findListed(tokens, asset);
    if (amount !== null && amount > 0n && entry) out.push({ asset, listed: entry, amount });
  }
  return out.sort((a, b) => worth(b) - worth(a));
}

/** Where the output can go: the satchel's own mainnets, so it lands at an address the contract signs for. */
export function destinationsFor(origin: Asset, tokens: readonly OneClickToken[]): Asset[] {
  return quotableAssets().filter((a) => assetKey(a) !== assetKey(origin) && findListed(tokens, a) !== null);
}

const BASE_ETH = "8453:native";
const ARBITRUM_USDC = `42161:${TOKENS[42161].find((t) => t.kind === "USDC")?.address.toLowerCase()}`;

/** ETH on Base, or USDC on Arbitrum One when ETH on Base is what goes in: satchel #2's swap, either way round. */
export function defaultDestination(origin: Asset, choices: readonly Asset[]): Asset | undefined {
  const want = assetKey(origin) === BASE_ETH ? ARBITRUM_USDC : BASE_ETH;
  return choices.find((a) => assetKey(a) === want) ?? choices[0];
}

/** `text` in the smallest unit of an asset with `decimals`, or null unless it is a plain amount like 5.28. */
export function parseAmount(text: string, decimals: number): bigint | null {
  const t = text.trim();
  const m = /^(\d{1,40})(?:\.(\d+))?$/.exec(t);
  if (!m || (m[2]?.length ?? 0) > decimals) return null;
  return parseUnits(t, decimals);
}

/** What the panel posts to /v0/quote. `dry` is the literal `true`: no request with any other value can be built here. */
export interface QuoteRequest {
  readonly dry: true;
  readonly swapType: "EXACT_INPUT";
  readonly slippageTolerance: number;
  readonly originAsset: string;
  readonly depositType: "ORIGIN_CHAIN";
  readonly destinationAsset: string;
  readonly amount: string;
  readonly recipient: Address;
  readonly recipientType: "DESTINATION_CHAIN";
  readonly refundTo: Address;
  readonly refundType: "ORIGIN_CHAIN";
  readonly deadline: string;
  readonly referral: string;
}

/**
 * A dry, exact-input quote of `amount` of `origin` for `destination`, with one of SLIPPAGE_CHOICES
 * as its slippage limit. The satchel is both the recipient and the refund address, as in
 * tools/oneclick-exit.mjs: what comes out, and any refund, would land back in it.
 */
export function quoteRequest(
  origin: OneClickToken,
  destination: OneClickToken,
  amount: bigint,
  satchel: Address,
  now = Date.now(),
  slippageBps = SLIPPAGE_BPS,
): QuoteRequest {
  if (amount <= 0n) throw new QuoteRefused("enter an amount above 0");
  if (origin.assetId === destination.assetId) throw new QuoteRefused("pick a destination other than the origin");
  if (!isAddress(satchel, { strict: false })) throw new QuoteRefused(`${satchel} is not an EVM address`);
  if (!SLIPPAGE_CHOICES.includes(slippageBps)) throw new QuoteRefused(`pick a slippage of ${SLIPPAGE_CHOICES.map((b) => `${b / 100} %`).join(", ")}`);
  const address = getAddress(satchel);
  return {
    dry: true,
    swapType: "EXACT_INPUT",
    slippageTolerance: slippageBps,
    originAsset: origin.assetId,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: destination.assetId,
    amount: amount.toString(),
    recipient: address,
    recipientType: "DESTINATION_CHAIN",
    refundTo: address,
    refundType: "ORIGIN_CHAIN",
    deadline: new Date(now + QUOTE_MINUTES * 60_000).toISOString(),
    referral: "satchel",
  };
}

/** The parts of a dry quote the panel shows. A dry quote has no deposit address, and one that comes back with one is refused. */
export interface Quote {
  amountIn: bigint;
  amountOut: bigint;
  minAmountOut: bigint;
  /** The sum of the quote's `appFees`, in basis points. */
  feeBps: number;
  /** The destination's withdrawal fee, already taken off `amountOut`, in its smallest unit. */
  withdrawFee: bigint | null;
  /** 1Click's estimate, in seconds after it sees the deposit. */
  timeEstimate: number;
  amountInUsd: number | null;
  amountOutUsd: number | null;
}

/** The sum of the fees in a quote's `appFees`, in basis points; null if one can't be read. None at all is 0. */
export function appFeeBps(fees: unknown): number | null {
  if (fees === undefined || fees === null) return 0;
  if (!Array.isArray(fees)) return null;
  let sum = 0;
  for (const f of fees) {
    const fee = record(f)?.fee;
    if (typeof fee !== "number" || !Number.isInteger(fee) || fee < 0 || fee > 10_000) return null;
    sum += fee;
  }
  return sum;
}

/** The fields 1Click must echo exactly as asked. */
const ECHOED = ["dry", "swapType", "originAsset", "destinationAsset", "amount", "depositType", "recipientType", "refundType", "slippageTolerance", "deadline"] as const;

/** Refuses an answer that isn't the quote asked for: other assets, amount, recipient or refund address, terms, or a deposit address. */
export function checkQuote(asked: QuoteRequest, answer: unknown): Quote {
  const echo = record(record(answer)?.quoteRequest);
  const q = record(record(answer)?.quote);
  if (!echo || !q) throw new QuoteRefused("1Click's answer has no quote in it");
  for (const field of ECHOED) {
    if (echo[field] !== asked[field]) throw new QuoteRefused(`its ${field} is ${JSON.stringify(echo[field])}, not ${JSON.stringify(asked[field])}`);
  }
  if (!same(echo.recipient, asked.recipient) || !same(echo.refundTo, asked.refundTo)) {
    throw new QuoteRefused(`it pays ${String(echo.recipient)} and refunds ${String(echo.refundTo)}, not this satchel's ${asked.recipient}`);
  }
  if (q.depositAddress !== undefined && q.depositAddress !== null && q.depositAddress !== "") {
    throw new QuoteRefused("it came back with a deposit address, which a dry quote doesn't have");
  }
  if (q.amountIn !== asked.amount) throw new QuoteRefused(`it takes ${String(q.amountIn)}, not ${asked.amount}`);
  const out = units(q.amountOut);
  const min = units(q.minAmountOut);
  if (out === null || min === null || min <= 0n || min > out || min * 10_000n < out * BigInt(10_000 - asked.slippageTolerance) - 10_000n) {
    throw new QuoteRefused(`its minimum out (${String(q.minAmountOut)}) doesn't match ${asked.slippageTolerance} bps of slippage on ${String(q.amountOut)}`);
  }
  const feeBps = appFeeBps(echo.appFees);
  if (feeBps === null) throw new QuoteRefused(`its fees can't be read: ${JSON.stringify(echo.appFees)}`);
  const time = q.timeEstimate;
  if (typeof time !== "number" || !Number.isFinite(time) || time < 0) throw new QuoteRefused(`its time estimate is ${JSON.stringify(time)}`);
  return {
    amountIn: BigInt(asked.amount),
    amountOut: out,
    minAmountOut: min,
    feeBps,
    withdrawFee: units(q.withdrawFee),
    timeEstimate: time,
    amountInUsd: usd(q.amountInUsd),
    amountOutUsd: usd(q.amountOutUsd),
  };
}

/** Posts a dry quote request, and returns the quote once `checkQuote` accepts 1Click's answer. */
export async function dryQuote(asked: QuoteRequest): Promise<Quote> {
  // The type allows nothing else; this holds for a request built some other way too.
  if (asked.dry !== true) throw new QuoteRefused("this app asks for dry quotes and nothing else");
  const answer = await call("/v0/quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...asked, dry: true }),
  });
  return checkQuote(asked, answer);
}

/** The minimum 1Click names when an amount is too low ("… try at least 35000000000001"), in the origin's smallest unit. */
export function minimumIn(err: unknown): bigint | null {
  if (!(err instanceof OneClickError) || err.status !== 400) return null;
  const m = /too low.*?at least (\d{1,78})\b/i.exec(err.message);
  return m ? BigInt(m[1]) : null;
}

/** 1Click's status for a deposit address, with the fields read here. */
export interface SwapStatus {
  status: string;
  /** From 1Click's copy of the quote the address belongs to; null where it doesn't say. */
  originAsset: string | null;
  destinationAsset: string | null;
  recipient: string | null;
  /** What came out, in the destination's smallest unit. */
  amountOut: bigint | null;
  /** The hashes in 1Click's `destinationChainTxHashes`, in its order; empty where it names none. */
  destinationTxs: string[];
}

export function parseStatus(body: unknown): SwapStatus {
  const b = record(body);
  const status = b?.status;
  if (typeof status !== "string" || !/^[A-Z_]{1,40}$/.test(status)) throw new OneClickError("1Click's status answer has no status");
  const asked = record(record(b?.quoteResponse)?.quoteRequest);
  const details = record(b?.swapDetails);
  const hashes = Array.isArray(details?.destinationChainTxHashes) ? details.destinationChainTxHashes : [];
  return {
    status,
    originAsset: str(asked?.originAsset),
    destinationAsset: str(asked?.destinationAsset),
    recipient: str(asked?.recipient),
    amountOut: units(details?.amountOut),
    destinationTxs: hashes.flatMap((h) => str(record(h)?.hash) ?? []),
  };
}

export const statusUrl = (depositAddress: string) => `${ONE_CLICK}/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`;

/** 1Click's status for `depositAddress`, or null when 1Click doesn't know the address (404). */
export async function statusOf(depositAddress: string): Promise<SwapStatus | null> {
  try {
    return parseStatus(await call(`/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`));
  } catch (err) {
    if (err instanceof OneClickError && err.status === 404) return null;
    throw err;
  }
}

type SignEvmEntry = Extract<HistoryEntry, { kind: "sign_evm" }>;

/**
 * The sends whose recipient the history can ask 1Click about: the latest native-coin transfers on a
 * chain 1Click lists, newest to oldest, at most STATUS_LOOKUPS. A deposit into a 1Click swap is one.
 * It asks about those that paid a known deposit address (paysKnownDeposit) as the page loads, and
 * about the others when the reader clicks "Check with 1Click".
 */
export function sendsToLookUp(entries: readonly HistoryEntry[]): SignEvmEntry[] {
  return entries
    .filter(
      (e): e is SignEvmEntry =>
        e.kind === "sign_evm" &&
        e.class === "value_transfer" &&
        BigInt(e.value) > 0n &&
        BLOCKCHAINS[Number(e.chainId)] !== undefined &&
        isAddress(e.to, { strict: false }),
    )
    .slice(-STATUS_LOOKUPS)
    .reverse();
}

/**
 * The 1Click deposit addresses this app knows, lowercased: those of the swaps it shows (showcase.ts),
 * so far mainnet satchel #2's. A page asks 1Click on its own only about these: for an address it has
 * no quote for, 1Click answers 404, which a browser logs as an error even though the history expects
 * it. Any other recipient is asked about on the reader's click.
 */
export const KNOWN_DEPOSITS: ReadonlySet<string> = new Set([ONECLICK_EXIT.depositAddress].map((a) => a.toLowerCase()));

/** Whether `send` paid one of KNOWN_DEPOSITS. */
export const paysKnownDeposit = (send: SignEvmEntry) => KNOWN_DEPOSITS.has(send.to.toLowerCase());

/**
 * The history's sends to ask 1Click about (sendsToLookUp), newest first: `known`, those that paid a
 * known deposit address, which the page asks about as it loads, and `onClick`, the rest, which it
 * asks about when the reader clicks "Check with 1Click" on their row.
 */
export function historyLookups(entries: readonly HistoryEntry[]): { known: SignEvmEntry[]; onClick: SignEvmEntry[] } {
  const sends = sendsToLookUp(entries);
  return { known: sends.filter(paysKnownDeposit), onClick: sends.filter((s) => !paysKnownDeposit(s)) };
}

/** The key a history row and its 1Click line share. */
export const sendKey = (e: SignEvmEntry) => `${e.tx}:${e.chainId}:${e.nonce}`;

/** The satchel's mainnet that 1Click calls `blockchain`, if it is one. */
const chainOf = (blockchain: string): ChainInfo | undefined => {
  const id = Object.keys(BLOCKCHAINS).find((k) => BLOCKCHAINS[Number(k)] === blockchain);
  return id === undefined ? undefined : chainInfo(Number(id));
};
const chainNamed = (blockchain: string) => chainOf(blockchain)?.name ?? blockchain;

/**
 * The line a send's row gets from 1Click's status for its recipient: "1Click swap · SUCCESS ·
 * 5.280549 USDC to this satchel on Arbitrum One". Null unless 1Click's copy of the quote starts
 * from the native coin of the chain the satchel sent on, so a send that merely shares an address
 * with a deposit isn't marked. "This satchel" is said when 1Click names its address as the
 * recipient.
 */
export function swapLine(send: SignEvmEntry, status: SwapStatus, tokens: readonly OneClickToken[], satchel: Address): string | null {
  const origin = tokens.find((t) => t.assetId === status.originAsset);
  if (!origin || origin.blockchain !== BLOCKCHAINS[Number(send.chainId)] || origin.contractAddress !== null) return null;
  const parts = ["1Click swap", status.status];
  const destination = tokens.find((t) => t.assetId === status.destinationAsset);
  if (destination) {
    const out =
      status.status === "SUCCESS" && status.amountOut !== null && status.amountOut > 0n
        ? `${formatUnits(status.amountOut, destination.decimals)} ${destination.symbol}`
        : `for ${destination.symbol}`;
    const to = status.recipient === null ? "" : ` to ${same(status.recipient, satchel) ? "this satchel" : status.recipient}`;
    parts.push(`${out}${to} on ${chainNamed(destination.blockchain)}`);
  }
  return parts.join(" · ");
}

/**
 * The payout on the destination chain's explorer: the first EVM transaction hash in 1Click's
 * `destinationChainTxHashes`, for a swap 1Click calls SUCCESS whose destination is one of the
 * satchel's mainnets. Null otherwise, refunds and failures included.
 */
export function payoutUrl(status: SwapStatus, tokens: readonly OneClickToken[]): string | null {
  if (status.status !== "SUCCESS") return null;
  const destination = tokens.find((t) => t.assetId === status.destinationAsset);
  const chain = destination && chainOf(destination.blockchain);
  const hash = status.destinationTxs.find((h) => /^0x[0-9a-fA-F]{64}$/.test(h));
  return chain && hash ? `${chain.explorer}/tx/${hash}` : null;
}

export interface SwapMark {
  line: string;
  /**
   * The payout's transaction (`payoutUrl`) when 1Click names one; otherwise 1Click's status for the
   * send's recipient, which says it all in 1Click's own words.
   */
  url: string;
  /** Whether `url` is the payout's transaction rather than 1Click's status. */
  payout: boolean;
}

/** `send`'s mark from 1Click's `status` for its recipient, or null when that isn't a swap from this send (swapLine). */
function markOf(send: SignEvmEntry, status: SwapStatus, tokens: readonly OneClickToken[], satchel: Address): SwapMark | null {
  const line = swapLine(send, status, tokens, satchel);
  if (!line) return null;
  const payout = payoutUrl(status, tokens);
  return { line, url: payout ?? statusUrl(send.to), payout: payout !== null };
}

/**
 * 1Click's line for each send it knows the recipient of, by `sendKey`. A send 1Click doesn't know, or
 * can't be asked about, gets none: this never throws, since the history doesn't depend on it.
 */
export async function swapMarks(sends: readonly SignEvmEntry[], satchel: Address): Promise<Map<string, SwapMark>> {
  const marks = new Map<string, SwapMark>();
  const statuses = await Promise.all(sends.map((s) => statusOf(s.to).catch(() => null)));
  if (statuses.every((s) => s === null)) return marks;
  const tokens = await oneClickTokens().catch(() => null);
  if (!tokens) return marks;
  sends.forEach((send, i) => {
    const status = statuses[i];
    const mark = status && markOf(send, status, tokens, satchel);
    if (mark) marks.set(sendKey(send), mark);
  });
  return marks;
}

/**
 * 1Click's line for one send, asked on the reader's click: null when 1Click doesn't know its recipient
 * (404) or knows no swap from this send. Throws a OneClickError when 1Click doesn't answer.
 */
export async function swapMark(send: SignEvmEntry, satchel: Address): Promise<SwapMark | null> {
  const status = await statusOf(send.to);
  return status && markOf(send, status, await oneClickTokens(), satchel);
}
