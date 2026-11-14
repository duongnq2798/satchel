"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { type WalletTx, nearTxUrl } from "satchel-nft";
import { PendingTx, TimeoutError, errorKind } from "@/lib/errors";
import { followUp } from "@/lib/final";
import { TIMING, deadline } from "@/lib/timing";
import { settleTx } from "@/lib/wallet";
import { useNetwork } from "./network";
import { Button, ErrorNote, ExternalLink, Spinner } from "./ui";
import { useWait } from "./use-async";
import { useWallet } from "./wallet";

export type TxStage = "idle" | "checking" | "wallet" | "final" | "updating";

export const TX_LABEL = {
  checking: "Checking with NEAR…",
  wallet: "Waiting for your wallet…",
  final: "Sent. Finalizing on NEAR…",
  updating: "Updating the page…",
} as const;

export type TxResult = { hash: string; value: unknown };

/** How long the page may take to show a transaction's outcome before its buttons free themselves. */
const REFRESH_MS = 15_000;

/**
 * One NEAR-only wallet transaction at a time: its stage, its hash as soon as the wallet returns it,
 * then `after`, which shows the outcome on the page (bounded at 15 s) before the buttons free up.
 */
export function useTxAction(after: (result: TxResult | null) => Promise<unknown> | void) {
  const { accountId, send } = useWallet();
  const net = useNetwork();
  const guard = useRef(false);
  // The page's latest `after`: a wallet can take minutes, and the page may have re-rendered meanwhile.
  const latest = useRef(after);
  useEffect(() => {
    latest.current = after;
  });
  const [stage, setStage] = useState<TxStage>("idle");
  const [running, setRunning] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [late, setLate] = useState(false);
  // The last run ended in an error after the wallet, so the page read the satchel again.
  const [rechecked, setRechecked] = useState(false);

  /** `after(result)`, or false once it took longer than 15 s; its own failures are the page's to show. */
  const refresh = async (result: TxResult | null) => {
    try {
      await deadline(Promise.resolve().then(() => latest.current(result)), REFRESH_MS, "the page refresh");
      return true;
    } catch (err) {
      return !(err instanceof TimeoutError);
    }
  };

  async function run(id: string, build: () => WalletTx | Promise<WalletTx>): Promise<TxResult | null> {
    if (guard.current) return null;
    guard.current = true;
    setRunning(id);
    // The page's own checks first (the receiver, the contract); "your wallet" only once it opens.
    setStage("checking");
    setHash(null);
    setError(null);
    setLate(false);
    setRechecked(false);
    let reached = false;
    let result: TxResult | null = null;
    let failure: unknown = null;
    try {
      result = await send(await build(), (p) => {
        if (p.phase === "wallet") {
          reached = true;
          setStage("wallet");
        } else {
          setHash(p.hash);
          setStage("final");
        }
      });
    } catch (err) {
      failure = err;
      setError(err);
    }
    const next = followUp(reached, failure);
    if (next !== "none") {
      setRechecked(next === "recheck");
      setStage("updating");
      const shown = await refresh(next === "refresh" ? result : null);
      if (next === "refresh") setLate(!shown);
    }
    guard.current = false;
    setRunning(null);
    setStage("idle");
    return result;
  }

  /**
   * Check again: for a pending transaction, asks NEAR once how it ended (done: the page shows it as
   * after a run; failed: its error; unfinished: the note stays), then re-reads the satchel.
   */
  const recheck = async () => {
    if (guard.current) return;
    let result: TxResult | null = null;
    if (error instanceof PendingTx && accountId !== null) {
      try {
        result = await settleTx(net, error.hash, accountId, 1);
        setError(null);
      } catch (err) {
        if (!(err instanceof PendingTx)) {
          setError(err);
          setRechecked(true);
        }
      }
    }
    const shown = await refresh(result);
    if (result !== null) setLate(!shown);
    else if (shown) setLate(false);
  };

  return { stage, running, busy: running !== null, hash, error, late, rechecked, run, recheck };
}

/** Under a panel's buttons: the stage line with the tx link (role=status), then the outcome. */
export function TxStatus({
  action,
  done,
  recheckNote = "This page reads the satchel again to check.",
}: {
  action: ReturnType<typeof useTxAction>;
  done?: ReactNode;
  recheckNote?: string;
}) {
  const net = useNetwork();
  const { stage, hash, error, late, rechecked } = action;
  const hint = useWait(stage === "wallet", TIMING.wallet) === "slow" && stage === "wallet";
  const link = hash && <ExternalLink href={nearTxUrl(net, hash)}>View it</ExternalLink>;
  const failed = error !== null && error !== undefined;
  // Out of the flow while it has nothing to say, but still in the page, so the live region hears the next stage.
  const empty = stage === "idle" && !late && !done && !failed;
  return (
    <div className={empty ? "sr-only" : "space-y-2"}>
      <div role="status" className="text-sm">
        {stage !== "idle" ? (
          <>
            <p className="flex flex-wrap items-center gap-x-2 text-muted">
              <Spinner />
              {TX_LABEL[stage]}
              {link}
            </p>
            {/* In the layout for the whole run, invisible until the wallet is slow, so it never pushes the page down. */}
            <p className={`mt-1 text-muted ${hint ? "" : "invisible"}`} aria-hidden={hint ? undefined : true}>
              Still waiting for your wallet. Look for its window or extension.
            </p>
          </>
        ) : late ? (
          <p>Done. The page hasn&apos;t refreshed yet.</p>
        ) : (
          done
        )}
      </div>
      <ErrorNote error={error} onRetry={errorKind(error) === "pending" ? action.recheck : undefined} retryLabel="Check again">
        {link && <p className="mt-1">{link}</p>}
        {rechecked && <p className="mt-1">{recheckNote}</p>}
      </ErrorNote>
      {late && (
        <Button size="sm" onClick={action.recheck}>
          Check again
        </Button>
      )}
    </div>
  );
}
