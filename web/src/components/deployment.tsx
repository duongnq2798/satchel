"use client";

import { assertDeployment } from "satchel-nft";
import { useNetwork } from "./network";
import { Button, errorMessage } from "./ui";
import { useAsync } from "./use-async";

/** Whether this network's contract passes its check: true once it does, an error saying why not. */
export function useDeployment() {
  const net = useNetwork();
  return useAsync(() => assertDeployment(net).then(() => true as const), net.id);
}

/**
 * Why the page holds back a satchel's address, or nothing once the contract passes its check. Until
 * then the contract account could hold anyone's code, and the address would be theirs to sign for.
 */
export function DeploymentNote({ deployment }: { deployment: ReturnType<typeof useDeployment> }) {
  if (deployment.data) return null;
  if (deployment.error) {
    return (
      <div className="space-y-2">
        <div className="rounded-xl bg-bad-soft px-3 py-2 text-sm text-bad">
          <p>
            {errorMessage(deployment.error)}. The app shows no address to fund and signs nothing until it does.
          </p>
        </div>
        <Button onClick={deployment.reload}>Check again</Button>
      </div>
    );
  }
  return <p className="text-sm text-muted">Checking the contract before showing an address…</p>;
}
