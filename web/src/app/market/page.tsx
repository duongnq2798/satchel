"use client";

import Link from "next/link";
import { useRef } from "react";
import { Badge, Card, ErrorNote, VERDICT, errorMessage } from "@/components/ui";
import { useAsync } from "@/components/use-async";
import { limiter } from "@/lib/limit";
import type { Listing } from "@/lib/near";
import { type ContractFacts, type Report, buildReport, contractFacts } from "@/lib/report";
import { formatNear, satchel } from "@/lib/satchel";

function ListingCard({
  tokenId,
  listing,
  check,
}: {
  tokenId: string;
  listing: Listing;
  check: (tokenId: string) => Promise<Report | null>;
}) {
  const report = useAsync(() => check(tokenId), tokenId);
  const verdict = report.data ? VERDICT[report.data.verdict] : null;
  return (
    <Link href={`/satchel/${tokenId}`}>
      <Card className="h-full transition hover:border-ink">
        <div className="flex items-center justify-between gap-2">
          <p className="font-display text-2xl font-semibold">#{tokenId}</p>
          {verdict ? (
            <Badge tone={verdict.tone}>{verdict.label}</Badge>
          ) : report.error ? (
            <span title={errorMessage(report.error)}>
              <Badge tone="bad">Couldn't check</Badge>
            </span>
          ) : (
            <Badge>Checking…</Badge>
          )}
        </div>
        <p className="mt-3 text-lg font-medium">{formatNear(listing.price)} NEAR</p>
        <p className="mt-1 text-sm text-muted">
          by {listing.seller} · record version {listing.record_version}
        </p>
      </Card>
    </Link>
  );
}

export default function Market() {
  const listings = useAsync(() => satchel.listings(0, 100), "listings");
  // One read of the contract's own facts for the whole page, and a few reports at a time.
  const facts = useRef<Promise<ContractFacts> | null>(null);
  const limit = useRef(limiter(3));
  const check = (tokenId: string) => {
    if (facts.current === null) {
      const read = contractFacts();
      read.catch(() => {
        facts.current = null;
      });
      facts.current = read;
    }
    const shared = facts.current;
    return limit.current(() => buildReport(tokenId, shared));
  };
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-4xl font-semibold tracking-tight">Market</h1>
        <p className="mt-1 max-w-2xl text-ink-2">
          Every listed satchel, with its clean transfer report run in your browser. A listed satchel can't sign, and a
          purchase goes through only for the record version you checked.
        </p>
      </div>
      <ErrorNote error={listings.error} />
      {listings.data?.length === 0 && (
        <Card>
          <h2 className="font-display text-xl font-semibold">No satchels are listed yet</h2>
          <p className="mt-1 text-sm text-muted">List one from its page; it shows up here with its report.</p>
        </Card>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {listings.data?.map(([id, listing]) => (
          <ListingCard key={id} tokenId={id} listing={listing} check={check} />
        ))}
      </div>
    </div>
  );
}
