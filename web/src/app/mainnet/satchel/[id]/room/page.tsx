import type { Metadata } from "next";
import { MAINNET } from "satchel-nft";
import { roomDescription } from "@/lib/showcase";

// The same page on mainnet: it reads the network from the path (components/network.tsx).
export { default } from "../../../../satchel/[id]/room/page";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Holder room, Satchel #${id} on mainnet`, description: roomDescription(MAINNET, id) };
}
