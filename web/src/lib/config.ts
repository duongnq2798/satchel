/**
 * The deployment this app talks to. Every value a buyer's check depends on is pinned here, with
 * where it comes from, so the report never trusts the contract to describe itself.
 */
export const NETWORK = {
  id: "testnet",
  contract: "v1.satchel-nft.testnet",
  /** The canonical Chain Signatures contract. `mpc_contract()` must return this. */
  mpc: "v1.signer-prod.testnet",
  nearRpc: "https://rpc.testnet.fastnear.com",
  nearExplorer: "https://testnet.nearblocks.io",
  /** From the reproducible CI build the contract was deployed from (deployments/testnet.json). */
  build: {
    codeHash: "94x4MmZKXGetffqJJVePLTdFkJvsmeXRLmi74Mdp2Lph",
    commit: "87148c6b6f97f3121cac13c93e22d7d153453b53",
    ciRun: "https://github.com/duongnq2798/satchel/actions/runs/42547394040",
  },
} as const;

export const REPO_URL = "https://github.com/duongnq2798/satchel";

/** yoctoNEAR the contract asks for a mint (0.1 NEAR). */
export const MINT_DEPOSIT = 100_000_000_000_000_000_000_000n;
export const ONE_YOCTO = 1n;
export const TGAS = 1_000_000_000_000n;

export interface ChainInfo {
  id: number;
  name: string;
  symbol: string;
  testnet: boolean;
  rpc: string;
  explorer: string;
  /**
   * Set where the RPC answers "finalized" with its latest block (Aurora), so reads go this many
   * blocks further back. Aurora's blocks follow NEAR's, which are final within a few blocks.
   */
  finalityLag?: bigint;
}

/**
 * The contract's `SUPPORTED_CHAINS`, in its order. The report must cover every one of them, mainnets
 * included: the testnet contract can sign for chain 1 as well, so a record may list it.
 */
export const CHAINS: readonly ChainInfo[] = [
  { id: 1, name: "Ethereum", symbol: "ETH", testnet: false, rpc: "https://ethereum-rpc.publicnode.com", explorer: "https://etherscan.io" },
  { id: 11155111, name: "Sepolia", symbol: "ETH", testnet: true, rpc: "https://ethereum-sepolia-rpc.publicnode.com", explorer: "https://sepolia.etherscan.io" },
  { id: 8453, name: "Base", symbol: "ETH", testnet: false, rpc: "https://base-rpc.publicnode.com", explorer: "https://basescan.org" },
  { id: 84532, name: "Base Sepolia", symbol: "ETH", testnet: true, rpc: "https://base-sepolia-rpc.publicnode.com", explorer: "https://sepolia.basescan.org" },
  { id: 42161, name: "Arbitrum One", symbol: "ETH", testnet: false, rpc: "https://arb1.arbitrum.io/rpc", explorer: "https://arbiscan.io" },
  { id: 421614, name: "Arbitrum Sepolia", symbol: "ETH", testnet: true, rpc: "https://sepolia-rollup.arbitrum.io/rpc", explorer: "https://sepolia.arbiscan.io" },
  { id: 10, name: "OP Mainnet", symbol: "ETH", testnet: false, rpc: "https://mainnet.optimism.io", explorer: "https://optimistic.etherscan.io" },
  { id: 11155420, name: "OP Sepolia", symbol: "ETH", testnet: true, rpc: "https://optimism-sepolia-rpc.publicnode.com", explorer: "https://sepolia-optimism.etherscan.io" },
  { id: 137, name: "Polygon", symbol: "POL", testnet: false, rpc: "https://polygon-bor-rpc.publicnode.com", explorer: "https://polygonscan.com" },
  { id: 80002, name: "Polygon Amoy", symbol: "POL", testnet: true, rpc: "https://polygon-amoy-bor-rpc.publicnode.com", explorer: "https://amoy.polygonscan.com" },
  { id: 56, name: "BNB Chain", symbol: "BNB", testnet: false, rpc: "https://bsc-rpc.publicnode.com", explorer: "https://bscscan.com" },
  { id: 97, name: "BNB testnet", symbol: "tBNB", testnet: true, rpc: "https://bsc-testnet-rpc.publicnode.com", explorer: "https://testnet.bscscan.com" },
  { id: 43114, name: "Avalanche", symbol: "AVAX", testnet: false, rpc: "https://avalanche-c-chain-rpc.publicnode.com", explorer: "https://snowtrace.io" },
  { id: 43113, name: "Avalanche Fuji", symbol: "AVAX", testnet: true, rpc: "https://avalanche-fuji-c-chain-rpc.publicnode.com", explorer: "https://testnet.snowtrace.io" },
  { id: 1313161554, name: "Aurora", symbol: "ETH", testnet: false, rpc: "https://mainnet.aurora.dev", explorer: "https://explorer.mainnet.aurora.dev", finalityLag: 10n },
  { id: 1313161555, name: "Aurora testnet", symbol: "ETH", testnet: true, rpc: "https://testnet.aurora.dev", explorer: "https://explorer.testnet.aurora.dev", finalityLag: 10n },
];

/** Chains this deployment lets you send on. A testnet satchel never moves mainnet funds from the app. */
export const SEND_CHAINS = CHAINS.filter((c) => c.testnet);

export function chainInfo(id: number): ChainInfo | undefined {
  return CHAINS.find((c) => c.id === id);
}

export function nearTxUrl(hash: string): string {
  return `${NETWORK.nearExplorer}/txns/${hash}`;
}

export function nearAccountUrl(account: string): string {
  return `${NETWORK.nearExplorer}/address/${account}`;
}
