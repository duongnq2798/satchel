import type { Metadata } from "next";
import type { ReactNode } from "react";

// The page is a client component, which can't export metadata, so its title and description sit here.
export const metadata: Metadata = {
  title: "Market",
  description:
    "Every satchel for sale on NEAR testnet, each with its clean transfer report run in your browser. A listed satchel can't sign, and a purchase names the record version you checked.",
};

export default function MarketLayout({ children }: { children: ReactNode }) {
  return children;
}
