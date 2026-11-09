import { readFile } from "node:fs/promises";
import path from "node:path";
import { evaluate } from "@mdx-js/mdx";
import type { MDXContent } from "mdx/types";
import { cache } from "react";
import * as runtime from "react/jsx-runtime";
import remarkGfm from "remark-gfm";
import { type Collected, emptyCollected, remarkCodeMeta, remarkCollect, remarkRepoLinks } from "./markdown";
import { DEFAULT_LOCALE, type Locale, type PlacedPage, findPage } from "./nav";

/** Server only: reads a page's source from disk at build time. The app's working directory is web/. */
const WEB_ROOT = process.cwd();
const REPO_ROOT = path.resolve(WEB_ROOT, "..");

// Every docs page and the search index are prerendered, so nothing reads these files at run time:
// the ignore comments keep the build from tracing the whole repository into the server bundle.
export function sourceFile(page: PlacedPage, locale: Locale = DEFAULT_LOCALE): string {
  if (page.repoFile) return path.join(/*turbopackIgnore: true*/ REPO_ROOT, page.repoFile);
  return path.join(WEB_ROOT, "content", "docs", locale, `${page.slug === "" ? "index" : page.slug}.mdx`);
}

/** The file's path from the repository root, for "Edit this page" links. */
export function repoPath(page: PlacedPage, locale: Locale = DEFAULT_LOCALE): string {
  return path.relative(REPO_ROOT, sourceFile(page, locale)).split(path.sep).join("/");
}

export interface LoadedDoc extends Collected {
  page: PlacedPage;
  Content: MDXContent;
}

export const loadDoc = cache(async (slug: string, locale: Locale = DEFAULT_LOCALE): Promise<LoadedDoc | null> => {
  const page = findPage(slug);
  if (!page) return null;
  let source = await readFile(/*turbopackIgnore: true*/ sourceFile(page, locale), "utf8");
  // A repository file opens with its own # title; the page shows the nav's title instead.
  if (page.repoFile) source = source.replace(/^﻿?#\s[^\n]*\n/, "");
  const collected = emptyCollected();
  const { default: Content } = await evaluate(source, {
    ...runtime,
    format: page.repoFile ? "md" : "mdx",
    remarkPlugins: [remarkGfm, ...(page.repoFile ? [remarkRepoLinks(page.repoFile)] : []), remarkCollect(collected), remarkCodeMeta],
  });
  return { page, Content, ...collected };
});
