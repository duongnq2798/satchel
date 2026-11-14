import { MAINNET, type Network } from "satchel-nft";
import { isFrozen } from "./frozen";
import { appPath } from "./routes";
import { MAINNET_SALE } from "./showcase";

// Where a visitor goes to try the app while the demo satchels' owner and buy actions are off
// (lib/frozen.ts): a finished sale to read, NEAR's own testnet faucet, and a satchel of their own.

/** Mainnet satchel #3's deed of sale, under its report: a self-sale between two of the builder's accounts. */
export const SALE_DEED_PATH = `${appPath(MAINNET, `/satchel/${MAINNET_SALE.tokenId}`)}#deed`;

/** Testnet's "Your satchels", where anyone mints one with testnet NEAR, whichever network the page is on. */
export const MINT_PATH = "/satchels";

/** NEAR's own page on making a testnet account with a wallet or the CLI (docs.near.org, "Create an Account"). */
export const TESTNET_ACCOUNT_URL = "https://docs.near.org/getting-started/create-account";

/** NEAR's own page for free testnet NEAR (docs.near.org, "Get Testnet Tokens"). */
export const TESTNET_FAUCET_URL = "https://docs.near.org/getting-started/faucet";

/**
 * Whether every satchel listed is a demo satchel, so the market says why the app won't buy one and
 * where to see a sale instead. False when nothing is listed: the market says so on its own.
 */
export function allDemo(net: Network, ids: readonly string[], now: Date = new Date()): boolean {
  return ids.length > 0 && ids.every((id) => isFrozen(net, id, now));
}
