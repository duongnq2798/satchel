import { loadDoc } from "@/lib/docs/load";
import { PAGES } from "@/lib/docs/nav";
import type { SearchEntry } from "@/lib/docs/search";

/** The search index, built with the site: one entry per page lead and per section. */
export const dynamic = "force-static";

export async function GET() {
  const entries: SearchEntry[] = [];
  for (const page of PAGES) {
    const doc = await loadDoc(page.slug);
    if (!doc) continue;
    // The page's own entry: its lead, then whatever comes before its first heading.
    const intro = doc.sections.find((s) => s.id === "")?.text ?? "";
    entries.push({ href: page.href, page: page.title, section: page.section, heading: "", text: `${page.description} ${intro}`.trim() });
    for (const s of doc.sections) {
      if (s.id === "") continue;
      entries.push({
        href: `${page.href}#${s.id}`,
        page: page.title,
        section: page.section,
        heading: s.heading,
        text: s.text,
      });
    }
  }
  return Response.json(entries);
}
