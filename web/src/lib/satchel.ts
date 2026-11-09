import { MINT_DEPOSIT, NETWORK, ONE_YOCTO, TGAS } from "./config";
import type { ContractTx } from "./evm";
import { type Listing, type SatchelView, type Token, view } from "./near";

/** Reads from the Satchel contract. */
export const satchel = {
  get: (tokenId: string) => view<SatchelView | null>(NETWORK.contract, "satchel", { token_id: tokenId }),
  tokensFor: (accountId: string) =>
    view<Token[]>(NETWORK.contract, "nft_tokens_for_owner", { account_id: accountId, from_index: "0", limit: 100 }),
  listings: (fromIndex = 0, limit = 100) =>
    view<[string, Listing][]>(NETWORK.contract, "listings", { from_index: fromIndex, limit }),
  totalSupply: async () => Number(await view<string>(NETWORK.contract, "nft_total_supply")),
  mpcContract: () => view<string>(NETWORK.contract, "mpc_contract"),
  signingHash: (tx: ContractTx) => view<string>(NETWORK.contract, "evm_signing_hash", { tx }),
};

/** A transaction for the wallet, in near-connect's (wallet-selector) action format. */
export interface WalletTx {
  receiverId: string;
  actions: {
    type: "FunctionCall";
    params: { methodName: string; args: Record<string, unknown>; gas: string; deposit: string };
  }[];
}

function call(methodName: string, args: Record<string, unknown>, deposit: bigint, tgas: bigint): WalletTx {
  return {
    receiverId: NETWORK.contract,
    actions: [{ type: "FunctionCall", params: { methodName, args, gas: (tgas * TGAS).toString(), deposit: deposit.toString() } }],
  };
}

/** Transactions the app asks the wallet to sign. Gas and deposits match the contract's checks. */
export const satchelTx = {
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
