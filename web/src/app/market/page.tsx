"use client";

import Link from "next/link";
import { useNetwork } from "@/components/network";
import { ReportBadge, useReportChecker } from "@/components/report-checker";
import { Badge, Card, ErrorNote } from "@/components/ui";
import { useAsync } from "@/components/use-async";
import { type Listing, type Report, formatNear, satchel } from "satchel-nft";
import { FROZEN_UNTIL, isFrozen } from "@/lib/frozen";
import { appPath } from "@/lib/routes";

const FROZEN_DAY = FROZEN_UNTIL.toISOString().slice(0, 10);

function ListingCard({
  tokenId,
  listing,
  check,
}: {
  tokenId: string;
  listing: Listing;
  check: (tokenId: string) => Promise<Report | null>;
}) {
  const net = useNetwork();
  const report = useAsync(() => check(tokenId), `${net.id}:${tokenId}`);
  return (
    <Link href={appPath(net, `/satchel/${tokenId}`)}>
      <Card className="h-full transition hover:border-ink">
        <div className="flex items-center justify-between gap-2">
          <p className="font-display text-2xl font-semibold">#{tokenId}</p>
          <ReportBadge report={report} />
        </div>
        <p className="mt-3 text-lg font-medium">{formatNear(listing.price)} NEAR</p>
        <p className="mt-1 text-sm text-muted">
          by {listing.seller} · record version {listing.record_version}
        </p>
        {isFrozen(net, tokenId) && (
          <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-ink-2">
            <Badge tone="gold">Demo satchel</Badge>
            This app won&apos;t buy it until {FROZEN_DAY}.
          </p>
        )}
      </Card>
    </Link>
  );
}

export default function Market() {
  const net = useNetwork();
  const listings = useAsync(() => satchel(net).allListings(), `${net.id}:listings`);
  const check = useReportChecker();
  const allDemo = Boolean(listings.data?.length) && listings.data?.every(([id]) => isFrozen(net, id));
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-4xl font-semibold tracking-tight">Market</h1>
        <p className="mt-1 text-ink-2">
          Every listed satchel, with its clean transfer report run in your browser. A listed satchel can't sign, and a
          purchase goes through only for the record version you checked.
        </p>
      </div>
      <ErrorNote error={listings.error} />
      {allDemo && (
        <p className="text-sm text-ink-2">
          Every satchel listed here is a demo satchel whose state the README quotes, so this app won&apos;t buy one until{" "}
          {FROZEN_DAY}. To see a sale through,{" "}
          <Link
            href={appPath(net, "/satchels")}
            className="font-medium text-leather underline decoration-line underline-offset-4 hover:decoration-ink"
          >
            mint a satchel
          </Link>
          , list it from its page and buy it from a second wallet.
        </p>
      )}
      {listings.data?.length === 0 && (
        <Card>
          <h2 className="font-display text-xl font-semibold">No satchels are listed yet</h2>
          <p className="mt-1 text-sm text-muted">List one from its page; it shows up here with its report.</p>
          {net.id === "mainnet" && (
            <p className="mt-3 text-sm text-ink-2">
              Satchels #1 to #3 aren&apos;t for sale: #1 and #2 have sent ETH on Base from this app, #2 into a swap through
              1Click, and #3 was sold between two of the builder&apos;s accounts:{" "}
              <Link
                href={`${appPath(net, "/")}#showcase`}
                className="font-medium text-leather underline decoration-line underline-offset-4 hover:decoration-ink"
              >
                see what they did
              </Link>
              .
            </p>
          )}
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
