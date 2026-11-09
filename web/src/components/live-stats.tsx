"use client";

import { CHAINS, nearAccountUrl } from "@/lib/config";
import { accessKeyCount, viewAccount } from "@/lib/near";
import { satchel } from "@/lib/satchel";
import { useNetwork } from "./network";
import { useAsync } from "./use-async";

/** What anyone can confirm about the deployment, read live from NEAR, under four big numbers. */
export function LiveStats() {
  const net = useNetwork();
  const stats = useAsync(async () => {
    const [keys, account, supply, listings, mpc] = await Promise.all([
      accessKeyCount(net, net.contract),
      viewAccount(net, net.contract),
      satchel(net).totalSupply(),
      satchel(net).listings(0, 100),
      satchel(net).mpcContract(),
    ]);
    return {
      keys,
      reproducible: account.code_hash === net.build.codeHash,
      canonical: mpc === net.mpc,
      supply,
      listed: listings.length,
    };
  }, `${net.id}:stats`);

  const s = stats.data;
  const none = stats.error ? "?" : "…";
  const numbers = [
    {
      value: s ? String(s.keys) : none,
      label: !s
        ? "access keys on the contract, read live"
        : s.keys === 0
          ? "access keys on the contract, read live: nobody can change it or sign as it"
          : "access keys on the contract, read live: whoever holds one can change it",
      bad: s ? s.keys > 0 : false,
    },
    { value: String(CHAINS.length), label: "EVM chains where a satchel is the same address" },
    { value: "4", label: "checks a buyer runs before paying, in the browser or a terminal" },
    { value: "1", label: "NEAR transaction moves the NFT and every address with it" },
  ];
  const facts = [
    { ok: s?.reproducible, text: s ? (s.reproducible ? "Code is the reproducible build" : "Code is not the reproducible build") : "Reading the code hash" },
    { ok: s?.canonical, text: s ? (s.canonical ? `Signs only through ${net.mpc}` : "Signer is not the canonical MPC contract") : "Reading the signer" },
    { ok: undefined, text: s ? `${s.supply} satchels minted, ${s.listed} listed now` : "Reading the supply" },
  ];

  return (
    <section aria-label="The deployment, read live from NEAR">
      <dl className="grid grid-cols-2 border-y border-line lg:grid-cols-4">
        {numbers.map((n, i) => (
          <div
            key={n.label}
            className={[
              "border-line py-6 pr-2 sm:px-5",
              i % 2 ? "border-l pl-4" : "",
              i > 0 ? "lg:border-l" : "",
              i > 1 ? "border-t lg:border-t-0" : "",
            ].join(" ")}
          >
            <dt className="sr-only">{n.label}</dt>
            <dd>
              <span className={`block font-display text-6xl font-semibold tracking-tight sm:text-7xl ${n.bad ? "text-bad" : ""}`}>{n.value}</span>
              <span className="mt-2 block max-w-[16rem] text-sm text-ink-2" aria-hidden="true">
                {n.label}
              </span>
            </dd>
          </div>
        ))}
      </dl>
      <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-2">
        {facts.map((f) => (
          <li key={f.text} className="flex items-center gap-2">
            <span className={`size-2 rounded-full ${f.ok === true ? "bg-ok" : f.ok === false ? "bg-bad" : "bg-gold"}`} aria-hidden="true" />
            {f.text}
          </li>
        ))}
        <li>
          <a href={nearAccountUrl(net, net.contract)} target="_blank" rel="noreferrer" className="underline decoration-line underline-offset-4 hover:decoration-ink">
            See the contract on NearBlocks
          </a>
        </li>
      </ul>
    </section>
  );
}
