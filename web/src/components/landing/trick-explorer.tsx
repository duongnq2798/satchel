"use client";

import Link from "next/link";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { type Report, client, formatBalance, formatNear } from "satchel-nft";
import { FOR_SALE, type RefusedTrick, type ReportTrick, TRICKS, type Trick, type TxLink } from "@/lib/copy";
import { ReportBadge, useReport } from "../report-checker";
import { Badge, StatusIcon, VERDICT } from "../ui";
import { useAsync } from "../use-async";

const SEPOLIA = 11155111;

function Links({ txs }: { txs: readonly TxLink[] }) {
  return (
    <ul className="mt-5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {txs.map((tx) => (
        <li key={tx.href}>
          <a href={tx.href} target="_blank" rel="noreferrer" className="text-gold-soft underline decoration-gold/50 underline-offset-2 hover:text-paper">
            {tx.label} ↗
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Four placeholder lines while the report runs, so the panel keeps its height. */
function Running() {
  return (
    <div className="mt-5 space-y-2.5">
      <p className="text-xs text-paper/60">Running the report in your browser, against NEAR and Sepolia…</p>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-5 rounded bg-paper/10 motion-safe:animate-pulse" style={{ animationDelay: `${i * 120}ms` }} />
      ))}
    </div>
  );
}

function ReportLines({ report, focus }: { report: Report; focus: ReportTrick["check"] }) {
  return (
    <ul className="mt-5 space-y-2">
      {report.checks.map((check) => (
        <li
          key={check.id}
          className={`flex gap-2.5 rounded-lg px-2 py-1.5 text-sm ${check.id === focus ? "bg-paper/10 text-paper" : "text-paper/75"}`}
        >
          <StatusIcon status={check.status} />
          <span>
            {check.title}
            {check.id === focus && check.status !== "pass" && <span className="mt-0.5 block text-xs text-paper/60">{check.lines[0]}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ReportPanel({ trick }: { trick: ReportTrick }) {
  const report = useReport(trick.tokenId);
  const failed = Boolean(report.error) || report.data === null;
  return (
    <>
      <p role="status" className="sr-only">
        {report.data ? `Report finished: ${VERDICT[report.data.verdict].label}` : failed ? "Couldn't read the report" : "Running the report"}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-paper/70">Satchel #{trick.tokenId}, its clean transfer report</p>
        <ReportBadge report={report} />
      </div>
      <h3 className="mt-4 font-display text-2xl font-semibold sm:text-3xl">{trick.title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-paper/80">{trick.body}</p>
      {report.data ? (
        <ReportLines report={report.data} focus={trick.check} />
      ) : failed ? (
        <p className="mt-5 text-sm text-paper/70">Couldn't read the report just now. Open the satchel's page to try again.</p>
      ) : (
        <Running />
      )}
      <Links txs={trick.txs} />
      <Link href={`/satchel/${trick.tokenId}`} className="mt-5 inline-block text-sm font-medium text-gold hover:text-gold-soft">
        Open its full report →
      </Link>
    </>
  );
}

function RefusedPanel({ trick }: { trick: RefusedTrick }) {
  const report = useReport(trick.tokenId);
  const now = report.data;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-paper/70">The contract, on satchel #{trick.tokenId}</p>
        <Badge tone="bad">Refused on chain</Badge>
      </div>
      <h3 className="mt-4 font-display text-2xl font-semibold sm:text-3xl">{trick.title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-paper/80">{trick.body}</p>
      <div className="mt-5 overflow-hidden rounded-xl border border-paper/15 font-mono text-xs">
        <p className="bg-paper/5 px-3 py-2 break-all text-paper/80">
          <span className="text-paper/50">{trick.caller} → </span>
          {trick.call}
        </p>
        <p className="px-3 py-2 break-all text-[#f0997b]">
          <span className="text-paper/50">contract → </span>
          {trick.reason}
        </p>
      </div>
      <p className="mt-4 flex flex-wrap items-center gap-2 text-sm text-paper/75">
        Satchel #{trick.tokenId} now:
        <ReportBadge report={report} />
        {now?.listing && <span>listed at record version {now.listing.record_version}</span>}
      </p>
      <Links txs={trick.txs} />
    </>
  );
}

function Panel({ trick }: { trick: Trick }) {
  return trick.kind === "report" ? <ReportPanel trick={trick} /> : <RefusedPanel trick={trick} />;
}

/** Reads every trick's satchel as soon as the page loads, so switching tabs is instant. */
function Prefetch() {
  for (const id of new Set(TRICKS.map((t) => t.tokenId))) useReport(id);
  return null;
}

/** The listed example: what it costs and holds, or where to go once it is off the market. */
function ForSale() {
  const report = useReport(FOR_SALE);
  const address = report.data?.address;
  const balance = useAsync(async () => (address ? client(SEPOLIA).getBalance({ address }) : null), address ?? "");
  const listing = report.data?.listing;

  let title = `Checking satchel #${FOR_SALE}…`;
  let body = "";
  if (report.data && listing) {
    title = `Satchel #${FOR_SALE} is for sale for ${formatNear(listing.price)} NEAR`;
    const holds = typeof balance.data === "bigint" ? `It holds ${formatBalance(balance.data)} Sepolia ETH. ` : "";
    body = `${holds}Buy it with any testnet NEAR wallet: its address on every chain moves to you in one transaction, for the record version you checked.`;
  } else if (report.data) {
    title = `Satchel #${FOR_SALE} is no longer for sale`;
    body = "Mint your own and list it from its page; it shows up on the market with its report.";
  } else if (report.error || report.data === null) {
    title = `Couldn't read satchel #${FOR_SALE}`;
  }

  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-card p-5">
      <div className="min-w-0 flex-[1_1_18rem]">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-display text-xl font-semibold">{title}</h3>
          {report.data && <ReportBadge report={report} />}
        </div>
        {body && <p className="mt-1 text-sm text-ink-2">{body}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href={`/satchel/${FOR_SALE}`} className="rounded-full border border-ink px-4 py-2 text-sm font-medium transition hover:bg-paper-2">
          Read its report
        </Link>
        <Link
          href={listing || !report.data ? "/market" : "/satchels"}
          className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper transition hover:bg-leather"
        >
          {listing || !report.data ? "See the market" : "Mint a satchel"}
        </Link>
      </div>
    </div>
  );
}

/** Pick what a seller does; see what the report or the contract does about it, live. */
export function TrickExplorer() {
  const [active, setActive] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const focusTab = useRef(false);
  useEffect(() => {
    if (focusTab.current) tabs.current[active]?.focus();
  }, [active]);

  const onKey = (e: KeyboardEvent) => {
    const n = TRICKS.length;
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    const next = e.key === "Home" ? 0 : e.key === "End" ? n - 1 : step === undefined ? null : (active + step + n) % n;
    if (next === null) return;
    e.preventDefault();
    focusTab.current = true;
    setActive(next);
  };

  const trick = TRICKS[active];
  return (
    <section id="examples" className="scroll-mt-24 rounded-[2rem] bg-paper-2 px-5 py-12 sm:px-10 sm:py-16">
      <p className="text-sm font-medium tracking-wide text-leather">Try it, live on NEAR testnet</p>
      <h2 className="mt-3 max-w-3xl font-display text-4xl font-semibold tracking-tight sm:text-5xl">Try to cheat the buyer.</h2>
      <p className="mt-4 max-w-2xl text-ink-2">
        Pick what the seller does. Each move below was made for real on testnet: a satchel left that way, or a call the
        contract refused. The reports run in your browser now, against NEAR and Sepolia.
      </p>
      <Prefetch />
      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.4fr)]">
        <div role="tablist" aria-label="What the seller does" aria-orientation="vertical" className="grid grid-cols-2 gap-2 self-start lg:grid-cols-1" onKeyDown={onKey}>
          {TRICKS.map((t, i) => (
            <button
              key={t.id}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`trick-${t.id}`}
              aria-selected={i === active}
              aria-controls="trick-panel"
              tabIndex={i === active ? 0 : -1}
              onClick={() => {
                focusTab.current = false;
                setActive(i);
              }}
              className={`flex items-center gap-3 rounded-xl border px-3 py-3 text-left text-sm font-medium transition sm:px-4 ${
                i === active ? "border-ink bg-ink text-paper" : "border-line bg-card text-ink hover:border-ink"
              }`}
            >
              <span className={`font-display text-lg ${i === active ? "text-gold" : "text-muted"}`}>{i + 1}</span>
              {t.label}
            </button>
          ))}
        </div>
        <div
          id="trick-panel"
          role="tabpanel"
          aria-labelledby={`trick-${trick.id}`}
          className="min-h-[26rem] rounded-2xl bg-ink p-6 text-paper sm:p-8"
        >
          <Panel key={trick.id} trick={trick} />
        </div>
      </div>
      <ForSale />
    </section>
  );
}
