import type { CSSProperties, ReactNode } from "react";
import { MAINNET, REPO_URL, nearTxUrl } from "satchel-nft";
import { MAINNET_SALE } from "@/lib/showcase";
import { deedItalic } from "./font";

/** The README's table of the sale, every step with its transaction: linked from the teaser and the full deed. */
export const README_SALE = `${REPO_URL}#satchel-3-sold-to-a-second-account`;

/** A mark's tilt and, for the press, how long it waits after the one before it. */
interface Tilt {
  rot: string;
  delay?: string;
}

const tilt = ({ rot, delay }: Tilt) => ({ "--deed-rot": rot, ...(delay && { "--deed-delay": delay }) }) as CSSProperties;

/**
 * A rubber stamp: a short line on top, the big word, a short line under it. Decorative: what it says
 * is in the text beside it, so screen readers skip it. `data-ink` lets DeedDefs press it in.
 */
export function Stamp({
  top,
  big,
  sub,
  tone = "ok",
  small = false,
  ...rest
}: Tilt & { top?: string; big: ReactNode; sub?: string; tone?: "ok" | "bad"; small?: boolean }) {
  const kind = `${tone === "bad" ? " deed-stamp-bad" : ""}${small ? " deed-stamp-small" : ""}`;
  return (
    <span className={`deed-stamp${kind}`} data-ink="" style={tilt(rest)} aria-hidden="true">
      <span className="deed-stamp-ink">
        {top && <span className="deed-s-top">{top}</span>}
        <span className="deed-s-big">{big}</span>
        {sub && <span className="deed-s-sub">{sub}</span>}
      </span>
    </span>
  );
}

/** The buyer's report as a stamp: PROVABLY CLEAN, over two lines. */
export function CleanStamp(props: Tilt & { top?: string; sub?: string; small?: boolean }) {
  return (
    <Stamp
      big={
        <>
          Provably
          <br />
          clean
        </>
      }
      {...props}
    />
  );
}

/** The wax seal on the purchase, ribbons and all (the deed-seal symbol). Decorative. */
export function WaxSeal(props: Tilt) {
  return (
    <svg className="deed-seal" data-ink="" style={tilt(props)} viewBox="0 0 200 244" aria-hidden="true" focusable="false">
      <use href="#deed-seal" />
    </svg>
  );
}

/** The leather medallion with the satchel's number in gold foil, inside an engraved rosette. */
export function Medallion({ large = false }: { large?: boolean }) {
  return (
    <div className={`deed-medallion${large ? " deed-medallion-lg" : ""}`} aria-hidden="true">
      <svg focusable="false">
        <use href="#deed-rosette" />
      </svg>
      <div className="deed-med-text">
        <span className="deed-med-no">No.</span>
        <span className="deed-med-num" data-sheen="">
          {MAINNET_SALE.tokenId}
        </span>
      </div>
    </div>
  );
}

/** The engraved rule under the deed's title. */
export function Flourish() {
  return (
    <svg className="deed-flourish" viewBox="0 0 220 14" aria-hidden="true" focusable="false">
      <path d="M2 7 H92 M128 7 H218" className="deed-g-rule" />
      <path d="M20 10 H92 M128 10 H200" className="deed-g-hair" />
      <path d="M110 1 L117 7 L110 13 L103 7 Z" className="deed-g-rule" />
      <circle cx="110" cy="7" r="1.6" className="deed-g-dot" />
      <circle cx="96" cy="7" r="1.3" className="deed-g-dot" />
      <circle cx="124" cy="7" r="1.3" className="deed-g-dot" />
    </svg>
  );
}

/** The contract and the MPC network the deed was made on, over its title. */
export function Kicker() {
  return (
    <p className="deed-kicker">
      <span>NEAR mainnet</span>
      <span>{MAINNET.contract}</span>
      <span>MPC contract {MAINNET.mpc}</span>
    </p>
  );
}

/** "FFYeAe…3Kbo": a hash short enough for a narrow column. */
const shortHash = (hash: string) => `${hash.slice(0, 6)}…${hash.slice(-4)}`;

/**
 * A mainnet transaction on NearBlocks. A screen reader hears `what` it is ("the buy") after the hash,
 * so the link says where it goes on its own. `short` shows the hash's first and last characters, and
 * says the whole hash too.
 */
export function TxHash({ hash, what, short = false }: { hash: string; what: string; short?: boolean }) {
  return (
    <a className="deed-hash" href={nearTxUrl(MAINNET, hash)} target="_blank" rel="noreferrer" title={short ? hash : undefined}>
      {short ? shortHash(hash) : hash}
      <span className="sr-only">{short ? `, ${what}, transaction ${hash}` : `, ${what}`}</span>
      <span aria-hidden="true">&nbsp;↗</span>
    </a>
  );
}

/**
 * The deed's paper: a second sheet under it, the guilloche band and the grain. `labelledBy` names
 * the heading inside that titles it. deed-clip trims the turned second sheet at the column's edge.
 */
export function DeedSheet({ labelledBy, full = false, children }: { labelledBy: string; full?: boolean; children: ReactNode }) {
  return (
    <div className="deed-clip">
      <div className={`deed-stack ${deedItalic.variable}`}>
        <article className={`deed-sheet${full ? " deed-full" : ""}`} aria-labelledby={labelledBy}>
          <Grain />
          <div className="deed-in">{children}</div>
        </article>
      </div>
    </div>
  );
}

/** The paper's grain, from the deed-grain filter. */
export function Grain() {
  return (
    <svg className="deed-grain" aria-hidden="true" focusable="false">
      <rect width="100%" height="100%" filter="url(#deed-grain)" />
    </svg>
  );
}

/** The builder's declaration that the sale was between two of the builder's own accounts. */
export function Declaration() {
  return (
    <aside className="deed-declare" aria-label="Declaration">
      <p className="deed-declare-tag">Declared by the builder</p>
      <p className="deed-declare-text">
        <strong>A self-sale</strong> between two of the builder&apos;s accounts: it shows each step on mainnet, not a market
        price.
      </p>
    </aside>
  );
}
