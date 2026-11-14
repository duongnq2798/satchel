"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

/** router.push inside a transition: `pending` until the new route, or its loading.tsx, commits. */
export function useNavigate(): { go: (href: string) => void; pending: boolean } {
  const router = useRouter();
  const [pending, start] = useTransition();
  return { go: (href) => start(() => router.push(href)), pending };
}
