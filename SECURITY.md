# Security

Satchel is a hackathon project, live on NEAR testnet and NEAR mainnet. It has not been audited. A
mainnet satchel's address holds real funds on eight EVM chains: keep in one only what you can afford
to lose. A testnet satchel signs through NEAR's testnet MPC network, whose keys are not meant to hold
value: never send real funds to its address on a mainnet chain.

## Reporting a vulnerability

Please report it privately. On GitHub, open this repository's **Security** tab and choose
**Report a vulnerability**, or go to <https://github.com/duongnq2798/satchel/security/advisories/new>.
Don't open a public issue for anything that could be used against a satchel or a buyer.

Include:

- what an attacker can do, and to whom (a seller, a buyer, any holder);
- the steps, or a transaction on testnet that shows it;
- which part it touches: the contract, the report (web app or `npm run verify`), or the scripts in
  `tools/`.

The answer comes on the private advisory thread. Once a fix is ready, the report is published as a
GitHub security advisory and the change is listed in [CHANGELOG.md](CHANGELOG.md) under Security,
with credit unless you ask for none. There is no bug bounty.

## What is in scope

| Part | Where | What counts |
|---|---|---|
| The contract | `contracts/satchel`, deployed at `v1.satchel-nft.testnet` and `v1.satchel-nft.near` | Signing without being the owner; signing anything the record does not show; a `buy` that completes against a record version or price the buyer did not name; losing a buyer's or seller's NEAR |
| The clean transfer report | `web/src/lib`, `web/scripts/verify.ts` | A satchel reported "provably clean" while someone other than its owner can still move what it holds |
| The web app | `web/`, <https://satchelnft.xyz> | Sending, signing or buying something other than what the user confirmed |
| Scripts | `scripts/`, `tools/` | Leaking a key, or signing with one the user did not choose |

[docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) lists the attacks already considered, and the risks
that are known and accepted. A report that one of those defenses does not hold is in scope. A report
that a known residual risk exists is not, unless it shows a cheaper way to exploit it.

Out of scope: NEAR's MPC network and consensus, public RPC providers, wallets, and powers that an
asset's issuer builds into the asset itself.

## How a fix ships

The deployed contract is locked: it has no access keys and no admin, so it cannot be patched in
place. A contract fix ships as a new contract account (for example `v2.satchel-nft.testnet` and
`v2.satchel-nft.near`) built reproducibly in CI. The web app and the report then point to it, and the README says what changed
for satchels on the old contract. A fix to the report or the web app ships to
<https://satchelnft.xyz> when it is merged to `main`.
