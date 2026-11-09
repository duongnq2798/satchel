# Changelog

All notable changes to Satchel. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- `contracts/satchel`: NEP-171 NFT contract where each token controls a secp256k1 key derived by
  NEAR's MPC network (Chain Signatures) from the contract's account and the path `satchel/<token_id>`.
  - `sign_evm` builds and hashes EIP-1559 transactions in the contract for 16 supported EVM chains,
    records the highest nonce signed per chain, and classifies every call: value transfer, asset
    transfer, itemized approval (ERC-20, ERC-721 per token id, operators, Permit2), or unclassified
    (counted).
  - `sign_raw` signs any 32-byte payload and counts it as opaque in the token's record.
  - `list`, `delist` and `buy`: a sale in NEAR. Signing is frozen while listed, and `buy` must name
    the record version and price the buyer checked.
  - Views for everything a buyer checks: `satchel`, `signing_record`, `listing`, `listings`,
    `derivation_path`, `mpc_contract`, `evm_signing_hash`.
  - Events: NEP-171 `nft_mint` / `nft_transfer`, and `satchel` events for signing and sales.
- Unit tests, with the EIP-1559 encoding checked against viem (`tools/evm-vectors`) and every
  selector checked against the keccak of its signature.
- CI: format, clippy, unit tests and the wasm build.

### Security

- Fixed before release, from an internal adversarial review: ERC-721 approvals of different token
  ids no longer merge into one row; calls the contract cannot classify (multicall and others) are
  counted instead of passing silently; `new` is private; a listing made by the receiver of a bounced
  `nft_transfer_call` is voided; only listings whose seller still owns the token count.
