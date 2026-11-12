// Takes the README's screenshots of the web app, read live from NEAR, Sepolia and Base, with a
// headless Chromium browser driven over the DevTools protocol. Start the app first (cd web && npm run
// build && npm start), or point it at https://satchelnft.xyz, then from the repository root:
//
//   node docs/assets/src/screenshots.mjs [http://localhost:3000] [file.png ...]
//
// Name files to take only those shots (the origin comes first); with none it takes them all.
// Set BROWSER=<path to msedge or chrome> if neither default path exists. Node 22 or later.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const origin = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
if (!/^https?:\/\//.test(origin)) throw new Error(`The first argument is the origin, like http://localhost:3000, not ${origin}`);
const only = process.argv.slice(3);
const out = resolve(dirname(fileURLToPath(import.meta.url)), "..", "readme");
const browser =
  process.env.BROWSER ??
  [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].find(existsSync);
if (!browser) throw new Error("No Chromium browser found: set BROWSER=<path>");

// Each shot: the page, what must be on it before the picture (the live checks take a few seconds),
// an optional click, and the area to keep: the top of the page down to the bottom of `until`, or
// the box of `element`.
const shots = [
  { file: "app-landing.png", path: "/", ready: "Provably clean", until: "main section" },
  {
    file: "app-try-to-cheat.png",
    path: "/",
    click: "#trick-withdrawal",
    ready: "Not provable",
    readyIn: "#trick-panel",
    element: "#examples",
  },
  { file: "app-report-5.png", path: "/satchel/5", ready: "Not provable", readyIn: "main", until: "main > div > section:nth-of-type(2)" },
  {
    file: "app-mainnet-satchel-1.png",
    path: "/mainnet/satchel/1",
    ready: "Provably clean",
    readyIn: "main",
    until: "main > div > section:nth-of-type(2)",
  },
];
const unknown = only.filter((name) => !shots.some((s) => s.file === name));
if (unknown.length) throw new Error(`No shot named ${unknown.join(", ")}; the shots are ${shots.map((s) => s.file).join(", ")}`);

const port =9300 + Math.floor(Math.random() * 600);
const profile = mkdtempSync(join(tmpdir(), "satchel-shots-"));
const proc = spawn(browser, [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pageSocket() {
  for (let i = 0; i < 100; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = targets.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error("The browser did not open its DevTools port");
}

const ws = new WebSocket(await pageSocket());
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let nextId = 1;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) =>
  (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;

async function waitFor(expression, what, ms = 45_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await evaluate(expression)) return;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

try {
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  for (const shot of only.length ? shots.filter((s) => only.includes(s.file)) : shots) {
    await send("Page.navigate", { url: origin + shot.path });
    await waitFor("document.readyState === 'complete'", `${shot.path} to load`);
    if (shot.click) {
      await waitFor(`!!document.querySelector(${JSON.stringify(shot.click)})`, shot.click);
      await evaluate(`document.querySelector(${JSON.stringify(shot.click)}).click()`);
    }
    const scope = JSON.stringify(shot.readyIn ?? "body");
    const text = JSON.stringify(shot.ready.toLowerCase());
    await waitFor(`(document.querySelector(${scope})?.innerText ?? "").toLowerCase().includes(${text})`, `"${shot.ready}" on ${shot.path}`);
    // A balance still loading shows "…"; give a slow RPC 20 seconds, then take the shot anyway.
    await waitFor(
      `![...document.querySelectorAll("main *")].some((e) => e.childElementCount === 0 && e.textContent.trim() === "…")`,
      "the balances",
      20_000,
    ).catch(() => console.log(`${shot.file}: a balance was still loading`));
    await evaluate("document.fonts.ready.then(() => true)");
    await sleep(1500); // let the last reads and fonts settle
    const box = await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(shot.element ?? shot.until)});
      const r = el.getBoundingClientRect();
      return { top: r.top + scrollY, bottom: r.bottom + scrollY, height: document.documentElement.scrollHeight };
    })()`);
    const clip = shot.element
      ? { x: 0, y: Math.max(0, box.top - 32), width: 1440, height: box.bottom - box.top + 64, scale: 1 }
      : { x: 0, y: 0, width: 1440, height: Math.min(box.height, box.bottom + 32), scale: 1 };
    const { data } = await send("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: true });
    writeFileSync(join(out, shot.file), Buffer.from(data, "base64"));
    console.log(`readme/${shot.file}: ${origin}${shot.path}, ${clip.width}x${Math.round(clip.height)}`);
  }
} finally {
  ws.close();
  // Close the browser over DevTools: on Windows it can relaunch itself under another process id, so
  // killing the process spawned above can leave it running and holding the profile.
  try {
    const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const browserWs = new WebSocket(webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      browserWs.addEventListener("open", resolve, { once: true });
      browserWs.addEventListener("error", reject, { once: true });
    });
    const closed = new Promise((resolve) => browserWs.addEventListener("close", resolve, { once: true }));
    browserWs.send(JSON.stringify({ id: 1, method: "Browser.close" }));
    await Promise.race([closed, sleep(10_000)]);
    await sleep(2000); // its helper processes exit just after it
  } catch {}
  proc.kill();
  // Windows can keep the profile locked after the browser exits; a temporary folder left is harmless.
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
  } catch {
    console.log(`Left ${profile} behind: Windows still holds it`);
  }
}
