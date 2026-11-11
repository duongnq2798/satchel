import type { Metadata } from "next";
import { NetLink } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Page not found",
  description: "Satchel has no page at this address. A satchel's page is /satchel/ and its id, and the verify page takes an id or a link.",
};

/** Any address the site has no page for, and a satchel page whose id isn't a number. */
export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 py-6">
      <h1 className="font-display text-4xl font-semibold tracking-tight">No page here</h1>
      <p className="text-ink-2">
        A satchel&apos;s page is <code className="font-mono text-[0.9em]">/satchel/</code> and its id, like{" "}
        <code className="font-mono text-[0.9em]">/satchel/5</code>, or <code className="font-mono text-[0.9em]">/mainnet/satchel/1</code>{" "}
        on mainnet. The verify page takes an id or a link.
      </p>
      {/* On a /mainnet address, both stay on mainnet. */}
      <div className="flex flex-wrap gap-3 pt-2">
        <NetLink href="/verify" follow className="rounded-full bg-ink px-6 py-3 text-sm font-medium text-paper transition hover:bg-leather">
          Verify a satchel
        </NetLink>
        <NetLink href="/" follow className="rounded-full border border-ink px-6 py-3 text-sm font-medium transition hover:bg-card">
          Home
        </NetLink>
      </div>
    </div>
  );
}
