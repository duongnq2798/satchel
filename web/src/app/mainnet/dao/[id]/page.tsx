import type { Metadata } from "next";
import { MAINNET } from "satchel-nft";
import { DaoBoard } from "@/components/dao-board";
import { boardDescription } from "@/lib/dao-board";

// The same page as on testnet, which DaoBoard reads from the path (components/network.tsx); the
// note under it, in ./layout.tsx, names mainnet itself.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Bounty board, ${id} on mainnet`, description: boardDescription(MAINNET, id) };
}

export default async function MainnetDaoBoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DaoBoard daoId={id} />;
}
