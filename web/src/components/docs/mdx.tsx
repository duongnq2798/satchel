import type { MDXComponents } from "mdx/types";
import Link from "next/link";
import { Children, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { CodeBlock } from "./code-block";
import { ArchitectureDiagram, ChecksDiagram, SaleDiagram } from "./diagrams";
import { Tabs } from "./tabs";

/**
 * What a docs page can use. Markdown elements are styled by `.docs-prose` in globals.css; these
 * replace the ones that need behavior, and add the blocks below for MDX pages.
 */

function SmartLink({ href = "", children, ...rest }: ComponentProps<"a">) {
  if (href.startsWith("/") || href.startsWith("#")) {
    return (
      <Link href={href} {...rest}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" {...rest}>
      {children}
      <svg viewBox="0 0 12 12" className="ml-0.5 inline size-[0.7em] align-baseline opacity-60" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M4.5 2.5h5v5M9.5 2.5l-7 7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/** A heading with a link to itself, shown on hover and focus. */
function heading(Tag: "h2" | "h3" | "h4") {
  return function Heading({ id, children, ...rest }: ComponentProps<"h2">) {
    return (
      <Tag id={id} className="group scroll-mt-24" {...rest}>
        {children}
        {id && (
          <a href={`#${id}`} className="docs-anchor" aria-label="Link to this section">
            #
          </a>
        )}
      </Tag>
    );
  };
}

function Pre({ children }: ComponentProps<"pre">) {
  const code = Children.only(children) as ReactElement<{ className?: string; children?: ReactNode; "data-title"?: string }>;
  const lang = /language-(\S+)/.exec(code.props.className ?? "")?.[1] ?? "text";
  const text = String(code.props.children ?? "").replace(/\n$/, "");
  return <CodeBlock code={text} lang={lang} title={code.props["data-title"]} />;
}

/** A table scrolls on its own; its name comes from the heading above it (remarkTableNames). */
function Table({ "data-name": name, ...props }: ComponentProps<"table"> & { "data-name"?: string }) {
  return (
    <div className="docs-table" role="region" aria-label={name ? `Table: ${name}` : "Table"} tabIndex={0}>
      <table {...props} />
    </div>
  );
}

/**
 * A cell's text wraps at about 70 characters, as a paragraph's does (WCAG 1.4.8). A code span that
 * can't wrap widens its cell instead of running over the next one, and the table scrolls.
 */
function Cell({ children, ...props }: ComponentProps<"td">) {
  return (
    <td {...props}>
      <div className="min-w-min max-w-[34em]">{children}</div>
    </td>
  );
}

const CALLOUT = {
  note: { label: "Note", className: "border-line bg-card", icon: "i" },
  tip: { label: "Tip", className: "border-ok/30 bg-ok-soft/60", icon: "✓" },
  warning: { label: "Warning", className: "border-warn/30 bg-warn-soft/70", icon: "!" },
  danger: { label: "Real funds", className: "border-bad/30 bg-bad-soft/70", icon: "!" },
} as const;

export function Callout({ type = "note", title, children }: { type?: keyof typeof CALLOUT; title?: string; children: ReactNode }) {
  const c = CALLOUT[type];
  // A note, not a landmark: a page can hold several callouts with the same title.
  return (
    <div role="note" className={`docs-callout not-prose-margins my-6 rounded-xl border px-4 py-3 ${c.className}`} aria-label={title ?? c.label}>
      <p className="docs-callout-title">
        <span aria-hidden="true" className="docs-callout-icon" data-type={type}>
          {c.icon}
        </span>
        {title ?? c.label}
      </p>
      <div className="docs-callout-body">{children}</div>
    </div>
  );
}

/** Wraps a Markdown ordered list: each item becomes a numbered step. */
export function Steps({ children }: { children: ReactNode }) {
  return <div className="docs-steps">{children}</div>;
}

export function Cards({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 3 }) {
  return <div className={`not-prose my-6 grid gap-3 sm:grid-cols-2 ${cols === 3 ? "lg:grid-cols-3" : ""}`}>{children}</div>;
}

export function Card({ href, title, eyebrow, children }: { href: string; title: string; eyebrow?: string; children?: ReactNode }) {
  const external = !href.startsWith("/");
  const body = (
    <>
      {eyebrow && <span className="text-xs font-medium tracking-wide text-gold-ink uppercase">{eyebrow}</span>}
      <span className="mt-1 flex items-center justify-between gap-2 font-medium text-ink">
        {title}
        <span aria-hidden="true" className="text-muted transition group-hover:translate-x-0.5 group-hover:text-ink">
          {external ? "↗" : "→"}
        </span>
      </span>
      {/* A div, not a span: MDX wraps a card's text in a paragraph. */}
      {children && <div className="mt-1 text-sm leading-relaxed text-ink-2 [&_code]:font-mono [&_code]:text-[0.9em] [&>p]:m-0">{children}</div>}
    </>
  );
  const className = "group block rounded-xl border border-line bg-card p-4 no-underline transition hover:border-ink/40 hover:shadow-sm";
  return external ? (
    <a href={href} target="_blank" rel="noreferrer" className={className}>
      {body}
    </a>
  ) : (
    <Link href={href} className={className}>
      {body}
    </Link>
  );
}

export function Figure({ src, alt, caption, width }: { src: string; alt: string; caption?: string; width?: number }) {
  return (
    <figure className="my-8">
      <img src={src} alt={alt} width={width} loading="lazy" decoding="async" className="mx-auto rounded-xl border border-line shadow-sm" />
      {caption && <figcaption className="mx-auto mt-2 max-w-[34em] text-center text-sm text-muted">{caption}</figcaption>}
    </figure>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-card px-1.5 py-0.5 font-mono text-[0.8em] text-ink-2 shadow-[0_1px_0_var(--color-line)]">{children}</kbd>;
}

/** One panel of `<Tabs>`. */
export function Tab({ children }: { children: ReactNode }) {
  return <div>{children}</div>;
}

/** Inline verdict, as the report prints it. */
export function Verdict({ v }: { v: "clean" | "not-provable" | "unknown" }) {
  const style = {
    clean: ["Provably clean", "bg-ok-soft text-ok"],
    "not-provable": ["Not provable", "bg-warn-soft text-warn"],
    unknown: ["Couldn't check everything", "bg-paper-2 text-ink-2"],
  }[v];
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[0.85em] font-medium whitespace-nowrap ${style[1]}`}>{style[0]}</span>;
}

export const mdxComponents: MDXComponents = {
  a: SmartLink,
  h2: heading("h2"),
  h3: heading("h3"),
  h4: heading("h4"),
  pre: Pre,
  table: Table,
  td: Cell,
  Callout,
  Steps,
  Cards,
  Card,
  Figure,
  Kbd,
  Tabs,
  Tab,
  Verdict,
  ArchitectureDiagram,
  SaleDiagram,
  ChecksDiagram,
};
