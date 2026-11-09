# Writing the docs

The documentation at <https://satchelnft.xyz/docs> is built from this folder with the web app. Each
page is an MDX file in `docs/<locale>/`; `en` is the only locale so far.

## Add or change a page

1. Add the page to `web/src/lib/docs/nav.ts`, in the section and position a reader should meet it.
   Its `title` is the page's `<h1>` and `<title>`, its `description` the lead under the title, the
   meta description and the search snippet. The order there is the sidebar's and Previous/Next's.
2. Write `docs/en/<slug>.mdx`. Don't add an `#` title or repeat the description: start with what
   the page adds.
3. Run the docs test from `web/`:

   ```bash
   npx vitest run src/lib/docs/docs.test.ts
   ```

   It fails if a page in `nav.ts` has no file or a file has no page, if two headings on a page share
   an id, or if any link points at a docs page, a heading or an app route that doesn't exist.

4. See it: `npm run dev` in `web/`, then open <http://localhost:3000/docs>.

A page can also render a file the repository already keeps (`repoFile` in `nav.ts`), as the threat
model, `AGENTS.md`, `SECURITY.md` and the changelog do. Change those files, not a copy of them. Their
relative links go to the matching docs page, or to the file on GitHub.

## What every page needs

- **A purpose a reader can name.** A guide ends with the reader having done something; a reference
  page answers a lookup; a concept page explains why. If a page does none of these, merge it.
- **Only what the code does.** Every method, flag, error string, number and output comes from the
  source (`contracts/satchel/src`, `packages/satchel-nft/src`, `web/src`) or from a command you ran.
  Paste real output, and say which network and date it came from when it can change.
- **What to do next.** End with a "Next steps" or "Related" section of two to four links.
- **The network.** Say whether a step is on testnet or mainnet whenever it matters. Real funds get a
  `danger` callout.

## Style

- Plain, short sentences in the second person, as in the README. No marketing words.
- `##` for sections, `###` for subsections; never a heading inside a component.
- Code fences name their language (`bash`, `ts`, `json`, `rust`, `powershell`, or `text` for a
  program's output, which colors `[PASS]`, `[FAIL]` and the verdicts). `title="..."` names a block.
- In prose, put `{`, `}` and `<` in inline code: MDX reads them as JSX otherwise.

## Components

Available in every `.mdx` page without an import (`web/src/components/docs/mdx.tsx`):

| Component | Use |
| --- | --- |
| `<Callout type="note\|tip\|warning\|danger" title="…">` | One point that must not be missed. `danger` is for real funds |
| `<Steps>` around an ordered list | Numbered steps with a rail |
| `<Cards>` and `<Card href title eyebrow>` | Where to go next, as a grid |
| `<Tabs labels={[…]}>` with one `<Tab>` per label | The same step done two ways, like the app and the CLI |
| `<Figure src alt caption>` | A screenshot from `web/public/docs/` |
| `<Kbd>`, `<Verdict v="clean\|not-provable\|unknown">` | A key; a report's verdict |
| `<ArchitectureDiagram>`, `<SaleDiagram>`, `<ChecksDiagram>` | The diagrams in `diagrams.tsx` |

## Search, SEO and translations

- Search reads `/docs/search-index.json`, built from every page's sections at build time. Nothing to
  update by hand.
- `/sitemap.xml`, `/robots.txt` and `/llms.txt` list every page in `nav.ts`.
- A second language goes in `docs/<locale>/` with the same file names; add the locale to `LOCALES`
  in `nav.ts` and route it before publishing.
