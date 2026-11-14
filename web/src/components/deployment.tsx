"use client";

import { type NetworkId, assertDeployment } from "satchel-nft";
import { useNetwork } from "./network";
import { ErrorNote, WaitLine } from "./ui";
import { useAsync } from "./use-async";

/** The networks whose contract passed its check on this page, so later satchels show their address at once. */
const passed = new Set<NetworkId>();

/** Whether this network's contract passes its check: true once it does, an error saying why not. */
export function useDeployment() {
  const net = useNetwork();
  return useAsync(
    () =>
      assertDeployment(net).then(() => {
        passed.add(net.id);
        return true as const;
      }),
    net.id,
    { initial: passed.has(net.id) ? true : undefined },
  );
}

/**
 * Why the page holds back a satchel's address, or nothing once the contract passes its check. Until
 * then the contract account could hold anyone's code, and the address would be theirs to sign for.
 */
export function DeploymentNote({ deployment }: { deployment: ReturnType<typeof useDeployment> }) {
  if (deployment.data) return null;
  if (deployment.lastError !== null && deployment.lastError !== undefined) {
    return (
      <ErrorNote error={deployment.lastError} onRetry={deployment.reload}>
        <p className="mt-1">The app shows no address to fund and signs nothing until it passes.</p>
      </ErrorNote>
    );
  }
  return (
    <WaitLine wait={deployment.wait} slow="Still checking. Public RPC nodes can be slow.">
      Checking the contract before showing an address…
    </WaitLine>
  );
}
