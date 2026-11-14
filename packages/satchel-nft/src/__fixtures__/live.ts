import { chainInfo } from "../config.js";
import {
  ENDPOINTS,
  type HttpRpcOptions,
  RpcError,
  type RpcCall,
  type TxStatusView,
  functionCalls,
  httpRpc,
  readOnlyRpc,
  receiptsOf,
  withFallback,
} from "../near-rpc.js";

// What the live tests (*.live.test.ts) share: the flags that turn them on, the public endpoints they
// read (each can be pointed elsewhere), the read-only guards every transport goes through, and the
// projections that compare a live re-read with its fixture. CI sets neither flag, so these tests are
// skipped there. Nothing here signs or sends: every NEAR transport is wrapped in readOnlyRpc.

/** Final-block checks on the regular RPC. */
export const LIVE = process.env.SATCHEL_LIVE === "1";
/** Historical reads, from archival nodes. */
export const LIVE_ARCHIVAL = process.env.SATCHEL_LIVE_ARCHIVAL === "1";

export type NetworkName = "mainnet" | "testnet";

const env = (name: string) => {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
};

/**
 * An API key, if the OWNER set FASTNEAR_API_KEY in their own shell; it goes only into a header for
 * FastNEAR's hosts, never into a URL, an error or a fixture.
 */
function optionsFor(url: string): HttpRpcOptions {
  const key = env("FASTNEAR_API_KEY");
  if (!key || !new URL(url).hostname.endsWith(".fastnear.com")) return {};
  return { headers: { Authorization: `Bearer ${key}` } };
}

/**
 * The regular RPC for `network`: SATCHEL_LIVE_<NETWORK>_RPC, else ENDPOINTS.<network>.rpc. `options` changes
 * the transport (timeout, retries) for one test; headers stay the API key's.
 */
export function liveRpc(network: NetworkName, options: Omit<HttpRpcOptions, "headers" | "fetch"> = {}): RpcCall {
  const url = env(`SATCHEL_LIVE_${network.toUpperCase()}_RPC`) ?? ENDPOINTS[network].rpc;
  return readOnlyRpc(httpRpc(url, { ...options, ...optionsFor(url) }));
}

/**
 * An archival RPC for `network`: SATCHEL_LIVE_<NETWORK>_ARCHIVAL, else FastNEAR's archival node with
 * NEAR's own as the fallback. docs.near.org lists FastNEAR archival as needing a key; NEAR's answers
 * without one.
 */
export function liveArchival(network: NetworkName): RpcCall {
  const own = env(`SATCHEL_LIVE_${network.toUpperCase()}_ARCHIVAL`);
  if (own) return readOnlyRpc(httpRpc(own, optionsFor(own)));
  const { archival, nearArchival } = ENDPOINTS[network];
  return readOnlyRpc(withFallback(httpRpc(archival, optionsFor(archival)), httpRpc(nearArchival)));
}

/** EVM nodes for the EVM checks: config.ts's publicnode URLs unless overridden (not viem's defaults). */
export const LIVE_EVM_RPC = {
  base: env("SATCHEL_LIVE_BASE_RPC") ?? configRpc(8453),
  sepolia: env("SATCHEL_LIVE_SEPOLIA_RPC") ?? configRpc(11155111),
} as const;

function configRpc(chainId: number): string {
  const chain = chainInfo(chainId);
  if (!chain) throw new Error(`config.ts has no chain ${chainId}`);
  return chain.rpc;
}

export const RATE_LIMITED = "transport: rate-limited, not a result; run again later or set FASTNEAR_API_KEY";

/**
 * Runs one live read. A read that failed with rate limiting says so on its own line and fails: it is
 * a transport problem, not evidence that a recorded fact is wrong.
 */
export async function live<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (err) {
    if (err instanceof RpcError && err.kind === "rate-limited") {
      console.error(`${RATE_LIMITED} (${err.message})`);
      throw new Error(`${RATE_LIMITED}: ${err.message}`, { cause: err });
    }
    throw err;
  }
}

/** The kind of an outcome status: SuccessValue, SuccessReceiptId, Failure, or the text of a string status. */
export function statusKind(status: unknown): string {
  if (typeof status === "string") return status;
  if (status !== null && typeof status === "object") return Object.keys(status).sort().join("+");
  return String(status);
}

/**
 * What a live re-read of a transaction must keep from its fixture: hash, signer, receipt ids, executor
 * ids, receipt block hashes, status kinds and FunctionCall method names. Fields a node adds later are
 * not compared.
 */
export function txProjection(tx: TxStatusView) {
  return {
    hash: tx.transaction.hash,
    signer: tx.transaction.signer_id,
    status: statusKind(tx.status),
    receipts: receiptsOf(tx).map((r) => ({
      id: r.receiptId,
      executor: r.executorId,
      blockHash: r.blockHash,
      status: statusKind(r.status),
      methods: functionCalls(r).map((c) => c.method),
    })),
  };
}
