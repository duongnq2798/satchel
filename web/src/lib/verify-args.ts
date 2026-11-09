import { NETWORKS, type NetworkId } from "./config";

export const VERIFY_USAGE = "usage: npm run verify -- [--network testnet|mainnet] <token_id>";

/** `npm run verify`'s arguments, `[--network <id>] <token_id>`, or null when they are anything else. */
export function parseVerifyArgs(args: string[]): { network: NetworkId; tokenId: string } | null {
  let network = "testnet";
  const rest = [...args];
  const flag = rest.indexOf("--network");
  if (flag !== -1) {
    network = rest[flag + 1] ?? "";
    rest.splice(flag, 2);
  }
  // Own keys only: `"constructor" in NETWORKS` is true too.
  if (!Object.hasOwn(NETWORKS, network) || rest.length !== 1 || !/^\d{1,19}$/.test(rest[0])) return null;
  return { network: network as NetworkId, tokenId: rest[0] };
}
