"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useId, useState } from "react";
import { useNetwork } from "@/components/network";
import { NetLink } from "@/components/site-header";
import { Button, Card } from "@/components/ui";
import { MAINNET, NETWORKS, TESTNET } from "satchel-nft";
import { appPath } from "@/lib/routes";
import { CHECKS } from "@/lib/copy";
import { DEMO_SATCHELS, SITE_HOSTS, parseSatchelInput, refNetwork } from "@/lib/showcase";

export default function Verify() {
  const router = useRouter();
  const net = useNetwork();
  // Empty, so a pasted link isn't appended to a default id.
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  // This network's demo satchels first, then the other network's.
  const groups = (net.id === "mainnet" ? [MAINNET, TESTNET] : [TESTNET, MAINNET]).map((n) => ({
    net: n,
    picks: DEMO_SATCHELS.filter((d) => d.pick && d.network === n.id),
  }));

  function submit(e: FormEvent) {
    e.preventDefault();
    // A link from this deployment works too, a preview's or localhost's.
    const ref = parseSatchelInput(text, [...SITE_HOSTS, window.location.host]);
    if (!ref) {
      setError("Enter a token id, like 5 or #5, or paste the link to a satchel's page");
      return;
    }
    const to = refNetwork(ref, net);
    const href = appPath(to, `/satchel/${ref.tokenId}`);
    // The other network's page loads fresh, as the header's switch does, so nothing carries over.
    if (to.id !== net.id) window.location.assign(href);
    else router.push(href);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-display text-4xl font-semibold tracking-tight">Verify a satchel</h1>
        <p className="mt-1 text-ink-2">
          Before you buy or accept one, check what its previous owners could have kept back. No wallet needed.
        </p>
      </div>
      <Card>
        <form onSubmit={submit} noValidate>
          <label htmlFor={inputId} className="text-sm font-medium">
            Satchel on NEAR {net.id}
          </label>
          <div className="mt-2 flex flex-wrap items-start gap-2">
            <input
              id={inputId}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setError("");
              }}
              placeholder="5, #5 or a satchel's link"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${errorId} ${hintId}` : hintId}
              className="min-w-0 flex-1 rounded-xl border border-line bg-paper px-3 py-2 sm:max-w-sm"
            />
            <Button type="submit" variant="primary">
              Check it
            </Button>
          </div>
          {/* Always in the page, so a screen reader hears the message when it appears. */}
          <p id={errorId} aria-live="polite" className="mt-1 text-sm text-bad empty:mt-0">
            {error}
          </p>
          <p id={hintId} className="mt-1 text-sm text-muted">
            A token id, like 5 or #5, or the link to a satchel&apos;s page on satchelnft.xyz, which names its network.
          </p>
        </form>
      </Card>

      <section aria-labelledby="demo-satchels">
        <h2 id="demo-satchels" className="font-display text-2xl font-semibold">
          Or pick a demo satchel
        </h2>
        <p className="mt-1 text-sm text-ink-2">What happened to each one. Its page reads the report live.</p>
        {groups.map(({ net: n, picks }) => (
          <div key={n.id} className="mt-4">
            <h3 id={`picks-${n.id}`} className="text-sm font-medium text-muted">
              On {n.id}
            </h3>
            <ul aria-labelledby={`picks-${n.id}`} className="mt-2 grid gap-2 sm:grid-cols-2">
              {picks.map((d) => (
                <li key={d.tokenId}>
                  <NetLink
                    href={appPath(NETWORKS[d.network], `/satchel/${d.tokenId}`)}
                    className="flex h-full gap-3 rounded-xl border border-line bg-card px-4 py-3 transition hover:border-ink"
                  >
                    <span className="shrink-0 font-display text-xl font-semibold">
                      #{d.tokenId}
                      {/* Testnet #1 and mainnet #1 read the same in a list of links without it. */}
                      <span className="sr-only"> on {d.network}</span>
                    </span>
                    <span className="text-sm text-ink-2">{d.story}</span>
                  </NetLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <ol className="space-y-4">
        {CHECKS.map((c, i) => (
          <li key={c.title} className="flex gap-3">
            <span className="font-display text-2xl text-gold-deep">{i + 1}</span>
            <div>
              <p className="font-medium">{c.title}</p>
              <p className="text-sm text-ink-2">{c.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
