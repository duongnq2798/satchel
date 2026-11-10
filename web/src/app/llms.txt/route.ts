import { DOCS, docHref } from "@/lib/docs/nav";

/** llms.txt (llmstxt.org): the docs as a map for AI agents, with each page's one-line summary. */
export const dynamic = "force-static";

export function GET() {
  const lines = [
    "# Satchel",
    "",
    "> An NFT on NEAR that is one wallet on 16 EVM chains, through NEAR Chain Signatures. The contract keeps a public record of what each token's key signs, so a buyer can check on chain that nothing stayed behind before paying. Not audited.",
    "",
    "The repository's AGENTS.md (https://github.com/duongnq2798/satchel/blob/main/AGENTS.md) has a command that checks each claim, and maps each rule to its code and tests.",
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
