# satchel-nft/near-rpc

A plain JSON-RPC transport for any NEAR node, and reads pinned to one block. The other primitives
share it, and a NEAR backend can use it on its own. It does five things:

- retries the failures worth retrying, and names rate limiting as such;
- pins every read to one block hash, and refuses an answer about another block;
- pages access-key lists without dropping pages;
- reads a transaction with all its receipts and their blocks, with an archival fallback;
- guards a transport so that only read methods pass (`readOnlyRpc`).

It is new code: Satchel's own near.ts, tx-index.ts and config.ts are unchanged, and where near-rpc
mirrors them a parity test compares the two. Source:
[packages/satchel-nft/src/near-rpc.ts](../../packages/satchel-nft/src/near-rpc.ts).

```ts
import { ENDPOINTS, httpRpc, pinnedReader, readOnlyRpc } from "satchel-nft/near-rpc";

const rpc = readOnlyRpc(httpRpc(ENDPOINTS.mainnet.rpc));
const reader = await pinnedReader(rpc); // one final block; every read below is at its hash
const { keys, pages } = await reader.accessKeys("intents.near", { pageSize: 2 });
const account = await reader.account("v1.satchel-nft.near"); // null if it does not exist at that block
```

## What exists already

**@fastnear/api 2.5.0** (npm, read with `npm view` on 2026-11-14) is a client for FastNEAR's
services. near-rpc does not wrap it: it is a plain JSON-RPC transport for any node, FastNEAR's, NEAR's
or your own, with the block pinning and paging described here. It is a library, not a hackathon entry.

## API

```ts
export const ENDPOINTS: {
  mainnet: { rpc: "https://rpc.mainnet.fastnear.com"; archival: "https://archival-rpc.mainnet.fastnear.com";
             nearArchival: "https://archival-rpc.mainnet.near.org"; txApi: "https://tx.main.fastnear.com" };
  testnet: { rpc: "https://rpc.testnet.fastnear.com"; archival: "https://archival-rpc.testnet.fastnear.com";
             nearArchival: "https://archival-rpc.testnet.near.org"; txApi: "https://tx.test.fastnear.com" };
};
export type RpcCall = <T>(method: string, params: unknown) => Promise<T>;

export type RpcErrorKind = "timeout" | "http" | "rate-limited" | "network" | "rpc-error" | "bad-answer";
export class RpcError extends Error {
  readonly method: string; readonly kind: RpcErrorKind; readonly detail: string;
  readonly status: number | null;   // HTTP status, when there was one
  readonly data: unknown;           // the JSON-RPC `error` body, for kind "rpc-error"
  readonly tries: number;
  readonly endpoint: string;        // redactUrl(url): the origin only
}
export class ReadOnlyError extends Error { readonly method: string; readonly detail: string }

export interface HttpRpcOptions {
  timeoutMs?: number;           // default 10_000
  retries?: number;             // default 4, so 5 tries
  concurrency?: number;         // default 4 requests in flight per transport
  maxRetryAfterMs?: number;     // default 8_000
  giveUpRetryAfterMs?: number;  // default 30_000: a longer Retry-After fails at once
  headers?: Record<string, string>;  // e.g. { Authorization: "Bearer <key>" }; never logged, never in errors
  fetch?: typeof fetch;
}
export function httpRpc(url: string, options?: HttpRpcOptions): RpcCall;
export function httpGetJson<T>(url: string, options?: Omit<HttpRpcOptions, "concurrency">): Promise<T>;
export function fastnearSenderLookup(txApiBase: string, options?: HttpRpcOptions): (hash: string) => Promise<string | null>;
export function redactUrl(url: string): string;   // origin only: scheme, host, port
export function withFallback(primary: RpcCall, fallback: RpcCall): RpcCall;
export const READ_METHODS: readonly ["block", "status", "query", "EXPERIMENTAL_tx_status", "tx_status"];
export const READ_QUERY_TYPES: readonly ["view_account", "view_access_key", "view_access_key_list", "view_code", "call_function"];
export function readOnlyRpc(rpc: RpcCall): RpcCall;

export interface PinnedBlock { height: number; hash: string; prevHash: string; timestamp: string; timestampNs: string }
export type At = "final" | { blockHash: string } | { height: number };
export function blockAt(rpc: RpcCall, at?: At): Promise<PinnedBlock>;

export type KeyPermission =
  | { kind: "full-access" }
  | { kind: "function-call"; receiverId: string; methodNames: string[]; allowance: string | null }
  | { kind: "gas-key-full-access"; raw: unknown }                                                   // Experimental
  | { kind: "gas-key-function-call"; receiverId: string | null; methodNames: string[] | null; raw: unknown }  // Experimental
  | { kind: "unknown"; raw: unknown };
export function parsePermission(raw: unknown): KeyPermission;
export interface AccessKeyInfo { publicKey: string; nonce: string; permission: KeyPermission }
export interface AccountView { amount: string; locked: string; code_hash: string; storage_usage: number;
  global_contract_hash?: string; global_contract_account_id?: string }
export type ViewErrorKind = "method-not-found" | "panic" | "no-code" | "account-missing";
export class ViewError extends Error { readonly account: string; readonly method: string; readonly kind: ViewErrorKind; readonly detail: string }
export interface PinnedReader {
  readonly block: PinnedBlock;
  view<T>(account: string, method: string, args?: unknown): Promise<T>;   // throws ViewError or RpcError
  account(accountId: string): Promise<AccountView | null>;
  accessKey(accountId: string, publicKey: string): Promise<AccessKeyInfo | null>;
  accessKeys(accountId: string, options?: { pageSize?: number; max?: number }): Promise<{ keys: AccessKeyInfo[]; pages: number; paged: boolean }>;
  codeSha256(accountId: string): Promise<{ base58: string; bytes: number } | null>;   // reads the whole code
}
export function pinnedReader(rpc: RpcCall, at?: At, options?: { strictBlock?: boolean }): Promise<PinnedReader>;

export interface TxStatusView { transaction; transaction_outcome; status; receipts_outcome; receipts? }   // nearcore's shape
export interface ReceiptView {
  receiptId: string; blockHash: string | null; executorId: string; predecessorId: string | null; receiverId: string | null;
  actions: unknown[]; status: unknown; logs: string[]; next: string[];
}
export function receiptsOf(tx: TxStatusView): ReceiptView[];
export function functionCalls(receipt: ReceiptView): { method: string; argsBase64: string; deposit: string; gas: string }[];
export interface ReadTxOptions {
  sender?: string; senderLookup?: (hash: string) => Promise<string | null>;
  archival?: RpcCall;                                     // tried once if the first node throws an RpcError
  waitUntil?: "FINAL" | "EXECUTED_OPTIMISTIC" | "NONE";   // default FINAL
  method?: "EXPERIMENTAL_tx_status" | "tx_status";        // default EXPERIMENTAL_tx_status
}
export class ReadTxError extends Error { readonly code: "no-sender" | "sender-lookup" | "wrong-tx"; readonly hash: string }
export function readTx(rpc: RpcCall, hash: string, options?: ReadTxOptions): Promise<TxStatusView>;

export function isAccountId(text: string): boolean;   // config.ts's rule
export function encodeArgs(args: unknown): string;    // as near.ts does
export function decodeBase64(value: string): string;  // as near.ts does
```

## Behaviour

### Transport

| Function | What it does |
|---|---|
| `httpRpc(url)` | POSTs `{jsonrpc: "2.0", id: "satchel", method, params}`, the body near.ts sends. Retries HTTP 408, 429, 500, 502, 503 and 504, a fetch that got no answer, and its own timeout, with jittered backoff of 1, 2, 4, then 8 s, or the node's Retry-After up to `maxRetryAfterMs`. A Retry-After above `giveUpRetryAfterMs` fails at once as `rate-limited`. A JSON-RPC `error` body is an answer, never retried: it throws `rpc-error` at once, also when a node sends it with HTTP 422, as nodes do for an unknown block. At most `concurrency` requests are in flight per transport |
| `httpGetJson(url)` | The same rules with GET. Its errors name the method `GET` and the origin, never the path, which can hold a key |
| `fastnearSenderLookup(base)` | POSTs `{tx_hashes: [hash]}` to `${base}/v0/transactions` and returns `transactions[0].transaction.signer_id`, or null |
| `withFallback(primary, fallback)` | One call to the fallback when the primary throws an `RpcError` of kind timeout, http, rate-limited or network. Kinds rpc-error and bad-answer pass through: they are answers |
| `readOnlyRpc(rpc)` | Throws `ReadOnlyError` before calling `rpc` for a method outside `READ_METHODS` (`broadcast_tx_async`, `broadcast_tx_commit`, `send_tx` and the rest) and for a `query` whose `request_type` is outside `READ_QUERY_TYPES` |

Errors read `NEAR RPC ${method} failed at ${origin}: ${detail}`:

| Kind | Detail |
|---|---|
| `timeout` | `no answer in ${timeoutMs / 1000} s`, near.ts's wording |
| `http` | `HTTP ${status}` |
| `rate-limited` | `transport: rate-limited (HTTP ${status}) after ${tries} tries`, for 429 and 503 once the retries run out |
| `network` | `network error: …` |
| `rpc-error` | the JSON-RPC error as JSON |
| `bad-answer` | what was wrong with the answer |

A live test that ends in `rate-limited` is a transport problem, not evidence that a design fact is
wrong.

Built with a URL that does not parse, `httpRpc`, `httpGetJson` and `fastnearSenderLookup` throw
`TypeError("the URL is not an absolute http(s) URL; it is not shown")`. With credentials or a query
string they throw `httpRpc takes a URL without credentials or a query string; send an API key as
headers: { Authorization: "Bearer <key>" }`. FastNEAR accepts a key as `?apiKey=`, which would end up
in fixtures and errors, so that form is refused. A header that fetch would refuse (a line break in its
value, say) throws when the transport is built, naming the header but not its value, so no request
leaves and nothing is retried.

### Pinned reads

`blockAt` resolves the block once, with `block` and `{finality: "final"}`, `{block_id: hash}` or
`{block_id: height}`, and refuses a block answer about another block than the one asked. `prevHash`
is `header.prev_hash`; `timestampNs` is `header.timestamp_nanosec` (or `header.timestamp`), a decimal
string so results stay JSON-safe. `pinnedReader` then sends every query with `block_id: <hash>`.

**Every answer must be about the pinned block**, results and errors alike:

| The node answers | `strictBlock: true` (default) | `strictBlock: false` |
|---|---|---|
| a result whose `block_hash` is the pinned hash | read | read |
| a result about another block | `bad-answer` `answered at block X, not Y` | the same |
| a result with no `block_hash` | `bad-answer` `answered without a block hash` | read, as near.ts does |
| an error the reader turns into a value (`UNKNOWN_ACCOUNT`, `UNKNOWN_ACCESS_KEY`, `NO_CONTRACT_CODE`, `CONTRACT_EXECUTION_ERROR`) whose `cause.info.block_hash` is the pinned hash | null, or a `ViewError` | the same |
| such an error about another block | `bad-answer` `answered at block X, not Y` | the same |
| such an error naming no block | `bad-answer` `answered without a block hash` | null, or a `ViewError` |
| any other JSON-RPC error (`UNKNOWN_BLOCK`, `GARBAGE_COLLECTED_BLOCK`, …) | passed on as `rpc-error` | the same |

nearcore names the block it answered about in `cause.info.block_hash` of these errors: the recorded
`UNKNOWN_ACCOUNT` and `NO_CONTRACT_CODE` errors carry it, and the live test checks that both networks'
nodes still send it. Without this rule, an `UNKNOWN_ACCOUNT` about another block read as "this account
does not exist", which a NEP-641 leaf for an implicit account then accepted (see
[account-proof](account-proof.md#behaviour-of-the-nep-641-leaf-resolver)). account-proof maps both
`bad-answer` texts to `wrong-block`.

A query at block B returns the state after B's chunks ran, so what a receipt saw before it ran is
read at its block's `prevHash`.

| Read | Gives |
|---|---|
| `view(account, method, args)` | `result.result` decoded as JSON, or null for an empty result. A `result.error` text (how a view panic usually comes back) is a `ViewError`, kind method-not-found, no-code (a `CodeDoesNotExist` text) or panic, with near.ts's `viewErrorMessage` text. `UNKNOWN_ACCOUNT` is kind account-missing, `NO_CONTRACT_CODE` no-code, `CONTRACT_EXECUTION_ERROR` method-not-found or panic; the `RpcError` is its `cause` |
| `account(id)` | the account, or null on `UNKNOWN_ACCOUNT` |
| `accessKey(id, key)` | the key and its permission, or null on `UNKNOWN_ACCESS_KEY`, `UNKNOWN_ACCOUNT` or a `result.error` that says "does not exist", as near.ts does. Call `account()` first to tell a missing account from a missing key |
| `accessKeys(id, { pageSize, max })` | every key, page by page (below) |
| `codeSha256(id)` | sha256 of `view_code`'s bytes in base58, which equals `view_account`'s `code_hash`, and the size; null on `NO_CONTRACT_CODE` or `UNKNOWN_ACCOUNT`. It reads the whole code |

**Permissions.** `"FullAccess"` is full-access; `{FunctionCall: {allowance, receiver_id,
method_names}}` is function-call; an object whose one key is `GasKeyFullAccess` (or that string) is
gas-key-full-access; one whose one key is `GasKeyFunctionCall` is gas-key-function-call, with the
receiver and methods of a FunctionCall-shaped object inside it, else null; anything else is
`{kind: "unknown", raw}`, which callers treat as never passing.

### Paging access keys on nearcore 2.14

nearcore 2.14 added `after_key` and `limit` to `view_access_key_list`, and `last_key` to its answer.
Read on 2026-11-14 in nearcore's `2.14.0` tag (commit `bc4e9e8cfb03d9e82f027883055624e18576993e`):

- `runtime/runtime/src/state_viewer/mod.rs`, `view_access_keys`: with `after_key` or `limit`, a page
  holds at most `min(limit, view_access_keys_limit)` keys, so a larger `limit` is clamped, not
  refused. `last_key` is set only when the page is full and at least one more key follows, so the
  last page carries no `last_key`, even when it is full. Without either field, an account with more
  keys than the limit fails with `TooManyAccessKeys`.
- `core/primitives/src/views.rs`, `AccessKeyList`: `last_key` has
  `skip_serializing_if = "Option::is_none"`, so on the last page it is absent from the JSON, not
  `null`.

Seen on mainnet the same day, in the recorded fixture
`src/__fixtures__/primitives/near-rpc/intents-keys-paged.json` (`intents.near` at block 224506284,
`limit: 2`, node 2.14.1): 9 keys over 5 pages; pages 1 to 4 carry `last_key`, page 5 (one key) has
none, and asking after the last key answers an empty page with no `last_key`.

So `accessKeys` (`pageSize` default 100, `max` default 10 000) never stops on a short page (a
clamped node sends short pages with more after them), stops when `last_key` is absent, and also stops
on an empty page, for a node that always sends `last_key`. It refuses paging that repeats a key
(`paging repeated a key`) or does not advance (`paging did not advance`), and fails past `max` keys
(`more than ${max} keys`). A node older than 2.14 that refuses the paging fields (an `rpc-error` naming
`REQUEST_VALIDATION_ERROR` or "unknown field") gets one unpaged call (`paged: false`); that path is
Experimental until such a node is seen.

The same `views.rs` writes gas keys as `GasKeyFunctionCall { balance, num_nonces, allowance,
receiver_id, method_names }` and `GasKeyFullAccess { balance, num_nonces }`. No real gas-key answer is
recorded yet, so their parsing is Experimental.

### Transactions

`readTx(rpc, hash)` takes the sender from `sender`, else `senderLookup` (`ReadTxError` `no-sender` for
null, `sender-lookup` with the cause when it throws), calls `method` with `{tx_hash,
sender_account_id, wait_until}`, tries `archival` once if the first node throws an `RpcError`, and
refuses an answer about another transaction (`wrong-tx`). nearcore 2.14 renamed
`EXPERIMENTAL_tx_status` to `tx_status` and kept the old name as an alias; the default stays the old
name, which older nodes serve.

`receiptsOf(tx)` joins each `receipts_outcome` entry with the `receipts` entry of the same id, in
`receipts_outcome` order. A receipt with no `Action` actions (a data receipt) gives `actions: []` with
its predecessor and receiver; an outcome with no `receipts` entry of its id (a trimmed answer with no
`receipts`, say) gives `actions: []` and null predecessor and receiver; an outcome with no
`block_hash` gives `blockHash: null`.
`functionCalls(receipt)` lists its FunctionCall actions.

## A regular node and a transaction it has dropped

Regular nodes keep a transaction for a day or two. On 2026-11-14, `rpc.testnet.fastnear.com` answered
`EXPERIMENTAL_tx_status` for testnet `EZLXcvf43jqHYFUJm7gt3Ris5yM1Ru2FPihiEqJW1GUo` (included at block
276856696) with HTTP 408, `TIMEOUT_ERROR` / `NOT_OBSERVED`, after 30.6 s (a read at 15:21:33 UTC).
`httpRpc` retries a 408 and its own timeout (10 s by default, 5 tries), so with the defaults each try
times out first, and that first read takes about a minute (five 10 s tries and 7.5 to 15 s of backoff)
before `readTx` tries `archival`. Read old transactions through the archival
node first:

```ts
const archival = readOnlyRpc(withFallback(httpRpc(ENDPOINTS.testnet.archival), httpRpc(ENDPOINTS.testnet.nearArchival)));
const tx = await readTx(archival, hash, { senderLookup: fastnearSenderLookup(ENDPOINTS.testnet.txApi) });
```

or give `readTx` a first transport that does not retry, such as
`httpRpc(ENDPOINTS.testnet.rpc, { retries: 0, timeoutMs: 15_000 })`, with `archival` set.

## Edge cases

- Pinning `{height}` on a pruned regular node fails with the node's error: pass an archival RPC for
  historical blocks.
- A height that was skipped has no block: `blockAt({height})` passes on the node's `UNKNOWN_BLOCK` as
  an `RpcError`.
- `status` gives `chain_id` and `version.version`; the capture script records the version, which tells
  whether a recorded paging fixture is real 2.14 paging (it is: 2.14.1).
- An account with no code: `codeSha256` is null, and a `view` on it is a `ViewError` of kind no-code.

## Security notes

- **RPC trust.** The RPC is trusted for answers that cannot be proven without a light client.
  Pinning plus `strictBlock` stops a node from mixing blocks inside one decision, but cannot stop a
  node that lies consistently. For a high-value check, use your own node, or two providers.
- **API keys** travel only in `headers`. A URL with a query string or credentials is refused. Errors
  name only `redactUrl(url)`, the origin, and the method (`GET` for `httpGetJson`, not its path). A
  header value fetch would refuse is caught when the transport is built, so its value never reaches an
  error.
- **Archival nodes.** docs.near.org's provider list (https://docs.near.org/api/rpc/providers) marks
  FastNEAR's archival nodes as needing a key; on 2026-11-14 they answered the fixture capture's reads
  without one, and the final check's reads too: at 14:33:30 UTC, FastNEAR's and NEAR's archival nodes
  on both networks answered a `block` read by height with HTTP 200 and no key. `withFallback` sends a read FastNEAR's archival node fails to NEAR's own
  (`ENDPOINTS.*.nearArchival`). A key goes only in `headers: { Authorization: "Bearer <key>" }`.
- **Read-only.** `readOnlyRpc` refuses every method that could send a transaction before the node is
  called. The examples, the live tests and the capture script all read through it.

## Fixtures

Folder: `packages/satchel-nft/src/__fixtures__/primitives/near-rpc/`, captured on 2026-11-14 by
`node scripts/capture-primitive-fixtures.mjs --only near-rpc` through `readOnlyRpc`, at node 2.14.1.
Each file's `provenance` names the node, the source of every id, the block, the node version and the
capture time.

| File | What it holds |
|---|---|
| `intents-keys-paged.json` | `intents.near`'s key list on mainnet at block 224506284 (`FKHr4t9u…`), through the archival node: the pages with `limit: 2`, the page after the last key, and one unpaged call. intents.near is a third-party account (`THIRD_PARTY.intents` in the capture script), chosen because it holds enough keys for several real pages |
| `views-mainnet.json` | 14 reads at mainnet block 224506291 (`BJazr2s6…`): `view_account` of `v1.satchel-nft.near` and of `missing.v1.satchel-nft.near` (`UNKNOWN_ACCOUNT`, naming that block); views that answer, panic or do not exist; a view on an account with no code and on a missing one; key lists and keys of `satchel-nft.near` and of the locked contract, and an all-zero key nobody holds; and `view_code` of `satchel-nft.near` (`NO_CONTRACT_CODE`, naming that block) |

The tests also read chain-signatures' `tx-EZLX.json` (the full `EXPERIMENTAL_tx_status` answer) for
`readTx` and `receiptsOf`, and the existing trimmed `src/__fixtures__/dao-vote-outcome.json`.

## Tests

`near-rpc.test.ts` (58 tests): the transport with a fake fetch, labelled as transport tests (retries,
timeouts, Retry-After, rate limiting, concurrency, URL and header refusals, `redactUrl`,
`httpGetJson` and `fastnearSenderLookup`, `withFallback`, `readOnlyRpc`); everything about answers on
the recorded fixtures through `replayRpc` (block pinning, the block rule for results and for errors,
labelled in-test changes of the recorded errors' blocks, views and their errors, keys, paging with its
guards, `readTx`, `receiptsOf`); and parity with near.ts and config.ts (the request body, the timeout
text, `viewErrorMessage`, the codecs, `isAccountId` and the endpoints). There is no near-rpc example:
the chain-signatures and account-proof examples read through it.

## Live tests

`src/near-rpc.live.test.ts` reads the real chains through the public endpoints and `readOnlyRpc`. It
is skipped unless one of the two variables is set:

```bash
SATCHEL_LIVE=1 npm test -w satchel-nft -- near-rpc.live            # final blocks, regular nodes
SATCHEL_LIVE_ARCHIVAL=1 npm test -w satchel-nft -- near-rpc.live   # historical blocks, archival nodes
```

In PowerShell: `$env:SATCHEL_LIVE='1'; npm test -w satchel-nft -- near-rpc.live`.

| Run (UTC) | Command | Result |
|---|---|---|
| 2026-11-14 11:29:04 | `SATCHEL_LIVE=1 npm test -w satchel-nft -- near-rpc.live` | 4 passed, 3 skipped |
| 2026-11-14 11:29:11 | `SATCHEL_LIVE_ARCHIVAL=1 npm test -w satchel-nft -- near-rpc.live` | 3 passed, 4 skipped |
| 2026-11-14 13:53:52 | `SATCHEL_LIVE=1 npm test -w satchel-nft -- near-rpc.live` | 5 passed, 3 skipped |
| 2026-11-14 13:55:50 | `SATCHEL_LIVE_ARCHIVAL=1 npm test -w satchel-nft -- near-rpc.live --reporter=verbose --silent=false` | 3 passed, 5 skipped |
| 2026-11-14 13:58:06 | `SATCHEL_LIVE=1 npm test -w satchel-nft -- near-rpc.live --reporter=verbose --silent=false` | 5 passed, 3 skipped |
| 2026-11-14 14:32:20 | `SATCHEL_LIVE=1 npm test -w satchel-nft -- near-rpc.live --reporter=verbose` | 5 passed, 3 skipped |
| 2026-11-14 14:33:50 | `SATCHEL_LIVE_ARCHIVAL=1 npm test -w satchel-nft -- near-rpc.live --reporter=verbose` | 3 passed, 5 skipped |
| 2026-11-14 14:36:01 | `SATCHEL_LIVE=1 SATCHEL_LIVE_ARCHIVAL=1 npm test -w satchel-nft -- near-rpc.live chain-signatures.live account-proof.live nep641.live --reporter=verbose` | 25 passed in 4 files, near-rpc's 8 among them |

The runs from 13:53 on include the test for errors read as answers, added that afternoon. The runs
from 14:32 on are the final check, on the code of commit `f7b0f4a` (Node 24.12.0, Windows 10), with
no API key set: no read was rate-limited and no test timed out.

What they check:

- final blocks:
  - `status` says `mainnet` and `testnet` at `ENDPOINTS.*.rpc`;
  - at one final mainnet block, `intents.near`'s keys paged with `limit: 2` are the set one unpaged
    call gives;
  - on both networks, Satchel's contract has the code hash `deployments/<network>.json` records, by
    `view_account` and by sha256 of `view_code`;
  - under `strictBlock`, `missing.<contract>` reads null, `codeSha256` of `satchel-nft.near` and of
    `satchel-nft.testnet` (accounts with no code) reads null, and the nodes' `UNKNOWN_ACCOUNT` and
    `NO_CONTRACT_CODE` errors name the pinned block (mainnet 224526997, testnet 277669682 in the
    14:32:20 run);
  - `blockAt` pins the same block by finality, hash and height.
- historical blocks:
  - `intents.near`'s pages at the recorded block match the fixture's keys and permissions;
  - testnet `EZLX…` read through the archival node matches its fixture receipt by receipt (ids,
    executors, blocks, status kinds, method names), with its sender from FastNEAR's transaction index;
  - with the regular node first (no retries), the regular node fails (`timeout: no answer in 15 s` in
    the 14:33:50 run) and `readTx`'s archival fallback gives the same transaction.

## Status

Implemented means unit tests on recorded real data with provenance and a live test that passed with
its date and command recorded here (near-rpc has no example of its own). Experimental means shipped
and unit-tested, but a path lacks recorded real data or depends on a shape that is undocumented or
changing. Planned means designed, not shipped.

| Function | Status | Why |
|---|---|---|
| `ENDPOINTS`, `READ_METHODS`, `READ_QUERY_TYPES`, `RpcError`, `ReadOnlyError`, `ReadTxError`, `ViewError` | Implemented | parity and unit tests; every live test and every example run of the final check read through `ENDPOINTS` and `readOnlyRpc` |
| `httpRpc`, `withFallback`, `readOnlyRpc`, `redactUrl` | Implemented | the transport tests (a fake fetch, labelled), and every live test and example reads through them: the 25 live tests and the examples of the final check, the archival ones through `withFallback`; the examples print `redactUrl`'s origins |
| `httpGetJson` | Experimental | fake-fetch unit tests only: it has no live test, no example and no caller in shipped code yet (its use is FastNEAR's REST API, for the Planned account audit). It shares its send and retry code with `fastnearSenderLookup`, which passed live |
| `blockAt`, `pinnedReader`: `view`, `account`, `accessKey`, `codeSha256`, and `strictBlock` on results and errors | Implemented | `views-mainnet.json`, and the live tests: 5 of 5 at final blocks and 3 of 3 archival in the final check |
| `accessKeys` on nearcore 2.14 | Implemented | `intents-keys-paged.json` (node 2.14.1), and the live paging and re-read |
| `accessKeys` on a node older than 2.14 (`paged: false`) | Experimental | no such node seen: every recorded node is 2.14.1 |
| `parsePermission` for full-access and function-call keys | Implemented | the recorded keys: intents.near's 9 function-call keys in `intents-keys-paged.json` and satchel-nft.near's full-access key in `views-mainnet.json`; the live archival re-read matched intents.near's |
| `parsePermission` for gas keys | Experimental | no real gas-key answer recorded |
| `readTx`, `receiptsOf`, `functionCalls`, `fastnearSenderLookup` | Implemented | `tx-EZLX.json`, the live EZLX re-read, the live fallback, and the nine recorded transactions chain-signatures' archival group re-read |
| `isAccountId`, `encodeArgs`, `decodeBase64` | Implemented | parity with config.ts and near.ts on every fixture's ids and args; `encodeArgs` runs in every live view call |
| near.ts's helpers re-exported from near-rpc, and Satchel's own reads delegated to it | Planned | designed only |
