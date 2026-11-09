import { type Address, erc20Abi } from "viem";
import { type ChainInfo, type Network, sendChains } from "./config.js";
import { client } from "./evm.js";

/** A token whose balance a satchel's page shows. Display only: the report never reads these. */
export interface TokenInfo {
  /** Which of the three it is. */
  kind: "USDC" | "USDT" | "WETH";
  /** The symbol its contract reports, which is what the page shows: "USD₮0" on Arbitrum, "WETH.e" on Avalanche. */
  symbol: string;
  address: Address;
  decimals: number;
}

const token = (kind: TokenInfo["kind"], address: Address, symbol: string = kind, decimals = kind === "WETH" ? 18 : 6): TokenInfo => ({
  kind,
  symbol,
  address,
  decimals,
});

/**
 * USDC, USDT and WETH on each chain, where the issuer or the chain names a deployment; a chain with
 * none for a token leaves it out. USDC is Circle's
 * (https://developers.circle.com/stablecoins/usdc-contract-addresses). USDT is Tether's
 * (https://tether.to/en/supported-protocols) or, where Tether moved it, USDT0's
 * (https://docs.usdt0.to/technical-documentation/deployments). WETH's source is on its line. On
 * BNB Chain all three are Binance-Peg tokens with 18 decimals
 * (https://github.com/bnb-chain/bcfusion/blob/main/README.md), and its "WETH" is Binance-Peg ETH.
 * `node scripts/check-tokens.mjs` reads each address's code, symbol and decimals back from its chain.
 */
export const TOKENS: Readonly<Record<number, readonly TokenInfo[]>> = {
  1: [
    token("USDC", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"),
    token("USDT", "0xdAC17F958D2ee523a2206206994597C13D831ec7"),
    token("WETH", "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"), // https://ethereum.org/en/wrapped-eth/
  ],
  11155111: [
    token("USDC", "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"),
    token("WETH", "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14"), // https://developers.uniswap.org/docs/protocols/v3/deployments/v3-ethereum-deployments
  ],
  8453: [
    token("USDC", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
    token("WETH", "0x4200000000000000000000000000000000000006"), // https://docs.base.org/base-chain/network-information/base-contracts
  ],
  84532: [
    token("USDC", "0x036CbD53842c5426634e7929541eC2318f3dCF7e"),
    token("WETH", "0x4200000000000000000000000000000000000006"), // https://docs.base.org/base-chain/network-information/base-contracts
  ],
  42161: [
    token("USDC", "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"),
    token("USDT", "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", "USD₮0"),
    token("WETH", "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"), // https://docs.arbitrum.io/build-decentralized-apps/reference/contract-addresses
  ],
  421614: [
    token("USDC", "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d"),
    token("WETH", "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73"), // https://docs.arbitrum.io/build-decentralized-apps/reference/contract-addresses
  ],
  10: [
    token("USDC", "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85"),
    // USDT0. The older bridged "USDT" at 0x94b0…8e58 isn't on Tether's or USDT0's list.
    token("USDT", "0x01bFF41798a0BcF287b996046Ca68b395DbC1071", "USD₮0"),
    token("WETH", "0x4200000000000000000000000000000000000006"), // https://specs.optimism.io/protocol/predeploys.html
  ],
  11155420: [
    token("USDC", "0x5fd84259d66Cd46123540766Be93DFE6D43130D7"),
    token("WETH", "0x4200000000000000000000000000000000000006"), // https://specs.optimism.io/protocol/predeploys.html
  ],
  137: [
    token("USDC", "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"),
    token("USDT", "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", "USDT0"),
    token("WETH", "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619"), // https://docs.polygon.technology/pos/reference/mapped-tokens
  ],
  80002: [
    token("USDC", "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582"),
    token("WETH", "0x52eF3d68BaB452a294342DC3e5f464d7f610f72E"), // https://docs.polygon.technology/pos/reference/mapped-tokens
  ],
  56: [
    token("USDC", "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", "USDC", 18),
    token("USDT", "0x55d398326f99059fF775485246999027B3197955", "USDT", 18),
    token("WETH", "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", "ETH"),
  ],
  97: [],
  43114: [
    token("USDC", "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E"),
    token("USDT", "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", "USDt"),
    // https://github.com/ava-labs/avalanche-bridge-resources/blob/main/avalanche_contract_address.json
    token("WETH", "0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB", "WETH.e"),
  ],
  43113: [token("USDC", "0x5425890298aed601595a70AB815c96711a31Bc65")],
  // https://aurora.dev/tokens. Aurora's gas token is ETH itself, and it names no WETH.
  1313161554: [
    token("USDC", "0x368EBb46ACa6b8D0787C96B2b20bD3CC3F2c45F7"),
    token("USDT", "0x80Da25Da4D783E57d2FCdA0436873A193a4BEccF", "USDt"),
  ],
  1313161555: [],
};

/** What one chain holds for an address: its native coin and the tokens above. `null` = unreadable. */
export interface ChainContents {
  chain: ChainInfo;
  native: bigint | null;
  tokens: { token: TokenInfo; amount: bigint | null }[];
}

/**
 * What a satchel's address holds on each of the network's chains, read now from each chain's RPC.
 * Tokens other than USDC, USDT and WETH aren't read; an explorer shows them.
 */
export function contents(net: Network, address: Address): Promise<ChainContents[]> {
  return Promise.all(sendChains(net).map((chain) => chainContents(chain, address)));
}

export async function chainContents(chain: ChainInfo, address: Address): Promise<ChainContents> {
  const rpc = client(chain.id);
  const [native, ...amounts] = await Promise.all([
    rpc.getBalance({ address }).catch(() => null),
    ...(TOKENS[chain.id] ?? []).map((token) =>
      rpc.readContract({ address: token.address, abi: erc20Abi, functionName: "balanceOf", args: [address] }).catch(() => null),
    ),
  ]);
  return { chain, native, tokens: (TOKENS[chain.id] ?? []).map((token, i) => ({ token, amount: amounts[i] })) };
}
