import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MAINNET } from "satchel-nft";
import { DeedOfSale } from "@/components/landing/deed/deed-of-sale";
import { DeedDefs } from "@/components/landing/deed/defs";
import { TokenView } from "@/components/token-view";
import { MAINNET_SALE, tokenDescription, tokenPageNote } from "@/lib/showcase";

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
      <p className="mt-10 text-sm text-muted">
        {note.text} <code className="font-mono text-[0.9em] break-all text-ink-2">{note.command}</code>
      </p>
      {/* Satchel #3's sale as a deed, written from its evidence file on the server, so it shows without JavaScript too. */}
      {id === MAINNET_SALE.tokenId && (
        <div className="mt-24">
          <DeedDefs />
          <DeedOfSale />
        </div>
      )}
    </>
  );
}
