"use client";

import { type ReactNode, useState } from "react";
import type { Status, Verdict } from "@/lib/report";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-card p-5 ${className}`}>{children}</section>;
}

const BUTTON = {
  primary: "bg-ink text-paper hover:bg-leather",
  secondary: "border border-line bg-card text-ink hover:border-ink",
  gold: "bg-gold text-ink hover:bg-gold/80",
} as const;

export function Button({
  children,
  onClick,
  variant = "secondary",
  type = "button",
  busy = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: keyof typeof BUTTON;
  type?: "button" | "submit";
  busy?: boolean;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      aria-busy={busy}
      disabled={busy}
      className={`inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition aria-busy:cursor-progress aria-busy:opacity-70 ${BUTTON[variant]}`}
    >
      {busy && <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />}
      {children}
    </button>
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

export function StatusIcon({ status }: { status: Status }) {
  const style = { pass: "bg-ok text-paper", fail: "bg-warn text-paper", unknown: "bg-muted text-paper" }[status];
  const mark = { pass: "✓", fail: "!", unknown: "?" }[status];
  return (
    <span className={`mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${style}`} aria-label={status}>
      {mark}
    </span>
  );
}

export function Mono({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono text-[0.92em] break-all ${className}`}>{children}</span>;
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() =>
        navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
      }
      className="shrink-0 rounded-full border border-line px-3 py-1 text-xs text-ink-2 transition hover:border-ink"
    >
      {copied ? "Copied" : label}
    </button>
  );
}

/** Wallets reject with strings, Errors or plain objects; show each as words, not "[object Object]". */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function ErrorNote({ error }: { error: unknown }) {
  if (error === null || error === undefined) return null;
  const message = errorMessage(error);
  return <p className="rounded-xl bg-bad-soft px-3 py-2 text-sm text-bad">{message}</p>;
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="underline decoration-line underline-offset-4 hover:decoration-ink">
      {children}
    </a>
  );
}
