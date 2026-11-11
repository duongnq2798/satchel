import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MAINNET } from "satchel-nft";
import { TokenView } from "@/components/token-view";
import { tokenDescription, tokenPageNote } from "@/lib/showcase";

// The same page as on testnet, which TokenView reads from the path (components/network.tsx); the
// note below it, rendered on the server, names mainnet itself.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Satchel #${id} on mainnet`, description: tokenDescription(MAINNET, id) };
}

export default async function MainnetSatchelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,19}$/.test(id)) notFound();
  const note = tokenPageNote(MAINNET, id);
  return (
    <>
      <TokenView tokenId={id} />
      <p className="mt-10 max-w-3xl text-sm text-muted">
        {note.text} <code className="font-mono text-[0.9em] break-all text-ink-2">{note.command}</code>
      </p>
    </>
  );
}
