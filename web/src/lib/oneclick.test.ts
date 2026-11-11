import { afterEach, describe, expect, it, vi } from "vitest";
import { type ChainContents, type HistoryEntry, TOKENS, chainInfo } from "satchel-nft";
import quote from "./__fixtures__/oneclick-quote-2.json" with { type: "json" };
import status from "./__fixtures__/oneclick-status-2.json" with { type: "json" };
import tokens from "./__fixtures__/oneclick-tokens.json" with { type: "json" };
import {
  ONE_CLICK,
  OneClickError,
  type QuoteRequest,
  QuoteRefused,
  SLIPPAGE_CHOICES,
  appFeeBps,
  assetKey,
  checkQuote,
  defaultDestination,
  destinationsFor,
  dryQuote,
  findListed,
  forgetTokens,
  holdingsFrom,
  minimumIn,
  oneClickTokens,
  parseAmount,
  parseStatus,
  parseTokens,
  payoutUrl,
  quotableAssets,
  quoteRequest,
  sendKey,
  sendsToLookUp,
  statusOf,
  statusUrl,
  swapLine,
  swapMarks,
} from "./oneclick";

// Answers 1Click gave on 2026-11-11 to requests that change nothing: a dry quote for mainnet satchel #2's 5.280549 USDC on
// Arbitrum One to ETH on Base (quote eeab056b…), the status of its swap's deposit address
// (deployments/mainnet-1click-exit.json), and /v0/tokens' entries on the satchel's 7 chains.
const SATCHEL_2 = "0xf5383275EFedde8B90F59de8E8D15b1E23B4965f";
const DEPOSIT = "0x588f8C4419974bC735Ac784B3dA41B44c42bb64b";
/** The swap's USDC payout to satchel #2 on Arbitrum One, the one hash in the status's destinationChainTxHashes. */
const PAYOUT = "0x417322bdacc90439ada251ab53ca96117f4c5dcda5ad9671636b2dcd45243209";
const listed = parseTokens(tokens);

const asset = (chainId: number, kind?: "USDC" | "USDT") => {
  const found = quotableAssets().find((a) => a.chain.id === chainId && (kind ? a.token?.kind === kind : a.token === null));
  if (!found) throw new Error(`no ${kind ?? "native"} on ${chainId}`);
  return found;
};
const ARB_USDC = asset(42161, "USDC");
const BASE_ETH = asset(8453);
const entry = (a: ReturnType<typeof asset>) => {
  const found = findListed(listed, a);
  if (!found) throw new Error(`1Click doesn't list ${assetKey(a)}`);
  return found;
};

/** The request the fixture answers, as the panel built it: its deadline is an hour after it asked. */
const asked = (slippageBps?: number) =>
  quoteRequest(entry(ARB_USDC), entry(BASE_ETH), 5_280_549n, SATCHEL_2, Date.parse(quote.quoteRequest.deadline) - 60 * 60_000, slippageBps);

/** Satchel #2's mainnet send to the deposit address, as FastNEAR's index returned it on 2026-11-11. */
const SEND_2: Extract<HistoryEntry, { kind: "sign_evm" }> = {
  kind: "sign_evm",
  chainId: "8453",
  nonce: "0",
  to: DEPOSIT,
  value: "2580000000000000",
  class: "value_transfer",
  tx: "FnFSMSh1dpjkYC6fMT2aSgvFNYUjyuc6xVLGAymcupEA",
  block: 224001174,
  at: 1794362487125,
  caller: "satchel-nft.near",
};
const MINT_2: HistoryEntry = {
  kind: "mint",
  owner: "satchel-nft.near",
  tx: "8NE2xLniZaPhbitfZiD2qww1P1nC1zqQQ3QBTCdjYo1d",
  block: 223999961,
  at: 1794361796266,
  caller: "satchel-nft.near",
};

const json = (body: unknown, code = 200) => new Response(JSON.stringify(body), { status: code, headers: { "content-type": "application/json" } });
/** A fetch that answers each URL with what `answer` returns for it, a fresh Response every time. */
function serve(answer: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => answer(url, init));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
/** A deep copy of `value` with `change` applied. */
const tampered = <T>(value: T, change: (copy: T) => void): T => {
  const copy = structuredClone(value);
  change(copy);
  return copy;
};
/**
 * 1Click's real status for satchel #2's deposit address, changed the way a swap that didn't complete
 * reads in 1Click's status schema: its status, nothing out, and nothing paid on the destination chain.
 */
const unfinished = (name: "REFUNDED" | "FAILED") =>
  tampered(status, (s) => {
    s.status = name;
    Object.assign(s.swapDetails, { amountOut: "0", amountOutFormatted: "0", amountOutUsd: "0", destinationChainTxHashes: [] });
  });

afterEach(() => {
  vi.unstubAllGlobals();
  forgetTokens();
});

describe("1Click's token list", () => {
  it("finds every asset the panel offers once, by blockchain and contract address, never a deprecated entry", () => {
    expect(entry(ARB_USDC).assetId).toBe("nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near");
    expect(entry(BASE_ETH).assetId).toBe("nep141:base.omft.near");
    // Polygon, BNB Chain and Avalanche each have a "(DEPRECATED)" twin of the native coin and the stablecoins.
    expect(entry(asset(137)).assetId).toBe("nep141:pol.omdep.near");
    expect(entry(asset(43114, "USDC")).assetId).toBe("nep141:avax-0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e.omdep.near");
    expect(entry(asset(56, "USDT"))).toMatchObject({ assetId: "nep141:bnb-0x55d398326f99059ff775485246999027b3197955.omdep.near", decimals: 18 });
    // USDT0 on OP Mainnet, the one contents.ts lists, not the older bridged USDT.
    expect(entry(asset(10, "USDT")).assetId).toBe("nep245:v2_1.omni.hot.tg:10_2R1RXDBxCyJTeMEsdXydh7xsHmz");
    const assets = quotableAssets();
    expect(assets).toHaveLength(20);
    expect(assets.filter((a) => findListed(listed, a) === null).map(assetKey)).toEqual([]);
    expect(assets.some((a) => a.chain.id === 1313161554 || a.token?.kind === "WETH")).toBe(false);
  });

  it("refuses an asset 1Click lists twice, or with other decimals", () => {
    const usdc = entry(ARB_USDC);
    expect(findListed([...listed, { ...usdc, assetId: "nep141:another" }], ARB_USDC)).toBeNull();
    expect(findListed(listed.map((t) => (t === usdc ? { ...t, decimals: 18 } : t)), ARB_USDC)).toBeNull();
    expect(findListed(listed.filter((t) => t !== usdc), ARB_USDC)).toBeNull();
  });

  it("keeps the entries it can read and refuses an answer that isn't a list", () => {
    expect(parseTokens([{ assetId: "a", blockchain: "base", symbol: "X", decimals: 6 }, { assetId: "b" }, null])).toEqual([
      { assetId: "a", blockchain: "base", symbol: "X", decimals: 6, price: null, contractAddress: null },
    ]);
    expect(() => parseTokens({ message: "busy" })).toThrow(OneClickError);
  });

  it("reads the list once, and again after a failed read", async () => {
    let calls = 0;
    const fetch = serve(() => {
      calls++;
      if (calls === 1) throw new TypeError("fetch failed");
      return json(tokens);
    });
    await expect(oneClickTokens()).rejects.toThrow("1Click didn't answer (fetch failed)");
    expect(await oneClickTokens()).toHaveLength(listed.length);
    await oneClickTokens();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0]).toBe(`${ONE_CLICK}/v0/tokens`);
  });
});

describe("the quote request", () => {
  it("is always dry, exact-input, and pays and refunds the satchel itself", () => {
    const echoed = quote.quoteRequest;
    expect(asked()).toEqual({
      dry: true,
      swapType: "EXACT_INPUT",
      slippageTolerance: 100,
      originAsset: echoed.originAsset,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: echoed.destinationAsset,
      amount: "5280549",
      recipient: SATCHEL_2,
      recipientType: "DESTINATION_CHAIN",
      refundTo: SATCHEL_2,
      refundType: "ORIGIN_CHAIN",
      deadline: echoed.deadline,
      referral: "satchel",
    });
    const lower = quoteRequest(entry(ARB_USDC), entry(BASE_ETH), 1n, SATCHEL_2.toLowerCase() as `0x${string}`);
    expect([lower.dry, lower.recipient, lower.refundTo]).toEqual([true, SATCHEL_2, SATCHEL_2]);
  });

  it("refuses nothing to swap, a swap to the same asset, and a recipient that isn't an address", () => {
    expect(() => quoteRequest(entry(ARB_USDC), entry(BASE_ETH), 0n, SATCHEL_2)).toThrow(QuoteRefused);
    expect(() => quoteRequest(entry(ARB_USDC), entry(ARB_USDC), 1n, SATCHEL_2)).toThrow(QuoteRefused);
    expect(() => quoteRequest(entry(ARB_USDC), entry(BASE_ETH), 1n, "satchel-nft.near" as `0x${string}`)).toThrow(QuoteRefused);
  });

  it("asks for the slippage limit picked, 0.5 %, 1 % or 3 %, and no other", () => {
    expect(SLIPPAGE_CHOICES).toEqual([50, 100, 300]);
    expect(SLIPPAGE_CHOICES.map((bps) => asked(bps).slippageTolerance)).toEqual([50, 100, 300]);
    expect(asked().slippageTolerance).toBe(100);
    for (const bad of [0, 99, 1000, 10_000, 100.5, Number.NaN]) expect(() => asked(bad), String(bad)).toThrow(QuoteRefused);
  });

  it("posts dry: true and reads the answer", async () => {
    const fetch = serve(() => json(quote, 201));
    const got = await dryQuote(asked());
    expect(got.amountOut).toBe(2_562_013_507_100_062n);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`${ONE_CLICK}/v0/quote`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual(asked());
  });

  it("sends nothing for a request whose dry was changed after it was built", async () => {
    const fetch = serve(() => json(quote, 201));
    const wet = { ...asked(), dry: false } as unknown as QuoteRequest;
    await expect(dryQuote(wet)).rejects.toThrow(QuoteRefused);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("checkQuote", () => {
  it("accepts 1Click's real dry quote and reads what the panel shows", () => {
    const got = checkQuote(asked(), quote);
    expect(got).toMatchObject({
      amountIn: 5_280_549n,
      amountOut: 2_562_013_507_100_062n,
      minAmountOut: 2_536_393_372_029_061n,
      feeBps: 20,
      withdrawFee: 560_000_000_000n,
      timeEstimate: 27,
    });
    expect(got.amountInUsd).toBeCloseTo(5.278, 3);
    expect(got.amountOutUsd).toBeCloseTo(5.2697, 3);
    expect(Object.keys(got)).not.toContain("depositAddress");
  });

  it.each([
    ["recipient", (q: typeof quote) => (q.quoteRequest.recipient = "0x000000000000000000000000000000000000dEaD")],
    ["refundTo", (q: typeof quote) => (q.quoteRequest.refundTo = "0x000000000000000000000000000000000000dEaD")],
    ["originAsset", (q: typeof quote) => (q.quoteRequest.originAsset = "nep141:arb.omft.near")],
    ["destinationAsset", (q: typeof quote) => (q.quoteRequest.destinationAsset = "nep141:arb.omft.near")],
    ["amount", (q: typeof quote) => (q.quoteRequest.amount = "5280550")],
    ["dry", (q: typeof quote) => (q.quoteRequest.dry = false)],
    ["deadline", (q: typeof quote) => (q.quoteRequest.deadline = "2026-11-14T07:47:20.024Z")],
    ["slippageTolerance", (q: typeof quote) => (q.quoteRequest.slippageTolerance = 1000)],
    ["refundType", (q: typeof quote) => (q.quoteRequest.refundType = "INTENTS")],
    ["amountIn", (q: typeof quote) => (q.quote.amountIn = "5280550")],
  ])("refuses an answer whose %s isn't what was asked", (_, change) => {
    expect(() => checkQuote(asked(), tampered(quote, change))).toThrow(QuoteRefused);
  });

  it("takes the satchel's address in any case, as 1Click may echo it", () => {
    const lower = tampered(quote, (q) => {
      q.quoteRequest.recipient = SATCHEL_2.toLowerCase();
      q.quoteRequest.refundTo = SATCHEL_2.toLowerCase();
    });
    expect(checkQuote(asked(), lower).feeBps).toBe(20);
  });

  it("refuses an answer with a deposit address", () => {
    const withAddress = tampered(quote, (q) => Object.assign(q.quote, { depositAddress: DEPOSIT }));
    expect(() => checkQuote(asked(), withAddress)).toThrow("deposit address");
  });

  it("refuses a minimum that isn't 1 % below the amount out", () => {
    expect(() => checkQuote(asked(), tampered(quote, (q) => (q.quote.minAmountOut = "2000000000000000")))).toThrow("minimum out");
    expect(() => checkQuote(asked(), tampered(quote, (q) => (q.quote.minAmountOut = "2562013507100063")))).toThrow("minimum out");
    expect(() => checkQuote(asked(), tampered(quote, (q) => (q.quote.amountOut = "lots")))).toThrow("minimum out");
  });

  it("checks the echo and the minimum against the slippage limit asked", () => {
    // 1Click's amount out and minimum in a dry quote of the same 5.280549 USDC at 300 bps, on 2026-11-11.
    const at300 = tampered(quote, (q) => {
      q.quoteRequest.slippageTolerance = 300;
      q.quote.amountOut = "2564059772479938";
      q.quote.minAmountOut = "2487137979305539";
    });
    expect(checkQuote(asked(300), at300).minAmountOut).toBe(2_487_137_979_305_539n);
    // Asked at 1 %, the same answer is refused: its echo says 300.
    expect(() => checkQuote(asked(), at300)).toThrow("slippageTolerance");
    // Asked at 0.5 %, 1Click's real 1 % answer is refused: its echo says 100.
    expect(() => checkQuote(asked(50), quote)).toThrow("slippageTolerance");
    // At 3 %, a minimum more than 3 % below the amount out is refused.
    expect(() => checkQuote(asked(300), tampered(at300, (q) => (q.quote.minAmountOut = "2400000000000000")))).toThrow("minimum out");
  });

  it("refuses fees or a time it can't read, and an answer with no quote", () => {
    expect(() => checkQuote(asked(), tampered(quote, (q) => Object.assign(q.quoteRequest, { appFees: [{ fee: "20" }] })))).toThrow("fees");
    expect(() => checkQuote(asked(), tampered(quote, (q) => Object.assign(q.quote, { timeEstimate: "soon" })))).toThrow("time estimate");
    expect(() => checkQuote(asked(), { message: "Amount is too low for bridge, try at least 35000000000001" })).toThrow(QuoteRefused);
  });

  it("adds up the quote's appFees in basis points", () => {
    expect(appFeeBps(quote.quoteRequest.appFees)).toBe(20);
    expect(appFeeBps([{ recipient: "a", fee: 1 }])).toBe(1);
    expect(appFeeBps([{ fee: 20 }, { fee: 5 }])).toBe(25);
    expect(appFeeBps(undefined)).toBe(0);
    expect(appFeeBps([{ fee: -1 }])).toBeNull();
    expect(appFeeBps([{ fee: 2.5 }])).toBeNull();
    expect(appFeeBps({ fee: 20 })).toBeNull();
  });
});

describe("1Click's errors", () => {
  it("passes on 1Click's words, and the minimum it names", async () => {
    // 1Click's answer on 2026-11-11 for 0.000001 ETH on Ethereum to USDC on Base.
    serve(() => json({ message: "Amount is too low for bridge, try at least 35000000000001", path: "/v0/quote" }, 400));
    const err = await dryQuote(asked()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OneClickError);
    expect((err as OneClickError).status).toBe(400);
    expect((err as Error).message).toBe("1Click answered 400: Amount is too low for bridge, try at least 35000000000001");
    expect(minimumIn(err)).toBe(35_000_000_000_001n);
    expect(minimumIn(new OneClickError("1Click answered 400: tokenIn is not valid", 400))).toBeNull();
  });

  it("turns an outage into an error the panel shows, whatever form it takes", async () => {
    serve(() => {
      throw new TypeError("fetch failed");
    });
    await expect(dryQuote(asked())).rejects.toThrow("1Click didn't answer (fetch failed)");
    serve(() => new Response("<html>502 Bad Gateway</html>", { status: 502 }));
    await expect(dryQuote(asked())).rejects.toThrow("1Click answered 502: <html>502 Bad Gateway</html>");
  });
});

describe("statusOf", () => {
  it("reads 1Click's real status for satchel #2's deposit address", async () => {
    const fetch = serve(() => json(status));
    expect(await statusOf(DEPOSIT)).toEqual({
      status: "SUCCESS",
      originAsset: "nep141:base.omft.near",
      destinationAsset: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near",
      recipient: SATCHEL_2,
      amountOut: 5_280_549n,
      destinationTxs: [PAYOUT],
    });
    expect(fetch.mock.calls[0][0]).toBe(statusUrl(DEPOSIT));
    expect(statusUrl(DEPOSIT)).toBe(`${ONE_CLICK}/v0/status?depositAddress=${DEPOSIT}`);
  });

  it("is null for an address 1Click doesn't know, and throws for anything else that isn't a status", async () => {
    // 1Click's 404 on 2026-11-11 for an address it has no quote for.
    serve(() => json({ message: "Deposit address 0x000000000000000000000000000000000000dEaD not found", statusCode: 404 }, 404));
    expect(await statusOf("0x000000000000000000000000000000000000dEaD")).toBeNull();
    serve(() => json({ message: "busy" }, 500));
    await expect(statusOf(DEPOSIT)).rejects.toThrow(OneClickError);
    expect(() => parseStatus({ status: "success!" })).toThrow(OneClickError);
    expect(parseStatus({ status: "PENDING_DEPOSIT" })).toEqual({
      status: "PENDING_DEPOSIT",
      originAsset: null,
      destinationAsset: null,
      recipient: null,
      amountOut: null,
      destinationTxs: [],
    });
  });
});

describe("the history's 1Click lines", () => {
  const send = (n: number, change: Partial<typeof SEND_2> = {}) => ({ ...SEND_2, tx: `tx${n}`, nonce: String(n), ...change });

  it("asks about the latest native-coin sends on chains 1Click lists, newest to oldest, at most 5", () => {
    expect(sendsToLookUp([MINT_2, SEND_2])).toEqual([SEND_2]);
    const skipped = [
      send(90, { value: "0" }),
      send(91, { class: "asset_transfer" }),
      send(92, { chainId: "1313161554" }),
      send(93, { to: "satchel-nft.near" }),
    ];
    expect(sendsToLookUp(skipped)).toEqual([]);
    const seven = [1, 2, 3, 4, 5, 6, 7].map((n) => send(n));
    expect(sendsToLookUp(seven).map((s) => s.tx)).toEqual(["tx7", "tx6", "tx5", "tx4", "tx3"]);
  });

  it("marks satchel #2's Base send with 1Click's status, what came out, where, and to whom", () => {
    expect(swapLine(SEND_2, parseStatus(status), listed, SATCHEL_2)).toBe("1Click swap · SUCCESS · 5.280549 USDC to this satchel on Arbitrum One");
    const elsewhere = tampered(status, (s) => (s.quoteResponse.quoteRequest.recipient = "0x000000000000000000000000000000000000dEaD"));
    expect(swapLine(SEND_2, parseStatus(elsewhere), listed, SATCHEL_2)).toBe(
      "1Click swap · SUCCESS · 5.280549 USDC to 0x000000000000000000000000000000000000dEaD on Arbitrum One",
    );
    const waiting = { ...parseStatus(status), status: "PENDING_DEPOSIT", amountOut: null };
    expect(swapLine(SEND_2, waiting, listed, SATCHEL_2)).toBe("1Click swap · PENDING_DEPOSIT · for USDC to this satchel on Arbitrum One");
    expect(swapLine(SEND_2, { ...parseStatus(status), destinationAsset: "nep141:unknown" }, listed, SATCHEL_2)).toBe("1Click swap · SUCCESS");
  });

  it.each(["REFUNDED", "FAILED"] as const)("says a %s swap's status and what it was for, and links 1Click's status", async (name) => {
    const got = parseStatus(unfinished(name));
    expect(got).toMatchObject({ status: name, amountOut: 0n, destinationTxs: [] });
    expect(swapLine(SEND_2, got, listed, SATCHEL_2)).toBe(`1Click swap · ${name} · for USDC to this satchel on Arbitrum One`);
    expect(payoutUrl(got, listed)).toBeNull();
    serve((url) => (url.endsWith("/v0/tokens") ? json(tokens) : json(unfinished(name))));
    expect([...(await swapMarks([SEND_2], SATCHEL_2))]).toEqual([
      [sendKey(SEND_2), { line: `1Click swap · ${name} · for USDC to this satchel on Arbitrum One`, url: statusUrl(DEPOSIT), payout: false }],
    ]);
  });

  it("links the payout on the destination chain's explorer only for a swap 1Click calls SUCCESS", () => {
    expect(payoutUrl(parseStatus(status), listed)).toBe(`https://arbiscan.io/tx/${PAYOUT}`);
    // A refund never shows an amount as having come out, or a destination hash as its payout, even one 1Click gave.
    const refunded = parseStatus(tampered(status, (s) => (s.status = "REFUNDED")));
    expect(swapLine(SEND_2, refunded, listed, SATCHEL_2)).toBe("1Click swap · REFUNDED · for USDC to this satchel on Arbitrum One");
    expect(payoutUrl(refunded, listed)).toBeNull();
    // No hash, one that isn't an EVM transaction's, or a destination that isn't one of the satchel's mainnets: no link.
    expect(payoutUrl({ ...parseStatus(status), destinationTxs: [] }, listed)).toBeNull();
    expect(payoutUrl({ ...parseStatus(status), destinationTxs: ["HnJYvejk1Nep7CkjhaJRgAGToE3K2oqthD1F4NpNVpp4"] }, listed)).toBeNull();
    const wnear = { assetId: "nep141:wrap.near", blockchain: "near", symbol: "wNEAR", decimals: 24, price: null, contractAddress: "wrap.near" };
    expect(payoutUrl({ ...parseStatus(status), destinationAsset: wnear.assetId }, [...listed, wnear])).toBeNull();
    expect(parseStatus(tampered(status, (s) => Object.assign(s.swapDetails, { destinationChainTxHashes: [{ hash: 7 }, null, { hash: PAYOUT }] }))).destinationTxs).toEqual([PAYOUT]);
  });

  it("leaves a send unmarked when 1Click's swap didn't start from that chain's native coin", () => {
    expect(swapLine({ ...SEND_2, chainId: "42161" }, parseStatus(status), listed, SATCHEL_2)).toBeNull();
    const fromUsdc = { ...parseStatus(status), originAsset: entry(asset(8453, "USDC")).assetId };
    expect(swapLine(SEND_2, fromUsdc, listed, SATCHEL_2)).toBeNull();
    expect(swapLine(SEND_2, { ...parseStatus(status), originAsset: null }, listed, SATCHEL_2)).toBeNull();
  });

  it("reads the marks from 1Click, and is silent when 1Click fails or doesn't know the address", async () => {
    serve((url) => (url.endsWith("/v0/tokens") ? json(tokens) : json(status)));
    const marks = await swapMarks([SEND_2], SATCHEL_2);
    expect([...marks]).toEqual([
      [sendKey(SEND_2), { line: "1Click swap · SUCCESS · 5.280549 USDC to this satchel on Arbitrum One", url: `https://arbiscan.io/tx/${PAYOUT}`, payout: true }],
    ]);

    forgetTokens();
    const unknown = serve(() => json({ message: "not found" }, 404));
    expect((await swapMarks([SEND_2], SATCHEL_2)).size).toBe(0);
    expect(unknown.mock.calls.map(([url]) => url)).toEqual([statusUrl(DEPOSIT)]);

    serve(() => {
      throw new TypeError("fetch failed");
    });
    expect((await swapMarks([SEND_2], SATCHEL_2)).size).toBe(0);
    serve((url) => (url.endsWith("/v0/tokens") ? json({ message: "busy" }, 503) : json(status)));
    expect((await swapMarks([SEND_2], SATCHEL_2)).size).toBe(0);
  });
});

describe("the panel's choices", () => {
  /** What the package read for satchel #2 on 2026-11-11: dust on Base, the swap's USDC on Arbitrum One. */
  const read = (chainId: number, native: bigint | null, held: Record<string, bigint> = {}): ChainContents => {
    const chain = chainInfo(chainId);
    if (!chain) throw new Error(`no chain ${chainId}`);
    return { chain, native, tokens: (TOKENS[chainId] ?? []).map((token) => ({ token, amount: held[token.kind] ?? 0n })) };
  };
  const satchel2 = [
    read(1, 0n),
    read(8453, 19_873_543_885_003n),
    read(42161, 0n, { USDC: 5_280_549n }),
    read(10, 0n),
    read(137, 0n),
    read(56, 0n),
    read(43114, 0n),
    read(1313161554, 0n),
  ];

  it("offers what the satchel holds, largest to smallest at 1Click's prices", () => {
    expect(holdingsFrom(satchel2, listed).map((h) => [assetKey(h.asset), h.amount])).toEqual([
      [assetKey(ARB_USDC), 5_280_549n],
      [assetKey(BASE_ETH), 19_873_543_885_003n],
    ]);
    // A chain that didn't answer, or a token whose balance couldn't be read, is left out.
    const unread = [read(8453, null), { ...read(42161, 0n), tokens: read(42161, 0n).tokens.map((t) => ({ ...t, amount: null })) }];
    expect(holdingsFrom(unread, listed)).toEqual([]);
    // Aurora isn't a 1Click chain: what the satchel holds there isn't offered.
    expect(holdingsFrom([read(1313161554, 10n ** 18n, { USDC: 10n ** 6n })], listed)).toEqual([]);
  });

  it("sends the output to the satchel's own mainnets, ETH on Base by default", () => {
    const choices = destinationsFor(ARB_USDC, listed);
    expect(choices).toHaveLength(19);
    expect(choices.map(assetKey)).not.toContain(assetKey(ARB_USDC));
    expect(defaultDestination(ARB_USDC, choices)).toBe(choices.find((a) => assetKey(a) === assetKey(BASE_ETH)));
    expect(assetKey(defaultDestination(BASE_ETH, destinationsFor(BASE_ETH, listed))!)).toBe(assetKey(ARB_USDC));
  });

  it("reads an amount in the asset's units, refusing what isn't a plain amount", () => {
    expect(parseAmount("5.280549", 6)).toBe(5_280_549n);
    expect(parseAmount(" 1 ", 6)).toBe(1_000_000n);
    expect(parseAmount("0.000019873543885003", 18)).toBe(19_873_543_885_003n);
    for (const bad of ["5.2805491", "", "1e3", "-1", "1,5", ".5", "abc"]) expect(parseAmount(bad, 6), bad).toBeNull();
  });
});
