import type { Metadata } from "next";
import { Fraunces, Inter, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import type { ReactNode } from "react";
import { ConnectButton, WalletProvider } from "@/components/wallet";
import { NETWORK, REPO_URL, nearAccountUrl } from "@/lib/config";
import "./globals.css";

const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", axes: ["opsz"] });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });

export const metadata: Metadata = {
  title: { default: "Satchel: an NFT that is a wallet on every EVM chain", template: "%s · Satchel" },
  description:
    "Each Satchel NFT controls one address on 16 EVM chains through NEAR Chain Signatures. Sell the NFT and the keys move with it; a public signing record proves what the seller could have kept back.",
  icons: { icon: "/icon.svg" },
};

const NAV = [
  { href: "/#how", label: "How it works" },
  { href: "/market", label: "Market" },
  { href: "/satchels", label: "Your satchels" },
  { href: "/verify", label: "Verify" },
  { href: "/#developers", label: "Developers" },
];

const FOOTER: { title: string; links: { href: string; label: string; external?: boolean }[] }[] = [
  {
    title: "Product",
    links: [
      { href: "/market", label: "Market" },
      { href: "/satchels", label: "Mint a satchel" },
      { href: "/verify", label: "Verify a satchel" },
      { href: "/#examples", label: "Try to cheat a buyer" },
    ],
  },
  {
    title: "Proof",
    links: [
      { href: nearAccountUrl(NETWORK.contract), label: "The contract on NearBlocks", external: true },
      { href: NETWORK.build.ciRun, label: "Reproducible build", external: true },
      { href: `${REPO_URL}/tree/main/deployments`, label: "Evidence files", external: true },
    ],
  },
  {
    title: "Developers",
    links: [
      { href: REPO_URL, label: "Source on GitHub", external: true },
      { href: `${REPO_URL}#readme`, label: "README", external: true },
      { href: `${REPO_URL}/blob/main/CHANGELOG.md`, label: "Changelog", external: true },
    ],
  },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable} ${jetbrains.variable}`}>
      <body className="min-h-screen">
        <WalletProvider>
          <div className="bg-ink px-4 py-1.5 text-center text-xs text-paper/80">
            NEAR testnet. Satchels here sign with the testnet MPC network: never send real funds to their addresses.
          </div>
          <header className="z-40 border-b border-line bg-paper/90 backdrop-blur md:sticky md:top-0">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <Link href="/" className="flex items-center gap-2 font-display text-xl font-semibold tracking-tight">
                  <img src="/icon.svg" alt="" className="size-7" />
                  Satchel
                </Link>
                <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-2">
                  {NAV.map((n) => (
                    <Link key={n.href} href={n.href} className="hover:text-ink">
                      {n.label}
                    </Link>
                  ))}
                </nav>
              </div>
              <ConnectButton />
            </div>
          </header>
          <main className="mx-auto max-w-6xl px-4 py-10">{children}</main>
          <footer className="mt-16 border-t border-line bg-paper-2">
            <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
              <div>
                <Link href="/" className="flex items-center gap-2 font-display text-xl font-semibold tracking-tight">
                  <img src="/icon.svg" alt="" className="size-7" />
                  Satchel
                </Link>
                <p className="mt-3 max-w-xs text-sm text-ink-2">
                  An NFT that is a wallet on every EVM chain, built on NEAR Chain Signatures for the NEAR Hackathon 2026.
                </p>
                <p className="mt-3 text-sm text-muted">NEAR testnet. Not audited.</p>
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
                          <Link href={l.href} className="hover:text-ink">
                            {l.label}
                          </Link>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </footer>
        </WalletProvider>
      </body>
    </html>
  );
}
