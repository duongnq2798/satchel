"use client";

import { type MouseEvent, type ReactNode, useEffect, useRef, useState } from "react";
import type { Status as CheckStatus, Verdict } from "satchel-nft";
import { errorKind, errorText } from "@/lib/errors";
import { TIMING, type WaitPhase } from "@/lib/timing";
import { type Async, useWait } from "./use-async";

export { errorMessage } from "@/lib/errors";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-card p-5 ${className}`}>{children}</section>;
}

/** A 12 px ring; static under reduced motion. */
export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-loading="spinner"
      className={`inline-block size-3 shrink-0 rounded-full border-2 border-current border-t-transparent motion-safe:animate-spin ${className}`}
    />
  );
}

const BUTTON = {
  primary: "bg-ink text-paper hover:bg-leather",
  secondary: "border border-line bg-card text-ink hover:border-ink",
  gold: "bg-gold text-ink hover:bg-gold/80",
} as const;

const SIZE = { md: "px-4 py-2 text-sm", sm: "px-3 py-1 text-xs" } as const;

const OFF = "border border-line bg-paper-2 text-ink-2 cursor-not-allowed";

const thenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";

/** Busy or disabled, it keeps its focus and its width, and ignores clicks; a promise from `onClick` keeps it busy. */
export function Button({
  children,
  onClick,
  variant = "secondary",
  type = "button",
  size = "md",
  busy = false,
  busyText,
  disabled = false,
  describedBy,
}: {
  children: ReactNode;
  /** A returned promise keeps the button busy until it settles. */
  onClick?: () => unknown;
  variant?: keyof typeof BUTTON;
  type?: "button" | "submit";
  size?: keyof typeof SIZE;
  busy?: boolean;
  /** Said to screen readers once the spinner shows, e.g. "Connecting to your wallet…". */
  busyText?: string;
  /** aria-disabled: it keeps focus and ignores clicks; give the reason through describedBy. */
  disabled?: boolean;
  describedBy?: string;
}) {
  const [owned, setOwned] = useState(false);
  const working = busy || owned;
  const shown = useWait(working, TIMING.action) !== "hidden";
  const click = (e: MouseEvent<HTMLButtonElement>) => {
    if (working || disabled) return e.preventDefault();
    const out = onClick?.();
    if (!thenable(out)) return;
    setOwned(true);
    const done = () => setOwned(false);
    out.then(done, done);
  };
  return (
    <>
      <button
        type={type}
        onClick={click}
        aria-busy={working || undefined}
        aria-disabled={working || disabled || undefined}
        aria-describedby={describedBy}
        className={`relative inline-flex items-center justify-center rounded-full font-medium transition aria-busy:cursor-progress ${SIZE[size]} ${disabled && !working ? OFF : BUTTON[variant]}`}
      >
        <span className={shown ? "opacity-0" : undefined}>{children}</span>
        {shown && (
          <span className="absolute inset-0 grid place-items-center">
            <Spinner />
          </span>
        )}
      </button>
      {busyText !== undefined && (
        <span role="status" className="sr-only">
          {shown ? busyText : ""}
        </span>
      )}
    </>
  );
}

const TONE = {
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  plain: "bg-paper-2 text-ink-2",
  gold: "bg-gold-soft text-leather",
} as const;

export function Badge({ children, tone = "plain" }: { children: ReactNode; tone?: keyof typeof TONE }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE[tone]}`}>{children}</span>;
}

export const VERDICT: Record<Verdict, { label: string; tone: keyof typeof TONE }> = {
  clean: { label: "Provably clean", tone: "ok" },
  "not-provable": { label: "Not provable", tone: "warn" },
  unknown: { label: "Couldn't check everything", tone: "plain" },
};

export function StatusIcon({ status }: { status: CheckStatus }) {
  const style = { pass: "bg-ok text-paper", fail: "bg-warn text-paper", unknown: "bg-muted text-paper" }[status];
  const mark = { pass: "✓", fail: "!", unknown: "?" }[status];
  return (
    <span className={`mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${style}`} aria-label={status}>
      {mark}
    </span>
  );
}

export function Mono({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono text-[length:max(0.92em,0.75rem)] break-all ${className}`}>{children}</span>;
}

/** A block (or `as="span"`, an inline box) where content will be, so the page keeps its shape while it loads. */
export function Placeholder({ className = "", as: Tag = "div" }: { className?: string; as?: "div" | "span" }) {
  const inline = Tag === "span" ? "inline-block align-middle " : "";
  return <Tag aria-hidden="true" data-loading="skeleton" className={`${inline}rounded-lg bg-paper-2 motion-safe:animate-pulse ${className}`} />;
}

/** Every variant in one grid cell, only `items[show]` visible: its box is the largest variant's, so a swap never moves anything. */
export function Stack({ items, show, className = "" }: { items: readonly ReactNode[]; show: number; className?: string }) {
  return (
    <span className={`grid ${className}`}>
      {items.map((item, i) => (
        <span key={i} className={`[grid-area:1/1] ${i === show ? "" : "invisible"}`} aria-hidden={i === show ? undefined : true}>
          {item}
        </span>
      ))}
    </span>
  );
}

/** Screen-reader-only live text. The caller keeps it mounted and changes its text. */
export function Status({ children }: { children?: ReactNode }) {
  return (
    <span role="status" className="sr-only">
      {children}
    </span>
  );
}

/** One muted line, always in the layout (invisible while hidden), never live; slow/timeout text swap in place. */
export function WaitLine({
  wait,
  children,
  slow,
  timeout,
  className = "",
}: {
  wait: WaitPhase;
  children: ReactNode;
  slow?: ReactNode;
  timeout?: ReactNode;
  className?: string;
}) {
  return (
    <p data-loading="status" className={`flex items-start gap-2 text-sm text-muted ${wait === "hidden" ? "invisible" : ""} ${className}`}>
      <Spinner className="mt-1" />
      <Stack
        className="min-w-0 flex-1"
        show={wait === "timeout" ? 2 : wait === "slow" ? 1 : 0}
        items={[children, slow ?? children, timeout ?? slow ?? children]}
      />
    </p>
  );
}

/** Skeleton until data, then content; Try again in place; one live region outside both branches. */
export function LoadState<T>({
  state,
  what,
  skeleton,
  slow = "Public RPC nodes can be slow.",
  children,
}: {
  state: Async<T>;
  what: string;
  skeleton: ReactNode;
  slow?: string;
  children: (data: T) => ReactNode;
}) {
  const live = !state.loading
    ? ""
    : state.wait === "timeout"
      ? `No answer in 15 s while reading ${what}.`
      : state.wait === "hidden"
        ? ""
        : `Reading ${what}…`;
  const late = state.wait === "slow" || state.wait === "timeout";
  return (
    <>
      <Status>{live}</Status>
      {state.data !== undefined ? (
        <>
          <div aria-busy={state.refreshing || undefined}>{children(state.data)}</div>
          <ErrorNote error={state.lastError} title={`Couldn't refresh ${what}`} onRetry={state.reload} />
        </>
      ) : state.lastError !== null && state.lastError !== undefined ? (
        <ErrorNote error={state.lastError} title={`Couldn't read ${what}`} onRetry={state.reload} />
      ) : (
        <div className="relative">
          {skeleton}
          {state.loading && late && (
            <div className="absolute top-3 left-3 z-10 rounded-full bg-card px-3 py-1 shadow-sm">
              <WaitLine
                wait={state.wait}
                timeout={
                  <span className="inline-flex flex-wrap items-center gap-2">
                    No answer in 15 s.
                    <Button size="sm" onClick={state.reload}>
                      Try again
                    </Button>
                  </span>
                }
              >
                Still reading. {slow}
              </WaitLine>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** The clipboard API, or a hidden textarea and execCommand where it is missing or refused. */
async function writeClipboard(value: string): Promise<void> {
  try {
    if (navigator.clipboard) return await navigator.clipboard.writeText(value);
  } catch {
    // Refused (no permission, page not focused): the old way may still work.
  }
  const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const area = document.createElement("textarea");
  area.value = value;
  area.readOnly = true;
  area.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
  document.body.append(area);
  area.select();
  try {
    if (!document.execCommand("copy")) throw new Error("Couldn't copy");
  } finally {
    area.remove();
    back?.focus();
  }
}

/** `name` is what a screen reader calls the button while it shows `label`; it starts with `label`'s words. */
export function CopyButton({ value, label = "Copy", name }: { value: string; label?: string; name?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const show = (next: "copied" | "failed") => {
    setState(next);
    timer.current = setTimeout(() => setState("idle"), 1500);
  };
  const copy = () => {
    clearTimeout(timer.current);
    writeClipboard(value).then(
      () => show("copied"),
      () => show("failed"),
    );
  };
  return (
    <>
      <button
        type="button"
        aria-label={state === "idle" ? name : undefined}
        onClick={copy}
        className="shrink-0 rounded-full border border-line px-3 py-1 text-xs text-ink-2 transition hover:border-ink"
      >
        {state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy" : label}
      </button>
      {/* Always in the page, so a screen reader hears the change. */}
      <span role="status" className="sr-only">
        {state === "copied" ? "Copied to the clipboard" : state === "failed" ? "Couldn't copy to the clipboard" : ""}
      </span>
    </>
  );
}

/**
 * What went wrong, in words, by its kind: a wallet cancel as a neutral note, a sent-but-unfinished
 * transaction as a warning, anything else as an error with Try again when `onRetry` is given.
 */
export function ErrorNote({
  error,
  title,
  onRetry,
  retryLabel = "Try again",
  children,
}: {
  error: unknown;
  title?: string;
  onRetry?: () => unknown;
  retryLabel?: string;
  children?: ReactNode;
}) {
  if (error === null || error === undefined) return null;
  const kind = errorKind(error);
  if (kind === "rejected") {
    return (
      <div role="status" className="rounded-xl bg-paper-2 px-3 py-2 text-sm text-ink-2">
        <p>{errorText(error)}</p>
        {children}
      </div>
    );
  }
  const pending = kind === "pending";
  return (
    <div role="alert" className={`rounded-xl px-3 py-2 text-sm ${pending ? "bg-warn-soft text-warn" : "bg-bad-soft text-bad"}`}>
      <p>
        {!pending && title && <strong>{title}: </strong>}
        {errorText(error)}
      </p>
      {children}
      {onRetry && (
        <div className="mt-2">
          <Button size="sm" onClick={onRetry}>
            {retryLabel}
          </Button>
        </div>
      )}
    </div>
  );
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="underline decoration-line underline-offset-4 hover:decoration-ink">
      {children}
    </a>
  );
}
