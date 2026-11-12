import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TESTNET } from "satchel-nft";
import { TokenView } from "@/components/token-view";
import { tokenDescription, tokenPageNote } from "@/lib/showcase";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Satchel #${id}`, description: tokenDescription(TESTNET, id) };
}

export default async function SatchelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,19}$/.test(id)) notFound();
  // Rendered on the server and read from nothing, so a reader that runs no JavaScript gets it too.
  const note = tokenPageNote(TESTNET, id);
  return (
    <>
      <TokenView tokenId={id} />
      <p className="mt-10 text-sm text-muted">
        {note.text} <code className="font-mono text-[0.9em] break-all text-ink-2">{note.command}</code>
      </p>
    </>
  );
}
