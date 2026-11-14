import { type ExecutionOutcome, type RpcCall, finished } from "satchel-nft";
import { PendingTx } from "./errors";

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Polls `tx` (wait_until FINAL) through `call` until every receipt finished; PendingTx(hash) after `attempts`. */
export async function waitFinal(
  call: RpcCall,
  hash: string,
  signer: string,
  { attempts = 30, pause = 2_000, sleep = wait }: { attempts?: number; pause?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<ExecutionOutcome> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(pause);
    try {
      const outcome = await call<ExecutionOutcome>("tx", { tx_hash: hash, sender_account_id: signer, wait_until: "FINAL" });
      if (finished(outcome)) return outcome;
      last = new Error(`transaction ${hash} has not finished`);
    } catch (err) {
      last = err;
    }
  }
  throw new PendingTx(hash, { cause: last });
}

/** After a wallet tx: refresh the page, re-read the satchel only, or nothing yet. */
export function followUp(reachedWallet: boolean, error: unknown): "refresh" | "recheck" | "none" {
  if (error === null || error === undefined) return "refresh";
  if (error instanceof PendingTx) return "none";
  return reachedWallet ? "recheck" : "none";
}
