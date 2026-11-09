"use client";

import { useRef, useState } from "react";
import type { SatchelView } from "@/lib/near";
import { assertReceiver } from "@/lib/guard";
import type { Report } from "@/lib/report";
import { type WalletTx, formatNear, parseNear, satchelTx } from "@/lib/satchel";
import { useNetwork } from "./network";
import { Button, Card, ErrorNote } from "./ui";
import { useWallet } from "./wallet";

/** Runs one wallet transaction at a time and hands its hash to `onDone`, which shows it. */
function useTx(onDone: (hash?: string) => void) {
  const { send } = useWallet();
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function run(build: () => WalletTx | Promise<WalletTx>) {
    if (running.current) return;
    running.current = true;
    setError(null);
    setBusy(true);
    let hash: string | undefined;
    try {
      hash = (await send(await build())).hash;
    } catch (err) {
      setError(err);
    } finally {
      running.current = false;
      setBusy(false);
      onDone(hash);
    }
  }
  return { busy, error, run };
}

/** The owner's side: list, delist, or transfer the NFT. */
export function OwnerSale({ token, onDone }: { token: SatchelView; onDone: (hash?: string) => void }) {
  const tx = useTx(onDone);
  const net = useNetwork();
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
          <Button busy={tx.busy} onClick={() => tx.run(() => satchelTx(net).delist(token.token_id))}>
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
              onClick={() => tx.run(() => satchelTx(net).list(token.token_id, parseNear(price)))}
            >
              List for sale
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 border-t border-line pt-3">
            <input
              value={receiver}
              onChange={(e) => setReceiver(e.target.value.trim())}
              placeholder={`Receiver, like ${net.id === "testnet" ? "friend.testnet" : "friend.near"}`}
              className="w-64 rounded-xl border border-line bg-paper px-3 py-2 text-sm"
            />
            <Button
              busy={tx.busy}
              onClick={() =>
                tx.run(async () => {
                  // The contract takes any name, and an NFT sent to one that doesn't exist is lost.
                  await assertReceiver(net, receiver);
                  return satchelTx(net).transfer(token.token_id, receiver);
                })
              }
            >
              Transfer the NFT
            </Button>
          </div>
        </div>
      )}
      <div className="mt-3">
        <ErrorNote error={tx.error} />
      </div>
    </Card>
  );
}

/**
 * A buyer's side. The purchase takes its record version and price from the report, never from the
 * rest of the page, so it names exactly what the buyer checked; any later signature voids it.
 */
export function BuyPanel({
  token,
  report,
  onDone,
}: {
  token: SatchelView;
  report: Report | undefined;
  onDone: (hash?: string) => void;
}) {
  const { accountId, signIn } = useWallet();
  const tx = useTx(onDone);
  const net = useNetwork();
  // The version whose risk the buyer accepted, so a new version asks again.
  const [accepted, setAccepted] = useState<string | null>(null);
  const [note, setNote] = useState("");
  if (!token.listing) return null;

  const checked =
    report &&
    report.network === net.id &&
    report.contract === net.contract &&
    report.tokenId === token.token_id &&
    report.listing &&
    report.listing.record_version === report.recordVersion
      ? { report, listing: report.listing }
      : undefined;
  const listing = checked?.listing ?? token.listing;
  const clean = checked?.report.verdict === "clean";
  const accept = checked !== undefined && accepted === checked.report.recordVersion;
  // The page and the report read the token separately; buy only once they agree.
  const agrees = checked !== undefined && checked.report.recordVersion === token.record.version;

  return (
    <Card className="border-gold/60">
      <h2 className="font-display text-xl font-semibold">For sale: {formatNear(listing.price)} NEAR</h2>
      <p className="mt-1 text-sm text-muted">
        Sold by {listing.seller}. Your purchase names record version {checked?.report.recordVersion ?? token.record.version}
        , the one the report above checked; if the seller signed anything since, the contract refuses the sale and you keep
        your NEAR.
      </p>
      {!checked && <p className="mt-3 text-sm text-muted">Waiting for the report on this listing…</p>}
      {checked && !agrees && (
        <p className="mt-3 text-sm text-warn">The record changed while this page loaded. Check again before you buy.</p>
      )}
      {checked && !clean && (
        <label className="mt-3 flex items-start gap-2 text-sm text-warn">
          <input
            type="checkbox"
            checked={accept}
            onChange={(e) => setAccepted(e.target.checked ? checked.report.recordVersion : null)}
            className="mt-1"
          />
          This satchel is not provably clean (see the report). I accept that the seller may still be able to move what it
          holds.
        </label>
      )}
      <div className="mt-3">
        {accountId === null ? (
          <Button variant="primary" onClick={() => signIn().catch(() => {})}>
            Connect to buy
          </Button>
        ) : (
          <Button
            variant="gold"
            busy={tx.busy}
            onClick={() => {
              if (!checked) return setNote("Wait for the report on this listing first");
              if (!agrees) return setNote("Check again: the page and the report read different record versions");
              if (!clean && !accept) return setNote("Tick the box above to buy a satchel that is not provably clean");
              setNote("");
              tx.run(() => satchelTx(net).buy(token.token_id, checked.report.recordVersion, BigInt(checked.listing.price)));
            }}
          >
            Buy for {formatNear(listing.price)} NEAR
          </Button>
        )}
      </div>
      <div className="mt-3 space-y-2">
        {note && <p className="text-sm text-warn">{note}</p>}
        <ErrorNote error={tx.error} />
      </div>
    </Card>
  );
}
