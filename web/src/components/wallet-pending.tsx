"use client";

import { TIMING } from "@/lib/timing";
import { Placeholder, WaitLine } from "./ui";
import { useWait } from "./use-async";

/** What goes where a Connect block will be while the wallet is looked up. */
export function WalletPending() {
  const wait = useWait(true, TIMING.read);
  return (
    <div className="space-y-3">
      <WaitLine wait={wait} slow="Still looking. A locked wallet extension may need unlocking.">
        Looking for your wallet…
      </WaitLine>
      <Placeholder className="h-4 w-3/4" />
      <Placeholder className="h-9 w-36 rounded-full!" />
    </div>
  );
}
