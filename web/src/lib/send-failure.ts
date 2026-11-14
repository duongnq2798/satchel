import type { SendStep } from "satchel-nft";
import { WalletUnsure, errorKind } from "./errors";

/**
 * How a send that stopped at `step` is worded. `outgoing`: from the broadcast on it may be on chain,
 * so it shows its own message and never a generic "try again". `unsure`: it may have been signed or
 * sent, so it says "Stopped", not "Failed", and to check History before sending again.
 */
export function sendFailure(step: SendStep | null, error: unknown, online?: boolean): { outgoing: boolean; unsure: boolean } {
  if (error === null || error === undefined) return { outgoing: false, unsure: false };
  const outgoing = step === "broadcast" || step === "confirm";
  const kind = errorKind(error, online);
  return { outgoing, unsure: outgoing || kind === "rejected" || kind === "pending" || error instanceof WalletUnsure };
}
