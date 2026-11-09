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

[README.md](README.md) is the full description. [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) lists
the attacks and what stops each one. [SECURITY.md](SECURITY.md) says how to report a problem.

## Check the claims

Steps 1 and 2 take about five minutes. Steps 3 and 4 install and build Rust, so they take longer
the first time. Run every command from the repository root.

### 1. The deployment and its history: one command

```bash
node scripts/check-claims.mjs
```

You should see 11 `[PASS]` lines, then `11 of 11 claims hold`, with exit code 0. It reads NEAR
testnet over JSON-RPC and checks:

| Claim (README) | What the script reads |
|---|---|
| The contract has no access keys | `view_access_key_list`: empty |
| Its code is the reproducible build, not a global contract | `view_account`: `code_hash` equals `deployments/testnet.json`, no global contract fields |
| Its NEP-330 metadata names commit `87148c6` and the pinned Docker image | `contract_source_metadata` |
| It signs only through `v1.signer-prod.testnet` | `mpc_contract()` |
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

You should see `9 of 9 claims hold`. The first five are the rows above for `v1.satchel-nft.near`
(signer `v1.signer`, deploy-and-init tx `3cbRdh9W…`). The sixth reads `nft_total_supply()` at the
block that ran the `DeleteKey` of tx `Dw29Zbe…` and expects 0: the supply only grows, so no
satchel was minted while the key existed. The refused calls are testnet only.

The last three read `deployments/mainnet-first-send.json`, satchel #1's first send:

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

### 2. The clean transfer report for each demo satchel

From the repository root:

```bash
npm ci
npm run build -w satchel-nft
npx satchel-nft verify 1
```

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

Each runs in both workspaces. You should see `Tests  94 passed (94)` for `satchel-nft`, then
`Tests  3 passed (3)` for the app, then no type errors.

```bash
cd contracts/satchel
cargo test
cd ../..
```

You should see `test result: ok. 59 passed`. Rust 1.99.1 is pinned in `rust-toolchain.toml`, and
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

## Where each rule lives

| Rule | Code | Tests (`contracts/satchel/src/tests.rs` unless named) |
|---|---|---|
| The contract builds and hashes every EVM transaction it signs (EIP-1559) | `Eip1559Tx::signing_hash` in `contracts/satchel/src/evm.rs` | `evm_hash_and_rlp_match_viem_for_every_vector`, `evm_signing_hash_view_matches_the_hash_sign_evm_sends` |
| The record is written before the MPC request | `sign_evm`, `sign_raw`, `request_signature` in `contracts/satchel/src/lib.rs`. The record is saved when the `sign_evm` receipt succeeds; the MPC `sign` call is a later receipt, so whatever happens to it cannot undo the record | `sign_evm_calls_mpc_with_the_token_path_and_records_the_nonce`, `sign_raw_counts_as_opaque` (both show the record and the MPC call; the order follows from NEAR's receipts) |
| Every call is classified: transfer, asset transfer, approval, revocation or unclassified | `Eip1559Tx::classify` in `evm.rs` | `value_and_asset_transfers_are_classified`, `a_call_satchel_cannot_classify_is_counted`, `revocations_are_logged_but_never_take_an_approval_slot`, `approval_selectors_are_the_keccak_of_their_signatures` |
| 32 approvals are itemized, more are counted | `sign_evm`, `MAX_APPROVALS` | `approvals_beyond_the_cap_are_counted_not_dropped` |
| Only the owner signs; listing freezes signing | `assert_can_sign` | `sign_evm_refuses_a_non_owner`, `sign_evm_is_frozen_while_listed`, `sign_raw_is_frozen_while_listed`, `the_previous_owner_cannot_sign_after_a_transfer` |
| `buy` pins the record version and price | `buy` | `buy_refuses_a_stale_record_version`, `buy_refuses_after_the_seller_delists_signs_and_relists`, `buy_refuses_a_changed_price` |
| Any transfer ends the listing, a bounced `nft_transfer_call` too | `nft_transfer`, `nft_transfer_call`, `nft_resolve_transfer`, `active_listing` | `nft_transfer_ends_the_listing_and_moves_signing_rights`, `a_transfer_cancels_the_sale`, `a_bounced_transfer_call_voids_the_receivers_listing` |
| Only 16 chain ids can be signed for | `SUPPORTED_CHAINS` in `contracts/satchel/src/evm.rs` | `sign_evm_refuses_an_unsupported_chain`, `every_supported_chain_can_be_signed_for` |
| Check 1: the contract can't sign behind the record | `contractCheck`, `contractFacts` in `packages/satchel-nft/src/report.ts` | `packages/satchel-nft/src/report.test.ts` |
| Check 2: no signed transaction is still pending (nonce at a finalized block) | `pendingCheck`, `finalizedAt` in `report.ts` | `report.test.ts` (`pendingCheck`; `finalizedAt` reads live chains and has no unit test) |
| Check 3: no approval left behind | `approvalsCheck` in `report.ts`, `approvalLiveness` in `packages/satchel-nft/src/approvals.ts` | `approvals.test.ts` |
| Check 4: nothing the record can't explain | `countersCheck` in `report.ts` | `report.test.ts` |
| Every EVM RPC must report the chain id it is configured for | `verifiedClient` in `packages/satchel-nft/src/evm.ts` | none yet |
| The app signs nothing and shows no address until the network's contract passes check 1 | `assertDeployment`, `deploymentCheck` in `packages/satchel-nft/src/guard.ts`, used by `send` in `web/src/components/wallet.tsx` and by `useDeployment` | `guard.test.ts` |
| The wallet signs only for this network's contract, from an account on this network | `assertTxFor` in `guard.ts` | `guard.test.ts` |
| A transfer refuses a receiver that doesn't exist on the network, the contract and the MPC contract | `assertReceiver` in `guard.ts` | `guard.test.ts` |
| A purchase takes its record version and price from the report the buyer read, read on the same network | `web/src/components/sale-panel.tsx` | manual, on testnet |
| A send checks that the contract's `evm_signing_hash` equals viem's hash of the same transaction, and that the MPC signature recovers to the satchel's address, before broadcasting | `sendFromSatchel` in `packages/satchel-nft/src/send.ts` | `send.test.ts` |
| The CLI sends only the transaction it asked the near CLI to sign: one function call, from the `--as` account, to this network's contract, with the method, arguments, gas and deposit it asked for | `decodeSignedTx`, `assertSignedAsAsked`, `signAndSend` in `packages/satchel-nft/src/near-cli.ts` | `near-cli.test.ts` |
| The CLI runs the near CLI by its absolute path, found in PATH's absolute folders, never in the current folder | `resolveNearCli` in `near-cli.ts` | `near-cli.test.ts` |
| Nothing is built from a token view about another token, and a transaction counts as done only once its status is final | `satchel(net).get` in `satchel.ts`, `finished` in `near.ts` | `satchel.test.ts` |
| A transaction the CLI sent but couldn't read back exits 3 with its hash, not as a failure that invites a retry | `OutcomeUnknown` in `near-cli.ts`, `submit` and `send` in `cli.ts` | none: it needs an RPC that fails after the send |
| The CLI asks before it sends, and refuses to sign without a terminal unless given `--yes` | `submit`, `confirm` in `packages/satchel-nft/src/cli.ts` | manual, on testnet ([`deployments/testnet-cli.json`](deployments/testnet-cli.json)) |
| The CLI buys only a satchel whose report reads `PROVABLY CLEAN` (unless `--accept-not-clean`), naming the record version and price that report read | `buy` in `cli.ts` | manual, on testnet |
| Every CLI option belongs to one command, so an option meant for another is an error | `parseCli` in `packages/satchel-nft/src/cli-args.ts` | `cli-args.test.ts` |

## What Satchel does not claim

- **Not audited.** It is live on mainnet, where satchels hold real funds; the demo satchels and the
  end-to-end runs are on testnet.
- **The report proves only what the token's key signed.** It says nothing about powers built into
  an asset itself: an upgradable token, a blacklist, an issuer's clawback.
- **The report trusts its RPCs**: one NEAR node and one node per EVM chain. It names them, and
  `satchel-nft verify` can read from your own nodes, but it does not compare nodes or check storage
  proofs.
- **The MPC network is trusted.** If enough MPC nodes colluded, they could sign with any derived key.

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
- **The deployed contract is locked**, with no keys and no admin. A contract change ships only as a
  new account (for example `v2.satchel-nft.testnet`) with a new code hash. Deploy that from the CI
  reproducible artifact (`tools/deploy-mainnet.sh` shows the steps on mainnet), then update
  `TESTNET` or `MAINNET` in `packages/satchel-nft/src/config.ts`, the files in `deployments/`, the
  transaction hashes in `scripts/check-claims.mjs` and the README.
- **Keys:** the testnet scripts in `tools/` and the CLI's sign commands sign with the near CLI's
  keychain (`~/.near-credentials` unless `--keychain os`); neither reads a key. Never commit a key, a seed phrase or an RPC key.
- **Docs:** keep [README.md](README.md), [CHANGELOG.md](CHANGELOG.md) (under Unreleased) and the
  package's [README](packages/satchel-nft/README.md), which npm shows, in step with the change. A claim the README makes should be checkable by a command, like the ones above.
