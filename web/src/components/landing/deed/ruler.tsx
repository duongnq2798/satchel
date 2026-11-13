import type { CSSProperties } from "react";
import { MAINNET_SALE, formatSpan, secondsBetween, utcTime } from "@/lib/showcase";

const sale = MAINNET_SALE;

/** The six steps, numbered as the deed's clauses, each with its dot's colour on the scale. */
const STEPS = [
  { n: "I", label: "Minted", at: sale.mint.at, dot: "" },
  { n: "II", label: "Listed", at: sale.list.at, dot: "gold" },
  { n: "III", label: "Checked", at: sale.checked.at, dot: "ok" },
  { n: "IV", label: "Bought", at: sale.buy.at, dot: "hide" },
  { n: "V", label: "Refused", at: sale.refused.at, dot: "bad" },
  { n: "VI", label: "Checked again", at: sale.checkedAgain.at, dot: "ok" },
] as const;

/** Seconds from the mint to `at`, and the whole span, mint to the second check. */
const since = (at: string) => secondsBetween(sale.mint.at, at);
const TOTAL = since(sale.checkedAgain.at);
/** Where `seconds` falls on the scale, as a CSS length. */
const at = (seconds: number) => `${Number(((seconds / TOTAL) * 100).toFixed(3))}%`;

const [listed, bought, refused] = [since(sale.list.at), since(sale.buy.at), since(sale.refused.at)];

/** The span from mint to the second check, as the ruler's caption counts it. */
const SPAN = formatSpan(TOTAL);
/** The old owner's refusal, after the sale. */
export const REFUSED_AFTER = secondsBetween(sale.buy.at, sale.refused.at);

/** What the scale shows, for a screen reader. */
const DESCRIPTION =
  `Timeline from ${utcTime(sale.mint.at).replace(" UTC", "")} to ${utcTime(sale.checkedAgain.at)}: minted; ` +
  `listed ${formatSpan(listed, true)} later, which froze signing until the sale; ` +
  `checked at ${formatSpan(since(sale.checked.at), true)}; bought at ${formatSpan(bought, true)}; ` +
  `the old owner was refused ${formatSpan(REFUSED_AFTER, true)} after the sale; checked again at ${formatSpan(TOTAL, true)}.`;

function Label({ step, end = false }: { step: (typeof STEPS)[number]; end?: boolean }) {
  return (
    <span className={`deed-r-lab${end ? " deed-r-end" : ""}`} style={{ left: at(since(step.at)) }}>
      <b>{step.n}</b>
      <span className="deed-w"> · {step.label}</span>
    </span>
  );
}

/**
 * The engraved scale: the six steps placed by the record's seconds, signing frozen from the listing to
 * the sale, and the seconds from the sale to the refusal. Tick marks every minute and every 10 seconds.
 */
export function SaleRuler({ note }: { note: string }) {
  const scale = { "--deed-minute": at(60), "--deed-ten-s": at(10) } as CSSProperties;
  return (
    <figure className="deed-ruler">
      <figcaption className="deed-ruler-cap">
        <strong>{SPAN}, mint to second check</strong>
        <span>{note}</span>
      </figcaption>
      <div className="deed-r-body" role="img" aria-label={DESCRIPTION}>
        <div className="deed-r-row deed-r-top">
          {STEPS.filter((_, i) => i % 2 === 0).map((s) => (
            <Label key={s.n} step={s} />
          ))}
        </div>
        <div className="deed-r-track" style={scale}>
          <span className="deed-r-frozen" style={{ left: at(listed), width: at(bought - listed) }} />
          {STEPS.map((s) => (
            <span key={s.n} className={`deed-r-dot${s.dot ? ` deed-r-dot-${s.dot}` : ""}`} style={{ left: at(since(s.at)) }} />
          ))}
        </div>
        <div className="deed-r-row deed-r-bot">
          {STEPS.filter((_, i) => i % 2 === 1).map((s, i, odd) => (
            <Label key={s.n} step={s} end={i === odd.length - 1} />
          ))}
        </div>
        <div className="deed-r-ann">
          <span className="deed-r-br" style={{ left: at(listed), width: at(bought - listed) }} />
          <span className="deed-r-br-lab" style={{ left: at((listed + bought) / 2) }}>
            <span className="deed-w">Listed: </span>signing frozen<span className="deed-w"> until the sale</span>
          </span>
          <span className="deed-r-br deed-r-bad" style={{ left: at(bought), width: at(refused - bought) }} />
          <span className="deed-r-br-lab deed-r-bad" style={{ left: at((bought + refused) / 2) }}>
            {formatSpan(REFUSED_AFTER)}
          </span>
        </div>
        <div className="deed-r-ends">
          <span>{utcTime(sale.mint.at)}</span>
          <span>{utcTime(sale.checkedAgain.at)}</span>
        </div>
      </div>
      <ol className="deed-r-legend" aria-hidden="true">
        {STEPS.map((s) => (
          <li key={s.n}>
            <b>{s.n}</b>
            {s.label}
          </li>
        ))}
      </ol>
    </figure>
  );
}
