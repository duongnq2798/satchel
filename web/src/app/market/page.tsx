"use client";

import Link from "next/link";
import { useNetwork } from "@/components/network";
import { ReportBadge, useReportChecker } from "@/components/report-checker";
import { Badge, Card, LoadState, Placeholder } from "@/components/ui";
import { useAsync } from "@/components/use-async";
import { type Listing, type Report, formatNear, satchel } from "satchel-nft";
import { FROZEN_UNTIL, isFrozen } from "@/lib/frozen";
import { appPath } from "@/lib/routes";
import { MINT_PATH, SALE_DEED_PATH, allDemo } from "@/lib/try-it";

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
            Buying is off in this app through judging (until {FROZEN_DAY}).
          </p>
        )}
      </Card>
    </Link>
  );
}

/** Three listing cards' shape: the id, the price and the seller line, at their loaded heights. */
function ListingSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <Card key={i} className="h-full">
          <Placeholder className="h-8 w-16" />
          <Placeholder className="mt-3 h-7 w-28" />
          <Placeholder className="mt-1 h-5 w-48" />
        </Card>
      ))}
    </div>
  );
}

export default function Market() {
  const net = useNetwork();
  const listings = useAsync(() => satchel(net).allListings(), `${net.id}:listings`);
  const check = useReportChecker();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-4xl font-semibold tracking-tight">Market</h1>
        <p className="mt-1 text-ink-2">
          Every listed satchel, with its clean transfer report run in your browser. A listed satchel can't sign, and a
          purchase goes through only for the record version you checked.
        </p>
      </div>
      <LoadState state={listings} what="the listings" skeleton={<ListingSkeleton />}>
        {(data) => <Listings listings={data} check={check} />}
      </LoadState>
    </div>
  );
}

/** The listings once read: the demo note when every one is a demo satchel, the empty card, then the grid. */
function Listings({ listings, check }: { listings: [string, Listing][]; check: (tokenId: string) => Promise<Report | null> }) {
  const net = useNetwork();
  const onlyDemo = allDemo(net, listings.map(([id]) => id));
  return (
    <div className="space-y-6">
      {onlyDemo && (
        <p className="text-sm text-ink-2">
          Every satchel listed here is a demo satchel. Buying them is off in this app through judging (until{" "}
          <span className="whitespace-nowrap">{FROZEN_DAY})</span>, to keep the state the README quotes for them. See a
          finished sale in{" "}
          <Link
            href={SALE_DEED_PATH}
            className="font-medium text-leather underline decoration-line underline-offset-4 hover:decoration-ink"
          >
            mainnet satchel #3&apos;s deed of sale
          </Link>{" "}
          (a self-sale between two of the builder&apos;s accounts), or{" "}
          <Link
            href={MINT_PATH}
            className="font-medium text-leather underline decoration-line underline-offset-4 hover:decoration-ink"
          >
            mint your own on testnet
          </Link>
          , list it from its page and buy it from a second testnet wallet.
        </p>
      )}
      {listings.length === 0 && (
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
        {listings.map(([id, listing]) => (
          <ListingCard key={id} tokenId={id} listing={listing} check={check} />
        ))}
      </div>
    </div>
  );
}
