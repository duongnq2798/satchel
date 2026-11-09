"use client";

import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from "react";
import { connectedAccount, connector, runTx } from "@/lib/wallet";
import type { WalletTx } from "@/lib/satchel";

interface WalletState {
  accountId: string | null;
  ready: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Signs and sends with the connected account; resolves once every receipt is final. */
  send: <T>(tx: WalletTx) => Promise<{ hash: string; value: T | null }>;
}

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let live = true;
    connectedAccount().then((id) => {
      if (live) {
        setAccountId(id);
        setReady(true);
      }
    });
    connector()
      .then((c) => {
        c.on("wallet:signIn", (e) => live && setAccountId(e.accounts[0]?.accountId ?? null));
        c.on("wallet:signOut", () => live && setAccountId(null));
      })
      .catch(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, []);

  const signIn = useCallback(async () => {
    await (await connector()).connect();
  }, []);
  const signOut = useCallback(async () => {
    // A wallet whose session already ended can throw here; the app is signed out either way.
    try {
      await (await connector()).disconnect();
    } finally {
      setAccountId(null);
    }
  }, []);
  const send = useCallback(
    async <T,>(tx: WalletTx) => {
      if (accountId === null) throw new Error("Connect a NEAR wallet first");
      return runTx<T>(tx, accountId);
    },
    [accountId],
  );

  return <WalletContext.Provider value={{ accountId, ready, signIn, signOut, send }}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const state = useContext(WalletContext);
  if (state === null) throw new Error("useWallet outside WalletProvider");
  return state;
}

export function ConnectButton() {
  const { accountId, ready, signIn, signOut } = useWallet();
  if (!ready) return <span className="h-9 w-32 animate-pulse rounded-full bg-paper-2" aria-hidden="true" />;
  if (accountId === null) {
    return (
      <button
        type="button"
        onClick={() => signIn().catch(() => {})}
        className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper transition hover:bg-leather"
      >
        Connect wallet
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => signOut().catch(() => {})}
      title="Disconnect"
      className="max-w-56 truncate rounded-full border border-line bg-card px-4 py-2 text-sm text-ink-2 transition hover:border-ink"
    >
      {accountId}
    </button>
  );
}
