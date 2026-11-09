"use client";

import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { type ChainContents, chainContents, formatAmount, formatBalance, sendChains } from "satchel-nft";
import { useNetwork } from "./network";

/**
 * What one address holds on each chain the app sends on for this network: the native coin, and
 * USDC, USDT and WETH where they hold something. Display only; the report reads none of it.
 */
export function Contents({ address, refresh }: { address: Address; refresh: number }) {
  const net = useNetwork();
  const chains = useMemo(() => sendChains(net), [net]);
  // `null` is a chain whose RPC didn't answer at all.
  const [found, setFound] = useState<Record<number, ChainContents | null>>({});

  useEffect(() => {
    let live = true;
    setFound({});
    for (const chain of chains) {
      chainContents(chain, address).then(
        (c) => live && setFound((f) => ({ ...f, [chain.id]: c })),
        () => live && setFound((f) => ({ ...f, [chain.id]: null })),
      );
    }
    return () => {
      live = false;
    };
  }, [address, chains, refresh]);

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {chains.map((chain) => {
          const c = found[chain.id];
          // Tokens that hold something, or that couldn't be read; zero balances are left out.
          const held = c?.tokens.filter((t) => t.amount !== 0n) ?? [];
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
                {c === undefined
                  ? "…"
                  : c === null || c.native === null
                    ? `${chain.symbol} unavailable`
                    : `${formatBalance(c.native)} ${chain.symbol}`}
              </p>
              {held.map(({ token, amount }) => (
                <p key={token.address} className="text-sm">
                  {amount === null ? `${token.symbol} unavailable` : `${formatAmount(amount, token.decimals)} ${token.symbol}`}
                </p>
              ))}
            </a>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-muted">
        Read now from each chain: the native coin, and USDC, USDT and WETH at the addresses their issuers or the chains
        list (Uniswap&apos;s, for WETH on Sepolia). Other tokens aren&apos;t read; each chain&apos;s explorer, a click away,
        shows them. None of this is in the report, which checks only what the satchel has signed.
      </p>
    </div>
  );
}
