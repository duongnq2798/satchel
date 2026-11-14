import type { Metadata } from "next";
import { TESTNET } from "satchel-nft";
import { DaoBoard } from "@/components/dao-board";
import { boardDescription } from "@/lib/dao-board";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Bounty board, ${id}`, description: boardDescription(TESTNET, id) };
}

/** The id is checked in ./layout.tsx, above this page's loading fallback, which also renders the note under it. */
export default async function DaoBoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DaoBoard daoId={id} />;
}
