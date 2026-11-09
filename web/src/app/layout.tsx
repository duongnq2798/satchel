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
  { href: "/market", label: "Market" },
  { href: "/satchels", label: "Your satchels" },
  { href: "/verify", label: "Verify" },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable} ${jetbrains.variable}`}>
      <body className="min-h-screen">
        <WalletProvider>
          <div className="bg-ink px-4 py-1.5 text-center text-xs text-paper/80">
            NEAR testnet. Satchels here sign with the testnet MPC network: never send real funds to their addresses.
          </div>
          <header className="border-b border-line">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
              <div className="flex items-center gap-6">
                <Link href="/" className="flex items-center gap-2 font-display text-xl font-semibold tracking-tight">
                  <img src="/icon.svg" alt="" className="size-7" />
                  Satchel
                </Link>
                <nav className="flex gap-4 text-sm text-ink-2">
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
          <footer className="border-t border-line">
            <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-3 px-4 py-6 text-sm text-muted">
              <span>Built on NEAR Chain Signatures for the NEAR Hackathon 2026. Not audited.</span>
              <span className="flex gap-4">
                <a href={nearAccountUrl(NETWORK.contract)} target="_blank" rel="noreferrer" className="hover:text-ink">
                  {NETWORK.contract}
                </a>
                <a href={REPO_URL} target="_blank" rel="noreferrer" className="hover:text-ink">
                  Source
                </a>
              </span>
            </div>
          </footer>
        </WalletProvider>
      </body>
    </html>
  );
}
