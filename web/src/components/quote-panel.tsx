"use client";

import Link from "next/link";
import { Component, type FormEvent, type ReactNode, useRef, useState } from "react";
import { type Address, formatUnits } from "viem";
import { type ChainContents, MAINNET, REPO_URL, chainContents, formatAmount, sendChains } from "satchel-nft";
import {
  type Asset,
  BLOCKCHAINS,
  type Holding,
  type OneClickToken,
  type Quote,
  QuoteRefused,
  SLIPPAGE_BPS,
  SLIPPAGE_CHOICES,
  assetDecimals,
  assetKey,
  assetName,
  assetSymbol,
  defaultDestination,
  destinationsFor,
  dryQuote,
  findListed,
  holdingsFrom,
  minimumIn,
  oneClickTokens,
  parseAmount,
  quoteRequest,
} from "@/lib/oneclick";
import { appPath } from "@/lib/routes";
import { useNetwork } from "./network";
import { Badge, Button, Card, ErrorNote, ExternalLink, Mono, errorMessage } from "./ui";

const HOW_IT_WAS_DONE = `${REPO_URL}#a-swap-through-near-intents-that-keeps-the-proof`;

/**
 * A dry quote from NEAR Intents' 1Click for what this satchel holds, on mainnet pages. No wallet:
 * the quote is asked from the browser, with the satchel as recipient and refund address, and
 * nothing is signed or sent. On testnet, which 1Click doesn't serve, a line points to mainnet.
 */
export function QuotePanel(props: { address: Address }) {
  return (
    <Contained>
      <QuoteCard {...props} />
    </Contained>
  );
}

/** Keeps a failure in this card from taking the rest of the page, the report included, down with it. */
class Contained extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Card>
        <h2 className="font-display text-xl font-semibold">Quote an exit</h2>
        <p className="mt-1 text-sm text-muted">The quote couldn&apos;t be shown. The report doesn&apos;t use it.</p>
      </Card>
    );
  }
}

function QuoteCard({ address }: { address: Address }) {
  const net = useNetwork();
  if (net.id === "mainnet") return <MainnetQuote address={address} />;
  return (
    <Card>
      <p className="text-sm text-muted">
        1Click has no testnet; see{" "}
        <Link href={appPath(MAINNET, "/satchel/2")} className="underline decoration-line underline-offset-4 hover:decoration-ink">
          mainnet satchel #2&apos;s swap
        </Link>
        .
      </p>
    </Card>
  );
}

interface Loaded {
  tokens: OneClickToken[];
  holdings: Holding[];
  /** Chains where a balance couldn't be read, so what they hold may be missing. */
  unread: string[];
}

const exact = (amount: bigint, asset: Asset) => formatUnits(amount, assetDecimals(asset));
const dollars = (usd: number | null) => (usd === null ? "" : ` (about $${usd.toFixed(2)} at 1Click's prices)`);

/** Moves focus into the panel once it has loaded, since the button that opened it is gone. Stable, so React calls it when the element mounts, not on each render. */
const focusOnMount = (el: HTMLElement | null) => {
  el?.focus();
};

/** What went wrong, in words: 1Click's own, with its minimum in the origin's units, or why its answer was refused. */
function described(err: unknown, origin: Asset): string {
  const min = minimumIn(err);
  if (min !== null) return `${errorMessage(err)}: that is ${exact(min, origin)} ${assetSymbol(origin)}, 1Click's minimum for this route.`;
  if (err instanceof QuoteRefused) return `1Click's answer isn't the quote asked for, so it isn't shown: ${err.message}.`;
  return errorMessage(err);
}

function MainnetQuote({ address }: { address: Address }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [originKey, setOriginKey] = useState("");
  const [destinationKey, setDestinationKey] = useState("");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState(SLIPPAGE_BPS);
  const [result, setResult] = useState<{ quote: Quote; origin: Asset; destination: Asset; slippageBps: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A newer request, or a change to the form, makes an older answer stale.
  const run = useRef(0);

  const holding = loaded?.holdings.find((h) => assetKey(h.asset) === originKey);
  const choices = loaded && holding ? destinationsFor(holding.asset, loaded.tokens) : [];
  const destination = choices.find((a) => assetKey(a) === destinationKey);

  function changed() {
    run.current++;
    setResult(null);
    setError(null);
    setBusy(false);
  }

  function chooseOrigin(h: Holding, tokens: OneClickToken[]) {
    changed();
    setOriginKey(assetKey(h.asset));
    setAmount(exact(h.amount, h.asset));
    // The destination stays as picked, unless it is now the origin.
    const next = destinationsFor(h.asset, tokens);
    const fallback = defaultDestination(h.asset, next);
    setDestinationKey((key) => (next.some((a) => assetKey(a) === key) ? key : fallback ? assetKey(fallback) : ""));
  }

  // Opening the panel reads the satchel's balances and 1Click's token list; nothing is quoted yet.
  async function open() {
    setLoading(true);
    setLoadError(null);
    try {
      const chains = sendChains(MAINNET).filter((c) => BLOCKCHAINS[c.id] !== undefined);
      const [tokens, found] = await Promise.all([
        oneClickTokens(),
        Promise.all(chains.map((chain) => chainContents(chain, address).catch(() => null))),
      ]);
      const read = found.filter((c): c is ChainContents => c !== null);
      const unread = chains
        .filter((_, i) => {
          const c = found[i];
          return !c || c.native === null || c.tokens.some((t) => t.amount === null && t.token.kind !== "WETH");
        })
        .map((c) => c.name);
      const holdings = holdingsFrom(read, tokens);
      setLoaded({ tokens, holdings, unread });
      if (holdings[0]) chooseOrigin(holdings[0], tokens);
    } catch (err) {
      setLoadError(err);
    } finally {
      setLoading(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!loaded || !holding || !destination) return;
    const origin = holding.asset;
    const value = parseAmount(amount, assetDecimals(origin));
    if (value === null || value <= 0n) {
      setError(`Enter an amount of ${assetSymbol(origin)}, like ${exact(holding.amount, origin)}.`);
      return;
    }
    if (value > holding.amount) {
      setError(`This satchel holds ${exact(holding.amount, origin)} ${assetName(origin)}: enter that or less.`);
      return;
    }
    const to = findListed(loaded.tokens, destination);
    if (!to) return;
    changed();
    const id = run.current;
    setBusy(true);
    try {
      const asked = quoteRequest(holding.listed, to, value, address, Date.now(), slippage);
      const quote = await dryQuote(asked);
      if (id === run.current) setResult({ quote, origin, destination, slippageBps: asked.slippageTolerance });
    } catch (err) {
      if (id === run.current) setError(described(err, origin));
    } finally {
      if (id === run.current) setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-xl font-semibold">Quote an exit</h2>
        <Badge tone="gold">Dry quote: nothing is sent</Badge>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        What this satchel&apos;s coins would swap for through NEAR Intents&apos; 1Click, asked from your browser, no wallet
        needed. The quote is dry: 1Click gives no deposit address, and this panel signs nothing.
      </p>

      {!loaded && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={open} busy={loading}>
              Quote an exit
            </Button>
            {loading && <span className="text-sm text-muted">Reading this satchel&apos;s balances and 1Click&apos;s token list…</span>}
          </div>
          <div aria-live="polite">
            {loadError !== null && (
              <div className="mt-3 space-y-3">
                <ErrorNote error={loadError} />
                <p className="text-xs text-muted">The report doesn&apos;t use 1Click.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {loaded && (
        <>
          {loaded.holdings.length === 0 ? (
            <p ref={focusOnMount} tabIndex={-1} className="mt-4 text-sm text-muted outline-none">
              {loaded.unread.length > 0 ? (
                "Nothing to quote among the balances that could be read."
              ) : (
                <>
                  Nothing to quote: this satchel holds none of the coins 1Click lists on its mainnets (the native coin, USDC
                  or USDT on Ethereum, Base, Arbitrum One, OP Mainnet, Polygon, BNB Chain or Avalanche; 1Click doesn&apos;t
                  serve Aurora).
                </>
              )}
            </p>
          ) : (
            <form onSubmit={submit} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[2fr_2fr_1fr]">
              <label className="grid min-w-0 gap-1 text-sm">
                <span className="text-muted">From</span>
                <select
                  ref={focusOnMount}
                  value={originKey}
                  onChange={(e) => {
                    const h = loaded.holdings.find((x) => assetKey(x.asset) === e.target.value);
                    if (h) chooseOrigin(h, loaded.tokens);
                  }}
                  className="min-w-0 rounded-xl border border-line bg-paper px-3 py-2"
                >
                  {loaded.holdings.map((h) => (
                    <option key={assetKey(h.asset)} value={assetKey(h.asset)}>
                      {formatAmount(h.amount, assetDecimals(h.asset))} {assetName(h.asset)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid min-w-0 gap-1 text-sm">
                <span className="text-muted">To</span>
                <select
                  value={destinationKey}
                  onChange={(e) => {
                    changed();
                    setDestinationKey(e.target.value);
                  }}
                  className="min-w-0 rounded-xl border border-line bg-paper px-3 py-2"
                >
                  {choices.map((a) => (
                    <option key={assetKey(a)} value={assetKey(a)}>
                      {assetName(a)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid min-w-0 gap-1 text-sm">
                <span className="text-muted">Amount{holding ? ` (${assetSymbol(holding.asset)})` : ""}</span>
                <input
                  value={amount}
                  onChange={(e) => {
                    changed();
                    setAmount(e.target.value);
                  }}
                  inputMode="decimal"
                  className="min-w-0 rounded-xl border border-line bg-paper px-3 py-2"
                />
              </label>
              <div className="flex flex-wrap items-end gap-3 sm:col-span-3">
                <label className="grid gap-1 text-sm">
                  <span className="text-muted">Slippage limit</span>
                  <select
                    value={slippage}
                    onChange={(e) => {
                      changed();
                      setSlippage(Number(e.target.value));
                    }}
                    className="rounded-xl border border-line bg-paper px-3 py-2"
                  >
                    {SLIPPAGE_CHOICES.map((bps) => (
                      <option key={bps} value={bps}>
                        {bps / 100} %
                      </option>
                    ))}
                  </select>
                </label>
                <Button type="submit" variant="primary" busy={busy}>
                  Get a quote
                </Button>
              </div>
            </form>
          )}

          <p className="mt-3 text-sm [overflow-wrap:anywhere]">
            Recipient and refund: this satchel&apos;s address, <Mono>{address}</Mono>
          </p>
          {holding && holding.asset.token === null && (
            <p className="mt-1 text-xs text-muted">
              A real send of {assetSymbol(holding.asset)} pays its gas from the same balance, so it couldn&apos;t send all of it.
            </p>
          )}
          {loaded.unread.length > 0 && (
            <p className="mt-1 text-xs text-warn">
              Some balances couldn&apos;t be read on {loaded.unread.join(", ")}, so what is there may be missing above.
            </p>
          )}

          {/* Announces the answer, or the error, that follows "Get a quote". */}
          <div aria-live="polite">
            {error !== null && (
              <div className="mt-3">
                <ErrorNote error={error} />
              </div>
            )}
            {result && <QuoteResult {...result} />}
          </div>

          <p className="mt-4 text-xs text-muted">
            A swap needs a deposit address from a quote that isn&apos;t dry, which this app never asks for. Mainnet satchel
            #2&apos;s swap got one from <span className="font-mono">tools/oneclick-exit.mjs</span>, then sent the deposit
            from the Send panel: <ExternalLink href={HOW_IT_WAS_DONE}>how it was done</ExternalLink>.{" "}
            <Link href="/docs/guides/quote-an-exit" className="underline decoration-line underline-offset-4 hover:decoration-ink">
              About these quotes
            </Link>
            .
          </p>
        </>
      )}
    </Card>
  );
}

function QuoteResult({ quote, origin, destination, slippageBps }: { quote: Quote; origin: Asset; destination: Asset; slippageBps: number }) {
  const symbol = assetSymbol(destination);
  return (
    <dl className="mt-4 grid gap-x-4 gap-y-2 rounded-xl bg-paper-2 p-4 text-sm sm:grid-cols-[7rem_1fr] [overflow-wrap:anywhere]">
      <dt className="text-muted">In</dt>
      <dd>
        {exact(quote.amountIn, origin)} {assetName(origin)}
        {dollars(quote.amountInUsd)}
      </dd>
      <dt className="text-muted">Out</dt>
      <dd>
        <strong>
          {exact(quote.amountOut, destination)} {assetName(destination)}
        </strong>
        {dollars(quote.amountOutUsd)}
      </dd>
      <dt className="text-muted">At least</dt>
      <dd>
        {exact(quote.minAmountOut, destination)} {symbol}, after {slippageBps / 100} % slippage
      </dd>
      <dt className="text-muted">Fees</dt>
      <dd>
        {quote.feeBps} bps ({quote.feeBps / 100} %) in the quote&apos;s <span className="font-mono">appFees</span>
        {quote.withdrawFee !== null && quote.withdrawFee > 0n && (
          <>
            ; the out amount already has {exact(quote.withdrawFee, destination)} {symbol} of withdrawal fee taken off
          </>
        )}
      </dd>
      <dt className="text-muted">Time</dt>
      <dd>About {quote.timeEstimate} s after 1Click sees the deposit, 1Click&apos;s estimate</dd>
    </dl>
  );
}
