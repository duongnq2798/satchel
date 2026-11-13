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
    "> An NFT on NEAR that is one wallet on 16 EVM chains, through NEAR Chain Signatures. The contract keeps a public record of what each token's key signs, so before paying, a buyer can check on chain what the seller could have kept back. The report proves what the key signed, not powers inside a token's own contract. Not audited.",
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
