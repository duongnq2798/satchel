import Link from "next/link";
import { LiveStats } from "@/components/live-stats";
import { VerdictGallery } from "@/components/verdict-gallery";
import { CHAINS, NETWORK, REPO_URL } from "@/lib/config";
import { CHECKS } from "@/lib/copy";

const STEPS = [
  {
    title: "Mint",
    body: "A satchel is a NEP-171 NFT. Its path, satchel/<id>, and the contract's account derive a secp256k1 key inside NEAR's MPC network. That key is one address on every chain below.",
  },
  {
    title: "Use",
    body: "The owner asks the contract to sign. The contract builds and hashes the EIP-1559 transaction itself, writes the nonce and any approval into a public record, then requests the MPC signature.",
  },
  {
    title: "Sell",
    body: "Listing freezes signing. A buyer checks the record, then buys naming the record version they checked; the NFT, and control of the address on every chain, move in one NEAR transaction.",
  },
];

const LIMITS = [
  "Powers built into an asset itself are out of reach: a token the seller can upgrade, blacklist or claw back needs no signature from the wallet.",
  "Calls the contract can't classify, such as swaps and multicalls, make a satchel unprovable for every later owner. The report says so.",
  "secp256k1 only for now: EVM chains through sign_evm, anything else through sign_raw, which counts as opaque.",
  "Not audited. Two internal adversarial reviews; every fix is covered by the contract's tests.",
];

export default function Home() {
  const chainNames = [...new Set(CHAINS.filter((c) => !c.testnet).map((c) => c.name))];
  return (
    <div className="space-y-20">
      <section className="grid gap-10 pt-4 lg:grid-cols-[1.3fr_1fr] lg:items-center">
        <div>
          <p className="text-sm font-medium tracking-wide text-leather">NEAR Chain Signatures · NFT</p>
          <h1 className="mt-3 font-display text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
            An NFT that is a wallet on every EVM chain.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-ink-2">
            Transfer the NFT and the keys move with it. Buy one and check, on chain, what the seller could have kept
            back: a signed withdrawal, a leftover approval, anything the record can't explain.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/satchels" className="rounded-full bg-ink px-5 py-3 text-sm font-medium text-paper transition hover:bg-leather">
              Mint a satchel
            </Link>
            <Link href="#examples" className="rounded-full border border-ink px-5 py-3 text-sm font-medium transition hover:bg-card">
              See three real reports
            </Link>
          </div>
        </div>
        <div className="rounded-3xl border border-line bg-card p-6">
          <p className="text-xs text-muted">Satchel #1 · one address on {CHAINS.length} chains</p>
          <p className="mt-1 font-mono text-sm break-all">0x96DA1468E95Ab31A698891f0150095f86b5a282B</p>
          <ul className="mt-5 grid grid-cols-2 gap-2 text-sm">
            {chainNames.map((name) => (
              <li key={name} className="rounded-xl bg-paper-2 px-3 py-2">
                {name}
              </li>
            ))}
          </ul>
          <p className="mt-5 text-sm text-ink-2">Plus each one's testnet. Signed by {NETWORK.mpc}.</p>
        </div>
      </section>

      <LiveStats />

      <VerdictGallery />

      <section>
        <h2 className="font-display text-3xl font-semibold tracking-tight">Selling a wallet is easy to fake</h2>
        <p className="mt-3 max-w-3xl text-ink-2">
          The seller signs a withdrawal, sells the wallet, then broadcasts the withdrawal and empties it. Or approves their
          own address to spend its tokens and pulls them after the sale. Token-bound accounts on one chain have the same
          holes. Satchel closes them with a record the contract keeps for every token, so a buyer can rule them out
          instead of trusting the seller.
        </p>
      </section>

      <section className="grid gap-6 md:grid-cols-3">
        {STEPS.map((s, i) => (
          <div key={s.title} className="rounded-2xl border border-line bg-card p-6">
            <p className="font-display text-4xl text-gold">{i + 1}</p>
            <h3 className="mt-2 font-display text-xl font-semibold">{s.title}</h3>
            <p className="mt-2 text-sm text-ink-2">{s.body}</p>
          </div>
        ))}
      </section>

      <section className="rounded-3xl bg-ink px-6 py-10 text-paper sm:px-10">
        <h2 className="font-display text-3xl font-semibold tracking-tight">Four checks before you buy</h2>
        <p className="mt-2 max-w-2xl text-paper/70">
          Run in your browser, or with <code className="font-mono">npm run verify -- &lt;id&gt;</code>, against NEAR and each
          chain the record lists. A satchel is provably clean only when all four pass.
        </p>
        <ol className="mt-8 grid gap-6 md:grid-cols-2">
          {CHECKS.map((c, i) => (
            <li key={c.title} className="flex gap-4">
              <span className="font-display text-3xl text-gold">{i + 1}</span>
              <div>
                <p className="font-medium">{c.title}</p>
                <p className="mt-1 text-sm text-paper/70">{c.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <Link href="/verify" className="mt-8 inline-block rounded-full bg-gold px-5 py-3 text-sm font-medium text-ink transition hover:bg-gold/80">
          Verify a satchel
        </Link>
      </section>

      <section className="grid gap-10 md:grid-cols-2">
        <div>
          <h2 className="font-display text-2xl font-semibold tracking-tight">Built on NEAR</h2>
          <ul className="mt-4 space-y-3 text-sm text-ink-2">
            <li>
              <strong className="text-ink">Chain Signatures.</strong> Every key is derived and every signature made by the MPC
              network ({NETWORK.mpc}); the contract is the only account that can ask for a satchel's key.
            </li>
            <li>
              <strong className="text-ink">NEP-171, 177, 181 and 297.</strong> A standard NFT that wallets and marketplaces
              already understand, with events for every signature and sale.
            </li>
            <li>
              <strong className="text-ink">A locked, reproducible contract.</strong> Built in a pinned Docker image (NEP-330),
              deployed and initialized in one transaction, then every key deleted.
            </li>
          </ul>
        </div>
        <div>
          <h2 className="font-display text-2xl font-semibold tracking-tight">What it can't cover</h2>
          <ul className="mt-4 space-y-3 text-sm text-ink-2">
            {LIMITS.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <p className="mt-4 text-sm">
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="underline underline-offset-4">
              Read the code and the full list of limits
            </a>
          </p>
        </div>
      </section>
    </div>
  );
}
