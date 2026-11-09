# Threat model

What Satchel protects, who might attack it, what stops each attack, and what is left. It covers the
contract deployed at `v1.satchel-nft.testnet` (commit `87148c6`), the clean transfer report (in the
web app and `npm run verify`) and the hosted app at <https://satchelnft.xyz>. Every defense names the
code that enforces it and, where one exists, the transaction on testnet that shows it working.
[AGENTS.md](../AGENTS.md) has the commands to check them.

## What is protected

1. **Control of each token's address** on the 16 supported EVM chains, and whatever it holds there.
2. **The buyer's NEAR** during a purchase, and the seller's payment after one.
3. **The truth of the report.** A satchel reads "provably clean" only if nothing the token's key
   ever signed lets anyone but its owner move what it holds. Powers an asset's issuer builds into
   the asset are outside this (see Out of scope).

## Who might attack

| Actor | Wants |
|---|---|
| The seller, or any earlier owner | Keep some power over the wallet after selling it: a signed transaction, an approval, an off-chain permit, a key |
| Another buyer, or anyone on NEAR | Get a satchel without paying, or make a purchase go wrong |
| The deployer of the contract account | Change the code or sign around the record after people trust it |
| An RPC provider (NEAR or EVM) | Make an unclean satchel look clean, by lying about a nonce or an allowance |
| Whoever controls the hosted web app | Show a buyer a report that is not true |

## What Satchel trusts

- **NEAR's consensus and runtime**, including that a `#[private]` method and a deleted key behave as
  specified.
- **NEAR's MPC network** (`v1.signer-prod.testnet`). It signs for a key derived from the calling
  account and a path, and only when that account asks. If enough MPC nodes colluded, they could sign
  with any derived key; Satchel cannot detect that. The MPC contract can also be upgraded by a
  vote of its participants, which could change how keys are derived or who may ask for a
  signature.
- **Each EVM chain's finality.** Once a block is finalized, an address's nonce at that block cannot
  go back.
- **The pinned build image.** The reproducible build runs in
  `sourcescan/cargo-near:0.22.0-rust-1.99.1`, pinned by digest.
- **The RPCs the reader picks.** The report names them; `npm run verify` can use your own.

## Attacks and what stops them

### A seller keeps power over the wallet

| # | Attack | What stops it | Shown on testnet | What is left |
|---|---|---|---|---|
| 1 | Sign a withdrawal, sell, broadcast it after the sale | The contract builds every EVM transaction and records the highest nonce signed per chain **before** it asks the MPC network (`sign_evm`). Check 2 requires the address's nonce at a finalized block to be above it, so every signed transaction is either on chain or can never be. MPC signatures are public in NEAR receipts, so a buyer cannot void one after buying; the check has to pass before. A `sign` that timed out or looked failed can still produce a signature, since the nodes' answers are public too; the record counted it before the request either way | Satchel #5: a 10,000 ETH send signed and never broadcast reads `NOT PROVABLE` | A chain whose RPC reports a non-final block as finalized. Aurora's RPC does, so the report reads 10 blocks back there |
| 2 | Approve an address the seller controls to spend the wallet's tokens | `sign_evm` decodes ERC-20 `approve` / `increaseAllowance`, ERC-721 `approve`, `setApprovalForAll` and Permit2 `approve`, and itemizes each one. Check 3 reads each on chain at a finalized block: allowance 0, operator off, approval cleared | Satchel #3: an unlimited USDC approval reads `NOT PROVABLE` | Only 32 approvals are itemized per token; more are counted, and check 4 then fails |
| 3 | Sign something the contract did not build: an EIP-2612 or Permit2 signature, an EIP-712 order, an EIP-7702 authorization, a legacy transaction without a chain id, a Bitcoin sighash | The only way to sign arbitrary bytes is `sign_raw`, which counts each signature in `opaque_signatures`. Check 4 fails on any. `sign_evm` builds only EIP-1559 transactions, so it cannot produce an authorization or a legacy transaction | Satchel #6: one raw signature reads `NOT PROVABLE` | None for the verdict: a satchel that ever signed raw bytes can never be called clean |
| 4 | Hide a power inside a call: a multicall, a router, `transferOwnership`, a safe transfer whose data runs the receiver's hook | Anything that is not a value transfer, a plain asset transfer, a decoded approval or a revocation is counted in `unclassified_calls`, and check 4 fails | Unit tests `a_call_satchel_cannot_classify_is_counted`, `calldata_shorter_than_a_selector_is_unclassified`, `erc721_safe_transfer_with_data_is_plain_only_when_the_data_is_empty`, `erc1155_safe_transfer_is_plain_only_with_an_amount_and_no_data` | Calls are classified by selector. A contract that gives a standard selector a non-standard meaning would be misread |
| 5 | Keep a copy of the key | No key exists outside the MPC network. It is derived from the contract's account and `satchel/<token_id>`, and only the contract can ask for a signature with it | | Collusion inside the MPC network (trusted above) |
| 6 | Sign after the transfer, as the previous owner | `assert_owner` in every signing method | `GqFsnmFL…` refused: `only the token's owner can do this` | |
| 6a | Use a function-call key on the owner's NEAR account (a dapp login) to sign, list or move the satchel | `sign_evm`, `sign_raw`, `list`, `delist` and `nft_transfer` require 1 yoctoNEAR, `mint` 0.1 NEAR and `buy` the price. A function-call key cannot attach a deposit, so only a full-access key, the owner's wallet, can make these calls | | |

### A seller changes the deal after the buyer checked

| # | Attack | What stops it | Shown on testnet | What is left |
|---|---|---|---|---|
| 7 | Sign more while the satchel is listed | `assert_can_sign` refuses while a listing is active | `5ZaKqJUx…` refused: `signing is frozen while the token is listed` | |
| 8 | Delist, sign, relist, or move the NFT to another account and back, between the buyer's check and the purchase | Every signature bumps the record version. `buy` requires the current version, the listing's version and the version the buyer names to be the same, and a transfer or relist cannot reset it | `7HQPu9qe…` refused: `the signing record changed since you checked it`, 1 NEAR refunded | |
| 9 | Raise the price after the buyer checked | `buy` requires the price the buyer names to equal the listing's price | Unit test `buy_refuses_a_changed_price` | |
| 10 | Let someone else's account move the NFT from under the listing | The contract does not offer NEP-178 approvals, so only the owner can transfer. Any transfer, including `nft_transfer_call`, removes the listing. A listing whose seller no longer owns the token is ignored (`active_listing`) | Unit tests `a_transfer_cancels_the_sale`, `nft_transfer_ends_the_listing_and_moves_signing_rights`, `a_bounced_transfer_call_voids_the_receivers_listing`, `list_refuses_a_non_owner` | No unit test yet for `nft_transfer_call` removing the seller's own listing (the code does, in `nft_transfer_call`), or for a non-owner's `nft_transfer` failing (near-contract-standards refuses it) |

### The contract or its deployer

| # | Attack | What stops it | Shown on testnet | What is left |
|---|---|---|---|---|
| 11 | Redeploy different code, or sign as the contract account | The account's only key was deleted before the first mint, so no one can sign as it. Check 1 requires 0 access keys | `6FYx6hV5…` deleted the key | |
| 12 | Deploy code other than the published source | Check 1 requires the code hash to equal the one pinned in `web/src/lib/config.ts`, which comes from the reproducible CI build of `87148c6`. A global contract passes only if it is referenced by that same hash; one referenced by account is refused, since its owner could replace it. `check-claims.mjs` also checks that the NEP-330 metadata names that commit and the pinned image | `node scripts/check-claims.mjs` | Trust in the pinned Docker image |
| 13 | Initialize the contract first, with a fake MPC contract | `new` is `#[private]` and ran in the same transaction as the deploy. Check 1 requires `mpc_contract()` to be the canonical signer | `BeoXbii9…` refused: `Method new is private` | |
| 14 | Add an admin later | There is no admin and no upgrade method | | The chain list cannot change either: a new chain needs a new contract |

### The purchase

| # | Attack | What stops it | What is left |
|---|---|---|---|
| 15 | Two buyers race for the same satchel | The first `buy` removes the listing. The second panics with `token is not listed`, and NEAR refunds its deposit | |
| 16 | Underpay, or the seller buys their own listing | `buy` requires a deposit of at least the price and refuses the seller; any excess is refunded | |
| 17 | The seller's payment fails | The NFT moves in the same receipt; the payment is a transfer receipt. If the seller deleted their account, the transfer fails | The NEAR then stays in the contract, which has no admin to return it |

### The report

| # | Attack | What stops it | What is left |
|---|---|---|---|
| 18 | An EVM RPC lies about a nonce or an allowance | Reads are pinned to a finalized block; every EVM RPC must answer with the chain id it is configured for; the report names every RPC it used; `npm run verify` takes `NEAR_RPC` and `RPC_<chain id>` | No comparison of several RPCs and no storage proofs yet. A lying RPC you chose can make a satchel look clean |
| 19 | An RPC is down, or a chain is not configured | That check reads "unknown", never "pass", and the verdict becomes "could not check everything" | A satchel with history on a testnet that shuts down can never be provably clean again |
| 20 | A chain reorganizes after the nonce was read | Nonces and allowances are read at the chain's finalized block | |
| 21 | The hosted web app is changed to show a false report | Running the report from source with `npm run verify`, against RPCs you pick. The wallet shows the `buy` call and its deposit before you sign, so the price cannot change unseen. The record-version pin does not help here: the app chooses the version it passes | A buyer who trusts only the hosted page trusts whoever deploys it |
| 21a | The hosted web app builds a different call than it shows: another `sign_evm` transaction, another `nft_transfer` receiver | The wallet shows the method, its arguments and the deposit before the owner signs. The app is open source and built by Vercel from `main` | Owners who don't read the wallet's prompt trust the deployment. Wallet scripts load from their publishers' URLs (`wallet-manifest.json`), so a publisher can change them |
| 21b | A chain splits and both sides keep the same chain id | Nothing: an EIP-1559 signature is valid on any network with the chain id it names, and the report reads one RPC per chain id | A signature could be replayed on a fork the report does not read |

### Storage and spam

| # | Attack | What stops it |
|---|---|---|
| 22 | Grow a token's record until the contract runs out of storage | Each mint pays 0.1 NEAR, which covers 10 KB. Approvals are capped at 32 rows and chains at the 16 supported ids; everything past the cap is a counter. At the caps, with a listing, a record is about 8.5 KB by estimate; no test measures it yet |
| 23 | Ask for signatures on chains that do not exist yet | `SUPPORTED_CHAINS` is a fixed list; `sign_evm` refuses any other chain id |

## Out of scope

- **Powers built into an asset**: an upgradable token, a blacklist, an issuer's clawback, an ENS
  name whose controller is still the seller, an ERC-4907 user. The record proves what the token's
  key signed, not what the assets inside allow their issuers to do.
- **The MPC network's own security** and NEAR's consensus.
- **Wallets** that sign NEAR transactions for buyers and sellers.
- **Phishing**: a page that imitates satchelnft.xyz, or a different contract named "Satchel". The
  report reads only `v1.satchel-nft.testnet` and checks its code hash.

## Residual risks, in one list

1. MPC collusion, or an upgrade of the MPC contract (trusted).
2. A lying RPC that the reader chose (named in every report; replaceable).
3. Aurora's finality, read 10 blocks behind the block its RPC calls finalized (row 1).
4. A testnet that shuts down: a satchel with history there can never be provably clean again
   (row 19).
5. The hosted app and the wallet scripts it loads, for anyone who doesn't run the report themselves
   or read the wallet's prompt (rows 21, 21a).
6. A fork that keeps a chain id (row 21b).
7. The pinned Docker image behind the reproducible build (row 12).
8. Selector-based classification, if a contract gives a standard selector a non-standard meaning.
9. A seller's payment lost if they delete their account before it lands.
10. No admin, so stuck NEAR and the chain list cannot be changed.
11. Not audited. Two internal adversarial reviews found two ways to slip an approval past the first
    version of the record, then two smaller gaps in the fix. All four are fixed and covered by tests.
