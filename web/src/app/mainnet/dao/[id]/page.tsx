import type { Metadata } from "next";
import { MAINNET, isAccountId } from "satchel-nft";
import { DaoBoard } from "@/components/dao-board";
import { boardDescription } from "@/lib/dao-board";
import { NOT_FOUND } from "@/lib/routes";

// The same page as on testnet, which DaoBoard reads from the path (components/network.tsx); the
// note under it, in ./layout.tsx, names mainnet itself.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!isAccountId(id)) return NOT_FOUND;
  return { title: `Bounty board, ${id} on mainnet`, description: boardDescription(MAINNET, id) };
}

export default async function MainnetDaoBoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DaoBoard daoId={id} />;
}
