import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TESTNET, isAccountId } from "satchel-nft";
import { DaoBoard } from "@/components/dao-board";
import { boardDescription, boardPageNote } from "@/lib/dao-board";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Bounty board, ${id}`, description: boardDescription(TESTNET, id) };
}

export default async function DaoBoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isAccountId(id)) notFound();
  return (
    <>
      <DaoBoard daoId={id} />
      {/* Rendered on the server and read from nothing, so a reader that runs no JavaScript gets it too. */}
      <p className="mt-10 text-sm text-muted [overflow-wrap:anywhere]">{boardPageNote(TESTNET, id)}</p>
    </>
  );
}
