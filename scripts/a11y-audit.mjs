// Audits the site's pages for WCAG 2.2: axe-core's stable rules (A, AA, AAA and best practices; not
// its experimental ones) on each app route, light only and with no wallet connected, and on every
// docs page in both themes, then what axe doesn't measure. That is 1.4.8's line height, paragraph
// spacing and characters per line (in paragraphs, list items and table cells over 80 characters),
// text past its table cell, text under 12px, heading levels, and clipped text or a page that scrolls
// sideways under 1.4.12's text spacing, at the browser's text size at 200% (1.4.4), and at 640 and
// 320 px wide (1.4.10). It only reads the pages. Written for the 2026-11-12 typography change; the
// README quotes its results.
//
// Node 22 or later, Edge or Chrome, and two packages the repository doesn't install:
//   npm install --prefix .a11y --no-save playwright-core@1.63.0 axe-core@4.13.0
// Usage:
//   node scripts/a11y-audit.mjs <site> <out.json> [path filter] [shard k/n]
//   node scripts/a11y-audit.mjs --summary <out.md> <out.json>...
// A shard "k/n", k from 0 to n-1, runs every n-th route from the k-th, so n processes started with
// 0/n to (n-1)/n split the 93 runs. A11Y_DEPS names another folder for the packages, A11Y_BROWSER a
// Playwright channel ("chrome").
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

if (process.argv[2] === "--summary") {
  summary(process.argv[3], process.argv.slice(4));
  process.exit(0);
}

const require = createRequire(path.resolve(process.env.A11Y_DEPS ?? ".a11y", "package.json"));
const { chromium } = require("playwright-core");
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const SITE = (process.argv[2] ?? "https://satchelnft.xyz").replace(/\/$/, "");
const OUT = process.argv[3] ?? "a11y-audit.json";
const FILTER = process.argv[4] ?? "";
const [K, N] = (process.argv[5] ?? "0/1").split("/").map(Number);
if (!(Number.isInteger(K) && Number.isInteger(N) && K >= 0 && K < N)) {
  console.error("usage: node scripts/a11y-audit.mjs <site> <out.json> [path filter] [shard k/n, k from 0 to n-1]");
  process.exit(2);
}

const APP = [
  "/", "/market", "/satchels", "/verify", "/satchel/4", "/satchel/5", "/satchel/9", "/satchel/4/room",
  "/mainnet", "/mainnet/market", "/mainnet/satchels", "/mainnet/verify", "/mainnet/satchel/2", "/mainnet/satchel/2/room",
  "/no-such-page",
];
const index = await (await fetch(`${SITE}/docs/search-index.json`)).json();
const DOCS = [...new Set(index.map((x) => x.href.split("#")[0]))];
const ROUTES = [...APP.map((p) => ({ path: p, theme: "light" })), ...DOCS.flatMap((p) => [{ path: p, theme: "light" }, { path: p, theme: "dark" }])]
  .filter((r) => r.path.includes(FILTER))
  .filter((_, i) => i % N === K);
if (ROUTES.length === 0) {
  console.error(`No route matches "${FILTER}" in shard ${K}/${N}.`);
  process.exit(2);
}

const browser = await chromium.launch({ channel: process.env.A11Y_BROWSER ?? (process.platform === "win32" ? "msedge" : "chrome"), headless: true });

async function newPage(theme, width, height = 900) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce", colorScheme: "light" });
  // The docs' theme toggle keeps its choice here; the app pages are light only.
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem("satchel-docs-theme", t);
    } catch {}
  }, theme);
  const page = await ctx.newPage();
  page.setDefaultTimeout(60_000);
  return { ctx, page };
}

async function load(page, route) {
  const res = await page.goto(SITE + route, { waitUntil: "networkidle", timeout: 120_000 }).catch((e) => ({ status: () => String(e.message).slice(0, 80) }));
  await page.waitForTimeout(2500);
  // Open what a reader can open, so axe sees it: the FAQ's answers and other details.
  await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
  await page.waitForTimeout(300);
  return res?.status?.();
}

async function axe(page, context = "document") {
  await page.addScriptTag({ content: AXE });
  return page.evaluate(async (ctx) => {
    const r = await window.axe.run(ctx === "document" ? document : document.querySelector(ctx), {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag2aaa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] },
      resultTypes: ["violations", "incomplete"],
    });
    const slim = (list) =>
      list.map((v) => ({
        id: v.id,
        tags: v.tags.filter((t) => t.startsWith("wcag")),
        help: v.help,
        nodes: v.nodes.map((n) => ({
          target: n.target.join(" "),
          html: n.html.slice(0, 160),
          data: (n.any[0] || n.all[0] || n.none[0] || {}).data || null,
          summary: (n.failureSummary || "").slice(0, 300),
        })),
      }));
    // axe can't always find the color behind text; those are listed for a check by hand.
    return { violations: slim(r.violations), incomplete: slim(r.incomplete.filter((v) => /contrast/.test(v.id))) };
  }, context);
}

// Text its box cuts off: overflow hidden or clip, or an ellipsis, with content larger than the box.
const CLIPPED = () => {
  const out = [];
  for (const el of document.querySelectorAll("body *")) {
    if (!el.textContent.trim() || el.children.length > 8) continue;
    const cs = getComputedStyle(el);
    const hides = /(hidden|clip)/.test(cs.overflowX + cs.overflowY) || cs.textOverflow === "ellipsis";
    if (!hides || cs.display === "none" || el.closest("[aria-hidden=true], .sr-only, pre, code")) continue;
    if (el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2) {
      out.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 80), text: el.textContent.trim().slice(0, 60), sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight });
    }
  }
  return out.slice(0, 15);
};

// Whether the page scrolls sideways, and what sticks out. Code and tables scroll in their own box.
const SCROLLX = () => {
  const w = document.documentElement.clientWidth;
  const wide = [];
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.width && r.right > w + 1 && !el.closest("pre, table") && getComputedStyle(el).position !== "fixed") {
      wide.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 80), right: Math.round(r.right), text: el.textContent.trim().slice(0, 40) });
    }
  }
  return { scrollWidth: document.documentElement.scrollWidth, width: w, wide: wide.slice(0, 8) };
};

// 1.4.8 (line height, paragraph spacing, characters per line, justified text), text past its table
// cell, text under 12px and the headings.
const PRESENTATION = () => {
  const blocks = [...document.querySelectorAll("main p, main li, main dd, main blockquote, main td")].filter((el) => {
    const t = el.innerText?.trim() || "";
    // A block that holds text itself: a list row whose text sits in a paragraph is measured there.
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 20);
    return t.length > 80 && own && getComputedStyle(el).display !== "none" && el.getClientRects().length;
  });
  const canvas = document.createElement("canvas").getContext("2d");
  const rows = blocks.map((el) => {
    const cs = getComputedStyle(el);
    const fs = parseFloat(cs.fontSize);
    const lh = cs.lineHeight === "normal" ? fs * 1.2 : parseFloat(cs.lineHeight);
    canvas.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const sample = el.innerText.trim().slice(0, 400);
    const avg = canvas.measureText(sample).width / sample.length;
    const width = el.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const next = el.nextElementSibling;
    const gap = next ? next.getBoundingClientRect().top - el.getBoundingClientRect().bottom : null;
    // Two paragraphs side by side in a grid or flex row are not one after the other.
    const paragraphs = gap !== null && gap >= -1 && el.tagName === "P" && next.tagName === "P";
    return {
      tag: el.tagName.toLowerCase(),
      cls: String(el.className).slice(0, 70),
      text: sample.slice(0, 50),
      fontSize: fs,
      lineHeight: +(lh / fs).toFixed(2),
      cpl: Math.round(width / avg),
      align: cs.textAlign,
      // From one line's top to the next paragraph's first line top, in font sizes. 1.4.8 asks for
      // spacing of 1.5 times the line spacing, 2.25 at a line height of 1.5; this asks for 2.5.
      pitch: paragraphs ? +((gap + lh) / fs).toFixed(2) : null,
    };
  });
  const cellOverflow = [...document.querySelectorAll("main td, main th")].flatMap((cell) => {
    const edge = cell.getBoundingClientRect().right;
    const over = [...cell.querySelectorAll("*")].find((el) => !el.closest(".sr-only") && el.getBoundingClientRect().right > edge + 1);
    return over ? [{ tag: over.tagName.toLowerCase(), text: over.textContent.trim().slice(0, 50), by: Math.round(over.getBoundingClientRect().right - edge) }] : [];
  });
  const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")]
    .filter((h) => h.getClientRects().length)
    .map((h) => {
      const cs = getComputedStyle(h);
      return { level: +h.tagName[1], text: h.textContent.trim().slice(0, 50), size: parseFloat(cs.fontSize), weight: cs.fontWeight, lh: +(parseFloat(cs.lineHeight) / parseFloat(cs.fontSize) || 0).toFixed(2) };
    });
  const skips = headings.flatMap((h, i) => (i && h.level > headings[i - 1].level + 1 ? [`${headings[i - 1].level}->${h.level} at "${h.text}"`] : []));
  const small = [...document.querySelectorAll("main *, header *, footer *")]
    .filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(el).fontSize) < 12 && el.getClientRects().length)
    .map((el) => ({ tag: el.tagName.toLowerCase(), size: parseFloat(getComputedStyle(el).fontSize), cls: String(el.className).slice(0, 60), text: el.textContent.trim().slice(0, 40) }));
  return {
    lowLineHeight: rows.filter((r) => r.lineHeight < 1.5).slice(0, 12),
    longLines: rows.filter((r) => r.cpl > 80).slice(0, 12),
    tightParagraphs: rows.filter((r) => r.pitch !== null && r.pitch < 2.5).slice(0, 8),
    justified: rows.filter((r) => r.align === "justify").slice(0, 5),
    cellOverflow: cellOverflow.slice(0, 12),
    blocks: rows.length,
    headings,
    skips,
    h1s: headings.filter((h) => h.level === 1).length,
    smallText: small.slice(0, 15),
  };
};

// WCAG 1.4.12's text spacing, applied over the page's own styles.
const SPACING_CSS = "*{line-height:1.5!important;letter-spacing:0.12em!important;word-spacing:0.16em!important}p{margin-bottom:2em!important}";

const results = [];
for (const r of ROUTES) {
  const row = { ...r };
  const run = async () => {
    {
      const { ctx, page } = await newPage(r.theme, 1280);
      row.status = await load(page, r.path);
      row.htmlTheme = await page.evaluate(() => document.documentElement.dataset.theme || "light");
      row.axe = await axe(page);
      if (r.path === "/") {
        // Each tab of "Try to cheat the buyer." shows a different panel.
        row.tabs = [];
        for (const t of await page.locator("[role=tab]").all()) {
          await t.click();
          await page.waitForTimeout(600);
          const a = await axe(page, "#trick-panel");
          row.tabs.push({ tab: (await t.textContent()).trim(), violations: a.violations, incomplete: a.incomplete });
        }
      }
      row.presentation = await page.evaluate(PRESENTATION);
      await page.addStyleTag({ content: SPACING_CSS });
      await page.waitForTimeout(300);
      row.textSpacing = { clipped: await page.evaluate(CLIPPED), scroll: await page.evaluate(SCROLLX) };
      await ctx.close();
    }
    {
      // The browser's own text size at 200%, so rem and em media queries respond as they would.
      const { ctx, page } = await newPage(r.theme, 1280);
      const cdp = await ctx.newCDPSession(page);
      await cdp.send("Page.enable");
      await cdp.send("Page.setFontSizes", { fontSizes: { standard: 32, fixed: 26 } });
      const status = await load(page, r.path);
      if (status !== row.status) throw new Error(`200% text: loaded ${status}, first load ${row.status}`);
      row.rootFont = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
      await page.waitForTimeout(500);
      row.textZoom200 = { clipped: await page.evaluate(CLIPPED), scroll: await page.evaluate(SCROLLX) };
      await ctx.close();
    }
    for (const width of [640, 320]) {
      const { ctx, page } = await newPage(r.theme, width, 800);
      const status = await load(page, r.path);
      if (status !== row.status) throw new Error(`${width} px: loaded ${status}, first load ${row.status}`);
      row[`reflow${width}`] = { clipped: await page.evaluate(CLIPPED), scroll: await page.evaluate(SCROLLX) };
      await ctx.close();
    }
  };
  let timer;
  try {
    await Promise.race([run(), new Promise((_, no) => (timer = setTimeout(() => no(new Error("route timeout 240s")), 240_000)))]);
  } catch (e) {
    row.error = String(e?.message || e).slice(0, 300);
  } finally {
    clearTimeout(timer);
  }
  // A copy, so a run that timed out and goes on in the background can't change what was saved.
  results.push(structuredClone(row));
  const v = row.axe?.violations?.map((x) => `${x.id}:${x.nodes.length}`).join(" ") || "";
  console.log(`${r.theme.padEnd(5)} ${r.path.padEnd(42)} ${row.status ?? ""} ${row.error ? `ERROR ${row.error.slice(0, 80)}` : v}`);
  writeFileSync(OUT, JSON.stringify(results, null, 1));
}
await browser.close();
console.log(`${results.length} runs -> ${OUT}`);

/** One Markdown summary of one or more result files: each rule, each measure, and where. */
function summary(outFile, files) {
  const rows = files.flatMap((f) => JSON.parse(readFileSync(f, "utf8")));
  const out = [];
  const log = (s = "") => out.push(s);
  const page = (r) => `${r.theme === "dark" ? "dark:" : ""}${r.path}`;
  log(`# ${rows.length} page and theme runs, ${rows.filter((r) => r.error).length} errors`);
  for (const r of rows.filter((r) => r.error)) log(`- ERROR ${page(r)}: ${r.error}`);
  for (const r of rows.filter((r) => r.status && r.status !== 200 && r.path !== "/no-such-page")) log(`- status ${r.status} ${page(r)}`);

  // The tab panels of "/" are scanned again after each click; they are counted apart from the runs.
  const all = rows.flatMap((r) => [
    ...(r.axe?.violations || []).map((v) => ({ ...v, page: page(r) })),
    ...(r.tabs || []).flatMap((t) => t.violations.map((v) => ({ ...v, page: page(r), tab: t.tab }))),
  ]);
  const byRule = {};
  for (const v of all) {
    byRule[v.id] ??= { tags: v.tags, help: v.help, nodes: 0, tabNodes: 0, pages: new Set(), samples: [] };
    if (v.tab) byRule[v.id].tabNodes += v.nodes.length;
    else {
      byRule[v.id].nodes += v.nodes.length;
      byRule[v.id].pages.add(v.page);
    }
    if (byRule[v.id].samples.length < 4) byRule[v.id].samples.push(`${v.page}${v.tab ? ` [tab ${v.tab}]` : ""} :: ${v.nodes[0].target} :: ${v.nodes[0].html.slice(0, 100)}`);
  }
  log("\n## axe rules violated");
  for (const [id, x] of Object.entries(byRule).sort((a, b) => b[1].nodes - a[1].nodes)) {
    const tabs = x.tabNodes ? `, and ${x.tabNodes} in the tab panels of /, some of them the same elements` : "";
    log(`- **${id}** (${x.tags.join(",")}): ${x.nodes} elements on ${x.pages.size} runs${tabs}. ${x.help}`);
    for (const s of x.samples) log(`  - ${s}`);
  }
  const inc = {};
  for (const r of rows) {
    for (const v of r.axe?.incomplete || []) {
      for (const n of v.nodes) {
        const k = `${v.id}: ${(n.summary || "").replace(/\s+/g, " ").slice(0, 110)}`;
        inc[k] ??= { count: 0, sample: `${page(r)} ${n.target}` };
        inc[k].count++;
      }
    }
  }
  log("\n## Contrast axe could not decide (check by hand)");
  for (const [k, x] of Object.entries(inc).sort((a, b) => b[1].count - a[1].count).slice(0, 25)) log(`- x${x.count} ${k} (e.g. ${x.sample})`);

  const uniq = (label, pick, key) => {
    const m = {};
    const runs = new Set();
    for (const r of rows) {
      for (const it of pick(r) || []) {
        const k = key(it);
        m[k] ??= { count: 0, pages: new Set() };
        m[k].count++;
        m[k].pages.add(page(r));
        runs.add(page(r));
      }
    }
    log(`\n## ${label}: ${runs.size} runs, ${Object.keys(m).length} distinct`);
    for (const [k, x] of Object.entries(m).sort((a, b) => b[1].count - a[1].count).slice(0, 30)) log(`- x${x.count} ${k} (e.g. ${[...x.pages].slice(0, 2).join(", ")})`);
  };
  uniq("Line height under 1.5 (1.4.8)", (r) => r.presentation?.lowLineHeight, (i) => `${i.tag}.${i.cls} ${i.fontSize}px lh ${i.lineHeight}`);
  uniq("Lines over 80 characters (1.4.8)", (r) => r.presentation?.longLines, (i) => `${i.tag}.${i.cls} ${i.fontSize}px ${i.cpl} cpl`);
  uniq("Paragraph pitch under 2.5 times the font size (1.4.8)", (r) => r.presentation?.tightParagraphs, (i) => `${i.tag}.${i.cls} pitch ${i.pitch}`);
  uniq("Justified text (1.4.8)", (r) => r.presentation?.justified, (i) => `${i.tag}.${i.cls}`);
  uniq("Text past its table cell", (r) => r.presentation?.cellOverflow, (i) => `${i.tag} "${i.text}" by ${i.by}px`);
  uniq("Text under 12px", (r) => r.presentation?.smallText, (i) => `${i.tag}.${i.cls} ${i.size}px "${i.text}"`);
  uniq("Heading level skips", (r) => r.presentation?.skips, (i) => i);
  log("\n## Pages without exactly one h1");
  for (const r of rows.filter((r) => r.presentation && r.presentation.h1s !== 1)) log(`- ${page(r)}: ${r.presentation.h1s}`);
  for (const k of ["textSpacing", "textZoom200", "reflow640", "reflow320"]) {
    uniq(`${k}: clipped text`, (r) => r[k]?.clipped, (i) => `${i.tag}.${i.cls} "${i.text}" ${i.sw}x${i.sh} in ${i.cw}x${i.ch}`);
    const wide = rows.filter((r) => r[k]?.scroll && r[k].scroll.scrollWidth > r[k].scroll.width + 1);
    log(`\n## ${k}: ${wide.length} runs that scroll sideways`);
    for (const r of wide) {
      log(`- ${page(r)}: ${r[k].scroll.scrollWidth} > ${r[k].scroll.width}; ${r[k].scroll.wide.slice(0, 3).map((w) => `${w.tag}.${w.cls.slice(0, 40)} right ${w.right} "${w.text}"`).join(" | ")}`);
    }
  }
  writeFileSync(outFile, `${out.join("\n")}\n`);
  console.log(`${rows.length} runs -> ${outFile}`);
}
