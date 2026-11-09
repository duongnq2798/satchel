import {
  type ExecutionOutcome,
  type Network,
  type NetworkId,
  type WalletTx,
  accountOnNetwork,
  finalOutcome,
  outcomeValue,
} from "satchel-nft";
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
  off(event: "wallet:signIn" | "wallet:signOut", cb: (...args: never[]) => void): void;
}

/**
 * near-connect's storage, under a key per network: it remembers the chosen wallet in one key, so
 * signing out on one network would otherwise forget the wallet on both.
 */
function networkStorage(net: Network) {
  const key = (name: string) => `satchel:${net.id}:${name}`;
  const local = () => (typeof window === "undefined" ? null : window.localStorage);
  return {
    get: async (name: string) => local()?.getItem(key(name)) ?? null,
    set: async (name: string, value: string) => local()?.setItem(key(name), value),
    remove: async (name: string) => local()?.removeItem(key(name)),
  };
}

const pending = new Map<NetworkId, Promise<Connector>>();

/** One connector per network for the page. Client only: the library touches window when it loads. */
export function connector(net: Network): Promise<Connector> {
  let made = pending.get(net.id);
  if (made === undefined) {
    made = import("@hot-labs/near-connect").then(({ NearConnector }) => {
      const options = { network: net.id, manifest, footerBranding: null, storage: networkStorage(net) };
      return new NearConnector(options as unknown as ConstructorParameters<typeof NearConnector>[0]) as unknown as Connector;
    });
    made.catch(() => pending.delete(net.id));
    pending.set(net.id, made);
  }
  return made;
}

/** The connected account, if the wallet has one on `net`. */
export async function connectedAccount(net: Network): Promise<string | null> {
  try {
    const { accounts } = await (await connector(net)).getConnectedWallet();
    const id = accounts[0]?.accountId ?? null;
    return id !== null && accountOnNetwork(net, id) ? id : null;
  } catch {
    return null;
  }
}

/**
 * Opens the wallet picker for `net` and returns the account it connected. An account from the other
 * network is refused out loud, since the page could never sign with it.
 */
export async function signIn(net: Network): Promise<string> {
  const c = await connector(net);
  await c.connect();
  const { accounts } = await c.getConnectedWallet();
  const id = accounts[0]?.accountId;
  if (id === undefined) throw new Error("The wallet didn't connect an account");
  if (!accountOnNetwork(net, id)) {
    const other = net.id === "testnet" ? "Mainnet" : "Testnet";
    throw new Error(`${id} is not a NEAR ${net.id} account: switch to ${other} to use it, or pick a ${net.id} account`);
  }
  return id;
}

/**
 * Has the wallet sign and send `tx`, then waits until every receipt is final and returns the value
 * the call resolved to. Wallets often return before a promise chain finishes, as with `sign_evm`,
 * which resolves only when the MPC network answers.
 */
export async function runTx<T>(net: Network, tx: WalletTx, signer: string): Promise<{ hash: string; value: T | null }> {
  const wallet = await (await connector(net)).wallet();
  const sent = await wallet.signAndSendTransaction({ signerId: signer, receiverId: tx.receiverId, actions: tx.actions });
  const hash = sent?.transaction?.hash;
  if (!hash) throw new Error("The wallet did not return a transaction hash");
  const settled =
    sent.final_execution_status === "FINAL" ? sent : await finalOutcome(net, hash, sent.transaction.signer_id ?? signer);
  return { hash, value: outcomeValue<T>(settled) };
}
