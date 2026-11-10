/**
 * The documentation's information architecture: every page, in reading order, with the title and
 * description its <title>, sidebar, search, breadcrumbs, sitemap and llms.txt all take from here.
 * A page's content lives in web/content/docs/<locale>/<slug>.mdx, or, for a page that renders a
 * file the repository already keeps (the threat model, the changelog), in that file.
 *
 * To add a page: add it here, then write its .mdx file. `docs.test.ts` fails if either is missing,
 * or if any link between pages points at a page or heading that doesn't exist.
 */

export interface DocPage {
  /** The URL after /docs/, "" for the overview. Lowercase words joined by hyphens. */
  slug: string;
  title: string;
  /** One sentence: the page's lead, its meta description and its search snippet. */
  description: string;
  /** A shorter label for the sidebar, when the title is long. */
  nav?: string;
  /** Renders this repository file (a path from the repository root) instead of an .mdx page. */
  repoFile?: string;
}

export interface DocSection {
  title: string;
  pages: DocPage[];
}

export const DOCS: DocSection[] = [
  {
    title: "Get started",
    pages: [
      {
        slug: "",
        title: "Satchel documentation",
        nav: "Overview",
        description:
          "What Satchel is, the problem it solves, and where to start: as a buyer, an owner, a developer or an evaluator.",
      },
      {
        slug: "quickstart",
        title: "Quickstart: check a satchel in two minutes",
        nav: "Quickstart",
        description: "Read a real satchel's clean transfer report in your browser and in your terminal, with no wallet, key or account.",
      },
      {
        slug: "how-it-works",
        title: "How Satchel works",
        description: "The contract, NEAR's MPC network, the EVM chains and the report, and what happens at each step of a sale.",
      },
      {
        slug: "use-cases",
        title: "Use cases",
        description: "What Satchel is for, who uses it and how, and when it is the wrong tool.",
      },
    ],
  },
  {
    title: "Core concepts",
    pages: [
      {
        slug: "concepts/satchels-and-addresses",
        title: "Satchels and their addresses",
        nav: "Satchels and addresses",
        description: "A satchel is a NEAR NFT whose key NEAR's MPC network derives from a fixed path: one address on 16 EVM chains, controlled by whoever owns the token.",
      },
      {
        slug: "concepts/signing-record",
        title: "The signing record",
        description: "The public, per-token record the contract writes before every signature: nonces, approvals, counters and a version.",
      },
      {
        slug: "concepts/clean-transfer-report",
        title: "The clean transfer report",
        description: "The four checks a buyer runs against NEAR and every chain in the record, what each status means, and why a verdict can only be clean when all four pass.",
      },
      {
        slug: "concepts/listings-and-sales",
        title: "Listings and sales",
        description: "How listing freezes signing, how buy pins the record version and price the buyer checked, and what ends a listing.",
      },
      {
        slug: "concepts/networks-and-chains",
        title: "Networks and chains",
        description: "The two deployments, their MPC contracts, the 16 EVM chains the contract signs for, and why a testnet satchel must never hold real funds.",
      },
    ],
  },
  {
    title: "Use the app",
    pages: [
      {
        slug: "guides/wallets",
        title: "Connect a NEAR wallet",
        nav: "Connect a wallet",
        description: "Which wallets satchelnft.xyz lists on each network, what you sign with them, and how the app keeps testnet and mainnet apart.",
      },
      {
        slug: "guides/mint-and-fund",
        title: "Mint and fund a satchel",
        nav: "Mint and fund",
        description: "Mint a satchel for 0.1 NEAR, find its address, and fund it on the right chain, in the right order.",
      },
      {
        slug: "guides/send",
        title: "Send from a satchel",
        description: "Send native coins or a contract call from a satchel's address, with every check the app runs before it broadcasts.",
      },
      {
        slug: "guides/sell",
        title: "Sell a satchel",
        description: "Get a satchel to read provably clean, list it, and what a buyer sees. Includes how to recover from each failing check.",
      },
      {
        slug: "guides/buy",
        title: "Buy a satchel",
        description: "Read the report, understand what it can't see, and buy at the record version you checked.",
      },
      {
        slug: "guides/transfer",
        title: "Transfer a satchel",
        description: "Give a satchel to another NEAR account, and what moves with it.",
      },
    ],
  },
  {
    title: "Tutorials",
    pages: [
      {
        slug: "tutorials/try-to-cheat-a-buyer",
        title: "Try to cheat a buyer",
        description: "Walk through the demo satchels, each left behind in a different way by its seller, and watch the report catch every one. No wallet needed.",
      },
      {
        slug: "tutorials/sale-on-testnet",
        title: "A full sale on testnet, from the terminal",
        nav: "A full sale on testnet",
        description: "Mint, fund, send, list, buy and hand back a satchel with the satchel-nft CLI and two testnet accounts.",
      },
      {
        slug: "tutorials/dao-owned-satchel",
        title: "A satchel owned by a Sputnik DAO",
        nav: "Owned by a DAO",
        description: "A DAO on testnet owned satchel #8: its vote has the contract build, record and sign a Sepolia send, anyone can finish it, and a hand-off keeps the same clean transfer report.",
      },
      {
        slug: "tutorials/clean-listings-feed",
        title: "Build a feed of clean listings",
        description: "Use the satchel-nft library to list every satchel for sale with its verdict, as JSON, in about 40 lines of TypeScript.",
      },
    ],
  },
  {
    title: "Developers",
    pages: [
      {
        slug: "developers",
        title: "Build on Satchel",
        nav: "Developer overview",
        description: "Three ways to integrate: the satchel-nft library, its CLI, or the contract itself from any NEAR client. Which to pick, and what each gives you.",
      },
      {
        slug: "developers/library",
        title: "TypeScript library reference",
        nav: "Library",
        description: "Every export of satchel-nft: the networks, the report, reads, wallet transactions, the send flow and the guards, with types and examples.",
      },
      {
        slug: "developers/cli",
        title: "CLI reference",
        nav: "CLI",
        description: "Every satchel-nft command and option, its output, its JSON, its exit codes and the environment variables it reads.",
      },
      {
        slug: "developers/contract",
        title: "Contract reference",
        nav: "Contract",
        description: "Every method of v1.satchel-nft.near and v1.satchel-nft.testnet: arguments, deposits, gas, return values and JSON types, with near CLI calls.",
      },
      {
        slug: "developers/events",
        title: "Events",
        description: "The NEP-297 events the contract logs, for indexers and bots: nft_mint, nft_transfer and Satchel's own sign_evm, sign_raw, list, delist and sale.",
      },
      {
        slug: "developers/errors",
        title: "Errors and exit codes",
        description: "Every error the contract can return, the CLI's exit codes, and the report's statuses, with what causes each and what to do.",
      },
      {
        slug: "developers/rpc-and-finality",
        title: "RPCs, finality and rate limits",
        nav: "RPCs and finality",
        description: "Which nodes the report reads, how it pins every read to a finalized block, how to use your own nodes, and how to stay under public rate limits.",
      },
    ],
  },
  {
    title: "Advanced",
    pages: [
      {
        slug: "advanced/automation",
        title: "Automate with the CLI",
        description: "Run satchel-nft from scripts, CI and bots: JSON output, exit codes, --yes, and how to handle a transaction whose outcome is unknown.",
      },
      {
        slug: "advanced/run-the-app",
        title: "Run the web app yourself",
        description: "Run satchelnft.xyz from source, build it, deploy it, and point it at nodes you trust.",
      },
      {
        slug: "advanced/production-checklist",
        title: "Production checklist",
        description: "What to pin, check and avoid before you hold real funds in a satchel or build a product on one.",
      },
    ],
  },
  {
    title: "Security and trust",
    pages: [
      {
        slug: "security",
        title: "Security model",
        description: "The layers that keep a satchel honest, what Satchel trusts, what it does not claim, and where each rule is enforced.",
      },
      {
        slug: "security/check-every-claim",
        title: "Check every claim",
        description: "The commands that check each claim about the deployments against the chain, and where each rule lives in the code and its tests.",
        repoFile: "AGENTS.md",
      },
      {
        slug: "security/threat-model",
        title: "Threat model",
        description: "Every attack Satchel is built against (the seller's, a buyer's, the deployer's, an RPC's, the hosted app's), what stops it, and what is left.",
        repoFile: "docs/THREAT_MODEL.md",
      },
      {
        slug: "security/report-a-vulnerability",
        title: "Report a vulnerability",
        description: "How to report a security problem privately, what is in scope, and what to expect.",
        repoFile: "SECURITY.md",
      },
    ],
  },
  {
    title: "Resources",
    pages: [
      {
        slug: "faq",
        title: "Frequently asked questions",
        nav: "FAQ",
        description: "Short answers to what people ask most about satchels, the report, fees, networks and safety.",
      },
      {
        slug: "troubleshooting",
        title: "Troubleshooting",
        description: "What to do when a report can't check everything, a send or a purchase is refused, or the CLI stops.",
      },
      {
        slug: "glossary",
        title: "Glossary",
        description: "The terms these docs use, from approval to yoctoNEAR, each with a link to where it is explained.",
      },
      {
        slug: "changelog",
        title: "Changelog",
        description: "Every notable change to the contract, the package, the app and the docs.",
        repoFile: "CHANGELOG.md",
      },
    ],
  },
];

export const LOCALES = ["en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export interface PlacedPage extends DocPage {
  section: string;
  /** /docs or /docs/<slug>. */
  href: string;
}

export const PAGES: PlacedPage[] = DOCS.flatMap((section) =>
  section.pages.map((page) => ({ ...page, section: section.title, href: docHref(page.slug) })),
);

export function docHref(slug: string): string {
  return slug === "" ? "/docs" : `/docs/${slug}`;
}

export function findPage(slug: string): PlacedPage | undefined {
  return PAGES.find((p) => p.slug === slug);
}

/** The pages before and after `slug` in reading order, across sections. */
export function neighbours(slug: string): { prev?: PlacedPage; next?: PlacedPage } {
  const i = PAGES.findIndex((p) => p.slug === slug);
  if (i === -1) return {};
  return { prev: PAGES[i - 1], next: PAGES[i + 1] };
}

/** The page a repository file renders as, so a link to AGENTS.md in a rendered file stays in the docs. */
export function pageForRepoFile(repoPath: string): PlacedPage | undefined {
  return PAGES.find((p) => p.repoFile === repoPath);
}
