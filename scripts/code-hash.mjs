// Prints the NEAR code hash of a wasm file: base58(sha256(wasm)), the value `view_account`
// returns as `code_hash`. Usage: node scripts/code-hash.mjs <file.wasm>
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58(bytes) {
  let n = BigInt(`0x${Buffer.from(bytes).toString("hex") || "0"}`);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

export function codeHash(wasm) {
  return base58(createHash("sha256").update(wasm).digest());
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll("\\", "/").split("/").pop())) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node scripts/code-hash.mjs <file.wasm>");
    process.exit(2);
  }
  console.log(codeHash(readFileSync(file)));
}
