"use client";

import { nearTxUrl } from "satchel-nft";
import { NetLink } from "@/components/site-header";
import { ErrorNote, ExternalLink } from "@/components/ui";
import { lastTx } from "@/lib/last-tx";

/** A part of a page that crashed while rendering. It sits inside the root layout, so the header, the footer and the wallet stay. */
export default function PageError({ error, retry }: { error: unknown; retry: () => void }) {
  const tx = lastTx();
  return (
    <div className="mx-auto max-w-2xl space-y-4 py-6">
      <h1 className="font-display text-4xl font-semibold tracking-tight">This part of the page couldn&apos;t be shown</h1>
      <ErrorNote error={error} onRetry={retry} />
      <p className="text-ink-2">
        If a transaction was running, check it in the satchel&apos;s History or on NearBlocks before you try it again.
      </p>
      {tx && (
        <p className="text-ink-2">
          The last transaction this page sent: <ExternalLink href={nearTxUrl(tx.net, tx.hash)}>View it</ExternalLink>
        </p>
      )}
      <div className="flex flex-wrap gap-3 pt-2">
        <NetLink href="/" follow className="rounded-full border border-ink px-6 py-3 text-sm font-medium transition hover:bg-card">
          Home
        </NetLink>
      </div>
    </div>
  );
}
