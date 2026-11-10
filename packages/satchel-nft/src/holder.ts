import { type Network, type NetworkId, accountOnNetwork, isAccountId } from "./config.js";
import { type BlockRef, type RpcCall, type SatchelView, accessKeyAt, finalBlock, rpcFor, viewAt } from "./near.js";
import { base64ToBytes, verifyNep413 } from "./nep413.js";

/**
 * The holder room: a page only the account that owns a satchel right now can open. The holder's
 * wallet signs a NEP-413 message; `checkHolder` checks the signature, that the key is a full-access
 * key of the account, and that the account owns the satchel, the last two read at one final block,
 * on every request. Nothing is stored between requests. Nothing in the room is secret either: it
 * shows that the right to open it moves with the NFT.
 */
export const ROOM_RECIPIENT = "satchelnft.xyz";
/** How long a signed proof opens the room for. */
export const ROOM_WINDOW_MS = 5 * 60 * 1000;
/** How far ahead of the server's clock a proof may say it was signed. */
export const ROOM_SKEW_MS = 60 * 1000;

/** The message the holder's wallet signs. The server builds it again; the client never sends it. */
export function roomMessage(net: Network, tokenId: string, accountId: string, issuedAt: string): string {
  return [
    `Open the holder room of Satchel #${tokenId}`,
    `Network: ${net.id}`,
    `Contract: ${net.contract}`,
    `Account: ${accountId}`,
    `Issued: ${issuedAt}`,
  ].join("\n");
}

/** What a client sends to open the room. */
export interface RoomProof {
  tokenId: string;
  accountId: string;
  /** `ed25519:<base58>`, as the wallet returns it. */
  publicKey: string;
  /** Base64, or `ed25519:<base58>`. */
  signature: string;
  /** Base64 of the 32 bytes the client picked. */
  nonce: string;
  /** When the client built the message, as `Date.prototype.toISOString` writes it. */
  issuedAt: string;
}

export const ROOM_PROOF_FIELDS = ["tokenId", "accountId", "publicKey", "signature", "nonce", "issuedAt"] as const satisfies readonly (keyof RoomProof)[];

export interface Holder {
  network: NetworkId;
  contract: string;
  tokenId: string;
  accountId: string;
  publicKey: string;
  /** The final block the key and the owner were read at. */
  block: BlockRef;
}

export type HolderCheck =
  | { ok: true; holder: Holder; satchel: SatchelView }
  | { ok: false; status: 400 | 401 | 403 | 404 | 502; reason: string };

const refuse = (status: 400 | 401 | 403 | 404 | 502, reason: string): HolderCheck => ({ ok: false, status, reason });
const said = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Whether `proof` opens satchel #`proof.tokenId`'s room on `net`. Cheapest first: the shapes, the
 * time window and the signature, then, only once the signature verifies, the NEAR RPC: the final
 * block, the key at that block, and the satchel at that same block.
 *
 * The key must be a full-access key. A function-call key, the login key a site keeps after you
 * sign in there, can sign NEP-413 messages too; refusing it keeps any site the holder once logged
 * into from opening the room as them.
 */
export async function checkHolder(
  net: Network,
  proof: RoomProof,
  options: { now?: number; rpc?: RpcCall } = {},
): Promise<HolderCheck> {
  const p = (proof ?? {}) as Partial<Record<keyof RoomProof, unknown>>;
  for (const field of ROOM_PROOF_FIELDS) {
    if (typeof p[field] !== "string") return refuse(400, `${field} must be a string`);
  }
  const { tokenId, accountId, publicKey, signature, nonce, issuedAt } = p as RoomProof;
  if (!/^\d{1,19}$/.test(tokenId)) return refuse(400, "tokenId must be a satchel id: 1 to 19 digits");
  if (!isAccountId(accountId)) return refuse(400, "accountId is not a NEAR account id");
  if (!accountOnNetwork(net, accountId)) return refuse(400, `${accountId} is not a NEAR ${net.id} account`);
  if (publicKey.length > 128 || signature.length > 256) return refuse(400, "publicKey or signature is too long");
  const nonceBytes = base64ToBytes(nonce);
  if (nonceBytes === null || nonceBytes.length !== 32) return refuse(400, "nonce must be 32 bytes in base64");
  const issued = Date.parse(issuedAt);
  if (Number.isNaN(issued) || new Date(issued).toISOString() !== issuedAt) {
    return refuse(400, "issuedAt must be a UTC time as toISOString writes it, like 2026-11-10T09:30:00.000Z");
  }

  const now = options.now ?? Date.now();
  if (issued < now - ROOM_WINDOW_MS) {
    return refuse(
      401,
      `This proof was signed at ${issuedAt}, more than 5 minutes before the server's time, ${new Date(now).toISOString()}. Sign again; if this repeats, check your device's clock.`,
    );
  }
  if (issued > now + ROOM_SKEW_MS) {
    return refuse(401, `This proof says it was signed at ${issuedAt}, after the server's time, ${new Date(now).toISOString()}. Check your device's clock.`);
  }
  const message = roomMessage(net, tokenId, accountId, issuedAt);
  if (!verifyNep413({ publicKey, signature, message, nonce: nonceBytes, recipient: ROOM_RECIPIENT })) {
    return refuse(401, `The signature doesn't verify for ${publicKey}: it must sign the room message for satchel #${tokenId} on ${net.id}, for ${ROOM_RECIPIENT}`);
  }

  const rpc = options.rpc ?? rpcFor(net);
  let block: BlockRef;
  try {
    block = await finalBlock(rpc);
  } catch (err) {
    return refuse(502, `Couldn't read a final block from NEAR ${net.id}: ${said(err)}`);
  }
  let key: Awaited<ReturnType<typeof accessKeyAt>>;
  try {
    key = await accessKeyAt(rpc, block.hash, accountId, publicKey);
  } catch (err) {
    return refuse(502, `Couldn't read ${accountId}'s key at block ${block.height}: ${said(err)}`);
  }
  if (key === null) return refuse(403, `${publicKey} is not a key of ${accountId} at block ${block.height}`);
  if (key.permission !== "FullAccess") {
    return refuse(
      403,
      `${publicKey} is a function-call key of ${accountId}, the kind a site you signed in to keeps. The room takes only a full-access key: sign with your wallet's own key`,
    );
  }
  let found: SatchelView | null;
  try {
    found = await viewAt<SatchelView | null>(rpc, block.hash, net.contract, "satchel", { token_id: tokenId });
  } catch (err) {
    return refuse(502, `Couldn't read satchel #${tokenId} at block ${block.height}: ${said(err)}`);
  }
  if (found === null) return refuse(404, `No satchel #${tokenId} on ${net.contract}`);
  // As satchel(net).get does: nothing is decided from an answer about another token.
  if (found.token_id !== tokenId || found.path !== `satchel/${tokenId}`) {
    return refuse(502, `The NEAR RPC answered for satchel #${found.token_id} at path ${found.path}, not #${tokenId}`);
  }
  if (found.owner_id !== accountId) {
    return refuse(403, `${found.owner_id} owns satchel #${tokenId} at block ${block.height}, not ${accountId}. Only its current holder can open the room.`);
  }
  return {
    ok: true,
    holder: { network: net.id, contract: net.contract, tokenId, accountId, publicKey, block },
    satchel: found,
  };
}
