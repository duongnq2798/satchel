import type { Metadata } from "next";

// The same page on mainnet: it reads the network from the path (components/network.tsx).
export { default } from "../../../satchel/[id]/page";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Satchel #${id} on mainnet` };
}
