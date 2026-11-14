# satchel-nft/chain-signatures

For any NEAR transaction, this answers four questions about NEAR Chain Signatures:

1. Which `sign` requests did the transaction make on the MPC contract (`v1.signer` on mainnet,
   `v1.signer-prod.testnet` on testnet)?
2. What did the MPC network answer for each one?
3. Is each answer a valid signature by the key derived for that caller, path and domain?
4. For EVM: is a given transaction on another chain exactly the one that answer signed?

It is for a bridge or an indexer that ties a foreign transaction to its NEAR request, a wallet that
shows "this NEAR transaction moved your ETH", an auditor of an MPC-controlled treasury, or a contract
developer debugging a request that failed or timed out. It only reads. Source:
[packages/satchel-nft/src/chain-signatures.ts](../../packages/satchel-nft/src/chain-signatures.ts)
and [mpc-kdf.ts](../../packages/satchel-nft/src/mpc-kdf.ts).

```ts
import { ENDPOINTS, fastnearSenderLookup, httpRpc, readOnlyRpc, withFallback } from "satchel-nft/near-rpc";
import { MPC_CONTRACTS, MPC_ROOT_KEYS, auditSignTx, proveEvmTx, readOnlyEvmClient } from "satchel-nft/chain-signatures";
import { base } from "viem/chains";

const { archival, nearArchival, txApi } = ENDPOINTS.mainnet;
const rpc = readOnlyRpc(withFallback(httpRpc(archival), httpRpc(nearArchival)));
const audit = await auditSignTx(rpc, "2xqwe8AAWwvssHNCMUioME2SCJeYAKcneV8iVCpa1Cj4", {
  mpcContract: MPC_CONTRACTS.mainnet, rootKeys: MPC_ROOT_KEYS.mainnet, senderLookup: fastnearSenderLookup(txApi) });
const proof = await proveEvmTx({ audit, client: readOnlyEvmClient(base, "https://base-rpc.publicnode.com"),
  hash: "0x8044dd8cd53ea5aa7165b031098450d64a6c6910fc0cc9c3e138a480e6ac9532", expectedChainId: 8453 });
console.log(audit.verdict, proof.verdict); // all-verified proven
```

## What exists already

These are libraries, not hackathon entries. Versions were read with `npm view` and the crates.io API
on 2026-11-14.

- **chainsig.js 1.1.16** and **near-ca 0.12.1** (npm) derive MPC addresses and build and sign
  requests. This module audits finished transactions receipt by receipt and proves an EVM
  transaction against its NEAR request. Its key derivation (`deriveKey`) supports that audit and is
  not offered as a primitive of its own.
- **near-mpc-signature-verifier 0.0.1** and **near-mpc-sdk 0.0.1** (crates.io, repository near/mpc)
  verify MPC signatures in Rust and give a Rust SDK. This module verifies in TypeScript inside the
  audit, with stricter key checks: it refuses identity and small-order keys on both curves (see
  [Security notes](#security-notes)). The kdf test vectors it checks against are near/mpc's own,
  copied as data with their URL and commit (`upstream-tweaks.json`).

## Signing domains

The MPC contract's `sign` takes a `domain_id`. Each domain has its own root key, and the purpose of
the domain decides whether `sign` takes it. Both contracts list the same eight domains. Read with
`state()` by the live test in the final check on 2026-11-14 at 14:32:39 UTC (only the domain list is
printed, not the participants): `v1.signer` at block 224527028
(`53bMjayAu6UMKphgT1221EDQaQXgfn1vsp8J1Qt4yGJd`) and `v1.signer-prod.testnet` at block 277669714
(`mATytD8vu9MEkXVrcoiCvUcAu6KLSLs6iSRLwnxTQr8`).

| id | protocol | purpose | What this module does with it |
|---|---|---|---|
| 0 | CaitSith | Sign | secp256k1 ECDSA: derives, verifies, gives the EVM address |
| 1 | Frost | Sign | ed25519 EdDSA: derives, verifies |
| 2 | ConfidentialKeyDerivation | CKD | not a signing domain: followed, never verified |
| 3 | CaitSith | ForeignTx | not a signing domain: followed, never verified |
| 4 | CaitSith | Sign | secp256k1 ECDSA, with its own root key: derives, verifies |
| 5 | Frost | Sign | ed25519 EdDSA, with its own root key: derives, verifies |
| 6 | ConfidentialKeyDerivation | CKD | as 2 |
| 7 | CaitSith | ForeignTx | as 3 |

Every domain has `reconstruction_threshold` 11 on both networks. `MPC_SIGN_DOMAINS`
(`{0: "secp256k1", 1: "ed25519", 4: "secp256k1", 5: "ed25519"}`) pins the four signing domains, and
`MPC_ROOT_KEYS` holds each one's `public_key({domain_id})`, with the block it was read at in a comment
beside it. The live test checks both against the chain on every run.

How a request names its domain, by near/mpc main at `686fbb2de1a6b426303c23617ab84773f15bfb19`
(committed 2026-11-13):

- `crates/contract/src/api/sign.rs`, `sign()`: it calls `check_request_preconditions(request.domain_id,
  DomainPurpose::Sign, …)`, so it takes any domain whose purpose is Sign.
- `crates/near-mpc-crypto-types/src/sign.rs`: the arguments' domain is `domain_id`, or the legacy
  `key_version`, read as `(None, Some(kv)) => DomainId(kv.into())`. So `key_version` n is domain n.

`mpcRequests` reads them the same way. A `domain_id` or `key_version` that is any non-negative integer
is kept as the request's `domain`, and the request is followed like any other. For a domain in
`MPC_SIGN_DOMAINS` the payload's kind must fit the curve (an `Eddsa` payload on domain 0 is
`inconsistent`). For a domain this module does not know as a signing domain there is no fit check: the
contract itself refuses a misfit, which shows as `failed`. Such a request is never verified, whatever
root keys are passed, so its audit reads `some-unverified`, not `all-verified`.

The legacy form is in use. In the 200 newest transactions of each MPC contract in FastNEAR's
transaction index, read on 2026-11-14 at 14:07Z, `v1.signer` had 85 legacy requests
(`key_version: 0` with a 32-byte `payload`), 15 on `domain_id` 1 and 3 on `domain_id` 0;
`v1.signer-prod.testnet` had 55 on `domain_id` 0 and 41 on `domain_id` 1, none legacy. One of the
mainnet legacy requests, in transaction `FgZVNRSeVg8tJNp3farGUM36QoenCmHQyjiAt4zmRx9P`, was audited
with the example on 2026-11-14 at 14:08:00Z and again in the final check at 14:39:02Z:

```
node packages/satchel-nft/examples/mpc-audit.mjs mainnet FgZVNRSeVg8tJNp3farGUM36QoenCmHQyjiAt4zmRx9P
```

It printed one request in the legacy form, on domain 0 (secp256k1 ECDSA), with the path "bridge-1",
status signed and verify ok, and the verdict all-verified. Its signer and its caller are third-party
accounts that this page does not name, so the output is not quoted; the command above prints it.

No legacy transaction is recorded as a fixture yet, so the legacy form stays Experimental (see
[Status](#status)); recording one, with a unit and a live test, would move it.

## API

From `satchel-nft/chain-signatures` (the key derivation lives in mpc-kdf.ts and is re-exported here):

```ts
// The derivation
export type MpcDomain = number;                       // a domain id, as the contract's u64 domain_id
export type MpcCurve = "secp256k1" | "ed25519";
export const MPC_SIGN_DOMAINS: Readonly<Record<number, MpcCurve>>;   // {0: secp256k1, 1: ed25519, 4: secp256k1, 5: ed25519}
export function signDomainCurve(domain: number): MpcCurve | null;    // null: not a signing domain known here
export const TWEAK_PREFIX = "near-mpc-recovery v0.1.0 epsilon derivation:";
export function deriveTweak(predecessor: string, path: string): Uint8Array;   // sha3_256(prefix + predecessor + "," + path)
export function deriveKey(rootKey: string, predecessor: string, path: string, domain?: MpcDomain): string;

// Contracts, root keys, addresses
export const MPC_CONTRACTS: { mainnet: "v1.signer"; testnet: "v1.signer-prod.testnet" };
export const MPC_ROOT_KEYS: { mainnet: { 0; 1; 4; 5 }; testnet: { 0; 1; 4; 5 } };   // `secp256k1:…` / `ed25519:…`
export function evmAddress(secp256k1Key: string): `0x${string}`;

// Requests and answers
export type MpcResponse =
  | { scheme?: "Secp256k1"; big_r: { affine_point: string }; s: { scalar: string }; recovery_id: number }
  | { scheme: "Ed25519"; signature: number[] };
export interface MpcSignRequest {
  receiptId: string; blockHash: string | null; signerId: string; predecessor: string; path: string;
  domain: MpcDomain | null;                         // null only when the request names no readable domain
  payload: { kind: "ecdsa" | "eddsa"; hex: string }; form: "payload_v2" | "legacy"; deposit: string;
}
export interface MpcSignOutcome {
  request: MpcSignRequest;
  status: "signed" | "failed" | "timed-out" | "pending" | "inconsistent";
  response: MpcResponse | null;
  hops: string[];                                   // receipt ids followed, the sign receipt first
  callback: { receiptId: string; blockHash: string | null; tweak: number[]; payload: unknown; domainId: number } | null;
  detail: string | null;                            // the failure text, or what was inconsistent
}
export function mpcRequests(tx: TxStatusView, mpcContract: string, options?: { maxHops?: number }): MpcSignOutcome[];
export function scanMpcResponses(tx: TxStatusView, mpcContract: string): MpcResponse[];

// Verification
export type VerifyReason = "ok" | "scheme-mismatch" | "malformed-response" | "malformed-key" | "identity-key"
  | "small-order-key" | "malformed-big-r" | "r-out-of-range" | "s-out-of-range" | "bad-recovery-id"
  | "payload-not-32-bytes" | "payload-not-scalar" | "malformed-signature" | "invalid-signature" | "recovery-mismatch";
export interface VerifyResult { ok: boolean; reason: VerifyReason; evm?: { r: `0x${string}`; s: `0x${string}`; yParity: 0 | 1; highS: boolean } }
export function verifySignature(input: { key: string; payload: Uint8Array; response: MpcResponse }): VerifyResult;
export function normalizeEcdsa(sHex: string, recoveryId: number): { s: bigint; yParity: 0 | 1; highS: boolean };
export function crossCheckDerivation(rpc: RpcCall, mpcContract: string,
  cases: { predecessor: string; path: string; domain: MpcDomain }[], at?: At): Promise<{
    block: PinnedBlock; rootKeys: Partial<Record<MpcDomain, string>>;
    results: { predecessor: string; path: string; domain: MpcDomain; local: string; contract: string; match: boolean }[] }>;

// Auditing a transaction
export type SignTxVerdict = "no-requests" | "all-verified" | "has-inconsistent" | "has-failed" | "has-pending" | "some-unverified";
export interface SignTxAudit {
  tx: string; signerId: string; block: string;      // block: the transaction's inclusion block hash
  requests: (MpcSignOutcome & { derivedKey: string | null; verify: VerifyResult | null; evmAddress: `0x${string}` | null })[];
  orphanResponses: number;                          // MPC answers in the transaction that no request reaches
  verdict: SignTxVerdict;
}
export function auditSignTx(rpc: RpcCall, hash: string, options: ReadTxOptions & {
  mpcContract: string; rootKeys: Partial<Record<MpcDomain, string>>; maxHops?: number }): Promise<SignTxAudit>;

// EVM: a read-only client, and the proof
export { ReadOnlyError } from "satchel-nft/near-rpc";   // the same class
export const EVM_READ_METHODS: readonly ["eth_chainId", "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getBlockByNumber"];
export function evmJsonRpc(url: string, options?: { timeoutMs?: number; fetch?: typeof fetch }): Eip1193Request;
export function readOnlyEvm(request: Eip1193Request): Eip1193Request;
export function readOnlyEvmClient(chain: Chain, url: string, options?: { retryCount?: number; timeoutMs?: number; fetch?: typeof fetch }): PublicClient;
export type EvmCheckId = "node-chain-id" | "tx-chain-id" | "tx-type" | "tx-hash" | "signing-hash" | "r" | "s"
  | "y-parity" | "sender" | "receipt" | "finalized";
export interface EvmProof {
  verdict: "proven" | "not-proven";
  checks: { id: EvmCheckId; ok: boolean; detail: string }[];
  evm: { chainId: number; hash: `0x${string}`; from: `0x${string}` | null; nonce: number; blockNumber: string | null;
         status: "success" | "reverted" | null };   // JSON-safe: no bigint
  near: { tx: string; receiptId: string; predecessor: string; path: string };
}
export function proveEvmTx(input: { audit: SignTxAudit; requestIndex?: number; client: PublicClient;
  hash: `0x${string}`; expectedChainId: number }): Promise<EvmProof>;
export function proveRawTx(input: { audit: SignTxAudit; requestIndex?: number; raw: `0x${string}`; expectedChainId: number }): EvmProof;
```

## Behaviour

| Function | What it does | What it throws |
|---|---|---|
| `deriveTweak` | sha3-256 of `TWEAK_PREFIX`, the predecessor, a comma and the path. Account ids cannot hold a comma, so the pair is unambiguous | nothing |
| `deriveKey` | secp256k1 (domains 0 and 4): the root plus t·G, t the tweak read big-endian, as `secp256k1:<base58 of the 64-byte point>`. ed25519 (domains 1 and 5): the root plus t·B, t read little-endian mod l, as `ed25519:<base58 32 bytes>`. Without `domain`, the root key's prefix picks the curve; with it, the domain's curve must be the root key's | `not a secp256k1 key: …`, `expected a 64-byte key, got N` (evm.ts's texts), `not an ed25519 key: …`, `the root key is not a valid ed25519 point`, `the tweak for <path> is not a valid scalar`, and `unknown MPC signing domain N: the signing domains are 0, 1, 4, 5` for a domain that is not a signing domain |
| `mpcRequests` | Every receipt on the MPC contract with a FunctionCall `sign` is a request. The payload comes from `payload_v2` (`{Ecdsa: hex}` or `{Eddsa: hex}`) or the legacy `payload` (32 numbers, ECDSA); the domain from `domain_id` or the legacy `key_version`, each read on its own. The sign receipt's outcome is followed hop by hop, each hop on the MPC contract (at most `maxHops`, default 8), to the receipt holding `return_signature_and_clean_state_on_success`. That callback's one-element argument array must carry the request's tweak (byte for byte against `deriveTweak`), payload (same variant, hex compared case-insensitively) and `domain_id`. Its `SuccessValue` is the answer, parsed by the payload's kind | nothing: everything is a status |
| | `signed`: the callback answered. `failed`: the sign receipt or the callback failed, with the failure text in `detail`. `timed-out`: the callback handed on to `fail_on_timeout`, which failed. `pending`: an outcome is missing or unknown. `inconsistent`: a hop left the MPC contract, the callback does not match the request (the field is named), the answer is not a signature of the payload's kind, the sign receipt returned a value with no callback, the request names no readable domain, or its payload does not fit a known signing domain | |
| `scanMpcResponses` | The loop of dao.ts's `signatureFromReceipts`: every receipt the MPC contract ran whose `SuccessValue` parses as a secp256k1 answer, with or without `scheme` | nothing |
| `verifySignature` | secp256k1: the key decodes and is not the identity; `big_r` is `02`/`03` plus 32 bytes on the curve with 1 ≤ x(R) < n (refused, not reduced); s in [1, n-1]; `recovery_id` 0 or 1; the payload 32 bytes and below n; s normalized to low-s, flipping the parity; verified with `prehash: false`, and the key recovered from (r, s, yParity) must be the key. ed25519: 64 numbers each 0-255; the key decodes and has no small order; strict RFC 8032 (`zip215: false`) over the payload bytes | never: each failure is a `reason` |
| `normalizeEcdsa` | s and yParity with s flipped to n - s (and the parity flipped) when s > n/2, as evm.ts's `toEvmSignature` does | on a malformed s |
| `crossCheckDerivation` | At one pinned block, the contract's `public_key({domain_id})` for each domain the cases use (in numeric order) and its `derived_public_key({path, predecessor, domain_id})` for each case, beside `deriveKey` from that block's root key. A `match: false` means the contract and this code derive differently, whether or not `MPC_ROOT_KEYS` is still current | `RpcError` and `ViewError` from the reads |
| `auditSignTx` | `readTx` (FINAL by default), then `mpcRequests`. A request on a signing domain whose root key the caller passed gets `derivedKey`, `verify` and, for secp256k1, `evmAddress`. No root key is fetched to verify against; a request on any other domain gets `verify: null`. The verdict is the first that applies: `no-requests`, `has-inconsistent`, `has-failed` (failed or timed out), `has-pending`, `some-unverified` (a signed request whose `verify` is null or not ok), `all-verified` | `RpcError`, `ReadTxError` |
| `proveEvmTx` | Reads the transaction, its receipt and the node's `finalized` block through `client`, and reports every check, none skipping another: node-chain-id, tx-chain-id, tx-type (type 2 Implemented; types 0 and 1 accepted, Experimental; 3 and 4 refused), tx-hash (rebuilt with viem `serializeTransaction` plus the signature, keccak equal to `hash`), signing-hash (keccak of the unsigned serialization equals the request's payload), r, s, y-parity, sender (`evmAddress(derivedKey)` and the node's `from`), receipt (success), finalized (the block at or below `finalized`). `proven` only when all pass | viem's errors for a read the node fails |
| `proveRawTx` | Offline, for a raw signed transaction: tx-chain-id, tx-type, signing-hash, r, s, y-parity and sender. tx-hash is computed, not checked. It never broadcasts, and has no receipt or finality check | nothing |
| `evmJsonRpc` | A plain JSON-RPC POST, as an EIP-1193 `request` function. Errors name only the node's origin | a TypeError at once for a URL that does not parse or carries credentials (`user:pass@`), with no part of the URL in it; viem's `HttpRequestError` for HTTP failures and for a network error, labelled by the error's name and code only; `TimeoutError` after `timeoutMs` (default 15 000) |
| `readOnlyEvm` | Lets through only `EVM_READ_METHODS` | `ReadOnlyError` with EIP-1193 code 4200 before `request` is called, for anything else: `eth_sendRawTransaction`, `eth_sendTransaction`, every signing method, and reads outside the list |
| `readOnlyEvmClient` | `createPublicClient` with `custom({ request: readOnlyEvm(evmJsonRpc(url)) }, { retryCount: 3 })`: the guard sits on the only path to the network | a refused method rejects with viem's `UnsupportedProviderMethodError`, whose `cause` is the `ReadOnlyError`, at once and without a retry |

viem wraps whatever an EIP-1193 `request` throws, so `readOnlyEvmClient` never rejects with a
`ReadOnlyError` at the top level. To tell a refusal from a node failure, walk the cause chain:

```ts
import { ReadOnlyError, readOnlyEvmClient } from "satchel-nft/chain-signatures";

const refused = (err: unknown): boolean =>
  err instanceof ReadOnlyError || (err instanceof Error && err.cause !== undefined && refused(err.cause));
const client = readOnlyEvmClient(sepolia, url);
await client.sendRawTransaction({ serializedTransaction: raw }).catch(refused); // true, and no fetch happens
```

The code 4200 is what makes viem treat the refusal as an unsupported method: a refused read is tried
once, where an error without a code was retried `retryCount` times.

NEAR reads use `wait_until: "FINAL"`; the EVM proof needs the `finalized` tag, which Base and Sepolia
serve. NEAR retries come from `httpRpc`, EVM retries from viem's `retryCount`.

## Edge cases

Each has a unit test in `chain-signatures.test.ts` (62 tests) or `mpc-kdf.test.ts` (16).

- A direct `sign_evm` (testnet EZLX…): one hop from the sign receipt to the callback.
- A DAO vote that calls Satchel's contract, which calls the MPC contract (testnet 2ryQps…): several
  receipts, the predecessor is Satchel's contract. The trimmed `dao-vote-outcome.json`, with no block
  hashes, gives the same request.
- An ed25519 request and a secp256k1 request with an empty path (tx-bench.testnet's FgbW… and 9FsA…).
- A refused `sign_evm` that never reaches the MPC contract (testnet GqFsnm…, mainnet 33UTwy…):
  `no-requests`.
- A failed sign receipt, and a request whose callback has not run (`pending`): labelled in-test
  changes of EZLX…'s outcome, since no recorded transaction has either. Experimental.
- A timed-out request: HthQSVE… turned out to be a second signed ed25519 request, so the timeout
  chain (callback, then `fail_on_timeout`, which fails) is an in-test change to FgbW…'s outcome,
  labelled. Experimental.
- Two requests in one transaction: both come back in receipt order, where `signatureFromReceipts`
  keeps its "holds N MPC signatures" refusal.
- A callback whose tweak, payload or domain differs from the request: `inconsistent`, naming the field.
- A hop that leaves the MPC contract, an answer that is not a signature, a value with no callback.
- A request on domain 4 or 5 (in-test changes of recorded requests and answers): followed, parsed by
  the payload's kind, verified under that domain's own root key, no orphan.
- A request on a domain id this module does not know (2, 9): followed with no fit check, never
  verified; a misfit the contract refused shows as `failed`.
- A legacy request (in-test, labelled): `key_version` 0 is domain 0 and signed; 1 and 5 are ed25519
  domains, which a legacy (ECDSA) payload does not fit, so `inconsistent`; 4 is domain 4; a
  `key_version` that is not a non-negative integer (-1, 1.5) is `inconsistent`.
- A payload that does not fit its signing domain: `inconsistent`.
- A high-s answer (normalized, `highS: true`), an x(R) at or above n, `recovery_id` 2, identity and
  small-order keys on both curves: each its own `reason`.
- A pre-EIP-155 legacy EVM transaction (in-test): tx-chain-id fails. Experimental.
- A blob (type 3) transaction: tx-type fails.
- A field that differs from what was hashed, a block above `finalized`, another chain, another NEAR
  request's answer: each not proven, with every other check still reported.

## Security notes

- **Trust anchor.** The root keys are constants, each with the block it was read at. No function
  fetches a root key to verify against. `crossCheckDerivation` is how you notice a change; it is never
  a silent refresh.
- **Pairing.** Requests and answers are paired by receipt ids, executor checks and the callback's
  arguments. Never by log text (the MPC contract's sign log is a Rust Debug string, not NEP-297), and
  never by "any MPC answer in the transaction". An answer no request reaches is counted in
  `orphanResponses`.
- **Payload binding.** The payload is checked three times: in the request, in the callback, and as the
  EVM signing hash. A signature is "for" a transaction only when all three match.
- **Low-s.** EVM nodes require low-s (EIP-2), so the normalization flips the parity. Without it, a
  correct MPC answer would give the wrong sender.
- **Strict keys.** near/mpc#4608 (https://github.com/near/mpc/issues/4608, open on 2026-11-14) reports
  that the upstream threshold_signatures ECDSA `Signature::verify` accepts the identity point as the
  public key. `verifySignature` refuses identity and small-order keys on both curves, and ed25519 is
  strict RFC 8032.
- **Read-only.** Nothing here can broadcast. `readOnlyEvm` refuses `eth_sendRawTransaction` before any
  fetch; a unit test shows it with the real, never-broadcast Sepolia raw transaction in
  `deployments/testnet-e2e.json` `steps[2].raw`, and that no fetch happens.
- **Secrets in EVM URLs.** EVM node URLs often carry a key in their path. `evmJsonRpc` refuses a URL
  with credentials when it is built, never repeats the URL in an error (only its origin), and labels
  a network error by its name and code alone, since fetch's own messages can quote the URL. A unit
  test checks that secrets in the user info, the path and the query reach no message, detail or
  cause.
- **RPC trust.** NEAR receipts are trusted from the RPC, as [near-rpc](near-rpc.md#security-notes) says.
  Pinning stops a node from mixing blocks inside one decision; it cannot stop a node that lies
  consistently. For a high-value check, use your own node or two providers.

## Fixtures

Folder: `packages/satchel-nft/src/__fixtures__/primitives/chain-signatures/`. Each file's
`provenance` names the network, the node, the JSON path its id was read from, the block, the node
version and the capture time; `modified` is false for every one. They were captured on 2026-11-14 by
`node scripts/capture-primitive-fixtures.mjs --only chain-signatures`, which reads through
`readOnlyRpc` and `readOnlyEvm`. tx-bench.testnet is a third-party account, found through FastNEAR's
transaction index of `v1.signer-prod.testnet`; its transactions are public traffic, allowed here and in
fixtures, never in the README.

| File | What it holds | Source |
|---|---|---|
| `tx-EZLX.json` | testnet EZLXcvf…, the owner's direct `sign_evm` for satchel #1, at block 276856696 | `deployments/testnet-e2e.json` `steps[1].tx` |
| `tx-2ryQps.json` | testnet 2ryQpsJ…, the DAO vote that had satchel #8 sign, at block 277029162 | `deployments/testnet-dao.json` `steps[5].tx` |
| `tx-GqFsnm.json` | testnet GqFsnmF…, the previous owner's refused `sign_evm`, at block 276856720 | `deployments/testnet-e2e.json` `steps[4].tx` |
| `tx-2xqwe8.json` | mainnet 2xqwe8A…, satchel #1's `sign_evm` for its Base send, at block 223765205 | `deployments/mainnet-first-send.json` `nearTx` |
| `tx-FnFSMSh1.json` | mainnet FnFSMSh…, satchel #2's `sign_evm` for its 1Click deposit, at block 224001173 | `deployments/mainnet-1click-exit.json` `deposit.nearTx` |
| `tx-33UTwy.json` | mainnet 33UTwyV…, the seller's refused `sign_evm` after the sale, at block 224293735 | `deployments/mainnet-sale.json` `refused.tx` |
| `tx-FgbW.json`, `tx-HthQSVE.json`, `tx-9FsA.json` | tx-bench.testnet's ed25519 requests FgbWCHb… (block 277610643) and HthQSVE… (277610675), and its secp256k1 request 9FsAULu… (277610488), each with the path "" | the capture script's `THIRD_PARTY.txBench` |
| `evm-sepolia-27e3.json` | Sepolia 0x27e3…5ba3 (block 12102812): `eth_chainId`, the transaction, its receipt and the finalized block, from `sepolia.gateway.tenderly.co` | `deployments/testnet-dao.json` `steps[7].sepolia.tx`; node from `THIRD_PARTY.sepoliaReceipts` |
| `evm-base-8044.json`, `evm-base-2d9b.json` | Base 0x8044…9532 (block 55178996) and 0x2d9b…7d74 (block 55860595), the same four reads, from `base-rpc.publicnode.com` | `mainnet-first-send.json` `baseTx`, `mainnet-1click-exit.json` `deposit.tx`; node from `chainInfo(8453).rpc` |
| `derived-keys-domains-testnet.json`, `derived-keys-domains-mainnet.json` | `public_key` for domains 0 and 1 and `derived_public_key` for satchels #1-#11 (testnet) and #1-#3 (mainnet) and tx-bench.testnet's "" in both domains, at blocks 277652699 and 224509629 | `deployments/<network>.json` |
| `derived-keys-domains-4-5-testnet.json`, `derived-keys-domains-4-5-mainnet.json` | `public_key` for domains 4 and 5 and `derived_public_key` for satchel #1 in both, and tx-bench.testnet's "" on testnet, at blocks 277663870 and 224521129. `state()` is not recorded: it also lists the MPC participants | `deployments/<network>.json` |
| `upstream-tweaks.json` | near/mpc's `derive_tweak__has_not_changed` snapshot, copied as data | near/mpc at `686fbb2de1a6b426303c23617ab84773f15bfb19`, `crates/near-mpc-crypto-types/src/snapshots/…derive_tweak__has_not_changed.snap` |

The unit tests also read the existing `src/__fixtures__/derived-keys.json`, `sign-evm-outcome.json`
and `dao-vote-outcome.json` unchanged. Every in-test change to recorded data is a deep copy, labelled in
the test; no fixture file is edited.

## Live tests

`src/chain-signatures.live.test.ts` reads the real chains through the public endpoints, `readOnlyRpc`
for NEAR and `readOnlyEvmClient` for EVM. It is skipped unless one of the two variables is set:

```bash
SATCHEL_LIVE=1 npm test -w satchel-nft -- chain-signatures.live            # final blocks, regular nodes
SATCHEL_LIVE_ARCHIVAL=1 npm test -w satchel-nft -- chain-signatures.live   # historical transactions, archival nodes
```

In PowerShell: `$env:SATCHEL_LIVE='1'; npm test -w satchel-nft -- chain-signatures.live`. Add
`--reporter=verbose --silent=false` to see the blocks each test read.

**The Sepolia node.** The archival group proves satchel #8's Sepolia send, 0x27e3…5ba3, which needs a
node that serves its receipt. `config.ts`'s Sepolia node, `ethereum-sepolia-rpc.publicnode.com`,
answers the transaction but a null receipt for it: seen on 2026-11-14 at 12:20Z, at 13:59:14Z, and in
the final check at 14:39:51Z (the example run below). `sepolia.gateway.tenderly.co` serves it, and is
the node the fixture was captured from. So the live tests' Sepolia node defaults to tenderly, where the
design had config.ts's node, and `SATCHEL_LIVE_SEPOLIA_RPC=<url>` replaces it. The assertion is
unchanged: the receipt check must pass.

| Run (UTC) | Command | Result |
|---|---|---|
| 2026-11-14 13:54:01 | `SATCHEL_LIVE=1 npm test -w satchel-nft -- chain-signatures.live` | 4 passed, 6 skipped |
| 2026-11-14 13:56:28 | `SATCHEL_LIVE_ARCHIVAL=1 npm test -w satchel-nft -- chain-signatures.live --reporter=verbose --silent=false` | 6 passed, 4 skipped |
| 2026-11-14 13:57:53 | `SATCHEL_LIVE=1 npm test -w satchel-nft -- chain-signatures.live --reporter=verbose --silent=false` | 4 passed, 6 skipped |
| 2026-11-14 14:32:39 | `SATCHEL_LIVE=1 npm test -w satchel-nft -- chain-signatures.live --reporter=verbose` | 4 passed, 6 skipped |
| 2026-11-14 14:34:40 | `SATCHEL_LIVE_ARCHIVAL=1 npm test -w satchel-nft -- chain-signatures.live --reporter=verbose` | 6 passed, 4 skipped |
| 2026-11-14 14:36:01 | `SATCHEL_LIVE=1 SATCHEL_LIVE_ARCHIVAL=1 npm test -w satchel-nft -- near-rpc.live chain-signatures.live account-proof.live nep641.live --reporter=verbose` | 25 passed in 4 files, chain-signatures' 10 among them |

The runs from 14:32 on are the final check, on the code of commit `f7b0f4a` (Node 24.12.0, Windows
10), with no API key set: no read was rate-limited and no test timed out.

What they check, with the blocks the final check's 14:32:39 run read:

- final blocks:
  - `public_key` for domains 0, 1, 4 and 5 on both contracts equals `MPC_ROOT_KEYS` (mainnet block
    224527024, testnet 277669711);
  - each contract's `state()` lists exactly the signing domains `MPC_SIGN_DOMAINS` lists, each root
    key on its curve (mainnet 224527028, testnet 277669714; the table in
    [Signing domains](#signing-domains));
  - `crossCheckDerivation` on testnet for satchels #1-#8 (domain 0) and tx-bench.testnet's "" (domain
    1) matches the contract, satchel #1 equals `derived-keys.json`, and the tx-bench key is
    `ed25519:pJisEEQe9mw8Ew2faGNAHzu6wijjtUhjorKGReGTkpi` (277669715);
  - satchel #1 in domains 4 and 5 on both networks, and tx-bench.testnet's "" in 4 and 5 on testnet,
    match the contract (mainnet 224527037, testnet 277669724).
- historical transactions, through the archival nodes with a fallback to NEAR's own:
  - EZLX…: one signed domain-0 request by `v1.satchel-nft.testnet` for `satchel/1`, verified, EVM
    address `0x96DA1468E95Ab31A698891f0150095f86b5a282B`, and `proveRawTx` proves `steps[2].raw` for
    chain 11155111;
  - 2ryQps…: signer satchel-nft.testnet, sign receipt FWa3axK2…, verified, and `proveEvmTx` proves
    Sepolia 0x27e3…5ba3, nonce 0, block 12102812;
  - FgbW…: domain 1, tx-bench.testnet, path "", verified against `ed25519:pJisEE…`;
  - mainnet 2xqwe8… with Base 0x8044…9532 (from `0xdc26…68f9`, nonce 0, block 55178996), and
    FnFSMSh1… with Base 0x2d9b…7d74 (block 55860595): proven;
  - GqFsnm… and 33UTwy…: `no-requests`;
  - each recorded transaction re-read matches its fixture's projection: hash, signer, receipt ids,
    executors, receipt blocks, status kinds and method names.

## Examples

Both read only, through `readOnlyRpc(withFallback(httpRpc(archival), httpRpc(nearArchival)))` and
`readOnlyEvmClient`. Run `npm run build -w satchel-nft` first. They exit 0 whatever the verdict, and 1
only when a read fails, printing the error's kind.

The outputs below are from the final check on 2026-11-14, at the code of commit `f7b0f4a`.

`examples/mpc-audit.mjs` on testnet EZLX… (also its default), at 14:38:17Z:

```
$ node packages/satchel-nft/examples/mpc-audit.mjs testnet EZLXcvf43jqHYFUJm7gt3Ris5yM1Ru2FPihiEqJW1GUo
network        testnet, MPC contract v1.signer-prod.testnet
read from      https://archival-rpc.testnet.fastnear.com (fallback https://archival-rpc.testnet.near.org), FINAL
tx             EZLXcvf43jqHYFUJm7gt3Ris5yM1Ru2FPihiEqJW1GUo
signer         satchel-nft.testnet
block          DwxSFWD4zV7VbX35oWDXajhNyiSXnM56AjVBNE9mimdb
requests       1
request 0
  receipt      DPZUErJtm9JMBFX9aTccZvow5TZERKYYv2WqvXQySkCz
  predecessor  v1.satchel-nft.testnet
  path         "satchel/1"
  domain       0 (secp256k1 ECDSA)
  form         payload_v2
  payload      ecdsa db23d1f97d37db73f8043be1db8d96ec494e5711fc845fab444b8f91e0601154
  deposit      1 yoctoNEAR
  status       signed
  hops         DPZUErJtm9JMBFX9aTccZvow5TZERKYYv2WqvXQySkCz -> Ckp54UmUjQZ4MYnXnBNymMh84ghyF1o74kfVaHn22RcH
  callback     Ckp54UmUjQZ4MYnXnBNymMh84ghyF1o74kfVaHn22RcH
  derived key  secp256k1:uB6uEeQBAQdZZ4mTgDpaSSfyBXUWcNixrep15KX8UwSGa9iUkfywL1xQQog9MZ76YbKQWe5hiMbuDhXVJnuBykT
  verify       ok
  r, s, parity 0x3bfe67004fdf62d18335201b3dd21dbc587de22beb526876fc0c4950fda0c1e3, 0x4f94162cec29837b574fedef2af0825ab0a890c1c66667cd8940f38f98098cae, 1
  evm address  0x96DA1468E95Ab31A698891f0150095f86b5a282B
orphan answers 0
verdict        all-verified
```

`examples/prove-evm-tx.mjs` on mainnet 2xqwe8… and Base 0x8044…9532 (also its defaults), at
14:39:20Z. The EVM node is `chainInfo(8453).rpc` from the package root:

```
$ node packages/satchel-nft/examples/prove-evm-tx.mjs mainnet 2xqwe8AAWwvssHNCMUioME2SCJeYAKcneV8iVCpa1Cj4 8453 0x8044dd8cd53ea5aa7165b031098450d64a6c6910fc0cc9c3e138a480e6ac9532
near           mainnet 2xqwe8AAWwvssHNCMUioME2SCJeYAKcneV8iVCpa1Cj4, audit all-verified
request        HbiReFfuC2MpPjkntyhuNQX8c5RjW279v8gZq27XyFiv, predecessor v1.satchel-nft.near, path "satchel/1"
evm            chain 8453 (Base), tx 0x8044dd8cd53ea5aa7165b031098450d64a6c6910fc0cc9c3e138a480e6ac9532
evm node       https://base-rpc.publicnode.com
ok   node-chain-id the node serves chain 8453
ok   tx-chain-id   the transaction is signed for chain 8453
ok   tx-type       type 2 (EIP-1559)
ok   tx-hash       the node's fields and signature hash to it
ok   signing-hash  0x4e9284fce02f3684d4c49ec5a53470240661f2ba4c4c37df6f33089a6aeebda3 is the request's payload
ok   r             0x2af968283477c9f3a3d5c7803bdb6caf9871b59a18a8ecf058a7eff0e7c2aae7 as the MPC answer gives it
ok   s             0x64374e193e31ac7a5879eaf6869d7dfbc2eec2f031ce5852fc0254cfc9b66125 as the MPC answer gives it
ok   y-parity      0 as the MPC answer gives it
ok   sender        0xdC269Ead17B522d49db2ceFD38CEF0C5413868F9, the derived key's address and the node's from field
ok   receipt       the receipt says success
ok   finalized     block 55178996; the node has finalized up to 57378343
from           0xdC269Ead17B522d49db2ceFD38CEF0C5413868F9, nonce 0, block 55178996, status success
verdict        proven
```

The same example on testnet 2ryQps… and Sepolia 0x27e3…5ba3, with `sepolia.gateway.tenderly.co` as the
fifth argument, at 14:39:28Z:

```
$ node packages/satchel-nft/examples/prove-evm-tx.mjs testnet 2ryQpsJRq8zQwxCdHzJszi5dBBxjECF4Jt59J1NmPG4M 11155111 0x27e3262bb3208da84ab3332b018f9f88210b69ec4d85ed5b5299238a38945ba3 https://sepolia.gateway.tenderly.co
near           testnet 2ryQpsJRq8zQwxCdHzJszi5dBBxjECF4Jt59J1NmPG4M, audit all-verified
request        FWa3axK2KxKWq2tf1YpNNLNeb8QPf8dayhbBhZSJpDYv, predecessor v1.satchel-nft.testnet, path "satchel/8"
evm            chain 11155111 (Sepolia), tx 0x27e3262bb3208da84ab3332b018f9f88210b69ec4d85ed5b5299238a38945ba3
evm node       https://sepolia.gateway.tenderly.co
ok   node-chain-id the node serves chain 11155111
ok   tx-chain-id   the transaction is signed for chain 11155111
ok   tx-type       type 2 (EIP-1559)
ok   tx-hash       the node's fields and signature hash to it
ok   signing-hash  0x0b95701fc2a989725c9fdca6577b9c574f80a9630b1d697a31036c807d22b332 is the request's payload
ok   r             0x3e8f70542551f01aa6fcc13d20235d0947abb7926c57185ad7a56647e72f80a2 as the MPC answer gives it
ok   s             0x3ed34a39284c4cf937801c91bb2e91eafc8de9b443ed3d12cb05c2a652e242a7 as the MPC answer gives it
ok   y-parity      0 as the MPC answer gives it
ok   sender        0x2aA82C50d1E0C0e9872Fe45A6C1e1DA673bcA5F0, the derived key's address and the node's from field
ok   receipt       the receipt says success
ok   finalized     block 12102812; the node has finalized up to 12133685
from           0x2aA82C50d1E0C0e9872Fe45A6C1e1DA673bcA5F0, nonce 0, block 12102812, status success
verdict        proven
```

Without the fifth argument it reads `chainInfo(11155111).rpc`, publicnode, at 14:39:51Z: every check
passed but `FAIL receipt       no receipt: the node puts the transaction in block 12102812 but answers
no receipt for it`, the verdict was `not-proven`, the example exited 0, and its note said `this node
gave no receipt; pass https://sepolia.gateway.tenderly.co as the fifth argument`.

The examples on the other recorded transactions, in the same final check (14:38:38Z to 14:39:28Z),
each exiting 0:

| Command | The transaction | What it printed |
|---|---|---|
| `mpc-audit.mjs testnet 2ryQpsJRq8zQwxCdHzJszi5dBBxjECF4Jt59J1NmPG4M` | the DAO vote that had satchel #8 sign | signer satchel-nft.testnet; request FWa3axK2… by `v1.satchel-nft.testnet` for `"satchel/8"`, callback 5Y8LFFZm…, `verify ok`, EVM address `0x2aA82C50d1E0C0e9872Fe45A6C1e1DA673bcA5F0`; `all-verified` |
| `mpc-audit.mjs testnet GqFsnmFLcpDjJVC1b4qUPYxHRTP1Rw2vcVKxga3PVRvU` | the previous owner's refused `sign_evm` | `requests 0`; `no-requests` |
| `mpc-audit.mjs testnet FgbWCHbK6AAYAJ31tBNZHph3M7V3Ltt4aGrX7mvGtKWm` | tx-bench.testnet's ed25519 request | domain 1, path `""`, payload `eddsa 7e2b493e…dbd4829`, derived key `ed25519:pJisEEQe9mw8Ew2faGNAHzu6wijjtUhjorKGReGTkpi`, `verify ok`; `all-verified` |
| `mpc-audit.mjs mainnet 2xqwe8AAWwvssHNCMUioME2SCJeYAKcneV8iVCpa1Cj4` | satchel #1's `sign_evm` for its Base send | `v1.satchel-nft.near` for `"satchel/1"`, `verify ok`, EVM address `0xdC269Ead17B522d49db2ceFD38CEF0C5413868F9`; `all-verified` |
| `mpc-audit.mjs mainnet FnFSMSh1dpjkYC6fMT2aSgvFNYUjyuc6xVLGAymcupEA` | satchel #2's `sign_evm` for its 1Click deposit | `v1.satchel-nft.near` for `"satchel/2"`, `verify ok`, EVM address `0xf5383275EFedde8B90F59de8E8D15b1E23B4965f`; `all-verified` |
| `mpc-audit.mjs mainnet 33UTwyVyAf6CQY5a953rtdmAyF98WZKVwAnqAdY3Vk6X` | the seller's refused `sign_evm` after the sale | `requests 0`; `no-requests` |
| `prove-evm-tx.mjs mainnet FnFSMSh1dpjkYC6fMT2aSgvFNYUjyuc6xVLGAymcupEA 8453 0x2d9b1a1c1b25c4443390af46dd176af24b93ebbb9e59d602bec76d585b607d74` | that deposit on Base | 11 of 11 checks `ok`; from `0xf5383275EFedde8B90F59de8E8D15b1E23B4965f`, nonce 0, block 55860595, status success; `proven` |

## Status

Implemented means unit tests on recorded real data with provenance, a live test that passed with its
date and command recorded here, and an example's real output quoted. Experimental means shipped and
unit-tested, but a path lacks recorded real data or depends on a shape that is undocumented or
changing. Planned means designed, not shipped.

| Function | Status | Why |
|---|---|---|
| `MPC_CONTRACTS`, `MPC_ROOT_KEYS`, `MPC_SIGN_DOMAINS`, `signDomainCurve`, `TWEAK_PREFIX` | Implemented | the live tests of the final check: `public_key` for domains 0, 1, 4 and 5 equals `MPC_ROOT_KEYS` on both networks, and `state()` lists exactly the signing domains 0, 1, 4 and 5 |
| `deriveTweak`, `deriveKey` (domains 0, 1, 4, 5), `evmAddress` | Implemented | near/mpc's tweak vectors, recorded `derived_public_key` answers in all four domains, the live equality on 2026-11-14, and the EVM addresses of EZLX…, 2ryQps…, 2xqwe8… and FnFSMSh1… equal to the ones `deployments/` records |
| `mpcRequests`, `auditSignTx`, `scanMpcResponses`: `payload_v2` requests that were signed, and a `sign_evm` refused before it reached the MPC contract (`no-requests`) | Implemented | nine recorded transactions, the live archival audits (6 of 6 in the final check), and the mpc-audit example: `all-verified` on EZLX…, 2ryQps…, FgbW…, 2xqwe8… and FnFSMSh1…, `no-requests` on GqFsnm… and 33UTwy… |
| `verifySignature` (`payload-not-scalar` included), `normalizeEcdsa` | Implemented | every recorded secp256k1 and ed25519 answer verifies, plus labelled mutations for each reason; sign.rs refuses an ECDSA payload that is not a scalar |
| `crossCheckDerivation` | Implemented | the live tests in domains 0 and 1 on testnet, and 4 and 5 on both networks |
| `proveEvmTx`, `proveRawTx` for type 2; `readOnlyEvm`, `readOnlyEvmClient`, `evmJsonRpc`, `EVM_READ_METHODS`; the `ReadOnlyError` re-export | Implemented | three recorded EVM cassettes, the live Base and Sepolia proofs, `proveRawTx` live on `steps[2].raw`, and the prove-evm-tx example (11 of 11 checks on three pairs) |
| The `failed`, `pending` and `inconsistent` statuses (and the verdicts `has-failed`, `has-pending`, `has-inconsistent`) | Experimental | each is tested only through a labelled in-test change of a recorded outcome: none of the nine recorded transactions has such a request |
| Requests on domains 4 and 5 | Experimental | derivation and root keys are recorded and live-checked, but no real request on 4 or 5 was found to record (none in the samples above) |
| The legacy request form (`key_version`, `payload`) | Experimental | seen on mainnet and audited all-verified by the example (FgZVNRSe… above, in the final check too), but not recorded as a fixture yet |
| `timed-out` | Experimental | HthQSVE… was signed, not a timeout; the timeout chain is a labelled in-test change |
| `proveEvmTx` for types 0 and 1 | Experimental | no real transaction of those types recorded |
| `verify_foreign_transaction` (domains 3 and 7), a `satchel-nft mpc-audit` CLI command, a second-RPC "opinion" mode, and dao.ts's `signatureFromReceipts` calling `scanMpcResponses` | Planned | designed only |
