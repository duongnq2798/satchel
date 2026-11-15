import type { Metadata } from "next";
import { MAINNET, type Network, type NetworkId, TESTNET } from "satchel-nft";

/** A satchel's id as its pages take it: up to 19 digits. Anything else answers 404 before any read. */
export function isSatchelId(id: string): boolean {
  return /^\d{1,19}$/.test(id);
}

/**
 * The not-found page's title and description. A satchel's or a DAO's page whose id can't exist
 * gives them too: its layout answers 404, but its own metadata would still name the id in the tab.
 */
export const NOT_FOUND: Metadata = {
  title: "Page not found",
  description: "Satchel has no page at this address. A satchel's page is /satchel/ and its id, and the verify page takes an id or a link.",
};

/** Where each network's pages live: the site's root for testnet, /mainnet for mainnet. */
const BASE: Record<NetworkId, "" | "/mainnet"> = { testnet: "", mainnet: "/mainnet" };

/** The network a page belongs to: everything under /mainnet is mainnet, the rest testnet. */
export function networkForPath(pathname: string | null): Network {
  return pathname === "/mainnet" || pathname?.startsWith("/mainnet/") ? MAINNET : TESTNET;
}

/** `path` ("/", "/market", "/satchel/3") on `net`'s side of the site. */
export function appPath(net: Network, path: string): string {
  const base = BASE[net.id];
  if (base === "") return path;
  return path === "/" ? base : `${base}${path}`;
}

/**
 * The page on `to` that matches `pathname`: the market, your satchels and verify have a twin on
 * each network; anything else, a satchel's page or a DAO's board included (ids differ by network), goes home.
 */
export function switchPath(pathname: string | null, to: Network): string {
  const rest = (pathname ?? "/").replace(/^\/mainnet(?=\/|$)/, "") || "/";
  return appPath(to, ["/market", "/satchels", "/verify"].includes(rest) ? rest : "/");
}
