"use client";

import { type ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { type NetworkId, type WalletTx, accountOnNetwork, assertDeployment, assertTxFor } from "satchel-nft";
import { UserRejected, errorText } from "@/lib/errors";
import { fromSameWallet, needsRestore, restoreAccount } from "@/lib/restore";
import { type TxPhase, connectedAccount, connector, onIdle, runTx, savedWallet, signIn as connect } from "@/lib/wallet";
import { useNetwork } from "./network";
import { Button, Placeholder } from "./ui";

interface WalletState {
  accountId: string | null;
  ready: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  /**
   * Signs and sends with the connected account; resolves once every receipt is final. Only for this
   * network's contract, and only once that contract passes its check. `onPhase` hears when the
   * wallet opens and when it returns the hash.
   */
  send: <T>(tx: WalletTx, onPhase?: (p: TxPhase) => void) => Promise<{ hash: string; value: T | null }>;
}

type Connector = Awaited<ReturnType<typeof connector>>;

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
  // Once a connect has finished or the user disconnects, a saved wallet's late answer must not undo it.
  const stopRestore = useRef(() => {});

  useEffect(() => {
    let live = true;
    const set = (accountId: string | null) => live && setSession({ net: net.id, accountId, ready: true });
    // No wallet saved and no parent frame to hold one: "Connect wallet" at once, near-connect once idle.
    const restore = needsRestore(savedWallet(net), window.parent !== window);
    setSession({ net: net.id, accountId: null, ready: !restore });
    // A locked extension wallet may not answer until it is unlocked: offer "Connect wallet" meanwhile.
    const stop = restore
      ? restoreAccount(() => fromSameWallet(() => savedWallet(net), () => connectedAccount(net)), set)
      : () => {};
    stopRestore.current = stop;
    const onSignIn = (e: { accounts: { accountId: string }[] }) => {
      stop();
      const id = e.accounts[0]?.accountId ?? null;
      set(id !== null && accountOnNetwork(net, id) ? id : null);
    };
    const onSignOut = () => {
      stop();
      set(null);
    };
    let made: Promise<Connector> | null = null;
    const wire = () => {
      made = connector(net);
      made
        .then((c) => {
          c.on("wallet:signIn", onSignIn);
          c.on("wallet:signOut", onSignOut);
        })
        .catch(() => set(null));
    };
    const cancel = restore ? (wire(), () => {}) : onIdle(wire);
    return () => {
      live = false;
      stop();
      cancel();
      made?.then(
        (c) => {
          c.off("wallet:signIn", onSignIn);
          c.off("wallet:signOut", onSignOut);
        },
        () => {},
      );
    };
  }, [net]);

  const signIn = useCallback(async () => {
    // Only a connect that finished stops the restore: a closed picker leaves it running.
    const id = await connect(net);
    stopRestore.current();
    setSession({ net: net.id, accountId: id, ready: true });
  }, [net]);
  const signOut = useCallback(async () => {
    stopRestore.current();
    // A wallet whose session already ended can throw here; the app is signed out either way.
    try {
      await (await connector(net)).disconnect();
    } finally {
      setSession({ net: net.id, accountId: null, ready: true });
    }
  }, [net]);
  const send = useCallback(
    async <T,>(tx: WalletTx, onPhase?: (p: TxPhase) => void) => {
      assertTxFor(net, tx, accountId);
      await assertDeployment(net);
      return runTx<T>(net, tx, accountId, onPhase);
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

/** The connect running on each network, so a second Connect button joins it instead of opening another picker. */
const connecting = new Map<NetworkId, Promise<void>>();

/** Connect through near-connect's picker. One connect per network at a time; a closed picker is no error. */
export function useConnect(): { connect: () => Promise<void>; error: unknown; dismiss: () => void } {
  const { signIn } = useWallet();
  const net = useNetwork();
  const [error, setError] = useState<unknown>(null);
  const connect = useCallback(async () => {
    setError(null);
    let run = connecting.get(net.id);
    if (run === undefined) {
      run = signIn().finally(() => connecting.delete(net.id));
      connecting.set(net.id, run);
    }
    try {
      await run;
    } catch (err) {
      if (!(err instanceof UserRejected)) setError(err);
    }
  }, [net.id, signIn]);
  const dismiss = useCallback(() => setError(null), []);
  return { connect, error, dismiss };
}

/** `align` is the side the sign-in error opens toward: right in the header, left where the button starts a line. */
export function ConnectButton({ align = "right" }: { align?: "left" | "right" }) {
  const { accountId, ready, signOut } = useWallet();
  const { connect, error, dismiss } = useConnect();
  const net = useNetwork();
  if (!ready) {
    return (
      <>
        <Placeholder className="h-9 w-32 rounded-full!" />
        <span className="sr-only">Looking for your wallet…</span>
      </>
    );
  }
  if (accountId === null) {
    return (
      <span className="relative">
        <Button variant="primary" onClick={connect} busyText="Connecting to your wallet…">
          Connect wallet
        </Button>
        {error !== null && error !== undefined && (
          <span
            role="alert"
            className={`absolute top-full ${align === "left" ? "left-0" : "right-0"} z-50 mt-2 flex w-72 max-w-[calc(100vw-2rem)] items-start gap-2 rounded-xl bg-bad-soft px-3 py-2 text-xs text-bad`}
          >
            <span className="min-w-0 flex-1">{errorText(error)}</span>
            <button type="button" aria-label="Dismiss" onClick={dismiss} className="-my-0.5 shrink-0 rounded-full px-1 text-sm leading-none hover:underline">
              ×
            </button>
          </span>
        )}
      </span>
    );
  }
  return (
    <span className={`flex min-w-32 ${align === "left" ? "" : "justify-end"}`}>
      <button
        type="button"
        onClick={() => signOut().catch(() => {})}
        aria-label={`Disconnect ${accountId}`}
        title={`Disconnect from NEAR ${net.id}. Some wallets also sign out on the other network.`}
        className="max-w-56 truncate rounded-full border border-line bg-card px-4 py-2 text-sm text-ink-2 transition hover:border-ink"
      >
        {accountId}
      </button>
    </span>
  );
}
