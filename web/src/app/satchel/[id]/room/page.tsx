import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HolderRoom } from "@/components/holder-room";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Holder room, Satchel #${id}` };
}

export default async function HolderRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,19}$/.test(id)) notFound();
  return <HolderRoom tokenId={id} />;
}
