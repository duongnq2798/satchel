import { MINT_DEPOSIT, type Network, ONE_YOCTO, TGAS } from "./config.js";
import type { ContractTx } from "./evm.js";
import { type Listing, type SatchelView, type Token, nearRpcUrl, view } from "./near.js";

/** The most rows the contract's `listings` view returns per page. */
export const LISTINGS_PAGE = 100;

/** Reads from the Satchel contract on `net`. */
export function satchel(net: Network) {
  const listings = (fromIndex = 0, limit = LISTINGS_PAGE) =>
    view<[string, Listing][]>(net, net.contract, "listings", { from_index: fromIndex, limit });
  const totalSupply = async () => Number(await view<string>(net, net.contract, "nft_total_supply"));
  return {
    /** Throws if the RPC answers about another token: addresses and transactions are built from this. */
    get: async (tokenId: string) => {
      const found = await view<SatchelView | null>(net, net.contract, "satchel", { token_id: tokenId });
      if (found !== null && (found.token_id !== tokenId || found.path !== `satchel/${tokenId}`)) {
        throw new Error(`${nearRpcUrl(net)} answered for satchel #${found.token_id} at path ${found.path}, not #${tokenId}`);
      }
      return found;
    },
    tokensFor: (accountId: string) =>
      view<Token[]>(net, net.contract, "nft_tokens_for_owner", { account_id: accountId, from_index: "0", limit: 100 }),
    /** One page of the `listings` view. It can hold fewer rows than `limit` with more after it: see `allListings`. */
    listings,
    /**
     * Every live listing. The contract pages its stored listings first and drops the stale ones
     * (seller no longer owns the token) after, so a page can come back short or empty with more
     * listings after it. Each stored listing is keyed by a token, and tokens are never burned, so
     * the total supply bounds their count: read pages until they cover it. Removing a listing
     * moves the last one into its slot, so one moved during the read can repeat; it is kept once.
     */
    allListings: async (): Promise<[string, Listing][]> => {
      const supply = await totalSupply();
      const found = new Map<string, Listing>();
      for (let from = 0; from < supply; from += LISTINGS_PAGE) {
        for (const [id, listing] of await listings(from, LISTINGS_PAGE)) found.set(id, listing);
      }
      return [...found];
    },
    totalSupply,
    mpcContract: () => view<string>(net, net.contract, "mpc_contract"),
    signingHash: (tx: ContractTx) => view<string>(net, net.contract, "evm_signing_hash", { tx }),
  };
}

/** A transaction for the wallet, in near-connect's (wallet-selector) action format. */
export interface WalletTx {
  receiverId: string;
  actions: {
    type: "FunctionCall";
    params: { methodName: string; args: Record<string, unknown>; gas: string; deposit: string };
  }[];
}

/** Transactions the app asks the wallet to sign on `net`. Gas and deposits match the contract's checks. */
export function satchelTx(net: Network) {
  const call = (methodName: string, args: Record<string, unknown>, deposit: bigint, tgas: bigint): WalletTx => ({
    receiverId: net.contract,
    actions: [{ type: "FunctionCall", params: { methodName, args, gas: (tgas * TGAS).toString(), deposit: deposit.toString() } }],
  });
  return {
    mint: () => call("mint", {}, MINT_DEPOSIT, 50n),
    /** The contract needs at least 50 TGas; the rest goes to the MPC request and its answer. */
    signEvm: (tokenId: string, tx: ContractTx) => call("sign_evm", { token_id: tokenId, tx }, ONE_YOCTO, 300n),
    list: (tokenId: string, priceYocto: bigint) =>
      call("list", { token_id: tokenId, price: priceYocto.toString() }, ONE_YOCTO, 30n),
    delist: (tokenId: string) => call("delist", { token_id: tokenId }, ONE_YOCTO, 30n),
    /** Pins the record version and price the buyer checked; the contract refuses any other. */
    buy: (tokenId: string, recordVersion: string, priceYocto: bigint) =>
      call("buy", { token_id: tokenId, record_version: recordVersion, price: priceYocto.toString() }, priceYocto, 100n),
    transfer: (tokenId: string, receiverId: string) =>
      call("nft_transfer", { token_id: tokenId, receiver_id: receiverId }, ONE_YOCTO, 30n),
  };
}

const YOCTO_PER_NEAR = 10n ** 24n;

/** "1.5" → yoctoNEAR. Throws on anything that is not a positive decimal with at most 24 places. */
export function parseNear(input: string): bigint {
  const text = input.trim();
  if (!/^\d+(\.\d{1,24})?$/.test(text)) throw new Error("Enter an amount in NEAR, like 2.5");
  const [whole, fraction = ""] = text.split(".");
  const value = BigInt(whole) * YOCTO_PER_NEAR + BigInt(fraction.padEnd(24, "0"));
  if (value === 0n) throw new Error("The price must be above 0");
  return value;
}

export function formatNear(yocto: string | bigint, digits = 4): string {
  const value = BigInt(yocto);
  const whole = value / YOCTO_PER_NEAR;
  const fraction = (value % YOCTO_PER_NEAR).toString().padStart(24, "0").slice(0, digits).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
