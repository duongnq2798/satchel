import Link from "next/link";
import { MAINNET } from "satchel-nft";
import { appPath } from "@/lib/routes";
import { MAINNET_SALE, formatSpan, utcDate, utcTime } from "@/lib/showcase";
import { CleanStamp, Declaration, DeedSheet, Flourish, Kicker, Medallion, README_SALE, Stamp, TxHash, WaxSeal } from "./marks";
import { REFUSED_AFTER, SaleRuler } from "./ruler";

const sale = MAINNET_SALE;

/** The chain's own words, without the runtime's prefix. */
const REFUSAL = sale.refused.panic.replace(/^Smart contract panicked: /, "");

/**
 * The landing's teaser of satchel #3's deed: its face (medallion, parties, the builder's declaration),
 * the three steps that prove the sale (checked, bought, refused), the ruler of all six, and the way
 * to the full deed on the satchel's page.
 */
export function DeedTeaser() {
  return (
    <DeedSheet labelledBy="deed-teaser-title">
      <Kicker />
      <div className="deed-tz-grid">
        <div>
          <header className="deed-head">
            <Medallion />
            <h3 className="deed-title" id="deed-teaser-title">
              Deed of Sale<span className="sr-only">, No. {sale.tokenId}</span>
            </h3>
            <Flourish />
            <p className="deed-sub">of satchel #{sale.tokenId}, and with it the right to sign on every chain,</p>
            <p className="deed-between">
              between <span className="deed-acct">{sale.seller}</span>, the seller, and <span className="deed-acct">{sale.buyer}</span>,
              the buyer, for {sale.price}&nbsp;NEAR at record version&nbsp;{sale.recordVersion}
            </p>
          </header>
          <Declaration />
        </div>

        <ol aria-label="The three steps that prove the sale">
          <li className="deed-reg">
            <span className="deed-reg-num" aria-hidden="true">
              III
            </span>
            <div className="deed-reg-head">
              <p className="deed-reg-when">
                <time dateTime={sale.checked.at}>{utcTime(sale.checked.at)}</time> · a read, no transaction
              </p>
              <h4 className="deed-reg-title">
                <span className="sr-only">Step III: </span>Checked before payment
              </h4>
            </div>
            <p className="deed-reg-text">
              The buyer&apos;s report read <strong>{sale.checked.result}</strong>: nothing ever signed for it, record version{" "}
              {sale.recordVersion}, four checks passed.
            </p>
            <div className="deed-reg-mark">
              <CleanStamp top="Before payment" sub={`record v${sale.recordVersion}`} rot="-8deg" />
            </div>
          </li>
          <li className="deed-reg">
            <span className="deed-reg-num" aria-hidden="true">
              IV
            </span>
            <div className="deed-reg-head">
              <p className="deed-reg-when">
                <time dateTime={sale.buy.at}>{utcTime(sale.buy.at)}</time> · tx in block {sale.buy.block}
              </p>
              <h4 className="deed-reg-title">
                <span className="sr-only">Step IV: </span>Bought, in one transaction
              </h4>
            </div>
            <p className="deed-reg-text">
              {sale.buyer} bought it in the app, naming record version {sale.recordVersion}. In that one NEAR transaction the NFT
              and the right to sign moved to the buyer, and {sale.buy.paid.to} was paid {sale.price}&nbsp;NEAR.
            </p>
            <p className="deed-reg-ref">
              <TxHash hash={sale.buy.tx} short what="the buy" />
            </p>
            <div className="deed-reg-mark">
              <WaxSeal rot="7deg" delay=".05s" />
            </div>
          </li>
          <li className="deed-reg">
            <span className="deed-reg-num" aria-hidden="true">
              V
            </span>
            <div className="deed-reg-head">
              <p className="deed-reg-when">
                <time dateTime={sale.refused.at}>{utcTime(sale.refused.at)}</time> · {formatSpan(REFUSED_AFTER)} after the sale
              </p>
              <h4 className="deed-reg-title">
                <span className="sr-only">Step V: </span>The old owner was refused
              </h4>
            </div>
            <p className="deed-reg-text">
              {sale.seller} called sign_evm for #{sale.tokenId}. The chain refused: “{REFUSAL}”.
            </p>
            <p className="deed-reg-ref">
              <TxHash hash={sale.refused.tx} short what="the refused call" />
            </p>
            <div className="deed-reg-mark">
              <Stamp tone="bad" top="On chain" big="Refused" sub={utcTime(sale.refused.at)} rot="-9deg" delay=".1s" />
            </div>
          </li>
        </ol>
      </div>

      <SaleRuler note={`Six steps, I to VI, all on ${utcDate(sale.mint.at)}`} />

      <div className="deed-tz-foot">
        <Link
          href={`${appPath(MAINNET, `/satchel/${sale.tokenId}`)}#deed`}
          className="rounded-full bg-ink px-6 py-3 text-sm font-medium text-paper transition hover:bg-leather"
        >
          Read the full deed <span aria-hidden="true">→</span>
        </Link>
        <a className="deed-link" href={README_SALE} target="_blank" rel="noreferrer">
          Every step, in the README<span aria-hidden="true"> ↗</span>
        </a>
        <Link className="deed-link" href={appPath(MAINNET, `/satchel/${sale.tokenId}`)}>
          Satchel #{sale.tokenId}&apos;s live page<span aria-hidden="true"> →</span>
        </Link>
      </div>
    </DeedSheet>
  );
}
