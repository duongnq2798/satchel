import type { Metadata } from "next";
import type { ReactNode } from "react";

// The page is a client component, which can't export metadata, so its title and description sit here.
export const metadata: Metadata = {
  title: "Verify a satchel",
  description:
    "Read any satchel's clean transfer report on NEAR testnet, no wallet needed: four checks of what its previous owners could have kept back. Type an id or paste a satchel's link.",
};

export default function VerifyLayout({ children }: { children: ReactNode }) {
  return children;
}
