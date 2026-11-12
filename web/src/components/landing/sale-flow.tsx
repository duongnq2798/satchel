"use client";

import { useEffect, useRef, useState } from "react";

interface Line {
  text: string;
  /** Changed by this step. */
  hot?: boolean;
}

const STEPS: { title: string; body: string; call: string; record: Line[] }[] = [
  {
    title: "Mint",
    body: "A satchel is a NEP-171 NFT. Its path, satchel/<id>, and the contract's account derive a secp256k1 key inside NEAR's MPC network. Nobody holds that key: the network signs with it only when the contract asks.",
    call: "mint()  0.1 NEAR",
    record: [
      { text: "version: 0", hot: true },
      { text: "evm: []" },
      { text: "approvals: []" },
      { text: "opaque_signatures: 0" },
      { text: "unclassified_calls: 0" },
      { text: "listing: null" },
    ],
  },
  {
    title: "Use",
    body: "The owner asks the contract to sign. The contract builds and hashes the EIP-1559 transaction itself, records the chain, the nonce and any approval, then requests the MPC signature. The app broadcasts it.",
    call: "sign_evm({ chain_id: 11155111, nonce: 0, … })",
    record: [
      { text: "version: 1", hot: true },
      { text: "evm: [{ chain_id: 11155111, max_nonce: 0, signatures: 1 }]", hot: true },
      { text: "approvals: []" },
      { text: "opaque_signatures: 0" },
      { text: "unclassified_calls: 0" },
      { text: "listing: null" },
    ],
  },
  {
    title: "List",
    body: "The owner lists it for a price in NEAR. From now until it is sold or delisted, the contract refuses to sign for it, so the record the buyer reads stays the whole story.",
    call: "list({ price: 1 NEAR })",
    record: [
      { text: "version: 1" },
      { text: "evm: [{ chain_id: 11155111, max_nonce: 0, signatures: 1 }]" },
      { text: "approvals: []" },
      { text: "opaque_signatures: 0" },
      { text: "unclassified_calls: 0" },
      { text: "listing: { price: 1 NEAR, record_version: 1 }", hot: true },
    ],
  },
  {
    title: "Check",
    body: "The buyer's browser runs four checks: the contract can't sign around the record, every signed nonce is spent at a finalized block, every approval reads revoked, and nothing signed is unexplained.",
    call: "Sepolia nonce at a finalized block: 1 > max_nonce 0",
    record: [
      { text: "version: 1" },
      { text: "evm: [{ chain_id: 11155111, max_nonce: 0, signatures: 1 }]  ✓ spent", hot: true },
      { text: "approvals: []  ✓ none to revoke", hot: true },
      { text: "opaque_signatures: 0  ✓", hot: true },
      { text: "unclassified_calls: 0  ✓", hot: true },
      { text: "listing: { price: 1 NEAR, record_version: 1 }" },
    ],
  },
  {
    title: "Buy",
    body: "The buyer pays, naming the record version they checked. If anything changed since, the contract refuses and refunds. If not, the NFT moves, and with it the address on every chain, in one transaction.",
    call: "buy({ record_version: 1, price: 1 NEAR })",
    record: [
      { text: "owner: buyer", hot: true },
      { text: "version: 1" },
      { text: "evm: [{ chain_id: 11155111, max_nonce: 0, signatures: 1 }]" },
      { text: "approvals: []" },
      { text: "opaque_signatures: 0 · unclassified_calls: 0" },
      { text: "listing: null", hot: true },
    ],
  },
];

function Record({ step, className = "" }: { step: (typeof STEPS)[number]; className?: string }) {
  return (
    <div className={`rounded-2xl border border-line bg-card p-5 ${className}`}>
      <p className="font-mono text-xs text-leather">{step.call}</p>
      <ul className="mt-4 space-y-1.5 font-mono text-xs leading-relaxed">
        {step.record.map((line) => (
          <li key={line.text} className={`rounded px-2 py-0.5 transition-colors ${line.hot ? "bg-gold-soft text-ink" : "text-ink-2"}`}>
            {line.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Mint, use, list, check, buy: the steps scroll by while the record beside them changes. */
export function SaleFlow() {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(Number((entry.target as HTMLElement).dataset.step));
        }
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    for (const el of refs.current) if (el) observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section id="how" className="scroll-mt-24">
      <p className="text-sm font-medium tracking-wide text-leather">How a sale works</p>
      <h2 className="mt-3 max-w-3xl font-display text-4xl font-semibold tracking-tight sm:text-5xl">The record follows the wallet.</h2>
      <p className="mt-4 text-ink-2">
        The contract keeps one record per satchel and never forgets a signature. An example, step by step:
      </p>
      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <ol className="space-y-6 lg:space-y-[28vh] lg:pb-[20vh]">
          {STEPS.map((step, i) => (
            <li
              key={step.title}
              ref={(el) => {
                refs.current[i] = el;
              }}
              data-step={i}
              className="lg:min-h-[8rem]"
            >
              {/* The other steps dim by color, not opacity, so their text keeps 7:1. */}
              <p className={`font-display text-5xl transition-colors ${i === active ? "text-gold-deep" : "text-gold-deep lg:text-muted"}`}>{i + 1}</p>
              <h3 className={`mt-1 font-display text-2xl font-semibold transition-colors ${i === active ? "" : "lg:text-muted"}`}>{step.title}</h3>
              <p className={`mt-2 max-w-md transition-colors ${i === active ? "text-ink-2" : "text-ink-2 lg:text-muted"}`}>{step.body}</p>
              <Record step={step} className="mt-4 lg:hidden" />
            </li>
          ))}
        </ol>
        <div className="hidden lg:block">
          <div className="sticky top-28">
            <p className="mb-3 text-sm text-muted">
              Step {active + 1} of {STEPS.length}: the record after <span className="text-ink">{STEPS[active].title.toLowerCase()}</span>
            </p>
            <Record step={STEPS[active]} />
          </div>
        </div>
      </div>
    </section>
  );
}
