import { type Holder, type KitStep, type NetworkId, type Report, ROOM_PROOF_FIELDS, type RoomProof, type SatchelView } from "satchel-nft";

/**
 * What POST /api/room takes and answers. The route stays thin: it reads the body here, then hands
 * the proof to `checkHolder`, which decides.
 */
export const ROOM_BODY_LIMIT = 4096;

/**
 * How long the route waits for the report once the holder is in. With checkHolder's three reads
 * (at most 10 s each, `RPC_TIMEOUT_MS`), it stays under the route's maxDuration of 60 s: an EVM RPC
 * that never answers still leaves time to send the holder card.
 */
export const REPORT_DEADLINE_MS = 20_000;

/** `work`, or a rejection once `ms` have passed without it settling. */
export function within<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer in ${ms / 1000} s`)), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

export type RoomRequest = { ok: true; network: NetworkId; proof: RoomProof } | { ok: false; status: 400 | 413; error: string };

/** The room's answer once `checkHolder` let the holder in. */
export interface RoomResponse {
  holder: Holder;
  satchel: SatchelView;
  /** The satchel's clean transfer report, or null with `reportError` if it couldn't be read. */
  report: Report | null;
  reportError?: string;
  /** The handover kit built from `report`. */
  kit: KitStep[] | null;
}

const tooLarge = { ok: false, status: 413, error: `The body is over ${ROOM_BODY_LIMIT} bytes` } as const;

/** The body as text, or null once it passes `limit` bytes; it stops reading there. */
async function readCapped(request: Request, limit: number): Promise<string | null> {
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export async function readRoomRequest(request: Request): Promise<RoomRequest> {
  if (Number(request.headers.get("content-length")) > ROOM_BODY_LIMIT) return tooLarge;
  let text: string | null;
  try {
    text = await readCapped(request, ROOM_BODY_LIMIT);
  } catch {
    return { ok: false, status: 400, error: "The body must be UTF-8 JSON" };
  }
  return text === null ? tooLarge : parseRoomBody(text);
}

/** `{ network, ...proof }`, every proof field a string. Other fields are ignored. */
export function parseRoomBody(text: string): RoomRequest {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, status: 400, error: "The body must be JSON" };
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false, status: 400, error: "The body must be a JSON object" };
  const fields = body as Record<string, unknown>;
  const network = fields.network;
  if (network !== "testnet" && network !== "mainnet") return { ok: false, status: 400, error: 'network must be "testnet" or "mainnet"' };
  const proof: Partial<RoomProof> = {};
  for (const field of ROOM_PROOF_FIELDS) {
    const value = fields[field];
    if (typeof value !== "string") return { ok: false, status: 400, error: `${field} must be a string` };
    proof[field] = value;
  }
  return { ok: true, network, proof: proof as RoomProof };
}
