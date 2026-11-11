"use client";

import { Component, type ReactNode } from "react";
import { type HistoryEntry, type SigningRecord, describeEntry, nearTxUrl, signatureCounts, tokenAddress, tokenHistory } from "satchel-nft";
import { type SwapMark, sendKey, sendsToLookUp, swapMarks } from "@/lib/oneclick";
import { useNetwork } from "./network";
import { Button, Card, ErrorNote, ExternalLink } from "./ui";
import { useAsync } from "./use-async";

const when = (at: number) => new Date(at).toISOString().slice(0, 16).replace("T", " ");

type Props = { tokenId: string; record: SigningRecord; refresh: number };

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
  // what came of it. Silent when 1Click doesn't know an address or doesn't answer.
  const lookups = net.id === "mainnet" && found ? sendsToLookUp(found.entries) : [];
  const swaps = useAsync(
    async (): Promise<Map<string, SwapMark>> =>
      lookups.length === 0 ? new Map() : swapMarks(lookups, await tokenAddress(net, `satchel/${tokenId}`)),
    `${net.id}:${tokenId}:${refresh}:${lookups.map(sendKey).join(",")}`,
  );
  const marked = (e: HistoryEntry) => (e.kind === "sign_evm" ? swaps.data?.get(sendKey(e)) : undefined);

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
                    {swap && (
                      <span className="mt-0.5 block text-xs text-ink-2">
                        {swap.line} · <ExternalLink href={swap.url}>1Click&apos;s status</ExternalLink>
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
          {swaps.data && swaps.data.size > 0 && (
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
