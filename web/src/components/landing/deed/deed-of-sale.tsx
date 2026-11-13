import { Fragment, type ReactNode } from "react";
import { MAINNET, chainInfo } from "satchel-nft";
import { CHECKS } from "@/lib/copy";
import { MAINNET_CLAIMS, MAINNET_SALE, formatSpan, utcDate, utcTime, verifyCommand } from "@/lib/showcase";
import { CleanStamp, Declaration, DeedSheet, Flourish, Kicker, Medallion, README_SALE, Stamp, TxHash, WaxSeal } from "./marks";
import { REFUSED_AFTER, SaleRuler } from "./ruler";

const sale = MAINNET_SALE;
const COMMAND = verifyCommand(MAINNET, sale.tokenId);
/** "0x…dEaD": the refused call's recipient, as short as the deed writes addresses; a word joiner keeps a line from breaking after the "…". */
const SINK = `0x…\u2060${sale.refused.to.slice(-4)}`;
const CHAIN = chainInfo(sale.refused.chainId)?.name ?? `chain ${sale.refused.chainId}`;
/**
 * The refused call after its "→", in groups held together by no-break spaces, so a narrow column
 * breaks it only after a "·": never inside "value 0" or before a "·".
 */
const ATTEMPT = [`sign_evm(token ${sale.tokenId}) ·`, `${CHAIN} ·`, `value ${sale.refused.value} ·`, `to ${SINK}`]
  .map((group) => group.replaceAll(" ", "\u00a0"))
  .join(" ");

/** One clause: its numeral, when it happened and in which block, what happened, its references, its mark. */
function Clause({
  n,
  title,
  at,
  block,
  badge,
  refs,
  mark,
  children,
}: {
  n: string;
  title: string;
  at: string;
  /** The block that included the transaction; none for a read. */
  block?: string;
  badge?: string;
  refs: ReactNode;
  mark?: ReactNode;
  children: ReactNode;
}) {
  return (
    <li className="deed-clause">
      <div className="deed-c-head">
        <span className="deed-c-num" aria-hidden="true">
          {n}
        </span>
        <p className="deed-c-when">
          <time dateTime={at}>{utcTime(at)}</time>
          <span>{block ? `tx in block ${block}` : "a read, no transaction"}</span>
        </p>
        {badge && <span className="deed-pill-bad">{badge}</span>}
      </div>
      <div className="deed-c-body">
        <h4 className="deed-c-title">
          <span className="sr-only">Clause {n}: </span>
          {title}
        </h4>
        {children}
      </div>
      <div className="deed-c-refs">{refs}</div>
      {mark && <div className="deed-c-mark">{mark}</div>}
    </li>
  );
}

function Reference({ hash, what }: { hash: string; what: string }) {
  return (
    <p>
      <span className="deed-ref-k">Reference</span>
      <TxHash hash={hash} what={what} />
    </p>
  );
}

const FLAG = "--network mainnet";

/** A command, each word kept whole so a narrow column breaks it only at spaces, never after a dash. */
function Command({ text }: { text: string }) {
  return text.split(" ").map((word, i) => (
    <Fragment key={`${i}:${word}`}>
      {i > 0 && " "}
      <span className="deed-nb">{word}</span>
    </Fragment>
  ));
}

function Rerun() {
  return (
    <p>
      <span className="deed-ref-k">Re-run</span>
      <code className="deed-cmd">
        <Command text={COMMAND} />
      </code>
    </p>
  );
}

/**
 * Satchel #3's deed of sale, clause by clause, for its page: the parties, the builder's declaration,
 * the ruler, one clause per step with its time, block and hash, the parties' hands, and the commands
 * that check it again.
 */
export function DeedOfSale() {
  return (
    <section id="deed" className="deed-section scroll-mt-24" aria-labelledby="deed-heading">
      <p className="text-sm font-medium tracking-wide text-leather">
        Satchel #{sale.tokenId} · a self-sale, {utcDate(sale.mint.at)}
      </p>
      <h2 id="deed-heading" className="mt-3 max-w-3xl font-display text-[2rem] leading-[1.08] font-semibold tracking-tight sm:text-[2.5rem]">
        The deed of sale, clause by clause.
      </h2>
      <p className="mt-4 text-[1.0625rem] leading-relaxed text-ink-2 sm:text-lg">
        <strong className="font-semibold text-ink">
          A self-sale between two of the builder&apos;s accounts: it shows each step on mainnet, not a market price.
        </strong>{" "}
        One clause per step, with its time in UTC and, for each transaction, the block that included it and its hash. The
        README gives the next block, where its receipts began to run.
      </p>

      <DeedSheet labelledBy="deed-title" full>
        <header className="deed-head">
          <Kicker />
          <Medallion large />
          <h3 className="deed-title" id="deed-title">
            Deed of Sale<span className="sr-only">, No. {sale.tokenId}</span>
          </h3>
          <Flourish />
          <p className="deed-sub">of satchel #{sale.tokenId}, and with it the right to sign on every chain</p>
        </header>

        <dl className="deed-parties">
          <div className="deed-party">
            <dt>The seller</dt>
            <dd>{sale.seller}</dd>
          </div>
          <div className="deed-party">
            <dt>The buyer</dt>
            <dd>{sale.buyer}</dd>
          </div>
          <div className="deed-party">
            <dt>The price</dt>
            <dd className="deed-serif">{sale.price} NEAR</dd>
          </div>
          <div className="deed-party">
            <dt>Record version named</dt>
            <dd className="deed-serif">{sale.recordVersion}</dd>
          </div>
          <div className="deed-party">
            <dt>The token</dt>
            <dd>
              #{sale.tokenId} · MPC path {sale.path}
            </dd>
          </div>
          <div className="deed-party">
            <dt>On contract</dt>
            <dd>{MAINNET.contract}</dd>
          </div>
          <div className="deed-party deed-party-wide">
            <dt>Its EVM address</dt>
            <dd>
              {sale.address}
              <span className="deed-party-note">At the sale it held nothing, and nothing had ever been signed for it.</span>
            </dd>
          </div>
        </dl>

        <Declaration />

        <SaleRuler note="Each mark is a clause below" />

        <p className="deed-clauses-intro">
          On {utcDate(sale.mint.at)}, in this order: four transactions on NEAR mainnet and two reads of it
        </p>

        <ol className="deed-clauses">
          <Clause n="I" title="Minted" at={sale.mint.at} block={sale.mint.block} refs={<Reference hash={sale.mint.tx} what="the mint" />}>
            <p className="deed-c-text">
              {sale.seller} minted satchel #{sale.tokenId} for {sale.mint.deposit} NEAR, at MPC path {sale.path}.
            </p>
          </Clause>

          <Clause
            n="II"
            title="Listed, and signing frozen"
            at={sale.list.at}
            block={sale.list.block}
            refs={<Reference hash={sale.list.tx} what="the listing" />}
          >
            <p className="deed-c-text">
              The seller listed it for {sale.price} NEAR at record version {sale.recordVersion}. Listing freezes signing: while
              it is listed, the contract signs nothing for it.
            </p>
          </Clause>

          <Clause
            n="III"
            title="Checked before payment"
            at={sale.checked.at}
            refs={<Rerun />}
            mark={<CleanStamp top="Before payment" sub={`record v${sale.recordVersion}`} rot="-8deg" />}
          >
            <p className="deed-c-text">
              The buyer&apos;s report read <strong>{sale.checked.result}</strong>: nothing was ever signed for this token, and
              the record stood at version {sale.recordVersion}. Four checks passed:
            </p>
            <ul className="deed-checks">
              {CHECKS.map((c) => (
                <li key={c.title}>
                  <span className="deed-tick" aria-hidden="true">
                    ✓
                  </span>
                  {c.title}
                </li>
              ))}
            </ul>
          </Clause>

          <Clause
            n="IV"
            title="Bought, in one transaction"
            at={sale.buy.at}
            block={sale.buy.block}
            refs={
              <>
                <Reference hash={sale.buy.tx} what="the buy" />
                <p>
                  <span className="deed-ref-k">Payment</span>
                  {sale.price} NEAR to {sale.buy.paid.to}, receipt <span className="deed-receipt">{sale.buy.paid.receipt}</span>
                </p>
              </>
            }
            mark={<WaxSeal rot="7deg" delay=".05s" />}
          >
            <p className="deed-c-text">
              {sale.buyer} bought it in the app at satchelnft.xyz, naming record version {sale.recordVersion} and the price.
              In that one NEAR transaction the NFT, and with it the right to sign on every chain, moved to the buyer, and{" "}
              {sale.buy.paid.to} was paid {sale.price} NEAR.
            </p>
          </Clause>

          <Clause
            n="V"
            title="The old owner tried to sign"
            at={sale.refused.at}
            block={sale.refused.block}
            badge={`${formatSpan(REFUSED_AFTER)} after the sale`}
            refs={<Reference hash={sale.refused.tx} what="the refused call" />}
          >
            <p className="deed-c-text">
              {sale.seller}, the old owner, called sign_evm for #{sale.tokenId}: a {sale.refused.value}&#8209;value {CHAIN}{" "}
              transaction to {SINK}.
            </p>
            <div className="deed-attempt">
              <p className="deed-attempt-k">Attempted after the sale</p>
              <p className="deed-attempt-line">
                {sale.seller}&nbsp;<span className="deed-arrow">→</span> {ATTEMPT}
              </p>
              <Stamp tone="bad" top="On chain" big="Refused" sub={utcTime(sale.refused.at)} rot="-9deg" delay=".15s" />
            </div>
            <figure className="deed-words">
              <figcaption>The chain refused it, in its own words:</figcaption>
              <blockquote>
                <p>{sale.refused.panic}</p>
              </blockquote>
            </figure>
          </Clause>

          <Clause
            n="VI"
            title="Checked again"
            at={sale.checkedAgain.at}
            refs={<Rerun />}
            mark={<CleanStamp top="After the sale" sub="new owner" rot="5deg" small />}
          >
            <p className="deed-c-text">
              The report read <strong>{sale.checkedAgain.result}</strong> again, for the new owner {sale.checkedAgain.owner}, at
              record version {sale.recordVersion}.
            </p>
          </Clause>
        </ol>

        <div className="deed-hands">
          <div>
            <p className="deed-hand-k">The seller&apos;s hand</p>
            <p className="deed-hand-name">{sale.seller}</p>
            <p className="deed-hand-ref">
              signed the listing, <TxHash hash={sale.list.tx} short what="the listing" />
            </p>
          </div>
          <div>
            <p className="deed-hand-k">The buyer&apos;s hand</p>
            <p className="deed-hand-name">{sale.buyer}</p>
            <p className="deed-hand-ref">
              signed the purchase, <TxHash hash={sale.buy.tx} short what="the buy" />
            </p>
          </div>
        </div>
        <p className="deed-folio">
          Deed No. {sale.tokenId} · NEAR mainnet · transactions in blocks {sale.mint.block} to {sale.refused.block}
        </p>
      </DeedSheet>

      <div className="deed-recheck">
        <div>
          <h3>Don&apos;t take the deed&apos;s word for it.</h3>
          <p>Every reference opens on NearBlocks. Anyone can re-run the buyer&apos;s report, or check every claim from the repo.</p>
          <ul className="deed-read-links">
            <li>
              <a href={README_SALE} target="_blank" rel="noreferrer">
                Every step, in the README<span aria-hidden="true">&nbsp;↗</span>
              </a>
            </li>
          </ul>
        </div>
        <pre className="deed-term">
          {"$ "}
          <Command text={COMMAND} />
          {"\n"}
          <span className="deed-term-note">{`# runs the buyer's report on #${sale.tokenId} again, against today's state`}</span>
          {"\n$ "}
          <Command text={`node scripts/check-claims.mjs ${FLAG}`} />
          {"\n"}
          <span className="deed-term-note">{`# in the repo: ${MAINNET_CLAIMS.total} claims, ${MAINNET_CLAIMS.sale} of them about this sale`}</span>
        </pre>
      </div>
    </section>
  );
}
