import { REPO_URL } from "satchel-nft";
import { docHref, pageForRepoFile } from "./nav";

/**
 * The remark plugins every docs page compiles with. They give each heading the id its table of
 * contents and its links use, collect each section's text for search, pass a code block's title
 * through to the code component, and point a repository file's relative links at the right place.
 */

/** The parts of an mdast node these plugins read or write. */
export interface MdNode {
  type: string;
  children?: MdNode[];
  value?: string;
  depth?: number;
  url?: string;
  lang?: string | null;
  meta?: string | null;
  data?: { hProperties?: Record<string, unknown> };
}

/** Plain text of a node, as a reader would see it: inline code included, markup dropped. */
export function textOf(node: MdNode): string {
  if (node.type === "text" || node.type === "inlineCode" || node.type === "code") return node.value ?? "";
  if (!node.children) return "";
  return node.children.map(textOf).join(INLINE.has(node.type) ? "" : " ");
}

/** Nodes whose children run on in one line of text; any other node's children are separate blocks. */
const INLINE = new Set(["paragraph", "heading", "emphasis", "strong", "link", "delete", "tableCell", "mdxJsxTextElement"]);

/** GitHub's heading ids: lowercase, punctuation dropped, spaces to hyphens, repeats numbered. */
export function slugger() {
  const seen = new Map<string, number>();
  return (text: string): string => {
    const base =
      text
        .toLowerCase()
        .trim()
        .replace(/[^\p{L}\p{N}\s_-]/gu, "")
        .replace(/\s/g, "-") || "section";
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  };
}

export interface TocEntry {
  depth: 2 | 3;
  text: string;
  id: string;
}

export interface SearchSection {
  /** "" for the text before the first heading. */
  heading: string;
  id: string;
  text: string;
}

export interface Collected {
  toc: TocEntry[];
  sections: SearchSection[];
  /** Every id on the page, for checking links into it. */
  ids: string[];
  /** Every link target on the page, as written. */
  links: string[];
  /** Every table's accessible name, in page order. */
  tables: string[];
}

export function emptyCollected(): Collected {
  return { toc: [], sections: [], ids: [], links: [], tables: [] };
}

/** Ids on headings, the table of contents, the search sections and the links, in one pass. */
export function remarkCollect(out: Collected) {
  return () => (tree: MdNode) => {
    const slug = slugger();
    let current: SearchSection = { heading: "", id: "", text: "" };
    out.sections.push(current);
    for (const node of tree.children ?? []) {
      if (node.type === "heading") {
        const text = textOf(node).trim();
        const id = slug(text);
        node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id } };
        out.ids.push(id);
        if (node.depth === 2 || node.depth === 3) out.toc.push({ depth: node.depth, text, id });
        // The page's own title is its h1 from the nav; a rendered file's h1 is skipped there.
        if (node.depth !== 1) {
          current = { heading: text, id, text: "" };
          out.sections.push(current);
        }
        continue;
      }
      const text = textOf(node).replace(/\s+/g, " ").trim();
      if (text) current.text = current.text ? `${current.text} ${text}` : text;
    }
    out.sections.splice(0, out.sections.length, ...out.sections.filter((s) => s.text || s.heading));
    walk(tree, (node) => {
      if ((node.type === "link" || node.type === "definition") && node.url) out.links.push(node.url);
    });
  };
}

/**
 * A table is a scrollable region, and a screen reader lists regions by name: each table is named
 * for the heading above it (its header row when none), numbered when one name would repeat.
 */
export function remarkTableNames(out: Collected) {
  return () => (tree: MdNode) => {
    let heading = "";
    const tables: { node: MdNode; base: string }[] = [];
    walk(tree, (node) => {
      if (node.type === "heading" && node.depth !== 1) heading = textOf(node).trim();
      if (node.type !== "table") return;
      const header = (node.children?.[0]?.children ?? []).map((cell) => textOf(cell).trim()).filter(Boolean).join(", ");
      tables.push({ node, base: heading || header });
    });
    for (const { node, base } of tables) {
      const same = tables.filter((t) => t.base === base);
      const name = same.length > 1 ? `${base} (${same.findIndex((t) => t.node === node) + 1} of ${same.length})` : base;
      node.data = { ...node.data, hProperties: { ...node.data?.hProperties, dataName: name } };
      out.tables.push(name);
    }
  };
}

/** ```bash title="Install" → the code element gets data-title="Install". */
export function remarkCodeMeta() {
  return (tree: MdNode) => {
    walk(tree, (node) => {
      if (node.type !== "code" || !node.meta) return;
      const title = /title="([^"]*)"/.exec(node.meta)?.[1];
      if (title) node.data = { ...node.data, hProperties: { ...node.data?.hProperties, dataTitle: title } };
    });
  };
}

/**
 * A repository file rendered as a page links to other files by relative path. A link to a file
 * that is also a docs page goes to that page; any other goes to the file on GitHub.
 */
export function remarkRepoLinks(repoFile: string) {
  return () => (tree: MdNode) => {
    walk(tree, (node) => {
      if ((node.type !== "link" && node.type !== "definition") || !node.url) return;
      node.url = resolveRepoLink(repoFile, node.url);
    });
  };
}

export function resolveRepoLink(repoFile: string, url: string): string {
  if (/^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith("#") || url.startsWith("/")) return url;
  const [pathPart, hash] = url.split("#");
  const dir = repoFile.split("/").slice(0, -1);
  for (const part of pathPart.split("/")) {
    if (part === "..") dir.pop();
    else if (part !== "." && part !== "") dir.push(part);
  }
  const target = dir.join("/");
  const page = pageForRepoFile(target);
  if (page) return `${docHref(page.slug)}${hash ? `#${hash}` : ""}`;
  // A folder opens as a tree, a file as a blob.
  const kind = /\.[a-z\d]+$/i.test(target) ? "blob" : "tree";
  return `${REPO_URL}/${kind}/main/${target}${hash ? `#${hash}` : ""}`;
}

function walk(node: MdNode, visit: (node: MdNode) => void) {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}
