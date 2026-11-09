"use client";

import { useState } from "react";
import { nearTxUrl } from "@/lib/config";
import type { SatchelView } from "@/lib/near";
import type { Report } from "@/lib/report";
import { formatNear, parseNear, satchelTx } from "@/lib/satchel";
import { Button, Card, ErrorNote, ExternalLink } from "./ui";
import { useWallet } from "./wallet";

function useTx(onDone: () => void) {
  const { send } = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [hash, setHash] = useState<string | null>(null);
  async function run(build: () => Parameters<typeof send>[0]) {
    setError(null);
    setHash(null);
    setBusy(true);
    try {
      setHash((await send(build())).hash);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
      onDone();
    }
  }
  return { busy, error, hash, run };
}

function Done({ hash }: { hash: string | null }) {
  if (!hash) return null;
  return (
    <p className="text-sm text-ok">
      Done. <ExternalLink href={nearTxUrl(hash)}>View the transaction</ExternalLink>
    </p>
  );
}

/** The owner's side: list, delist, or transfer the NFT. */
export function OwnerSale({ token, onDone }: { token: SatchelView; onDone: () => void }) {
  const tx = useTx(onDone);
  const [price, setPrice] = useState("");
  const [receiver, setReceiver] = useState("");

  return (
    <Card>
      <h2 className="font-display text-xl font-semibold">Sell or transfer</h2>
      {token.listing ? (
        <div className="mt-3 space-y-3">
          <p className="text-sm">
            Listed for <strong>{formatNear(token.listing.price)} NEAR</strong> at record version {token.listing.record_version}.
            Signing is frozen until you delist or it sells.
          </p>
          <Button busy={tx.busy} onClick={() => tx.run(() => satchelTx.delist(token.token_id))}>
            Delist
          </Button>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-muted">
            Listing freezes signing, so the record a buyer checks can't change under them. A buyer pays in NEAR and the NFT
            moves in the same transaction.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="Price in NEAR, like 5"
              inputMode="decimal"
              className="w-48 rounded-xl border border-line bg-paper px-3 py-2 text-sm"
            />
            <Button
              variant="primary"
              busy={tx.busy}
              onClick={() => tx.run(() => satchelTx.list(token.token_id, parseNear(price)))}
            >
              List for sale
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 border-t border-line pt-3">
            <input
              value={receiver}
              onChange={(e) => setReceiver(e.target.value.trim())}
              placeholder="Receiver, like friend.testnet"
              className="w-64 rounded-xl border border-line bg-paper px-3 py-2 text-sm"
            />
            <Button
              busy={tx.busy}
              onClick={() =>
                tx.run(() => {
                  if (!/^[a-z0-9._-]{2,64}$/.test(receiver)) throw new Error("Enter the receiver's NEAR account, like friend.testnet");
                  return satchelTx.transfer(token.token_id, receiver);
                })
              }
            >
              Transfer the NFT
            </Button>
          </div>
        </div>
      )}
      <div className="mt-3 space-y-2">
        <ErrorNote error={tx.error} />
        <Done hash={tx.hash} />
      </div>
    </Card>
  );
}

/** A buyer's side. `buy` names the record version this report checked; any later signature voids it. */
export function BuyPanel({ token, report, onDone }: { token: SatchelView; report: Report | undefined; onDone: () => void }) {
  const { accountId, signIn } = useWallet();
  const tx = useTx(onDone);
  const [accept, setAccept] = useState(false);
  const [note, setNote] = useState("");
  const listing = token.listing;
  if (!listing) return null;
  const checked = report && report.recordVersion === token.record.version ? report : undefined;
  const clean = checked?.verdict === "clean";

  return (
    <Card className="border-gold/60">
      <h2 className="font-display text-xl font-semibold">For sale: {formatNear(listing.price)} NEAR</h2>
      <p className="mt-1 text-sm text-muted">
        Sold by {listing.seller}. Your purchase names record version {token.record.version}; if the seller signed anything
        since this report, the contract refuses the sale and you keep your NEAR.
      </p>
      {!checked && <p className="mt-3 text-sm text-muted">Waiting for the report on this version…</p>}
      {checked && !clean && (
        <label className="mt-3 flex items-start gap-2 text-sm text-warn">
          <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} className="mt-1" />
          This satchel is not provably clean (see the report). I accept that the seller may still be able to move what it
          holds.
        </label>
      )}
      <div className="mt-3">
        {accountId === null ? (
          <Button variant="primary" onClick={() => signIn().catch(() => {})}>
            Connect to buy
          </Button>
        ) : accountId === listing.seller ? (
          <p className="text-sm text-muted">This is your listing.</p>
        ) : (
          <Button
            variant="gold"
            busy={tx.busy}
            onClick={() => {
              if (!checked) return setNote("Wait for the report on this version first");
              if (!clean && !accept) return setNote("Tick the box above to buy a satchel that is not provably clean");
              setNote("");
              tx.run(() => satchelTx.buy(token.token_id, checked.recordVersion, BigInt(listing.price)));
            }}
          >
            Buy for {formatNear(listing.price)} NEAR
          </Button>
        )}
      </div>
      <div className="mt-3 space-y-2">
        {note && <p className="text-sm text-warn">{note}</p>}
        <ErrorNote error={tx.error} />
        <Done hash={tx.hash} />
      </div>
    </Card>
  );
}
