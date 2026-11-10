# satchel-nft

[Satchel](https://satchelnft.xyz) is an NFT on NEAR that is a wallet: whoever owns satchel #N
controls one address on 16 EVM chains, through NEAR Chain Signatures. Selling the NFT sells the
wallet. Before you buy one, you want to know that the seller can't still move what's inside. This
package answers that question with the clean transfer report, and signs Satchel's transactions. The
web app at [satchelnft.xyz](https://satchelnft.xyz) runs on this same code.

It is a library and a command line tool. Node 22 or later; the library is an ES module.

> **Not audited.** A mainnet satchel holds real funds: keep in one only what you can afford to
> lose.

## Check a satchel before you buy it

```bash
npx satchel-nft verify --network mainnet 1
```

```text
Satchel #1 on v1.satchel-nft.near (mainnet)
owner satchel-nft.near, address 0xdC269Ead17B522d49db2ceFD38CEF0C5413868F9, record version 1

[PASS] The contract can't sign behind the record
       No access keys, so no one can redeploy it or sign as it
       Code hash 94x4MmZKXGetffqJJVePLTdFkJvsmeXRLmi74Mdp2Lph is the reproducible build of commit 87148c6
       Signs only through v1.signer

[PASS] No signed transaction is still pending
       Base: signed up to nonce 0, finalized nonce is 1

[PASS] No approval left behind
       No approval was ever signed for this token

[PASS] Nothing the record can't explain
       0 raw signatures, 0 unclassified calls, 0 approvals over the cap

PROVABLY CLEAN (checked 2026-11-09T15:10:40.555Z)
read from https://rpc.mainnet.fastnear.com, https://base-rpc.publicnode.com
```

It exits 0 only when the report reads `PROVABLY CLEAN`. No wallet and no keys: it reads NEAR and
each EVM chain the satchel's record lists, at a finalized block.

| Check | Passes when |
| --- | --- |
| The contract can't sign behind the record | The contract account has no access keys, its code hash is the reproducible build, and it signs only through the canonical Chain Signatures contract |
| No signed transaction is still pending | On every chain, the address's nonce at a finalized block is above the highest nonce the contract ever signed |
| No approval left behind | Every approval the contract signed reads as revoked on chain |
| Nothing the record can't explain | No raw signatures, no calls the contract couldn't classify, no approvals over the cap |

## Commands

```text
satchel-nft <command> [options]
```

| Command | What it does |
| --- | --- |
| `verify <id>` | The clean transfer report. Exits 0 only when it reads `PROVABLY CLEAN` |
| `show <id>` | Owner, address, listing, and what it holds on the network's EVM chains: the native coin, USDC, USDT and WETH |
| `history <id>` | Its mint, owners, signatures, listings and sales, each with its NEAR transaction, from FastNEAR's transaction index. The report doesn't use it |
| `record <id>` | The signing record, as the contract returns it |
| `market` | Every listing, with its report's verdict |
| `mint` | Mints a satchel for 0.1 NEAR |
| `list <id> <price>` | Lists it for `<price>` NEAR. It can't sign anything until it is sold or delisted |
| `delist <id>` | Takes it off the market |
| `buy <id>` | Buys it at its listed price, only if its report reads `PROVABLY CLEAN` |
| `transfer <id> <account>` | Gives it to another NEAR account |
| `send <id> --chain <chain> --to <0x address> --value <amount> [--data <0x calldata>]` | Sends from its address on one of the network's EVM chains |

| Option | |
| --- | --- |
| `--network testnet\|mainnet` | The NEAR network. Testnet unless you say mainnet |
| `--json` | Prints JSON, for scripts and bots. Errors print `{"error": "…"}` |
| `--as <account>` | The NEAR account that signs. Every sign command needs it |
| `--yes` | Signs without asking. Needed when there is no terminal to ask in |
| `--accept-not-clean` | Lets `buy` go ahead when the report does not read `PROVABLY CLEAN` |
| `--keychain legacy\|os` | Where the near CLI keeps the key: `~/.near-credentials` (the default) or the OS keychain |
| `--near-cli <path>` | The near CLI to sign with. Default: `$NEAR_CLI`, or `near` in one of your PATH's absolute folders, never the current folder. On Windows, give the path of `near.exe`: npm's `near.cmd` can't run without a shell |

A command refuses options that belong to another one, so `satchel-nft buy 4 --value 1` is an error,
not a purchase.

Exit codes: `0` done (for `verify`, clean); `1` the answer is no: not clean, refused, or failed on
chain; `2` it could not run: bad arguments, an RPC for the wrong network, no near CLI, no terminal
to ask in; `3` it sent a transaction but couldn't read what happened to it. On `3`, check the
transaction it names (with `--json`, `nearTx` or `evmTx`) before you run the command again.

## Signing

The sign commands use the [near CLI](https://github.com/near/near-cli-rs) (near-cli-rs), which keeps
your key. This package never reads a key. For each transaction it:

1. has the near CLI sign it without sending it (`display`), running it by its absolute path, which
   it shows you;
2. decodes what the near CLI signed and checks the signer, the receiver, the method, its arguments,
   the gas and the deposit against what you asked for, and refuses anything else;
3. shows you that transaction and asks `Send it? Type yes to send:`. Only `yes` sends it; anything
   else, or input that ends, is a no. `--yes` skips the question;
4. sends it over RPC and waits until every receipt is final.

Before signing, it also refuses what would fail or lose something: an account from the other
network, a satchel you don't own, a contract that doesn't pass its own check, a receiver that doesn't
exist, a purchase whose report isn't clean.

Listing satchel #7 on testnet, with its owner's key in `~/.near-credentials`. This run passed
`--yes`, since the shell it ran in had no terminal to ask in; without it, the question comes after
the transaction and before `Sending`. The output, with the home folder shortened to `<you>`:

```bash
npx satchel-nft list 7 0.5 --as satchel-nft.testnet
```

```text
The near CLI (C:\Users\<you>\.cargo\bin\near.exe) signed, on NEAR testnet, as satchel-nft.testnet (key ed25519:FqmLsnuhrwC7jFqzHCiNzUcZ6qQ1a23y4jasFJwRpS8w):
  v1.satchel-nft.testnet.list({"price":"500000000000000000000000","token_id":"7"})
  deposit 1 yoctoNEAR, gas 30 Tgas
  Lists satchel #7 for 0.5 NEAR at record version 1.
  It can't sign anything until it is sold, delisted or transferred.
Sending 6nsbk52HkRK7KV2SbcauHJxX84jaUm1WFsQMgmMrSSMc…
Listed satchel #7 for 0.5 NEAR: https://testnet.nearblocks.io/txns/6nsbk52HkRK7KV2SbcauHJxX84jaUm1WFsQMgmMrSSMc
```

Git Bash's own window (mintty) can give Node no terminal. If a sign command says there is none to
ask in, run it from PowerShell or cmd to be asked.

`send` builds the EVM transaction, checks that the contract hashes it the same way, has the near CLI
sign `sign_evm`, checks that the signature from the MPC network recovers to the satchel's address,
and broadcasts it:

```bash
npx satchel-nft send 7 --chain sepolia --to 0x000000000000000000000000000000000000dEaD --value 0.0001 --as satchel-nft.testnet
```

Once the contract has signed, the signature is public in its NEAR receipt, so anyone can broadcast
that transaction. If the broadcast or its receipt fails, `send` exits 3 with the transaction's hash
and its nonce: check it before you send again, or you may pay twice. Until a transaction at that
nonce is final, the satchel is not clean.

## Trust

The report is as honest as the RPCs it reads. The defaults are public nodes, named in every report.
To read from nodes you trust, set `NEAR_RPC=<url>` and `RPC_<chain id>=<url>`, like `RPC_8453` for
Base. A NEAR RPC that serves the other network stops the run; an EVM RPC that serves another chain
counts as unreadable, so the report can't read clean. A satchel's address comes from no RPC: the
package derives its key from the MPC network's root key, pinned in `TESTNET` and `MAINNET`, the
contract and the path, as the MPC contract's `derived_public_key` view does (0.1.0 still reads that
view through the NEAR RPC). Which satchel is yours, the id `mint` returns and each satchel's owner,
still comes from the NEAR RPC: before funding much, check the owner on NearBlocks or your own node.
A send's fees and nonce come from the chain's RPC. The prompt shows both before you agree; with
`--yes`, nothing caps the fees.

What a report can't see, and every attack it is built against, is in the repository's
[threat model](https://github.com/duongnq2798/satchel/blob/main/docs/THREAT_MODEL.md).

## Library

```ts
import { MAINNET, buildReport } from "satchel-nft";

const report = await buildReport(MAINNET, "1");
if (report?.verdict === "clean") {
  // report.listing.record_version is what a purchase must name
}
```

| Export | What it is |
| --- | --- |
| `TESTNET`, `MAINNET`, `CHAINS` | Each network's contract, MPC contract and its root key (not in 0.1.0), NEAR RPC and reproducible build; the 16 EVM chains |
| `buildReport(net, id)` | The clean transfer report for one satchel, or `null` if there is none |
| `contractFacts(net)` | The deployment's own facts, to share across many reports |
| `satchel(net)` | Reads: `get`, `tokensFor`, `listings` (one page, which can be short with more after it), `allListings` (every live listing; not in 0.1.0), `totalSupply`, `mpcContract`, `signingHash` |
| `satchelTx(net)` | Transactions in the near-connect and wallet-selector format: `mint`, `list`, `delist`, `buy`, `transfer`, `signEvm` |
| `tokenAddress(net, path)` | A satchel's EVM address: the key the MPC network derives for it, computed from the pinned root key without a read (0.1.0 reads it from the MPC contract) |
| `deriveMpcKey(rootKey, predecessor, path)` | The key the MPC network holds for `path` when `predecessor` asks, as `derived_public_key` returns it (not in 0.1.0) |
| `sendFromSatchel(request, deps)` | The send flow, with each step's check, for any wallet you pass in `deps` |
| `assertDeployment(net)`, `assertReceiver(net, account)` | The checks the app and the CLI run before signing |
| `checkHolder(net, proof)`, `roomMessage(net, id, account, issuedAt)` | The holder room's gate: whether a signed NEP-413 proof comes from a full-access key of the account that owns the satchel at a final NEAR block, and the message it must sign (not in 0.1.0) |
| `verifyNep413(signed)`, `nep413Hash(payload)` | NEP-413 message signatures: the hash a wallet signs, and a strict ed25519 check of one (not in 0.1.0) |
| `handoverKit(report)` | What to do before selling a satchel, one step per check of its report that doesn't pass (not in 0.1.0) |

## Links

- App: [satchelnft.xyz](https://satchelnft.xyz)
- Repository, contract and every claim with the command that checks it:
  [github.com/duongnq2798/satchel](https://github.com/duongnq2798/satchel)
- License: MIT
