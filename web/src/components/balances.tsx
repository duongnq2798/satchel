"use client";

import { useEffect, useState } from "react";
import { type Address, formatEther } from "viem";
import { sendChains } from "@/lib/config";
import { client } from "@/lib/evm";
import { useNetwork } from "./network";

export function formatBalance(wei: bigint): string {
  if (wei === 0n) return "0";
  const text = formatEther(wei);
  const [whole, fraction = ""] = text.split(".");
  const short = fraction.slice(0, 5).replace(/0+$/, "");
  return short ? `${whole}.${short}` : whole === "0" ? "< 0.00001" : whole;
}

/** Native balances of one address on each chain the app sends on for this network. */
export function Balances({ address, refresh }: { address: Address; refresh: number }) {
  const chains = sendChains(useNetwork());
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
  }, [address, refresh]);

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
