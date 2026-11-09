"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button, Card, ErrorNote, Mono } from "@/components/ui";
import { useAsync } from "@/components/use-async";
import { useWallet } from "@/components/wallet";
import { tokenAddress } from "@/lib/evm";
import type { Token } from "@/lib/near";
import { satchel, satchelTx } from "@/lib/satchel";

export default function YourSatchels() {
  const { accountId, ready, signIn, send } = useWallet();
  const router = useRouter();
  const [minting, setMinting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const tokens = useAsync(async () => {
    if (accountId === null) return [];
    const owned = await satchel.tokensFor(accountId);
    return Promise.all(owned.map(async (t) => ({ ...t, address: await tokenAddress(`satchel/${t.token_id}`) })));
  }, accountId ?? "");

  async function mint() {
    setError(null);
    setMinting(true);
    try {
      const { value } = await send<Token>(satchelTx.mint());
      if (value?.token_id) router.push(`/satchel/${value.token_id}`);
      else tokens.reload();
    } catch (err) {
      setError(err);
    } finally {
      setMinting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-semibold tracking-tight">Your satchels</h1>
          <p className="mt-1 text-ink-2">Each one is an address on 16 EVM chains that moves with the NFT.</p>
        </div>
        {accountId && (
          <Button variant="primary" busy={minting} onClick={mint}>
            Mint a satchel · 0.1 NEAR
          </Button>
        )}
      </div>
      <ErrorNote error={error} />

      {ready && accountId === null && (
        <Card>
          <h2 className="font-display text-xl font-semibold">Connect a NEAR testnet wallet</h2>
          <p className="mt-1 text-sm text-muted">
            Meteor, Intear, Nightly, Ledger and NEAR CLI work on testnet. Minting costs 0.1 NEAR, which pays for the
            token's storage and its signing record.
          </p>
          <div className="mt-4">
            <Button variant="primary" onClick={() => signIn().catch(setError)}>
              Connect wallet
            </Button>
          </div>
        </Card>
      )}

      {accountId && tokens.data?.length === 0 && !tokens.loading && (
        <Card>
          <h2 className="font-display text-xl font-semibold">Mint your first satchel</h2>
          <p className="mt-1 text-sm text-muted">
            You get an address derived for it by NEAR's MPC network. Fund it on any testnet, send from it here, or list it for
            sale; whoever owns the NFT controls it.
          </p>
        </Card>
      )}
      <ErrorNote error={tokens.error} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tokens.data?.map((t) => (
          <Link key={t.token_id} href={`/satchel/${t.token_id}`}>
            <Card className="h-full transition hover:border-ink">
              <div className="flex items-center justify-between">
                <p className="font-display text-2xl font-semibold">#{t.token_id}</p>
                <Badge>satchel/{t.token_id}</Badge>
              </div>
              <Mono className="mt-3 block text-xs text-ink-2">{t.address}</Mono>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
