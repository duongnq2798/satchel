# Changelog

All notable changes to Satchel. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- NEAR mainnet in the same web app. Pages under `/mainnet` read and sign on mainnet
  (`v1.satchel-nft.near`, MPC `v1.signer`, the same reproducible build as testnet); every other page
  stays on testnet. A switch in the header moves between them, and any link to the other side loads
  it as a new page. Every read, report, wallet connector and transaction takes its network
  explicitly, from the page's path, and each network remembers its own wallet. Each side sends only
  on its own chains, and connecting an account from the other network says so.
  `npm run verify -- --network mainnet <id>` reads mainnet.
- Documents for reviewers and AI agents:
  - `AGENTS.md`: how to check every claim, with commands and expected output, a map from each rule
    to its code and tests, and how to change the code.
  - `docs/THREAT_MODEL.md`: 26 attacks (the seller's, a buyer's, the deployer's, an RPC's, the
    hosted app's), what stops each one, the testnet transaction that shows it, and what is left.
  - `SECURITY.md`: how to report a vulnerability privately, what is in scope, and how a fix ships
    when the contract is locked.
- `scripts/check-claims.mjs`: checks the README's on-chain claims against NEAR testnet with Node 22
  and nothing else. Covers the lock, the code hash, the NEP-330 commit, the MPC signer, the
  deploy-and-init and lock transactions (in that order before the first mint, which returned token
  1), the four refused calls (each checked for its sender, method, arguments and error, with the
  buyer's refund and the transfer before the previous owner's call) and satchel #6's record at the
  refused buy's block, read from an archival node so later sales don't change the answer.
- The web app is hosted at <https://satchelnft.xyz> (Vercel, built from `main`, NEAR testnet); the
  README links it first.
- Demo satchels on testnet for what the report passes and what it catches: #1 provably clean after
  four Sepolia sends, #5 with a 10,000 ETH send signed and never broadcast, #3 with a live USDC
  approval to satchel #2's address, #4 provably clean and listed for 1 NEAR. Built by
  `tools/demo-gallery.mjs`, which records each step in `deployments/testnet-gallery.json`, a signed
  send before it broadcasts it, and resumes from there if a run stops partway. Satchel #2, the first
  pending example, was retired: its 0.01 ETH send could be pushed through by anyone who funded it.
- A new landing page. At the top, satchel #1's hand-over as a card, with its verdict checked live
  in your browser, the one address it holds on every chain, and the transfer and refused
  transactions. "Try to cheat the buyer" lets you pick one of six things a seller might do: four
  open a demo satchel left that way, with its report run live and the failing check picked out;
  two show a call the contract refused on chain. Then a sale step by step with the record beside
  it, a comparison with seed phrases and token-bound accounts, the verify command with real
  output, a link to every transaction behind a claim, a developers section, an FAQ and a footer.
  Each satchel's report is read once and shared across the page; satchel #4 shows what it costs
  and holds while it is for sale.
- Satchel #6 and two refused calls as evidence, built by `tools/demo-gallery.mjs`: #6 was listed,
  delisted, had a raw payload signed and was listed again, so it reads not provable; the owner of
  #4 calling `sign_evm` while it is listed is refused ("signing is frozen while the token is
  listed"), and a buyer calling `buy` on #6 with the record version from before the raw signature
  is refused ("the signing record changed since you checked it").
- `tools/lib.mjs`: the NEAR calls, MPC address derivation and `sign_evm` round trip shared by the
  testnet scripts.
- Token 1's open nonce-0 signature from the end-to-end run is spent: its current owner sent a
  Sepolia transaction at nonce 0 through `sign_evm`, and once that block was final the report reads
  provably clean. Evidence in `deployments/testnet-sepolia-send.json`.
- `web/`: a Next.js web app with no backend, on NEAR testnet. Connect a NEAR wallet (a pinned list
  through near-connect), mint a satchel, see its address and balances on 8 testnets, send from it
  through `sign_evm` (the app checks the contract's hash and recovers the MPC signature's signer
  before it broadcasts), list, delist, transfer and buy. Buying names the record version the report
  checked. Sends estimate gas, count the OP Stack L1 data fee toward what the satchel must hold, and
  keep the NEAR and EVM transaction links up if a later step fails.
- The clean transfer report, computed in the browser: the contract check (no keys, reproducible
  code hash, canonical MPC signer), pending signatures, approvals and counters, with each chain read
  at its finalized block. Anything unreadable is unknown, never a pass.
- `npm run verify -- <token_id>` in `web/`: the same report in a terminal, exit code 0 only when
  provably clean.
- CI for the web app: typecheck, unit tests and the production build.
- Deployed to NEAR testnet at `v1.satchel-nft.testnet` from the reproducible CI build of commit
  `87148c6` (code hash `94x4MmZKXGetffqJJVePLTdFkJvsmeXRLmi74Mdp2Lph`), initialized in the deploy
  transaction and locked by deleting its only key before the first mint. Record in
  `deployments/testnet.json`; end-to-end evidence in `deployments/testnet-e2e.json`.
- `contracts/satchel`: NEP-171 NFT contract where each token controls a secp256k1 key derived by
  NEAR's MPC network (Chain Signatures) from the contract's account and the path `satchel/<token_id>`.
  - `sign_evm` builds and hashes EIP-1559 transactions in the contract for 16 supported EVM chains,
    records the highest nonce signed per chain, and classifies every call: value transfer, asset
    transfer, itemized approval (ERC-20, ERC-721 per token id, operators, Permit2), revocation, or
    unclassified (counted).
  - `sign_raw` signs any 32-byte payload and counts it as opaque in the token's record.
  - `list`, `delist` and `buy`: a sale in NEAR. Signing is frozen while listed, and `buy` must name
    the record version and price the buyer checked.
  - Views for everything a buyer checks: `satchel`, `signing_record`, `listing`, `listings`,
    `derivation_path`, `mpc_contract`, `evm_signing_hash`.
  - Events: NEP-171 `nft_mint` / `nft_transfer`, and `satchel` events for signing and sales.
- Unit tests, with the EIP-1559 encoding checked against viem (`tools/gen-vectors.mjs`) and every
  selector checked against the keccak of its signature.
- CI: format, clippy, unit tests and the wasm build, plus a reproducible build in cargo-near's
  pinned Docker image that publishes the wasm and its code hash. It builds the branch commit, so the
  source commit the wasm records (NEP-330) stays on GitHub.
- The contract declares NEP-171, NEP-177, NEP-181 and NEP-297 in its NEP-330 source metadata.
- `tools/e2e-testnet.mjs`: an end-to-end check against the deployed contract and the real MPC
  network (mint, derive the address, sign a Sepolia transaction, recover the signer, transfer the
  NFT, refused calls), and a `send` mode that broadcasts a signed Sepolia transaction.

### Fixed

- The contract CI's build summary names the commit it built. On a pull request it printed GitHub's
  temporary merge commit, while the wasm records the branch commit.
- The landing page labels each refused call with who made it: the refused `buy` of satchel #6 was
  the buyer's call, but the page showed it as the seller's.
- Contract CI downloads the cargo-near 0.22.0 release binary itself, with retries, and checks it
  against the sha256 that cargo-near's own installer pins. GitHub's release downloads sometimes
  answered the runners with a 504: `curl | sh` then installed nothing and passed, the installer's own
  download does not retry, and building from crates.io needs libudev, which the runners lack. The
  build then failed later with `no such command: near`; now the install step fails on its own.
- The testnet scripts estimate gas for every Sepolia send from an address that can pay, instead of
  assuming 21000 for a plain one: sending to an address that has never been used now costs about
  205k (204,600 for the demo funding sends), and a 21000 limit reverted. `e2e-testnet.mjs send` and
  every send the gallery broadcasts also check the balance before signing, so a send the address can't
  pay for never leaves a signature open.
- The market shows "Couldn't check" for a listed satchel the contract no longer knows, instead of
  "Checking…" forever.

### Security

- From two internal reviews of mainnet (one adversarial, on the money path): the app signs nothing
  for a network's contract and shows no address derived from it until the contract passes its check
  (the account exists, runs the reproducible build, has no keys and signs through the canonical MPC
  contract), since until then the name could hold anyone's code; a transfer refuses a receiver that
  doesn't exist on the network, the contract's own account and the MPC contract, since the contract
  takes any name and an NFT sent to one is lost; a purchase refuses a report read on the other
  network; a send stops before signing when the chain's priority fee can't be read, instead of
  guessing a tip Polygon would refuse after the MPC signed; `npm run verify` checks that `NEAR_RPC`
  serves the network it reads and refuses `--network` values that aren't networks.
- Web app, from two internal reviews before release (one adversarial, on the report and the
  purchase): every EVM RPC must answer with the expected chain id before the report trusts it, and
  the report names the RPCs it read (`npm run verify` takes `NEAR_RPC` and `RPC_<chain id>` to use
  your own nodes); a purchase takes its record version and price only from the report the buyer
  read; buttons lock while a transaction is in flight, so a double click cannot sign the same nonce
  twice; a failed pending check no longer tells the buyer they can void the old signature, which is
  public and can be broadcast first; an ERC-721 approval cleared with `approve(0x0, id)` no longer
  reads as live; Aurora is read 10 blocks behind its "finalized" block, which is its latest.
- Fixed before release, from an internal adversarial review: ERC-721 approvals of different token
  ids no longer merge into one row; calls the contract cannot classify (multicall and others) are
  counted instead of passing silently; `new` is private; a listing made by the receiver of a bounced
  `nft_transfer_call` is voided; only listings whose seller still owns the token count.
- From the second review: a safe transfer with data, an ERC-1155 transfer of 0 and any batch
  transfer are unclassified, since the receiver's hook runs with data the signer chose; revocations
  no longer take approval slots.
