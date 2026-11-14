import type { Metadata } from "next";
import { Fraunces, Inter, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { NetworkProvider } from "@/components/network";
import { NetLink, NetworkBanner, SatchelMark, SiteHeader } from "@/components/site-header";
import { WalletProvider } from "@/components/wallet";
import { MAINNET, REPO_URL, TESTNET, nearAccountUrl } from "satchel-nft";
import "./globals.css";

const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", axes: ["opsz"] });
// Body text never swaps fonts mid-page: Inter is used when it arrives within the first ~100 ms (it is
// preloaded, and cached after the first visit), and otherwise Inter Fallback, Arial sized to match, stays
// for that page load. A late swap rewrapped long lines, such as the DAO board's heading on a phone, and
// moved everything under them (0.123 layout shift on slow 4G, measured by scripts/loading-check.mjs).
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "optional" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });

export const metadata: Metadata = {
  metadataBase: new URL("https://satchelnft.xyz"),
  title: { default: "Satchel: sell a wallet, prove nothing stayed behind", template: "%s · Satchel" },
  description:
    "Each Satchel NFT controls one address on 16 EVM chains through NEAR Chain Signatures. Only its owner can have anything new signed; a public record shows a buyer what was signed before.",
  // With icons set here, Next.js links no icon file by itself: apple-icon.png beside this file is named
  // here. favicon.ico is the one it always links.
  icons: { icon: "/icon.svg", apple: "/apple-icon.png" },
  // A share card for every page. Its title and description are left out on purpose: Next.js then fills
  // og:title, og:description and the X card's from each page's own title and description, where these
  // would stand for every page. "./" is the page's own address. The image is opengraph-image.png and
  // twitter-image.png beside this file, with no verdict on it, since X keeps a card for days.
  openGraph: { siteName: "Satchel", type: "website", locale: "en_US", url: "./" },
  twitter: { card: "summary_large_image" },
};

/** `follow` links go to the same page on the network on screen; the rest go where they say. */
const FOOTER: { title: string; links: { href: string; label: string; external?: boolean; follow?: boolean }[] }[] = [
  {
    title: "Product",
    links: [
      { href: "/market", label: "Market", follow: true },
      { href: "/satchels", label: "Mint a satchel", follow: true },
      { href: "/verify", label: "Verify a satchel", follow: true },
      { href: "/#examples", label: "Try to cheat a buyer" },
      { href: "/mainnet", label: "Satchel on mainnet" },
    ],
  },
  {
    title: "Proof",
    links: [
      { href: nearAccountUrl(TESTNET, TESTNET.contract), label: "Testnet contract on NearBlocks", external: true },
      { href: nearAccountUrl(MAINNET, MAINNET.contract), label: "Mainnet contract on NearBlocks", external: true },
      { href: TESTNET.build.ciRun, label: "Reproducible build", external: true },
      { href: `${REPO_URL}/tree/main/deployments`, label: "Evidence files", external: true },
    ],
  },
  {
    title: "Developers",
    links: [
      { href: "/docs", label: "Documentation" },
      { href: "/docs/quickstart", label: "Quickstart" },
      { href: "/docs/developers/cli", label: "CLI reference" },
      { href: REPO_URL, label: "Source on GitHub", external: true },
      { href: `${REPO_URL}#readme`, label: "README", external: true },
      { href: `${REPO_URL}/blob/main/CHANGELOG.md`, label: "Changelog", external: true },
    ],
  },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The docs set data-theme on <html> before React loads (components/docs/theme.tsx).
    // data-scroll-behavior: on a route change the router jumps instead of gliding (globals.css scrolls
    // smoothly), so a link to /mainnet/satchel/3#deed lands on the deed while the report above it loads.
    <html
      lang="en"
      className={`${fraunces.variable} ${inter.variable} ${jetbrains.variable}`}
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <body className="min-h-screen">
        <NetworkProvider>
          <WalletProvider>
            <a
              href="#main"
              className="sr-only rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
            >
              Skip to content
            </a>
            <NetworkBanner />
            <SiteHeader />
            <main id="main" className="mx-auto max-w-(--page-max) scroll-mt-20 px-4 py-10">
              {children}
            </main>
            <footer className="mt-16 border-t border-line bg-paper-2">
              <div className="mx-auto grid max-w-(--page-max) gap-10 px-4 py-12 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
                <div>
                  <NetLink href="/" follow className="flex items-center gap-2 font-display text-xl font-semibold tracking-tight">
                    <SatchelMark />
                    Satchel
                  </NetLink>
                  <p className="mt-3 max-w-xs text-sm text-ink-2">
                    An NFT that is one wallet on 16 EVM chains, built on NEAR Chain Signatures for the NEAR Hackathon 2026.
                  </p>
                  <p className="mt-3 text-sm text-muted">NEAR testnet and mainnet. Not audited.</p>
                  {/* NEAR's own badge files, unchanged: black on light backgrounds, white on the docs' dark theme. */}
                  <a href="https://near.org" target="_blank" rel="noreferrer" className="mt-5 inline-block">
                    <img src="/built-on-near.svg" alt="Built on NEAR" className="h-6 w-auto [[data-theme=dark]_&]:hidden" />
                    <img src="/built-on-near-white.svg" alt="Built on NEAR" className="hidden h-6 w-auto [[data-theme=dark]_&]:block" />
                  </a>
                </div>
                {FOOTER.map((col) => (
                  <div key={col.title}>
                    <p className="text-sm font-medium">{col.title}</p>
                    <ul className="mt-3 space-y-2 text-sm text-ink-2">
                      {col.links.map((l) => (
                        <li key={l.href}>
                          {l.external ? (
                            <a href={l.href} target="_blank" rel="noreferrer" className="hover:text-ink">
                              {l.label}
                            </a>
                          ) : (
                            <NetLink href={l.href} follow={l.follow} className="hover:text-ink">
                              {l.label}
                            </NetLink>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </footer>
          </WalletProvider>
        </NetworkProvider>
      </body>
    </html>
  );
}
