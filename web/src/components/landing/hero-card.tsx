"use client";

import { useEffect, useState } from "react";
import { CHAINS, type Report, TESTNET } from "satchel-nft";
import { HANDOVER } from "@/lib/copy";
import { useReport } from "../report-checker";
import { VERDICT } from "../ui";

const MAINNETS = CHAINS.filter((c) => !c.testnet);

/** Seconds since `iso`, ticking, so the stamp says how fresh the check is. */
function useAge(iso: string | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!iso) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [iso]);
  return iso ? Math.max(0, Math.round((now - Date.parse(iso)) / 1000)) : null;
}

function Stamp({ report, error }: { report: Report | null | undefined; error: unknown }) {
  const age = useAge(report?.checkedAt);
  if (report) {
    const tone = report.verdict === "clean" ? "border-ok bg-ok-soft text-ok" : "border-warn bg-warn-soft text-warn";
    return (
      <div className={`stamp rounded-lg border-2 px-3 py-1.5 text-center shadow-sm ${tone}`}>
        <p className="text-xs font-semibold tracking-[0.14em] uppercase">{VERDICT[report.verdict].label}</p>
        <p className="text-[0.65rem] opacity-80">checked {age === null || age < 2 ? "just now" : `${age}s ago`}, in your browser</p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border-2 border-paper/30 px-3 py-1.5 text-center text-paper/80">
      <p className="text-xs font-semibold tracking-[0.14em] uppercase">{error || report === null ? "Couldn't check" : "Checking…"}</p>
      <p className="text-[0.65rem] opacity-80">the report runs in your browser</p>
    </div>
  );
}

/** Satchel #1 as a leather tag: its one address, the chains it works on, and its hand-over. */
export function HeroCard() {
  const report = useReport(HANDOVER.tokenId);
  const owner = report.data?.owner ?? "buyer.satchel-nft.testnet";
  const address = report.data?.address ?? HANDOVER.address;

  return (
    <div className="rounded-[2rem] bg-leather p-2 shadow-[0_40px_80px_-40px_rgb(23_20_15/0.7)]">
      <div className="rounded-[1.6rem] border-2 border-dashed border-gold/60 p-5 text-paper sm:p-7">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-display text-2xl font-semibold">Satchel #{HANDOVER.tokenId}</p>
            <p className="mt-0.5 text-xs text-paper/70">NEP-171 NFT on {TESTNET.contract}</p>
          </div>
          <Stamp report={report.data} error={report.error} />
        </div>

        <p className="mt-6 text-xs text-paper/70">Its address on every chain below</p>
        <p className="mt-1 font-mono text-sm break-all text-gold-soft sm:text-base">{address}</p>

        <ul className="mt-4 grid grid-cols-2 gap-1.5 text-xs sm:grid-cols-4">
          {MAINNETS.map((chain, i) => (
            <li key={chain.id} className="chain-chip rounded-lg px-2.5 py-1.5" style={{ animationDelay: `${i}s` }}>
              {chain.name}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-paper/70">and each one's testnet: {CHAINS.length} chains, one key, signed by NEAR's MPC network</p>

        <div className="mt-6 border-t border-dashed border-gold/40 pt-5">
          <div className="flex items-center justify-between gap-2 font-mono text-[0.7rem] sm:text-xs">
            <span className="truncate text-paper/70">{HANDOVER.from}</span>
            <span className="truncate text-gold-soft">{owner}</span>
          </div>
          <div className="relative mt-2 h-3" aria-hidden="true">
            <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-paper/30" />
            <span className="travel-dot absolute top-0 size-3 rounded-full bg-gold" />
          </div>
          <p className="mt-3 text-xs leading-relaxed text-paper/80">
            One{" "}
            <a href={HANDOVER.transferTx} target="_blank" rel="noreferrer" className="underline decoration-gold/60 underline-offset-2 hover:text-paper">
              NEAR transaction
            </a>{" "}
            moved the NFT, and with it this address on every chain. The previous owner's next signature request{" "}
            <a href={HANDOVER.refusedTx} target="_blank" rel="noreferrer" className="underline decoration-gold/60 underline-offset-2 hover:text-paper">
              was refused
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
