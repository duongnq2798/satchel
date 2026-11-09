# Satchel

**An NFT that is a wallet on every chain. Transfer the NFT, transfer the keys, and prove the seller kept nothing back.**

Satchel is a NEAR NFT contract (NEP-171). Every token controls keys that NEAR's MPC network derives
from the contract's account and the token's path (Chain Signatures). The token's owner, and only the
owner, can have the contract sign with those keys, so the same token is an address on Ethereum, Base,
Arbitrum and any other chain those keys work on. Give the NFT away, sell it or leave it to someone,
and control of every one of those addresses moves with it in one NEAR transaction.

> **Status: in development for the NEAR Hackathon 2026 (1–14 Nov 2026).** The contract and its unit
> tests are in this repository. Not deployed yet, no web app yet, not audited.
> This section is updated as each piece lands.

## The problem it solves

Selling a wallet is easy to fake. The seller signs a withdrawal, sells the wallet, then broadcasts the
withdrawal and empties it. Token-bound accounts on a single chain have the same hole. Nobody can buy a
wallet, a position or an address with history unless they can rule that out.

Satchel rules it out on chain:

1. **The contract builds every EVM transaction it signs.** The owner sends the fields
   (`chain_id`, `nonce`, fees, `to`, `value`, `data`); the contract RLP-encodes and hashes them
   itself (EIP-1559), so it knows exactly what it signed.
2. **It keeps a public signing record per token:** the highest nonce it ever signed on each chain,
   written *before* the signature is requested. A buyer reads the record and the address's nonce on
   each chain. If the on-chain nonce is above the highest signed nonce, every signature the seller
   holds is already used or can never execute.
3. **It itemizes every approval it signs.** A mined `approve` leaves a standing right that no nonce
   check can see: the seller could approve their own address, sell, then pull the tokens. Because the
   contract builds the transaction, it decodes ERC-20 `approve` and `increaseAllowance`, ERC-721/1155
   `setApprovalForAll` and Permit2 `approve`, and records the chain, contract and spender. The buyer
   checks that each one is revoked on chain before buying.
4. **Raw signatures are allowed but visible.** `sign_raw` signs any 32-byte payload (a Bitcoin
   sighash, a message), and the record counts it as *opaque*, because no buyer can rule it out.
5. **Listing freezes signing, and `buy` pins what the buyer checked.** `buy` names the record version
   and price the buyer verified; if the seller delisted, signed and relisted in between, the purchase
   fails. The NFT and the seller's payment move in the same receipt.

## Contract interface

| Method | Who | Deposit | What it does |
|---|---|---|---|
| `new(mpc_contract)` | deployer | | `v1.signer-prod.testnet` or `v1.signer`. No admin, nothing to change later |
| `mint(receiver_id?)` | anyone | 0.1 NEAR (excess refunded) | New token; its path is `satchel/<token_id>` |
| `sign_evm(token_id, tx)` | owner | 1 yocto, ≥ 50 TGas | Builds and hashes the EIP-1559 tx, records `(chain_id, nonce)`, returns the MPC signature |
| `sign_raw(token_id, payload)` | owner | 1 yocto, ≥ 50 TGas | Signs 32 bytes, counted as opaque |
| `list(token_id, price)` / `delist(token_id)` | owner | 1 yocto | Sale in NEAR; signing frozen while listed |
| `buy(token_id, record_version, price)` | anyone but the seller | ≥ price (excess refunded) | Atomic sale |
| `nft_transfer`, `nft_transfer_call`, enumeration, metadata | NEP-171/177/181 | | A transfer ends any listing |
| `satchel(token_id)`, `signing_record`, `listing`, `listings`, `derivation_path`, `evm_signing_hash(tx)` | views | | Everything a buyer needs to check |

Events use NEP-297 with standard `satchel`: `sign_evm`, `sign_raw`, `list`, `delist`, `sale`, next to
the NFT standard's `nft_mint` and `nft_transfer`.

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

The EIP-1559 encoding is checked against [viem](https://viem.sh) as an independent reference:
`tools/evm-vectors/gen.mjs` writes `contracts/satchel/src/evm_vectors.json`, and the unit test
`evm_hash_and_rlp_match_viem_for_every_vector` compares the contract's RLP and hash with each case
(nonce 0, single-byte values, the 0x80 boundary, ERC-20 calldata, maximum values with 600 bytes of data).

## Limits, stated plainly

- **The contract account must hold no access keys.** The MPC network derives each token's key from
  the contract's account and the path, so a full-access key on that account could call the MPC
  contract directly and sign for every token. The deployed account is locked after deployment (no
  keys, no upgrades), and the buyer's check reads its key list.
- The clean-transfer check covers EVM transactions built by `sign_evm`: pending signatures (nonces) and
  the four approval calls above. Rights granted through other contract calls (adding an owner to a
  Safe, say) are not decoded. Opaque signatures are counted, not explained.
- The MPC network signs; Satchel cannot sign without it. If a request fails, the record still shows
  the nonce, which makes the record stricter, never looser.
- One token keeps records for at most 16 EVM chains and itemizes 32 distinct approvals; approvals
  past that are counted in `approvals_not_itemized`.
- Not audited.

## Other project by the same builder

Under the NEAR Hackathon 2026 rules, one person may enter two independent projects if each README
names the other. The other entry is **Probarion**, a mandate layer for AI agents on NEAR:
<https://github.com/probarion/probarion>. The two projects share no code.

## License

MIT
