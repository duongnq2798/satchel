"use client";

import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { client, formatBalance, sendChains } from "satchel-nft";
import { useNetwork } from "./network";

/** Native balances of one address on each chain the app sends on for this network. */
export function Balances({ address, refresh }: { address: Address; refresh: number }) {
  const net = useNetwork();
  const chains = useMemo(() => sendChains(net), [net]);
  const [balances, setBalances] = useState<Record<number, bigint | null>>({});

  useEffect(() => {
    let live = true;
    setBalances({});
    for (const chain of chains) {
      client(chain.id)
        .getBalance({ address })
        .then(
          (wei) => live && setBalances((b) => ({ ...b, [chain.id]: wei })),
          () => live && setBalances((b) => ({ ...b, [chain.id]: null })),
        );
    }
    return () => {
      live = false;
    };
  }, [address, chains, refresh]);

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {chains.map((chain) => {
        const wei = balances[chain.id];
        return (
          <a
            key={chain.id}
            href={`${chain.explorer}/address/${address}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-xl border border-line px-3 py-2 transition hover:border-ink"
          >
            <p className="text-xs text-muted">{chain.name}</p>
            <p className="text-sm">
              {wei === undefined ? "…" : wei === null ? "unavailable" : `${formatBalance(wei)} ${chain.symbol}`}
            </p>
          </a>
        );
      })}
    </div>
  );
}
