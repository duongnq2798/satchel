"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { DeploymentNote, useDeployment } from "@/components/deployment";
import { Badge, Button, Card, ErrorNote, ExternalLink, Mono } from "@/components/ui";
import { useNetwork } from "@/components/network";
import { useAsync } from "@/components/use-async";
import { useNavigate } from "@/components/use-navigate";
import { TxStatus, useTxAction } from "@/components/use-tx";
import { useConnect, useWallet } from "@/components/wallet";
import { type Token, satchel, satchelTx, tokenAddress } from "satchel-nft";
import { appPath } from "@/lib/routes";
import { TESTNET_ACCOUNT_URL, TESTNET_FAUCET_URL } from "@/lib/try-it";

export default function YourSatchels() {
  const { accountId, ready } = useWallet();
  const { connect, error: connectError } = useConnect();
  const net = useNetwork();
  const deployment = useDeployment();
  const { go, pending } = useNavigate();
  // The satchel just minted, whose page is opening: never reset, so Mint stays busy until this page goes.
  const [opening, setOpening] = useState<string | null>(null);
  const mintWaits = useId();
  const tokens = useAsync(async () => {
    if (accountId === null) return [];
    const owned = await satchel(net).tokensFor(accountId);
    return Promise.all(owned.map(async (t) => ({ ...t, address: await tokenAddress(net, `satchel/${t.token_id}`) })));
  }, `${net.id}:${accountId ?? ""}`);

  // A new satchel's page once its token id is known; otherwise the list, read again.
  const action = useTxAction(async (r) => {
    const id = (r?.value as Token | null | undefined)?.token_id;
    if (id) {
      setOpening(id);
      go(appPath(net, `/satchel/${id}`));
    } else await tokens.reload();
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-semibold tracking-tight">Your satchels</h1>
          <p className="mt-1 text-ink-2">Each one is an address on 16 EVM chains that moves with the NFT.</p>
        </div>
        {accountId && (
          <Button
            variant="primary"
            busy={action.busy || opening !== null || pending}
            disabled={!deployment.data}
            describedBy={deployment.data ? undefined : mintWaits}
            onClick={() => action.run("mint", () => satchelTx(net).mint())}
          >
            Mint a satchel · 0.1 {net.id === "testnet" ? "testnet " : ""}NEAR
          </Button>
        )}
        <span id={mintWaits} className="sr-only">
          Minting waits for the contract&apos;s check.
        </span>
      </div>
      <TxStatus
        action={action}
        done={opening && `Minted satchel #${opening}. Opening its page…`}
        recheckNote="This list reads your satchels again to check."
      />
      <DeploymentNote deployment={deployment} />

      {ready && accountId === null && (
        <Card>
          <h2 className="font-display text-xl font-semibold">Connect a NEAR {net.id} wallet</h2>
          <p className="mt-1 text-sm text-muted">
            {net.id === "testnet" ? "Meteor, Intear, Nightly, Ledger and NEAR CLI work on testnet. " : ""}Minting costs 0.1{" "}
            {net.id === "testnet" ? "testnet " : ""}NEAR, which pays for the token's storage and its signing record.
          </p>
          {net.id === "testnet" && (
            <p className="mt-1 text-sm text-muted">
              No testnet account yet? NEAR&apos;s docs show how to{" "}
              <ExternalLink href={TESTNET_ACCOUNT_URL}>create one</ExternalLink> and where to get{" "}
              <ExternalLink href={TESTNET_FAUCET_URL}>free testnet NEAR</ExternalLink>.
            </p>
          )}
          <div className="mt-4">
            <Button variant="primary" onClick={connect} busyText="Connecting to your wallet…">
              Connect wallet
            </Button>
          </div>
          {connectError !== null && connectError !== undefined && (
            <div className="mt-3">
              <ErrorNote error={connectError} />
            </div>
          )}
        </Card>
      )}

      {accountId && tokens.data?.length === 0 && !tokens.loading && (
        <Card>
          <h2 className="font-display text-xl font-semibold">Mint your first satchel</h2>
          <p className="mt-1 text-sm text-muted">
            You get an address derived for it by NEAR's MPC network. Fund it on any{" "}
            {net.id === "testnet" ? "testnet" : "chain"} the app lists, send from it here, or list it for sale; only the
            NFT's owner can have anything new signed for it.
          </p>
          {net.id === "testnet" && (
            <p className="mt-1 text-sm text-muted">
              Minting takes 0.1 testnet NEAR plus a little gas. Short of it? Get free testnet NEAR from{" "}
              <ExternalLink href={TESTNET_FAUCET_URL}>NEAR&apos;s faucet</ExternalLink>.
            </p>
          )}
        </Card>
      )}
      <ErrorNote error={tokens.error} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tokens.data?.map((t) => (
          <Link key={t.token_id} href={appPath(net, `/satchel/${t.token_id}`)}>
            <Card className="h-full transition hover:border-ink">
              <div className="flex items-center justify-between">
                <p className="font-display text-2xl font-semibold">#{t.token_id}</p>
                <Badge>satchel/{t.token_id}</Badge>
              </div>
              {deployment.data && <Mono className="mt-3 block text-xs text-ink-2">{t.address}</Mono>}
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
