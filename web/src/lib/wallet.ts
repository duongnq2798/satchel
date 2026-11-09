import { NETWORK } from "./config";
import { type ExecutionOutcome, finalOutcome, outcomeValue } from "./near";
import type { WalletTx } from "./satchel";
import manifest from "./wallet-manifest.json";

/**
 * Our own narrow view of @hot-labs/near-connect 0.11.4, so its types stay out of the app. The
 * wallet list is pinned in wallet-manifest.json instead of fetched from GitHub at runtime; each
 * wallet's own script still comes from its publisher.
 */
interface NearWallet {
  signAndSendTransaction(params: { signerId?: string; receiverId: string; actions: WalletTx["actions"] }): Promise<ExecutionOutcome>;
}

interface Connector {
  connect(): Promise<NearWallet>;
  disconnect(): Promise<void>;
  wallet(): Promise<NearWallet>;
  getConnectedWallet(): Promise<{ wallet: NearWallet; accounts: { accountId: string }[] }>;
  on(event: "wallet:signIn", cb: (e: { accounts: { accountId: string }[] }) => void): void;
  on(event: "wallet:signOut", cb: () => void): void;
}

let pending: Promise<Connector> | null = null;

/** The one connector for the page. Client only: the library touches window when it loads. */
export function connector(): Promise<Connector> {
  if (pending === null) {
    pending = import("@hot-labs/near-connect").then(({ NearConnector }) => {
      const options = { network: NETWORK.id, manifest, footerBranding: null };
      return new NearConnector(options as unknown as ConstructorParameters<typeof NearConnector>[0]) as unknown as Connector;
    });
    pending.catch(() => {
      pending = null;
    });
  }
  return pending;
}

export async function connectedAccount(): Promise<string | null> {
  try {
    const { accounts } = await (await connector()).getConnectedWallet();
    return accounts[0]?.accountId ?? null;
  } catch {
    return null;
  }
}

/**
 * Has the wallet sign and send `tx`, then waits until every receipt is final and returns the value
 * the call resolved to. Wallets often return before a promise chain finishes, as with `sign_evm`,
 * which resolves only when the MPC network answers.
 */
export async function runTx<T>(tx: WalletTx, signer: string): Promise<{ hash: string; value: T | null }> {
  const wallet = await (await connector()).wallet();
  const sent = await wallet.signAndSendTransaction({ signerId: signer, receiverId: tx.receiverId, actions: tx.actions });
  const hash = sent?.transaction?.hash;
  if (!hash) throw new Error("The wallet did not return a transaction hash");
  const settled =
    sent.final_execution_status === "FINAL" ? sent : await finalOutcome(hash, sent.transaction.signer_id ?? signer);
  return { hash, value: outcomeValue<T>(settled) };
}
