"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CHAINS, type ChainContents, buildReport, chainInfo, formatNear, nearAccountUrl, nearTxUrl, satchel, sendChains, tokenAddress } from "satchel-nft";
import { isFrozen } from "@/lib/frozen";
import { appPath } from "@/lib/routes";
import { Contents } from "./contents";
import { DeploymentNote, useDeployment } from "./deployment";
import { FixPanel } from "./fix-panel";
import { History } from "./history";
import { useNetwork } from "./network";
import { QuotePanel } from "./quote-panel";
import { Received } from "./received";
import { ReportCard } from "./report-card";
import { BuyPanel, OwnerSale, checkedListing } from "./sale-panel";
import { SendPanel } from "./send-panel";
import { Badge, Button, Card, CopyButton, ErrorNote, ExternalLink, Mono, Placeholder, VERDICT } from "./ui";
import { useAsync } from "./use-async";
import { useWallet } from "./wallet";

/** The page's heading, the same while the satchel loads and after, so it never moves. */
function Heading({ tokenId }: { tokenId: string }) {
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
 * contract's check runs (`deployment` then says so where the address goes). The chains are the ones
 * "What's inside" reads, each still to be read.
 */
function AddressPending({ deployment }: { deployment?: ReturnType<typeof useDeployment> }) {
  const net = useNetwork();
  return (
    <>
      <div className="mt-1 flex min-h-14 items-center sm:min-h-7">
        {deployment ? <DeploymentNote deployment={deployment} /> : <Placeholder className="h-6 w-full max-w-md" />}
      </div>
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

/** The page while the satchel loads: its heading, then each card at about its loaded height. */
function TokenSkeleton({ tokenId }: { tokenId: string }) {
  return (
    <div className="space-y-6">
      <div>
        <Heading tokenId={tokenId} />
        <p role="status" className="sr-only">
          Reading satchel #{tokenId} from NEAR…
        </p>
        <Placeholder className="mt-2 h-5 w-full max-w-sm" />
      </div>
      <Card>
        <p className="text-xs text-muted">One address on {CHAINS.length} EVM chains, signed for only when this NFT's owner asks</p>
        <AddressPending />
      </Card>
      <ReportCard report={undefined} loading error={null} onRecheck={() => {}} />
      <Placeholder className="h-36 rounded-2xl!" />
      <Placeholder className="h-64 rounded-2xl!" />
    </div>
  );
}

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
    `${net.id}:${tokenId}:${refresh}`,
  );
  const report = useAsync(() => buildReport(net, tokenId), `${net.id}:${tokenId}:${refresh}`);
  // The balances "What's inside" shows, for the Received card: they and the record choose its chains.
  const [held, setHeld] = useState<Readonly<Record<number, ChainContents | null>>>({});
  // The last transaction a panel finished. Kept here, since a sale or delist unmounts its panel.
  const [lastTx, setLastTx] = useState<string | null>(null);
  const reloadAll = (hash?: string) => {
    setLastTx(hash ?? null);
    // Cleared with the refresh, so the Received card waits for the new balances instead of
    // starting a scan from the old ones that it would drop once "What's inside" reads again.
    setHeld({});
    setRefresh((n) => n + 1);
  };
  // The sections render only once the satchel loads, after the browser and the router looked for the
  // URL's #fragment (the holder room links to #report): scroll to it then, once.
  const loaded = Boolean(token.data);
  const scrolled = useRef(false);
  useEffect(() => {
    if (!loaded || scrolled.current) return;
    scrolled.current = true;
    const target = window.location.hash.slice(1);
    if (target) document.getElementById(target)?.scrollIntoView();
  }, [loaded]);

  if (token.data === undefined) {
    if (!token.error) return <TokenSkeleton tokenId={tokenId} />;
    return (
      <div className="space-y-3">
        <div>
          <Heading tokenId={tokenId} />
        </div>
        <ErrorNote error={token.error} />
        <Button onClick={token.reload}>Try again</Button>
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
      <ErrorNote error={token.error} />

      {listing && !isOwner && (
        // The price where a buyer lands, from the same listing the buy panel shows; the purchase stays in that panel.
        <Card className="flex flex-wrap items-center justify-between gap-3 border-gold/60!">
          <p className="min-w-0 text-sm [overflow-wrap:anywhere]">
            For sale: <strong className="font-display text-lg">{formatNear(listing.price)} NEAR</strong>, sold by{" "}
            {listing.seller}. {frozen ? "Buying it from the app is off on this demo satchel until 2026-11-25." : "Read the report, then buy."}
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
        ) : deployment.error ? (
          <div className="mt-3">
            <DeploymentNote deployment={deployment} />
          </div>
        ) : (
          <AddressPending deployment={deployment} />
        )}
      </Card>

      {/* A dry 1Click quote for what the satchel holds, once the contract passed check 1. A refresh closes it, so it reads the balances again. */}
      {deployment.data && <QuotePanel key={refresh} address={address} />}

      <div id="report" className="scroll-mt-24">
        <ReportCard
          report={report.data}
          loading={report.loading || token.loading}
          error={report.error}
          onRecheck={() => reloadAll()}
        />
      </div>
      {deployment.data && (
        <FixPanel token={view} address={address} report={report.data ?? undefined} frozen={frozen} onRecheck={() => reloadAll()} />
      )}

      {lastTx && (
        <p className="text-sm text-ok">
          Done. <ExternalLink href={nearTxUrl(net, lastTx)}>View the transaction</ExternalLink>
        </p>
      )}
      {view.listing && !isOwner && (
        <div id="buy" className="scroll-mt-24">
          <BuyPanel token={view} report={report.data ?? undefined} onDone={reloadAll} frozen={frozen} />
        </div>
      )}
      {isOwner && !view.listing && deployment.data && <SendPanel tokenId={view.token_id} address={address} onDone={reloadAll} frozen={frozen} />}
      {isOwner && <OwnerSale token={view} onDone={reloadAll} frozen={frozen} />}

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
