import Link from "next/link";
import type { ReactNode } from "react";
import { REPO_URL } from "satchel-nft";
import { DocsSearch } from "@/components/docs/search";
import { DocsNav, MobileNav } from "@/components/docs/sidebar";
import { THEME_SCRIPT, ThemeController, ThemeToggle } from "@/components/docs/theme";

/** Versions the docs describe. Bump with a release; the changelog says what changed. */
const VERSIONS = "Contract v1 · satchel-nft 0.2.0";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div data-docs-shell id="top" className="docs-shell scroll-mt-24">
      <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      <ThemeController />
      <div className="flex flex-wrap items-center gap-3 border-b border-line py-3">
        <MobileNav />
        <Link href="/docs" className="hidden font-display text-lg font-semibold tracking-tight lg:block">
          Docs
        </Link>
        <span className="hidden rounded-full bg-paper-2 px-2.5 py-0.5 text-xs text-ink-2 md:inline">{VERSIONS}</span>
        <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2 sm:flex-none">
          <DocsSearch />
          <ThemeToggle />
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="hidden rounded-lg p-2 text-ink-2 hover:bg-paper-2 hover:text-ink sm:block"
            aria-label="Satchel on GitHub (opens in a new tab)"
          >
            <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
            </svg>
          </a>
        </div>
      </div>
      <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
        <aside className="hidden lg:block">
          <div data-docs-scroll className="sticky top-20 max-h-[calc(100vh-5rem)] overflow-y-auto overscroll-contain py-8 pr-2">
            <DocsNav />
          </div>
        </aside>
        <div className="min-w-0 py-8">{children}</div>
      </div>
    </div>
  );
}
