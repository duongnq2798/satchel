import type { Metadata } from "next";
import { TESTNET } from "satchel-nft";
import { TokenView } from "@/components/token-view";
import { tokenDescription } from "@/lib/showcase";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Satchel #${id}`, description: tokenDescription(TESTNET, id) };
}

/** The id is checked in ../layout.tsx, above this page's loading fallback; the note under it is in ./layout.tsx. */
export default async function SatchelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TokenView tokenId={id} />;
}
