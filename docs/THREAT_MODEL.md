# Threat model

What Satchel protects, who might attack it, what stops each attack, and what is left. It covers the
contract (commit `87148c6`) deployed at `v1.satchel-nft.testnet` and at `v1.satchel-nft.near` on
mainnet, the clean transfer report and the transactions in the package `satchel-nft` (which the
web app runs on, and which is also a CLI), and the hosted app at <https://satchelnft.xyz>, with
its one server route, the holder room's `/api/room`. Every defense names the code that enforces it and, where one exists, the
transaction on testnet that shows it working.
[AGENTS.md](../AGENTS.md) has the commands to check them.

## What is protected

1. **Control of each token's address** on the 16 supported EVM chains, and whatever it holds there.
2. **The buyer's NEAR** during a purchase, and the seller's payment after one.
3. **The truth of the report.** A satchel reads "provably clean" only if nothing the token's key
   ever signed lets anyone but its owner move what it holds. Powers an asset's issuer builds into
   the asset are outside this (see Out of scope).
4. **The holder room's gate.** Only the account that owns a satchel at a final NEAR block opens its
   holder room. What the room shows is public, so the gate is what is protected, not the contents.

## Who might attack

| Actor | Wants |
|---|---|
| The seller, or any earlier owner | Keep some power over the wallet after selling it: a signed transaction, an approval, an off-chain permit, a key |
| Another buyer, or anyone on NEAR | Get a satchel without paying, or make a purchase go wrong |
| The deployer of the contract account | Change the code or sign around the record after people trust it |
| An RPC provider (NEAR or EVM) | Make an unclean satchel look clean, by lying about a nonce or an allowance |
| Whoever controls the hosted web app | Show a buyer a report that is not true |
| Anyone who isn't a satchel's holder: a former owner, a site the holder signed in to, someone who saw a signed proof | Open the satchel's holder room as its holder |

## What Satchel trusts

- **NEAR's consensus and runtime**, including that a `#[private]` method and a deleted key behave as
  specified.
- **NEAR's MPC network** (`v1.signer-prod.testnet` on testnet, `v1.signer` on mainnet). It signs for a key derived from the calling
  account and a path, and only when that account asks. If enough MPC nodes colluded, they could sign
  with any derived key; Satchel cannot detect that. The MPC contract can also be upgraded by a
  vote of its participants, which could change how keys are derived or who may ask for a
  signature.
- **Each EVM chain's finality.** Once a block is finalized, an address's nonce at that block cannot
  go back.
- **The pinned build image.** The reproducible build runs in
  `sourcescan/cargo-near:0.22.0-rust-1.99.1`, pinned by digest.
- **The RPCs the reader picks.** The report names them; `satchel-nft verify` can use your own.
- **The NEAR RPC behind the holder room.** `/api/room` reads the key and the owner from the
  network's FastNEAR node. It decides only who opens the room, which holds nothing secret (row 27).
- **FastNEAR's transaction index, for a satchel's history and a vote's signer.** The history on a satchel's page
  and from `satchel-nft history` lists the contract's transactions as `tx.test.fastnear.com` or
  `tx.main.fastnear.com` returns them. It keeps only events the Satchel contract logged in receipts
  that succeeded, but an index that leaves transactions out, or makes them up, changes what it
  shows. The report never reads it: it checks the signing record in the contract's state, and the
  page says so when the history counts a different number of signatures. Each line links its
  transaction, to check on an explorer. `satchel-nft dao finish` asks it only for a vote's signer,
  which `EXPERIMENTAL_tx_status` needs. The vote itself comes from the NEAR RPC, which must return
  that hash, and a wrong signer makes the read fail; what `dao finish` broadcasts is checked against
  the contract's hash and the satchel's address, not against the index.
- **The token list, for what a satchel's page says it holds.** USDC, USDT and WETH are read at the
  addresses that Circle, Tether, USDT0 or each chain lists, and WETH on Sepolia at the one Uniswap's
  deployment list names; `contents.ts` gives each source. A
  token at any other address, a look-alike included, isn't shown; each chain's explorer, linked
  from the page, shows everything. Nothing in the report depends on these balances.
- **The npm release, for anyone who runs `npx satchel-nft` instead of this repository's code.**
  Version 0.2.0 was published on 2026-11-10 from the owner's npm account and a clean Windows clone
  of commit `2dd4209`, which npm records as its `gitHead`, without npm provenance. Packing that
  commit on the same machine before the publish gave the same shasum,
  `b9822a7ac13476566bc6772ccda08979e5802480` (`npm view satchel-nft@0.2.0 dist.shasum`). On
  another machine, where the launcher's file mode can differ, compare files instead: unpack
  `npm pack satchel-nft@0.2.0`. Its files are LF. `bin/`, `package.json`, `README.md` and
  `LICENSE` are byte for byte the commit's, and `dist/`, the code the launcher runs, is byte for
  byte what `npm run build -w satchel-nft` builds from it. npm also lists 0.1.0 (2026-11-09, commit
  `728ed74`, packed with Windows line endings) and `0.0.0-stage`, a two-file, 333-byte "Temporary
  package placeholder for staged publishing" that npm made two minutes before 0.1.0. A later
  version holds whatever its publisher put in it: pin `@0.2.0` to run this one.

## Attacks and what stops them

### A seller keeps power over the wallet

| # | Attack | What stops it | Shown on testnet | What is left |
|---|---|---|---|---|
| 1 | Sign a withdrawal, sell, broadcast it after the sale | The contract builds every EVM transaction and records the highest nonce signed per chain **before** it asks the MPC network (`sign_evm`). Check 2 requires the address's nonce at a finalized block to be above it, so every signed transaction is either on chain or can never be. MPC signatures are public in NEAR receipts, so a buyer cannot void one after buying; the check has to pass before. A `sign` that timed out or looked failed can still produce a signature, since the nodes' answers are public too; the record counted it before the request either way | Satchel #5: a 10,000 ETH send signed and never broadcast reads `NOT PROVABLE` | A chain whose RPC reports a non-final block as finalized. Aurora's RPC does, so the report reads 10 blocks back there |
| 2 | Approve an address the seller controls to spend the wallet's tokens | `sign_evm` decodes ERC-20 `approve` / `increaseAllowance`, ERC-721 `approve`, `setApprovalForAll` and Permit2 `approve`, and itemizes each one. Check 3 reads each on chain at a finalized block: allowance 0, operator off, approval cleared. To clear them, the app's Make it clean card builds the revoke for each live row, `approve(spender, 0)`, `approve(0x0, id)`, `setApprovalForAll(operator, false)` or Permit2 `approve(token, spender, 0, 0)`, never `increaseAllowance` or `decreaseAllowance` (`fixPlan` in `packages/satchel-nft/src/clean.ts`, row 21i) | Satchel #3: an unlimited USDC approval reads `NOT PROVABLE` | Only 32 approvals are itemized per token; more are counted, and check 4 then fails. While check 4 passes, the card won't send a revoke that would be the 33rd row |
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
| 11 | Redeploy different code, or sign as the contract account | The account's only key was deleted before the first mint, so no one can sign as it. Check 1 requires 0 access keys | `6FYx6hV5…` deleted the key; on mainnet `Dw29Zbe…`, with `nft_total_supply()` 0 at that block | |
| 11a | Register the contract's name before it is deployed, or deploy other code there before it is locked, so the app hands out addresses that someone else's code signs for | The app signs nothing for a network's contract and shows no address derived from it until check 1 passes there: the account exists, runs the build, has no keys and signs through the canonical MPC contract (`assertDeployment` in `packages/satchel-nft/src/guard.ts`; the `satchel-nft` CLI runs it too). `tools/deploy-mainnet.sh` stops if a name exists without its key in the deployer's keychain | `node scripts/check-claims.mjs --network mainnet` | A new contract name (a `v2`) has the same window until it is locked; the app's check covers it |
| 12 | Deploy code other than the published source | Check 1 requires the code hash to equal the one pinned in `packages/satchel-nft/src/config.ts`, which comes from the reproducible CI build of `87148c6`. A global contract passes only if it is referenced by that same hash; one referenced by account is refused, since its owner could replace it. `check-claims.mjs` also checks that the NEP-330 metadata names that commit and the pinned image | `node scripts/check-claims.mjs`, and with `--network mainnet` | Trust in the pinned Docker image |
| 13 | Initialize the contract first, with a fake MPC contract | `new` is `#[private]` and ran in the same transaction as the deploy. Check 1 requires `mpc_contract()` to be the canonical signer | `BeoXbii9…` refused: `Method new is private` | |
| 14 | Add an admin later | There is no admin and no upgrade method | | The chain list cannot change either: a new chain needs a new contract |

### The purchase

| # | Attack | What stops it | What is left |
|---|---|---|---|
| 15 | Two buyers race for the same satchel | The first `buy` removes the listing. The second panics with `token is not listed`, and NEAR refunds its deposit | |
| 16 | Underpay, or the seller buys their own listing | `buy` requires a deposit of at least the price and refuses the seller; any excess is refunded | |
| 17 | The seller's payment fails | The NFT moves in the same receipt; the payment is a transfer receipt. If the seller deleted their account, the transfer fails | The NEAR then stays in the contract, which has no admin to return it |
| 17a | An owner transfers the NFT to a mistyped or unregistered name, which anyone could register later, or to a name no one can ever own | The app refuses a receiver that doesn't exist on the network, and the contract and MPC contract themselves (`assertReceiver` in `packages/satchel-nft/src/guard.ts`), and so does `satchel-nft transfer`. The contract takes any name | A transfer made another way, with the near CLI or another wallet, gets no such check |

### The report

| # | Attack | What stops it | What is left |
|---|---|---|---|
| 18 | An EVM RPC lies about a nonce or an allowance | Reads are pinned to a finalized block; every EVM RPC must answer with the chain id it is configured for; the report names every RPC it used; the `satchel-nft` CLI takes `NEAR_RPC` and `RPC_<chain id>` | No comparison of several RPCs and no storage proofs yet. A lying RPC you chose can make a satchel look clean |
| 19 | An RPC is down, or a chain is not configured | That check reads "unknown", never "pass", and the verdict becomes "could not check everything" | A satchel with history on a testnet that shuts down can never be provably clean again |
| 20 | A chain reorganizes after the nonce was read | Nonces and allowances are read at the chain's finalized block | |
| 21 | The hosted web app is changed to show a false report | Running the report from source with `satchel-nft verify`, against RPCs you pick. The wallet shows the `buy` call and its deposit before you sign, so the price cannot change unseen. The record-version pin does not help here: the app chooses the version it passes | A buyer who trusts only the hosted page trusts whoever deploys it |
| 21a | The hosted web app builds a different call than it shows: another `sign_evm` transaction, another `nft_transfer` receiver | The wallet shows the method, its arguments and the deposit before the owner signs. The app is open source and built by Vercel from `main` | Owners who don't read the wallet's prompt trust the deployment. Wallet scripts load from their publishers' URLs (`wallet-manifest.json`), so a publisher can change them |
| 21b | A chain splits and both sides keep the same chain id | Nothing: an EIP-1559 signature is valid on any network with the chain id it names, and the report reads one RPC per chain id | A signature could be replayed on a fork the report does not read |
| 21c | The app mixes networks: signs with an account, a report or a contract from the other network | The network comes from the page's path and is passed to every read and transaction. Wallet sessions and reports are kept per network; the wallet refuses an account from the other network and any receiver but that network's contract; `buy` refuses a report read on the other network; a link to the other network loads a new page | `assertTxFor` in `guard.ts`, tests in `guard.test.ts` and `web/src/lib/routes.test.ts` |
| 21d | The near CLI that `satchel-nft` signs with signs a different transaction than the one asked for, or a program planted as `near` runs instead | `satchel-nft` runs the near CLI by its absolute path: `--near-cli`, `$NEAR_CLI`, or `near` found in PATH's absolute folders only (given a bare name, Windows would run a `near.exe` from the current folder first), and names that path before you agree. It asks the near CLI only to sign (`display`), decodes the signed transaction, and compares its signer, receiver, method, arguments, gas and deposit with what it asked for. A difference, a second action, a V1 transaction, a byte order mark or trailing bytes stops it before anything is sent. It then shows the transaction and sends only after you type `yes`, or with `--yes`; input that ends before an answer is a no (`resolveNearCli`, `decodeSignedTx`, `assertSignedAsAsked` in `packages/satchel-nft/src/near-cli.ts`, tests in `near-cli.test.ts`) | A malicious `near` binary in a folder on your PATH has your key and can send anything by itself. The check catches a mismatched or mistaken one, not a hostile one |
| 21e | A NEAR RPC answers about another token, or reports a transaction as done before it is | The token view must name the id asked for and the path `satchel/<id>`, or nothing is built from it (`satchel(net).get`). An outcome counts only once its status is final, `SuccessValue` or `Failure` (`finished` in `near.ts`). A transaction the CLI sent but couldn't read back exits 3 with its hash, so a script doesn't send it twice (`OutcomeUnknown`) | |
| 21f | An EVM RPC inflates the fee or the nonce of a send from the CLI | Before you agree, the CLI shows the most the fees can reach and the nonce the contract will record; the balance must cover the value and those fees. A broadcast that may have gone through exits 3, with its hash and the nonce whose signature is now public | With `--yes`, nothing caps the fee or checks the nonce against the record, so a lying RPC can spend the balance on fees. Use your own node with `RPC_<chain id>`, or leave out `--yes` |
| 21g | A NEAR RPC answers with another key for a satchel, so its owner funds an address the attacker controls, or a report reads another address than the satchel's | The app, the CLI and the report don't ask. `deriveMpcKey` in `packages/satchel-nft/src/evm.ts` computes the key as the MPC contract does: the root key plus sha3-256 of a fixed prefix, the Satchel contract, a comma and the path, times the generator. The root key is pinned in `config.ts` (`mpcRootKey`). `evm.test.ts` derives the keys of the 9 satchels in its fixture (testnet #1 to #8, mainnet #1) and gets what `derived_public_key` returned for them, and `node scripts/check-claims.mjs` compares the pinned key with the MPC contract's `public_key` | Which satchel is yours still comes from the NEAR RPC: the id a mint returns, `nft_tokens_for_owner` and `owner_id`. A lying NEAR RPC (or wallet) can name a satchel someone else owns, and the app then shows that satchel's correct address as yours; read the id and the owner from your own node or an explorer before funding much. `satchel-nft` 0.1.0 reads the address itself through the NEAR RPC; 0.2.0 derives it. Nothing in the app compares the pinned root key with the chain: if the MPC network changed it, the app would show addresses it no longer signs for until a release pins the new one, and running `node scripts/check-claims.mjs` would show the mismatch. The MPC network is trusted (residual risk 1) |
| 21h | Someone changes a demo satchel whose state the README quotes (testnet #1 to #8, mainnet #1 and #2) before judging ends, so the README stops matching the chain | Until 2026-11-25, the app shows a note in place of its owner and buy actions on them: send, list, delist, transfer, buy and the Make it clean buttons (`isFrozen` in `web/src/lib/frozen.ts`, tests in `frozen.test.ts`). The holder room stays open | A guard in this app only, not a protection: the `satchel-nft` CLI, the near CLI and any other client can still sign for, list, buy or transfer them, and the contract has no such rule |
| 21i | The Make it clean card builds a fix that doesn't clear what it says, or one that makes the record worse | `fixPlan` in `packages/satchel-nft/src/clean.ts` decides from the report, the record and each chain's latest block, and `clean.test.ts` runs each call it builds through a model of the contract's classifier for those calls (`contractClass` in `clean.test.ts`). It never builds `increaseAllowance` or `decreaseAllowance`. An `approve` row that both the ERC-20 and the ERC-721 read find live, or a row it couldn't read, gets both calls and no button. While check 4 passes, it won't send a 33rd approval row, and before a revoke that takes a slot it reads the record again and refuses if it changed. A chain whose pending nonce read lags the report or the chain's latest block gets no sends, since a send there could sign at a nonce already spent. A nonce spend is a 0-value send to the satchel's own address with empty calldata, which the record never itemizes. Each fix runs through `sendFromSatchel`, with the same guards and wallet prompt as any send | The card reads each chain's latest block through one RPC, so a lying RPC can hide a live row, invent an open nonce or a live approval, or pick the wrong approve call; that costs the owner gas and can use up approval slots. The report, read at a finalized block, still decides the verdict. On a chain with open nonces, funding the address for the fixes also lets anyone broadcast what was signed at them first; the card says so |

### Storage and spam

| # | Attack | What stops it |
|---|---|---|
| 22 | Grow a token's record until the contract runs out of storage | Each mint pays 0.1 NEAR, which covers 10 KB. Approvals are capped at 32 rows and chains at the 16 supported ids; everything past the cap is a counter. At the caps, with a listing, a record is about 8.5 KB by estimate; no test measures it yet |
| 23 | Ask for signatures on chains that do not exist yet | `SUPPORTED_CHAINS` is a fixed list; `sign_evm` refuses any other chain id |

### The holder room

`/api/room` opens a satchel's holder room for its holder: their wallet signs a NEP-413 message, and
`checkHolder` in `packages/satchel-nft/src/holder.ts` checks the signature, then reads the key and
the owner at one final NEAR block, on every request. It stores nothing. The room shows only public
data, so these attacks are on the gate, not on a secret.

| # | Attack | What stops it | What is left |
|---|---|---|---|
| 24 | Replay a signed proof someone saw: on a shared screen, in a proxy's log, in a request copied from the browser | The server writes the message itself from the satchel id, the network, the contract, the account and the `Issued` time, so a proof opens only that one room. It is refused 5 minutes after `Issued`, or if `Issued` is more than 1 minute ahead of the server's clock (`ROOM_WINDOW_MS`, `ROOM_SKEW_MS`). The key and the owner are read again on every request. Tests in `holder.test.ts` | A captured proof opens the room until 5 minutes after its `Issued` time, which may be up to a minute ahead of the server's clock: up to 6 minutes in all, and only while that account still owns the satchel. No nonce is stored, so a second use within the window isn't refused; what it shows is public |
| 25 | Open the room with a function-call key: the login key a site adds to the holder's account at sign-in, which can sign NEP-413 messages too | `view_access_key` at the final block must answer `FullAccess`; any other permission, or no such key on the account, is a 403 (`accessKeyAt` in `near.ts`). Tests in `holder.test.ts` | A site that holds a full-access key of the holder's account (a wallet) can open the room, as it can do anything else as that account |
| 26 | Keep opening the room after a sale or a transfer, as the former holder | The owner comes from the contract's `satchel` view at the same final block as the key, on every request, and is never cached. The former holder gets a 403 that names the new owner. Tests in `holder.test.ts` | Reads are at a final block, a few seconds behind the chain's head: for those seconds after a sale, the former holder can still open the room |
| 27 | A NEAR RPC lies about the key or the owner | The server reads one NEAR RPC, FastNEAR's by default (`nearRpc` in `config.ts`). Every read is pinned to one block, and an answer that names another block is refused (502), as is a read with no answer in 10 s (`rpcFor` in `near.ts`). The satchel view must name the id and the path asked for | A lying RPC can open the room for someone who isn't the holder, or keep it shut for the holder. No second RPC is compared |
| 28 | Forge a signature, or reuse one the holder made for another site or message | ed25519, verified strictly (RFC 8032, no ZIP-215 leniency, `@noble/curves`), over sha256 of NEP-413's tag and the borsh payload the server builds itself, with the recipient `satchelnft.xyz`. A signature for another recipient, message, nonce or key doesn't verify, and only ed25519 keys are taken (`verifyNep413` in `nep413.ts`). `nep413.test.ts` checks the payload against two vectors near-cli-rs signed, an independent implementation | No rate limit: the route verifies a signature before it reads NEAR, but doesn't count requests. A DAO or multisig account can't sign a message, so its satchels' rooms stay closed |

## Out of scope

- **Powers built into an asset**: an upgradable token, a blacklist, an issuer's clawback, an ENS
  name whose controller is still the seller, an ERC-4907 user. The record proves what the token's
  key signed, not what the assets inside allow their issuers to do.
- **The MPC network's own security** and NEAR's consensus.
- **Wallets** that sign NEAR transactions for buyers and sellers.
- **Phishing**: a page that imitates satchelnft.xyz, or a different contract named "Satchel". The
  report reads only `v1.satchel-nft.testnet` or `v1.satchel-nft.near` and checks its code hash.

## Residual risks, in one list

1. MPC collusion, or an upgrade of the MPC contract (trusted).
2. A lying RPC that the reader chose (named in every report; replaceable).
3. Aurora's finality, read 10 blocks behind the block its RPC calls finalized (row 1).
4. A testnet that shuts down: a satchel with history there can never be provably clean again
   (row 19).
5. The hosted app and the wallet scripts it loads, for anyone who doesn't run the report themselves
   or read the wallet's prompt (rows 21, 21a). The app's guard on the demo satchels binds only the
   app (row 21h), and its Make it clean card trusts one RPC per chain for the latest block (row 21i).
6. A fork that keeps a chain id (row 21b).
7. The pinned Docker image behind the reproducible build (row 12).
8. Selector-based classification, if a contract gives a standard selector a non-standard meaning.
9. A seller's payment lost if they delete their account before it lands, and an NFT sent outside
   the app to a name that doesn't exist (row 17a).
10. No admin, so stuck NEAR and the chain list cannot be changed.
11. For a CLI send with `--yes`, the fee and the nonce read from one EVM RPC (row 21f). Which
    satchel is yours, read from one NEAR RPC (row 21g). A satchel's address itself no longer comes
    from an RPC, except in `satchel-nft` 0.1.0. The README, the docs and the app's holder room pin
    0.2.0; `handoverKit` in npm 0.2.0 still prints 0.1.0 commands, which 0.1.0 runs, until the next
    release.
12. The npm release, published without provenance: whoever holds the owner's npm account could
    publish a version that lies (trusted, above; the README pins 0.2.0).
13. The holder room: a captured proof opens it until 5 minutes after its `Issued` time (up to 6
    minutes, since `Issued` may run a minute ahead of the server's clock) while that account still
    owns the satchel, a former holder for the few seconds a final block lags a sale, and a lying NEAR
    RPC for anyone; nothing limits the rate of requests (rows 24 to 28). It holds nothing secret.
14. Not audited. Two internal adversarial reviews found two ways to slip an approval past the first
    version of the record, then two smaller gaps in the fix. All four are fixed and covered by tests.
    A third, of the `satchel-nft` CLI's signing, found no way to make it send another transaction
    than the one it shows. Of its findings on how it finds the near CLI, what it believes from an RPC
    and how it ends when an outcome is unknown, the one not fixed is row 21f; the address, which a
    NEAR RPC chose, is now derived locally (row 21g).
