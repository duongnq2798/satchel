# satchel-nft/near-rpc

A plain JSON-RPC transport for any NEAR node, and reads pinned to one block. It retries the failures
worth retrying and names rate limiting as such, refuses an answer about another block than the pinned
one, pages access-key lists without dropping pages, reads a transaction with all its receipts (with an
archival fallback), and `readOnlyRpc` lets only read methods through. Source:
[packages/satchel-nft/src/near-rpc.ts](../../packages/satchel-nft/src/near-rpc.ts).

```ts
import { ENDPOINTS, httpRpc, pinnedReader, readOnlyRpc } from "satchel-nft/near-rpc";

const rpc = readOnlyRpc(httpRpc(ENDPOINTS.mainnet.rpc));
const reader = await pinnedReader(rpc); // one final block; every read below is at its hash
const { keys, pages } = await reader.accessKeys("intents.near", { pageSize: 2 });
```

## Paging access keys on nearcore 2.14

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

So `accessKeys` never stops on a short page (a clamped node sends short pages with more after them),
stops when `last_key` is absent, and also stops on an empty page, for a node that always sends
`last_key`. A node older than 2.14 that refuses the paging fields gets one unpaged call
(`paged: false`); that path is Experimental until such a node is seen.

The same `views.rs` writes gas keys as `GasKeyFunctionCall { balance, num_nonces, allowance,
receiver_id, method_names }` and `GasKeyFullAccess { balance, num_nonces }`. No real gas-key answer is
recorded yet, so their parsing is Experimental.

## A regular node and a transaction it has dropped

Regular nodes keep a transaction for a day or two. On 2026-11-14, `rpc.testnet.fastnear.com` answered
`EXPERIMENTAL_tx_status` for testnet `EZLXcvf43jqHYFUJm7gt3Ris5yM1Ru2FPihiEqJW1GUo` (included at block
276856696) with HTTP 408, `TIMEOUT_ERROR` / `NOT_OBSERVED`, after waiting 10 to 30 s. `httpRpc`
retries a 408 and its own timeout (10 s by default, 5 tries), so with the defaults that first read can
take a minute or more before `readTx` tries `archival`. Read old transactions through the archival
node first:

```ts
const archival = readOnlyRpc(withFallback(httpRpc(ENDPOINTS.testnet.archival), httpRpc(ENDPOINTS.testnet.nearArchival)));
const tx = await readTx(archival, hash, { senderLookup: fastnearSenderLookup(ENDPOINTS.testnet.txApi) });
```

or give `readTx` a first transport that does not retry, such as
`httpRpc(ENDPOINTS.testnet.rpc, { retries: 0, timeoutMs: 15_000 })`, with `archival` set.

docs.near.org's provider list marks FastNEAR's archival nodes as needing a key; on 2026-11-14 they
answered the fixture capture's reads without one. `withFallback` sends a read FastNEAR's archival node fails to NEAR's
own (`ENDPOINTS.*.nearArchival`). A key goes only in `headers: { Authorization: "Bearer <key>" }`:
`httpRpc` refuses a URL with a query string or credentials.

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

What they check:

- final blocks: `status` says `mainnet` and `testnet` at `ENDPOINTS.*.rpc`; at one final mainnet
  block, `intents.near`'s keys paged with `limit: 2` are the set one unpaged call gives; on both
  networks, Satchel's contract has the code hash `deployments/<network>.json` records, by
  `view_account` and by sha256 of `view_code`; `blockAt` pins the same block by finality, hash and
  height.
- historical blocks: `intents.near`'s pages at the recorded block match the fixture's keys and
  permissions; testnet `EZLX…` read through the archival node matches its fixture receipt by receipt
  (ids, executors, blocks, status kinds, method names), with its sender from FastNEAR's transaction
  index; and with the regular node first (no retries), the regular node fails and `readTx`'s archival
  fallback gives the same transaction.
