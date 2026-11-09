import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TokenView } from "@/components/token-view";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Satchel #${id}` };
}

export default async function SatchelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,19}$/.test(id)) notFound();
  return <TokenView tokenId={id} />;
}
