"use client";

import { useEffect, useState } from "react";
import type { TocEntry } from "@/lib/docs/markdown";

/** "On this page": the page's h2 and h3 headings, the one being read marked as you scroll. */
export function Toc({ entries, variant = "aside" }: { entries: TocEntry[]; variant?: "aside" | "inline" }) {
  const active = useActiveHeading(entries);
  if (entries.length < 2) return null;
  const list = (
    <ul className="space-y-1 text-sm">
      {entries.map((e) => (
        <li key={e.id} className={e.depth === 3 ? "pl-3" : ""}>
          <a
            href={`#${e.id}`}
            aria-current={active === e.id ? "location" : undefined}
            className={`block border-l-2 py-0.5 pl-3 leading-snug transition ${
              active === e.id ? "border-gold font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink"
            }`}
          >
            {e.text}
          </a>
        </li>
      ))}
    </ul>
  );
  if (variant === "inline") {
    return (
      <details className="mb-8 rounded-xl border border-line bg-card px-4 py-3 xl:hidden">
        <summary className="cursor-pointer text-sm font-medium">On this page</summary>
        <nav aria-label="On this page" className="mt-3">
          {list}
        </nav>
      </details>
    );
  }
  return (
    <nav aria-label="On this page">
      <p className="mb-3 text-xs font-semibold tracking-wide text-muted uppercase">On this page</p>
      {list}
    </nav>
  );
}

function useActiveHeading(entries: TocEntry[]): string | null {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const headings = entries.map((e) => document.getElementById(e.id)).filter((h): h is HTMLElement => h !== null);
    if (headings.length === 0) return;
    // The last heading above a line a quarter of the way down the screen is the one being read.
    const update = () => {
      const line = window.innerHeight * 0.25;
      let current: string | null = headings[0].id;
      for (const h of headings) {
        if (h.getBoundingClientRect().top <= line) current = h.id;
        else break;
      }
      setActive(current);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [entries]);
  return active;
}
