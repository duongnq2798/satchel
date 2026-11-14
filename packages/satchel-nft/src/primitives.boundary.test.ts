import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The primitives (satchel-nft/near-rpc and the subpaths after it) import only each other and the
// package's three dependencies, never Satchel's own modules, and stay browser-safe. A later split
// into a package of their own is then a file move.

/** Each primitive source, and what it may import: an exact specifier, or a prefix ending in "/". */
const ALLOWED: Record<string, string[]> = {
  "base58.ts": ["@noble/hashes/utils"],
  "mpc-kdf.ts": ["./base58.js", "@noble/curves/", "@noble/hashes/"],
  "near-rpc.ts": ["./base58.js", "@noble/hashes/"],
  "nep413.ts": ["./base58.js", "@noble/curves/", "@noble/hashes/"],
  "chain-signatures.ts": ["./near-rpc.js", "./mpc-kdf.js", "./base58.js", "@noble/", "viem"],
  "nep641.ts": ["./near-rpc.js", "./nep413.js", "./base58.js", "@noble/"],
  "account-proof.ts": ["./near-rpc.js", "./nep413.js", "./nep641.js", "./base58.js", "@noble/"],
  "account-audit.ts": ["./near-rpc.js", "./base58.js", "@noble/"],
  "sputnik.ts": ["./near-rpc.js", "./base58.js"],
};

/** The ones that have landed: this phase's, and nep413.ts, which was already here. */
const LANDED = ["base58.ts", "mpc-kdf.ts", "near-rpc.ts", "nep413.ts"];

/** Node-only or ambient-environment tokens no primitive source may contain, comments included. */
const FORBIDDEN = ["node:", "process.", "Buffer", "require("];

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { exports: unknown };
const source = (file: string) => readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
const present = Object.keys(ALLOWED).filter((file) => existsSync(new URL(`./${file}`, import.meta.url)));

/**
 * Every module specifier in `source`: `from "…"`, `import "…"` and `import("…")`, outside comments, so a usage
 * example in a comment is not an import. (The token check below reads comments too.)
 */
function specifiers(source: string): string[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const found: string[] = [];
  for (const re of [/\bfrom\s*["']([^"']+)["']/g, /\bimport\s*["']([^"']+)["']/g, /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g]) {
    for (const match of text.matchAll(re)) found.push(match[1]);
  }
  return found;
}

const allowed = (file: string, spec: string) =>
  ALLOWED[file].some((rule) => (rule.endsWith("/") ? spec.startsWith(rule) : spec === rule));

describe("primitive sources", () => {
  it("include every source this phase landed", () => {
    expect(present).toEqual(expect.arrayContaining(LANDED));
  });

  for (const file of present) {
    it(`${file} imports only what the boundary table allows`, () => {
      const specs = specifiers(source(file));
      expect(specs.filter((spec) => !allowed(file, spec))).toEqual([]);
    });

    it(`${file} has no Node-only token`, () => {
      const text = source(file);
      expect(FORBIDDEN.filter((token) => text.includes(token))).toEqual([]);
    });
  }

  it("nep413.ts takes base58 from base58.ts, not evm.ts", () => {
    expect(specifiers(source("nep413.ts"))).not.toContain("./evm.js");
  });

  it("form no import cycle", () => {
    const local = (file: string) =>
      specifiers(source(file))
        .filter((spec) => spec.startsWith("./"))
        .map((spec) => spec.slice(2).replace(/\.js$/, ".ts"));
    const visiting = new Set<string>();
    const done = new Set<string>();
    const cycles: string[] = [];
    const visit = (file: string, trail: string[]) => {
      if (done.has(file)) return;
      if (visiting.has(file)) {
        cycles.push([...trail, file].join(" -> "));
        return;
      }
      visiting.add(file);
      for (const next of local(file)) visit(next, [...trail, file]);
      visiting.delete(file);
      done.add(file);
    };
    for (const file of present) visit(file, []);
    expect(cycles).toEqual([]);
  });

  it("are not re-exported from the package root, which keeps its names", () => {
    const index = source("index.ts");
    for (const file of ["near-rpc", "mpc-kdf", "base58", "chain-signatures", "account-proof", "nep641", "account-audit", "sputnik"]) {
      expect(index).not.toContain(`./${file}.js`);
    }
  });

  it("each have a subpath export once landed, and the root export is unchanged", () => {
    const exports = pkg.exports as Record<string, unknown>;
    expect(exports["."]).toEqual({ types: "./dist/index.d.ts", default: "./dist/index.js" });
    expect(exports["./package.json"]).toBe("./package.json");
    expect(exports["./near-rpc"]).toEqual({ types: "./dist/near-rpc.d.ts", default: "./dist/near-rpc.js" });
    // Every subpath export names a flat dist file, the only kind package.yml lets into the tarball.
    for (const [key, value] of Object.entries(exports)) {
      if (key === "." || key === "./package.json") continue;
      const name = key.slice(2);
      expect(existsSync(new URL(`./${name}.ts`, import.meta.url))).toBe(true);
      expect(value).toEqual({ types: `./dist/${name}.d.ts`, default: `./dist/${name}.js` });
      expect(name).toMatch(/^[a-z0-9-]+$/);
    }
  });
});
