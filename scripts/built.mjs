// Loads a module of this checkout's built satchel-nft package, packages/satchel-nft/dist, which
// `npm run build -w satchel-nft` makes from packages/satchel-nft/src after `npm ci` has installed
// what it imports. A script that needs it and finds it missing says so on one line and exits 2, as
// the package's own command does (packages/satchel-nft/bin/satchel-nft.js), rather than printing
// Node's stack trace; scripts/check-use-cases.mjs counts such a check as skipped, not failed.
import { basename } from "node:path";

export const BUILD_HINT = "run npm ci and npm run build -w satchel-nft first";

/** The module `file` of packages/satchel-nft/dist, such as "index.js"; without it, BUILD_HINT and exit 2. */
export async function builtPackage(file = "index.js") {
  const url = new URL(`../packages/satchel-nft/dist/${file}`, import.meta.url);
  try {
    return await import(url.href);
  } catch (err) {
    // The build isn't there, or a package it imports (viem, @noble/*) isn't installed.
    if (err?.code !== "ERR_MODULE_NOT_FOUND") throw err;
    const script = process.argv[1] ? basename(process.argv[1]) : "This script";
    console.error(`${script} needs the built satchel-nft package, which isn't here: ${BUILD_HINT}`);
    process.exit(2);
  }
}
