"use client";

import { useState } from "react";
import { CHAINS, NETWORK, chainInfo, nearAccountUrl } from "@/lib/config";
import { tokenAddress } from "@/lib/evm";
import { buildReport } from "@/lib/report";
import { satchel } from "@/lib/satchel";
import { Balances } from "./balances";
import { ReportCard } from "./report-card";
import { BuyPanel, OwnerSale } from "./sale-panel";
import { SendPanel } from "./send-panel";
import { Badge, Card, CopyButton, ErrorNote, ExternalLink, Mono } from "./ui";
import { useAsync } from "./use-async";
import { useWallet } from "./wallet";

export function TokenView({ tokenId }: { tokenId: string }) {
  const { accountId } = useWallet();
  const [refresh, setRefresh] = useState(0);
  const token = useAsync(
    async () => {
      const view = await satchel.get(tokenId);
      return view ? { view, address: await tokenAddress(view.path) } : null;
    },
    `${tokenId}:${refresh}`,
  );
  const report = useAsync(() => buildReport(tokenId), `${tokenId}:${refresh}`);
  const reloadAll = () => setRefresh((n) => n + 1);

  if (token.error) return <ErrorNote error={token.error} />;
  if (token.data === undefined) return <p className="text-muted">Loading satchel #{tokenId}…</p>;
  if (token.data === null) {
    return (
      <Card>
        <h1 className="font-display text-2xl font-semibold">No satchel #{tokenId}</h1>
        <p className="mt-2 text-sm text-muted">
          {NETWORK.contract} has no token with this id. Mint one from Your satchels.
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
            {isOwner ? "Owned by you" : <>Owned by <ExternalLink href={nearAccountUrl(view.owner_id)}>{view.owner_id}</ExternalLink></>} · path{" "}
            <Mono>{view.path}</Mono> · record version {record.version}
          </p>
        </div>
        <div className="flex gap-2">
          {view.listing && <Badge tone="gold">Listed</Badge>}
          {report.data && <Badge tone={report.data.verdict === "clean" ? "ok" : "warn"}>{report.data.verdict === "clean" ? "Provably clean" : "Not provable yet"}</Badge>}
        </div>
      </div>

      <Card>
        <p className="text-xs text-muted">One address on {CHAINS.length} EVM chains, controlled by whoever owns this NFT</p>
        <div className="mt-1 flex items-center justify-between gap-3">
          <Mono className="text-lg">{address}</Mono>
          <CopyButton value={address} />
        </div>
        <div className="mt-4">
          <Balances address={address} refresh={refresh} />
        </div>
      </Card>

      <ReportCard report={report.data} loading={report.loading} error={report.error} onRecheck={report.reload} />

      {view.listing && !isOwner && <BuyPanel token={view} report={report.data ?? undefined} onDone={reloadAll} />}
      {isOwner && !view.listing && <SendPanel tokenId={view.token_id} address={address} onDone={reloadAll} />}
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
