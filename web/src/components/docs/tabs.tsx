"use client";

import { Children, type KeyboardEvent, type ReactNode, useId, useRef, useState } from "react";

/**
 * Alternatives for the same step, one shown at a time: `<Tabs labels={["Browser", "Terminal"]}>`
 * with one child per label. Arrow keys move between tabs, as the WAI-ARIA tabs pattern says.
 */
export function Tabs({ labels, children }: { labels: string[]; children: ReactNode }) {
  const [active, setActive] = useState(0);
  const id = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const panels = Children.toArray(children);
  const onKey = (e: KeyboardEvent) => {
    const move = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (move === 0) return;
    e.preventDefault();
    const next = (active + move + labels.length) % labels.length;
    setActive(next);
    tabs.current[next]?.focus();
  };
  return (
    <div className="docs-tabs my-6">
      <div role="tablist" aria-orientation="horizontal" className="flex gap-1 border-b border-line" onKeyDown={onKey}>
        {labels.map((label, i) => (
          <button
            key={label}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${id}-tab-${i}`}
            aria-selected={i === active}
            aria-controls={`${id}-panel-${i}`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => setActive(i)}
            className="-mb-px border-b-2 px-3 py-2 text-sm font-medium transition aria-selected:border-gold aria-selected:text-ink border-transparent text-ink-2 hover:text-ink"
          >
            {label}
          </button>
        ))}
      </div>
      {panels.map((panel, i) => (
        <div key={i} role="tabpanel" id={`${id}-panel-${i}`} aria-labelledby={`${id}-tab-${i}`} hidden={i !== active} className="pt-1">
          {panel}
        </div>
      ))}
    </div>
  );
}
