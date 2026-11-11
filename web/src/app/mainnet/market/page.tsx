import type { Metadata } from "next";

// The same page on mainnet: it reads the network from the path (components/network.tsx).
export { default } from "../../market/page";

export const metadata: Metadata = {
  title: "Market on mainnet",
  description:
    "Every satchel for sale on NEAR mainnet, each with its clean transfer report run in your browser. A listed satchel can't sign, and a purchase names the record version you checked.",
};
