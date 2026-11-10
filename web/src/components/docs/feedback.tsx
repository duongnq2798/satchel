"use client";

import { useEffect, useState } from "react";
import { REPO_URL } from "satchel-nft";

/**
 * "Was this page helpful?" The site stores nothing on a server (its one server route, the holder
 * room's, keeps no state) and this sends nothing on its own: the answer is kept in this browser,
 * and either answer offers a GitHub issue, prefilled with the page, to say what to change.
 */
export function Feedback({ slug, title }: { slug: string; title: string }) {
  const key = `satchel-docs-feedback:${slug}`;
  const [vote, setVote] = useState<"yes" | "no" | null>(null);
  useEffect(() => {
    try {
      const v = localStorage.getItem(key);
      setVote(v === "yes" || v === "no" ? v : null);
    } catch {
      setVote(null);
    }
  }, [key]);
  const choose = (v: "yes" | "no") => {
    setVote(v);
    try {
      localStorage.setItem(key, v);
    } catch {
      // Storage can be blocked; the thanks still shows.
    }
  };
  const page = `https://satchelnft.xyz${slug === "" ? "/docs" : `/docs/${slug}`}`;
  const issue = (kind: string) =>
    `${REPO_URL}/issues/new?${new URLSearchParams({
      title: `Docs: ${title}`,
      body: `Page: ${page}\n\n${kind}\n\n`,
      labels: "documentation",
    })}`;
  return (
    <section aria-label="Page feedback" className="rounded-2xl border border-line bg-card px-5 py-4">
      {vote === null ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-medium">Was this page helpful?</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => choose("yes")} className="rounded-full border border-line px-4 py-1.5 text-sm hover:border-ink">
              Yes
            </button>
            <button type="button" onClick={() => choose("no")} className="rounded-full border border-line px-4 py-1.5 text-sm hover:border-ink">
              No
            </button>
          </div>
        </div>
      ) : (
        <div className="text-sm" role="status">
          <p className="font-medium">{vote === "yes" ? "Thanks. Good to hear." : "Thanks for saying so."}</p>
          <p className="mt-1 text-ink-2">
            {vote === "yes" ? "Anything still unclear? " : "Tell us what was missing, wrong or hard to follow, and we'll fix the page: "}
            <a href={issue(vote === "yes" ? "What could be clearer:" : "What was missing or wrong:")} target="_blank" rel="noreferrer" className="font-medium underline decoration-gold underline-offset-4">
              open an issue on GitHub
            </a>
            . Nothing is sent until you do.{" "}
            <button type="button" onClick={() => setVote(null)} className="text-muted underline underline-offset-4 hover:text-ink">
              Change answer
            </button>
          </p>
        </div>
      )}
    </section>
  );
}
