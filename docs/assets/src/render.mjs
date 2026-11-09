// Renders the README images in docs/assets from the HTML in this folder, with a headless Chromium
// browser (Edge or Chrome). Run from the repository root: node docs/assets/src/render.mjs
// Set BROWSER=<path to msedge or chrome> if neither default path exists.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "..");
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

const shots = [
  { page: "banner.html", size: [1280, 480], file: "readme-banner.png" },
  { page: "buttons.html#try", size: [300, 52], file: "readme/try-it-live.png" },
  { page: "buttons.html#evaluate", size: [300, 52], file: "readme/evaluate-in-5-minutes.png" },
  { page: "buttons.html#claims", size: [300, 52], file: "readme/check-every-claim.png" },
];

mkdirSync(join(out, "readme"), { recursive: true });
for (const { page, size, file } of shots) {
  const [name, hash] = page.split("#");
  const url = pathToFileURL(join(here, name)).href + (hash ? `#${hash}` : "");
  execFileSync(browser, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--default-background-color=00000000",
    `--window-size=${size.join(",")}`,
    "--force-device-scale-factor=2",
    "--virtual-time-budget=10000",
    `--screenshot=${join(out, file)}`,
    url,
  ], { stdio: "ignore" });
  console.log(`${file} from ${page}`);
}
