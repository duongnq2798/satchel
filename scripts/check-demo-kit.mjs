// Checks the demo kit (docs/DEMO.md and docs/submission/) against the hackathon's limits: the
// "What did you build?" text fits the form, the X post fits one Premium post (25,000), tags the
// event and asks a question, the video script runs from 0:00 to 2:00 with no gap and no scene with
// more words than a speaker says in its time, and every page it opens, a satchelnft.xyz link or a
// path such as `/satchel/<id>/room`, is a route the app has (it reads no network, so it doesn't
// check that a satchel id was minted).
// Node 22 or later, no install. Usage: node scripts/check-demo-kit.mjs
import { existsSync, readdirSync, readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8").replace(/\r\n/g, "\n");
const results = [];
const check = (ok, claim, detail) => results.push({ ok, claim, detail });

// The form's "What did you build?" field takes 20 to 2,000 characters (HACKATHON.md, Submission API).
const idea = read("docs/submission/what-did-you-build.txt").trim();
const ideaLength = Math.max(idea.length, [...idea].length);
check(ideaLength >= 20 && ideaLength <= 2000, '"What did you build?" fits the form: 20 to 2,000 characters', `${ideaLength} characters`);

// X counts a link as 23 whatever its length, and a character outside the ranges below (CJK, emoji)
// as 2. A post holds 280, or 25,000 from a Premium account such as @satchelnfthq, which posted this
// text on 2026-11-12; X shows about the first 280 before "Show more". This count is close to X's
// (twitter-text's), not exact: anything shaped like a domain counts as a link here, so a dotted
// name longer than 23 characters that X doesn't link, such as a NEAR account, counts less here
// than on X. DEMO.md says to check X's own counter.
const SINGLE = [[0, 4351], [8192, 8205], [8208, 8223], [8242, 8247]];
const LINK = /(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*[^\s.,:;!?'")\]])?/gi;
function xLength(text) {
  const normal = text.normalize("NFC");
  const links = normal.match(LINK) ?? [];
  let weight = links.length * 23;
  for (const ch of normal.replace(LINK, "")) {
    const code = ch.codePointAt(0);
    weight += SINGLE.some(([a, b]) => code >= a && code <= b) ? 1 : 2;
  }
  return { weight, links };
}
const post = read("docs/submission/x-post.txt").trim();
const { weight, links } = xLength(post);
check(weight <= 25000, "The X post fits one Premium post: 25,000, a link counting 23", `${weight} of 25,000, links: ${links.join(", ")}`);
// The rules: say it was built at NEAR HACKATHON, tag @NEARProtocol and #NEARHackathon. A tag counts
// only as a whole tag: @NEARProtocolDev, #NEARHackathon2026 or a tag glued to the next one
// (#NEARHackathon#Web3, @NEARProtocol@NearLegion) is not the tag, for X either.
const NEEDED = {
  "NEAR HACKATHON": /NEAR HACKATHON/,
  "@NEARProtocol": /(?:^|\s)@NEARProtocol(?![A-Za-z0-9_@＠\p{L}\p{M}]|\/[A-Za-z]|:\/\/)/u,
  "#NEARHackathon": /(?:^|\s)#NEARHackathon(?![\p{L}\p{M}\p{N}_#＃‌‍️·・～〜]|:\/\/)/u,
  "satchelnft.xyz": /(?:^|\s)satchelnft\.xyz(?![\w.-]*\w)/,
  "github.com/duongnq2798/satchel": /(?:^|\s)github\.com\/duongnq2798\/satchel(?![\w/-])/,
};
for (const [name, pattern] of Object.entries(NEEDED)) {
  check(pattern.test(post), `The X post says ${name}`, pattern.test(post) ? "found" : "missing");
}
// HACKATHON.md's tips end with "Link the demo and public repo, and ask a genuine question or invite
// specific feedback." This post asks a question, so the check looks for a "?" outside its links.
const asks = post.replace(LINK, "").includes("?");
check(asks, "The X post asks a question", asks ? "found" : "no question mark outside a link");

// The video script: the table under "## The video", and the one under "## Optional scene", each read
// as GitHub renders it: the header below, its delimiter row, then rows up to the first line that
// isn't one. Every row has five cells, a time "m:ss–m:ss", a caption and a line to say. A table row
// left after the table ends (a blank line ends a table) is an error too, not skipped.
const demo = read("docs/DEMO.md");
const HEADER = "| Time | Screen | Do | Caption | Say |";
const malformed = [];
function table(title) {
  const start = demo.indexOf(`\n## ${title}`);
  if (start === -1) {
    malformed.push(`no "## ${title}" section`);
    return [];
  }
  const end = demo.indexOf("\n## ", start + 1);
  const lines = demo.slice(start + 1, end === -1 ? undefined : end).split("\n");
  const h = lines.findIndex((l) => l.trim() === HEADER);
  if (h === -1 || !/^\|(?:\s*-{3,}\s*\|){5}$/.test(lines[h + 1]?.trim() ?? "")) {
    malformed.push(`${title}: no "${HEADER}" header and delimiter row`);
    return [];
  }
  let i = h + 2;
  const rows = [];
  for (; i < lines.length && lines[i].trim().startsWith("|"); i++) {
    const cells = lines[i].trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim());
    const t = /^(\d+):([0-5]\d)–(\d+):([0-5]\d)$/.exec(cells[0]);
    if (cells.length !== 5 || !t || !cells[3] || !cells[4]) malformed.push(`${title}: ${cells[0] || lines[i].slice(0, 40)}`);
    rows.push(
      t
        ? { from: +t[1] * 60 + +t[2], to: +t[3] * 60 + +t[4], label: cells[0], say: cells[4] ?? "" }
        : { from: NaN, to: NaN, label: cells[0], say: "" },
    );
  }
  const stray = lines.slice(i).filter((l) => l.trim().startsWith("|")).length;
  if (stray) malformed.push(`${title}: ${stray} table row(s) after the table ends`);
  return rows;
}
const rows = table("The video");
// The optional scene replaces one scene of the 2:00 cut, so it takes that scene's time.
const optional = table("Optional scene");
for (const o of optional) if (!rows.some((r) => r.label === o.label)) malformed.push(`optional ${o.label}: not a time of the 2:00 cut`);
check(rows.length > 0 && malformed.length === 0, "docs/DEMO.md's script tables are well formed, every row with five cells and a m:ss–m:ss time", malformed.length ? `malformed: ${malformed.join("; ")}` : `${rows.length} scenes, ${optional.length} optional`);
const gaps = rows.filter((r, i) => !(r.from === (i === 0 ? 0 : rows[i - 1].to) && r.to > r.from)).map((r) => r.label);
check(rows.length > 0 && gaps.length === 0, "The scenes run from 0:00 without a gap or overlap", gaps.length ? `wrong: ${gaps.join(", ")}` : "contiguous");
const length = rows.at(-1)?.to ?? 0;
// 2:00 is the plan; X plays up to 2:20 for an account without Premium.
check(length === 120, "The video is 2:00 long", Number.isNaN(length) ? "unreadable" : `${Math.floor(length / 60)}:${String(length % 60).padStart(2, "0")}`);
// 150 words a minute is an unhurried voice-over: 2.5 words a second.
const rushed = [...rows, ...optional]
  .map((r) => ({ ...r, words: r.say.replace(/[*"“”`]/g, "").split(/\s+/).filter(Boolean).length }))
  .filter((r) => !(r.words <= (r.to - r.from) * 2.5))
  .map((r) => `${r.label}: ${r.words} words in ${r.to - r.from} s`);
check(rows.length > 0 && rushed.length === 0, "No scene has more than 2.5 spoken words a second", rushed.length ? rushed.join("; ") : "all fit");

// Every page the kit opens is a route under web/src/app: each satchelnft.xyz link, and each path
// written alone in backticks, as `/satchel/<id>/room` for a satchel the recorder picks. A dynamic
// folder takes only what its page takes: a satchel id is digits, or the placeholder `<id>`.
function routeExists(path) {
  let dir = new URL("web/src/app/", root);
  for (const segment of path.split("/").filter(Boolean)) {
    const entries = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
    const next = entries.find((e) => e.name === segment) ?? (/^(?:\d{1,19}|<id>)$/.test(segment) ? entries.find((e) => e.name === "[id]") : undefined);
    if (!next) return false;
    dir = new URL(`${next.name}/`, dir);
  }
  return existsSync(new URL("page.tsx", dir));
}
const linked = [...demo.matchAll(/satchelnft\.xyz(\/[\w\-/]*)?/gi)].map((m) => m[1]?.replace(/\/$/, "") || "/");
const named = [...demo.matchAll(/`(\/[\w\-/<>]*)`/g)].map((m) => m[1].replace(/\/$/, "") || "/");
const pages = [...new Set([...linked, ...named])];
const missing = pages.filter((p) => !routeExists(p));
check(pages.length > 0 && missing.length === 0, "Every page docs/DEMO.md opens is a route the app has", missing.length ? `missing: ${missing.join(", ")}` : pages.join(", "));

for (const r of results) console.log(`${r.ok ? "[PASS]" : "[FAIL]"} ${r.claim}\n       ${r.detail}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} of ${results.length} checks hold`);
process.exit(failed ? 1 : 0);
