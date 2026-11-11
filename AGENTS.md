# AGENTS.md

For AI agents and human reviewers: how to check what Satchel claims, where each rule lives in the
code, and how to change it safely. Every check below needs no wallet and no key. Most need only
Node 22 or later; the contract tests also need Rust.

## Satchel in five lines

- A NEAR NFT contract (NEP-171), live on testnet at `v1.satchel-nft.testnet` and on mainnet at
  `v1.satchel-nft.near`, the same reproducible build.
- Each token controls one secp256k1 key held by NEAR's MPC network (Chain Signatures). The key is
  derived from the contract's account and the path `satchel/<token_id>`, so a token is one address
  on 16 EVM chains.
- Only the token's owner can have the contract sign with that key, so transferring the NFT moves
  control of the address on every chain.
- The contract builds every EVM transaction it signs and keeps a public signing record per token.
- A buyer runs four checks on that record (the "clean transfer report") before paying, and `buy`
  names the record version the buyer checked. The report and the transactions are one package,
  `satchel-nft` in `packages/satchel-nft`: the web app runs on it, and it is also a library and a
  CLI.

[README.md](README.md) is the full description. For the hackathon's tracks, its sections
[The NFT track's brief, point by point](README.md#the-nft-tracks-brief-point-by-point) and
[The other tracks, point by point](README.md#the-other-tracks-point-by-point) take each brief's
points in turn. [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) lists the attacks and what stops each
one. [SECURITY.md](SECURITY.md) says how to report a problem.

## Check the claims

Steps 1 and 2 take about five minutes. Steps 3 and 4 install and build Rust, so they take longer
the first time. Step 5 needs step 2's install and curl. Run every command from the repository root.

### 1. The deployment and its history: one command

```bash
node scripts/check-claims.mjs
```

You should see 13 `[PASS]` lines, then `13 of 13 claims hold`, with exit code 0. It reads NEAR
testnet over JSON-RPC and checks:

| Claim (README) | What the script reads |
|---|---|
| The contract has no access keys | `view_access_key_list`: empty |
| Its code is the reproducible build, not a global contract | `view_account`: `code_hash` equals `deployments/testnet.json`, no global contract fields |
| Its NEP-330 metadata names commit `87148c6` and the pinned Docker image | `contract_source_metadata` |
| It signs only through `v1.signer-prod.testnet` | `mpc_contract()` |
| The package derives every satchel's address from that MPC contract's root key, and pins that key | `public_key({ domain_id: 0 })` on `v1.signer-prod.testnet` equals `mpcRootKey` in `packages/satchel-nft/src/config.ts` |
| The keys the package's tests derive are the ones the MPC contract gives for each satchel | `derived_public_key` for `satchel/1` to `satchel/8` equals `packages/satchel-nft/src/__fixtures__/derived-keys.json`, the keys `evm.test.ts` derives from the pinned root key |
| Deployed and initialized in one transaction | tx `7pocx72c…`: `DeployContract` then `new({ mpc_contract: "v1.signer-prod.testnet" })` |
| Its only key was deleted before the first mint | tx `6FYx6hV5…` is a `DeleteKey`, in an earlier block than satchel #1's mint |
| The previous owner cannot sign after a transfer | tx `GqFsnmFL…` failed: `Satchel: only the token's owner can do this` |
| No one else can re-initialize it | tx `BeoXbii9…` failed: `Method new is private` |
| Signing is frozen while listed | tx `5ZaKqJUx…` failed: `Satchel: signing is frozen while the token is listed` |
| A buy naming an old record version fails and the buyer keeps the NEAR | tx `7HQPu9qe…` failed: `Satchel: the signing record changed since you checked it`, and a system receipt refunded the 1 NEAR |
| Satchel #6 had one raw signature on record and was listed only after it | `signing_record("6")`, `listing("6")` at the block of tx `7HQPu9qe…` |

Each refused call is checked for its sender, its method and arguments on `v1.satchel-nft.testnet`
and its error, not the error alone. The previous-owner claim also checks that transaction
`3sLuGS9p…` moved satchel #1 to the buyer in an earlier block, and the first-mint claim that the
mint returned token 1. Old transactions and state are read from FastNEAR's archival node, so the
answers do not change if someone buys or signs with a demo satchel later. To use your own nodes,
set `NEAR_RPC` and `NEAR_ARCHIVAL_RPC`.

The mainnet deployment has its own record, `deployments/mainnet.json`:

```bash
node scripts/check-claims.mjs --network mainnet
```

You should see `15 of 15 claims hold`. The first seven are the rows above for `v1.satchel-nft.near`
(signer `v1.signer`, its root key, satchel #1's derived key, deploy-and-init tx `3cbRdh9W…`). The eighth reads `nft_total_supply()` at the
block that ran the `DeleteKey` of tx `Dw29Zbe…` and expects 0: the supply only grows, so no
satchel was minted while the key existed. The refused calls are testnet only.

The next three read `deployments/mainnet-first-send.json`, satchel #1's first send:

- its mint, tx `HCYB168y…`, was signed by `satchel-nft.near` and returned token 1 to it, in a block
  after the lock;
- its `sign_evm`, tx `2xqwe8AA…`, signed by the same account for Base (8453) at nonce 0: the contract
  logged that entry in its own receipt at record version 1 (so it was the first), and asked
  `v1.signer` to sign path `satchel/1` over the hash that `evm_signing_hash` gives for those fields;
  `v1.signer` returned a signature;
- the Base transaction `0x8044dd8c…` has the fields `sign_evm` was given and the r, s and parity
  `v1.signer` returned, comes from `0xdc269ead…868f9`, succeeded in block 55178996 for the value and
  fee the record names, and that block is finalized. This one reads Base through `BASE_RPC`
  (`https://base-rpc.publicnode.com` by default) and fails until Base finalizes the block, about
  20 minutes after a send.

The last four read `deployments/mainnet-1click-exit.json`, satchel #2's swap through NEAR Intents'
1Click:

- its mint, tx `8NE2xLni…`, was signed by `satchel-nft.near` and returned token 2 to it, and the
  contract's receipt ran in a NEAR block older than the Base block of `0x9c786eab…`, which succeeded
  and sent the satchel's address the 0.0026 ETH the record names; the address had nonce 0 and
  0 wei in the block before, and exactly that in its block. This reads Base state at block
  55857952, which `https://base-rpc.publicnode.com` served on 2026-11-11 and a pruned node in
  `BASE_RPC` can't;
- its `sign_evm`, tx `FnFSMSh1…`, passes the same checks as satchel #1's, for path `satchel/2`, and
  the transaction it signed sends exactly the quote's `amountIn` to the quote's `depositAddress`
  with no calldata, which the contract logged as `value_transfer`;
- the Base transaction `0x2d9b1a1c…` passes the same field, signature, block, fee and finality checks
  as satchel #1's;
- 1Click's public status for the deposit address reads `SUCCESS`, has the record's swap type,
  assets (ETH on Base, USDC on Arbitrum One), deposit address, amount, minimum, recipient and refund
  address, names `0x2d9b1a1c…` as the deposit and the record's payout transactions as the payout;
  those, here only `0x417322bd…`, succeeded on
  Arbitrum One and logged Circle's USDC (`0xaf88d065…`) `Transfer`s to the satchel's address adding
  up to the record's 5.280549 USDC, more than the quote's minimum, in blocks no older than the
  deposit's. It reads 1Click at each run, and Arbitrum One through `ARBITRUM_RPC`
  (`https://arb1.arbitrum.io/rpc` by default).

The quote itself, with its recipient and refund address, is 1Click's word, not the chain's: the
last claim compares the file's quote with the one 1Click returns for
`https://1click.chaindefuser.com/v0/status?depositAddress=0x588f8C4419974bC735Ac784B3dA41B44c42bb64b`.
So is the link between the deposit and the payout: the chain shows that `0x2cff890f…02680` sent the
satchel's address that USDC, and only 1Click's status says it paid out this deposit.

A Sputnik DAO owned satchel #8 on testnet. That run has its own record,
`deployments/testnet-dao.json`, and its own script:

```bash
node scripts/check-dao.mjs
```

You should see `5 of 5 claims hold`. It checks that:

- `satchel-club.sputnikv2.testnet` was created by the `sputnikv2.testnet` factory (tx `7fsqT1cc…`),
  its `version()` is `2.3.1`, and `get_policy` has only group roles, whose one member is
  `satchel-nft.testnet`, a bond of 0 and a one-hour proposal period;
- tx `GorSCms2…` minted satchel #8 to the DAO (`nft_mint`);
- tx `5wqriE9U…` filed proposal 0 (`add_proposal` returned 0, with the kind `get_proposal` shows),
  and vote `2ryQpsJR…` ran it as filed (method, arguments, deposit and gas), the proposal is
  `Approved`, the DAO called `sign_evm` for #8 on Sepolia, the contract logged it at record version
  1 and asked `v1.signer-prod.testnet` to sign `satchel/8` over the hash `evm_signing_hash` gives,
  and the one signature is in a receipt the MPC contract ran, while the vote returned nothing;
- Sepolia transaction `0x27e3262b…` has the fields `sign_evm` was given and the r, s and parity
  the MPC contract returned, comes from `0x2aA82C50…A5F0`, succeeded in block 12102812, and that
  block is finalized;
- tx `A5YMQQp2…` filed proposal 1 and vote `6GSVLR17…` ran it as filed, an `nft_transfer` of #8 to
  `buyer.satchel-nft.testnet`,
  the contract logged it from the DAO, and right after it the record was still at version 1.

`SEPOLIA_RPC` replaces the Sepolia node.

### 2. The clean transfer report for each demo satchel

From the repository root:

```bash
npm ci
npm run build -w satchel-nft
npx satchel-nft verify 1
```

Outside a clone, `npx -y satchel-nft@0.2.0 verify 1` runs the release on npm, published from
commit `2dd4209` ([how to check that](docs/THREAT_MODEL.md#what-satchel-trusts)). Inside the
repository that pinned command runs this checkout's build instead, because the checkout's package
is also 0.2.0. The release's first run downloads the package: 142 s and 230 s in two runs here,
more than a 2-minute command timeout. Later runs take 6 to 11 s.

`npm ci` at the root installs the package `satchel-nft` (in `packages/satchel-nft`) and the web app
that runs on it. Inside the repository, `npx satchel-nft` runs this checkout's build, never a
download. `satchel-nft verify <id>` prints the four checks, the verdict and the RPCs it read. It
exits 0 only when the satchel is provably clean.

| Id | You should see | Exit |
|---|---|---|
| 1 | four `[PASS]`, `PROVABLY CLEAN` | 0 |
| 5 | `[FAIL] A signed transaction may still be pending`, `NOT PROVABLE` | 1 |
| 3 | `[FAIL] An approval is still live`, `NOT PROVABLE` | 1 |
| 6 | `[FAIL] The record can't explain everything signed`, `NOT PROVABLE`, `listed by satchel-nft.testnet at record version 1` | 1 |
| 4 | four `[PASS]`, `PROVABLY CLEAN`, `listed by satchel-nft.testnet at record version 0` | 0 |
| 7 | four `[PASS]`, `PROVABLY CLEAN` | 0 |

Two things can change these answers, and both are expected:

- Satchels #4 and #6 are for sale on testnet. If someone has bought one, its listing line is gone.
  A new owner can also sign with it, which changes its record and possibly its verdict.
- For about 13 minutes after a satchel sends on Sepolia, its report reads `COULD NOT CHECK
  EVERYTHING` until that block is final.

The same reports run in the browser at <https://satchelnft.xyz/#examples>.

### 3. The tests

The package and app tests use what step 2 installed. From the repository root:

```bash
npm test
npm run typecheck
```

Each runs in both workspaces. You should see `Tests  222 passed (222)` for `satchel-nft`, then
`Tests  86 passed (86)` for the app, then no type errors.

```bash
cd contracts/satchel
cargo test
cd ../..
```

You should see `test result: ok. 61 passed`. Rust 1.99.1 is pinned in `rust-toolchain.toml`, and
rustup installs it on first use. On Windows, a dependency (`aws-lc-sys`) needs NASM unless you set
`AWS_LC_SYS_PREBUILT_NASM=1` first: `$env:AWS_LC_SYS_PREBUILT_NASM=1` in PowerShell, `export
AWS_LC_SYS_PREBUILT_NASM=1` in Git Bash.

### 4. The reproducible build

The deployed code hash, `94x4MmZKXGetffqJJVePLTdFkJvsmeXRLmi74Mdp2Lph`, comes from the CI run
<https://github.com/duongnq2798/satchel/actions/runs/42547394040>:

- The run was for pull request #2, and its head commit is `87148c6`: the build checks out the
  branch commit, which the wasm records (NEP-330). The run's summary prints the code hash. The
  commit it printed is GitHub's temporary merge commit for that pull request; runs since print the
  commit they built.
- Its artifact `satchel-reproducible-wasm` holds the wasm (downloading it needs a GitHub login).
  `node scripts/code-hash.mjs satchel.wasm` prints the same hash.

To rebuild it yourself you need Docker and cargo-near 0.22.0:

```bash
cd contracts/satchel
cargo near build reproducible-wasm
node ../../scripts/code-hash.mjs target/near/satchel.wasm
```

This builds the commit you have checked out. Check out `87148c6` first to get the deployed hash.

### 5. The holder room's gate

Claim: a satchel's holder room (`/satchel/<id>/room`) opens only for the account that owns the
satchel at a final NEAR block, signing a NEP-413 message with one of its full-access keys, checked
again on every request, with nothing stored. Its tests:

```bash
npm test -w satchel-nft -- holder nep413 kit
npm test -w satchel-web -- room-request
```

You should see `Tests  33 passed (33)`, then `Tests  5 passed (5)`. Then the route itself, with no
key: a GET, and a signature that doesn't verify.

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://satchelnft.xyz/api/room      # 405
ISSUED=$(node -e "console.log(new Date().toISOString())")
SIG=$(node -e "console.log(Buffer.alloc(64).toString('base64'))")
NONCE=$(node -e "console.log(Buffer.alloc(32).toString('base64'))")
curl -s -w '\n%{http_code}\n' https://satchelnft.xyz/api/room -H 'content-type: application/json' \
  -d "{\"network\":\"testnet\",\"tokenId\":\"4\",\"accountId\":\"satchel-nft.testnet\",\"publicKey\":\"ed25519:11111111111111111111111111111111\",\"signature\":\"$SIG\",\"nonce\":\"$NONCE\",\"issuedAt\":\"$ISSUED\"}"
```

You should see `{"error":"The signature doesn't verify for ed25519:1111…: it must sign the room
message for satchel #4 on testnet, for satchelnft.xyz"}` and `401`. The route reads NEAR only after
the signature verifies. To be refused as a non-holder (403, naming satchel #4's owner at the block
read), sign the message with a testnet account of your own: the README's
[Holder room](README.md#holder-room) has the near-cli-rs steps. That needs a key, so it is not one
of these checks.

## Where each rule lives

| Rule | Code | Tests (`contracts/satchel/src/tests.rs` unless named) |
|---|---|---|
| The contract builds and hashes every EVM transaction it signs (EIP-1559) | `Eip1559Tx::signing_hash` in `contracts/satchel/src/evm.rs` | `evm_hash_and_rlp_match_viem_for_every_vector`, `evm_signing_hash_view_matches_the_hash_sign_evm_sends` |
| The record is written before the MPC request | `sign_evm`, `sign_raw`, `request_signature` in `contracts/satchel/src/lib.rs`. The record is saved when the `sign_evm` receipt succeeds; the MPC `sign` call is a later receipt, so whatever happens to it cannot undo the record | `sign_evm_calls_mpc_with_the_token_path_and_records_the_nonce`, `sign_raw_counts_as_opaque`, `a_sale_in_the_middle_of_a_payout_keeps_the_send_on_record` (they show the record and the MPC call; the order follows from NEAR's receipts) |
| Every call is classified: transfer, asset transfer, approval, revocation or unclassified | `Eip1559Tx::classify` in `evm.rs` | `value_and_asset_transfers_are_classified`, `a_call_satchel_cannot_classify_is_counted`, `revocations_are_logged_but_never_take_an_approval_slot`, `approval_selectors_are_the_keccak_of_their_signatures` |
| 32 approvals are itemized, more are counted | `sign_evm`, `MAX_APPROVALS` | `approvals_beyond_the_cap_are_counted_not_dropped` |
| Only the owner signs; listing freezes signing | `assert_can_sign` | `sign_evm_refuses_a_non_owner`, `sign_evm_is_frozen_while_listed`, `sign_raw_is_frozen_while_listed`, `the_previous_owner_cannot_sign_after_a_transfer`, `the_seller_cannot_sign_while_their_payment_is_in_flight` |
| `buy` pins the record version and price | `buy` | `buy_refuses_a_stale_record_version`, `buy_refuses_after_the_seller_delists_signs_and_relists`, `buy_refuses_a_changed_price` |
| Any transfer ends the listing, a bounced `nft_transfer_call` too | `nft_transfer`, `nft_transfer_call`, `nft_resolve_transfer`, `active_listing` | `nft_transfer_ends_the_listing_and_moves_signing_rights`, `a_transfer_cancels_the_sale`, `a_bounced_transfer_call_voids_the_receivers_listing` |
| Only 16 chain ids can be signed for | `SUPPORTED_CHAINS` in `contracts/satchel/src/evm.rs` | `sign_evm_refuses_an_unsupported_chain`, `every_supported_chain_can_be_signed_for` |
| Check 1: the contract can't sign behind the record | `contractCheck`, `contractFacts` in `packages/satchel-nft/src/report.ts` | `packages/satchel-nft/src/report.test.ts` |
| Check 2: no signed transaction is still pending (nonce at a finalized block) | `pendingCheck`, `finalizedAt` in `report.ts` | `report.test.ts` (`pendingCheck`; `finalizedAt` reads live chains and has no unit test) |
| Check 3: no approval left behind | `approvalsCheck` in `report.ts`, `approvalLiveness` in `packages/satchel-nft/src/approvals.ts` | `approvals.test.ts` |
| Check 4: nothing the record can't explain | `countersCheck` in `report.ts` | `report.test.ts` |
| Every EVM RPC must report the chain id it is configured for | `verifiedClient` in `packages/satchel-nft/src/evm.ts` | none yet |
| A satchel's address comes from the MPC network's root key pinned in the package, the contract and the path, never from an RPC answer | `deriveMpcKey`, `tokenAddress` in `packages/satchel-nft/src/evm.ts`, `mpcRootKey` in `config.ts` | `evm.test.ts`: the keys of testnet satchels #1 to #8 and mainnet #1, against `__fixtures__/derived-keys.json`; on chain, `node scripts/check-claims.mjs` |
| The app signs nothing and shows no address until the network's contract passes check 1 | `assertDeployment`, `deploymentCheck` in `packages/satchel-nft/src/guard.ts`, used by `send` in `web/src/components/wallet.tsx` and by `useDeployment` | `guard.test.ts` |
| The wallet signs only for this network's contract, from an account on this network | `assertTxFor` in `guard.ts` | `guard.test.ts` |
| A page waits at most 8 s for a saved wallet to name its account before it offers "Connect wallet". An account named later still counts, unless a connect has finished, the user has disconnected, another wallet has been saved or the page has switched network since; closing the wallet picker leaves the wait running | `restoreAccount`, `fromSameWallet` in `web/src/lib/restore.ts`, used by `WalletProvider` in `web/src/components/wallet.tsx` | `restore.test.ts`: the wait, a late account, a late none, stop, another wallet saved. `WalletProvider`'s use of them has no test: that a finished connect, a disconnect or a network switch stops the wait, and that a closed picker doesn't |
| A transfer refuses a receiver that doesn't exist on the network, the contract and the MPC contract | `assertReceiver` in `guard.ts` | `guard.test.ts` |
| A purchase takes its record version and price from the report the buyer read, read on the same network | `web/src/components/sale-panel.tsx` | manual, on testnet |
| A send checks that the contract's `evm_signing_hash` equals viem's hash of the same transaction, and that the MPC signature recovers to the satchel's address, before broadcasting | `sendFromSatchel` in `packages/satchel-nft/src/send.ts` | `send.test.ts` |
| `dao finish` broadcasts what a DAO's vote had a satchel sign only when the vote ran one `sign_evm` on this network's contract, one MPC signature is in its receipts, the contract's `evm_signing_hash` equals viem's hash, the signature recovers to the satchel's address, the nonce is the next one and the address can pay | `finishSignEvm`, `signatureFromReceipts`, `signEvmCalls` in `packages/satchel-nft/src/dao.ts`; `fromContractTx` in `evm.ts` | `dao.test.ts`, with the receipts of the testnet vote in `__fixtures__/dao-vote-outcome.json`; on chain, `node scripts/check-dao.mjs` |
| The CLI sends only the transaction it asked the near CLI to sign: one function call, from the `--as` account, to this network's contract, with the method, arguments, gas and deposit it asked for | `decodeSignedTx`, `assertSignedAsAsked`, `signAndSend` in `packages/satchel-nft/src/near-cli.ts` | `near-cli.test.ts` |
| The CLI runs the near CLI by its absolute path, found in PATH's absolute folders, never in the current folder | `resolveNearCli` in `near-cli.ts` | `near-cli.test.ts` |
| The CLI's and the app's market list every live listing: pages are read until they cover `nft_total_supply`, since a page of the `listings` view can be short or empty with more after it | `allListings` in `packages/satchel-nft/src/satchel.ts`, used by `market` in `cli.ts`, `web/src/app/market/page.tsx` and `web/src/components/live-stats.tsx` | `satchel.test.ts` |
| Nothing is built from a token view about another token, and a transaction counts as done only once its status is final | `satchel(net).get` in `satchel.ts`, `finished` in `near.ts` | `satchel.test.ts` |
| A transaction the CLI sent but couldn't read back exits 3 with its hash, not as a failure that invites a retry | `OutcomeUnknown` in `near-cli.ts`, `submit` and `send` in `cli.ts` | none: it needs an RPC that fails after the send |
| A reader that closes the CLI's output or its messages early (`… \| head`, `… 2>&1 \| true`) stops the printing, not the command: it still exits with its own code | the `stdout` and `stderr` error handlers in `packages/satchel-nft/src/cli.ts` | manual, beside npm's 0.1.0, reading `${PIPESTATUS[0]}`: `show --network mainnet 1 \| true` exits 0 with no EPIPE trace (0.1.0: 1, with one), `verify --bogus 2>&1 \| true` exits 2 (0.1.0: 1), `verify 5 \| true` exits 1 (0.1.0: 1, with a trace) |
| The CLI asks before it sends, and refuses to sign without a terminal unless given `--yes` | `submit`, `confirm` in `packages/satchel-nft/src/cli.ts` | manual, on testnet ([`deployments/testnet-cli.json`](deployments/testnet-cli.json)) |
| The CLI buys only a satchel whose report reads `PROVABLY CLEAN` (unless `--accept-not-clean`), naming the record version and price that report read | `buy` in `cli.ts` | manual, on testnet |
| Every CLI option belongs to one command, so an option meant for another is an error | `parseCli` in `packages/satchel-nft/src/cli-args.ts` | `cli-args.test.ts` |
| A satchel's history shows only events the network's Satchel contract logged about that token, in receipts that succeeded, oldest first, and a sale once, not also as the seller-to-buyer transfer it logs. A bad block time skips the receipt, and an error in the card can't unmount the report (`Contained` in `web/src/components/history.tsx`). It is display only: the report never reads it | `eventsIn`, `tokenHistory` in `packages/satchel-nft/src/history.ts` | `history.test.ts`, on satchel #7's real transactions |
| What a satchel holds is read at one listed address per token on each chain, checksummed, with the symbol and decimals its contract reports. Display only | `TOKENS`, `chainContents` in `packages/satchel-nft/src/contents.ts` | `contents.test.ts`; on chain, `node scripts/check-tokens.mjs` after `npm run build -w satchel-nft` |
| The holder room's signature is ed25519, verified strictly, over sha256 of NEP-413's tag and the borsh payload: the message, the 32-byte nonce, the recipient `satchelnft.xyz` and no callback URL | `verifyNep413`, `nep413Hash` in `packages/satchel-nft/src/nep413.ts` | `nep413.test.ts`, against two signatures near-cli-rs made |
| The holder room opens only for the account that owns the satchel at a final NEAR block, signing with one of its full-access keys, within 5 minutes of the `Issued` time it signed; the server writes the message itself and reads NEAR only once the signature verifies, the key and the owner at the same block, each read giving up after 10 s (a 502) | `checkHolder`, `roomMessage` in `packages/satchel-nft/src/holder.ts`; `finalBlock`, `accessKeyAt`, `viewAt`, `rpcFor` in `near.ts` | `holder.test.ts` |
| `/api/room` takes only POST (another method gets Next.js's empty 405, with no body), reads at most 4 KB of body, and answers every POST as JSON with `Cache-Control: no-store`, a refusal with its status. A report that doesn't come within 20 s still leaves the holder card, with no kit | `readRoomRequest`, `within` in `web/src/lib/room-request.ts`, `POST` in `web/src/app/api/room/route.ts` | `room-request.test.ts` |
| The handover kit has one step per check that doesn't pass, in the report's order, and one step to list only when all four pass. It names only the chains still open, offers no fix while check 1 fails (the app and the CLI then sign nothing), and says so for a chain the app and the CLI don't send on | `handoverKit` in `packages/satchel-nft/src/kit.ts` | `kit.test.ts` |
| Make it clean offers fixes for checks 2 and 3 only: a revoke for each approval row still live, and a send of 0 to the satchel's own address for each open nonce a revoke on that chain doesn't take. An `approve` row that both the ERC-20 and the ERC-721 read find live, or one it couldn't read, gets both calls and no button; more than 10 open nonces on a chain get a terminal command. It won't send a revoke that would be a 33rd approval row while check 4 passes, and offers no button while check 1 fails or the satchel is listed | `fixPlan`, `readFixInputs`, `revokeCalldata`, `MAX_APPROVAL_ROWS`, `MAX_NONCE_SPENDS` in `packages/satchel-nft/src/clean.ts`; the card is `web/src/components/fix-panel.tsx` | `clean.test.ts`. The card has no test and hasn't run on chain yet: testnet satchel #9 waits in the state it fixes ([`deployments/testnet-make-clean.json`](deployments/testnet-make-clean.json)) |
| Quote an exit asks 1Click only for dry quotes, never for a deposit address, at a slippage limit of 0.5 %, 1 % or 3 % and no other, and shows a quote only when 1Click's answer echoes the assets, amount, recipient, refund address, slippage and deadline asked for, has a minimum that matches that slippage, and carries no deposit address | `QuoteRequest`, `SLIPPAGE_CHOICES`, `quoteRequest`, `dryQuote`, `checkQuote` in `web/src/lib/oneclick.ts`; the panel is `web/src/components/quote-panel.tsx` | `web/src/lib/oneclick.test.ts`, with 1Click's real answers of 2026-11-11 as fixtures |
| A satchel's history links a 1Click swap's payout transaction only when 1Click calls it `SUCCESS` and names an EVM hash on one of the satchel's mainnets; otherwise, `REFUNDED` and `FAILED` included, it links 1Click's status, and a line shows an amount out only for `SUCCESS` | `payoutUrl`, `swapLine`, `swapMarks` in `web/src/lib/oneclick.ts`; the card is `web/src/components/history.tsx` | `web/src/lib/oneclick.test.ts` |
| Until 2026-11-25 the app shows a note in place of send, list, delist, transfer, buy and the Make it clean buttons on testnet #1 to #8 and mainnet #1 and #2, whose state the README quotes. It is a guard in the app, not a protection: the CLI and the near CLI can still sign for them | `FROZEN`, `FROZEN_UNTIL`, `isFrozen` in `web/src/lib/frozen.ts` | `web/src/lib/frozen.test.ts` |
| The mainnet showcase's amounts and transactions match the evidence files, the testnet stories match the gallery's, and `verifyCommand` pins the npm release | `FIRST_SEND`, `ONECLICK_EXIT`, `SHOWCASE`, `DEMO_SATCHELS`, `verifyCommand` in `web/src/lib/showcase.ts` | `web/src/lib/showcase.test.ts` |

## What Satchel does not claim

- **Not audited.** It is live on mainnet, where satchels hold real funds; the demo satchels and the
  end-to-end runs are on testnet.
- **The report proves only what the token's key signed.** It says nothing about powers built into
  an asset itself: an upgradable token, a blacklist, an issuer's clawback.
- **The report trusts its RPCs**: one NEAR node and one node per EVM chain. It names them, and
  `satchel-nft verify` can read from your own nodes, but it does not compare nodes or check storage
  proofs.
- **The MPC network is trusted.** If enough MPC nodes colluded, they could sign with any derived key.
- **A swap through 1Click trusts 1Click.** Mainnet satchel #2's swap kept it provably clean because
  its deposit was a plain transfer, but the USDC, or a refund, reaches the satchel only if 1Click's
  system sends it, and the report doesn't count an output or a refund still in flight. A swap
  through a DEX router is a call the contract can't classify, and reads not provable.
- **The holder room holds nothing secret.** Its gate trusts one NEAR RPC, a captured proof opens it
  until 5 minutes after its `Issued` time (up to 6 minutes, since `Issued` may run a minute ahead of
  the server's clock) while that account still owns the satchel, and requests aren't rate limited.

The full list, with what stops each attack and what is left, is in
[docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) and the README's
[Limits](README.md#limits-stated-plainly).

## If you change code

- **Branches:** branch from `dev` (`feat/…`, `fix/…`, `docs/…`) and open a pull request into `dev`.
  `main` is production: Vercel builds <https://satchelnft.xyz> from it.
- **CI:** every pull request runs [`ci.yml`](.github/workflows/ci.yml), which calls the contract,
  web and package workflows. Its `verify` job passes only when all three pass, and `main` and `dev`
  accept a merge only then.
- **Before pushing, run what CI runs:**
  - In `contracts/satchel`: `cargo fmt --check`, `cargo clippy --tests -- -D warnings`, `cargo test`.
  - At the repository root: `npm run typecheck`, `npm test` (both workspaces); then in
    `web`, `npm run build`.
  - For the package: `npm pack -w satchel-nft --dry-run` lists what npm would publish.
  - For the demo kit: `node scripts/check-demo-kit.mjs`, after any change to `docs/DEMO.md` or
    `docs/submission/`. The web workflow runs it.
- **The deployed contract is locked**, with no keys and no admin. A contract change ships only as a
  new account (for example `v2.satchel-nft.testnet`) with a new code hash. Deploy that from the CI
  reproducible artifact (`tools/deploy-mainnet.sh` shows the steps on mainnet), then update
  `TESTNET` or `MAINNET` in `packages/satchel-nft/src/config.ts`, the files in `deployments/`, the
  transaction hashes in `scripts/check-claims.mjs` and the README.
- **Keys:** the testnet scripts in `tools/` and the CLI's sign commands sign with the near CLI's
  keychain (`~/.near-credentials` unless `--keychain os`); neither reads a key. Never commit a key, a seed phrase or an RPC key.
- **Docs:** keep [README.md](README.md), [CHANGELOG.md](CHANGELOG.md) (under Unreleased) and the
  package's [README](packages/satchel-nft/README.md), which npm shows, in step with the change. A claim the README makes should be checkable by a command, like the ones above.
  The documentation at <https://satchelnft.xyz/docs> is `web/content/docs`, ordered by
  `web/src/lib/docs/nav.ts`; a page that describes what you changed changes with it.
  [`web/content/README.md`](web/content/README.md) says how, and `docs.test.ts` fails on a page
  without a file or a link to a page or heading that doesn't exist.
