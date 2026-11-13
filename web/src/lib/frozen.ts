import type { Network, NetworkId } from "satchel-nft";

/**
 * The demo satchels whose state the README quotes: testnet #1 to #9, mainnet #1 to #3 (#9 added
 * after its Make it clean run on 2026-11-12, mainnet #3 after its sale on 2026-11-13). Until
 * FROZEN_UNTIL, 2026-11-25 (judging runs 2026-11-16 to 11-18), the app's owner and buy actions are
 * off on them: send, list, delist, transfer, buy and the Make it clean buttons. The holder room stays
 * open.
 *
 * This is a guard in this app only, not a protection: the satchel-nft CLI, the near CLI and any
 * other client can still sign, list, buy or transfer these satchels, and the contract has no such
 * rule.
 */
export const FROZEN: Record<NetworkId, readonly string[]> = {
  testnet: ["1", "2", "3", "4", "5", "6", "7", "8", "9"],
  mainnet: ["1", "2", "3"],
};

export const FROZEN_UNTIL = new Date("2026-11-25T00:00:00Z");

export const FROZEN_NOTE =
  "Demo satchel: its state is quoted in the README, so the app's owner and buy actions are off until 2026-11-25.";

/** Whether the app's owner and buy actions are off for satchel `tokenId` on `net` at `now`. */
export function isFrozen(net: Network, tokenId: string, now: Date = new Date()): boolean {
  return now.getTime() < FROZEN_UNTIL.getTime() && FROZEN[net.id].includes(tokenId);
}
