import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MAINNET, isAccountId } from "satchel-nft";
import { DaoBoard } from "@/components/dao-board";
import { boardDescription, boardPageNote } from "@/lib/dao-board";

// The same page as on testnet, which DaoBoard reads from the path (components/network.tsx); the
// note below it, rendered on the server, names mainnet itself.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Bounty board, ${id} on mainnet`, description: boardDescription(MAINNET, id) };
}

export default async function MainnetDaoBoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isAccountId(id)) notFound();
  return (
    <>
      <DaoBoard daoId={id} />
      <p className="mt-10 text-sm text-muted [overflow-wrap:anywhere]">{boardPageNote(MAINNET, id)}</p>
    </>
  );
}
