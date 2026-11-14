"use client";

import { useEffect, useId, useRef, useState } from "react";
import { type Network, type Report, type SatchelView, assertReceiver, formatNear, parseNear, satchelTx } from "satchel-nft";
import { deadline } from "@/lib/timing";
import { useNetwork } from "./network";
import { FrozenNote } from "./send-panel";
import { Button, Card, ErrorNote } from "./ui";
import { type TxResult, TxStatus, useTxAction } from "./use-tx";
import { useConnect, useWallet } from "./wallet";

/** How long a receiver check may take before it says NEAR didn't answer. */
const RECEIVER_MS = 15_000;

/** The owner's side: list, delist, or transfer the NFT. */
export function OwnerSale({
  token,
  afterTx,
  frozen = false,
}: {
  token: SatchelView;
  /** Shows a transaction's outcome on the page: everything again after one went through, the satchel after any other end. */
  afterTx: (result: TxResult | null) => Promise<unknown> | void;
  /** A demo satchel: list, delist and transfer are off (`lib/frozen.ts`). */
  frozen?: boolean;
}) {
  const action = useTxAction(afterTx);
  const net = useNetwork();
  const other = useId();
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

  /** Busy on the button whose transaction runs; off, with the reason, on the others meanwhile. */
  const txButton = (id: string) => {
    const off = action.busy && action.running !== id;
    return { busy: action.running === id, disabled: off, describedBy: off ? other : undefined };
  };

  async function askToTransfer() {
    setReceiverError(null);
    setChecking(true);
    try {
      // The contract takes any name, and an NFT sent to one that doesn't exist is lost.
      await deadline(assertReceiver(net, receiver), RECEIVER_MS, "NEAR RPC");
      setConfirming(receiver);
    } catch (err) {
      setReceiverError(err);
    } finally {
      setChecking(false);
    }
  }

  function transfer(to: string) {
    action
      .run("transfer", async () => {
        // Checked again: the account could have changed since the owner asked.
        await deadline(assertReceiver(net, to), RECEIVER_MS, "NEAR RPC");
        return satchelTx(net).transfer(token.token_id, to);
      })
      .then(() => setConfirming(null));
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
            <Button {...txButton("delist")} onClick={() => action.run("delist", () => satchelTx(net).delist(token.token_id))}>
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
              {...txButton("list")}
              onClick={() => action.run("list", () => satchelTx(net).list(token.token_id, parseNear(price)))}
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
                  readOnly={checking || action.busy}
                  onChange={(e) => {
                    setReceiver(e.target.value.trim());
                    setConfirming(null);
                  }}
                  placeholder={net.id === "testnet" ? "friend.testnet" : "friend.near"}
                  className="w-64 rounded-xl border border-line bg-paper px-3 py-2 text-sm"
                />
              </label>
              {confirming === null && (
                <Button busy={checking} disabled={action.busy} describedBy={action.busy ? other : undefined} onClick={askToTransfer}>
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
                  <Button variant="primary" {...txButton("transfer")} onClick={() => transfer(confirming)}>
                    Yes, transfer it
                  </Button>
                  {!action.busy && (
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
        <TxStatus action={action} />
      </div>
      <span id={other} className="sr-only">
        Another transaction is running.
      </span>
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
  reportError,
  afterTx,
  onRecheck,
  frozen = false,
}: {
  token: SatchelView;
  report: Report | undefined;
  /** Why the report couldn't be read, kept while it is read again. */
  reportError?: unknown;
  /** Shows a purchase's outcome on the page: everything again after it went through, the satchel after any other end. */
  afterTx: (result: TxResult | null) => Promise<unknown> | void;
  /** Reads the satchel and its report again. */
  onRecheck: () => unknown;
  /** A demo satchel: buying from the app is off (`lib/frozen.ts`). */
  frozen?: boolean;
}) {
  const { accountId } = useWallet();
  const { connect, error: connectError } = useConnect();
  const action = useTxAction(afterTx);
  const net = useNetwork();
  const waiting = useId();
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
      {!checked && (
        <div id={waiting} className="mt-3">
          {reportError !== null && reportError !== undefined ? (
            <ErrorNote error={reportError} title="Couldn't read the report" onRetry={onRecheck} />
          ) : (
            <p className="text-sm text-muted">Waiting for the report on this listing…</p>
          )}
        </div>
      )}
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
            <>
              <Button variant="primary" onClick={connect} busyText="Connecting to your wallet…">
                Connect to buy
              </Button>
              {connectError !== null && connectError !== undefined && (
                <div className="mt-3">
                  <ErrorNote error={connectError} />
                </div>
              )}
            </>
          ) : (
            <Button
              variant="gold"
              busy={action.running === "buy"}
              disabled={!checked}
              describedBy={checked ? undefined : waiting}
              onClick={() => {
                if (!checked) return;
                if (!agrees) return setNote("Check again: the page and the report read different listings or record versions");
                if (!clean && !accept) return setNote("Tick the box above to buy a satchel that is not provably clean");
                setNote("");
                action.run("buy", () => satchelTx(net).buy(token.token_id, checked.report.recordVersion, BigInt(checked.listing.price)));
              }}
            >
              Buy for {formatNear(listing.price)} NEAR
            </Button>
          )}
        </div>
      )}
      <div className="mt-3 space-y-2">
        <p role="status" className={note ? "text-sm text-warn" : "sr-only"}>
          {note}
        </p>
        <TxStatus action={action} />
      </div>
    </Card>
  );
}
