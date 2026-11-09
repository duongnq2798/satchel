"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DOCS, docHref } from "@/lib/docs/nav";

/** The docs' table of contents: every section and page, the current one marked. */
export function DocsNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const current = useRef<HTMLAnchorElement>(null);
  // Keep the current page in view when the sidebar is taller than the screen. Only the sidebar
  // scrolls: scrollIntoView would move the whole page too.
  useEffect(() => {
    const link = current.current;
    const box = link?.closest<HTMLElement>("[data-docs-scroll]");
    if (!link || !box) return;
    const l = link.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    if (l.top < b.top || l.bottom > b.bottom) box.scrollTop += l.top - b.top - b.height / 3;
  }, [pathname]);
  return (
    <nav aria-label="Documentation" className="text-sm">
      {DOCS.map((section) => (
        <div key={section.title} className="mb-6">
          <p className="mb-2 px-2 text-xs font-semibold tracking-wide text-muted uppercase">{section.title}</p>
          <ul className="space-y-0.5">
            {section.pages.map((page) => {
              const href = docHref(page.slug);
              const active = pathname === href;
              return (
                <li key={href}>
                  <Link
                    href={href}
                    ref={active ? current : undefined}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={`block rounded-lg px-2 py-1.5 leading-snug transition ${
                      active ? "bg-gold-soft font-medium text-ink" : "text-ink-2 hover:bg-paper-2 hover:text-ink"
                    }`}
                  >
                    {page.nav ?? page.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** The sidebar on a phone or tablet: a button that opens it as a panel over the page. */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const panel = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.querySelector<HTMLElement>("a[aria-current], a")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
      button.current?.focus();
    };
  }, [open]);
  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-controls="docs-mobile-nav"
        className="inline-flex items-center gap-2 rounded-lg border border-line bg-card px-3 py-2 text-sm font-medium lg:hidden"
      >
        <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M2.5 4h11M2.5 8h11M2.5 12h11" strokeLinecap="round" />
        </svg>
        Menu
      </button>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Documentation menu">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} />
          <div
            ref={panel}
            id="docs-mobile-nav"
            className="absolute inset-y-0 left-0 flex w-[min(20rem,86vw)] flex-col border-r border-line bg-paper shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="font-display text-lg font-semibold">Docs</span>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-2 py-1 text-sm text-ink-2 hover:bg-paper-2">
                Close
              </button>
            </div>
            <div data-docs-scroll className="overflow-y-auto px-3 py-4">
              <DocsNav onNavigate={() => setOpen(false)} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
