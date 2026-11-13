import type { Metadata } from "next";
import Link from "next/link";
import { DeedDefs } from "@/components/landing/deed/defs";
import { SaleCard } from "@/components/landing/deed/sale-card";
import { LiveStats } from "@/components/live-stats";
import { NetLink } from "@/components/site-header";
import { CHAINS, MAINNET } from "satchel-nft";
import { appPath } from "@/lib/routes";
import { MAINNET_SALE, SHOWCASE, verifyCommand } from "@/lib/showcase";

export const metadata: Metadata = {
  title: "Satchel on NEAR mainnet",
  description: `Satchel on NEAR mainnet: ${MAINNET.contract}, the same locked, reproducible contract as on testnet, signing through ${MAINNET.mpc}. Satchel #1 sent ETH on Base from this app, satchel #2 swapped ETH on Base for USDC on Arbitrum One through NEAR Intents' 1Click, and satchel #3 was sold for ${MAINNET_SALE.price} NEAR between two of the builder's accounts, after which its old owner's sign_evm was refused.`,
};

const MAINNET_CHAINS = CHAINS.filter((c) => !c.testnet).map((c) => c.name);

function Code({ children }: { children: string }) {
  return <pre className="rounded-xl bg-ink p-4 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap text-paper-2">{children}</pre>;
}

export default function MainnetHome() {
  return (
    <div className="space-y-12">
      <section className="max-w-3xl">
        <p className="text-sm font-medium tracking-wide text-leather">NEAR mainnet</p>
        <h1 className="mt-3 font-display text-5xl leading-tight font-semibold tracking-tight">Satchels that hold real funds</h1>
        <p className="mt-4 text-lg text-ink-2">
          The same contract as on testnet, from the same reproducible build, at{" "}
          <code className="font-mono text-[0.9em]">{MAINNET.contract}</code>, signing through NEAR&apos;s mainnet MPC network
          (<code className="font-mono text-[0.9em]">{MAINNET.mpc}</code>). Each satchel is one address on{" "}
          {MAINNET_CHAINS.slice(0, -1).join(", ")} and {MAINNET_CHAINS.at(-1)}. Before it signs anything or shows an
          address, the app checks that the account runs that build, has no keys and signs only through {MAINNET.mpc}; the
          numbers below are read live.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href={appPath(MAINNET, "/satchels")} className="rounded-full bg-ink px-6 py-3 text-sm font-medium text-paper transition hover:bg-leather">
            Mint a satchel
          </Link>
          <Link href={appPath(MAINNET, "/market")} className="rounded-full border border-ink px-6 py-3 text-sm font-medium transition hover:bg-card">
            Market
          </Link>
          <Link href={appPath(MAINNET, "/verify")} className="rounded-full border border-ink px-6 py-3 text-sm font-medium transition hover:bg-card">
            Verify a satchel
          </Link>
        </div>
      </section>

      <LiveStats />

      <section id="showcase" className="scroll-mt-24">
        <DeedDefs />
        <h2 className="font-display text-3xl font-semibold tracking-tight">Three satchels on mainnet</h2>
        <p className="mt-2 text-ink-2">
          All three were minted by satchel-nft.near. Satchels #1 and #2 sent real ETH, each send signed in a NEAR wallet on this
          site. Satchel #{MAINNET_SALE.tokenId} was sold between two of the builder&apos;s accounts, and its old owner&apos;s next sign_evm was
          refused. Each card says what happened; the satchel&apos;s page reads its report live, against NEAR and every chain
          its record lists.
        </p>
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          {SHOWCASE.map((s) => (
            <article key={s.tokenId} className="flex flex-col rounded-2xl border border-line bg-card p-6">
              <p className="text-sm font-medium text-leather">Satchel #{s.tokenId}</p>
              <h3 className="mt-2 font-display text-2xl leading-snug font-semibold">{s.title}</h3>
              <p className="text-sm text-muted">{s.subtitle}</p>
              <p className="mt-3 font-mono text-xs break-all text-ink-2">{s.address}</p>
              <p className="mt-3 text-sm leading-relaxed text-ink-2">{s.story}</p>
              <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {s.txs.map((tx) => (
                  <li key={tx.href}>
                    <a href={tx.href} target="_blank" rel="noreferrer" className="underline decoration-line underline-offset-4 hover:decoration-ink">
                      {tx.label}
                      <span aria-hidden="true"> ↗</span>
                    </a>
                  </li>
                ))}
              </ul>
              <div className="mt-auto pt-6">
                <Link
                  href={appPath(MAINNET, `/satchel/${s.tokenId}`)}
                  className="inline-block rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-paper transition hover:bg-leather"
                >
                  Read satchel #{s.tokenId}&apos;s report, live
                </Link>
                <p className="mt-3 font-mono text-xs break-all text-muted">{verifyCommand(MAINNET, s.tokenId)}</p>
              </div>
            </article>
          ))}
          <SaleCard />
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-bad/40 bg-card p-6">
          <h2 className="font-display text-2xl font-semibold">Before you fund one</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-ink-2">
            <li>Satchel has not been audited. Keep in a satchel only what you can afford to lose.</li>
            <li>
              The contract has no admin, and once its keys are deleted no one can pause it, upgrade it or return funds sent
              by mistake. The numbers above say whether they are.
            </li>
            <li>Before you buy one, read its report: the buy names the record version that report checked.</li>
          </ul>
        </div>
        <div className="rounded-2xl border border-line bg-card p-6">
          <h2 className="font-display text-2xl font-semibold">Check it from a terminal</h2>
          <p className="mt-2 text-sm text-ink-2">The same report, read from mainnet RPCs you can replace with your own.</p>
          <div className="mt-4">
            <Code>{verifyCommand(MAINNET, "1")}</Code>
          </div>
        </div>
      </section>

      <p className="text-sm text-ink-2">
        New to satchels?{" "}
        <NetLink href="/#how" className="font-medium text-leather hover:text-ink">
          See how they work, with testnet examples you can try
        </NetLink>
        .
      </p>
    </div>
  );
}
