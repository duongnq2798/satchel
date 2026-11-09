/**
 * Docs search: an index built once at build time (/docs/search-index.json) and searched in the
 * browser. Every term of the query must appear, as a word or the start of one; a match in a page's
 * title outweighs one in a heading, which outweighs one in the text.
 */

export interface SearchEntry {
  /** /docs/... with the heading's #id, if any. */
  href: string;
  page: string;
  section: string;
  /** The heading this entry is under, "" for the page's lead. */
  heading: string;
  text: string;
}

export interface SearchHit {
  entry: SearchEntry;
  score: number;
  /** A window of the text around the first match. */
  snippet: string;
}

export function terms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}_.#-]+/u)
    .map((t) => t.replace(/^[.#-]+|[.#-]+$/g, ""))
    .filter((t) => t.length > 0)
    .slice(0, 8);
}

/** An English word without its plural or tense ending, for a second try when the word itself isn't found. */
export function stem(term: string): string {
  if (term.length < 5) return term;
  return term.replace(/(ing|ed|es|s)$/, "");
}

/** How well `term` matches `text`: 3 a whole word, 2 the start of a word, 1 anywhere, 0 not at all. */
function fit(text: string, term: string): number {
  let at = text.indexOf(term);
  if (at === -1) return 0;
  let best = 1;
  while (at !== -1 && best < 3) {
    const before = at === 0 ? "" : text[at - 1];
    const after = text[at + term.length] ?? "";
    const startsWord = !/[\p{L}\p{N}]/u.test(before);
    if (startsWord) best = Math.max(best, /[\p{L}\p{N}]/u.test(after) ? 2 : 3);
    at = text.indexOf(term, at + 1);
  }
  return best;
}

export function search(index: SearchEntry[], query: string, limit = 12): SearchHit[] {
  const want = terms(query);
  if (want.length === 0) return [];
  const hits: SearchHit[] = [];
  for (const entry of index) {
    const page = entry.page.toLowerCase();
    const heading = entry.heading.toLowerCase();
    const text = entry.text.toLowerCase();
    let score = 0;
    let all = true;
    for (const term of want) {
      let s = fit(page, term) * 10 + fit(heading, term) * 6 + fit(text, term);
      // "revoked" finds "revoke", "approvals" finds "approval", at a lower score.
      const root = stem(term);
      if (s === 0 && root !== term) s = (fit(page, root) * 10 + fit(heading, root) * 6 + fit(text, root)) / 2;
      if (s === 0) {
        all = false;
        break;
      }
      score += s;
    }
    if (!all) continue;
    // The page's own entry ranks above its sections when the title is what matched.
    if (entry.heading === "") score += 2;
    hits.push({ entry, score, snippet: snippet(entry.text, want) });
  }
  hits.sort((a, b) => b.score - a.score || a.entry.href.localeCompare(b.entry.href));
  // One page should not fill the list: at most three hits from each.
  const perPage = new Map<string, number>();
  return hits
    .filter((h) => {
      const key = h.entry.href.split("#")[0];
      const n = perPage.get(key) ?? 0;
      perPage.set(key, n + 1);
      return n < 3;
    })
    .slice(0, limit);
}

export function snippet(text: string, want: string[], width = 160): string {
  const lower = text.toLowerCase();
  const at = want.map((t) => lower.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, at - 40);
  const cut = text.slice(start, start + width).trim();
  return `${start > 0 ? "…" : ""}${cut}${start + width < text.length ? "…" : ""}`;
}

/** `text` split into pieces, with the parts that match a term marked, for highlighting. */
export function highlight(text: string, want: string[]): { text: string; match: boolean }[] {
  if (want.length === 0) return [{ text, match: false }];
  const escaped = want.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = text.split(new RegExp(`(${escaped.join("|")})`, "gi"));
  return parts.filter((p) => p !== "").map((p) => ({ text: p, match: want.includes(p.toLowerCase()) }));
}
