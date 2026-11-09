"use client";

import { useRef } from "react";
import { limiter } from "@/lib/limit";
import { type ContractFacts, type Report, buildReport, contractFacts } from "@/lib/report";
import { Badge, VERDICT, errorMessage } from "./ui";

/**
 * Checks many satchels on one page: one read of the contract's own facts shared by every report,
 * and a few reports at a time so the public RPCs don't throttle the page.
 */
export function useReportChecker(): (tokenId: string) => Promise<Report | null> {
  const facts = useRef<Promise<ContractFacts> | null>(null);
  const limit = useRef(limiter(3));
  return (tokenId: string) => {
    if (facts.current === null) {
      const read = contractFacts();
      read.catch(() => {
        facts.current = null;
      });
      facts.current = read;
    }
    const shared = facts.current;
    return limit.current(() => buildReport(tokenId, shared));
  };
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
