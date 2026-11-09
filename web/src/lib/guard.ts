import { type Network, type NetworkId, accountOnNetwork } from "./config";
import { viewAccount } from "./near";
import { type Check, contractCheck, contractFacts } from "./report";
import type { WalletTx } from "./satchel";

/**
 * Refuses a transaction the page should never sign: no account, an account from the other network,
 * or a call to anything but this network's satchel contract.
 */
export function assertTxFor(net: Network, tx: WalletTx, accountId: string | null): asserts accountId is string {
  if (accountId === null) throw new Error(`Connect a NEAR ${net.id} wallet first`);
  if (!accountOnNetwork(net, accountId)) throw new Error(`${accountId} is not a NEAR ${net.id} account`);
  if (tx.receiverId !== net.contract) throw new Error(`This page signs only for ${net.contract}`);
}

function missing(err: unknown): boolean {
  return err instanceof Error && /UNKNOWN_ACCOUNT|does not exist/.test(err.message);
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const checks = new Map<NetworkId, Promise<Check>>();

/**
 * The contract check for `net`'s deployment. A pass is kept for the page's lifetime: it means the
 * account has no keys, so its code can't change. Anything else is read again on the next call.
 */
export function deploymentCheck(net: Network): Promise<Check> {
  let read = checks.get(net.id);
  if (read === undefined) {
    const made = contractFacts(net).then((facts) => contractCheck(net, facts));
    made.then(
      (check) => check.status !== "pass" && checks.delete(net.id),
      () => checks.delete(net.id),
    );
    checks.set(net.id, made);
    read = made;
  }
  return read;
}

/**
 * Throws unless `net`'s contract passes its check. Until then the account could hold anyone's code,
 * so the app neither signs for it nor shows an address derived from it.
 */
export async function assertDeployment(net: Network): Promise<void> {
  let check: Check;
  try {
    check = await deploymentCheck(net);
  } catch (err) {
    if (missing(err)) throw new Error(`${net.contract} doesn't exist yet: Satchel isn't live on NEAR ${net.id}`);
    throw new Error(`Couldn't check ${net.contract}: ${message(err)}`);
  }
  if (check.status !== "pass") throw new Error(`${net.contract} doesn't pass the contract check: ${check.lines.join(". ")}`);
}

/** A NEAR account id: lowercase letters, digits, `-` and `_` between them, parts joined by dots. */
const ACCOUNT_ID = /^(?:[a-z\d]+[-_])*[a-z\d]+(?:\.(?:[a-z\d]+[-_])*[a-z\d]+)*$/;

/**
 * Refuses a transfer receiver that would lose the NFT: a malformed name, an account that doesn't
 * exist on `net` (anyone could register it later, or no one ever can), or an account that can never
 * transfer it out. The contract itself takes any name.
 */
export async function assertReceiver(net: Network, receiver: string): Promise<void> {
  const example = net.id === "testnet" ? "friend.testnet" : "friend.near";
  if (receiver.length < 2 || receiver.length > 64 || !ACCOUNT_ID.test(receiver)) {
    throw new Error(`Enter the receiver's NEAR account, like ${example}`);
  }
  if (receiver === net.contract || receiver === net.mpc) throw new Error(`${receiver} can never transfer a satchel out`);
  try {
    await viewAccount(net, receiver);
  } catch (err) {
    if (missing(err)) {
      throw new Error(
        `${receiver} doesn't exist on NEAR ${net.id}, so a satchel sent there could be lost. Ask for an account that exists.`,
      );
    }
    throw new Error(`Couldn't check that ${receiver} exists, so nothing was signed: ${message(err)}`);
  }
}
