import {
  type ExecutionOutcome,
  type Network,
  type NetworkId,
  type WalletTx,
  accountOnNetwork,
  outcomeValue,
  rpcFor,
} from "satchel-nft";
import { UserRejected, walletRefused } from "./errors";
import { waitFinal } from "./final";
import { rememberTx } from "./last-tx";
import { deadline } from "./timing";
import manifest from "./wallet-manifest.json";

/**
 * Our own narrow view of @hot-labs/near-connect 0.11.4, so its types stay out of the app. The
 * wallet list is pinned in wallet-manifest.json instead of fetched from GitHub at runtime; each
 * wallet's own script still comes from its publisher.
 */
interface NearWallet {
  manifest?: { name?: string; features?: { signMessage?: boolean } };
  signAndSendTransaction(params: { signerId?: string; receiverId: string; actions: WalletTx["actions"] }): Promise<ExecutionOutcome>;
  /** NEP-413: signs a message with the account's key. No transaction, no fee. */
  signMessage?(params: {
    message: string;
    recipient: string;
    nonce: Uint8Array;
    network?: NetworkId;
    signerId?: string;
  }): Promise<{ accountId: string; publicKey: string; signature: string }>;
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
  return {
    get: async (name: string) => local()?.getItem(key(name)) ?? null,
    set: async (name: string, value: string) => local()?.setItem(key(name), value),
    remove: async (name: string) => local()?.removeItem(key(name)),
  };
}

const local = () => (typeof window === "undefined" ? null : window.localStorage);

/** The id of the wallet near-connect has saved for `net` (in `networkStorage`), if any. */
export function savedWallet(net: Network): string | null {
  return local()?.getItem(`satchel:${net.id}:selected-wallet`) ?? null;
}

const pending = new Map<NetworkId, Promise<Connector>>();

/** One connector per network for the page. Client only: the library touches window when it loads. */
export function connector(net: Network): Promise<Connector> {
  let made = pending.get(net.id);
  if (made === undefined) {
    made = deadline(import("@hot-labs/near-connect"), 20_000, "the wallet picker").then(({ NearConnector }) => {
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
  try {
    await c.connect();
  } catch (err) {
    throw walletRefused(err) ? new UserRejected("connect", { cause: err }) : err;
  }
  const { accounts } = await c.getConnectedWallet();
  const id = accounts[0]?.accountId;
  if (id === undefined) throw new Error("The wallet didn't connect an account");
  if (!accountOnNetwork(net, id)) {
    const other = net.id === "testnet" ? "Mainnet" : "Testnet";
    throw new Error(`${id} is not a NEAR ${net.id} account: switch to ${other} to use it, or pick a ${net.id} account`);
  }
  return id;
}

/** Where a transaction is: in the wallet, or sent with its hash. */
export type TxPhase = { phase: "wallet" } | { phase: "sent"; hash: string };

/**
 * Has the wallet sign and send `tx`, then waits until every receipt is final and returns the value
 * the call resolved to. Wallets often return before a promise chain finishes, as with `sign_evm`,
 * which resolves only when the MPC network answers. A refusal in the wallet throws UserRejected, and
 * a sent transaction NEAR hasn't finished in time throws PendingTx with its hash.
 */
export async function runTx<T>(
  net: Network,
  tx: WalletTx,
  signer: string,
  onPhase: (p: TxPhase) => void = () => {},
): Promise<{ hash: string; value: T | null }> {
  const wallet = await (await connector(net)).wallet();
  onPhase({ phase: "wallet" });
  let sent: ExecutionOutcome;
  try {
    sent = await wallet.signAndSendTransaction({ signerId: signer, receiverId: tx.receiverId, actions: tx.actions });
  } catch (err) {
    throw walletRefused(err) ? new UserRejected("tx", { cause: err }) : err;
  }
  const hash = sent?.transaction?.hash;
  if (!hash) throw new Error("The wallet did not return a transaction hash");
  rememberTx(net, hash);
  onPhase({ phase: "sent", hash });
  const settled =
    sent.final_execution_status === "FINAL" ? sent : await waitFinal(rpcFor(net), hash, sent.transaction.signer_id ?? signer);
  return { hash, value: outcomeValue<T>(settled) };
}

/** Thrown when the connected wallet can't sign NEP-413 messages at all. */
export class NoMessageSigning extends Error {}

/**
 * Has the wallet sign a NEP-413 message as `signer`: no transaction, no fee. The account it signed
 * as must be `signer`, the one the page is connected to.
 */
export async function signMessage(
  net: Network,
  params: { message: string; recipient: string; nonce: Uint8Array },
  signer: string,
): Promise<{ publicKey: string; signature: string }> {
  const wallet = await (await connector(net)).wallet();
  const cannot = () =>
    new NoMessageSigning(`${wallet.manifest?.name ?? "This wallet"} can't sign messages (NEP-413), so it can't open the room`);
  if (typeof wallet.signMessage !== "function" || wallet.manifest?.features?.signMessage === false) throw cannot();
  let signed: Awaited<ReturnType<NonNullable<NearWallet["signMessage"]>>>;
  try {
    signed = await wallet.signMessage({ ...params, network: net.id, signerId: signer });
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    if (/not (supported|implemented)|unsupported/i.test(text)) throw cannot();
    throw walletRefused(err) ? new UserRejected("sign", { cause: err }) : err;
  }
  if (typeof signed?.signature !== "string" || typeof signed.publicKey !== "string") throw new Error("The wallet didn't return a signature");
  if (signed.accountId !== signer) throw new Error(`The wallet signed as ${signed.accountId}, not ${signer}, the account this page is connected to`);
  return { publicKey: signed.publicKey, signature: signed.signature };
}

/** `cb` once the browser is idle (within 2 s), or on the next tick where it has no requestIdleCallback (Safari); returns the cancel. */
export function onIdle(cb: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(cb, { timeout: 2000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = setTimeout(cb, 1);
  return () => clearTimeout(id);
}
