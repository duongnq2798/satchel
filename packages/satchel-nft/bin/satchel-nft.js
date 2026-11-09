#!/usr/bin/env node
// The satchel-nft command. Its code is in dist/, which `npm run build` makes; npm builds it before
// packing, so the package from npm has it. This file is here before any build, so installing the
// repository links the command and `npx satchel-nft` runs this checkout, never a download.
import { existsSync } from "node:fs";

const cli = new URL("../dist/cli.js", import.meta.url);
if (existsSync(cli)) {
  await import(cli.href);
} else {
  console.error("satchel-nft is not built yet: run npm run build -w satchel-nft at the repository root");
  process.exitCode = 2;
}
