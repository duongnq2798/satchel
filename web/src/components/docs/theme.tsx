"use client";

import { useEffect, useLayoutEffect, useState } from "react";

/**
 * The docs' light and dark themes. The rest of the site is light only, so the theme is set on
 * <html> while a docs page is on screen and removed when you leave the docs.
 */

export type ThemeChoice = "system" | "light" | "dark";
const KEY = "satchel-docs-theme";

/** Runs before the first paint of a docs page, so a dark-mode reader never sees a flash of light. */
export const THEME_SCRIPT = `try{var c=localStorage.getItem("${KEY}");var d=c==="dark"||(c!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light"}catch(e){}`;

function readChoice(): ThemeChoice {
  try {
    const c = localStorage.getItem(KEY);
    return c === "light" || c === "dark" ? c : "system";
  } catch {
    return "system";
  }
}

function apply(choice: ThemeChoice) {
  const dark = choice === "dark" || (choice === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

/** Keeps <html data-theme> in step while the docs are open, and clears it when they close. */
export function ThemeController() {
  useLayoutEffect(() => {
    apply(readChoice());
    const media = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => readChoice() === "system" && apply("system");
    media.addEventListener("change", onChange);
    return () => {
      media.removeEventListener("change", onChange);
      delete document.documentElement.dataset.theme;
    };
  }, []);
  return null;
}

const OPTIONS: { value: ThemeChoice; label: string; icon: string }[] = [
  { value: "light", label: "Light", icon: "M8 3V1.5M8 14.5V13M13 8h1.5M1.5 8H3M11.5 4.5l1-1M3.5 12.5l1-1M11.5 11.5l1 1M3.5 3.5l1 1M10.5 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z" },
  { value: "system", label: "System", icon: "M2 3.5h12v7H2zM6 13.5h4M8 10.5v3" },
  { value: "dark", label: "Dark", icon: "M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z" },
];

export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>("system");
  useEffect(() => setChoice(readChoice()), []);
  const pick = (value: ThemeChoice) => {
    setChoice(value);
    try {
      if (value === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, value);
    } catch {
      // Storage can be blocked; the choice still holds for this page.
    }
    apply(value);
  };
  return (
    <div role="radiogroup" aria-label="Theme" className="flex rounded-full border border-line bg-card p-0.5">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={choice === o.value}
          aria-label={o.label}
          title={o.label}
          onClick={() => pick(o.value)}
          className="rounded-full p-1.5 text-ink-2 transition hover:text-ink aria-checked:bg-ink aria-checked:text-paper"
        >
          <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d={o.icon} />
          </svg>
        </button>
      ))}
    </div>
  );
}
