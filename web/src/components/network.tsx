"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, createContext, useContext } from "react";
import { type Network, TESTNET } from "satchel-nft";
import { networkForPath } from "@/lib/routes";

const NetworkContext = createContext<Network>(TESTNET);

/** The network of the page on screen, from its path: /mainnet/… is mainnet, everything else testnet. */
export function NetworkProvider({ children }: { children: ReactNode }) {
  const net = networkForPath(usePathname());
  return <NetworkContext.Provider value={net}>{children}</NetworkContext.Provider>;
}

export function useNetwork(): Network {
  return useContext(NetworkContext);
}
