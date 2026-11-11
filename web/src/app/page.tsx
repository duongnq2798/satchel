import Link from "next/link";
import type { ReactNode } from "react";
import { HeroCard } from "@/components/landing/hero-card";
import { SaleFlow } from "@/components/landing/sale-flow";
import { TrickExplorer } from "@/components/landing/trick-explorer";
import { LiveStats } from "@/components/live-stats";
import { ReportProvider } from "@/components/report-checker";
import { CHAINS, TESTNET } from "satchel-nft";
import { CHECKS, EVIDENCE } from "@/lib/copy";

const USUAL_WAY = [
  "The seller can keep a copy of the key, and nothing shows it",
  "A withdrawal signed before the sale can land after it",
  "An approval left behind drains the tokens later",
  "You find out after you have paid",
];

const SATCHEL_WAY = [
  "No key exists to copy: NEAR's MPC network signs, only for the NFT's owner",
  "Every nonce the contract signed is on record, and checked as spent",
  "Every approval it signed is on record, and read on chain as revoked",
  "You check before you pay, and the purchase names what you checked",
];

/** Questions a buyer asks, answered for a seed phrase, an ERC-6551 token-bound account and a satchel. */
const COMPARISON: { question: string; answers: [string, string, string]; tones: [Tone, Tone, Tone] }[] = [
  {
    question: "Can the seller keep a working key?",
    answers: ["Yes, a copy, and you can't tell", "No: the NFT's owner controls the account", "No: no one holds the key; the MPC network signs for the owner"],
    tones: ["bad", "ok", "ok"],
  },
  {
    question: "Can the seller empty it between your check and your purchase?",
    answers: ["Yes", "Unless the marketplace checks the account's state", "No: listing freezes signing, and buy names the version you checked"],
    tones: ["bad", "warn", "ok"],
  },
  {
    question: "Can you see the approvals the seller left?",
    answers: ["Only by scanning every token contract", "Only by scanning every token contract", "Yes: each one is in the record, and the report reads it on chain"],
    tones: ["bad", "warn", "ok"],
  },
  {
    question: "Does one sale cover many chains?",
    answers: ["Yes, if the same key is used everywhere", "One chain per NFT, unless a bridge says who owns it", `Yes: ${CHAINS.length} EVM chains, one NEAR transaction`],
    tones: ["warn", "warn", "ok"],
  },
];

type Tone = "ok" | "warn" | "bad";
const TONE_TEXT: Record<Tone, string> = { ok: "text-ok", warn: "text-warn", bad: "text-bad" };

/** Real output, trimmed to the check titles and the pending line (0.1.0 on 2026-11-09; 0.2.0 printed the same on 2026-11-10). */
const VERIFY_OUTPUT = `$ npx satchel-nft@0.2.0 verify 5
Satchel #5 on v1.satchel-nft.testnet (testnet)
owner satchel-nft.testnet, address 0x81149BF1C907579A150e9AB882E951B648853dA3, record version 1

[PASS] The contract can't sign behind the record
[FAIL] A signed transaction may still be pending
       Sepolia: signed up to nonce 0, finalized nonce is 0
[PASS] No approval left behind
[PASS] Nothing the record can't explain

NOT PROVABLE
$ echo $?
1`;

const FAQ: { q: string; a: ReactNode }[] = [
  {
    q: "Who holds a satchel's key?",
    a: "No one. NEAR's MPC network holds it in shares and signs with it only when the Satchel contract asks, and the contract asks only for the NFT's current owner. The contract itself has no access keys, so nobody can change that rule.",
  },
  {
    q: "Do I need an EVM wallet?",
    a: "No. Your NEAR wallet signs the request to the contract; the app builds the EVM transaction, checks the contract hashes it the same way, recovers the MPC signature's signer and broadcasts it.",
  },
  {
    q: "Why should I trust the report?",
    a: (
      <>
        You don't have to. It runs in your browser against public RPCs and names every one it read. In a terminal,{" "}
        <code className="font-mono text-[0.9em]">npx satchel-nft verify</code> does the same and takes your own nodes through{" "}
        <code className="font-mono text-[0.9em]">NEAR_RPC</code> and <code className="font-mono text-[0.9em]">RPC_&lt;chain id&gt;</code>.
      </>
    ),
  },
  {
    q: "Which chains does it work on?",
    a: `${CHAINS.length} EVM chains: Ethereum, Base, Arbitrum, OP, Polygon, BNB Chain, Avalanche and Aurora, with each one's testnet. Other secp256k1 chains can be signed for through sign_raw, which the record counts as opaque.`,
  },
  {
    q: "What does it cost?",
    a: "Minting takes 0.1 NEAR, which pays for the token's storage. Each signature costs gas and 1 yoctoNEAR. A sale costs the price the seller set, plus gas.",
  },
  {
    q: "Is it on mainnet?",
    a: "Yes, since 9 November 2026, at v1.satchel-nft.near: the same reproducible build as testnet, signing through v1.signer, locked before any satchel was minted. Its pages are under /mainnet. It has not been audited, so keep in a mainnet satchel only what you can afford to lose. The examples on this page are on testnet: never send real funds to a testnet satchel's address.",
  },
];

const LIMITS = [
  "Powers built into an asset itself are out of reach: a token the seller can upgrade, blacklist or claw back needs no signature from the wallet.",
  "Calls the contract can't classify, such as swaps and multicalls, make a satchel unprovable for every later owner. The report says so.",
  "secp256k1 only for now: EVM chains through sign_evm, anything else through sign_raw, which counts as opaque.",
  "Not audited. Two internal adversarial reviews; every fix is covered by the contract's tests.",
];

function Eyebrow({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return <p className={`text-sm font-medium tracking-wide ${dark ? "text-gold" : "text-leather"}`}>{children}</p>;
}

function H2({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <h2 className={`mt-3 max-w-3xl font-display text-4xl font-semibold tracking-tight sm:text-5xl ${className}`}>{children}</h2>;
}

function Code({ children }: { children: string }) {
  return <pre className="rounded-xl bg-ink p-4 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap text-paper-2">{children}</pre>;
}

export default function Home() {
  return (
    <ReportProvider>
      <div className="space-y-24 sm:space-y-32">
        <section className="pt-2 sm:pt-8">
          <p className="text-sm font-medium tracking-wide text-leather">NEAR Chain Signatures · NFT · live on testnet and mainnet</p>
          <h1 className="mt-4 font-display text-[3.2rem] leading-[0.98] font-semibold tracking-tight sm:text-7xl lg:text-[6.25rem]">
            Sell a wallet.
            <span className="block text-gold-deep">Prove nothing stayed behind.</span>
          </h1>
          <div className="mt-10 grid grid-cols-[minmax(0,1fr)] gap-12 lg:mt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start">
            <div className="lg:pt-4">
              <p className="max-w-xl text-lg leading-relaxed text-ink-2 sm:text-xl">
                A satchel is an NFT that controls one address on {CHAINS.length} EVM chains. Transfer the NFT and the wallet moves
                with it. The contract keeps a record of everything it ever signed, so a buyer can check what the seller could
                have kept back before paying.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="#examples" className="rounded-full bg-ink px-6 py-3 text-sm font-medium text-paper transition hover:bg-leather">
                  Try to cheat a buyer
                </Link>
                <Link href="/satchels" className="rounded-full border border-ink px-6 py-3 text-sm font-medium transition hover:bg-card">
                  Mint a satchel
                </Link>
              </div>
              <p className="mt-5 text-sm text-muted">
                These examples are on testnet; Satchel is also{" "}
                <a href="/mainnet" className="underline decoration-line underline-offset-2 hover:text-ink">
                  live on mainnet
                </a>
                , where{" "}
                <a href="/mainnet#showcase" className="underline decoration-line underline-offset-2 hover:text-ink">
                  two satchels have sent real ETH
                </a>
                . Not audited. Reading a report needs no wallet.
              </p>
            </div>
            <HeroCard />
          </div>
        </section>

        <LiveStats />

        <section className="reveal">
          <Eyebrow>The problem</Eyebrow>
          <H2>Selling a wallet is easy to fake.</H2>
          <p className="mt-4 max-w-2xl text-ink-2">
            The seller signs a withdrawal, sells the wallet, then broadcasts it. Or approves their own address to spend its
            tokens and pulls them after the sale. Satchel closes those holes with a record the buyer can check.
          </p>
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-line bg-card p-6 sm:p-8">
              <h3 className="font-display text-2xl font-semibold">A wallet sold the usual way</h3>
              <ul className="mt-5 space-y-3">
                {USUAL_WAY.map((line) => (
                  <li key={line} className="flex gap-3 text-ink-2">
                    <span className="font-semibold text-bad" aria-hidden="true">
                      ×
                    </span>
                    {line}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border-2 border-ink bg-card p-6 sm:p-8">
              <h3 className="font-display text-2xl font-semibold">A satchel</h3>
              <ul className="mt-5 space-y-3">
                {SATCHEL_WAY.map((line) => (
                  <li key={line} className="flex gap-3 text-ink-2">
                    <span className="font-semibold text-ok" aria-hidden="true">
                      ✓
                    </span>
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <TrickExplorer />

        <SaleFlow />

        <section className="reveal">
          <Eyebrow>Why not just…</Eyebrow>
          <H2>Ways to hand over a wallet.</H2>
          <div className="mt-10 overflow-hidden rounded-2xl border border-line bg-card">
            <div className="hidden grid-cols-[1.3fr_1fr_1fr_1.2fr] gap-4 border-b border-line px-6 py-4 text-sm text-muted md:grid">
              <span>A buyer asks</span>
              <span>Send the seed phrase</span>
              <span>Token-bound account (ERC-6551)</span>
              <span className="font-medium text-ink">Satchel</span>
            </div>
            {COMPARISON.map((row) => (
              <div key={row.question} className="grid gap-3 border-b border-line px-6 py-5 last:border-b-0 md:grid-cols-[1.3fr_1fr_1fr_1.2fr] md:gap-4">
                <p className="font-medium">{row.question}</p>
                {row.answers.map((answer, i) => (
                  <p key={answer + i} className={`text-sm ${TONE_TEXT[row.tones[i]]} ${i === 2 ? "font-medium" : ""}`}>
                    <span className="text-muted md:hidden">{["Seed phrase: ", "Token-bound account: ", "Satchel: "][i]}</span>
                    {answer}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </section>

        <section className="reveal rounded-[2rem] bg-ink px-5 py-12 text-paper sm:px-10 sm:py-16">
          <Eyebrow dark>Four checks before you buy</Eyebrow>
          <H2>Don't trust the seller. Or us.</H2>
          <p className="mt-4 max-w-2xl text-paper/70">
            The report runs in your browser, or in a terminal, against NEAR and each chain the record lists. A satchel is
            provably clean only when all four checks pass.
          </p>
          <div className="mt-10 grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <ol className="grid gap-6 sm:grid-cols-2">
              {CHECKS.map((c, i) => (
                <li key={c.title}>
                  <span className="font-display text-4xl text-gold">{i + 1}</span>
                  <p className="mt-2 font-medium">{c.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-paper/70">{c.body}</p>
                </li>
              ))}
            </ol>
            <div>
              <pre className="rounded-xl border border-paper/15 bg-black/40 p-5 font-mono text-xs leading-relaxed whitespace-pre-wrap text-paper-2">
                {VERIFY_OUTPUT.split("\n").map((line, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a fixed text whose lines can repeat
                  <span key={i} className={`block min-h-[1lh] ${line.startsWith("[FAIL]") || line === "NOT PROVABLE" ? "text-[#f0997b]" : ""}`}>
                    {line}
                  </span>
                ))}
              </pre>
              <p className="mt-3 text-xs text-paper/60">
                Satchel #5's report from the command line, trimmed to one line per check. Exit code 0 only when provably clean.
              </p>
              <Link href="/verify" className="mt-6 inline-block rounded-full bg-gold px-6 py-3 text-sm font-medium text-ink transition hover:bg-gold/80">
                Verify a satchel
              </Link>
            </div>
          </div>
        </section>

        <section className="reveal">
          <Eyebrow>Read it on chain</Eyebrow>
          <H2>Every claim here has a transaction.</H2>
          <ul className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2">
            {EVIDENCE.map((e) => (
              <li key={e.href} className="bg-card">
                <a href={e.href} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-4 px-5 py-4 transition hover:bg-paper-2">
                  <span className="text-sm">{e.what}</span>
                  <span className="shrink-0 font-mono text-xs text-leather">{e.label} ↗</span>
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-ink-2">
            The contract's code hash is the one{" "}
            <a href={TESTNET.build.ciRun} target="_blank" rel="noreferrer" className="underline decoration-line underline-offset-4 hover:decoration-ink">
              CI built reproducibly
            </a>{" "}
            from commit <code className="font-mono text-[0.9em]">{TESTNET.build.commit.slice(0, 7)}</code>; the report checks it every time.
          </p>
        </section>

        <section id="developers" className="reveal scroll-mt-24">
          <Eyebrow>For developers</Eyebrow>
          <H2>Check a satchel from anywhere.</H2>
          <div className="mt-10 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-3">
            <div className="rounded-2xl border border-line bg-card p-6">
              <h3 className="font-display text-xl font-semibold">From a terminal</h3>
              <p className="mt-2 text-sm text-ink-2">
                The same report as the browser, from npm with Node 22 or later, and your own nodes if you want them.
              </p>
              <div className="mt-4">
                <Code>{"npx satchel-nft@0.2.0 verify 6"}</Code>
              </div>
            </div>
            <div className="rounded-2xl border border-line bg-card p-6">
              <h3 className="font-display text-xl font-semibold">From the contract</h3>
              <p className="mt-2 text-sm text-ink-2">Every fact the report uses is a public view.</p>
              <div className="mt-4">
                <Code>{`near contract call-function as-read-only \\\n  ${TESTNET.contract} satchel \\\n  json-args '{"token_id":"6"}' \\\n  network-config testnet now`}</Code>
              </div>
            </div>
            <div className="rounded-2xl border border-line bg-card p-6">
              <h3 className="font-display text-xl font-semibold">The interface</h3>
              <p className="mt-2 text-sm text-ink-2">A NEP-171 NFT with these on top:</p>
              <ul className="mt-4 space-y-1.5 font-mono text-xs text-ink-2">
                <li>sign_evm · sign_raw</li>
                <li>list · delist · buy</li>
                <li>satchel · signing_record · listing · listings</li>
                <li>derivation_path · mpc_contract · evm_signing_hash</li>
              </ul>
              <Link href="/docs/developers" className="mt-4 inline-block text-sm font-medium text-leather hover:text-ink">
                Read the developer docs →
              </Link>
            </div>
          </div>
        </section>

        <section className="reveal grid gap-12 md:grid-cols-2">
          <div>
            <Eyebrow>Built on NEAR</Eyebrow>
            <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight">What it stands on</h2>
            <ul className="mt-5 space-y-4 text-ink-2">
              <li>
                <strong className="text-ink">Chain Signatures.</strong> Every key is derived and every signature made by the MPC
                network ({TESTNET.mpc}); the contract is the only account that can ask for a satchel's key.
              </li>
              <li>
                <strong className="text-ink">NEP-171, 177, 181 and 297.</strong> A standard NFT that wallets and marketplaces
                already understand, with events for every signature and sale.
              </li>
              <li>
                <strong className="text-ink">A locked, reproducible contract.</strong> Built in a pinned Docker image (NEP-330),
                deployed and initialized in one transaction, then every key deleted.
              </li>
            </ul>
          </div>
          <div>
            <Eyebrow>Honest limits</Eyebrow>
            <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight">What it can't cover</h2>
            <ul className="mt-5 space-y-4 text-ink-2">
              {LIMITS.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="reveal">
          <Eyebrow>Questions</Eyebrow>
          <H2>What buyers ask.</H2>
          <div className="mt-10 divide-y divide-line border-y border-line">
            {FAQ.map((item) => (
              <details key={item.q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display text-xl font-semibold [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <span className="text-2xl text-gold-deep transition group-open:rotate-45" aria-hidden="true">
                    +
                  </span>
                </summary>
                <p className="mt-3 max-w-3xl leading-relaxed text-ink-2">{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="reveal rounded-[2rem] bg-leather px-6 py-14 text-center text-paper sm:py-20">
          <h2 className="mx-auto max-w-3xl font-display text-4xl font-semibold tracking-tight sm:text-6xl">
            Check one yourself.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-paper/80">Pick any satchel and read its report. No wallet, no sign-in.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/verify" className="rounded-full bg-gold px-6 py-3 text-sm font-medium text-ink transition hover:bg-gold-soft">
              Verify a satchel
            </Link>
            <Link href="/market" className="rounded-full border border-paper/60 px-6 py-3 text-sm font-medium transition hover:bg-paper/10">
              See the market
            </Link>
          </div>
        </section>
      </div>
    </ReportProvider>
  );
}
