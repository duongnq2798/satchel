import Link from "next/link";
import { MAINNET, nearTxUrl } from "satchel-nft";
import { appPath } from "@/lib/routes";
import { MAINNET_SALE, formatSpan, verifyCommand } from "@/lib/showcase";
import { deedItalic } from "./font";
import { CleanStamp, Grain, Stamp, WaxSeal } from "./marks";
import { REFUSED_AFTER } from "./ruler";

const sale = MAINNET_SALE;

const TXS = [
  { label: "Mint", hash: sale.mint.tx },
  { label: "The buy", hash: sale.buy.tx },
  { label: "The refused sign_evm", hash: sale.refused.tx },
];

/**
 * Satchel #3 on the /mainnet showcase, after the two that sent ETH: a small deed across both columns,
 * with what happened, its transactions, its live report and the way to its full deed.
 */
export function SaleCard() {
  const page = appPath(MAINNET, `/satchel/${sale.tokenId}`);
  return (
    <article className={`deed-card lg:col-span-2 ${deedItalic.variable}`}>
      <Grain />
      <div className="deed-card-in">
        <div>
          <p className="text-sm font-medium text-leather">Satchel #{sale.tokenId}</p>
          <h3 className="mt-2 font-display text-2xl leading-snug font-semibold">Sold to a second account. Then the old owner was refused.</h3>
          <p className="mt-1.5 text-[15px] font-medium text-ink">
            A self-sale between two of the builder&apos;s accounts: it shows each step on mainnet, not a market price.
          </p>
          <p className="mt-3 font-mono text-xs break-all text-ink-2">{sale.address}</p>
          <p className="mt-3 text-sm leading-relaxed text-ink-2">
            The buyer checked it before paying: {sale.checked.result}. One NEAR transaction moved the NFT, and with it the right
            to sign on every chain, and paid {sale.buy.paid.to} {sale.price}&nbsp;NEAR. {formatSpan(REFUSED_AFTER, true)} later the
            old owner&apos;s sign_evm for it was refused on chain.
          </p>
          <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {TXS.map((tx) => (
              <li key={tx.hash}>
                <a
                  href={nearTxUrl(MAINNET, tx.hash)}
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-gold underline-offset-4 hover:decoration-2"
                >
                  {tx.label}
                  {/* Each card has a Mint link: a screen reader hears whose. */}
                  <span className="sr-only">, satchel #{sale.tokenId}</span>
                  <span aria-hidden="true">&nbsp;↗</span>
                </a>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
            <Link href={page} className="inline-block rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-paper transition hover:bg-leather">
              Read satchel #{sale.tokenId}&apos;s report, live
            </Link>
            <Link href={`${page}#deed`} className="text-sm font-medium underline decoration-gold underline-offset-4 hover:decoration-2">
              Read the deed<span className="sr-only"> of satchel #{sale.tokenId}&apos;s sale</span> <span aria-hidden="true">→</span>
            </Link>
          </div>
          <p className="mt-3 font-mono text-xs break-all text-muted">{verifyCommand(MAINNET, sale.tokenId)}</p>
        </div>
        <div className="deed-card-marks" aria-hidden="true">
          <CleanStamp top="Before payment" rot="-6deg" small />
          <WaxSeal rot="8deg" delay=".05s" />
          <Stamp tone="bad" big="Refused" sub={`${formatSpan(REFUSED_AFTER)} later`} rot="-9deg" delay=".1s" />
        </div>
      </div>
    </article>
  );
}
