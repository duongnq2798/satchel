"use client";

import { useEffect, useRef, useState } from "react";
import {
  type Network,
  type Report,
  type SatchelView,
  type WalletTx,
  assertReceiver,
  formatNear,
  parseNear,
  satchelTx,
} from "satchel-nft";
import { useNetwork } from "./network";
import { FrozenNote } from "./send-panel";
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
export function OwnerSale({
  token,
  onDone,
  frozen = false,
}: {
  token: SatchelView;
  onDone: (hash?: string) => void;
  /** A demo satchel: list, delist and transfer are off (`lib/frozen.ts`). */
  frozen?: boolean;
}) {
  const tx = useTx(onDone);
  const net = useNetwork();
  const [price, setPrice] = useState("");
  const [receiver, setReceiver] = useState("");
  // The receiver the owner is asked to confirm, once it passed the receiver check.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [receiverError, setReceiverError] = useState<unknown>(null);
  // Focus moves to the question when it opens, so a screen reader reads it, and back to the field on Cancel.
  const question = useRef<HTMLParagraphElement>(null);
  const receiverField = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (confirming !== null) question.current?.focus();
  }, [confirming]);

  async function askToTransfer() {
    setReceiverError(null);
    setChecking(true);
    try {
      // The contract takes any name, and an NFT sent to one that doesn't exist is lost.
      await assertReceiver(net, receiver);
      setConfirming(receiver);
    } catch (err) {
      setReceiverError(err);
    } finally {
      setChecking(false);
    }
  }

  function transfer(to: string) {
    tx.run(async () => {
      // Checked again: the account could have changed since the owner asked.
      await assertReceiver(net, to);
      return satchelTx(net).transfer(token.token_id, to);
    }).then(() => setConfirming(null));
  }

  return (
    <Card>
      <h2 className="font-display text-xl font-semibold">Sell or transfer</h2>
      {token.listing ? (
        <div className="mt-3 space-y-3">
          <p className="text-sm">
            Listed for <strong>{formatNear(token.listing.price)} NEAR</strong> at record version {token.listing.record_version}.
            Signing is frozen until you delist or it sells.
          </p>
          {frozen ? (
            <FrozenNote />
          ) : (
            <Button busy={tx.busy} onClick={() => tx.run(() => satchelTx(net).delist(token.token_id))}>
              Delist
            </Button>
          )}
        </div>
      ) : frozen ? (
        <FrozenNote />
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-muted">
            Listing freezes signing, so the record a buyer checks can't change under them. A buyer pays in NEAR and the NFT
            moves in the same transaction.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-sm">
              <span className="text-muted">Price in NEAR</span>
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="5"
                inputMode="decimal"
                className="w-48 rounded-xl border border-line bg-paper px-3 py-2 text-sm"
              />
            </label>
            <Button
              variant="primary"
              busy={tx.busy}
              onClick={() => tx.run(() => satchelTx(net).list(token.token_id, parseNear(price)))}
            >
              List for sale
            </Button>
          </div>
          <div className="space-y-3 border-t border-line pt-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="grid gap-1 text-sm">
                <span className="text-muted">Receiver&apos;s NEAR account</span>
                <input
                  ref={receiverField}
                  value={receiver}
                  // Fixed while the receiver is checked or the wallet is open: the question names this receiver.
                  readOnly={checking || tx.busy}
                  onChange={(e) => {
                    setReceiver(e.target.value.trim());
                    setConfirming(null);
                  }}
                  placeholder={net.id === "testnet" ? "friend.testnet" : "friend.near"}
                  className="w-64 rounded-xl border border-line bg-paper px-3 py-2 text-sm"
                />
              </label>
              {confirming === null && (
                <Button busy={checking || tx.busy} onClick={askToTransfer}>
                  Transfer the NFT
                </Button>
              )}
            </div>
            {confirming !== null && (
              <div className="rounded-xl bg-warn-soft px-3 py-3 text-sm text-warn">
                <p ref={question} tabIndex={-1} className="outline-none [overflow-wrap:anywhere]">
                  Give satchel #{token.token_id}, and whatever its address holds on every chain, to <strong>{confirming}</strong>?
                  A transfer can&apos;t be undone: only {confirming} can send it back.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button variant="primary" busy={tx.busy} onClick={() => transfer(confirming)}>
                    Yes, transfer it
                  </Button>
                  {!tx.busy && (
                    <Button
                      onClick={() => {
                        setConfirming(null);
                        receiverField.current?.focus();
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </div>
            )}
            <ErrorNote error={receiverError} />
          </div>
        </div>
      )}
      <div className="mt-3">
        <ErrorNote error={tx.error} />
      </div>
    </Card>
  );
}

/** The report and its listing, when the report is about this token on this network and checked that listing. */
export function checkedListing(token: SatchelView, report: Report | undefined, net: Network) {
  return report &&
    report.network === net.id &&
    report.contract === net.contract &&
    report.tokenId === token.token_id &&
    report.listing &&
    report.listing.record_version === report.recordVersion
    ? { report, listing: report.listing }
    : undefined;
}

/**
 * A buyer's side. The purchase takes its record version and price from the report, never from the
 * rest of the page, so it names exactly what the buyer checked; any later signature voids it.
 */
export function BuyPanel({
  token,
  report,
  onDone,
  frozen = false,
}: {
  token: SatchelView;
  report: Report | undefined;
  onDone: (hash?: string) => void;
  /** A demo satchel: buying from the app is off (`lib/frozen.ts`). */
  frozen?: boolean;
}) {
  const { accountId, signIn } = useWallet();
  const tx = useTx(onDone);
  const net = useNetwork();
  // The version whose risk the buyer accepted, so a new version asks again.
  const [accepted, setAccepted] = useState<string | null>(null);
  const [note, setNote] = useState("");
  if (!token.listing) return null;

  const checked = checkedListing(token, report, net);
  const listing = checked?.listing ?? token.listing;
  const clean = checked?.report.verdict === "clean";
  const accept = checked !== undefined && accepted === checked.report.recordVersion;
  // The page and the report read the token separately; buy only once they agree on the record and the listing.
  const agrees =
    checked !== undefined &&
    checked.report.recordVersion === token.record.version &&
    checked.listing.price === token.listing.price &&
    checked.listing.seller === token.listing.seller;

  return (
    <Card className="border-gold/60!">
      <h2 className="font-display text-xl font-semibold">For sale: {formatNear(listing.price)} NEAR</h2>
      <p className="mt-1 text-sm text-muted [overflow-wrap:anywhere]">
        Sold by {listing.seller}.
        {!frozen && (
          <>
            {" "}
            Your purchase names record version {checked?.report.recordVersion ?? token.record.version}, the one the report
            above checked; if the seller signed anything since, the contract refuses the sale and you keep your NEAR.
          </>
        )}
      </p>
      {!checked && <p className="mt-3 text-sm text-muted">Waiting for the report on this listing…</p>}
      {checked && !agrees && !frozen && (
        <p className="mt-3 text-sm text-warn">
          The listing or its record changed while this page loaded. Check again before you buy.
        </p>
      )}
      {checked && !clean && !frozen && (
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
      {frozen ? (
        <FrozenNote />
      ) : (
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
                if (!agrees) return setNote("Check again: the page and the report read different listings or record versions");
                if (!clean && !accept) return setNote("Tick the box above to buy a satchel that is not provably clean");
                setNote("");
                tx.run(() => satchelTx(net).buy(token.token_id, checked.report.recordVersion, BigInt(checked.listing.price)));
              }}
            >
              Buy for {formatNear(listing.price)} NEAR
            </Button>
          )}
        </div>
      )}
      <div className="mt-3 space-y-2">
        {note && <p className="text-sm text-warn">{note}</p>}
        <ErrorNote error={tx.error} />
      </div>
    </Card>
  );
}
