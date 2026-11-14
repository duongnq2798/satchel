"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CHAINS, type ChainContents, buildReport, chainInfo, formatNear, nearAccountUrl, nearTxUrl, satchel, tokenAddress } from "satchel-nft";
import { isFrozen } from "@/lib/frozen";
import { appPath } from "@/lib/routes";
import { TIMING } from "@/lib/timing";
import { Contents } from "./contents";
import { DaoBoardLink } from "./dao-board";
import { DeploymentNote, useDeployment } from "./deployment";
import { FixPanel } from "./fix-panel";
import { History } from "./history";
import { useNetwork } from "./network";
import { QuotePanel } from "./quote-panel";
import { Received } from "./received";
import { ReportCard } from "./report-card";
import { BuyPanel, OwnerSale, checkedListing } from "./sale-panel";
import { SendPanel } from "./send-panel";
import { AddressPending, Heading, TokenSkeleton } from "./token-skeleton";
import { Badge, Card, CopyButton, ErrorNote, ExternalLink, Mono, VERDICT } from "./ui";
import { useAsync } from "./use-async";
import type { TxResult } from "./use-tx";
import { useWallet } from "./wallet";

export function TokenView({ tokenId }: { tokenId: string }) {
  const { accountId } = useWallet();
  const net = useNetwork();
  const deployment = useDeployment();
  const [refresh, setRefresh] = useState(0);
  const token = useAsync(
    async () => {
      const view = await satchel(net).get(tokenId);
      return view ? { view, address: await tokenAddress(net, view.path) } : null;
    },
    `${net.id}:${tokenId}`,
  );
  const report = useAsync(() => buildReport(net, tokenId), `${net.id}:${tokenId}:${refresh}`, { timing: TIMING.report });
  // The balances "What's inside" shows, for the Received card: they and the record choose its chains.
  const [held, setHeld] = useState<Readonly<Record<number, ChainContents | null>>>({});
  // The last transaction a panel finished. Kept here, since a sale or delist unmounts its panel.
  const [lastTx, setLastTx] = useState<string | null>(null);
  /** Reads everything again; settles once the satchel itself has been read again. */
  const reloadAll = (hash?: string) => {
    setLastTx(hash ?? null);
    // Cleared with the refresh, so the Received card waits for the new balances instead of
    // starting a scan from the old ones that it would drop once "What's inside" reads again.
    setHeld({});
    setRefresh((n) => n + 1);
    return token.reload();
  };
  // After a sale panel's transaction: everything again once it went through, else the satchel only.
  const afterTx = (r: TxResult | null) => (r ? reloadAll(r.hash) : token.reload());
  // The sections render only once the satchel loads, after the browser and the router looked for the
  // URL's #fragment (the holder room links to #report, satchel #3's page to #deed): scroll to it then,
  // once. Instantly, not smoothly: the report can still grow above the target, and the browser's scroll
  // anchoring holds a finished jump in place, where a smooth scroll still running would stop short.
  const loaded = Boolean(token.data);
  const scrolled = useRef(false);
  useEffect(() => {
    if (!loaded || scrolled.current) return;
    scrolled.current = true;
    const target = window.location.hash.slice(1);
    if (target) document.getElementById(target)?.scrollIntoView({ behavior: "instant" });
  }, [loaded]);

  if (token.data === undefined) {
    if (token.lastError === null || token.lastError === undefined) {
      return <TokenSkeleton tokenId={tokenId} wait={token.wait} onRetry={token.reload} />;
    }
    return (
      <div className="space-y-3">
        <div>
          <Heading tokenId={tokenId} />
        </div>
        <ErrorNote error={token.lastError} title="Couldn't read the satchel" onRetry={token.reload} />
      </div>
    );
  }
  if (token.data === null) {
    return (
      <Card>
        <h1 className="font-display text-2xl font-semibold [overflow-wrap:anywhere]">No satchel #{tokenId}</h1>
        <p className="mt-2 text-sm text-muted">
          {net.contract} has no token with this id. Mint one from{" "}
          <Link
            href={appPath(net, "/satchels")}
            className="font-medium text-leather underline decoration-line underline-offset-4 hover:decoration-ink"
          >
            Your satchels
          </Link>
          .
        </p>
      </Card>
    );
  }

  const { view, address } = token.data;
  const isOwner = accountId === view.owner_id;
  // A demo satchel the README quotes: the app's owner and buy actions are off on it (lib/frozen.ts).
  const frozen = isFrozen(net, view.token_id);
  const record = view.record;
  const listing = view.listing && (checkedListing(view, report.data ?? undefined, net)?.listing ?? view.listing);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Heading tokenId={view.token_id} />
          <p className="mt-4 text-sm text-ink-2">
            {isOwner ? "Owned by you" : <>Owned by <ExternalLink href={nearAccountUrl(net, view.owner_id)}>{view.owner_id}</ExternalLink></>} · path{" "}
            <Mono>{view.path}</Mono> · record version {record.version}
          </p>
          <DaoBoardLink owner={view.owner_id} />
        </div>
        <div className="flex gap-2">
          {view.listing && <Badge tone="gold">Listed</Badge>}
          {report.data && (
            <a
              href="#report"
              aria-label={`${VERDICT[report.data.verdict].label}: read the report`}
              className="inline-flex rounded-full transition hover:ring-1 hover:ring-current"
            >
              <Badge tone={VERDICT[report.data.verdict].tone}>{VERDICT[report.data.verdict].label}</Badge>
            </a>
          )}
        </div>
      </div>
      <ErrorNote error={token.lastError} onRetry={token.reload} />

      {/* The verdict first, under the title, and Make it clean under it when it isn't clean; the rest of the page follows. */}
      <div id="report" className="scroll-mt-24">
        <ReportCard
          report={report.data}
          loading={report.loading || token.loading}
          error={report.error}
          onRecheck={() => void reloadAll()}
          wait={report.loading ? report.wait : token.wait}
        />
      </div>
      {deployment.data && (
        <FixPanel token={view} address={address} report={report.data ?? undefined} frozen={frozen} onRecheck={() => void reloadAll()} />
      )}

      {listing && !isOwner && (
        // The price where a buyer lands, from the same listing the buy panel shows; the purchase stays in that panel.
        <Card className="flex flex-wrap items-center justify-between gap-3 border-gold/60!">
          <p className="min-w-0 text-sm [overflow-wrap:anywhere]">
            For sale: <strong className="font-display text-lg">{formatNear(listing.price)} NEAR</strong>, sold by{" "}
            {listing.seller}. {frozen
              ? "Buying it from the app is off through judging (until 2026-11-25), to keep the state the README quotes for this demo satchel."
              : "Read the report, then buy."}
          </p>
          {!frozen && (
            <a
              href="#buy"
              className="inline-flex items-center justify-center rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper transition hover:bg-leather"
            >
              Go to buy
            </a>
          )}
        </Card>
      )}

      <Card>
        <p className="text-xs text-muted">One address on {CHAINS.length} EVM chains, signed for only when this NFT's owner asks</p>
        {deployment.data ? (
          <>
            <div className="mt-1 flex items-center justify-between gap-3">
              <Mono className="text-lg">{address}</Mono>
              <CopyButton value={address} name="Copy address" />
            </div>
            <p className="mt-1 text-xs text-muted">
              Derived in your browser from the MPC network&apos;s root key, the contract and the path{" "}
              <span className="font-mono">{view.path}</span>, so no RPC answer can change this satchel&apos;s address.
            </p>
            <h2 className="mt-5 font-display text-xl font-semibold">What&apos;s inside</h2>
            <div className="mt-3">
              <Contents address={address} refresh={refresh} onRead={setHeld} />
            </div>
          </>
        ) : deployment.lastError !== null && deployment.lastError !== undefined ? (
          <div className="mt-3">
            <DeploymentNote deployment={deployment} />
          </div>
        ) : (
          <AddressPending note={<DeploymentNote deployment={deployment} />} />
        )}
      </Card>

      {/* A dry 1Click quote for what the satchel holds, once the contract passed check 1. A refresh closes it, so it reads the balances again. */}
      {deployment.data && <QuotePanel key={refresh} address={address} />}

      {/* Always in the page, so a screen reader hears the line; out of the flow while it is empty. */}
      <div role="status" className={lastTx ? undefined : "sr-only"}>
        {lastTx && (
          <p className="text-sm text-ok">
            Done. <ExternalLink href={nearTxUrl(net, lastTx)}>View the transaction</ExternalLink>
          </p>
        )}
      </div>
      {view.listing && !isOwner && (
        <div id="buy" className="scroll-mt-24">
          <BuyPanel
            token={view}
            report={report.data ?? undefined}
            reportError={report.lastError}
            afterTx={afterTx}
            onRecheck={reloadAll}
            frozen={frozen}
          />
        </div>
      )}
      {isOwner && !view.listing && deployment.data && <SendPanel tokenId={view.token_id} address={address} onDone={reloadAll} frozen={frozen} />}
      {isOwner && <OwnerSale token={view} afterTx={afterTx} frozen={frozen} />}

      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 max-w-2xl">
          <h2 className="font-display text-xl font-semibold">Holder room</h2>
          <p className="mt-1 text-sm text-muted">
            Only the account that owns satchel #{view.token_id} right now can open it: its wallet signs a message, and the
            server checks the key and the owner at a final NEAR block. Inside: a holder card and a kit for before a sale.
          </p>
        </div>
        <Link
          href={appPath(net, `/satchel/${view.token_id}/room`)}
          className="inline-flex items-center justify-center rounded-full border border-line bg-card px-4 py-2 text-sm font-medium text-ink transition hover:border-ink"
        >
          Open the holder room
        </Link>
      </Card>

      <History tokenId={view.token_id} record={record} refresh={refresh} />
      {deployment.data && <Received address={address} record={record} contents={held} refresh={refresh} />}

      <Card>
        <h2 className="font-display text-xl font-semibold">Signing record</h2>
        <p className="mt-1 text-sm text-muted">
          Written by the contract before each signature is requested. It only grows; no owner can clear it.
        </p>
        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          {record.evm.length === 0 && <p className="text-muted">Nothing signed through sign_evm yet.</p>}
          {record.evm.map((c) => (
            <p key={c.chain_id}>
              {chainInfo(Number(c.chain_id))?.name ?? `Chain ${c.chain_id}`}: {c.signatures} signature(s), highest nonce {c.max_nonce}
            </p>
          ))}
        </div>
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted">Raw record</summary>
          <pre className="mt-2 overflow-x-auto rounded-xl bg-paper-2 p-3 font-mono text-xs">{JSON.stringify(record, null, 2)}</pre>
        </details>
      </Card>
    </div>
  );
}
