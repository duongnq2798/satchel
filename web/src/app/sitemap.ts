import type { MetadataRoute } from "next";
import { PAGES } from "@/lib/docs/nav";

const SITE = "https://satchelnft.xyz";

/** The site's pages for search engines: the app on both networks, then every docs page. */
export default function sitemap(): MetadataRoute.Sitemap {
  const app = ["/", "/market", "/verify", "/satchels", "/mainnet", "/mainnet/market", "/mainnet/verify", "/mainnet/satchels"];
  return [
    ...app.map((path) => ({ url: `${SITE}${path === "/" ? "" : path}`, changeFrequency: "daily" as const, priority: path === "/" ? 1 : 0.6 })),
    ...PAGES.map((p) => ({ url: `${SITE}${p.href}`, changeFrequency: "weekly" as const, priority: p.slug === "" ? 0.9 : 0.7 })),
  ];
}
