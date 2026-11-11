import type { Metadata } from "next";

// The same page on mainnet: it reads the network from the path (components/network.tsx).
export { default } from "../../verify/page";

export const metadata: Metadata = {
  title: "Verify a satchel on mainnet",
  description:
    "Read any satchel's clean transfer report on NEAR mainnet, no wallet needed: four checks of what its previous owners could have kept back. Type an id or paste a satchel's link.",
};
