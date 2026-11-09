# Satchel

**An NFT that is a wallet on every EVM chain. Transfer the NFT, transfer the keys, and check on
chain what the seller could have kept back.**

Satchel is a NEAR NFT contract (NEP-171). Every token controls a secp256k1 key that NEAR's MPC
network derives from the contract's account and the token's path (Chain Signatures). The token's
owner, and only the owner, can have the contract sign with that key, so one token is the same
address on Ethereum, Base, Arbitrum, OP, Polygon, BNB Chain, Avalanche and Aurora, mainnets and
testnets. Give the NFT away, sell it or leave it to someone, and control of that address on every
one of those chains moves with it in one NEAR transaction.

> **Status: in development for the NEAR Hackathon 2026 (1–14 Nov 2026).** The contract is live on
> NEAR testnet at [`v1.satchel-nft.testnet`](#live-on-testnet): built reproducibly, locked (no
> access keys), and checked end to end against NEAR's MPC network. The [web app](#web-app) mints,
> sends through the MPC network, lists and buys, and computes the clean transfer report in your
> browser; it runs locally and is not hosted yet. Not on mainnet yet, not audited. This section is
> updated as each piece lands.

## The problem it solves

Selling a wallet is easy to fake. The seller signs a withdrawal, sells the wallet, then broadcasts
the withdrawal and empties it. Or the seller approves their own address to spend the wallet's
tokens, sells, and pulls the tokens afterwards. Token-bound accounts on a single chain have the same
holes. Nobody can safely buy a wallet, a position or an address with history unless they can rule
those out.

Satchel keeps a public, on-chain **signing record** for every token, so a buyer can check:

1. **The contract builds every EVM transaction it signs.** The owner sends the fields (`chain_id`,
   `nonce`, fees, `to`, `value`, `data`); the contract RLP-encodes and hashes them itself
   (EIP-1559), so it knows exactly what it signed. The record holds the highest nonce signed on each
   chain, written *before* the signature is requested.
2. **It classifies every call.** Each `sign_evm` call is exactly one of:
   - a **value transfer** (empty calldata);
   - an **asset transfer**: ERC-20 `transfer`/`transferFrom`, ERC-721 `transferFrom` and
     `safeTransferFrom` with no data, ERC-1155 `safeTransferFrom` with a non-zero amount and no
     data, WETH `deposit`/`withdraw`. A safe transfer *with* data runs the receiver's hook with data
     the signer chose, so it is not counted as plain;
   - an **approval**, decoded and itemized: ERC-20 `approve` and `increaseAllowance`, ERC-721
     `approve` (each token id its own row), `setApprovalForAll`, Permit2 `approve`;
   - a **revocation** that grants nothing (`setApprovalForAll(x, false)`, `increaseAllowance(x, 0)`,
     Permit2 `approve` of 0), logged but not itemized, so cleaning up before a sale never fills the
     approval list;
   - **anything else** (a multicall, a swap, `transferOwnership`…), counted in
     `unclassified_calls`. Satchel cannot see what such a call left behind, so it does not pretend to.
3. **Raw signatures are allowed but counted.** `sign_raw` signs any 32-byte payload (a Bitcoin
   sighash, a message) and the record counts it in `opaque_signatures`.
4. **Listing freezes signing, and `buy` pins what the buyer checked.** `buy` names the record version
   and price the buyer verified; if the seller delisted, signed and relisted in between, the purchase
   fails.

### When is a transfer provably clean?

A buyer (or the [Satchel web app](#web-app), which runs these checks) can call a token provably
clean only when all of these hold:

| Check | How |
|---|---|
| The contract account cannot sign behind the record | No access keys on the account; code hash equals the reproducible build; not a global contract referenced by account ID; `mpc_contract()` is the canonical signer (`v1.signer` / `v1.signer-prod.testnet`) |
| No pending signed transaction | For every chain in `record.evm`, the address's nonce at a **finalized** block is above `max_nonce` |
| No approval left behind | Every row in `record.approvals` is revoked on chain: allowance 0, operator off, Permit2 allowance 0. An `Approve` row can be ERC-20 or ERC-721; ask the contract (ERC-165) and check `allowance` or `getApproved(arg)` |
| Nothing the record cannot explain | `opaque_signatures`, `approvals_not_itemized` and `unclassified_calls` are all 0 |

If any of them fails, the honest answer is "not provable", with the reason. Many wallets will be
used for swaps and DeFi and will not be provably clean; the record says so instead of hiding it.

**What the record cannot cover:** powers built into an asset itself, which need no signature from
the wallet. A token the seller deployed or can upgrade, a token with a blacklist or clawback, an ENS
name whose registry controller is still the seller, an ERC-4907 `user`. The record proves what the
token's key signed; it says nothing about what the assets inside allow their issuers to do. Value
the assets as you would anywhere else.

## Contract interface

| Method | Who | Deposit | What it does |
|---|---|---|---|
| `new(mpc_contract)` | the contract account itself (`#[private]`) | | Run in the same transaction as the deploy. No admin, nothing to change later |
| `mint(receiver_id?)` | anyone | 0.1 NEAR (excess refunded) | New token; its path is `satchel/<token_id>` |
| `sign_evm(token_id, tx)` | owner | 1 yocto, ≥ 50 TGas | Builds and hashes the EIP-1559 tx, updates the record, returns the MPC signature |
| `sign_raw(token_id, payload)` | owner | 1 yocto, ≥ 50 TGas | Signs 32 bytes, counted as opaque |
| `list(token_id, price)` / `delist(token_id)` | owner | 1 yocto | Sale in NEAR; signing frozen while listed |
| `buy(token_id, record_version, price)` | anyone but the seller | ≥ price (excess refunded) | Moves the token in this receipt and sends the seller's payment as a transfer receipt |
| `nft_transfer`, `nft_transfer_call`, enumeration, metadata | NEP-171/177/181 | | A transfer ends any listing |
| `satchel(token_id)`, `signing_record`, `listing`, `listings`, `derivation_path`, `mpc_contract`, `evm_signing_hash(tx)` | views | | Everything a buyer needs to check |

Supported chain IDs (`SUPPORTED_CHAINS`): 1, 11155111, 8453, 84532, 42161, 421614, 10, 11155420, 137,
80002, 56, 97, 43114, 43113, 1313161554, 1313161555. A fixed list keeps every record checkable and
rules out signatures for chains that do not exist yet.

Events: NEP-171 `nft_mint` and `nft_transfer`, plus NEP-297 events with standard `satchel`:
`sign_evm` (with the call's class, decoded approval, selector and calldata hash), `sign_raw`,
`list`, `delist`, `sale`.

## Live on testnet

| | |
|---|---|
| Contract | [`v1.satchel-nft.testnet`](https://testnet.nearblocks.io/address/v1.satchel-nft.testnet) |
| MPC signer | `v1.signer-prod.testnet` (Chain Signatures) |
| Source | commit [`87148c6`](https://github.com/duongnq2798/satchel/tree/87148c6b6f97f3121cac13c93e22d7d153453b53), recorded in the wasm's NEP-330 metadata |
| Code hash | `94x4MmZKXGetffqJJVePLTdFkJvsmeXRLmi74Mdp2Lph`, the wasm from the [reproducible CI build](https://github.com/duongnq2798/satchel/actions/runs/42547394040) (artifact `satchel-reproducible-wasm`) |
| Deploy and `new` | one transaction, so nobody could initialize it first: [`7pocx72c…`](https://testnet.nearblocks.io/txns/7pocx72c1bcDbNehTG32T18ukjR82byP3PfF9vmX44Uk) |
| Locked | its only key deleted in [`6FYx6hV5…`](https://testnet.nearblocks.io/txns/6FYx6hV5PRCfaUd6t4VEkz1bfkknxN8ymyw4nSP6YgAK), before the first mint. No one can redeploy it or sign as it |

The record is in [`deployments/testnet.json`](deployments/testnet.json). To check the first row of
the [clean-transfer table](#when-is-a-transfer-provably-clean) yourself:

1. List the contract's keys. You should see an empty table.

   ```bash
   near account list-keys v1.satchel-nft.testnet network-config testnet now
   ```

2. Read its source metadata. You should see the commit above and the pinned Docker image.

   ```bash
   near contract call-function as-read-only v1.satchel-nft.testnet contract_source_metadata json-args '{}' network-config testnet now
   ```

3. Compare code hashes. Download the artifact from the CI run, then run
   `node scripts/code-hash.mjs satchel.wasm`; it should print the code hash above, and so should
   the `code_hash` field of the account:

   ```bash
   curl -s https://rpc.testnet.fastnear.com -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_account","finality":"final","account_id":"v1.satchel-nft.testnet"}}'
   ```

### End-to-end run

[`tools/e2e-testnet.mjs`](tools/e2e-testnet.mjs) runs the whole path against the live contract and
the real MPC network. Its last run (evidence in
[`deployments/testnet-e2e.json`](deployments/testnet-e2e.json)):

| Step | Result | Transaction |
|---|---|---|
| `mint` as `satchel-nft.testnet` | token `1`, path `satchel/1`, address `0x96DA1468E95Ab31A698891f0150095f86b5a282B` (from `derived_public_key` on the MPC contract) | [`3kBMVhva…`](https://testnet.nearblocks.io/txns/3kBMVhva8pagScLwGJDNwF6Bfbzno9LxAVN5JKENvPxo) |
| `sign_evm`, Sepolia, nonce 0 | the contract's hash equals viem's; the MPC signature recovers to the token's address | [`EZLXcvf4…`](https://testnet.nearblocks.io/txns/EZLXcvf43jqHYFUJm7gt3Ris5yM1Ru2FPihiEqJW1GUo) |
| `signing_record` | Sepolia `max_nonce` 0, version 1 | view |
| `nft_transfer` to `buyer.satchel-nft.testnet` | | [`3sLuGS9p…`](https://testnet.nearblocks.io/txns/3sLuGS9pEnvURpha3QQBtumExxKC2f3GMJSRaccvNBwB) |
| `sign_evm` by the previous owner | refused: "only the token's owner can do this" | [`GqFsnmFL…`](https://testnet.nearblocks.io/txns/GqFsnmFLcpDjJVC1b4qUPYxHRTP1Rw2vcVKxga3PVRvU) |
| `sign_evm` by the buyer | recovers to the same address | [`9GYTuZJo…`](https://testnet.nearblocks.io/txns/9GYTuZJoQAKcYib8NCEKXtcqDkRjGfy9nLavajkGaLnM) |
| `new` from another account | refused: "Method new is private" | [`BeoXbii9…`](https://testnet.nearblocks.io/txns/BeoXbii9WeodnG2XZarxZidtvqS6RzzA9KNqJnZRLrWv) |

**This run also shows the record catching what it exists for.** The first owner's nonce-0
signature was never broadcast (the address held no Sepolia ETH), and the signed transaction is in
the evidence file. Anyone holding it can still broadcast it once the address is funded, so token 1
is **not** provably clean yet: Sepolia's nonce for the address is 0 and the record's `max_nonce` is
0. It passes that check once any transaction at nonce 0 is final on Sepolia, the old one included.
A buyer cannot count on voiding it with a transaction of their own: the old signature is public in
the NEAR receipt, so the seller can broadcast it the moment the address is funded. That is why the
check has to pass before a sale, not after.

To run it yourself, put two testnet accounts in the legacy keychain (`~/.near-credentials`) and:

```bash
cd tools
npm ci
SATCHEL_OWNER=<your-account>.testnet SATCHEL_BUYER=<second-account>.testnet node e2e-testnet.mjs
```

You should see `E2E PASS`. To broadcast for real, fund the token's address on Sepolia, then run
`node e2e-testnet.mjs send <token_id> <owner-account>`; it prints the Etherscan link. Set
`NEAR_CLI` if `near` is not on your `PATH`.

## Web app

[`web/`](web) is a Next.js app with no backend. Every read goes from your browser to a public NEAR
RPC and to each EVM chain's public RPC; every write is a transaction your NEAR wallet signs.

| Page | What you can do there |
|---|---|
| `/` | What Satchel is, and live facts about the deployment: contract keys, code hash, MPC signer, supply |
| `/satchels` | Connect a NEAR wallet, mint a satchel for 0.1 NEAR, see the ones you own |
| `/satchel/<id>` | The token's address, its balance on the 8 testnets, the clean transfer report; as owner, send from the address, list, delist or transfer the NFT; as a buyer, buy |
| `/market` | The listed satchels, each with its price and the verdict of its report |
| `/verify` | Enter a token id and read its report, no wallet needed |

**The report** runs the four checks of the [clean-transfer table](#when-is-a-transfer-provably-clean)
against NEAR and every chain the record lists. Each chain is read at its own finalized block
(Aurora's RPC calls its latest block finalized, so the app reads 10 blocks back there). A check
that cannot be read (an RPC down, a chain the app does not know, an RPC serving the wrong chain) is
shown as unknown, never as a pass, and the verdict is "Provably clean" only when all four pass.

**Buying** takes the record version and the price from the report you read, not from the rest of
the page. If the seller delists, signs and relists before your transaction lands, the contract
refuses the sale and you keep your NEAR. A satchel that is not provably clean can still be bought,
after you tick a box that says so.

**Sending** from a satchel: pick a testnet, a recipient and an amount (or raw calldata, under
Advanced). The app estimates gas, reads the nonce and fees, checks that the contract hashes the same
transaction, has your wallet call `sign_evm`, recovers the signer from the MPC signature, and only
then broadcasts. It stops before your wallet opens if the address cannot pay the value plus the
most the fees can reach (on OP Sepolia and Base Sepolia, the L1 data fee included), and shows that
fee while your wallet asks.

**Wallets.** The app lists a pinned set of NEAR wallets. On testnet that is Meteor, Intear,
Nightly, Ledger and NEAR CLI.

To run it:

1. Install and start it. Node 22 or later.

   ```bash
   cd web
   npm ci
   npm run dev
   ```

2. Open <http://localhost:3000/satchel/1>. You should see satchel #1's address, its testnet
   balances and its report: three checks pass and "No signed transaction is still pending" fails,
   for the reason [above](#end-to-end-run).

3. Get the same report without a browser:

   ```bash
   npm run verify -- 1
   ```

   It prints each check, the verdict (`NOT PROVABLE` for token 1) and the RPCs it read from, and
   exits 0 only when the satchel is provably clean.

4. Read from nodes you trust. The report is only as honest as its RPCs: one that lies about a
   nonce or an allowance could make a satchel look clean. The app names the public RPCs it used
   under every report; the CLI can use your own instead:

   ```bash
   NEAR_RPC=https://<your-near-testnet-node> RPC_11155111=https://<your-sepolia-node> npm run verify -- 1
   ```

   `RPC_<chain id>` works for each of the 16 chains. The app also checks that every EVM RPC
   answers with the chain id it expects.

`npm test` runs the unit tests: the address derivation and the full signing round trip against
the real `sign_evm` result from the E2E run (same hash, same signer, same raw transaction byte for
byte), each check and the verdict order, every approval kind (a cleared ERC-721 approval included),
and every guard in the send flow.
`npm run typecheck` and `npm run build` are the other two steps CI runs.

## Build and test

Rust 1.99.1 (pinned in `rust-toolchain.toml`) and cargo-near 0.22.0.

```bash
cd contracts/satchel
cargo test                                   # unit tests
cargo near build non-reproducible-wasm       # target/near/satchel.wasm
```

On Windows, set `AWS_LC_SYS_PREBUILT_NASM=1` first: a dependency of near-sdk's test runtime builds
`aws-lc-sys`, which otherwise needs NASM. Also add `--no-abi` to the build: the ABI step links a host
DLL against NEAR host functions, which MSVC refuses. CI builds with the ABI on Linux.

What the tests pin down:

- **EIP-1559 encoding against an independent implementation.** `tools/gen-vectors.mjs` uses
  [viem](https://viem.sh) to write `contracts/satchel/src/evm_vectors.json`; the test
  `evm_hash_and_rlp_match_viem_for_every_vector` compares the contract's RLP and hash for nonce 0,
  single-byte values, the 0x80 boundary, ERC-20 calldata, and maximum values with 600 bytes of data.
- **Every selector is the keccak of its signature**, computed in the test, so a typo cannot hide.
- **The attacks the record exists for:** ERC-721 approvals of two token ids stay two rows; a
  `multicall` is counted as unclassified; a safe transfer with data, an ERC-1155 transfer of 0 and
  a batch transfer are unclassified; revocations never take an approval slot; a seller who delists, signs and relists cannot complete a
  sale against the version the buyer checked; a bounced `nft_transfer_call` voids the listing the
  receiver made while holding the token; a previous owner cannot sign after a transfer.

## Limits, stated plainly

- **Calls are classified by selector**, assuming the called contract gives that selector its
  standard meaning. A call runs with the wallet as sender only in the contract it calls; anything
  that contract calls next sees the contract as sender, and can use only rights the wallet gave it,
  which the approval check covers. Safe-transfer hooks are the exception, which is why a safe
  transfer only counts as plain with empty data.
- **secp256k1 only** (MPC domain 0): EVM chains through `sign_evm`, Bitcoin and anything else only
  through `sign_raw`, which is opaque. No Ed25519 chains (Solana, NEAR) yet.
- **The MPC network signs**; Satchel cannot sign without it. If a request fails, the record still
  shows the nonce, which makes the record stricter, never looser.
- **Per-token limits are permanent.** 32 approvals are itemized; more are only counted. Any owner can
  make a token unprovable for every later owner, and the record shows it.
- **The chain list is fixed.** There is no admin, so `SUPPORTED_CHAINS` cannot gain a new chain or
  drop a testnet that shuts down. A new chain needs a new contract.
- **The seller's payment can fail** if the seller deletes their account before it lands; the NEAR then
  stays in the contract, which has no admin to return it.
- `listings` pages can shift between calls, because removing a listing moves the last one into its slot.
- **The web app trusts the RPCs it reads.** The checks are only as true as the answers of one public
  RPC per chain and one NEAR RPC. The report names them, and `npm run verify` can read from your own
  nodes instead. It does not yet compare two RPCs or check storage proofs.
- Not audited. Two internal adversarial reviews found two ways to slip an approval past the first
  version of the record, then two smaller gaps in the fix; all four are fixed and covered by the
  tests above.

## Other project by the same builder

Under the NEAR Hackathon 2026 rules, one person may enter two independent projects if each README
names the other. The other entry is **Probarion**, a mandate layer for AI agents on NEAR:
<https://github.com/probarion/probarion>. The two projects share no code.

## License

MIT
