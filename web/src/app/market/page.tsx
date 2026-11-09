"use client";

import Link from "next/link";
import { Badge, Card, ErrorNote, VERDICT } from "@/components/ui";
import { useAsync } from "@/components/use-async";
import type { Listing } from "@/lib/near";
import { buildReport } from "@/lib/report";
import { formatNear, satchel } from "@/lib/satchel";

function ListingCard({ tokenId, listing }: { tokenId: string; listing: Listing }) {
  const report = useAsync(() => buildReport(tokenId), tokenId);
  const verdict = report.data ? VERDICT[report.data.verdict] : null;
  return (
    <Link href={`/satchel/${tokenId}`}>
      <Card className="h-full transition hover:border-ink">
        <div className="flex items-center justify-between gap-2">
          <p className="font-display text-2xl font-semibold">#{tokenId}</p>
          {verdict ? <Badge tone={verdict.tone}>{verdict.label}</Badge> : <Badge>Checking…</Badge>}
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
          <ListingCard key={id} tokenId={id} listing={listing} />
        ))}
      </div>
    </div>
  );
}
