import type { Metadata } from "next";
import { Fraunces, Inter, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { NetworkProvider } from "@/components/network";
import { SiteFooter } from "@/components/site-footer";
import { NetworkBanner, SiteHeader } from "@/components/site-header";
import { WalletProvider } from "@/components/wallet";
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
            <SiteFooter />
          </WalletProvider>
        </NetworkProvider>
      </body>
    </html>
  );
}
