# Changelog

All notable changes to Satchel. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- `contracts/satchel`: NEP-171 NFT contract where each token controls keys derived by NEAR's MPC
  network (Chain Signatures) from the contract's account and the path `satchel/<token_id>`.
  - `sign_evm` builds and hashes EIP-1559 transactions in the contract, records the highest nonce
    signed per chain, and itemizes ERC-20, ERC-721/1155 and Permit2 approvals before requesting
    the signature.
  - `sign_raw` signs any 32-byte payload and counts it as opaque in the token's record.
  - `list`, `delist` and `buy`: an atomic sale in NEAR. Signing is frozen while listed, and `buy`
    must name the record version and price the buyer checked.
  - Views for everything a buyer checks: `satchel`, `signing_record`, `listing`, `listings`,
    `derivation_path`, `evm_signing_hash`.
- Unit tests, with the EIP-1559 encoding checked against viem (`tools/evm-vectors`).
- CI: format, clippy, unit tests and the wasm build.
