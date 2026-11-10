import { readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadDoc, sourceFile } from "./load";
import { resolveRepoLink, slugger, textOf } from "./markdown";
import { DOCS, PAGES, findPage, neighbours } from "./nav";
import { highlight, search, stem, terms } from "./search";

/** Paths of the app outside the docs that a docs page may link to. */
const APP_ROUTES = [/^\/$/, /^\/(mainnet\/?)?$/, /^\/(mainnet\/)?(market|satchels|verify)$/, /^\/(mainnet\/)?satchel\/\d+$/, /^\/llms\.txt$/];

describe("the docs' structure", () => {
  it("gives every page a unique slug, a title and a short description", () => {
    const slugs = PAGES.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const p of PAGES) {
      expect(p.slug).toMatch(/^([a-z\d]+(-[a-z\d]+)*(\/[a-z\d]+(-[a-z\d]+)*)*)?$/);
      expect(p.title.length).toBeGreaterThan(3);
      expect(p.description.length, p.slug).toBeLessThanOrEqual(220);
      expect(p.description.endsWith("."), p.slug).toBe(true);
    }
    expect(DOCS.every((s) => s.pages.length > 0)).toBe(true);
  });

  it("has a source file for every page, and no .mdx file without a page", async () => {
    const root = path.join(process.cwd(), "content", "docs", "en");
    const files: string[] = [];
    const walk = async (dir: string) => {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        if (e.isDirectory()) await walk(path.join(dir, e.name));
        else if (e.name.endsWith(".mdx")) files.push(path.relative(root, path.join(dir, e.name)).split(path.sep).join("/"));
      }
    };
    await walk(root);
    const expected = PAGES.filter((p) => !p.repoFile).map((p) => `${p.slug === "" ? "index" : p.slug}.mdx`);
    expect(files.sort()).toEqual(expected.sort());
    for (const p of PAGES.filter((p) => p.repoFile)) expect(sourceFile(p)).toContain(p.repoFile!.split("/").pop());
  });

  it("orders pages so previous and next walk through every one", () => {
    expect(neighbours("").prev).toBeUndefined();
    expect(neighbours("").next?.slug).toBe(PAGES[1].slug);
    expect(neighbours(PAGES.at(-1)!.slug).next).toBeUndefined();
  });
});

describe("every page", async () => {
  const docs = await Promise.all(PAGES.map((p) => loadDoc(p.slug)));

  it("compiles, with a table of contents and searchable sections", () => {
    for (const [i, doc] of docs.entries()) {
      expect(doc, PAGES[i].slug).not.toBeNull();
      expect(doc!.sections.length, PAGES[i].slug).toBeGreaterThan(0);
      expect(new Set(doc!.ids).size, `${PAGES[i].slug}: two headings with one id`).toBe(doc!.ids.length);
    }
  });

  it("links only to pages and headings that exist", () => {
    const broken: string[] = [];
    for (const doc of docs) {
      for (const link of doc!.links) {
        if (/^(https?:|mailto:)/.test(link)) continue;
        const [pathPart, hash] = link.split("#");
        if (pathPart === "") {
          if (hash && !doc!.ids.includes(hash)) broken.push(`${doc!.page.href}: ${link}`);
          continue;
        }
        if (pathPart === "/docs" || pathPart.startsWith("/docs/")) {
          const target = findPage(pathPart.replace(/^\/docs\/?/, ""));
          const targetDoc = target && docs.find((d) => d!.page.slug === target.slug);
          if (!targetDoc || (hash && !targetDoc.ids.includes(hash))) broken.push(`${doc!.page.href}: ${link}`);
          continue;
        }
        if (!APP_ROUTES.some((r) => r.test(pathPart))) broken.push(`${doc!.page.href}: ${link}`);
      }
    }
    expect(broken).toEqual([]);
  });
});

describe("headings and links", () => {
  it("slugs headings as GitHub does, numbering repeats", () => {
    const slug = slugger();
    expect(slug("What `satchel-nft verify` prints")).toBe("what-satchel-nft-verify-prints");
    expect(slug("Check 1: the contract")).toBe("check-1-the-contract");
    expect(slug("Check 1: the contract")).toBe("check-1-the-contract-1");
  });

  it("reads a node's text with inline code and keeps blocks apart", () => {
    const node = {
      type: "root",
      children: [
        { type: "paragraph", children: [{ type: "text", value: "Run " }, { type: "inlineCode", value: "verify" }] },
        { type: "paragraph", children: [{ type: "text", value: "then wait." }] },
      ],
    };
    expect(textOf(node)).toBe("Run verify then wait.");
  });

  it("sends a repository file's links to its docs page or to GitHub", () => {
    expect(resolveRepoLink("docs/THREAT_MODEL.md", "../AGENTS.md")).toBe("/docs/security/check-every-claim");
    expect(resolveRepoLink("AGENTS.md", "docs/THREAT_MODEL.md#out-of-scope")).toBe("/docs/security/threat-model#out-of-scope");
    expect(resolveRepoLink("AGENTS.md", "README.md#limits-stated-plainly")).toBe(
      "https://github.com/duongnq2798/satchel/blob/main/README.md#limits-stated-plainly",
    );
    expect(resolveRepoLink("AGENTS.md", "deployments/")).toBe("https://github.com/duongnq2798/satchel/tree/main/deployments");
    expect(resolveRepoLink("AGENTS.md", "https://satchelnft.xyz")).toBe("https://satchelnft.xyz");
    expect(resolveRepoLink("AGENTS.md", "#check-the-claims")).toBe("#check-the-claims");
  });
});

describe("search", () => {
  const index = [
    { href: "/docs/developers/cli", page: "CLI reference", section: "Developers", heading: "", text: "Every satchel-nft command." },
    { href: "/docs/developers/cli#exit-codes", page: "CLI reference", section: "Developers", heading: "Exit codes", text: "3 means the outcome is unknown." },
    { href: "/docs/guides/buy", page: "Buy a satchel", section: "Use the app", heading: "", text: "Check the exit code before you buy." },
  ];

  it("needs every term, and ranks a heading match above a text match", () => {
    const hits = search(index, "exit code");
    expect(hits.map((h) => h.entry.href)).toEqual(["/docs/developers/cli#exit-codes", "/docs/guides/buy"]);
    expect(search(index, "exit zebra")).toEqual([]);
    expect(search(index, "  ")).toEqual([]);
  });

  it("matches the start of a word and keeps commands whole", () => {
    expect(terms("satchel-nft verify")).toEqual(["satchel-nft", "verify"]);
    expect(search(index, "refer")[0].entry.href).toBe("/docs/developers/cli");
  });

  it("finds a word through its stem when the word itself isn't there", () => {
    expect(stem("revoked")).toBe("revok");
    expect(stem("approvals")).toBe("approval");
    expect(stem("uses")).toBe("uses");
    expect(search(index, "outcomes")[0].entry.href).toBe("/docs/developers/cli#exit-codes");
  });

  it("marks the matching parts of a snippet", () => {
    expect(highlight("Exit codes", ["exit"])).toEqual([
      { text: "Exit", match: true },
      { text: " codes", match: false },
    ]);
  });
});
