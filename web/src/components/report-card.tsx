"use client";

import { NETWORK, REPO_URL } from "@/lib/config";
import type { Report } from "@/lib/report";
import { Badge, Button, Card, ErrorNote, ExternalLink, StatusIcon, VERDICT } from "./ui";

export function ReportCard({
  report,
  loading,
  error,
  onRecheck,
}: {
  report: Report | null | undefined;
  loading: boolean;
  error: unknown;
  onRecheck: () => void;
}) {
  const verdict = report ? VERDICT[report.verdict] : null;
  return (
    <Card className={report?.verdict === "clean" ? "border-ok/40" : report ? "border-warn/40" : ""}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-semibold">Clean transfer report</h2>
        <div className="flex items-center gap-2">
          {verdict && <Badge tone={verdict.tone}>{verdict.label}</Badge>}
          <Button onClick={onRecheck} busy={loading}>
            Check again
          </Button>
        </div>
      </div>
      <p className="mt-1 text-sm text-muted">
        Checked in your browser against NEAR and each chain the record lists, at a finalized block. Nothing here
        comes from a server of ours.
      </p>
      <ErrorNote error={error} />
      {!report && loading && <p className="mt-4 text-sm text-muted">Reading the record and every chain it lists…</p>}
      {report && (
        <ol className="mt-4 space-y-4">
          {report.checks.map((check) => (
            <li key={check.id} className="flex gap-3">
              <StatusIcon status={check.status} />
              <div className="min-w-0">
                <p className="font-medium">{check.title}</p>
                <ul className="mt-0.5 space-y-0.5 text-sm text-ink-2">
                  {check.lines.map((line) => (
                    <li key={line} className="break-words">
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ol>
      )}
      {report && (
        <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
          Record version {report.recordVersion}, checked {new Date(report.checkedAt).toLocaleString()}. Run it yourself,
          no wallet needed: <code className="font-mono">npm run verify -- {report.tokenId}</code> in{" "}
          <ExternalLink href={`${REPO_URL}/tree/main/web`}>web/</ExternalLink>. The code hash
          it expects comes from the <ExternalLink href={NETWORK.build.ciRun}>reproducible CI build</ExternalLink>.
        </p>
      )}
    </Card>
  );
}
