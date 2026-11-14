"use client";

import { useParams } from "next/navigation";
import type { ReactNode } from "react";
import { CHAINS, sendChains } from "satchel-nft";
import type { WaitPhase } from "@/lib/timing";
import { useNetwork } from "./network";
import { ReportCard } from "./report-card";
import { Card, Placeholder, WaitLine } from "./ui";

/** The page's heading, the same while the satchel loads and after, so it never moves. */
export function Heading({ tokenId }: { tokenId: string }) {
  return (
    <>
      <h1 className="font-display text-4xl font-semibold tracking-tight [overflow-wrap:anywhere]">Satchel #{tokenId}</h1>
      <p className="mt-2 text-ink-2">
        A satchel is an NFT on NEAR that controls one address on {CHAINS.length} EVM chains, and this page checks, in
        your browser, what its previous owners could have kept back.
      </p>
    </>
  );
}

/**
 * The address card's shape before the address shows: while the satchel loads, and while the
 * contract's check runs (`note` then says so where the address goes). The chains are the ones
 * "What's inside" reads, each still to be read.
 */
export function AddressPending({ note }: { note?: ReactNode }) {
  const net = useNetwork();
  return (
    <>
      <div className="mt-1 flex min-h-14 items-center sm:min-h-7">{note ?? <Placeholder className="h-6 w-full max-w-md" />}</div>
      <Placeholder className="mt-1 h-12 sm:h-8 lg:h-4" />
      <h2 className="mt-5 font-display text-xl font-semibold">What&apos;s inside</h2>
      <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {sendChains(net).map((chain) => (
          <li key={chain.id} className="rounded-xl border border-line px-3 py-2">
            <p className="text-xs text-muted">{chain.name}</p>
            <p className="text-sm">…</p>
          </li>
        ))}
      </ul>
      <Placeholder className="mt-3 h-32 sm:h-16 lg:h-12" />
    </>
  );
}

/** The page while the satchel loads: its heading, then each card at about its loaded height. Slow or timed out, the owner line says so. */
export function TokenSkeleton({ tokenId, wait, onRetry }: { tokenId?: string; wait?: WaitPhase; onRetry?: () => unknown }) {
  const params = useParams<{ id: string }>();
  const id = tokenId ?? params.id;
  const late = wait === "slow" || wait === "timeout";
  return (
    <div className="space-y-6">
      <div>
        <Heading tokenId={id} />
        <div className="mt-4 flex min-h-5 items-center">
          {late ? (
            <WaitLine
              wait={wait}
              timeout={
                <>
                  No answer in 15 s.{" "}
                  {onRetry && (
                    <button type="button" onClick={onRetry} className="font-medium underline underline-offset-4">
                      Try again
                    </button>
                  )}
                </>
              }
            >
              Still reading. Public RPC nodes can be slow.
            </WaitLine>
          ) : (
            <Placeholder className="h-5 w-full max-w-sm" />
          )}
        </div>
      </div>
      <ReportCard report={undefined} loading error={null} onRecheck={() => {}} />
      <Card>
        <p className="text-xs text-muted">One address on {CHAINS.length} EVM chains, signed for only when this NFT's owner asks</p>
        <AddressPending />
      </Card>
      <Placeholder className="h-36 rounded-2xl!" />
      <Placeholder className="h-64 rounded-2xl!" />
    </div>
  );
}
