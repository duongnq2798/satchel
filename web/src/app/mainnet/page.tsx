import type { Metadata } from "next";
import Link from "next/link";
import { LiveStats } from "@/components/live-stats";
import { NetLink } from "@/components/site-header";
import { CHAINS, MAINNET } from "satchel-nft";
import { appPath } from "@/lib/routes";

export const metadata: Metadata = { title: "Satchel on NEAR mainnet" };

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
            <Code>{"npx satchel-nft verify --network mainnet 1"}</Code>
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
