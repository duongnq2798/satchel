"use client";

import { nearTxUrl } from "satchel-nft";
import { ErrorNote, ExternalLink } from "@/components/ui";
import { lastTx } from "@/lib/last-tx";
import "./globals.css";

/** A crash in the root layout itself: its own document and styles, with the same words as error.tsx and no network or wallet. */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const tx = lastTx();
  return (
    <html lang="en">
      <body className="min-h-screen bg-paper text-ink">
        <title>This page couldn&apos;t be shown · Satchel</title>
        <main className="mx-auto max-w-2xl space-y-4 px-4 py-16">
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
            <a href="/" className="rounded-full border border-ink px-6 py-3 text-sm font-medium transition hover:bg-card">
              Home
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
