"use client";

import type { Report } from "satchel-nft";
import { verifyCommand } from "@/lib/showcase";
import { useNetwork } from "./network";
import { Badge, Button, Card, ErrorNote, ExternalLink, Placeholder, StatusIcon, VERDICT } from "./ui";

/** Four rows where the checks will be, about their height, so the card moves less when they arrive. */
function Reading() {
  return (
    <div className="mt-4">
      <p className="text-sm text-muted">Reading the record and every chain it lists…</p>
      <ol className="mt-4 space-y-4" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className="flex gap-3">
            <Placeholder className="mt-0.5 size-5 shrink-0 rounded-full!" />
            <div className="min-w-0 flex-1">
              <Placeholder className="h-5 w-3/5" />
              <Placeholder className="mt-1.5 h-4 w-2/5" />
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

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
  const net = useNetwork();
  const verdict = report ? VERDICT[report.verdict] : null;
  return (
    <Card className={report?.verdict === "clean" ? "border-ok/40" : report ? "border-warn/40" : ""}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-semibold">Clean transfer report</h2>
        <div className="flex items-center gap-2">
          {/* Always in the page, so a screen reader hears the verdict when it arrives. */}
          <span aria-live="polite">
            {verdict && (
              <Badge tone={verdict.tone}>
                <span className="sr-only">Verdict: </span>
                {verdict.label}
              </Badge>
            )}
          </span>
          <Button onClick={onRecheck} busy={loading}>
            Check again
          </Button>
        </div>
      </div>
      <p className="mt-1 text-sm text-muted">
        Checked in your browser against NEAR and each chain the record lists, at a finalized block. Nothing here comes
        from a server of ours; it trusts the public RPCs named below.
      </p>
      <ErrorNote error={error} />
      {!report && loading && <Reading />}
      {report && (
        <ol className="mt-4 space-y-4">
          {report.checks.map((check) => (
            <li key={check.id} className="flex gap-3">
              <StatusIcon status={check.status} />
              <div className="min-w-0">
                <p className="font-medium">{check.title}</p>
                <ul className="mt-0.5 space-y-0.5 text-sm text-ink-2">
                  {check.lines.map((line, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: two approval rows can read the same
                    <li key={i} className="break-words">
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
          no wallet needed: <code className="font-mono">{verifyCommand(net, report.tokenId)}</code>, with Node 22 or later (
          <ExternalLink href="https://www.npmjs.com/package/satchel-nft">satchel-nft on npm</ExternalLink>). The code hash
          it expects comes from the <ExternalLink href={net.build.ciRun}>reproducible CI build</ExternalLink>.
          {report.sources && (
            <>
              {" "}
              Read from {report.sources.map((s) => new URL(s).host).join(", ")}. An RPC that lies could fool this page, so
              for a large purchase run the command against nodes you trust.
            </>
          )}
        </p>
      )}
    </Card>
  );
}
