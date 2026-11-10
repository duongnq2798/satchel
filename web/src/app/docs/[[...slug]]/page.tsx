import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { REPO_URL } from "satchel-nft";
import { Feedback } from "@/components/docs/feedback";
import { mdxComponents } from "@/components/docs/mdx";
import { Toc } from "@/components/docs/toc";
import { loadDoc, repoPath } from "@/lib/docs/load";
import { PAGES, docHref, findPage, neighbours } from "@/lib/docs/nav";

export const dynamicParams = false;

export function generateStaticParams() {
  return PAGES.map((p) => ({ slug: p.slug === "" ? [] : p.slug.split("/") }));
}

type Props = { params: Promise<{ slug?: string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = findPage((await params).slug?.join("/") ?? "");
  if (!page) return {};
  return {
    title: page.slug === "" ? { absolute: "Satchel documentation" } : page.title,
    description: page.description,
    alternates: { canonical: page.href },
    openGraph: { type: "article", title: page.title, description: page.description, url: page.href, siteName: "Satchel" },
  };
}

export default async function DocPage({ params }: Props) {
  const slug = (await params).slug?.join("/") ?? "";
  const doc = await loadDoc(slug);
  if (!doc) notFound();
  const { page, Content, toc } = doc;
  const { prev, next } = neighbours(slug);
  const file = repoPath(page);
  const crumbs = [
    { name: "Docs", href: "/docs" },
    ...(page.slug === "" ? [] : [{ name: page.section, href: undefined }, { name: page.nav ?? page.title, href: page.href }]),
  ];
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "TechArticle", headline: page.title, description: page.description, url: `https://satchelnft.xyz${page.href}` },
      {
        "@type": "BreadcrumbList",
        itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, ...(c.href ? { item: `https://satchelnft.xyz${c.href}` } : {}) })),
      },
    ],
  };

  return (
    <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_13rem] xl:gap-10">
      <article className="min-w-0">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
        <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted">
          <ol className="flex flex-wrap items-center gap-1.5">
            {crumbs.map((c, i) => (
              <li key={c.name} className="flex items-center gap-1.5">
                {i > 0 && <span aria-hidden="true">/</span>}
                {c.href && i < crumbs.length - 1 ? (
                  <Link href={c.href} className="hover:text-ink">
                    {c.name}
                  </Link>
                ) : (
                  <span aria-current={i === crumbs.length - 1 ? "page" : undefined}>{c.name}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
        <header className="mb-8 max-w-[46rem]">
          <h1 className="font-display text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl">{page.title}</h1>
          <p className="mt-3 text-lg leading-relaxed text-ink-2">{page.description}</p>
          {page.repoFile && (
            <p className="mt-3 text-sm text-muted">
              This page is <a href={`${REPO_URL}/blob/main/${page.repoFile}`} className="underline underline-offset-4 hover:text-ink">{page.repoFile}</a> from the repository, rendered as it is, so the two never differ.
            </p>
          )}
        </header>
        <Toc entries={toc} variant="inline" />
        <div className="docs-prose max-w-[46rem]">
          <Content components={mdxComponents} />
        </div>
        <div className="mt-14 max-w-[46rem] space-y-6">
          <Feedback slug={page.slug} title={page.title} />
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
            <a href={`${REPO_URL}/edit/dev/${file}`} target="_blank" rel="noreferrer" className="hover:text-ink">
              Edit this page on GitHub
            </a>
            <a href={`${REPO_URL}/commits/dev/${file}`} target="_blank" rel="noreferrer" className="hover:text-ink">
              Page history
            </a>
          </div>
          <nav aria-label="Previous and next pages" className="grid gap-3 sm:grid-cols-2">
            {prev ? (
              <Link href={prev.href} className="group rounded-xl border border-line p-4 transition hover:border-ink/40">
                <span className="text-xs text-muted">Previous</span>
                <span className="mt-1 block font-medium group-hover:text-ink">← {prev.nav ?? prev.title}</span>
              </Link>
            ) : (
              <span />
            )}
            {next && (
              <Link href={next.href} className="group rounded-xl border border-line p-4 text-right transition hover:border-ink/40">
                <span className="text-xs text-muted">Next</span>
                <span className="mt-1 block font-medium group-hover:text-ink">{next.nav ?? next.title} →</span>
              </Link>
            )}
          </nav>
        </div>
      </article>
      <aside className="hidden xl:block">
        <div className="sticky top-20 max-h-[calc(100vh-5rem)] overflow-y-auto">
          <Toc entries={toc} />
          <div className="mt-6 border-t border-line pt-4 text-sm">
            <a href={docHref("security/report-a-vulnerability")} className="block py-0.5 text-ink-2 hover:text-ink">
              Report a vulnerability
            </a>
            <a href="#top" className="block py-0.5 text-ink-2 hover:text-ink">
              Back to top ↑
            </a>
          </div>
        </div>
      </aside>
    </div>
  );
}
