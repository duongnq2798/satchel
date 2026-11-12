import type { MetadataRoute } from "next";
import { NETWORKS, TESTNET } from "satchel-nft";
import { BOUNTY_DAO } from "@/lib/dao-board";
import { PAGES } from "@/lib/docs/nav";
import { appPath } from "@/lib/routes";
import { DEMO_SATCHELS } from "@/lib/showcase";

const SITE = "https://satchelnft.xyz";

/** The site's pages for search engines: the app on both networks, the demo satchels, the bounty board, then every docs page. */
export default function sitemap(): MetadataRoute.Sitemap {
  const app = ["/", "/market", "/verify", "/satchels", "/mainnet", "/mainnet/market", "/mainnet/verify", "/mainnet/satchels"];
  return [
    ...app.map((path) => ({ url: `${SITE}${path === "/" ? "" : path}`, changeFrequency: "daily" as const, priority: path === "/" ? 1 : 0.6 })),
    ...DEMO_SATCHELS.map((d) => ({
      url: `${SITE}${appPath(NETWORKS[d.network], `/satchel/${d.tokenId}`)}`,
      changeFrequency: "daily" as const,
      priority: 0.5,
    })),
    { url: `${SITE}${appPath(TESTNET, `/dao/${BOUNTY_DAO}`)}`, changeFrequency: "daily" as const, priority: 0.5 },
    ...PAGES.map((p) => ({ url: `${SITE}${p.href}`, changeFrequency: "weekly" as const, priority: p.slug === "" ? 0.9 : 0.7 })),
  ];
}
