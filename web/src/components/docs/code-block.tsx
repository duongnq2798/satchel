import { type BundledLanguage, type Highlighter, createCssVariablesTheme, createHighlighter } from "shiki";
import { CopyCode } from "./copy-code";

/**
 * A fenced code block, highlighted at build time. Token colors are CSS variables (globals.css), so
 * one rendering serves the light and the dark theme. `text` blocks that hold a report's output get
 * its verdict colors instead.
 */

const theme = createCssVariablesTheme({ name: "satchel", variablePrefix: "--shiki-", fontStyle: true });

const LANGS: Record<string, { lang: BundledLanguage; label: string }> = {
  bash: { lang: "bash", label: "Terminal" },
  sh: { lang: "bash", label: "Terminal" },
  shell: { lang: "bash", label: "Terminal" },
  powershell: { lang: "powershell", label: "PowerShell" },
  ts: { lang: "typescript", label: "TypeScript" },
  typescript: { lang: "typescript", label: "TypeScript" },
  tsx: { lang: "tsx", label: "TSX" },
  js: { lang: "javascript", label: "JavaScript" },
  javascript: { lang: "javascript", label: "JavaScript" },
  json: { lang: "json", label: "JSON" },
  rust: { lang: "rust", label: "Rust" },
  toml: { lang: "toml", label: "TOML" },
  yaml: { lang: "yaml", label: "YAML" },
  diff: { lang: "diff", label: "Diff" },
};

let highlighter: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  highlighter ??= createHighlighter({ themes: [theme], langs: [...new Set(Object.values(LANGS).map((l) => l.lang))] });
  return highlighter;
}

export async function CodeBlock({ code, lang, title }: { code: string; lang: string; title?: string }) {
  const known = LANGS[lang];
  const label = title ?? known?.label ?? (lang === "text" || lang === "" ? "Output" : lang);
  return (
    <figure className="docs-code not-prose">
      <figcaption className="flex items-center justify-between gap-3 border-b border-line px-4 py-1.5">
        <span className="font-mono text-xs text-muted">{label}</span>
        <CopyCode code={code} />
      </figcaption>
      {known ? (
        <div
          className="docs-code-body"
          // Shiki escapes the code; the markup is its own spans.
          dangerouslySetInnerHTML={{ __html: (await getHighlighter()).codeToHtml(code, { lang: known.lang, theme: "satchel" }) }}
        />
      ) : (
        <div className="docs-code-body">
          <pre>
            <code>{code.split("\n").map((line, i) => <OutputLine key={i} line={line} />)}</code>
          </pre>
        </div>
      )}
    </figure>
  );
}

/** One line of a command's output, with the report's [PASS], [FAIL] and verdict picked out. */
function OutputLine({ line }: { line: string }) {
  // The CLI marks a check it couldn't read [????].
  const tag = /^(\s*)(\[PASS\]|\[FAIL\]|\[\?\?\?\?\])(.*)$/.exec(line);
  if (tag) {
    const tone = tag[2] === "[PASS]" ? "text-ok" : tag[2] === "[FAIL]" ? "text-warn" : "text-muted";
    return (
      <span className="line">
        {tag[1]}
        <span className={`font-semibold ${tone}`}>{tag[2]}</span>
        {tag[3]}
        {"\n"}
      </span>
    );
  }
  const verdict = /^(PROVABLY CLEAN|NOT PROVABLE|COULD NOT CHECK EVERYTHING)(.*)$/.exec(line);
  if (verdict) {
    const tone = verdict[1] === "PROVABLY CLEAN" ? "text-ok" : verdict[1] === "NOT PROVABLE" ? "text-warn" : "text-muted";
    return (
      <span className="line">
        <span className={`font-bold ${tone}`}>{verdict[1]}</span>
        {verdict[2]}
        {"\n"}
      </span>
    );
  }
  if (line.startsWith("$ ")) {
    return (
      <span className="line">
        <span className="select-none text-muted">$ </span>
        <span className="font-medium">{line.slice(2)}</span>
        {"\n"}
      </span>
    );
  }
  return (
    <span className="line">
      {line}
      {"\n"}
    </span>
  );
}
