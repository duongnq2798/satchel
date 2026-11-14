import { NETWORKS } from "satchel-nft";
import { DOCS, docHref } from "@/lib/docs/nav";
import { appPath } from "@/lib/routes";
import { DEMO_SATCHELS, verifyCommand } from "@/lib/showcase";

/** llms.txt (llmstxt.org): the demo satchels and the docs as a map for AI agents, each with a one-line summary. */
export const dynamic = "force-static";

export function GET() {
  const lines = [
    "# Satchel",
    "",
    "> An NFT on NEAR that is one wallet on 8 EVM mainnets and their testnets, through NEAR Chain Signatures. The contract keeps a public record of what each token's key signs, so before paying, a buyer can check on chain what the seller could have kept back. The report proves what the key signed, not powers inside a token's own contract. Not audited.",
    "",
    "## Satchel in five lines",
    "",
    "- Identity. Satchel · https://satchelnft.xyz · https://github.com/duongnq2798/satchel · contract v1.satchel-nft.near (0 access keys).",
    "- What's specific. The contract builds and records every EVM transaction it asks the MPC network to sign (a raw signature is counted and blocks a clean verdict); a buyer checks that record against each chain's finalized nonces and approvals and buys at the record version they checked.",
    "- Who it's for. An address that must keep receiving after a sale: a fee or royalty receiver a contract fixes for good, a DAO treasury, an estate.",
    "- Why NEAR. No one holds the key: NEAR's MPC network signs for the address only when the contract asks, and the contract asks only for the token's owner, so one NEAR transaction hands the wallet over on 8 EVM mainnets (16 chain ids with their testnets).",
    "- Mainnet. #2 (https://satchelnft.xyz/mainnet/satchel/2) holds USDC from a NEAR Intents 1Click swap; #3 (https://satchelnft.xyz/mainnet/satchel/3#deed) was listed and bought end to end (a self-sale between two of the builder's accounts, not a market price).",
    "",
    "## Check it yourself",
    "",
    "Node 22 or later and no wallet, from a clone of https://github.com/duongnq2798/satchel. Times and lines are from runs on 2026-11-13.",
    "",
    "- `node scripts/check-claims.mjs --network mainnet`: no install, 10 to 20 s. Last line, exit 0: `20 of 20 claims hold (…)`.",
    "- `npx -y satchel-nft@0.2.0 verify --network mainnet 3`: the npm release, run in an empty folder (inside a clone, after `npm ci`, npx runs the clone's own build): 49 s to 4 min the first time (download), 4 to 15 s after. Verdict line, exit 0: `PROVABLY CLEAN (checked <time>)`.",
    "- `node scripts/check-use-cases.mjs`: about 8 to 10 minutes (8 min 26 s on 2026-11-13); prints each of the nine use cases. Last line, exit 0: `9 use cases: 9 hold, 0 not run yet, 0 skipped, 0 failed, in <time>` (before `npm ci` and `npm run build -w satchel-nft`: 6 hold, 3 skipped).",
    "- The contract's 0 access keys, in one RPC call whose answer includes `\"keys\":[]`: `curl -s https://rpc.mainnet.near.org -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"view_access_key_list\",\"finality\":\"final\",\"account_id\":\"v1.satchel-nft.near\"}}'`",
    "",
    "The repository's AGENTS.md (https://github.com/duongnq2798/satchel/blob/main/AGENTS.md) has a command that checks each claim, and maps each rule to its code and tests.",
    "",
    "## Demo satchels",
    "",
    "What happened to each one. Its page reads its clean transfer report live, and the command prints the same report in a terminal. The transactions behind the mainnet satchels' stories are at https://satchelnft.xyz/mainnet#showcase. Mainnet #3's sale, a self-sale between two of the builder's accounts, and the refused call after it are also on its page as a deed of sale, clause by clause: each of its four transactions with its time, the block that included it and its hash, and the two reports with the time each was read (https://satchelnft.xyz/mainnet/satchel/3#deed), and in the README (https://github.com/duongnq2798/satchel/blob/main/README.md#satchel-3-sold-to-a-second-account).",
    "",
    ...DEMO_SATCHELS.map((d) => {
      const net = NETWORKS[d.network];
      return `- [Satchel #${d.tokenId} on ${net.id}](https://satchelnft.xyz${appPath(net, `/satchel/${d.tokenId}`)}): ${d.story}. \`${verifyCommand(net, d.tokenId)}\``;
    }),
    "",
    ...DOCS.flatMap((section) => [
      `## ${section.title}`,
      "",
      ...section.pages.map((p) => `- [${p.title}](https://satchelnft.xyz${docHref(p.slug)}): ${p.description}`),
      "",
    ]),
  ];
  return new Response(lines.join("\n"), { headers: { "content-type": "text/plain; charset=utf-8" } });
}
