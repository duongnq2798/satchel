# Satchel

**An NFT that is a wallet on every EVM chain. Transfer the NFT, transfer the keys, and check on
chain what the seller could have kept back.**

Satchel is a NEAR NFT contract (NEP-171). Every token controls a secp256k1 key that NEAR's MPC
network derives from the contract's account and the token's path (Chain Signatures). The token's
owner, and only the owner, can have the contract sign with that key, so one token is the same
address on Ethereum, Base, Arbitrum, OP, Polygon, BNB Chain, Avalanche and Aurora, mainnets and
testnets. Give the NFT away, sell it or leave it to someone, and control of that address on every
one of those chains moves with it in one NEAR transaction.

> **Status: in development for the NEAR Hackathon 2026 (1–14 Nov 2026).** The contract and its unit
> tests are in this repository. Not deployed yet, no web app yet, not audited.
> This section is updated as each piece lands.

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

A buyer (or the Satchel web app, when it ships) can call a token provably clean only when all of
these hold:

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

- **EIP-1559 encoding against an independent implementation.** `tools/evm-vectors/gen.mjs` uses
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
- Not audited. Two internal adversarial reviews found two ways to slip an approval past the first
  version of the record, then two smaller gaps in the fix; all four are fixed and covered by the
  tests above.

## Other project by the same builder

Under the NEAR Hackathon 2026 rules, one person may enter two independent projects if each README
names the other. The other entry is **Probarion**, a mandate layer for AI agents on NEAR:
<https://github.com/probarion/probarion>. The two projects share no code.

## License

MIT
