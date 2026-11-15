import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { isSatchelId } from "@/lib/routes";

/** A satchel's id is checked here, above every loading fallback under it, so a bad id still answers 404. */
export default async function SatchelIdLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSatchelId(id)) notFound();
  return children;
}
