import type { ReactNode } from "react";
import { TESTNET } from "satchel-nft";
import { tokenPageNote } from "@/lib/showcase";

/** The token page's note, beside its loading fallback, not inside it: rendered on the server and read from nothing, so it shows without JavaScript. */
export default async function TokenLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const note = tokenPageNote(TESTNET, id);
  return (
    <>
      {children}
      <p className="mt-10 text-sm text-muted">
        {note.text} <code className="font-mono text-[0.9em] break-all text-ink-2">{note.command}</code>
      </p>
    </>
  );
}
