"use client";

import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from "react";
import { type NetworkId, type WalletTx, accountOnNetwork, assertDeployment, assertTxFor } from "satchel-nft";
import { connectedAccount, connector, runTx, signIn as connect } from "@/lib/wallet";
import { useNetwork } from "./network";

interface WalletState {
  accountId: string | null;
  ready: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  /**
   * Signs and sends with the connected account; resolves once every receipt is final. Only for this
   * network's contract, and only once that contract passes its check.
   */
  send: <T>(tx: WalletTx) => Promise<{ hash: string; value: T | null }>;
}

const WalletContext = createContext<WalletState | null>(null);

/**
 * The wallet for the network of the page on screen, with one connector per network. The account is
 * stored with the network it was read on, so a page never sees the other network's account.
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  const net = useNetwork();
  const [session, setSession] = useState<{ net: NetworkId; accountId: string | null; ready: boolean }>({
    net: net.id,
    accountId: null,
    ready: false,
  });
  const { accountId, ready } = session.net === net.id ? session : { accountId: null, ready: false };

  useEffect(() => {
    let live = true;
    const set = (accountId: string | null) => live && setSession({ net: net.id, accountId, ready: true });
    setSession({ net: net.id, accountId: null, ready: false });
    connectedAccount(net).then(set);
    const onSignIn = (e: { accounts: { accountId: string }[] }) => {
      const id = e.accounts[0]?.accountId ?? null;
      set(id !== null && accountOnNetwork(net, id) ? id : null);
    };
    const onSignOut = () => set(null);
    const made = connector(net);
    made
      .then((c) => {
        c.on("wallet:signIn", onSignIn);
        c.on("wallet:signOut", onSignOut);
      })
      .catch(() => set(null));
    return () => {
      live = false;
      made.then(
        (c) => {
          c.off("wallet:signIn", onSignIn);
          c.off("wallet:signOut", onSignOut);
        },
        () => {},
      );
    };
  }, [net]);

  const signIn = useCallback(async () => {
    const id = await connect(net);
    setSession({ net: net.id, accountId: id, ready: true });
  }, [net]);
  const signOut = useCallback(async () => {
    // A wallet whose session already ended can throw here; the app is signed out either way.
    try {
      await (await connector(net)).disconnect();
    } finally {
      setSession({ net: net.id, accountId: null, ready: true });
    }
  }, [net]);
  const send = useCallback(
    async <T,>(tx: WalletTx) => {
      assertTxFor(net, tx, accountId);
      await assertDeployment(net);
      return runTx<T>(net, tx, accountId);
    },
    [accountId, net],
  );

  return <WalletContext.Provider value={{ accountId, ready, signIn, signOut, send }}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const state = useContext(WalletContext);
  if (state === null) throw new Error("useWallet outside WalletProvider");
  return state;
}

/** `align` is the side the sign-in error opens toward: right in the header, left where the button starts a line. */
export function ConnectButton({ align = "right" }: { align?: "left" | "right" }) {
  const { accountId, ready, signIn, signOut } = useWallet();
  const net = useNetwork();
  const [error, setError] = useState<string | null>(null);
  if (!ready) return <span className="h-9 w-32 animate-pulse rounded-full bg-paper-2" aria-hidden="true" />;
  if (accountId === null) {
    return (
      <span className="relative">
        <button
          type="button"
          onClick={() => {
            setError(null);
            signIn().catch((err: unknown) => {
              const text = err instanceof Error ? err.message : String(err);
              // Closing the picker is not an error worth showing.
              if (!/rejected/i.test(text)) setError(text);
            });
          }}
          className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper transition hover:bg-leather"
        >
          Connect wallet
        </button>
        {error && (
          <span
            role="alert"
            className={`absolute top-full ${align === "left" ? "left-0" : "right-0"} z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl bg-bad-soft px-3 py-2 text-xs text-bad`}
          >
            {error}
          </span>
        )}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => signOut().catch(() => {})}
      title={`Disconnect from NEAR ${net.id}. Some wallets also sign out on the other network.`}
      className="max-w-56 truncate rounded-full border border-line bg-card px-4 py-2 text-sm text-ink-2 transition hover:border-ink"
    >
      {accountId}
    </button>
  );
}
