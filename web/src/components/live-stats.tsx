"use client";

import { NETWORK } from "@/lib/config";
import { accessKeyCount, viewAccount } from "@/lib/near";
import { satchel } from "@/lib/satchel";
import { useAsync } from "./use-async";

/** What anyone can confirm about the deployment, read live from NEAR. */
export function LiveStats() {
  const stats = useAsync(async () => {
    const [keys, account, supply, listings, mpc] = await Promise.all([
      accessKeyCount(NETWORK.contract),
      viewAccount(NETWORK.contract),
      satchel.totalSupply(),
      satchel.listings(0, 100),
      satchel.mpcContract(),
    ]);
    return {
      locked: keys === 0,
      reproducible: account.code_hash === NETWORK.build.codeHash,
      canonical: mpc === NETWORK.mpc,
      supply,
      listed: listings.length,
    };
  }, "stats");

  const s = stats.data;
  const none = stats.error ? "Couldn't read" : "…";
  const items = [
    { label: "Contract keys", value: s ? (s.locked ? "None: locked" : "Has keys") : none, good: s?.locked },
    { label: "Code", value: s ? (s.reproducible ? "Reproducible build" : "Unknown build") : none, good: s?.reproducible },
    { label: "Signer", value: s ? (s.canonical ? NETWORK.mpc : "Not canonical") : none, good: s?.canonical },
    { label: "Satchels minted", value: s ? String(s.supply) : none },
    { label: "Listed now", value: s ? String(s.listed) : none },
  ];
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-5">
      {items.map((item) => (
        <div key={item.label} className="bg-card px-4 py-3">
          <dt className="text-xs text-muted">{item.label}</dt>
          <dd className={`mt-0.5 truncate text-sm font-medium ${item.good === false ? "text-bad" : item.good ? "text-ok" : ""}`}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
