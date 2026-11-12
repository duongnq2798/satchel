import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * WCAG 2.2 contrast of the colors in globals.css, read from the file itself: 7:1 for text and 4.5:1
 * for large text (1.4.6, AAA), 3:1 for focus rings and field borders (1.4.11). Each pair is one the
 * pages use, translucent text mixed over its background the way the browser draws it.
 */

const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

function vars(blocks: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const block of blocks) for (const [, name, value] of block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)) out[name] = value;
  return out;
}
const bodies = (selector: string) => [...css.matchAll(new RegExp(`${selector}\\s*\\{([^}]*)\\}`, "g"))].map((m) => m[1]);
const LIGHT = vars([...bodies("@theme"), ...bodies(":root")]);
const DARK = { ...LIGHT, ...vars(bodies('html\\[data-theme="dark"\\]')) };

type Rgb = [number, number, number];
const rgb = (hex: string): Rgb => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const luminance = (c: Rgb) => {
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** `fg` at `alpha` over `bg`, as Tailwind's text-paper/75 or bg-ink/20 draws it. */
const over = (fg: Rgb, bg: Rgb, alpha: number): Rgb => fg.map((v, i) => v * alpha + bg[i] * (1 - alpha)) as Rgb;

type Theme = Record<string, string>;
/** A color by token name, `name/alpha` over `under` when translucent. */
function color(theme: Theme, spec: string, under?: Rgb): Rgb {
  const [name, alpha] = spec.split("/");
  const hex = theme[`color-${name}`] ?? theme[name];
  if (!hex) throw new Error(`no color ${name}`);
  if (!alpha) return rgb(hex);
  if (!under) throw new Error(`${spec} needs a background`);
  return over(rgb(hex), under, Number(alpha) / 100);
}
/** A background: tokens and translucent layers, bottom first, like "leather ink/20". */
function background(theme: Theme, layers: string): Rgb {
  return layers.split(" ").reduce<Rgb | undefined>((under, layer) => color(theme, layer, under), undefined) as Rgb;
}
const check = (theme: Theme, fg: string, bg: string) => {
  const under = background(theme, bg);
  return ratio(color(theme, fg, under), under);
};

const SURFACES = ["paper", "paper-2", "card"];
const TEXT = ["ink", "ink-2", "muted", "leather", "ok", "warn", "bad", "gold-ink"];

// Pairs that hold in both themes: [text, background, minimum].
const BOTH: [string, string, number][] = [
  ...TEXT.flatMap((t) => SURFACES.map((s): [string, string, number] => [t, s, 7])),
  ...SURFACES.map((s): [string, string, number] => ["gold-deep", s, 4.5]),
  ["ok", "ok-soft", 7],
  ["warn", "warn-soft", 7],
  ["bad", "bad-soft", 7],
  ["ink-2", "gold-soft", 7],
  ["gold-deep", "gold-soft", 4.5],
  // Badges and the hero card's stamp.
  ["ink-2", "paper-2", 7],
  // Callouts: their text on the tint over the page.
  ["ink-2", "card", 7],
  ["ink-2", "paper ok-soft/60", 7],
  ["ink-2", "paper warn-soft/70", 7],
  ["ink-2", "paper bad-soft/70", 7],
  ["ink", "paper bad-soft/70", 7],
  ["ink", "paper warn-soft/70", 7],
  // The docs diagrams, on their frame (paper-2/60 over paper): a gold box's sub-line, the caption,
  // an ink box's lines.
  ["ink-2", "paper paper-2/60 gold-soft/70", 7],
  ["ink-2", "paper paper-2/60", 7],
  ["muted", "paper paper-2/60", 7],
  ["paper/75", "ink", 7],
  ["paper/85", "ink", 7],
  // Placeholders (every field sits on paper or card) and the search's "Ctrl K" hint.
  ["muted", "paper", 7],
  ["muted", "card", 7],
  // Search: a matched word, on a row and on the selected row.
  ["ink", "paper gold/20", 7],
  ["ink", "gold-soft gold/20", 7],
  // The primary buttons, the docs steps' numbers, the note callout's icon, the theme toggle.
  ["paper", "ink", 7],
  // The docs sidebar's current page and the search's selected row.
  ["ink", "gold-soft", 7],
  // StatusIcon, and the docs callout icons.
  ["paper", "ok", 7],
  ["paper", "warn", 7],
  ["paper", "bad", 7],
];

// The landing page and the app pages are light only: their ink and leather panels.
const LIGHT_ONLY: [string, string, number][] = [
  // The gold badge.
  ["leather", "gold-soft", 7],
  ["ink", "gold", 7],
  ["gold", "ink", 7],
  ["gold-soft", "ink", 7],
  // The gold button's hover, on a card.
  ["ink", "card gold/80", 7],
  // The landing panels: the testnet banner, the tricks.
  ["paper/80", "ink", 7],
  ["paper/75", "ink", 7],
  ["paper/75", "ink paper/10", 7],
  ["paper", "ink paper/10", 7],
  ["paper/75", "ink paper/5", 7],
  ["paper/80", "ink paper/5", 7],
  ["paper-2", "ink", 7],
  ["paper", "leather", 7],
  ["paper-2", "leather", 7],
  ["gold-soft", "leather", 7],
  ["paper-2", "leather ink/20", 7],
  ["paper", "leather ink/25", 7],
  // StatusIcon's "couldn't check".
  ["paper", "muted", 7],
];

const SHIKI = Object.keys(LIGHT).filter((k) => k.startsWith("shiki-") && k !== "shiki-background");

describe("text contrast, WCAG 2.2 AAA", () => {
  for (const [name, theme] of [
    ["light", LIGHT],
    ["dark", DARK],
  ] as const) {
    it.each(BOTH)(`${name}: %s on %s is at least %s:1`, (fg, bg, min) => {
      expect(check(theme, fg, bg)).toBeGreaterThanOrEqual(min);
    });
    it.each(SHIKI.flatMap((t) => SURFACES.map((s) => [t, s])))(`${name}: code color %s on %s is at least 7:1`, (fg, bg) => {
      expect(check(theme, fg, bg)).toBeGreaterThanOrEqual(7);
    });
  }
  it.each(LIGHT_ONLY)("light: %s on %s is at least %s:1", (fg, bg, min) => {
    expect(check(LIGHT, fg, bg)).toBeGreaterThanOrEqual(min);
  });
});

describe("non-text contrast, WCAG 2.2 1.4.11", () => {
  for (const [name, theme] of [
    ["light", LIGHT],
    ["dark", DARK],
  ] as const) {
    it.each(SURFACES.flatMap((s) => [["focus", s], ["field", s]]))(`${name}: %s on %s is at least 3:1`, (fg, bg) => {
      expect(check(theme, fg, bg)).toBeGreaterThanOrEqual(3);
    });
  }
});

describe("the test reads the stylesheet", () => {
  it("finds every token in both themes", () => {
    for (const t of [...TEXT, ...SURFACES, "gold", "gold-deep", "gold-soft"]) {
      expect(LIGHT[`color-${t}`]).toMatch(/^#/);
      expect(DARK[`color-${t}`]).toMatch(/^#/);
    }
    expect(DARK["color-paper"]).not.toBe(LIGHT["color-paper"]);
    expect(SHIKI.length).toBeGreaterThan(10);
  });
});
