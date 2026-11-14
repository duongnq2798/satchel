# satchel-nft/account-proof

A NEP-413 signature proves only that some key signed some text. `verifyAccountProof` turns one into a
decision, at one final block:

- the signature, strict ed25519 over the message and recipient the server built;
- that the key is on the account at that block, with full access by default;
- an optional on-chain condition read at that same block: owns NFT X, holds at least N of token Y, or
  is in DAO role Z;
- freshness bound to the signed text;
- a replay guard, claimed last.

It is for a backend login, token-gated pages or files, and "prove you hold this NFT" APIs. Satchel's
holder room (`holder.ts`) does this today for one condition; moving it onto this module is Planned.

The same subpath ships a NEP-641 leaf resolver in TypeScript
([nep-0641.md](https://github.com/near/NEPs/blob/master/neps/nep-0641.md), status Final). The NEP's
reference implementation section reads "TypeScript resolver (wallet-selector / NEAR Connect
integration): TBD." (line 598 of the copy read on 2026-11-14). This one resolves the leaf only, and is
not a wallet-selector or NEAR Connect integration. Source:
[account-proof.ts](../../packages/satchel-nft/src/account-proof.ts) and
[nep641.ts](../../packages/satchel-nft/src/nep641.ts).

```ts
import { ENDPOINTS, httpRpc, readOnlyRpc } from "satchel-nft/near-rpc";
import { memoryNonceStore, nftOwner, verifyAccountProof } from "satchel-nft/account-proof";

const rpc = readOnlyRpc(httpRpc(ENDPOINTS.mainnet.rpc));
const nonces = memoryNonceStore(); // one server instance; use a shared store behind several
// The server builds the message: the account on its own line, and the issued-at time it checks.
const message = `Sign in to example.app\nAccount: ${body.accountId}\nIssued: ${body.issuedAt}`;
const result = await verifyAccountProof({
  rpc,
  proof: body,                                   // { accountId, publicKey, signature, nonce, callbackUrl? }
  expect: { recipient: "example.app", message },
  predicate: nftOwner("v1.satchel-nft.near", "1"),
  freshness: { issuedAt: body.issuedAt },
  nonceStore: nonces,
});
if (!result.ok) return reply(result.status, result.reason); // 400, 401, 403, 404, 409 or 502
```

## What exists already

**near-sign-verify 0.4.5** (npm, read with `npm view` on 2026-11-14) does NEP-413 API auth with
`requireFullAccessKey` (default true), `expectedRecipient`, `nonceMaxAge` and `validateNonce`. Its key
check calls FastNEAR's public-key index (`public_key/…` in its dist/index.js), with no block pin and no
permission read. `verifyAccountProof` reads the key's permission from the chain at one pinned block,
reads an on-chain condition at that same block, binds freshness to the signed text, and claims the
replay nonce last. It is a library, not a hackathon entry.

## API

```ts
export interface Nep413Proof {
  accountId: string;
  publicKey: string;                 // "ed25519:<base58>"
  signature: string;                 // base64, as wallets return it, or "ed25519:<base58>", as near-cli-rs prints it
  nonce: string | Uint8Array;        // 32 bytes; base64 when a string
  callbackUrl?: string | null;
}
export interface Freshness {
  issuedAt: string;                  // the exact text the signed message carries: ISO 8601 UTC, as toISOString writes it
  now?: number;                      // ms, the server's time when the call starts; default Date.now()
  windowMs?: number;                 // default 300_000
  skewMs?: number;                   // default 60_000
}
export interface NonceStore { claim(key: string, ttlMs: number): Promise<boolean> }   // true: first use
export function memoryNonceStore(options?: { max?: number }): NonceStore;              // one process; default max 10_000

export interface ProofContext { reader: PinnedReader; rpc: RpcCall; accountId: string; publicKey: string }
export type PredicateResult<F> =
  | { ok: true; facts: F }
  | { ok: false; status: 403 | 404 | 502; code: string; reason: string; cause?: unknown };
export type Predicate<F> = (ctx: ProofContext) => Promise<PredicateResult<F>>;

export type ProofStage = "shape" | "time" | "signature" | "block" | "key" | "predicate" | "replay";
export type ProofCode =
  | "malformed" | "too-long" | "freshness-unbound" | "stale" | "from-the-future"
  | "unsupported-key-type" | "bad-signature"
  | "rpc-block" | "rpc-key" | "wrong-block" | "key-not-on-account" | "function-call-key" | "unknown-permission"
  | "predicate-refused" | "predicate-rpc" | "replay-store" | "replayed";
export type AccountProofResult<F> =
  | { ok: true; accountId: string; publicKey: string; permission: KeyPermission; block: PinnedBlock; facts: F }
  | { ok: false; status: 400 | 401 | 403 | 404 | 409 | 502; stage: ProofStage; code: ProofCode;
      predicateCode?: string; reason: string; cause?: unknown; block?: PinnedBlock };

export function verifyAccountProof<F = undefined>(input: {
  rpc: RpcCall;
  proof: Nep413Proof;
  expect: { recipient: string; message: string };     // what the signature must cover; the server builds it
  keyPolicy?: "full-access" | { functionCallReceiver: string };  // default "full-access"
  predicate?: Predicate<F>;
  freshness?: Freshness;
  nonceStore?: NonceStore;                            // needs freshness
  nonceTtlMs?: number;                                // a minimum; see step 7
  strictBlock?: boolean;                              // default true
  at?: At;                                            // default "final"
  maxMessageBytes?: number;                           // default 8192
}): Promise<AccountProofResult<F>>;

export function nftOwner(contract: string, tokenId: string): Predicate<{ token: { token_id: string; owner_id: string } }>;
export function ftBalanceAtLeast(contract: string, min: bigint | string): Predicate<{ balance: string }>;
export function sputnikRole(dao: string, role: string): Predicate<{ role: string; kind: "Group" | "Everyone" }>;
export function all<P extends Predicate<unknown>[]>(...predicates: P): Predicate<unknown[]>;

// Re-exported from nep413.ts, unchanged: NEP413_TAG, nep413Hash, verifyNep413, base64ToBytes, bytesToBase64, type Nep413Payload.

// NEP-641 (nep641.ts)
export interface OffchainMessage { chain_id: string; signer_id: string; path?: string[]; timestamp: string; payload: string }
export interface AccessKeyAuthorization {
  msg: OffchainMessage; via: { schema: "nep413"; extra?: { callback_url?: string } }; access_key: string; signature: string;
}
export const NEP641_DOMAIN = "NEAR_NEP641_OFFCHAIN_MESSAGE/V1";
export const NEP641_LIMITS: { payloadBytes: 8192; pathEntries: 16; chainIdChars: 64; accessKeyChars: 128;
  signatureChars: 256; callbackUrlChars: 2048; blobSlackChars: 32_768 };
export type Nep641ParseCode = "malformed" | "too-long" | "unknown-field" | "wrong-schema" | "timestamp-format";
export function parseAccessKeyAuthorization(json: unknown, options?: { maxPayloadBytes?: number }):
  { ok: true; value: AccessKeyAuthorization } | { ok: false; code: Nep641ParseCode; reason: string };
export function encodeOffchainMessage(msg: OffchainMessage): Uint8Array;   // borsh
export function nep641Hash(msg: OffchainMessage): Uint8Array;              // sha3_256(NEP641_DOMAIN || borsh(msg))
export function nep641ToNep413(msg: OffchainMessage, callbackUrl?: string): Nep413Payload;
export function verifyNep641Leaf(input: {
  rpc: RpcCall; authorization: unknown;
  expect: { chainId: "mainnet" | "testnet"; signerId: string; path?: string[] };
  at?: At; strictBlock?: boolean; maxPayloadBytes?: number;   // default 8192
}): Promise<{ ok: true; payload: string; signerId: string; implicit: boolean; block: PinnedBlock }
          | { ok: false; step: 0 | 1 | 2 | 3 | 4 | 5 | 6; code: Nep641Code; reason: string; cause?: unknown }>;
```

## Behaviour of `verifyAccountProof`

The checks run cheapest first, and no RPC call happens before the signature verifies. Every outcome
that depends on the proof is a value; it rejects only with a TypeError for a caller configuration
error that does not depend on the proof.

| Step | What it checks | Refusal |
|---|---|---|
| 0. Configuration | `nonceStore` without `freshness` | rejects with `TypeError("nonceStore needs freshness: without a time bound a nonce TTL means nothing")`: the one rejection |
| 1. Shape | Before anything is decoded or hashed: `accountId` is a NEAR account id; `publicKey` at most 128 characters and `signature` at most 256; a nonce string at most 64 characters (base64 of 32 bytes is 44), then 32 bytes; `expect.message` at most `maxMessageBytes` in UTF-8 (a string longer than that in UTF-16 code units is refused without encoding it); `callbackUrl` a string of at most 2048 characters, or null | 400 `malformed` or `too-long` |
| 2. Time (with `freshness`) | `issuedAt` matches `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$` and round-trips through `Date.parse`; `expect.message` contains `issuedAt` exactly, so the time is part of what was signed; `issuedAt` no earlier than `now - windowMs` and no later than `now + skewMs` | 400 `malformed`, 400 `freshness-unbound`, 401 `stale`, 401 `from-the-future` |
| 3. Signature | An ed25519 key; `verifyNep413` (strict RFC 8032) over `expect.message`, the nonce, `expect.recipient` and `callbackUrl` | 401 `unsupported-key-type`, 401 `bad-signature` |
| 4. Block | `pinnedReader(rpc, at, { strictBlock })` | 502 `rpc-block`, with the error as `cause` |
| 5. Key | `reader.accessKey(accountId, publicKey)` at that block. Full access passes, and so does a gas key with full access (Experimental). A function-call key, or a gas key with function-call access, passes only when `keyPolicy.functionCallReceiver` equals its receiver | 403 `key-not-on-account`, 403 `function-call-key`, 403 `unknown-permission`; 502 `wrong-block` for an answer about another block (see [near-rpc](near-rpc.md#pinned-reads)), 502 `rpc-key` for any other failure |
| 6. Predicate | It runs with the same pinned reader and the same `rpc` | its own status with code `predicate-refused` and `predicateCode` its own code; 502 `predicate-rpc` when it throws |
| 7. Replay (with `nonceStore`) | Last, so a failing proof never uses up a nonce. The clock is read again: `Date.now()`, or `freshness.now` moved on by the time the call has taken. A proof that went stale while it was checked is refused without a claim. Otherwise the key `publicKey + "\n" + hex(nonce) + "\n" + recipient` is claimed until `issuedAt + windowMs + skewMs` by that clock, or for `nonceTtlMs` when that is longer | 401 `stale` (stage "time"), 409 `replayed`, 502 `replay-store` when `claim` throws (fail closed) |

Why step 7 is built this way:

- **The claim outlives every fresh replay.** A replay can pass step 2 until `issuedAt + windowMs`. Its
  own claim is made after its reads, but step 7 refuses it as stale if that moment has passed. So any
  replay that reaches the store does so by `issuedAt + windowMs`, and the first claim lasts until
  `issuedAt + windowMs + skewMs`. Before this rule, the claim lasted `windowMs + skewMs` from the moment
  it was made, and a replay sent just before the proof went stale, behind a slow node, could land
  after the first claim had expired; a unit test replays that case with a clock each read moves on.
- **The key is what the signature binds.** A NEP-413 signature covers the message, the nonce, the
  recipient and the callback URL, not the account id. Keys are often shared between accounts (a
  sub-account made with its parent's key). If the claim named the account, one captured proof could
  be offered once for each account holding the key. A unit test offers one proof for two accounts that
  hold the same key: the second is 409.
- **Name the account in the message, on its own line**, as Satchel's `roomMessage` does with
  `Account: <id>`. Then the signature covers it, and a proof for one account fails for another at step
  3. A substring check of the message for the account id would not do this: a message naming
  `vault.alice.near` also contains `alice.near`.
- **A shared store** must keep a key at least as long as the TTL it is given, by its own clock: its
  expiry must outlive `issuedAt + windowMs`. `skewMs` is the margin for drift between this server's
  clock and the store's.

**Predicates** read with `reader.view` at the pinned block:

| Predicate | Reads | Refusals |
|---|---|---|
| `nftOwner(contract, tokenId)` | `nft_token({token_id})` | 404 `no-token`; 502 `wrong-token` (an answer about another token); 403 `not-owner`; 502 `not-nep171` (a view error, or an answer that is not a token) |
| `ftBalanceAtLeast(contract, min)` | `ft_balance_of({account_id})`, compared as u128 integers | 403 `below-min`; 502 `not-nep141`. A `min` that is not a non-negative integer throws a TypeError when the predicate is made |
| `sputnikRole(dao, role)` | `get_policy` | A Group role that lists the account passes, and an Everyone role does. 403 `not-in-role`; 404 `no-role`; 403 `member-role-unsupported` (a token-weighted Member role, Planned); 502 `not-sputnik` |
| `all(...predicates)` | each in order | the first refusal; otherwise the facts, in order |

## Behaviour of the NEP-641 leaf resolver

The steps follow the NEP's verification procedure and its reference implementation,
[near/intents crates/signatures/nep641](https://github.com/near/intents/tree/main/crates/signatures/nep641).

| Step | What it checks | Codes |
|---|---|---|
| 0. Parse | Sizes first, before any decoding or hashing (`NEP641_LIMITS`): a blob string over 6 × `maxPayloadBytes` + 32768 characters is not parsed; `msg.payload` at most `maxPayloadBytes` (default 8192) in UTF-8; `msg.path` at most 16 entries (counted before each is checked as an account id); `chain_id` 64, `access_key` 128, `signature` 256 and `callback_url` 2048 characters. Unknown fields are refused at every level (the reference refuses them on the authorization; this is stricter inside `msg` and `via`). `via.schema` is "nep413"; `path` may be omitted when empty; `timestamp` is RFC 3339 with a `Z` and 0-9 fractional digits, read to nanoseconds; another offset is refused, stricter than upstream | `malformed`, `too-long`, `unknown-field`, `wrong-schema`, `timestamp-format` |
| 1. Chain | `chain_id` equals `expect.chainId` | `wrong-chain` |
| 2. Signer | `signer_id` equals `expect.signerId` | `wrong-signer` |
| 3. Path | `path` equals `expect.path` (default []), element by element | `wrong-path` |
| 4. Signature | `nep641ToNep413`: message = payload, nonce = `nep641Hash(msg)`, recipient = `"<chain_id>: <signer_id>[ -> <path[i]>]... @ <timestamp to the second, UTC Z>"`, callback URL from `via.extra.callback_url`; strict ed25519 through `verifyNep413`. secp256k1 is Planned | `unsupported-key-type`, `bad-signature` |
| 5. Time | `timestamp` is not after the pinned block's `timestampNs`, so a fresh authorization is never resolved against older state (nep-0641.md, near line 114) | `rpc-block`, `timestamp-after-block` |
| 6. Key at the pinned block | `reader.account(signer_id)` first. An account that exists must hold `access_key` with full access; a gas key with full access counts (Experimental). An account that does not exist passes only if `signer_id` is the key's implicit account id, the hex of its 32 bytes, as the reference's `to_implicit_account_id` does; NEP-616 `0s…` accounts never equal a hex id, so they never qualify | `key-not-on-account`, `function-call-key`, `unknown-permission`, `no-account`, `wrong-block`, `rpc-account`, `rpc-key` |

The result is the leaf's `payload`. Recursion through contract authorizations (`w_resolve_auth`) is
Planned; when it ships, its depth and count caps default to 0, as the NEP's reference resolver does
(nep-0641.md:128).

Step 6 relies on an `UNKNOWN_ACCOUNT` error to decide that an account does not exist, so that error's
block is checked like an answer's: an error about another block is `wrong-block` always, and an error
that names no block is `wrong-block` under `strictBlock` (the default). Before this rule, an
`UNKNOWN_ACCOUNT` about another block made an implicit-account leaf pass. The NEP says a resolver
SHOULD check that each RPC response refers to the requested block.

## Edge cases

- **A key removed after signing** is refused at the pinned block; that is the point of pinning.
- **A nonce replayed on a second server instance** is not caught by `memoryNonceStore`. Behind more
  than one instance, use a shared store.
- **An implicit account that does not exist yet.** The two functions differ here on purpose:
  `verifyAccountProof` refuses it with `key-not-on-account`, because it requires an on-chain key;
  `verifyNep641Leaf` accepts it, by the NEP's rule.
- **`at: { blockHash }` with a historical block** needs an archival `rpc`.
- **JSON.** A result's `block.timestampNs` is a string, so `JSON.stringify(result)` works.
- **A full `memoryNonceStore`** (10 000 nonces that have not expired) throws, so the proof fails
  closed with 502 `replay-store` rather than forget a live nonce.

## Security notes

- **Function-call keys** are refused by default. A site you signed in to keeps such a key, and that key
  can sign NEP-413 messages too. `functionCallReceiver` lets a site accept only keys issued for its own
  contract.
- **One block.** The key, the predicate and the replay decision use one block, and `strictBlock`
  refuses answers, and errors turned into answers, about another block. There is no window where the
  key is checked at block N and ownership at block N+5.
- **Recipient binding.** Wallets show the recipient. Use your own domain, and never accept a proof
  whose recipient you did not choose.
- **Freshness** is bound to the signed text (step 2). Prefer a server-issued random 32-byte challenge
  as the nonce. A client-chosen nonce is safe only with `freshness` and a shared `nonceStore`.
- **Cost.** The RPC is reached only after a valid signature, but anyone can make one with a fresh
  ed25519 key for any account id. Such a request still costs one block read and one key read before it
  fails `key-not-on-account`. Rate-limit per IP and per account id; you may also cache "key K is not on
  account A at block N" for the life of that block.
- **Unauthenticated input.** Every field a client sends is capped before it is decoded or hashed
  (steps 1 and 0 above), and neither function throws on input, so both are safe to call on
  unauthenticated input.
- **RPC trust.** As [near-rpc](near-rpc.md#security-notes) says: pinning stops a node from mixing
  blocks inside one decision, not from lying consistently.

Only ed25519 keys are in scope. NEP-413 secp256k1 signatures are Planned, and give
`unsupported-key-type` today.

## Fixtures

Folder: `packages/satchel-nft/src/__fixtures__/primitives/account-proof/`. The chain reads were
captured on 2026-11-14 by `node scripts/capture-primitive-fixtures.mjs --only account-proof`
(12:32:21Z) through `readOnlyRpc`; each of their `provenance` names the node, the source of every id,
the block and why it was chosen, the node version (2.14.1) and the capture time.
`nep641-vectors.json` was copied from near/intents instead (see its row), with no node or block.

| File | What it holds |
|---|---|
| `src/__fixtures__/nep413-near-cli.json` (existing, read only) | Two real signatures made with near-cli-rs 0.30.1 on 2026-11-10, by satchel-nft.testnet (key `ed25519:FqmLsnuhrwC7jFqzHCiNzUcZ6qQ1a23y4jasFJwRpS8w`, message "Satchel test vector") and buyer.satchel-nft.testnet (key `ed25519:4UKgqHFuJtHVSMUD6nsvxGsByuBPVLN8WRdigoqaYoEU`, a multi-line UTF-8 message), both for the recipient satchelnft.xyz, with no issued-at time |
| `holder-at-buyer-sign.json` | Testnet archival, pinned to block 276856730 (`CNRhq6Ac5izeA9qkW8Cshrw6sr9zqozqo6B69kRPGwEd`), the block of receipt FS7g9f4c…, in which `v1.satchel-nft.testnet` ran the buyer's `sign_evm` (`deployments/testnet-e2e.json` `steps[5].tx`, 9GYTuZJo…). The buyer owned #1 then, since the sign was accepted. It holds the transaction, the block, both keys on both accounts, `nft_token("1")`, `nft_token("1000000")` (null: no such token), `nft_token` on wrap.testnet (`MethodNotFound`), `ft_balance_of` on wrap.testnet for both accounts, and `get_policy` of `satchel-club.sputnikv2.testnet`, which did not exist yet (`UNKNOWN_ACCOUNT`, naming that block) |
| `proof-testnet-final.json` | At a final block, 277657341 (`8tmYagwC…`), after the DAO was created, read through the archival node so it can be read again: the block, each account's own key, `nft_token("1")`, `ft_balance_of` on wrap.testnet for both accounts, and `get_policy` of `satchel-club.sputnikv2.testnet` |
| `nep641-testnet-final.json` | At block 277657345 (`DNdfzeH9…`): `view_account` of the unit tests' key's implicit account `3e66629b…a72f` (`UNKNOWN_ACCOUNT`), of `v1.satchel-nft.testnet` (exists, no keys) and of `missing.v1.satchel-nft.testnet`, and `view_access_key` of that key on `v1.satchel-nft.testnet` |
| `nep641-vectors.json` | The two doc-test vectors of `OffchainMessage::hash` and `into_nep413_payload` in near/intents `crates/signatures/nep641/src/message.rs` at `75d2976949f2b05693133b123e8eefb3f14add05` (committed 2026-10-20), copied as data: the hash `ac9fc5df…62ae`, and the NEP-413 mapping with nonce `039f8afb…f72c`, recipient `mainnet: extension.near -> wallet.near -> v1.signer @ 2026-08-05T07:28:00Z` and callback `https://wallet.com/callback` |

No `function-call-key.json` was written. The capture looked for a FunctionCall key on
satchel-nft.testnet, buyer.satchel-nft.testnet and satchel-council-1112.testnet at block 277657349;
each holds one full-access key. So the function-call refusal, and `functionCallReceiver`, are tested
with a labelled in-test change of a recorded key's permission. The gas-key shapes are labelled in-test
shapes too: no real gas-key answer is recorded.

## Tests

Unit tests: `account-proof.test.ts` (33) and `nep641.test.ts` (21), through `replayRpc` on the
cassettes above, plus a few labelled in-test changes:

- the buyer's near-cli-rs vector with `nftOwner(v1.satchel-nft.testnet, "1")` at the sign block passes,
  and satchel-nft.testnet's gives 403 `predicate-refused` with `predicateCode` `not-owner`;
- each stage's failure, with its status, stage and code; the caps (`too-long`) before any decoding;
- freshness: `freshness-unbound`, stale and from-the-future against a fixed `now`, a malformed
  `issuedAt`, the TypeError, and an end-to-end proof signed in the test by an ephemeral key, with a
  message built like `roomMessage`;
- replay: the claim key and its TTL against a fixed clock, `nonceTtlMs` as a minimum, a slow replay
  refused as stale, one proof for two accounts, a throwing store, and a failing proof that claims
  nothing;
- `strictBlock`: a key answer, or a key error, about another block or about no block;
- NEP-641: the codec equals both upstream vectors; parse refusals at every level and every cap; each
  of steps 1-6 refused through a cassette; an `UNKNOWN_ACCOUNT` about another block never makes the
  implicit account pass.

## Live tests

`src/account-proof.live.test.ts` and `src/nep641.live.test.ts` read testnet through the public
endpoints and `readOnlyRpc`. They are skipped unless one of the two variables is set:

```bash
SATCHEL_LIVE=1 npm test -w satchel-nft -- account-proof.live nep641.live   # final block, regular node
SATCHEL_LIVE_ARCHIVAL=1 npm test -w satchel-nft -- account-proof.live      # the sign_evm receipt block, archival node
```

In PowerShell: `$env:SATCHEL_LIVE='1'; npm test -w satchel-nft -- account-proof.live`.

| Run (UTC) | Command | Result |
|---|---|---|
| 2026-11-14 13:54:14 | `SATCHEL_LIVE=1 npm test -w satchel-nft -- account-proof.live` | 2 passed, 2 skipped |
| 2026-11-14 13:54:21 | `SATCHEL_LIVE=1 npm test -w satchel-nft -- nep641.live` | 3 passed |
| 2026-11-14 13:56:51 | `SATCHEL_LIVE_ARCHIVAL=1 npm test -w satchel-nft -- account-proof.live --reporter=verbose --silent=false` | 2 passed, 2 skipped |
| 2026-11-14 13:57:27 | `SATCHEL_LIVE_ARCHIVAL=1 npm test -w satchel-nft -- nep641.live --reporter=verbose --silent=false` | 3 skipped (no archival group) |
| 2026-11-14 14:04:01 | `SATCHEL_LIVE=1 npm test -w satchel-nft -- account-proof.live --reporter=verbose --silent=false` | 2 passed, 2 skipped |
| 2026-11-14 14:04:07 | `SATCHEL_LIVE=1 npm test -w satchel-nft -- nep641.live --reporter=verbose --silent=false` | 3 passed |
| 2026-11-14 14:20:18 | `SATCHEL_LIVE=1 npm test -w satchel-nft -- account-proof.live nep641.live` | 5 passed, 2 skipped |
| 2026-11-14 14:32:58 | `SATCHEL_LIVE=1 npm test -w satchel-nft -- account-proof.live --reporter=verbose` | 2 passed, 2 skipped |
| 2026-11-14 14:33:12 | `SATCHEL_LIVE=1 npm test -w satchel-nft -- nep641.live --reporter=verbose` | 3 passed |
| 2026-11-14 14:35:10 | `SATCHEL_LIVE_ARCHIVAL=1 npm test -w satchel-nft -- account-proof.live --reporter=verbose` | 2 passed, 2 skipped |
| 2026-11-14 14:35:52 | `SATCHEL_LIVE_ARCHIVAL=1 npm test -w satchel-nft -- nep641.live --reporter=verbose` | 3 skipped (no archival group) |
| 2026-11-14 14:36:01 | `SATCHEL_LIVE=1 SATCHEL_LIVE_ARCHIVAL=1 npm test -w satchel-nft -- near-rpc.live chain-signatures.live account-proof.live nep641.live --reporter=verbose` | 25 passed in 4 files, account-proof's 4 and nep641's 3 among them |

The runs from 14:32 on are the final check, on the code of commit `f7b0f4a` (Node 24.12.0, Windows
10), with no API key set: no read was rate-limited and no test timed out.

What they check, with the blocks the final check's 14:32:58, 14:33:12 and 14:35:10 runs read:

- final block (SATCHEL_LIVE):
  - satchel-nft.testnet's near-cli-rs vector, with no predicate and no freshness, passes with a
    full-access key (block 277669743). This assumes the builder keeps that key; if it is removed, the
    test is updated with the date and the reason;
  - the predicates at a final block: the buyer's vector with `nftOwner` passes, owner
    `buyer.satchel-nft.testnet`; satchel-nft.testnet's with `sputnikRole(satchel-club.sputnikv2.testnet,
    "council")` passes, a Group role; the buyer's with the same role is 403 `predicate-refused`
    (`not-in-role`); and the buyer's with `ftBalanceAtLeast(wrap.testnet, 0)` passes (the buyer held 0
    at block 277669750). That balance read had a minimum of 0, so the `below-min` refusal is covered by
    the unit tests only;
  - NEP-641 with an ephemeral in-process key (no transaction, no real key): the key's implicit
    account, which does not exist, is accepted (block 277669768); a leaf of the same kind for
    `v1.satchel-nft.testnet` (exists, no keys) is refused at step 6; a leaf timestamped an hour ahead is
    refused at step 5.
- the sign_evm receipt block (SATCHEL_LIVE_ARCHIVAL): at block 276856730, the block of receipt
  FS7g9f4c…, the buyer's vector with `nftOwner` passes with full access and owner
  `buyer.satchel-nft.testnet`, satchel-nft.testnet's is 403 `predicate-refused` (`not-owner`); and
  every call of the three recorded cassettes, re-read, gives the answer it holds.

## Examples

The outputs below are from the final check on 2026-11-14, at the code of commit `f7b0f4a`.

`examples/account-proof.mjs` runs the two recorded vectors at the 9GYTuZJo… receipt block through
testnet's archival node, at 14:40:06Z:

```
$ node packages/satchel-nft/examples/account-proof.mjs testnet 9GYTuZJoQAKcYib8NCEKXtcqDkRjGfy9nLavajkGaLnM
network        testnet
read from      https://archival-rpc.testnet.fastnear.com (fallback https://archival-rpc.testnet.near.org)
tx             9GYTuZJoQAKcYib8NCEKXtcqDkRjGfy9nLavajkGaLnM, signed by buyer.satchel-nft.testnet
receipt        FS7g9f4cmPyHQQCogNkpVJipLT9oNCFd9x72bPpmQ8TV: v1.satchel-nft.testnet ran sign_evm for satchel #1
pinned to      that receipt's block CNRhq6Ac5izeA9qkW8Cshrw6sr9zqozqo6B69kRPGwEd
predicate      nftOwner(v1.satchel-nft.testnet, "1")
proof by       satchel-nft.testnet
  key          ed25519:FqmLsnuhrwC7jFqzHCiNzUcZ6qQ1a23y4jasFJwRpS8w
  message      "Satchel test vector", for satchelnft.xyz
  block        276856730 (CNRhq6Ac5izeA9qkW8Cshrw6sr9zqozqo6B69kRPGwEd), 2026-11-09T01:52:57.998Z
  result       403 predicate predicate-refused (not-owner)
  reason       buyer.satchel-nft.testnet owns token 1 on v1.satchel-nft.testnet at block 276856730, not satchel-nft.testnet
proof by       buyer.satchel-nft.testnet
  key          ed25519:4UKgqHFuJtHVSMUD6nsvxGsByuBPVLN8WRdigoqaYoEU
  message      "Open the holder room of Satchel #4\nNetwork: testnet\nNote: café — a multi-line UTF-8 vector", for satchelnft.xyz
  block        276856730 (CNRhq6Ac5izeA9qkW8Cshrw6sr9zqozqo6B69kRPGwEd), 2026-11-09T01:52:57.998Z
  permission   full-access
  owner        buyer.satchel-nft.testnet owns #1
  result       ok
```

`examples/nep641-leaf.mjs` makes an ephemeral key in the process (it signs these two messages and
nothing else), prints the NEP-413 mapping and resolves each leaf on testnet at a final block, at
14:40:10Z. Its second argument, the account that exists without the key, is the contract
`deployments/testnet.json` records (also its default):

```
$ node packages/satchel-nft/examples/nep641-leaf.mjs testnet v1.satchel-nft.testnet
network        testnet, read from https://rpc.testnet.fastnear.com at a final block
key            ed25519:FMFjz4m2GCGoigG9mDcSGrsuZDQ2d1kGRyZ72xHV7VYL (made in this process; it signs these two messages only)
implicit id    d533e6a5c3053df59b7a157ab07d9c8b96193828b0c7e698d3a1ae57a693f3f9
leaf 1: the key's implicit account
  signer_id    d533e6a5c3053df59b7a157ab07d9c8b96193828b0c7e698d3a1ae57a693f3f9
  timestamp    2026-11-14T14:39:10.944Z
  payload      {"domain":"example.app","action":"Login","msg":"nep641-leaf.mjs"}
  NEP-413 payload the wallet signs:
    message    the payload above
    nonce      8cf68f1b5e57d0370ef5ff9737451ad7e56ee5b30426e6d323a59a8669a0940c (sha3_256 of NEAR_NEP641_OFFCHAIN_MESSAGE/V1 and borsh(msg))
    recipient  testnet: d533e6a5c3053df59b7a157ab07d9c8b96193828b0c7e698d3a1ae57a693f3f9 @ 2026-11-14T14:39:10Z
  block        277670485 (A2qZHPW4tJjL4fhSQeqQ6L7v7v2mpzaTMu4gu4yX3Qon), 2026-11-14T14:40:09.304Z
  result       ok: the payload is authorized by d533e6a5c3053df59b7a157ab07d9c8b96193828b0c7e698d3a1ae57a693f3f9 (an implicit account, not created yet)
leaf 2: v1.satchel-nft.testnet, an account that exists without this key
  signer_id    v1.satchel-nft.testnet
  timestamp    2026-11-14T14:39:12.875Z
  payload      {"domain":"example.app","action":"Login","msg":"nep641-leaf.mjs"}
  NEP-413 payload the wallet signs:
    message    the payload above
    nonce      a18c039082bbd9f76176962973d27a9fbf903f66abe4950c79b12df174352e37 (sha3_256 of NEAR_NEP641_OFFCHAIN_MESSAGE/V1 and borsh(msg))
    recipient  testnet: v1.satchel-nft.testnet @ 2026-11-14T14:39:12Z
  result       refused at step 6: key-not-on-account
  reason       ed25519:FMFjz4m2GCGoigG9mDcSGrsuZDQ2d1kGRyZ72xHV7VYL is not a key of v1.satchel-nft.testnet at block 277670488
```

The key is new on every run, so its id, nonces and blocks differ each time. On mainnet,
`node packages/satchel-nft/examples/nep641-leaf.mjs mainnet v1.satchel-nft.near` at 14:40:13Z gave
the same two results: leaf 1, the key's implicit account, `ok` at block 224527831, and leaf 2,
`v1.satchel-nft.near`, `refused at step 6: key-not-on-account`.

Both exit 0 whatever the result, and 1 only when a read fails. Run `npm run build -w satchel-nft`
first.

## Status

Implemented means unit tests on recorded real data with provenance, a live test that passed with its
date and command recorded here, and an example's real output quoted. Experimental means shipped and
unit-tested, but a path lacks recorded real data or depends on a shape that is undocumented or
changing. Planned means designed, not shipped.

| Function | Status | Why |
|---|---|---|
| `verifyAccountProof`, `nftOwner` | Implemented | the near-cli-rs vectors and the `holder-at-buyer-sign` cassette; the live tests at a final block and at the receipt block 276856730 (the buyer ok, the previous owner 403 `not-owner`); the three cassettes re-read live; and the account-proof example, whose output above is quoted from the final check |
| `all`, `memoryNonceStore` | Implemented | unit tests on the cassettes. Both are local logic with no chain read of their own, so no live test calls them directly |
| `ftBalanceAtLeast` | Implemented | its cassette entries (wrap.testnet balances), and the live read at a final block on 2026-11-14. That read had a minimum of 0 against a balance of 0, so the `below-min` refusal rests on the unit tests |
| `sputnikRole` for a Group role | Implemented | its cassette entries (the council of `satchel-club.sputnikv2.testnet`), and the live read at a final block on 2026-11-14: satchel-nft.testnet in the council, the buyer 403 `not-in-role` |
| `sputnikRole` for an Everyone role | Experimental | the recorded DAO has no Everyone role; a labelled in-test change of its policy |
| Function-call keys under `functionCallReceiver` | Experimental | no real FunctionCall key recorded; a labelled in-test permission change |
| Gas-key acceptance | Experimental | no real gas-key answer recorded |
| The NEP-413 helpers re-exported from nep413.ts: `NEP413_TAG`, `nep413Hash`, `verifyNep413`, `base64ToBytes`, `bytesToBase64` | Implemented | nep413.ts, whose only change is its base58 import, with its 7 tests unchanged, on real near-cli-rs signatures; every live proof goes through them |
| The codec: `encodeOffchainMessage`, `nep641Hash`, `nep641ToNep413`, `parseAccessKeyAuthorization`, `NEP641_DOMAIN`, `NEP641_LIMITS` | Implemented | near/intents' vectors; the NEP-641 live tests go through them |
| `verifyNep641Leaf` | Experimental | its live tests (3 of 3 in the final check) and its example on both networks pass, but no full-access path signed by a real on-chain key is recorded yet. One owner action would fix it: sign one NEP-641-mapped NEP-413 message with near-cli-rs, then commit it as a fixture with its provenance |
| Recursion (`w_resolve_auth`), secp256k1 NEP-413, the Member-role predicate (`member-role-unsupported` today), `checkHolder` calling `verifyAccountProof` | Planned | designed only |
