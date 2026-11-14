import { bytesToHex } from "@noble/hashes/utils";

// Base58 as NEAR writes keys, hashes and signatures (the Bitcoin alphabet). It used to live in evm.ts,
// which re-exports both functions, so the package root still exports them by the same names.

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Decode(text: string): Uint8Array {
  let n = 0n;
  for (const c of text) {
    const digit = BASE58.indexOf(c);
    if (digit < 0) throw new Error(`not base58: ${c}`);
    n = n * 58n + BigInt(digit);
  }
  let hex = n === 0n ? "" : n.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const body = (hex.match(/../g) ?? []).map((byte) => Number.parseInt(byte, 16));
  const lead = text.match(/^1*/)?.[0].length ?? 0;
  return Uint8Array.from([...new Array(lead).fill(0), ...body]);
}

export function base58Encode(bytes: Uint8Array): string {
  let n = bytes.length ? BigInt(`0x${bytesToHex(bytes)}`) : 0n;
  let text = "";
  while (n > 0n) {
    text = BASE58[Number(n % 58n)] + text;
    n /= 58n;
  }
  const lead = bytes.findIndex((byte) => byte !== 0);
  return "1".repeat(lead === -1 ? bytes.length : lead) + text;
}
