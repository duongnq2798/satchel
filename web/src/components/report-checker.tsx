"use client";

import { type ReactNode, createContext, useContext, useMemo, useRef } from "react";
import { type ContractFacts, type Report, buildReport, contractFacts, limiter } from "satchel-nft";
import { useNetwork } from "./network";
import { Badge, VERDICT, errorMessage } from "./ui";
import { useAsync } from "./use-async";

type Checker = (tokenId: string) => Promise<Report | null>;

/**
 * Checks many satchels on one page: one read of the contract's own facts shared by every report,
 * and a few reports at a time so the public RPCs don't throttle the page.
 */
export function useReportChecker(): Checker {
  const net = useNetwork();
  return useMemo(() => {
    let facts: Promise<ContractFacts> | null = null;
    const limit = limiter(3);
    return (tokenId: string) => {
      if (facts === null) {
        const read = contractFacts(net);
        read.catch(() => {
          facts = null;
        });
        facts = read;
      }
      const shared = facts;
      return limit(() => buildReport(net, tokenId, shared));
    };
  }, [net]);
}

interface Reports {
  check: Checker;
  /** The report for `tokenId` if one has already arrived. */
  peek: (tokenId: string) => Report | null | undefined;
}

const ReportContext = createContext<Reports | null>(null);

/**
 * One report per satchel for everything inside it. A read that fails or comes back unknown (an RPC
 * down, a block not final yet) is dropped, so the next reader reads again.
 */
export function ReportProvider({ children }: { children: ReactNode }) {
  const net = useNetwork();
  const check = useReportChecker();
  const pending = useRef(new Map<string, Promise<Report | null>>());
  const settled = useRef(new Map<string, Report | null>());
  const reports = useMemo<Reports>(() => {
    // Keyed by network too, so a report read on one side is never served on the other.
    const key = (tokenId: string) => `${net.id}:${tokenId}`;
    const drop = (k: string, read: Promise<Report | null>) => {
      if (pending.current.get(k) === read) pending.current.delete(k);
      settled.current.delete(k);
    };
    return {
      check: (tokenId) => {
        const k = key(tokenId);
        const cached = pending.current.get(k);
        if (cached) return cached;
        const read = check(tokenId);
        read.then(
          (report) => {
            if (report?.verdict === "unknown") drop(k, read);
            else settled.current.set(k, report);
          },
          () => drop(k, read),
        );
        pending.current.set(k, read);
        return read;
      },
      peek: (tokenId) => settled.current.get(key(tokenId)),
    };
  }, [check, net]);
  return <ReportContext.Provider value={reports}>{children}</ReportContext.Provider>;
}

/** The report for `tokenId`, shared with every other reader under the same `ReportProvider`. */
export function useReport(tokenId: string) {
  const reports = useContext(ReportContext);
  const net = useNetwork();
  if (!reports) throw new Error("useReport needs a ReportProvider");
  return useAsync(() => reports.check(tokenId), `${net.id}:${tokenId}`, { initial: reports.peek(tokenId) });
}

/** A report's verdict as a badge, with the reason on hover when it couldn't be read. */
export function ReportBadge({ report }: { report: { data: Report | null | undefined; error: unknown } }) {
  if (report.data) {
    const verdict = VERDICT[report.data.verdict];
    return <Badge tone={verdict.tone}>{verdict.label}</Badge>;
  }
  if (report.error || report.data === null) {
    return (
      <span title={report.error ? errorMessage(report.error) : "No such satchel"}>
        <Badge tone="bad">Couldn't check</Badge>
      </span>
    );
  }
  return <Badge>Checking…</Badge>;
}
