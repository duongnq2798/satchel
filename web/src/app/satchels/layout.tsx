import type { Metadata } from "next";
import type { ReactNode } from "react";

// The page is a client component, which can't export metadata, so its title and description sit here.
export const metadata: Metadata = {
  title: "Your satchels",
  description:
    "Connect a NEAR testnet wallet, mint a satchel for 0.1 NEAR and see the ones you own. Each one is an address on 16 EVM chains that moves with the NFT.",
};

export default function SatchelsLayout({ children }: { children: ReactNode }) {
  return children;
}
