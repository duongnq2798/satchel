"use client";

import { Component, type ReactNode, useEffect, useRef, useState } from "react";
import { type HistoryEntry, type SigningRecord, describeEntry, nearTxUrl, signatureCounts, tokenAddress, tokenHistory } from "satchel-nft";
import { type SwapMark, historyLookups, sendKey, swapMark, swapMarks } from "@/lib/oneclick";
import { useNetwork } from "./network";
import { Button, Card, ErrorNote, ExternalLink, errorMessage } from "./ui";
import { useAsync } from "./use-async";

const when = (at: number) => new Date(at).toISOString().slice(0, 16).replace("T", " ");

type Props = { tokenId: string; record: SigningRecord; refresh: number };
type SignEvmEntry = Extract<HistoryEntry, { kind: "sign_evm" }>;
/** Where a send the reader asked 1Click about stands: `mark` is null when 1Click knows no swap it paid into. */
type Asked = { state: "asking" } | { state: "answered"; mark: SwapMark | null } | { state: "failed"; error: unknown };

/** A satchel's mint, owners, signatures, listings and sales, from FastNEAR's transaction index. */
export function History(props: Props) {
  return (
    <Contained>
      <HistoryCard {...props} />
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
        <h2 className="font-display text-xl font-semibold">History</h2>
        <p className="mt-1 text-sm text-muted">The history couldn&apos;t be shown. The report doesn&apos;t use it.</p>
      </Card>
    );
  }
}

function HistoryCard({ tokenId, record, refresh }: Props) {
  const net = useNetwork();
  const history = useAsync(() => tokenHistory(net, tokenId), `${net.id}:${tokenId}:${refresh}`);
  const found = history.data;
  const counts = found && signatureCounts(found, record);
  // Mainnet: 1Click's status for the latest sends' recipients, so a deposit into a 1Click swap says
  // what came of it. The page asks on its own only about a deposit address the app knows, silently
  // when 1Click doesn't answer; any other send gets a button that asks, since 1Click answers 404 for
  // an address it has no quote for, which the browser logs as an error.
  const { known, onClick } = net.id === "mainnet" && found ? historyLookups(found.entries) : { known: [], onClick: [] };
  const askable = new Set(onClick.map(sendKey));
  const satchel = () => tokenAddress(net, `satchel/${tokenId}`);
  const swaps = useAsync(
    async (): Promise<Map<string, SwapMark>> => (known.length === 0 ? new Map() : swapMarks(known, await satchel())),
    `${net.id}:${tokenId}:${refresh}:${known.map(sendKey).join(",")}`,
  );
  const [asked, setAsked] = useState<ReadonlyMap<string, Asked>>(new Map());
  const ask = (send: SignEvmEntry) => {
    const key = sendKey(send);
    if (asked.get(key)?.state === "asking") return;
    const set = (state: Asked) => setAsked((m) => new Map(m).set(key, state));
    set({ state: "asking" });
    satchel()
      .then((address) => swapMark(send, address))
      .then(
        (mark) => set({ state: "answered", mark }),
        (error: unknown) => set({ state: "failed", error }),
      );
  };
  const marked = (e: HistoryEntry): SwapMark | undefined => {
    if (e.kind !== "sign_evm") return undefined;
    const answer = asked.get(sendKey(e));
    return swaps.data?.get(sendKey(e)) ?? (answer?.state === "answered" ? (answer.mark ?? undefined) : undefined);
  };

  return (
    <Card>
      <h2 className="font-display text-xl font-semibold">History</h2>
      <p className="mt-1 text-sm text-muted">
        Everything the contract logged about this satchel, oldest first. It comes from FastNEAR&apos;s transaction index,
        not from the contract&apos;s state, and the report doesn&apos;t use it; each line links its transaction.
      </p>
      {history.error ? (
        <div className="mt-3 space-y-3">
          <ErrorNote error={history.error} />
          <Button onClick={history.reload}>Try again</Button>
        </div>
      ) : !found ? (
        <p className="mt-3 text-sm text-muted">Reading the contract&apos;s transactions…</p>
      ) : (
        <>
          {found.entries.length === 0 && (
            <p className="mt-3 text-sm text-muted">
              {found.complete
                ? "The index holds nothing about this satchel yet."
                : `Nothing about this satchel in the contract's ${found.scanned} newest transactions.`}
            </p>
          )}
          <ol className="mt-3 space-y-2 text-sm">
            {found.entries.map((e, i) => {
              const swap = marked(e);
              return (
                <li key={`${e.tx}:${i}`} className="grid gap-x-3 sm:grid-cols-[9.5rem_1fr]">
                  <span className="font-mono text-xs text-muted sm:pt-0.5">{when(e.at)} UTC</span>
                  <span className="[overflow-wrap:anywhere]">
                    {describeEntry(e)} · <ExternalLink href={nearTxUrl(net, e.tx)}>tx</ExternalLink>
                    {e.kind === "sign_evm" && askable.has(sendKey(e)) ? (
                      <AskOneClick asked={asked.get(sendKey(e))} onAsk={() => ask(e)} />
                    ) : (
                      swap && (
                        <span className="mt-0.5 block text-xs text-ink-2">
                          <SwapLine swap={swap} />
                        </span>
                      )
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
          {found.entries.some((e) => marked(e)) && (
            <p className="mt-3 text-xs text-muted">
              A &ldquo;1Click swap&rdquo; line is 1Click&apos;s word, not the contract&apos;s: its status for the address that send
              paid, read now from 1click.chaindefuser.com. The record and the report don&apos;t use it.
            </p>
          )}
          <p className="mt-3 text-xs text-muted">
            Read from {new URL(found.source).host}: {found.scanned} of the contract&apos;s transactions
            {found.complete ? "." : ", not all of them, so the oldest are missing."}
          </p>
          {counts && counts.history !== counts.record && (
            <p className="mt-1 text-xs text-warn">
              It shows {counts.history} signature(s); the contract&apos;s record counts {counts.record}. The record is what
              the report checks.
            </p>
          )}
        </>
      )}
    </Card>
  );
}

/** A 1Click swap line: what 1Click says came of the swap, and a link to its status or payout. */
function SwapLine({ swap }: { swap: SwapMark }) {
  return (
    <>
      {swap.line} · <ExternalLink href={swap.url}>{swap.payout ? "payout tx" : "1Click's status"}</ExternalLink>
    </>
  );
}

/**
 * For a send to an address the app doesn't know as a 1Click deposit: a button that asks 1Click about
 * it, then what 1Click said. The live region is there from the first render, so a screen reader reads
 * the answer out. When the answer replaces the button, focus moves to it; when asking fails, focus
 * stays on the button, which then offers to ask again.
 */
function AskOneClick({ asked, onAsk }: { asked: Asked | undefined; onAsk: () => void }) {
  const answer = useRef<HTMLSpanElement>(null);
  const wasAsking = useRef(false);
  useEffect(() => {
    if (asked?.state === "asking") wasAsking.current = true;
    else if (wasAsking.current) {
      wasAsking.current = false;
      if (asked?.state === "answered") answer.current?.focus();
    }
  }, [asked]);
  const asking = asked?.state === "asking";
  return (
    <span aria-live="polite" className="block">
      {asked?.state === "answered" ? (
        <span ref={answer} tabIndex={-1} className={`mt-0.5 block text-xs ${asked.mark ? "text-ink-2" : "text-muted"}`}>
          {asked.mark ? <SwapLine swap={asked.mark} /> : "1Click knows no swap this send paid into."}
        </span>
      ) : (
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <button
            type="button"
            onClick={onAsk}
            aria-disabled={asking}
            aria-busy={asking}
            className="rounded-full border border-line px-3 py-1 text-xs text-ink-2 transition hover:border-ink aria-busy:cursor-progress"
          >
            {asking ? "Asking 1Click…" : asked?.state === "failed" ? "Ask 1Click again" : "Check with 1Click"}
          </button>
          {asked?.state === "failed" && <span className="text-bad">{errorMessage(asked.error)}</span>}
        </span>
      )}
    </span>
  );
}
