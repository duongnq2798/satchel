import type { ReactNode } from "react";
import { MAINNET } from "satchel-nft";
import { DeedOfSale } from "@/components/landing/deed/deed-of-sale";
import { DeedDefs } from "@/components/landing/deed/defs";
import { MAINNET_SALE, tokenPageNote } from "@/lib/showcase";

/** The token page's note and #3's deed, beside its loading fallback, not inside it, so both show without JavaScript. */
export default async function MainnetTokenLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const note = tokenPageNote(MAINNET, id);
  return (
    <>
      {children}
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
