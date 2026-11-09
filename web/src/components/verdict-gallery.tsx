"use client";

import Link from "next/link";
import { GALLERY } from "@/lib/copy";
import { client } from "@/lib/evm";
import type { Report, Status } from "@/lib/report";
import { formatNear } from "@/lib/satchel";
import { formatBalance } from "./balances";
import { ReportBadge, useReportChecker } from "./report-checker";
import { Card, StatusIcon } from "./ui";
import { useAsync } from "./use-async";

const SEPOLIA = 11155111;

type Example = (typeof GALLERY.examples)[number];

const BORDER = { clean: "border-ok/40", "not-provable": "border-warn/40", unknown: "" } as const;

/** The report line the story is about, or a count of passing checks when it names none. */
function CheckLine({ report, check }: { report: Report; check: Example["check"] }) {
  const line = check ? report.checks.find((c) => c.id === check) : null;
  const passed = report.checks.filter((c) => c.status === "pass").length;
  const worst: Status = report.checks.some((c) => c.status === "fail") ? "fail" : passed === report.checks.length ? "pass" : "unknown";
  const status = line ? line.status : worst;
  const text = line ? line.title : `${passed} of ${report.checks.length} checks pass`;
  return (
    <p className="mt-4 flex gap-2 text-sm font-medium">
      <StatusIcon status={status} />
      {text}
    </p>
  );
}

function ExampleCard({ example, check }: { example: Example; check: (tokenId: string) => Promise<Report | null> }) {
  const report = useAsync(() => check(example.tokenId), example.tokenId);
  const border = report.data ? BORDER[report.data.verdict] : "";
  return (
    <Link href={`/satchel/${example.tokenId}`}>
      <Card className={`flex h-full flex-col transition hover:border-ink ${border}`}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-muted">Satchel #{example.tokenId}</p>
          <ReportBadge report={report} />
        </div>
        <h3 className="mt-3 font-display text-xl font-semibold">{example.title}</h3>
        <p className="mt-2 text-sm text-ink-2">{example.body}</p>
        <div className="mt-auto">
          {report.data && <CheckLine report={report.data} check={example.check} />}
          <p className="mt-4 text-sm font-medium text-leather">Open its report →</p>
        </div>
      </Card>
    </Link>
  );
}

/** The listed example: what it costs and holds, or where to go once it is off the market. */
function ForSale({ check }: { check: (tokenId: string) => Promise<Report | null> }) {
  const tokenId = GALLERY.forSale;
  const report = useAsync(() => check(tokenId), tokenId);
  const address = report.data?.address;
  const balance = useAsync(async () => (address ? client(SEPOLIA).getBalance({ address }) : null), address ?? "");
  const listing = report.data?.listing;

  let title = `Checking satchel #${tokenId}…`;
  let body = "";
  if (report.data && listing) {
    title = `Satchel #${tokenId} is for sale for ${formatNear(listing.price)} NEAR`;
    const holds = typeof balance.data === "bigint" ? `It holds ${formatBalance(balance.data)} Sepolia ETH. ` : "";
    body = `${holds}Buy it and its address on every chain moves to you in one NEAR transaction, for the record version you checked.`;
  } else if (report.data) {
    title = `Satchel #${tokenId} is no longer for sale`;
    body = "Mint your own and list it from its page; it shows up on the market with its report.";
  } else if (report.error || report.data === null) {
    title = `Couldn't read satchel #${tokenId}`;
  }

  return (
    <Card className="mt-4 flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0 flex-[1_1_18rem]">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-display text-xl font-semibold">{title}</h3>
          {report.data && <ReportBadge report={report} />}
        </div>
        {body && <p className="mt-1 text-sm text-ink-2">{body}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href={`/satchel/${tokenId}`} className="rounded-full border border-ink px-4 py-2 text-sm font-medium transition hover:bg-paper-2">
          Read its report
        </Link>
        <Link
          href={listing || !report.data ? "/market" : "/satchels"}
          className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper transition hover:bg-leather"
        >
          {listing || !report.data ? "See the market" : "Mint a satchel"}
        </Link>
      </div>
    </Card>
  );
}

/** Real satchels on testnet, one clean and two caught, each with its report run in the browser. */
export function VerdictGallery() {
  const check = useReportChecker();
  return (
    <section id="examples" className="scroll-mt-24">
      <p className="text-sm font-medium tracking-wide text-leather">See it in 30 seconds</p>
      <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight">Three real satchels: one clean, two caught</h2>
      <p className="mt-3 max-w-3xl text-ink-2">
        Each badge is the clean transfer report, run in your browser just now against NEAR testnet and Sepolia. Open one
        to see every line it checked.
      </p>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {GALLERY.examples.map((example) => (
          <ExampleCard key={example.tokenId} example={example} check={check} />
        ))}
      </div>
      <ForSale check={check} />
    </section>
  );
}
