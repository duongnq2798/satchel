// Checks the web app's loading system on a production server (`--help` says how to serve one): the
// status and no-JavaScript HTML of the routes behind a loading fallback, layout shift at Slow 4G, the
// token page's soft timeout with every NEAR request held, and the route fallback a demo pick on /verify
// shows. It prints a JSON report and exits 1 when a check fails. It only reads pages and never connects
// a wallet. Node 24 and Edge, no packages: it drives headless Edge over the DevTools protocol with
// Node's own WebSocket, on a fresh profile under the OS temp dir, and ends Edge on every way out.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";

const EDGE = String.raw`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`;
const STEPS = ["status", "cls", "timeout"];
const USAGE = `Usage: node web/scripts/loading-check.mjs [options]

Checks the loading system on a production server and prints a JSON report.
Serve production first (prefetching is production-only):
  npm run build --prefix web
  npm run start --prefix web -- -p 3100

Options:
  --base <url>    the server (default http://localhost:3100)
  --steps <list>  comma-separated, default all three:
                    status   404 for bad ids, 200 for good ones, the no-JS notes before React's streamed holders
                    cls      layout shift at Slow 4G and 4x CPU, 1280x900 and 390x844, in headless Edge
                    timeout  /satchel/1 with every NEAR request held, and /verify's route fallback
  --edge <path>   Edge (default ${EDGE})
  --port <n>      Edge's DevTools port (default 9333)
  -h, --help      this text

Exit code: 0 every check passed, 1 a check failed, 2 the checks couldn't run.`;

let opts;
try {
  ({ values: opts } = parseArgs({
    options: {
      base: { type: "string", default: "http://localhost:3100" },
      steps: { type: "string", default: STEPS.join(",") },
      edge: { type: "string", default: EDGE },
      port: { type: "string", default: "9333" },
      help: { type: "boolean", short: "h", default: false },
    },
  }));
} catch (e) {
  console.error(`${e.message}\n\n${USAGE}`);
  process.exit(2);
}
if (opts.help) {
  console.log(USAGE);
  process.exit(0);
}
const steps = opts.steps.split(",").map((s) => s.trim());
const port = Number(opts.port);
if (steps.some((s) => !STEPS.includes(s)) || !Number.isInteger(port) || port < 1 || port > 65_535) {
  console.error(USAGE);
  process.exit(2);
}

const VIEWPORTS = [{ width: 1280, height: 900 }, { width: 390, height: 844 }];
// Slow 4G: 150 ms latency, 1.6 Mbps down and 750 kbps up, in bytes a second.
const SLOW_4G = { offline: false, latency: 150, downloadThroughput: 200_000, uploadThroughput: 93_750 };
const CLS_LIMIT = 0.1;

const report = { base: opts.base.replace(/\/$/, ""), steps, ok: false, failures: [] };
const fail = (message) => report.failures.push(message);
const log = (message) => process.stderr.write(`${message}\n`);
const round = (n) => Math.round(n * 10_000) / 10_000;
/** Whether a time is set and no later than `ms`. */
const by = (at, ms) => at !== null && at <= ms;

// ---- Edge ----

let edge = null;
let profile = null;
let cdp = null;

/** Kills Edge and every process it started, if it still runs, then deletes its profile; safe to call twice. */
function endEdge() {
  if (edge && edge.exitCode === null && edge.signalCode === null) {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(edge.pid), "/t", "/f"], { stdio: "ignore" });
    else edge.kill("SIGKILL");
  }
  if (profile) rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  profile = null;
}

// On every way out: the exit handler runs after a crash too, and a signal exits through it.
process.on("exit", () => {
  try {
    endEdge();
  } catch {}
});
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) process.on(signal, () => process.exit(130));

/** One DevTools connection: `send` a command (a page's carries its sessionId, flat mode), `on` every event. */
async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error(`Couldn't open DevTools at ${url}`));
  });
  let id = 0;
  const calls = new Map();
  const listeners = new Set();
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    const call = calls.get(msg.id);
    if (!call) return msg.method && listeners.forEach((fn) => fn(msg));
    calls.delete(msg.id);
    if (msg.error) call.reject(new Error(`${call.method}: ${msg.error.message}`));
    else call.resolve(msg.result);
  };
  ws.onclose = () => {
    for (const call of calls.values()) call.reject(new Error(`${call.method}: DevTools closed`));
    calls.clear();
  };
  return {
    send: (method, params = {}, sessionId) =>
      new Promise((resolve, reject) => {
        calls.set(++id, { method, resolve, reject });
        ws.send(JSON.stringify({ id, method, params, sessionId }));
      }),
    /** Calls `fn` with every event; returns what stops it. */
    on: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    close: () => ws.close(),
  };
}

/** Starts headless Edge on a fresh profile and connects to it. */
async function launchEdge() {
  if (!existsSync(opts.edge)) throw new Error(`No Edge at ${opts.edge}; pass --edge.`);
  const version = () =>
    fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1_000) })
      .then((r) => r.json())
      .catch(() => null);
  // Another browser on the port would answer in Edge's place.
  if (await version()) throw new Error(`Port ${port} already serves DevTools; close that browser or pass --port.`);
  profile = mkdtempSync(join(tmpdir(), "satchel-loading-edge-"));
  const args = ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`];
  edge = spawn(opts.edge, [...args, "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-sync", "about:blank"], { stdio: "ignore" });
  let error = null;
  edge.once("error", (e) => (error = e));
  const until = Date.now() + 30_000;
  while (Date.now() < until) {
    if (error || edge.exitCode !== null) throw new Error(`Edge didn't start: ${error?.message ?? `exit code ${edge.exitCode}`}`);
    const v = await version();
    if (v?.webSocketDebuggerUrl) return connect(v.webSocketDebuggerUrl);
    await sleep(200);
  }
  throw new Error("Edge's DevTools didn't answer in 30 s.");
}

/** Closes Edge, kills it if it doesn't close in 3 s, and deletes its profile. */
async function closeEdge() {
  if (edge && edge.exitCode === null && edge.signalCode === null) {
    const exited = new Promise((resolve) => edge.once("exit", resolve));
    await Promise.race([cdp?.send("Browser.close").catch(() => {}), sleep(3_000)]);
    await Promise.race([exited, sleep(3_000)]);
  }
  cdp?.close();
  try {
    endEdge();
  } catch (e) {
    log(`Couldn't delete Edge's profile ${profile}: ${e.message}`);
  }
}

/** A tab in its own browser context (cold cache, no saved wallet), at `width`x`height`, throttled if asked. */
async function openPage({ width = 1280, height = 900, throttle = false } = {}) {
  const { browserContextId } = await cdp.send("Target.createBrowserContext");
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params) => cdp.send(method, params, sessionId);
  const offs = [];
  const on = (method, fn) => {
    const off = cdp.on((m) => m.sessionId === sessionId && m.method === method && fn(m.params));
    offs.push(off);
    return off;
  };
  const inflight = new Set();
  on("Network.requestWillBeSent", (p) => inflight.add(p.requestId));
  on("Network.loadingFinished", (p) => inflight.delete(p.requestId));
  on("Network.loadingFailed", (p) => inflight.delete(p.requestId));
  await send("Page.enable");
  await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 768 });
  if (throttle) {
    await send("Network.emulateNetworkConditions", SLOW_4G);
    await send("Emulation.setCPUThrottlingRate", { rate: 4 });
  }
  return {
    send,
    on,
    inflight,
    /** Navigates and waits for the load event, 2 minutes at most. */
    async goto(url) {
      let off, timer;
      const loaded = new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), 120_000);
        off = on("Page.loadEventFired", () => resolve(true));
      });
      try {
        const r = await send("Page.navigate", { url });
        if (r.errorText) throw new Error(`${url}: ${r.errorText}`);
        if (!(await loaded)) throw new Error(`${url} didn't load in 120 s`);
      } finally {
        clearTimeout(timer);
        off();
      }
    },
    /** Runs `fn` (a function with no outside references) in the page with `args`; its JSON result. */
    async eval(fn, ...args) {
      const expression = `(${fn})(...${JSON.stringify(args)})`;
      const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(`In the page: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
      return r.result.value;
    },
    /** A left click through the browser's input, as a person makes it. */
    async click(x, y) {
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
    },
    async close() {
      for (const off of offs) off();
      await cdp.send("Target.disposeBrowserContext", { browserContextId }).catch(() => {});
    },
  };
}

/** Polls `fn` in the page until it returns true: the ms that took, or null after `ms`. */
async function waitUntil(page, fn, ms, ...args) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await page.eval(fn, ...args).catch(() => false)) return Date.now() - start;
    await sleep(100);
  }
  return null;
}

/** Waits until no request ran for 3 s, at least 8 s and at most 45 s after load: whether it got quiet. */
async function settle(page) {
  const start = Date.now();
  let quietSince = start;
  while (Date.now() - start < 45_000) {
    await sleep(250);
    if (page.inflight.size > 0) quietSince = Date.now();
    else if (Date.now() - start >= 8_000 && Date.now() - quietSince >= 3_000) return true;
  }
  return false;
}

// ---- In the page (each runs from its source text, so it uses nothing outside itself) ----

/** Before any page script: keeps every layout shift without recent input, with its sources' markup. */
function recordShifts() {
  window.__shifts = [];
  const markup = (n) => (n ? (n.outerHTML ?? n.parentElement?.outerHTML ?? n.nodeName).slice(0, 120) : null);
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      if (!e.hadRecentInput) window.__shifts.push({ value: e.value, startTime: e.startTime, sources: (e.sources ?? []).map((s) => markup(s.node)) });
    }
  }).observe({ type: "layout-shift", buffered: true });
}

/** What the token page shows now; innerText leaves out the invisible variants of a WaitLine. */
function probe() {
  const text = document.body?.innerText ?? "";
  const shown = (el) => el.checkVisibility({ visibilityProperty: true, opacityProperty: true });
  return {
    t: performance.now(),
    skeleton: [...document.querySelectorAll('main [data-loading="skeleton"]')].some(shown),
    slow: text.includes("Still reading. Public RPC nodes can be slow."),
    timeout: text.includes("No answer in 15 s."),
    tryAgain: [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Try again" && shown(b)),
  };
}

/** Focuses the visible Try again: whether it took focus. */
function focusTryAgain() {
  const button = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Try again" && b.checkVisibility({ visibilityProperty: true }));
  button?.focus();
  return Boolean(button) && document.activeElement === button;
}

/** Scrolls to /verify's first same-network demo pick and times the click and the route fallback after it. */
function armPick() {
  const link = document.querySelector('section[aria-labelledby="demo-satchels"] a[href^="/satchel/"]');
  if (!link) return null;
  link.scrollIntoView({ block: "center", behavior: "instant" });
  const route = (window.__route = { clickAt: null, fallbackAt: null });
  const isRoute = (n) => n instanceof Element && (n.matches('[data-loading="route"]') || n.querySelector('[data-loading="route"]') !== null);
  // From the added nodes, so a fallback replaced within the same task still counts.
  new MutationObserver((records, observer) => {
    if (!records.some((r) => [...r.addedNodes].some(isRoute))) return;
    route.fallbackAt = performance.now();
    observer.disconnect();
  }).observe(document.body, { childList: true, subtree: true });
  window.addEventListener("click", () => (route.clickAt = performance.now()), { capture: true, once: true });
  const box = link.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2, path: link.pathname };
}

/** Whether the token page at `path` replaced the route fallback. */
function isTokenPage(path) {
  return location.pathname === path && !document.querySelector('[data-loading="route"]') && /Satchel #/.test(document.querySelector("h1")?.textContent ?? "");
}

// ---- Checks ----

/** Step 1: status codes, and each server-rendered note before any `<div hidden id="S:` (a streamed boundary's holder). */
async function checkStatus(dao) {
  const bad = ["/satchel/abc", "/satchel/12345678901234567890", "/satchel/abc/room", "/mainnet/satchel/abc", "/mainnet/satchel/abc/room", "/dao/%21%21", "/mainnet/dao/%21%21"];
  const good = ["/satchel/1", "/satchel/1/room", "/mainnet/satchel/3", dao];
  const markers = { "/satchel/1": "The same report from a terminal", "/mainnet/satchel/3": 'id="deed"', [dao]: "It is display only" };
  const rows = [];
  for (const [path, expect] of [...bad.map((p) => [p, 404]), ...good.map((p) => [p, 200])]) {
    log(`status ${path}`);
    const res = await fetch(report.base + path, { redirect: "manual", signal: AbortSignal.timeout(60_000) });
    const html = await res.text();
    const row = { path, expect, status: res.status, ok: res.status === expect };
    if (!row.ok) fail(`status: ${path} answered ${res.status}, not ${expect}`);
    if (expect === 404 && res.status === 200) report.hint = "A bad id answered 200: a proxy.ts can answer bad ids with a 404 (docs: loading.md:113-115).";
    const marker = markers[path];
    if (marker) {
      const at = html.indexOf(marker);
      const holder = html.indexOf('<div hidden id="S:');
      row.marker = { text: marker, at, holder, ok: at >= 0 && (holder < 0 || at < holder) };
      if (!row.marker.ok) fail(`status: "${marker}" on ${path} is ${at < 0 ? "missing" : "after a streamed holder"}`);
      row.ok &&= row.marker.ok;
    }
    rows.push(row);
  }
  return rows;
}

/** The sum, the largest session window (gaps under 1 s, at most 5 s long) and the 3 sources that moved most. */
function summarize(shifts) {
  let [sum, max, current, first, previous] = [0, 0, 0, 0, -Infinity];
  for (const s of [...shifts].sort((a, b) => a.startTime - b.startTime)) {
    sum += s.value;
    if (s.startTime - previous < 1_000 && s.startTime - first < 5_000) current += s.value;
    else [current, first] = [s.value, s.startTime];
    previous = s.startTime;
    max = Math.max(max, current);
  }
  const bySource = new Map();
  for (const s of shifts) for (const node of s.sources) bySource.set(node, (bySource.get(node) ?? 0) + s.value);
  const top = [...bySource].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([node, value]) => ({ node, value: round(value) }));
  return { sum: round(sum), maxWindow: round(max), shifts: shifts.length, top };
}

/** Step 2: CLS at Slow 4G and 4x CPU on each page and viewport; "/" is reported only. */
async function checkCls(dao) {
  const rows = [];
  for (const { width, height } of VIEWPORTS) {
    for (const path of ["/", "/satchel/1", "/market", "/satchels", dao]) {
      const row = { path, viewport: `${width}x${height}`, gated: path !== "/" };
      log(`cls ${path} at ${row.viewport}`);
      const page = await openPage({ width, height, throttle: true });
      try {
        await page.send("Page.addScriptToEvaluateOnNewDocument", { source: `(${recordShifts})()` });
        await page.goto(report.base + path);
        row.quiet = await settle(page);
        Object.assign(row, summarize(await page.eval(() => window.__shifts)));
        row.ok = !row.gated || row.maxWindow <= CLS_LIMIT;
        if (!row.ok) fail(`cls: ${path} at ${row.viewport} has a session window of ${row.maxWindow}, over ${CLS_LIMIT}`);
      } catch (e) {
        Object.assign(row, { ok: false, error: e.message });
        fail(`cls: ${path} at ${row.viewport}: ${e.message}`);
      } finally {
        await page.close();
      }
      rows.push(row);
    }
  }
  return rows;
}

/** Step 3a: /satchel/1 with every NEAR request held, then let through. */
async function checkTimeout(nearHost) {
  log("timeout /satchel/1 with NEAR held");
  const page = await openPage();
  const held = [];
  let holding = true;
  page.on("Fetch.requestPaused", ({ requestId }) => {
    if (holding) held.push(requestId);
    else page.send("Fetch.continueRequest", { requestId }).catch(() => {});
  });
  try {
    await page.send("Fetch.enable", { patterns: [{ urlPattern: `*${nearHost}*` }] });
    await page.goto(`${report.base}/satchel/1`);
    const out = { path: "/satchel/1", nearHost, skeletonAtLoad: (await page.eval(probe)).skeleton, slowAt: null, timeoutAt: null };
    for (let p = await page.eval(probe); p.t < 17_000; p = await page.eval(probe)) {
      if (p.slow) out.slowAt ??= Math.round(p.t);
      if (p.timeout && p.tryAgain) {
        out.timeoutAt = Math.round(p.t);
        break;
      }
      await sleep(100);
    }
    out.tryAgainFocusable = await page.eval(focusTryAgain);
    holding = false;
    out.held = held.length;
    // A request the page gave up on can't be continued; that's fine.
    await Promise.all(held.map((requestId) => page.send("Fetch.continueRequest", { requestId }).catch(() => {})));
    await page.send("Fetch.disable");
    out.renderedAfterRelease = await waitUntil(page, () => document.body.innerText.includes("Owned by"), 30_000);
    const why = [
      out.held === 0 && `no request to ${nearHost} was held, so nothing was slow`,
      !out.skeletonAtLoad && "no skeleton at load",
      !by(out.slowAt, 4_500) && `"Still reading" showed ${out.slowAt === null ? "never" : `at ${out.slowAt} ms`}, not by 4500 ms`,
      !by(out.timeoutAt, 15_500) && `"No answer in 15 s." with Try again showed ${out.timeoutAt === null ? "never" : `at ${out.timeoutAt} ms`}, not by 15500 ms`,
      !out.tryAgainFocusable && "Try again took no focus",
      out.renderedAfterRelease === null && "the satchel didn't render in 30 s once NEAR answered",
    ].filter(Boolean);
    for (const reason of why) fail(`timeout: ${reason}`);
    return { ...out, ok: why.length === 0 };
  } finally {
    await page.close();
  }
}

/** Step 3b: a demo pick on /verify shows the route fallback within 100 ms of the click, then the token page. */
async function checkRoute() {
  log("route /verify -> demo pick");
  const page = await openPage();
  try {
    await page.goto(`${report.base}/verify`);
    await sleep(5_000); // for the picks' prefetch
    const pick = await page.eval(armPick);
    if (!pick) {
      fail("route: /verify shows no same-network demo pick");
      return { from: "/verify", ok: false };
    }
    await page.click(pick.x, pick.y);
    await waitUntil(page, () => window.__route?.fallbackAt != null, 5_000);
    const times = await page.eval(() => window.__route ?? null);
    const fallbackMs = times?.clickAt != null && times.fallbackAt != null ? Math.round(times.fallbackAt - times.clickAt) : null;
    const tokenPageMs = await waitUntil(page, isTokenPage, 30_000, pick.path);
    const why = [
      !by(fallbackMs, 100) && `the route fallback showed ${fallbackMs === null ? "never" : `${fallbackMs} ms after the click`}, not within 100 ms`,
      tokenPageMs === null && `${pick.path} didn't replace its fallback in 30 s`,
    ].filter(Boolean);
    for (const reason of why) fail(`route: ${reason}`);
    return { from: "/verify", to: pick.path, fallbackMs, tokenPageMs, ok: why.length === 0 };
  } finally {
    await page.close();
  }
}

/** The testnet bounty board the app links (sitemap.ts), read from its source so the two can't drift. */
function boardPath() {
  const source = readFileSync(new URL("../src/lib/dao-board.ts", import.meta.url), "utf8");
  const id = source.match(/export const BOUNTY_DAO = "([^"]+)"/)?.[1];
  if (!id) throw new Error("No BOUNTY_DAO in web/src/lib/dao-board.ts");
  return `/dao/${id}`;
}

async function main() {
  const up = await fetch(report.base, { signal: AbortSignal.timeout(15_000) }).then((r) => (r.body?.cancel(), true), () => false);
  if (!up) throw new Error(`No server answers at ${report.base}. Start one: npm run start --prefix web -- -p 3100`);
  const { TESTNET, nearRpcUrl } = await import("satchel-nft");
  const nearHost = new URL(nearRpcUrl(TESTNET)).host;
  const dao = boardPath();
  Object.assign(report, { nearHost, dao });
  if (steps.includes("status")) report.status = await checkStatus(dao);
  if (steps.includes("cls") || steps.includes("timeout")) {
    cdp = await launchEdge();
    if (steps.includes("cls")) report.cls = await checkCls(dao);
    if (steps.includes("timeout")) {
      report.timeout = await checkTimeout(nearHost);
      report.route = await checkRoute();
    }
  }
}

try {
  await main();
  report.ok = report.failures.length === 0;
} catch (e) {
  report.error = e.message;
} finally {
  await closeEdge();
}
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.error ? 2 : report.ok ? 0 : 1;
