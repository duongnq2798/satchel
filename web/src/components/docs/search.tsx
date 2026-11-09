"use client";

import { useRouter } from "next/navigation";
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type SearchEntry, type SearchHit, highlight, search, terms } from "@/lib/docs/search";

/** Pages offered before you type: where most people start. */
const SUGGESTED = [
  { href: "/docs/quickstart", label: "Quickstart: check a satchel in two minutes" },
  { href: "/docs/concepts/clean-transfer-report", label: "The clean transfer report" },
  { href: "/docs/guides/buy", label: "Buy a satchel" },
  { href: "/docs/developers/cli", label: "CLI reference" },
  { href: "/docs/developers/errors", label: "Errors and exit codes" },
];

type IndexState = { status: "idle" | "loading" } | { status: "ready"; index: SearchEntry[] } | { status: "error"; message: string };

let cached: Promise<SearchEntry[]> | null = null;

function loadIndex(): Promise<SearchEntry[]> {
  cached ??= fetch("/docs/search-index.json")
    .then((r) => {
      if (!r.ok) throw new Error(`The search index answered ${r.status}`);
      return r.json() as Promise<SearchEntry[]>;
    })
    .catch((err: unknown) => {
      cached = null;
      throw err;
    });
  return cached;
}

export function DocsSearch() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform)), []);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    trigger.current?.focus();
  }, []);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(true)}
        onPointerEnter={() => void loadIndex().catch(() => {})}
        className="flex w-full min-w-0 items-center gap-2 rounded-lg border border-line bg-card px-3 py-2 text-left text-sm text-muted transition hover:border-ink/40 sm:w-72"
        aria-haspopup="dialog"
      >
        <SearchIcon />
        <span className="flex-1 truncate">Search the docs</span>
        <span className="hidden rounded border border-line px-1.5 font-mono text-[0.7rem] sm:inline">{mac ? "⌘K" : "Ctrl K"}</span>
      </button>
      {open && <SearchDialog onClose={close} />}
    </>
  );
}

function SearchDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [state, setState] = useState<IndexState>({ status: "loading" });
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const load = useCallback(() => {
    setState({ status: "loading" });
    loadIndex().then(
      (index) => setState({ status: "ready", index }),
      (err: unknown) => setState({ status: "error", message: err instanceof Error ? err.message : String(err) }),
    );
  }, []);
  useEffect(() => {
    load();
    input.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [load]);

  const hits: SearchHit[] = useMemo(() => (state.status === "ready" ? search(state.index, query) : []), [state, query]);
  const want = useMemo(() => terms(query), [query]);
  const options = query.trim() ? hits.map((h) => h.entry.href) : SUGGESTED.map((s) => s.href);
  useEffect(() => setSelected(0), [query]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const go = (href: string) => {
    onClose();
    router.push(href);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (options.length === 0) return;
      setSelected((s) => (s + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
    } else if (e.key === "Enter" && options[selected]) {
      e.preventDefault();
      go(options[selected]);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[10vh]" role="dialog" aria-modal="true" aria-label="Search the docs">
      <button type="button" aria-label="Close search" className="absolute inset-0 cursor-default bg-ink/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative flex max-h-[75vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-paper shadow-2xl" onKeyDown={onKey}>
        <div className="flex items-center gap-3 border-b border-line px-4">
          <SearchIcon />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search: verify, exit code 3, approval, finality…"
            className="h-14 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-muted focus-visible:outline-none"
            role="combobox"
            aria-expanded="true"
            aria-controls="docs-search-results"
            aria-activedescendant={options[selected] ? `docs-search-${selected}` : undefined}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="button" onClick={onClose} className="rounded border border-line px-1.5 py-0.5 font-mono text-xs text-muted hover:text-ink">
            Esc
          </button>
        </div>
        <div className="overflow-y-auto p-2" aria-live="polite">
          {state.status === "loading" && query.trim() !== "" && (
            <ul className="space-y-2 p-2" aria-label="Loading results">
              {[0, 1, 2].map((i) => (
                <li key={i} className="h-14 animate-pulse rounded-lg bg-paper-2" />
              ))}
            </ul>
          )}
          {state.status === "error" && (
            <div className="m-2 rounded-xl bg-bad-soft px-4 py-3 text-sm text-bad">
              <p className="font-medium">Search couldn&apos;t load.</p>
              <p className="mt-1">{state.message}. The pages still work: browse them from the menu.</p>
              <button type="button" onClick={load} className="mt-2 rounded-full border border-bad/40 px-3 py-1 text-xs font-medium hover:bg-bad/10">
                Try again
              </button>
            </div>
          )}
          {query.trim() === "" && state.status !== "error" && (
            <>
              <p className="px-3 pt-2 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">Start here</p>
              <ul ref={list} id="docs-search-results" role="listbox" aria-label="Suggested pages">
                {SUGGESTED.map((s, i) => (
                  <li key={s.href} id={`docs-search-${i}`} role="option" aria-selected={i === selected} data-index={i}>
                    <button
                      type="button"
                      onClick={() => go(s.href)}
                      onMouseMove={() => setSelected(i)}
                      className={`w-full rounded-lg px-3 py-2.5 text-left text-sm ${i === selected ? "bg-gold-soft text-ink" : "text-ink-2"}`}
                    >
                      {s.label}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {state.status === "ready" && query.trim() !== "" && hits.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-ink-2">
              <p className="font-medium text-ink">No results for “{query.trim()}”</p>
              <p className="mt-1">Try fewer or shorter words, a command like verify, or an error message as the contract prints it.</p>
            </div>
          )}
          {state.status === "ready" && hits.length > 0 && (
            <ul ref={list} id="docs-search-results" role="listbox" aria-label="Results">
              {hits.map((h, i) => (
                <li key={h.entry.href} id={`docs-search-${i}`} role="option" aria-selected={i === selected} data-index={i}>
                  <button
                    type="button"
                    onClick={() => go(h.entry.href)}
                    onMouseMove={() => setSelected(i)}
                    className={`w-full rounded-lg px-3 py-2.5 text-left ${i === selected ? "bg-gold-soft" : ""}`}
                  >
                    <span className="block text-xs text-muted">
                      {h.entry.section} › {h.entry.page}
                    </span>
                    <span className="block text-sm font-medium text-ink">
                      <Marked text={h.entry.heading || h.entry.page} want={want} />
                    </span>
                    {h.snippet && (
                      <span className="mt-0.5 line-clamp-2 block text-sm text-ink-2">
                        <Marked text={h.snippet} want={want} />
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-4 py-2 text-xs text-muted">
          <span>↑ ↓ to move</span>
          <span>Enter to open</span>
          <span>Esc to close</span>
        </div>
      </div>
    </div>
  );
}

function Marked({ text, want }: { text: string; want: string[] }) {
  return (
    <>
      {highlight(text, want).map((p, i) =>
        p.match ? (
          <mark key={i} className="rounded-sm bg-gold/25 px-0.5 text-ink">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-4 shrink-0 text-muted" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 14 14" strokeLinecap="round" />
    </svg>
  );
}
