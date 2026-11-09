"use client";

import { useEffect, useState } from "react";

/** Copies a code block's text. Says so to screen readers, and says so when the clipboard refuses. */
export function CopyCode({ code }: { code: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 1800);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <button
      type="button"
      onClick={() =>
        navigator.clipboard.writeText(code).then(
          () => setState("copied"),
          () => setState("failed"),
        )
      }
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-ink-2 transition hover:bg-paper-2 hover:text-ink"
    >
      <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
        {state === "copied" ? (
          <path d="M3 8.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <>
            <rect x="5" y="5" width="8.5" height="8.5" rx="1.5" />
            <path d="M10.5 5V3.5A1.5 1.5 0 0 0 9 2H3.5A1.5 1.5 0 0 0 2 3.5V9A1.5 1.5 0 0 0 3.5 10.5H5" />
          </>
        )}
      </svg>
      <span aria-live="polite">{state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}</span>
    </button>
  );
}
