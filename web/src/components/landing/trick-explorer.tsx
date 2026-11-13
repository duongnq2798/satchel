"use client";

import Link from "next/link";
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { type Report, TESTNET, client, formatBalance, formatNear } from "satchel-nft";
import { FOR_SALE, type RefusedTrick, type ReportTrick, TRICKS, type Trick, type TxLink } from "@/lib/copy";
import { FROZEN_NOTE, isFrozen } from "@/lib/frozen";
import { ReportBadge, useReport } from "../report-checker";
import { StatusIcon, VERDICT } from "../ui";
import { useAsync } from "../use-async";
import { PressIn } from "./deed/press";
import { Stamp } from "./deed/stamp";

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
      <p className="text-xs text-paper/75">Running the report in your browser, against NEAR and Sepolia…</p>
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
          <span className="min-w-0">
            {check.title}
            {check.id === focus && check.status !== "pass" && (
              <span className="mt-0.5 block text-xs text-paper/75 [overflow-wrap:anywhere]">{check.lines[0]}</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The panel's head: what it shows, its title under that, and the verdict beside both, as a stamp
 * like the deed's. On a phone the stamp sits beside the first line and the title takes the width.
 */
function PanelHead({ about, title, verdict }: { about: string; title: string; verdict: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 [grid-template-areas:'about_verdict'_'title_title'] sm:[grid-template-areas:'about_verdict'_'title_verdict']">
      <p className="self-start text-sm text-paper/75 [grid-area:about]">{about}</p>
      <div className="deed-verdict [grid-area:verdict]">{verdict}</div>
      <h3 className="mt-4 font-display text-2xl font-semibold [grid-area:title] sm:text-3xl">{title}</h3>
    </div>
  );
}

/**
 * The report's verdict, pressed in as a stamp when it arrives: Provably clean or Not provable, with
 * the record version it read. Until then, or when the report couldn't settle, the usual badge.
 */
function VerdictStamp({ report }: { report: ReturnType<typeof useReport> }) {
  const data = report.data;
  if (!data || data.verdict === "unknown") return <ReportBadge report={report} />;
  const clean = data.verdict === "clean";
  return (
    <PressIn key={data.verdict}>
      <Stamp
        press="mount"
        small
        tone={clean ? "ok" : "warn"}
        big={
          clean ? (
            <>
              Provably
              <br />
              clean
            </>
          ) : (
            <>
              Not
              <br />
              provable
            </>
          )
        }
        sub={`record v${data.recordVersion}`}
        rot={clean ? "-6deg" : "-4deg"}
      />
    </PressIn>
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
      <PanelHead about={`Satchel #${trick.tokenId}, its clean transfer report`} title={trick.title} verdict={<VerdictStamp report={report} />} />
      <p className="mt-2 text-sm leading-relaxed text-paper/80">{trick.body}</p>
      {report.data ? (
        <ReportLines report={report.data} focus={trick.check} />
      ) : failed ? (
        <p className="mt-5 text-sm text-paper/75">Couldn't read the report just now. Open the satchel's page to try again.</p>
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
      <PanelHead
        about={`The contract, on satchel #${trick.tokenId}`}
        title={trick.title}
        verdict={
          <>
            <span className="sr-only">Refused on chain</span>
            <PressIn>
              <Stamp press="mount" small tone="bad" top="On chain" big="Refused" rot="5deg" />
            </PressIn>
          </>
        }
      />
      <p className="mt-2 text-sm leading-relaxed text-paper/80">{trick.body}</p>
      <div className="mt-5 overflow-hidden rounded-xl border border-paper/15 font-mono text-xs">
        <p className="max-w-none bg-paper/5 px-3 py-2 break-all text-paper/80">
          <span className="text-paper/75">{trick.caller} → </span>
          {trick.call}
        </p>
        <p className="max-w-none px-3 py-2 break-all text-[#f0997b]">
          <span className="text-paper/75">contract → </span>
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

/**
 * The listed example: what it costs and holds, or where to go once it is off the market. While it
 * is a demo satchel the app won't buy, it says so and points to minting one to sell.
 */
function ForSale() {
  const report = useReport(FOR_SALE);
  const address = report.data?.address;
  const balance = useAsync(async () => (address ? client(SEPOLIA).getBalance({ address }) : null), address ?? "");
  const listing = report.data?.listing;
  const frozen = isFrozen(TESTNET, FOR_SALE);

  let title = `Checking satchel #${FOR_SALE}…`;
  let body = "";
  if (report.data && listing) {
    const holds = typeof balance.data === "bigint" ? `It holds ${formatBalance(balance.data)} Sepolia ETH. ` : "";
    if (frozen) {
      title = `Satchel #${FOR_SALE} is listed for ${formatNear(listing.price)} NEAR`;
      body = `${holds}${FROZEN_NOTE} To see a sale through, mint a satchel, list it from its page and buy it from a second testnet wallet.`;
    } else {
      title = `Satchel #${FOR_SALE} is for sale for ${formatNear(listing.price)} NEAR`;
      body = `${holds}Buy it with any testnet NEAR wallet: its address on every chain moves to you in one transaction, for the record version you checked.`;
    }
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
          href={(listing && !frozen) || !report.data ? "/market" : "/satchels"}
          className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper transition hover:bg-leather"
        >
          {(listing && !frozen) || !report.data ? "See the market" : "Mint a satchel"}
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
      <p className="mt-4 text-ink-2">
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
