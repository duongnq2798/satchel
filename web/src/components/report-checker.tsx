"use client";

import { type ReactNode, createContext, useCallback, useContext, useMemo, useRef } from "react";
import { limiter } from "@/lib/limit";
import { type ContractFacts, type Report, buildReport, contractFacts } from "@/lib/report";
import { Badge, VERDICT, errorMessage } from "./ui";
import { useAsync } from "./use-async";

type Checker = (tokenId: string) => Promise<Report | null>;

/**
 * Checks many satchels on one page: one read of the contract's own facts shared by every report,
 * and a few reports at a time so the public RPCs don't throttle the page.
 */
export function useReportChecker(): Checker {
  const facts = useRef<Promise<ContractFacts> | null>(null);
  const limit = useRef(limiter(3));
  return useCallback((tokenId: string) => {
    if (facts.current === null) {
      const read = contractFacts();
      read.catch(() => {
        facts.current = null;
      });
      facts.current = read;
    }
    const shared = facts.current;
    return limit.current(() => buildReport(tokenId, shared));
  }, []);
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
  const check = useReportChecker();
  const pending = useRef(new Map<string, Promise<Report | null>>());
  const settled = useRef(new Map<string, Report | null>());
  const reports = useMemo<Reports>(() => {
    const drop = (tokenId: string, read: Promise<Report | null>) => {
      if (pending.current.get(tokenId) === read) pending.current.delete(tokenId);
      settled.current.delete(tokenId);
    };
    return {
      check: (tokenId) => {
        const cached = pending.current.get(tokenId);
        if (cached) return cached;
        const read = check(tokenId);
        read.then(
          (report) => {
            if (report?.verdict === "unknown") drop(tokenId, read);
            else settled.current.set(tokenId, report);
          },
          () => drop(tokenId, read),
        );
        pending.current.set(tokenId, read);
        return read;
      },
      peek: (tokenId) => settled.current.get(tokenId),
    };
  }, [check]);
  return <ReportContext.Provider value={reports}>{children}</ReportContext.Provider>;
}

/** The report for `tokenId`, shared with every other reader under the same `ReportProvider`. */
export function useReport(tokenId: string) {
  const reports = useContext(ReportContext);
  if (!reports) throw new Error("useReport needs a ReportProvider");
  return useAsync(() => reports.check(tokenId), tokenId, reports.peek(tokenId));
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
