import type { ReactNode } from "react";

/**
 * The docs' diagrams, drawn in HTML so they reflow on a phone, follow the theme and read in order
 * with a screen reader. Every name and number in them is the deployed contract's.
 */

function Box({ title, sub, children, tone = "card" }: { title: string; sub?: ReactNode; children?: ReactNode; tone?: "card" | "ink" | "gold" }) {
  const toneClass = {
    card: "border-line bg-card",
    ink: "border-ink bg-ink text-paper [&_.sub]:text-paper/75 [&_li]:text-paper/85",
    gold: "border-gold/50 bg-gold-soft/70 [&_.sub]:text-ink-2",
  }[tone];
  return (
    <div className={`rounded-xl border p-3.5 ${toneClass}`}>
      <p className="font-medium leading-snug">{title}</p>
      {sub && <p className="sub mt-0.5 font-mono text-xs text-muted">{sub}</p>}
      {children && <div className="mt-2 max-w-[34em] text-sm leading-relaxed">{children}</div>}
    </div>
  );
}

/** An arrow with a label: down in a narrow column, right when the diagram is wide enough and `across`. */
function Arrow({ label, across = true }: { label: string; across?: boolean }) {
  return (
    <div className={`flex items-center justify-center gap-2 py-1 text-xs text-ink-2 ${across ? "@3xl:flex-col @3xl:px-1 @3xl:py-0" : ""}`}>
      <span aria-hidden="true" className={`text-gold-deep ${across ? "@3xl:hidden" : ""}`}>
        ↓
      </span>
      <span className="max-w-[11rem] text-center font-mono leading-tight">{label}</span>
      {across && (
        <span aria-hidden="true" className="hidden text-gold-deep @3xl:inline">
          →
        </span>
      )}
    </div>
  );
}

function DiagramFrame({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <figure className="@container not-prose my-8 rounded-2xl border border-line bg-paper-2/60 p-4 sm:p-5">
      {children}
      <figcaption className="mx-auto mt-4 max-w-[34em] text-center text-sm text-muted">{caption}</figcaption>
    </figure>
  );
}

export function ArchitectureDiagram() {
  return (
    <DiagramFrame caption="One signature, end to end. The record is saved in the sign_evm receipt, before the MPC network is asked; the contract never holds the signature, it is the call's result.">
      <ol className="grid items-center gap-1 @3xl:grid-cols-[1fr_auto_1.35fr_auto_1fr]">
        <li>
          <Box title="Owner" sub="a NEAR account">
            Asks the contract to sign an EVM transaction for token <span className="font-mono">N</span>, from a NEAR wallet or the CLI.
          </Box>
        </li>
        <li aria-hidden="true">
          <Arrow label="sign_evm(N, tx) · 1 yoctoNEAR" />
        </li>
        <li>
          <Box title="Satchel contract" sub={<>v1.satchel-nft.near<br />v1.satchel-nft.testnet</>} tone="ink">
            <ul className="list-none space-y-0.5">
              <li>1. checks the caller owns N and it isn't listed</li>
              <li>2. RLP-encodes and hashes the EIP-1559 tx</li>
              <li>3. classifies the call, writes the record</li>
              <li>4. asks the MPC network to sign the hash</li>
            </ul>
          </Box>
        </li>
        <li aria-hidden="true">
          <Arrow label="sign(satchel/N, hash)" />
        </li>
        <li>
          <Box title="MPC network" sub={<>v1.signer<br />v1.signer-prod.testnet</>}>
            Derives the key from the contract&apos;s account and the path <span className="font-mono">satchel/N</span>, and signs. No one holds the key.
          </Box>
        </li>
      </ol>
      <div className="mt-3 grid items-center gap-1 @3xl:grid-cols-[1fr_auto_1fr]">
        <Box title="The signature returns as sign_evm's result" sub="big_r, s, recovery_id">
          The app or the CLI checks it recovers to the satchel&apos;s address, then broadcasts it.
        </Box>
        <Arrow label="broadcast" />
        <Box title="16 EVM chains" sub="one address on every one" tone="gold">
          Ethereum, Base, Arbitrum, OP, Polygon, BNB Chain, Avalanche, Aurora, and a testnet of each.
        </Box>
      </div>
    </DiagramFrame>
  );
}

const SALE = [
  { step: "Mint", call: "mint() · 0.1 NEAR", text: "Token N exists, and with it its key's path, satchel/N." },
  { step: "Use", call: "sign_evm(N, tx)", text: "Each signature is recorded first: the chain, the nonce, any approval." },
  { step: "List", call: "list(N, price)", text: "Signing freezes. The listing pins the record's version v." },
  { step: "Check", call: "four checks", text: "The buyer reads the record and each chain at a finalized block." },
  { step: "Buy", call: "buy(N, v, price)", text: "Fails if v or the price changed. Otherwise the NFT moves and the seller is paid." },
  { step: "After", call: "sign_evm by the seller", text: "Refused: only the owner, now the buyer, can have anything new signed, on every chain." },
];

export function SaleDiagram() {
  return (
    <DiagramFrame caption="A sale from mint to hand-over. Steps 3 to 5 are what make it safe to pay: anything signed between the check and the purchase makes buy fail.">
      <ol className="grid gap-3 @md:grid-cols-2 @2xl:grid-cols-3">
        {SALE.map((s, i) => (
          <li key={s.step} className="relative rounded-xl border border-line bg-card p-3.5">
            <span className="flex items-center gap-2">
              <span className="inline-flex size-6 items-center justify-center rounded-full bg-ink font-mono text-xs text-paper">{i + 1}</span>
              <span className="font-medium">{s.step}</span>
            </span>
            <span className="mt-1.5 block font-mono text-xs text-gold-ink">{s.call}</span>
            <span className="mt-1 block text-sm leading-relaxed text-ink-2">{s.text}</span>
          </li>
        ))}
      </ol>
    </DiagramFrame>
  );
}

const CHECKS = [
  { n: 1, title: "The contract can't sign behind the record", reads: "NEAR: access keys, code hash, mpc_contract()" },
  { n: 2, title: "No signed transaction is still pending", reads: "Each chain: the address's nonce at a finalized block" },
  { n: 3, title: "No approval left behind", reads: "Each chain: every recorded approval, at a finalized block" },
  { n: 4, title: "Nothing the record can't explain", reads: "NEAR: raw signatures, unclassified calls, approvals over the cap" },
];

export function ChecksDiagram() {
  return (
    <DiagramFrame caption="Each check passes, fails, or could not be read. The verdict is clean only when all four pass; one failure makes it not provable; otherwise, anything unread makes it couldn't check everything.">
      <div className="grid gap-3 @3xl:grid-cols-[1fr_auto_15rem] @3xl:items-center">
        <ol className="grid gap-2 @md:grid-cols-2">
          {CHECKS.map((c) => (
            <li key={c.n} className="rounded-xl border border-line bg-card p-3">
              <span className="font-mono text-xs text-gold-ink">Check {c.n}</span>
              <span className="mt-0.5 block font-medium leading-snug">{c.title}</span>
              <span className="mt-1 block text-xs leading-relaxed text-muted">{c.reads}</span>
            </li>
          ))}
        </ol>
        <Arrow label="verdict" />
        <ul className="grid gap-2 text-sm">
          <li className="rounded-xl bg-ok-soft px-3 py-2 text-ok">
            <span className="font-semibold">Provably clean</span>: all four pass
          </li>
          <li className="rounded-xl bg-warn-soft px-3 py-2 text-warn">
            <span className="font-semibold">Not provable</span>: any check fails
          </li>
          <li className="rounded-xl bg-paper px-3 py-2 text-ink-2 ring-1 ring-line">
            <span className="font-semibold">Couldn&apos;t check everything</span>: none fails, at least one couldn&apos;t be read
          </li>
        </ul>
      </div>
    </DiagramFrame>
  );
}
