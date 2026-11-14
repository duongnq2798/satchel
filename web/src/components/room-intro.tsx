"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ROOM_RECIPIENT } from "satchel-nft";
import { appPath } from "@/lib/routes";
import { useNetwork } from "./network";
import { Card } from "./ui";
import { WalletPending } from "./wallet-pending";

/** The holder room's heading and how it checks: the same before the wallet answers and after. */
export function RoomIntro({ tokenId }: { tokenId: string }) {
  const net = useNetwork();
  return (
    <>
      <div>
        <p className="text-sm text-muted">
          <Link href={appPath(net, `/satchel/${tokenId}`)} className="underline decoration-line underline-offset-4 hover:decoration-ink">
            Satchel #{tokenId}
          </Link>
        </p>
        <h1 className="font-display text-4xl font-semibold tracking-tight">Holder room</h1>
        <p className="mt-2 text-ink-2">
          Only the account that owns satchel #{tokenId} right now can open this room. Sell or transfer the satchel and it
          opens for the new holder, not for you: the right to open it moves with the NFT.
        </p>
      </div>

      <Card>
        <h2 className="font-display text-xl font-semibold">How it checks</h2>
        <ul className="mt-2 max-w-[36em] list-disc space-y-1 pl-5 text-sm text-ink-2">
          <li>Your wallet signs a message (NEP-413) for {ROOM_RECIPIENT}. It is not a transaction and costs nothing.</li>
          <li>
            The server checks the signature, that the key is a full-access key of your account, and that your account owns
            satchel #{tokenId} on {net.contract}, the last two read at one final NEAR block.
          </li>
          <li>It checks again on every request. No cookie, no session; nothing is stored.</li>
          <li>
            Nothing in the room is secret: the card and the kit come from public chain data. What the room shows is the gate.
          </li>
        </ul>
      </Card>
    </>
  );
}

/** The room's first render, for its route's fallback: the intro, then the wallet being looked up. */
export function RoomSkeleton() {
  const { id } = useParams<{ id: string }>();
  return (
    <div className="space-y-6">
      <RoomIntro tokenId={id} />
      <Card>
        <WalletPending />
      </Card>
    </div>
  );
}
