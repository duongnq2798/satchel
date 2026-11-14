import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { TESTNET, isAccountId } from "satchel-nft";
import { boardPageNote } from "@/lib/dao-board";

/** The DAO's id is checked here, above the board's loading fallback, so a bad id still answers 404. */
export default async function DaoIdLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isAccountId(id)) notFound();
  return (
    <>
      {children}
      {/* Rendered on the server and read from nothing, beside the fallback, so a reader that runs no JavaScript gets it too. */}
      <p className="mt-10 text-sm text-muted [overflow-wrap:anywhere]">{boardPageNote(TESTNET, id)}</p>
    </>
  );
}
