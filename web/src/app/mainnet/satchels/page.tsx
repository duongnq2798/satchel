import type { Metadata } from "next";

// The same page on mainnet: it reads the network from the path (components/network.tsx).
export { default } from "../../satchels/page";

export const metadata: Metadata = {
  title: "Your satchels on mainnet",
  description:
    "Connect a NEAR mainnet wallet, mint a satchel for 0.1 NEAR and see the ones you own. Each one is an address on 16 EVM chains that moves with the NFT. Not audited.",
};
