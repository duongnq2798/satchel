// Renders images from the HTML in this folder, with a headless Chromium browser (Edge or Chrome): the
// README's banner and buttons in docs/assets, and the app's share card and icons in web/src/app.
// Run from the repository root:
//
//   node docs/assets/src/render.mjs [file ...]
//
// Name files (as listed below, from the repository root) to render only those; with none it renders
// them all. Set BROWSER=<path to msedge or chrome> if neither default path exists. Node 22 or later.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
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

// Each shot: the page, the window in CSS pixels, the pixel ratio (2 for the README's images, 1 where the
// file's size is fixed: 1200 x 630 for a share card, 180 x 180 for an Apple touch icon), and the file.
// `copies` get the same picture; `ico` renders the page once per size and packs them into one .ico.
const shots = [
  { page: "banner.html", size: [1280, 480], file: "docs/assets/readme-banner.png" },
  { page: "buttons.html#try", size: [300, 52], file: "docs/assets/readme/try-it-live.png" },
  { page: "buttons.html#evaluate", size: [300, 52], file: "docs/assets/readme/evaluate-in-5-minutes.png" },
  { page: "buttons.html#claims", size: [300, 52], file: "docs/assets/readme/check-every-claim.png" },
  { page: "og.html", size: [1200, 630], scale: 1, file: "web/src/app/opengraph-image.png", copies: ["web/src/app/twitter-image.png"] },
  { page: "icon.html#apple", size: [180, 180], scale: 1, file: "web/src/app/apple-icon.png" },
  { page: "icon.html#ico", size: [128, 128], ico: [16, 32], file: "web/src/app/favicon.ico" },
];
const only = process.argv.slice(2);
const unknown = only.filter((name) => !shots.some((s) => s.file === name));
if (unknown.length) throw new Error(`No shot named ${unknown.join(", ")}; the shots are ${shots.map((s) => s.file).join(", ")}`);

function screenshot(page, size, scale, to) {
  const [name, hash] = page.split("#");
  const url = pathToFileURL(join(here, name)).href + (hash ? `#${hash}` : "");
  execFileSync(browser, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--default-background-color=00000000",
    `--window-size=${size.join(",")}`,
    `--force-device-scale-factor=${scale}`,
    "--virtual-time-budget=10000",
    `--screenshot=${to}`,
    url,
  ], { stdio: "ignore" });
}

/** An .ico holding each PNG as it is, which every browser since IE 9 reads. */
function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(1, 2); // type 1: icon
  head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach(({ px, data }, i) => {
    const entry = 6 + 16 * i;
    head.writeUInt8(px % 256, entry); // width, 0 for 256
    head.writeUInt8(px % 256, entry + 1); // height
    head.writeUInt16LE(1, entry + 4); // color planes
    head.writeUInt16LE(32, entry + 6); // bits per pixel
    head.writeUInt32LE(data.length, entry + 8);
    head.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p.data)]);
}

for (const { page, size, scale = 2, file, copies = [], ico: sizes } of shots) {
  if (only.length && !only.includes(file)) continue;
  const to = join(root, file);
  mkdirSync(dirname(to), { recursive: true });
  if (sizes) {
    const tmp = mkdtempSync(join(tmpdir(), "satchel-icon-"));
    const pngs = sizes.map((px) => {
      const png = join(tmp, `${px}.png`);
      screenshot(page, size, px / size[0], png);
      return { px, data: readFileSync(png) };
    });
    rmSync(tmp, { recursive: true, force: true });
    writeFileSync(to, ico(pngs));
  } else {
    screenshot(page, size, scale, to);
  }
  for (const copy of copies) copyFileSync(to, join(root, copy));
  console.log(`${[file, ...copies].join(", ")} from ${page}`);
}
