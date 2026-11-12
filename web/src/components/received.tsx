"use client";

import { Component, type ReactNode, useRef, useState } from "react";
import type { Address } from "viem";
import { CHAINS, type ChainContents, type ChainInfo, type SigningRecord, sendChains } from "satchel-nft";
import {
  CREATED,
  type ReceivedView,
  type ScanPlan,
  amountText,
  chainName,
  chainReads,
  describeTransfer,
  kindsOn,
  listOf,
  noneCameIn,
  receivedOn,
  scanPlan,
  transferUrl,
  whyScanned,
} from "@/lib/received";
import { useNetwork } from "./network";
import { Button, Card, ErrorNote, ExternalLink } from "./ui";
import { useAsync } from "./use-async";

const when = (at: number) => new Date(at).toISOString().slice(0, 16).replace("T", " ");
const blocks = (n: bigint) => n.toLocaleString("en-US");
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

type Props = {
  address: Address;
  record: SigningRecord;
  /** What "What's inside" read on each chain, `null` where nothing answered; a chain not read yet is missing. */
  contents: Readonly<Record<number, ChainContents | null>>;
  refresh: number;
};

/** USDC, USDT and WETH sent to a satchel's address, from each chain's Transfer logs. Display only. */
export function Received(props: Props) {
  return (
    <Contained>
      <ReceivedCard {...props} />
    </Contained>
  );
}

/** Keeps a failure in this display-only card from taking the rest of the page, the report included, down with it. */
class Contained extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Card>
        <h2 className="font-display text-xl font-semibold">Received</h2>
        <p className="mt-1 text-sm text-muted">What this satchel received couldn&apos;t be shown. The report doesn&apos;t use it.</p>
      </Card>
    );
  }
}

function ReceivedCard({ address, record, contents, refresh }: Props) {
  const net = useNetwork();
  const chains = sendChains(net);
  // The kinds read on this network's chains: USDC, USDT and WETH on the mainnets, USDC and WETH on the testnets.
  const kinds = kindsOn(chains);
  // The chains to scan follow from the balances, so the scan waits for every chain's.
  const plan = chains.every((c) => c.id in contents) ? scanPlan(net, contents, record) : null;
  const scanned = plan?.scan.map((s) => s.chain.id).join(",");
  // The chains done so far in the latest scan, shown while the others are still read; `run` tells a
  // superseded scan's chains from the latest's.
  const run = useRef(0);
  const [sofar, setSofar] = useState<ReceivedView | null>(null);
  const found = useAsync(
    async () => {
      const id = ++run.current;
      setSofar(null);
      return plan ? receivedOn(plan, address, chainReads, (view) => id === run.current && setSofar(view)) : null;
    },
    plan ? `${net.id}:${address}:${refresh}:${scanned}` : `waiting:${net.id}:${address}:${refresh}`,
  );
  const done = (plan && !found.loading && found.data) || null;
  const view = done ?? (plan && found.loading ? sofar : null);
  const reading = done || !plan ? [] : plan.scan.map((s) => s.chain).filter((c) => !view?.chains.some((s) => s.chain.id === c.id));

  return (
    <Card>
      <h2 className="font-display text-xl font-semibold">Received</h2>
      <p className="mt-1 text-sm text-muted">
        {listOf(kinds)} sent to this satchel&apos;s address on this network&apos;s chains since {net.contract} was created on{" "}
        {when(Date.parse(CREATED[net.id].at))} UTC, oldest first: the ERC-20 Transfer events each chain logged, read now
        from its node. The report doesn&apos;t use them; each line links its transaction.
      </p>
      {!plan ? (
        <p className="mt-3 text-sm text-muted">Waiting for the balances above, which decide the chains to scan…</p>
      ) : found.error ? (
        <div className="mt-3 space-y-3">
          <ErrorNote error={found.error} />
          <Button onClick={found.reload}>Try again</Button>
        </div>
      ) : plan.scan.length === 0 ? (
        <p className="mt-3 text-sm text-muted">
          {plan.unscanned.length > 0
            ? "No chain was scanned; the notes below say why."
            : "No chain to scan: on each of this network's chains that “What's inside” reads tokens on, this satchel holds none of them now, and the record has no signature for it."}
        </p>
      ) : !view ? (
        <p className="mt-3 text-sm text-muted">Reading the logs on {listOf(plan.scan.map((s) => s.chain.name))}…</p>
      ) : (
        <Lines view={view} reading={reading} />
      )}
      {plan && <ScanNotes plan={plan} view={view} done={Boolean(done)} onRetry={found.reload} />}
      <p className="mt-3 text-xs text-muted">
        Not listed: {listOf([...new Set(chains.map((c) => c.symbol))])} sent to the address, since a plain send of a
        chain&apos;s coin logs no event (&ldquo;What&apos;s inside&rdquo; shows its balance); WETH the satchel wrapped
        from its own ETH where the WETH contract logs that as a Deposit, not a Transfer, as WETH9 does (the wrap took a
        signature, which the record counts); tokens other than the {listOf(kinds)} &ldquo;What&apos;s inside&rdquo;
        reads, since anyone can send any token to any address, spam included; and transfers of 0, which anyone can log
        to any address to plant a look-alike sender.
      </p>
    </Card>
  );
}

/** The lines and totals of the chains done; `reading` names the chains still being read. */
function Lines({ view, reading }: { view: ReceivedView; reading: ChainInfo[] }) {
  const missing = new Set(view.chains.filter((c) => c.error || c.gaps.length > 0).map((c) => c.chain.id));
  const read = view.chains.filter((c) => !c.error);
  const still = reading.length > 0 && <p className="mt-2 text-sm text-muted">Still reading the logs on {listOf(reading.map((c) => c.name))}…</p>;
  if (view.lines.length === 0) {
    const none = noneCameIn(read.map((c) => c.chain));
    return (
      <>
        <p className="mt-3 text-sm text-muted">
          {read.length > 0
            ? `${read.some((c) => c.gaps.length > 0) ? `In the blocks read, ${none.replace(/^No/, "no")}` : none}.`
            : reading.length > 0
              ? "Nothing read yet."
              : "Nothing could be read; the notes below say why."}
        </p>
        {still}
      </>
    );
  }
  return (
    <>
      <ol className="mt-3 space-y-2 text-sm">
        {view.lines.map((l) => (
          <li key={`${l.chain.id}:${l.tx}:${l.logIndex}`} className="grid gap-x-3 sm:grid-cols-[9.5rem_1fr]">
            <span className="font-mono text-xs text-muted sm:pt-0.5">{l.at === null ? `block ${blocks(l.block)}` : `${when(l.at)} UTC`}</span>
            <span className="[overflow-wrap:anywhere]">
              {describeTransfer(l)} · <ExternalLink href={transferUrl(l)}>tx</ExternalLink>
            </span>
          </li>
        ))}
      </ol>
      {still}
      <h3 className="mt-4 text-sm font-semibold">In all</h3>
      <ul className="mt-1 space-y-1 text-sm">
        {view.totals.map((t) => (
          <li key={`${t.chain.id}:${t.token.address}`}>
            {amountText(t.amount, t.token)} on {t.chain.name}, in {plural(t.transfers, "transfer")}
            {missing.has(t.chain.id) && ", in the blocks read"}
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * Which chains were chosen and why, how far each was read, which weren't and why, and what couldn't
 * be read. `done` is false while some chains are still being read.
 */
function ScanNotes({ plan, view, done, onRetry }: { plan: ScanPlan; view: ReceivedView | null; done: boolean; onRetry: () => void }) {
  const failed = done && view?.chains.some((c) => c.error || c.gaps.length > 0);
  const chosen = [...plan.scan, ...plan.unscanned].map((s) => s.chain).sort((a, b) => CHAINS.indexOf(a) - CHAINS.indexOf(b));
  return (
    <div className="mt-3 space-y-1 text-xs text-muted">
      {plan.scan.length > 0 && (
        <p>
          {plan.raw
            ? `The record has a raw signature, which could be for any chain, so every one of this network's chains with tokens to read was chosen to scan: ${listOf(chosen.map((c) => c.name))}, `
            : `Chosen to scan: ${listOf(plan.scan.map((s) => `${s.chain.name} (${whyScanned(s)})`))}, `}
          from the first block at or after the contract&apos;s creation to the latest.
          {plan.raw && " The other network's chains aren't read here, though the address is the same on them."}
        </p>
      )}
      {plan.unscanned.map((u) => (
        <p key={u.chain.id} className="text-warn">
          {u.chain.name} isn&apos;t scanned, though {plan.raw ? "the record has a raw signature" : whyScanned(u)}: {u.reason}.
          Anything sent there isn&apos;t listed or counted.
        </p>
      ))}
      {view?.chains.map((c) =>
        c.error ? (
          <p key={c.chain.id} className="text-warn">
            {c.chain.name} couldn&apos;t be read at all: {c.error}.
          </p>
        ) : (
          <div key={c.chain.id}>
            <p>
              {c.chain.name}: blocks {blocks(c.from)} to {blocks(c.to ?? c.from)}, in {plural(c.reads, "read")} from {c.source}
              {c.found > c.shown ? `; the ${c.shown} newest of ${c.found} transfers are listed, and the total counts all ${c.found}.` : "."}
            </p>
            {c.gaps.map((g) => (
              <p key={String(g.from)} className="text-warn">
                Blocks {blocks(g.from)} to {blocks(g.to)} couldn&apos;t be read ({g.error}), so anything sent then isn&apos;t
                listed or counted.
              </p>
            ))}
          </div>
        ),
      )}
      {failed && (
        <div className="pt-2">
          <Button onClick={onRetry}>Scan again</Button>
        </div>
      )}
      {plan.skipped.length > 0 && (
        <p>
          Not scanned: {listOf(plan.skipped.map((c) => c.name))}. On {plan.skipped.length === 1 ? "it" : "each"}, the
          satchel holds none of the tokens &ldquo;What&apos;s inside&rdquo; reads there now, and the record has nothing on
          it. Anything that came in there and left through the satchel&apos;s key would show on the record, which counts
          every signature by chain.
        </p>
      )}
      {plan.none.length > 0 && (
        <p>
          {listOf(plan.none.map((c) => c.name))}: the page lists no USDC, USDT or WETH there, so there is nothing to read.
        </p>
      )}
      {plan.elsewhere.length > 0 && (
        <p>
          The record also has signatures for {listOf(plan.elsewhere.map(chainName))}, not one of this network&apos;s chains;
          this page reads nothing there.
        </p>
      )}
    </div>
  );
}
