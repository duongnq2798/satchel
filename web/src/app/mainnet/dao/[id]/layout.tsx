import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { MAINNET, isAccountId } from "satchel-nft";
import { boardPageNote } from "@/lib/dao-board";

/** The same as on testnet, with a note that names mainnet. */
export default async function MainnetDaoIdLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isAccountId(id)) notFound();
  return (
    <>
      {children}
      <p className="mt-10 text-sm text-muted [overflow-wrap:anywhere]">{boardPageNote(MAINNET, id)}</p>
    </>
  );
}
