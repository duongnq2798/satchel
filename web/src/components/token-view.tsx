"use client";

import { useState } from "react";
import { CHAINS, chainInfo, nearAccountUrl, nearTxUrl } from "@/lib/config";
import { tokenAddress } from "@/lib/evm";
import { buildReport } from "@/lib/report";
import { satchel } from "@/lib/satchel";
import { Balances } from "./balances";
import { DeploymentNote, useDeployment } from "./deployment";
import { useNetwork } from "./network";
import { ReportCard } from "./report-card";
import { BuyPanel, OwnerSale } from "./sale-panel";
import { SendPanel } from "./send-panel";
import { Badge, Button, Card, CopyButton, ErrorNote, ExternalLink, Mono, VERDICT } from "./ui";
import { useAsync } from "./use-async";
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
    `${net.id}:${tokenId}:${refresh}`,
  );
  const report = useAsync(() => buildReport(net, tokenId), `${net.id}:${tokenId}:${refresh}`);
  // The last transaction a panel finished. Kept here, since a sale or delist unmounts its panel.
  const [lastTx, setLastTx] = useState<string | null>(null);
  const reloadAll = (hash?: string) => {
    setLastTx(hash ?? null);
    setRefresh((n) => n + 1);
  };

  if (token.data === undefined) {
    if (!token.error) return <p className="text-muted">Loading satchel #{tokenId}…</p>;
    return (
      <div className="space-y-3">
        <ErrorNote error={token.error} />
        <Button onClick={token.reload}>Try again</Button>
      </div>
    );
  }
  if (token.data === null) {
    return (
      <Card>
        <h1 className="font-display text-2xl font-semibold">No satchel #{tokenId}</h1>
        <p className="mt-2 text-sm text-muted">
          {net.contract} has no token with this id. Mint one from Your satchels.
        </p>
      </Card>
    );
  }

  const { view, address } = token.data;
  const isOwner = accountId === view.owner_id;
  const record = view.record;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">Satchel</p>
          <h1 className="font-display text-4xl font-semibold tracking-tight">#{view.token_id}</h1>
          <p className="mt-1 text-sm text-ink-2">
            {isOwner ? "Owned by you" : <>Owned by <ExternalLink href={nearAccountUrl(net, view.owner_id)}>{view.owner_id}</ExternalLink></>} · path{" "}
            <Mono>{view.path}</Mono> · record version {record.version}
          </p>
        </div>
        <div className="flex gap-2">
          {view.listing && <Badge tone="gold">Listed</Badge>}
          {report.data && <Badge tone={VERDICT[report.data.verdict].tone}>{VERDICT[report.data.verdict].label}</Badge>}
        </div>
      </div>
      <ErrorNote error={token.error} />

      <Card>
        <p className="text-xs text-muted">One address on {CHAINS.length} EVM chains, controlled by whoever owns this NFT</p>
        {deployment.data ? (
          <>
            <div className="mt-1 flex items-center justify-between gap-3">
              <Mono className="text-lg">{address}</Mono>
              <CopyButton value={address} />
            </div>
            <div className="mt-4">
              <Balances address={address} refresh={refresh} />
            </div>
          </>
        ) : (
          <div className="mt-3">
            <DeploymentNote deployment={deployment} />
          </div>
        )}
      </Card>

      <ReportCard
        report={report.data}
        loading={report.loading || token.loading}
        error={report.error}
        onRecheck={() => reloadAll()}
      />

      {lastTx && (
        <p className="text-sm text-ok">
          Done. <ExternalLink href={nearTxUrl(net, lastTx)}>View the transaction</ExternalLink>
        </p>
      )}
      {view.listing && !isOwner && <BuyPanel token={view} report={report.data ?? undefined} onDone={reloadAll} />}
      {isOwner && !view.listing && deployment.data && <SendPanel tokenId={view.token_id} address={address} onDone={reloadAll} />}
      {isOwner && <OwnerSale token={view} onDone={reloadAll} />}

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
