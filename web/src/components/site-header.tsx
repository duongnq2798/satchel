"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { MAINNET, TESTNET } from "satchel-nft";
import { appPath, networkForPath, switchPath } from "@/lib/routes";
import { useNetwork } from "./network";
import { ConnectButton } from "./wallet";

/** How it works and Developers are sections of the landing page, which shows the testnet examples. */
const NAV = [
  { href: "/#how", label: "How it works", perNetwork: false },
  { href: "/market", label: "Market", perNetwork: true },
  { href: "/satchels", label: "Your satchels", perNetwork: true },
  { href: "/verify", label: "Verify", perNetwork: true },
  { href: "/#developers", label: "Developers", perNetwork: false },
];

export function NetworkBanner() {
  const net = useNetwork();
  return net.id === "mainnet" ? (
    <div className="bg-leather px-4 py-1.5 text-center text-xs text-paper">
      NEAR mainnet. Satchels here hold real funds. Not audited: keep in one only what you can afford to lose.
    </div>
  ) : (
    <div className="bg-ink px-4 py-1.5 text-center text-xs text-paper/80">
      NEAR testnet. Satchels here sign with the testnet MPC network: never send real funds to their addresses.
    </div>
  );
}

/**
 * Testnet or mainnet. Switching loads the other side as a new page, so its wallet and every read
 * start fresh on that network.
 */
function NetworkSwitch() {
  const net = useNetwork();
  const pathname = usePathname();
  return (
    <div role="group" aria-label="Network" className="flex rounded-full border border-line bg-card p-0.5 text-xs font-medium">
      {[TESTNET, MAINNET].map((n) =>
        n.id === net.id ? (
          <span key={n.id} aria-current="true" className="rounded-full bg-ink px-3 py-1.5 text-paper">
            {n.id === "testnet" ? "Testnet" : "Mainnet"}
          </span>
        ) : (
          <a key={n.id} href={switchPath(pathname, n)} className="rounded-full px-3 py-1.5 text-ink-2 hover:text-ink">
            {n.id === "testnet" ? "Testnet" : "Mainnet"}
          </a>
        ),
      )}
    </div>
  );
}

/**
 * A link that loads the page fresh when it goes to the other network, as the switch does, so no
 * wallet or read from this side carries over. With `follow`, a testnet path goes to the same page
 * on the network on screen.
 */
export function NetLink({
  href: path,
  follow = false,
  className,
  children,
}: {
  href: string;
  follow?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const net = useNetwork();
  const href = follow ? appPath(net, path) : path;
  if (networkForPath(href.split("#")[0] || "/").id !== net.id) {
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

export function SiteHeader() {
  const net = useNetwork();
  return (
    <header className="z-40 border-b border-line bg-paper/90 backdrop-blur md:sticky md:top-0">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Link href={appPath(net, "/")} className="flex items-center gap-2 font-display text-xl font-semibold tracking-tight">
            <img src="/icon.svg" alt="" className="size-7" />
            Satchel
          </Link>
          <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-2">
            {NAV.map((n) => (
              <NetLink key={n.href} href={n.perNetwork ? appPath(net, n.href) : n.href} className="hover:text-ink">
                {n.label}
              </NetLink>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <NetworkSwitch />
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
