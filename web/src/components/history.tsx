"use client";

import { type SigningRecord, describeEntry, nearTxUrl, signatureCounts, tokenHistory } from "satchel-nft";
import { useNetwork } from "./network";
import { Button, Card, ErrorNote, ExternalLink } from "./ui";
import { useAsync } from "./use-async";

const when = (at: number) => new Date(at).toISOString().slice(0, 16).replace("T", " ");

/** A satchel's mint, owners, signatures, listings and sales, from FastNEAR's transaction index. */
export function History({ tokenId, record, refresh }: { tokenId: string; record: SigningRecord; refresh: number }) {
  const net = useNetwork();
  const history = useAsync(() => tokenHistory(net, tokenId), `${net.id}:${tokenId}:${refresh}`);
  const found = history.data;
  const counts = found && signatureCounts(found, record);

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
          {found.entries.length === 0 && <p className="mt-3 text-sm text-muted">The index holds nothing about this satchel yet.</p>}
          <ol className="mt-3 space-y-2 text-sm">
            {found.entries.map((e, i) => (
              <li key={`${e.tx}:${i}`} className="grid gap-x-3 sm:grid-cols-[9.5rem_1fr]">
                <span className="font-mono text-xs text-muted sm:pt-0.5">{when(e.at)} UTC</span>
                <span className="[overflow-wrap:anywhere]">
                  {describeEntry(e)} · <ExternalLink href={nearTxUrl(net, e.tx)}>tx</ExternalLink>
                </span>
              </li>
            ))}
          </ol>
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
