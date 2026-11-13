import type { CSSProperties, ReactNode } from "react";

/** A mark's tilt and, for the press, how long it waits after the one before it. */
export interface Tilt {
  rot: string;
  delay?: string;
}

export const tilt = ({ rot, delay }: Tilt) => ({ "--deed-rot": rot, ...(delay && { "--deed-delay": delay }) }) as CSSProperties;

/**
 * How a mark is pressed in: "scroll" by StampPress (DeedDefs), for a mark the server draws; "mount" by
 * PressIn around it, for one that appears later, such as a verdict that arrives with its report.
 */
export type Press = "scroll" | "mount";

/**
 * A rubber stamp: a short line on top, the big word, a short line under it. Decorative: what it says
 * is in the text beside it, so screen readers skip it. Its styles and its ink filter come from
 * DeedDefs, which every page that shows a stamp renders.
 */
export function Stamp({
  top,
  big,
  sub,
  tone = "ok",
  small = false,
  press = "scroll",
  ...rest
}: Tilt & { top?: string; big: ReactNode; sub?: string; tone?: "ok" | "warn" | "bad"; small?: boolean; press?: Press }) {
  const kind = `${tone === "ok" ? "" : ` deed-stamp-${tone}`}${small ? " deed-stamp-small" : ""}`;
  return (
    <span className={`deed-stamp${kind}`} data-ink={press} style={tilt(rest)} aria-hidden="true">
      <span className="deed-stamp-ink">
        {top && <span className="deed-s-top">{top}</span>}
        <span className="deed-s-big">{big}</span>
        {sub && <span className="deed-s-sub">{sub}</span>}
      </span>
    </span>
  );
}
