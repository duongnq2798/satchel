import type { ReactNode } from "react";
import { MAINNET, REPO_URL, TESTNET, nearAccountUrl } from "satchel-nft";
import { NetLink, SatchelMark } from "@/components/site-header";

type FooterLink = { href: string; label: string; external?: boolean; follow?: boolean };

/** `follow` links go to the same page on the network on screen; the rest go where they say. */
const COLUMNS: { title: string; links: FooterLink[] }[] = [
  {
    title: "Product",
    links: [
      { href: "/market", label: "Market", follow: true },
      { href: "/satchels", label: "Mint a satchel", follow: true },
      { href: "/verify", label: "Verify a satchel", follow: true },
      { href: "/#examples", label: "Try to cheat a buyer" },
      { href: "/mainnet", label: "Satchels with real funds" },
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

/** Satchel's own accounts. It has no Discord or Telegram, so neither is linked. */
const SOCIAL: { href: string; label: string; icon: ReactNode }[] = [
  { href: "https://x.com/satchelnfthq", label: "Satchel on X", icon: <XIcon /> },
  { href: REPO_URL, label: "Satchel on GitHub", icon: <GitHubIcon /> },
];

// Muted is 7.1:1 on paper-2 (7.0:1 in the docs' dark theme), held to AAA by the contrast test; hover turns it ink.
const LINK = "text-muted transition-colors duration-150 hover:text-ink motion-reduce:transition-none";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-line bg-paper-2">
      <div className="mx-auto grid max-w-(--page-max) grid-cols-1 gap-10 px-4 pt-12 pb-10 md:grid-cols-12 md:gap-8">
        <div className="md:col-span-4">
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
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 md:col-span-8">
          {COLUMNS.map((col) => {
            const id = `footer-${col.title.toLowerCase()}`;
            return (
              <div key={col.title}>
                <p id={id} className="text-sm font-semibold text-ink">
                  {col.title}
                </p>
                <ul aria-labelledby={id} className="mt-3 space-y-2 text-sm">
                  {col.links.map((l) => (
                    <li key={l.href}>
                      {l.external ? (
                        <ExternalLink href={l.href} label={l.label} />
                      ) : (
                        <NetLink href={l.href} follow={l.follow} className={LINK}>
                          {l.label}
                        </NetLink>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
      </div>
      <div className="mx-auto max-w-(--page-max) px-4">
        <div className="flex flex-col gap-3 border-t border-line py-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted">© 2026 Satchel. Built for NEAR Hackathon 2026.</p>
          {/* 44px targets (WCAG 2.5.5); the negative margin lines each glyph up with the text edge. */}
          <ul aria-label="Satchel elsewhere" className="-ml-3 flex items-center gap-1 sm:-mr-3 sm:ml-0">
            {SOCIAL.map((s) => (
              <li key={s.href}>
                <a
                  href={s.href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex size-11 items-center justify-center rounded-full text-muted transition-colors duration-150 hover:bg-paper hover:text-ink motion-reduce:transition-none"
                >
                  {s.icon}
                  <span className="sr-only">{s.label} (opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}

/**
 * A link off the site, with an arrow that says so. The arrow is bound to the label's last word, so a
 * label that wraps never leaves it alone on a line. At 70% it is 3.5:1 on paper-2, 4.1:1 in the docs' dark
 * theme (WCAG 1.4.11 asks 3:1); the contrast test checks muted/70 on paper-2.
 */
function ExternalLink({ href, label }: { href: string; label: string }) {
  const cut = label.lastIndexOf(" ") + 1;
  return (
    <a href={href} target="_blank" rel="noreferrer" className={`group ${LINK}`}>
      {label.slice(0, cut)}
      <span className="whitespace-nowrap">
        {label.slice(cut)}
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="ml-0.5 inline-block size-3.5 align-[-0.125em] opacity-70 transition-[opacity,translate] duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 motion-safe:group-hover:translate-x-0.5 motion-safe:group-hover:-translate-y-0.5 motion-reduce:transition-none"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M7 17 17 7M8 7h9v9" />
        </svg>
      </span>
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

// Thin-stroke marks from Tabler Icons (brand-x, brand-github), MIT, Copyright (c) 2020-2024 Paweł Kuna.
function XIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4l11.733 16h4.267l-11.733 -16z" />
      <path d="M4 20l6.768 -6.768m2.46 -2.46l6.772 -6.772" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 19c-4.3 1.4 -4.3 -2.5 -6 -3m12 5v-3.5c0 -1 .1 -1.4 -.5 -2c2.8 -.3 5.5 -1.4 5.5 -6a4.6 4.6 0 0 0 -1.3 -3.2a4.2 4.2 0 0 0 -.1 -3.2s-1.1 -.3 -3.5 1.3a12.3 12.3 0 0 0 -6.2 0c-2.4 -1.6 -3.5 -1.3 -3.5 -1.3a4.2 4.2 0 0 0 -.1 3.2a4.6 4.6 0 0 0 -1.3 3.2c0 4.6 2.7 5.7 5.5 6c-.6 .6 -.6 1.2 -.5 2v3.5" />
    </svg>
  );
}
