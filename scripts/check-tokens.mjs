// Checks the token list a satchel's page reads (packages/satchel-nft/src/contents.ts) against each
// chain: every address holds code, and its symbol() and decimals() are what the list says. It reads
// the list from the built package, so build it first: without it, it says so and exits 2. Node 22
// or later, no wallet, no key.
// Usage: npm run build -w satchel-nft && node scripts/check-tokens.mjs
// It doesn't prove a deployment is the issuer's; the list's sources are its comments.
import { builtPackage } from "./built.mjs";

const { CHAINS, TOKENS } = await builtPackage();

async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

/** An ABI-encoded string, or a bytes32 one as some old tokens return. */
function abiString(hex) {
  const bytes = Buffer.from(hex.slice(2), "hex");
  if (bytes.length === 32) return bytes.toString("utf8").replace(/\0+$/, "");
  const length = Number(BigInt(`0x${bytes.subarray(32, 64).toString("hex")}`));
  return bytes.subarray(64, 64 + length).toString("utf8");
}

const SYMBOL = "0x95d89b41";
const DECIMALS = "0x313ce567";

const rows = await Promise.all(
  CHAINS.flatMap((chain) =>
    TOKENS[chain.id].map(async (token) => {
      const where = `${chain.name} ${token.kind} ${token.address}`;
      try {
        const [code, symbol, decimals] = await Promise.all([
          rpc(chain.rpc, "eth_getCode", [token.address, "latest"]),
          rpc(chain.rpc, "eth_call", [{ to: token.address, data: SYMBOL }, "latest"]).then(abiString),
          rpc(chain.rpc, "eth_call", [{ to: token.address, data: DECIMALS }, "latest"]).then((d) => Number(BigInt(d))),
        ]);
        const wrong = [
          code === "0x" && "no code",
          symbol !== token.symbol && `symbol ${JSON.stringify(symbol)}, the list says ${JSON.stringify(token.symbol)}`,
          decimals !== token.decimals && `${decimals} decimals, the list says ${token.decimals}`,
        ].filter(Boolean);
        return { ok: wrong.length === 0, line: `${wrong.length ? "FAIL" : "ok  "}  ${where}  ${wrong.join("; ") || `${symbol}, ${decimals} decimals`}` };
      } catch (err) {
        return { ok: false, line: `FAIL  ${where}  ${err.message}` };
      }
    }),
  ),
);
for (const row of rows) console.log(row.line);
const failed = rows.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} of ${rows.length} tokens don't match.` : `\nAll ${rows.length} tokens match their chains.`);
process.exit(failed ? 1 : 0);
