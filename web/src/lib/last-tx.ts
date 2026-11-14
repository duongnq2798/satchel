import type { Network } from "satchel-nft";

let last: { net: Network; hash: string } | null = null;

/** Notes the last transaction a wallet returned on this page, for the error boundary to link. */
export function rememberTx(net: Network, hash: string): void {
  last = { net, hash };
}

/** The last transaction a wallet returned on this page, if any. */
export function lastTx(): { net: Network; hash: string } | null {
  return last;
}
