import type { Metadata } from "next";
import { Fraunces, Inter, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { NetworkProvider } from "@/components/network";
import { NetLink, NetworkBanner, SiteHeader } from "@/components/site-header";
import { WalletProvider } from "@/components/wallet";
import { MAINNET, REPO_URL, TESTNET, nearAccountUrl } from "satchel-nft";
import "./globals.css";

const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", axes: ["opsz"] });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });

export const metadata: Metadata = {
  metadataBase: new URL("https://satchelnft.xyz"),
  title: { default: "Satchel: an NFT that is one wallet on 16 EVM chains", template: "%s · Satchel" },
  description:
    "Each Satchel NFT controls one address on 16 EVM chains through NEAR Chain Signatures. Sell the NFT and the wallet moves with it; a public signing record proves what the seller could have kept back.",
  icons: { icon: "/icon.svg" },
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
    <html lang="en" className={`${fraunces.variable} ${inter.variable} ${jetbrains.variable}`} suppressHydrationWarning>
      <body className="min-h-screen">
        <NetworkProvider>
          <WalletProvider>
            <NetworkBanner />
            <SiteHeader />
            <main className="mx-auto max-w-(--page-max) px-4 py-10">{children}</main>
            <footer className="mt-16 border-t border-line bg-paper-2">
              <div className="mx-auto grid max-w-(--page-max) gap-10 px-4 py-12 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
                <div>
                  <NetLink href="/" follow className="flex items-center gap-2 font-display text-xl font-semibold tracking-tight">
                    <img src="/icon.svg" alt="" className="size-7" />
                    Satchel
                  </NetLink>
                  <p className="mt-3 max-w-xs text-sm text-ink-2">
                    An NFT that is one wallet on 16 EVM chains, built on NEAR Chain Signatures for the NEAR Hackathon 2026.
                  </p>
                  <p className="mt-3 text-sm text-muted">NEAR testnet and mainnet. Not audited.</p>
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
