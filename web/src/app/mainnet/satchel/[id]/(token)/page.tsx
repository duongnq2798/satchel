import type { Metadata } from "next";
import { MAINNET } from "satchel-nft";
import { TokenView } from "@/components/token-view";
import { tokenDescription } from "@/lib/showcase";

// The same page as on testnet, which TokenView reads from the path (components/network.tsx); the
// note and #3's deed under it, in ./layout.tsx, name mainnet themselves.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Satchel #${id} on mainnet`, description: tokenDescription(MAINNET, id) };
}

export default async function MainnetSatchelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TokenView tokenId={id} />;
}
