import { type Network, chainInfo } from "./config.js";
import { formatBalance } from "./evm.js";
import { limiter } from "./limit.js";
import type { SigningRecord } from "./near.js";
import { formatNear } from "./satchel.js";

/** One step in a satchel's life, from an event the Satchel contract logged. */
export type HistoryEvent =
  | { kind: "mint"; owner: string }
  | { kind: "transfer"; from: string; to: string }
  | { kind: "sign_evm"; chainId: string; nonce: string; to: string; value: string; class: string }
  | { kind: "sign_raw"; payload: string }
  | { kind: "list"; price: string }
  | { kind: "delist" }
  | { kind: "sale"; seller: string; buyer: string; price: string };

export type HistoryEntry = HistoryEvent & {
  /** The NEAR transaction, to look up on an explorer. */
  tx: string;
  block: number;
  /** Milliseconds since the epoch, from the block that ran the contract's receipt. */
  at: number;
  /** The account that called the contract. */
  caller: string;
};

/**
 * A satchel's history, oldest first. It comes from FastNEAR's transaction index, a third party:
 * the page shows it, the report never reads it. Each entry names its transaction, so anyone can
 * check it on an explorer.
 */
export interface History {
  entries: HistoryEntry[];
  /** How many of the contract's transactions were read. */
  scanned: number;
  /** False when the index holds more transactions than were read: the oldest entries are missing. */
  complete: boolean;
  source: string;
}

/** A transaction as FastNEAR's index returns it, with only the fields read here. */
export interface IndexedTx {
  transaction: { hash: string };
  receipts: {
    receipt: { predecessor_id: string };
    execution_outcome: {
      block_height: number;
      block_timestamp: number;
      outcome: { executor_id: string; logs: string[]; status: unknown };
    };
  }[];
}

const PAGE = 200;
/** The index answers at most this many transactions per request. */
const BATCH = 20;

async function txApi<T>(net: Network, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${net.txApi}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${net.txApi}${path} answered ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Reads the contract's transactions from the index, newest first, up to `maxTransactions`, and
 * keeps the events about `tokenId`.
 */
export async function tokenHistory(net: Network, tokenId: string, maxTransactions = 1000): Promise<History> {
  const hashes = new Set<string>();
  let total = 0;
  let resume: string | undefined;
  // At most the pages `maxTransactions` needs, and no further than a page that adds nothing new:
  // an index whose resume token never moves can't keep this reading forever.
  for (let pages = Math.ceil(maxTransactions / PAGE) + 1; pages > 0; pages--) {
    const page = await txApi<{ account_txs?: { transaction_hash: string }[]; resume_token?: string; txs_count?: number }>(
      net,
      "/v0/account",
      { account_id: net.contract, limit: PAGE, ...(resume ? { resume_token: resume } : {}) },
    );
    const before = hashes.size;
    for (const t of page.account_txs ?? []) hashes.add(t.transaction_hash);
    total = Math.max(total, page.txs_count ?? 0);
    const next = page.account_txs?.length ? page.resume_token : undefined;
    if (!next || next === resume || hashes.size === before || hashes.size >= maxTransactions) break;
    resume = next;
  }

  // The index lists the newest first; a larger position is an older transaction.
  const list = [...hashes].slice(0, maxTransactions);
  const position = new Map(list.map((hash, i) => [hash, i]));
  const limit = limiter(4);
  const batches: string[][] = [];
  for (let i = 0; i < list.length; i += BATCH) batches.push(list.slice(i, i + BATCH));
  const pages = await Promise.all(
    batches.map((tx_hashes) => limit(() => txApi<{ transactions?: (IndexedTx | null)[] }>(net, "/v0/transactions", { tx_hashes }))),
  );
  // Oldest first: by block, then, within a block, the older transaction first. The sort is stable,
  // so one transaction's events keep the order the contract logged them in.
  const age = (hash: string) => position.get(hash) ?? 0;
  const entries = pages
    .flatMap((p) => p.transactions ?? [])
    .flatMap((tx) => (tx ? eventsIn(net, tx, tokenId) : []))
    .sort((a, b) => a.block - b.block || age(b.tx) - age(a.tx));
  return { entries, scanned: list.length, complete: list.length >= total, source: net.txApi };
}

function succeeded(status: unknown): boolean {
  return typeof status === "object" && status !== null && ("SuccessValue" in status || "SuccessReceiptId" in status);
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
/** A u64 or u128 the contract logs as a decimal string; anything else is refused. */
const digits = (v: unknown): string | null => (typeof v === "string" && /^\d{1,39}$/.test(v) ? v : null);

/** The events about `tokenId` in one transaction, in the order the contract logged them. */
export function eventsIn(net: Network, tx: IndexedTx, tokenId: string): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  for (const { receipt, execution_outcome: run } of tx.receipts ?? []) {
    // Only the contract's own logs, from receipts that succeeded: any contract can log an
    // EVENT_JSON line, and a failed receipt's changes were rolled back.
    if (run.outcome.executor_id !== net.contract || !succeeded(run.outcome.status)) continue;
    // A block or time the index got wrong would sort and date the entry wrongly, or not at all.
    const at = Math.floor(Number(run.block_timestamp) / 1e6);
    if (!Number.isSafeInteger(run.block_height) || run.block_height <= 0 || !(at > 0 && at <= 8.64e15)) continue;
    const found: HistoryEntry[] = [];
    for (const log of run.outcome.logs) {
      if (!log.startsWith("EVENT_JSON:")) continue;
      let event: { standard?: unknown; event?: unknown; data?: unknown };
      try {
        event = JSON.parse(log.slice("EVENT_JSON:".length));
      } catch {
        continue;
      }
      if (!Array.isArray(event.data)) continue;
      for (const data of event.data) {
        const step = eventFrom(String(event.standard), String(event.event), data, tokenId);
        if (step) found.push({ ...step, tx: tx.transaction.hash, block: run.block_height, at, caller: receipt.predecessor_id });
      }
    }
    // A sale moves the token with an nft_transfer from the seller to the buyer in its own receipt.
    // The sale says more, so that one transfer is left out; any other transfer stays.
    for (const sale of found.filter((e) => e.kind === "sale")) {
      const i = found.findIndex((e) => e.kind === "transfer" && e.from === sale.seller && e.to === sale.buyer);
      if (i >= 0) found.splice(i, 1);
    }
    entries.push(...found);
  }
  return entries;
}

function eventFrom(standard: string, name: string, data: unknown, tokenId: string): HistoryEvent | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (standard === "nep171") {
    if (!Array.isArray(d.token_ids) || !d.token_ids.includes(tokenId)) return null;
    if (name === "nft_mint" && typeof d.owner_id === "string") return { kind: "mint", owner: d.owner_id };
    if (name === "nft_transfer" && typeof d.old_owner_id === "string" && typeof d.new_owner_id === "string") {
      return { kind: "transfer", from: d.old_owner_id, to: d.new_owner_id };
    }
    return null;
  }
  if (standard !== "satchel" || d.token_id !== tokenId) return null;
  switch (name) {
    case "sign_evm": {
      const [chainId, nonce, value] = [d.chain_id, d.nonce, d.value].map(digits);
      const [to, cls] = [d.to, d.class].map(str);
      return chainId && nonce && to && value && cls ? { kind: "sign_evm", chainId, nonce, to, value, class: cls } : null;
    }
    case "sign_raw":
      return str(d.payload) ? { kind: "sign_raw", payload: d.payload as string } : null;
    case "list":
      return digits(d.price) ? { kind: "list", price: digits(d.price) as string } : null;
    case "delist":
      return { kind: "delist" };
    case "sale": {
      const [seller, buyer, price] = [str(d.seller), str(d.buyer), digits(d.price)];
      return seller && buyer && price ? { kind: "sale", seller, buyer, price } : null;
    }
    default:
      return null;
  }
}

/** What the contract logged `class` as, in words. */
const SIGNED: Record<string, string> = {
  asset_transfer: "a token transfer",
  approval: "an approval",
  revocation: "a revocation",
};

/** One line for an entry: "satchel-nft.testnet listed it for 0.5 NEAR". */
export function describeEntry(e: HistoryEntry): string {
  switch (e.kind) {
    case "mint":
      return `minted to ${e.owner}`;
    case "transfer":
      return `${e.from} gave it to ${e.to}`;
    case "sign_evm": {
      const chain = chainInfo(Number(e.chainId));
      const where = chain?.name ?? `chain ${e.chainId}`;
      const what =
        e.class === "value_transfer"
          ? `a send of ${formatBalance(BigInt(e.value))}${chain ? ` ${chain.symbol}` : ""} to ${e.to}`
          : (SIGNED[e.class] ?? `an unclassified call to ${e.to}`);
      return `${e.caller} had ${what} signed on ${where}, nonce ${e.nonce}`;
    }
    case "sign_raw":
      return `${e.caller} had a raw payload signed`;
    case "list":
      return `${e.caller} listed it for ${formatNear(e.price)} NEAR`;
    case "delist":
      return `${e.caller} delisted it`;
    case "sale":
      return `${e.seller} sold it to ${e.buyer} for ${formatNear(e.price)} NEAR`;
  }
}

/** Signatures the history shows, and the number the contract's record counts. */
export function signatureCounts(history: History, record: SigningRecord): { history: number; record: number } {
  return {
    history: history.entries.filter((e) => e.kind === "sign_evm" || e.kind === "sign_raw").length,
    record: record.evm.reduce((n, c) => n + c.signatures, 0) + record.opaque_signatures,
  };
}
