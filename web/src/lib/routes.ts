import { MAINNET, type Network, type NetworkId, TESTNET } from "satchel-nft";

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
 * each network; anything else, a satchel's page included (ids differ by network), goes home.
 */
export function switchPath(pathname: string | null, to: Network): string {
  const rest = (pathname ?? "/").replace(/^\/mainnet(?=\/|$)/, "") || "/";
  return appPath(to, ["/market", "/satchels", "/verify"].includes(rest) ? rest : "/");
}
