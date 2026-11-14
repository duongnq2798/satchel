"use client";

import { useParams } from "next/navigation";
import { nearAccountUrl, nearRpcUrl } from "satchel-nft";
import { useNetwork } from "./network";
import { ExternalLink, Placeholder } from "./ui";

/** The board's heading: which DAO, on which network, read through which node. */
export function DaoHeading({ daoId }: { daoId: string }) {
  const net = useNetwork();
  const rpc = new URL(nearRpcUrl(net)).host;
  return (
    <div>
      <p className="text-sm text-muted">Sputnik DAO on NEAR {net.id}</p>
      <h1 className="font-display text-4xl font-semibold tracking-tight">Bounty board</h1>
      <p className="mt-2 text-ink-2 [overflow-wrap:anywhere]">
        <ExternalLink href={nearAccountUrl(net, daoId)}>{daoId}</ExternalLink>&apos;s open bounties, claims, payouts and each
        contributor&apos;s record, read in your browser from NEAR {net.id} through {rpc}. Nothing on this page signs or sends
        anything, and it needs no wallet.
      </p>
    </div>
  );
}

/** The board while the DAO's config and policy are read: its heading, then two cards' worth of shape. */
export function DaoBoardSkeleton({ daoId }: { daoId?: string }) {
  const params = useParams<{ id: string }>();
  const id = daoId ?? params.id;
  return (
    <div className="space-y-6">
      <DaoHeading daoId={id} />
      <p role="status" className="sr-only">
        Reading {id} from NEAR…
      </p>
      <Placeholder className="h-72 rounded-2xl!" />
      <Placeholder className="h-48 rounded-2xl!" />
    </div>
  );
}
