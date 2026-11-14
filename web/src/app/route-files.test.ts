import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * A loading.tsx doesn't wrap its own segment's layout, and the status is fixed once its fallback
 * renders: so each id check sits in a layout above every fallback, and the server-rendered notes
 * sit in a layout beside it, never in a page inside it.
 */
const file = (path: string) => new URL(`./${path}`, import.meta.url);
const read = (path: string) => readFileSync(file(path), "utf8");

/** The file a one-line `export { default } from "…"` points to, relative to `app/`. */
function reexported(path: string): string {
  const from = read(path).match(/export \{ default \} from "([^"]+)"/)?.[1];
  expect(from, `${path} re-exports a default`).toBeDefined();
  return new URL(`${from}.tsx`, file(path)).pathname.replace(/^.*\/src\/app\//, "");
}

const PAGES = [
  "satchel/[id]/(token)/page.tsx",
  "satchel/[id]/room/page.tsx",
  "mainnet/satchel/[id]/(token)/page.tsx",
  "dao/[id]/page.tsx",
  "mainnet/dao/[id]/page.tsx",
];

describe("route files", () => {
  it("checks each id in a layout above the fallbacks, and in no page", () => {
    expect(read("satchel/[id]/layout.tsx")).toMatch(/if \(!\/\^\\d\{1,19\}\$\/\.test\(id\)\) notFound\(\);/);
    expect(reexported("mainnet/satchel/[id]/layout.tsx")).toBe("satchel/[id]/layout.tsx");
    for (const path of ["dao/[id]/layout.tsx", "mainnet/dao/[id]/layout.tsx"]) {
      expect(read(path)).toContain("if (!isAccountId(id)) notFound();");
    }
    for (const path of PAGES) expect(read(path), path).not.toContain("notFound");
  });

  it("gives every dynamic page a fallback, the mainnet ones the testnet's own", () => {
    for (const path of ["satchel/[id]/(token)/loading.tsx", "satchel/[id]/room/loading.tsx", "dao/[id]/loading.tsx"]) {
      expect(read(path), path).toContain('data-loading="route"');
    }
    expect(reexported("mainnet/satchel/[id]/(token)/loading.tsx")).toBe("satchel/[id]/(token)/loading.tsx");
    expect(reexported("mainnet/satchel/[id]/room/loading.tsx")).toBe("satchel/[id]/room/loading.tsx");
    expect(reexported("mainnet/dao/[id]/loading.tsx")).toBe("dao/[id]/loading.tsx");
    // The other routes are prerendered: a root fallback would only put a wrongly shaped screen in front of them.
    expect(existsSync(file("loading.tsx"))).toBe(false);
  });

  it("renders the notes and #3's deed beside the fallback, not inside it", () => {
    expect(read("satchel/[id]/(token)/layout.tsx")).toContain("tokenPageNote(TESTNET, id)");
    expect(read("mainnet/satchel/[id]/(token)/layout.tsx")).toContain("tokenPageNote(MAINNET, id)");
    expect(read("dao/[id]/layout.tsx")).toContain("boardPageNote(TESTNET, id)");
    expect(read("mainnet/dao/[id]/layout.tsx")).toContain("boardPageNote(MAINNET, id)");
    for (const path of PAGES) expect(read(path), path).not.toMatch(/tokenPageNote|boardPageNote|DeedOfSale/);
  });
});
