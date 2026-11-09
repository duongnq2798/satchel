# Satchel

**An NFT that is a wallet on every EVM chain. Transfer the NFT, transfer the keys, and check on
chain what the seller could have kept back.**

Satchel is a NEAR NFT contract (NEP-171). Every token controls a secp256k1 key that NEAR's MPC
network derives from the contract's account and the token's path (Chain Signatures). The token's
owner, and only the owner, can have the contract sign with that key, so one token is the same
address on Ethereum, Base, Arbitrum, OP, Polygon, BNB Chain, Avalanche and Aurora, mainnets and
testnets. Give the NFT away, sell it or leave it to someone, and control of that address on every
one of those chains moves with it in one NEAR transaction.

**Try it: <https://satchelnft.xyz>** (NEAR testnet and Sepolia; reading needs no wallet).

> **Status: in development for the NEAR Hackathon 2026 (1–14 Nov 2026).** The contract is live on
> NEAR testnet at [`v1.satchel-nft.testnet`](#live-on-testnet): built reproducibly, locked (no
> access keys), and checked end to end against NEAR's MPC network. The [web app](#web-app), hosted
> at [satchelnft.xyz](https://satchelnft.xyz), mints, sends through the MPC network, lists and buys,
> and computes the clean transfer report in your browser. Five
> [demo satchels](#see-it-catch-a-dirty-wallet) show what the report passes and what it catches,
> and two refused calls show what the contract stops. Not on mainnet yet, not audited. This section
> is updated as each piece lands.

**Checking the claims?** Start with [AGENTS.md](AGENTS.md). `node scripts/check-claims.mjs` checks
the deployment and its history against NEAR testnet in a few seconds, with no install and no
wallet. [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) lists each attack and what stops it;
[SECURITY.md](SECURITY.md) says how to report one.

## See it catch a dirty wallet

Five satchels on testnet show what the report catches and what the contract refuses. Open
<https://satchelnft.xyz/#examples>: under "Try to cheat the buyer", pick what the seller does. Four
of the six moves open a satchel left that way, with its report run in your browser; the other two
show a call the contract refused on chain. Or read any of them from a terminal, with no wallet and
no key (Node 22 or later):

```bash
cd web
npm ci
npm run verify -- 5
```

You should see `[FAIL] A signed transaction may still be pending` and the verdict `NOT PROVABLE`,
with exit code 1. Run it for each of the five:

| Satchel | What its owner did | `npm run verify -- <id>` prints |
|---|---|---|
| #1 | Sent four transactions on Sepolia from it, all on chain (one reverted, which still spends its nonce) | `PROVABLY CLEAN`, exit 0 |
| #5 | Had a 10,000 ETH send signed for it and never broadcast it | `[FAIL] A signed transaction may still be pending`, `NOT PROVABLE`, exit 1 |
| #3 | Approved satchel #2's address, which the same seller owns, to spend its USDC without limit | `[FAIL] An approval is still live`, `NOT PROVABLE`, exit 1 |
| #6 | Listed, delisted, had a raw 32-byte payload signed, then listed again | `[FAIL] The record can't explain everything signed`, `NOT PROVABLE`, exit 1 |
| #4 | Nothing: it holds 0.002 Sepolia ETH, never signed anything, and is listed for 1 NEAR | `PROVABLY CLEAN`, exit 0, and `listed by satchel-nft.testnet` |

The contract refused two moves outright, and both refusals are on chain:

| Move | Call | The contract's answer |
|---|---|---|
| Sign while it's listed | the owner of #4 calls `sign_evm` | [`Satchel: signing is frozen while the token is listed`](https://testnet.nearblocks.io/txns/5ZaKqJUxEUauvpENMMp4KQoCwWRNqmAyHskpTF6Axft8) |
| Change it after the buyer checked | a buyer calls `buy` on #6 naming record version 0, the version before the raw signature | [`Satchel: the signing record changed since you checked it`](https://testnet.nearblocks.io/txns/7HQPu9qeJauNrJLaMNCUuMJVska3u3uYsoGyp7gsCfWv), and the buyer keeps the 1 NEAR |

Satchel #4 can be bought from [its page](https://satchelnft.xyz/satchel/4) with any testnet NEAR
wallet. If someone has bought it by the time you look, it reads `PROVABLY CLEAN` without the
listing line. For about 13 minutes after a satchel sends on Sepolia, its report says
`COULD NOT CHECK EVERYTHING` until that block is final.
[How they were built](#the-demo-satchels).

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

The record is in [`deployments/testnet.json`](deployments/testnet.json). To check all of this
table, and the refused calls below, with nothing but Node 22:

```bash
node scripts/check-claims.mjs
```

You should see `11 of 11 claims hold` and exit code 0. [AGENTS.md](AGENTS.md#1-the-deployment-and-its-history-one-command)
lists what each line reads. To check the first row of the
[clean-transfer table](#when-is-a-transfer-provably-clean) with the near CLI instead:

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
the evidence file. While it was open, anyone holding it could broadcast it once the address was
funded, so the report for token 1 said **not provable**: Sepolia's nonce for the address was 0 and
the record's `max_nonce` was 0. A buyer cannot count on voiding such a signature with a transaction
of their own: it is public in the NEAR receipt, so a seller can broadcast it the moment the address
is funded. That is why the check has to pass before a sale, not after.

Then the address was funded, and its current owner sent a transaction at nonce 0 through
`sign_evm` (evidence in [`deployments/testnet-sepolia-send.json`](deployments/testnet-sepolia-send.json)):

| Step | Result | Transaction |
|---|---|---|
| `sign_evm` by `buyer.satchel-nft.testnet`, Sepolia, nonce 0 | record version 3, `max_nonce` still 0 | [`27myw3U1…`](https://testnet.nearblocks.io/txns/27myw3U1iMmPvvGajeao1mqPaoqKu3C6SJQt7VL6FRCd) |
| broadcast on Sepolia | 1 wei to `0x…dEaD`, success, block 12094728 | [`0x43c37e67…`](https://sepolia.etherscan.io/tx/0x43c37e67eed3c849acfc4b3f525a762d9c862c9fec017b0391c49ee2f89d6965) |

Right after the broadcast the report said "could not confirm": the nonce was spent, but only in a
block Sepolia had not finalized. Once that block was final, the address's nonce (1) was above every
nonce ever signed for it (0), so every earlier signature was spent or void, and token 1 reads
**provably clean**.

To run it yourself, put two testnet accounts in the legacy keychain (`~/.near-credentials`) and:

```bash
cd tools
npm ci
SATCHEL_OWNER=<your-account>.testnet SATCHEL_BUYER=<second-account>.testnet node e2e-testnet.mjs
```

You should see `E2E PASS`. To broadcast for real, fund the token's address on Sepolia, then run
`node e2e-testnet.mjs send <token_id> <owner-account>`; it prints the Etherscan link. Set
`NEAR_CLI` if `near` is not on your `PATH`.

### The demo satchels

[`tools/demo-gallery.mjs`](tools/demo-gallery.mjs) built satchels #2 to #6, with satchel #1
paying for gas from its own address through `sign_evm` (evidence in
[`deployments/testnet-gallery.json`](deployments/testnet-gallery.json)):

| Satchel | Step | Transaction |
|---|---|---|
| #2 | `mint` | [`8UH5zpRj…`](https://testnet.nearblocks.io/txns/8UH5zpRjnpCYriKEGoyaPtt3vgqZh943uTma372dEBtT) |
| #2 | `sign_evm`: 0.01 ETH to `0x…dEaD` at nonce 0, never broadcast | [`DSqPLcxY…`](https://testnet.nearblocks.io/txns/DSqPLcxYVGq83S84L9HndBtCm2iMaQ92V6DVXHzWj384) |
| #5 | `mint` | [`Mo94fZuP…`](https://testnet.nearblocks.io/txns/Mo94fZuPy4FPPgvqro4MJvnbsWj5T63BSpqnLBSsf6K) |
| #5 | `sign_evm`: 10,000 ETH to `0x…dEaD` at nonce 0, never broadcast | [`G66SfkVz…`](https://testnet.nearblocks.io/txns/G66SfkVz9dbf4AeJam5jiLnZNmZGAAYpaLgDWPCa5Ga7) |
| #3 | `mint` | [`DfQFCpaX…`](https://testnet.nearblocks.io/txns/DfQFCpaXZmPhJu4fr5J6Ltbg42f97wtTLActAWaVSMhw) |
| #3 | satchel #1 sends it 0.002 ETH | [`8UgtBF6o…`](https://testnet.nearblocks.io/txns/8UgtBF6ohTDPRXpArSNkYZhpYf8v79adJpFdbThuwfyw), [`0xa30cd13c…`](https://sepolia.etherscan.io/tx/0xa30cd13cfb833fad2c4bcb6898a50405047e86a32af66c2348af0dfced6c6a51) |
| #3 | USDC `approve(satchel #2's address, max)`, on chain | [`VCULtPKm…`](https://testnet.nearblocks.io/txns/VCULtPKmd1TpD4Bu9N87dMVwXecxjUsBG6CnG5kdW4C), [`0x56b2735c…`](https://sepolia.etherscan.io/tx/0x56b2735c807429a1f6fc9bb35b63736500bc716accd1fbb213be8b3d17b94169) |
| #4 | `mint` | [`5C2zzM8K…`](https://testnet.nearblocks.io/txns/5C2zzM8KCP5o5RZNtPmXbAiZJ57pGR8KCAHjq7PqQW2c) |
| #4 | satchel #1 sends it 0.002 ETH | [`5VibfT9k…`](https://testnet.nearblocks.io/txns/5VibfT9ktSxgdau9gw4nJHtjZhUxvS9RMAsEj6zNjFLV), [`0x62b36999…`](https://sepolia.etherscan.io/tx/0x62b36999636a2fc63931f2fa57b997d2a51c4b165d2e64d15c75243b19e64380) |
| #4 | `list` for 1 NEAR | [`7Q9WxuJ4…`](https://testnet.nearblocks.io/txns/7Q9WxuJ4yfQcsRBgUzWJ37gQxrgZxjWJauz1r4QeXfe6) |
| #4 | `sign_evm` while listed, refused | [`5ZaKqJUx…`](https://testnet.nearblocks.io/txns/5ZaKqJUxEUauvpENMMp4KQoCwWRNqmAyHskpTF6Axft8) |
| #6 | `mint` | [`DEhXxjHy…`](https://testnet.nearblocks.io/txns/DEhXxjHy7sCte6tPM43rVJhH1eMACD4K1GYaygpr8HaL) |
| #6 | `list` for 1 NEAR at record version 0 | [`GoSfXxf7…`](https://testnet.nearblocks.io/txns/GoSfXxf7pgpb8fNCCbiFuxpT6gAYt5LW3Ve49R4oBL3z) |
| #6 | `delist` | [`8X7vStD8…`](https://testnet.nearblocks.io/txns/8X7vStD8r1AwVqdJfDkhsfiKoj8v5KJubXrhBdtJ35M) |
| #6 | `sign_raw`: a 32-byte hash, `0x5a09ef56…` | [`4J8Y6WSP…`](https://testnet.nearblocks.io/txns/4J8Y6WSPpW5d8pH6PpBGnC5NDVvuAKLzaDSYwRs1kwzB) |
| #6 | `list` again for 1 NEAR, now at record version 1 | [`6UNoo28p…`](https://testnet.nearblocks.io/txns/6UNoo28pdrTjDJbnREPLe8k4JNW1xpGVHKwHyZeUzdxG) |
| #6 | `buy` naming record version 0, refused | [`7HQPu9qe…`](https://testnet.nearblocks.io/txns/7HQPu9qeJauNrJLaMNCUuMJVska3u3uYsoGyp7gsCfWv) |

One send went wrong and stays in the record. The first run gave satchel #1's send to #3 a gas limit
of 21000, and it [reverted](https://sepolia.etherscan.io/tx/0x362be7cbacc888a7fa9ef121db57163828b298ff5910a193a88ee06178ef073f):
Sepolia now charges about 205k gas to send to an address that has never been used (the sends that
funded #3 and #4 used 204,600). A reverted transaction still spends its nonce, so satchel #1 stayed
provably clean. The scripts now estimate gas for every send from an address that can pay, as the
web app always has. A signature for an address that holds nothing yet, which no node can estimate,
uses 21000 gas and always goes to `0x…dEaD`, an address already in use, where 21000 is enough.

Satchel #2 was the first pending example and still reads `NOT PROVABLE`, but it was retired from the
gallery: its signed send is only 0.01 ETH, so anyone who sends its address about 0.0101 ETH can
broadcast that signature and make it clean. Satchel #5's 10,000 ETH send stays open. Two entries in
the evidence file were written by hand from the run log, `retiredPending` and #3's
`revertedFunding`; the script records every other step itself. One more call failed and is not in
the file: the first `sign_raw` for #6 passed the payload without its `0x` prefix, the contract
refused it (`Satchel: payload must start with 0x`) and nothing changed, so the script retried with
the prefix.

To build your own set, with the two accounts from the end-to-end run in your keychain and the
second one owning a satchel with Sepolia ETH (`SATCHEL_FUNDER=<its id>`):

```bash
cd tools
npm ci
SATCHEL_OWNER=<your-account>.testnet SATCHEL_BUYER=<second-account>.testnet SATCHEL_FUNDER=<id> node demo-gallery.mjs --out gallery.json
```

You should see `GALLERY PASS` and four new token ids. The script writes each step to `--out` as it
goes, a signed send before it broadcasts it, so a run that stops partway resumes from there with the
same `--out`, without minting or signing again.

## Web app

[`web/`](web) is a Next.js app with no backend, hosted at <https://satchelnft.xyz> (Vercel, built
from `main`, on NEAR testnet). Every read goes from your browser to a public NEAR RPC and to each
EVM chain's public RPC; every write is a transaction your NEAR wallet signs.

| Page | What you can do there |
|---|---|
| `/` | What Satchel is: satchel #1's hand-over with its verdict checked live, facts about the deployment (contract keys, chains, MPC signer, supply), "Try to cheat the buyer" with the [demo satchels](#see-it-catch-a-dirty-wallet) and the refused calls, a sale step by step, a comparison with seed phrases and token-bound accounts, and a link to every transaction behind a claim |
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

To run it yourself:

1. Install and start it. Node 22 or later.

   ```bash
   cd web
   npm ci
   npm run dev
   ```

2. Open <http://localhost:3000>. The card at the top should read "Provably clean" for satchel #1.
   Under "Try to cheat the buyer", "Play fair" shows #1 with all four checks passing; "Keep a signed
   withdrawal", "Leave an approval behind" and "Sign a raw payload" show #5, #3 and #6 "Not
   provable", each with the failing check picked out; the last two moves show the contract's refusal.
   Below them, #4 is for sale for 1 NEAR. Open <http://localhost:3000/satchel/1> for the full
   report: all four checks pass, for the reason [above](#end-to-end-run).

3. Get the same report without a browser:

   ```bash
   npm run verify -- 1
   ```

   It prints each check, the verdict (`PROVABLY CLEAN` for token 1) and the RPCs it read from, and
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

[docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) goes through each attack (the seller's, a buyer's, the
deployer's, an RPC's), what stops it, the transaction on testnet that shows it, and what is left.

## Other project by the same builder

Under the NEAR Hackathon 2026 rules, one person may enter two independent projects if each README
names the other. The other entry is **Probarion**, a mandate layer for AI agents on NEAR:
<https://github.com/probarion/probarion>. The two projects share no code.

## License

MIT
