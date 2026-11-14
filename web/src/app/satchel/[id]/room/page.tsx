import type { Metadata } from "next";
import { TESTNET } from "satchel-nft";
import { HolderRoom } from "@/components/holder-room";
import { roomDescription } from "@/lib/showcase";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Holder room, Satchel #${id}`, description: roomDescription(TESTNET, id) };
}

/** The id is checked in ../layout.tsx, above this page's loading fallback. */
export default async function HolderRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <HolderRoom tokenId={id} />;
}
