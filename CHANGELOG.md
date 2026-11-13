# Changelog

All notable changes to Satchel. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- The landing page's opening section now says who a satchel is for (an address that must keep
  receiving after a sale, such as a royalty receiver a contract fixes, a DAO treasury or an estate)
  and why it runs on NEAR (no one holds the key; NEAR's MPC network signs only when the contract
  asks, and the contract asks only for the token's owner), and links the 2-minute demo on X. Its
  mainnet line now says what happened there: satchel #2 holds USDC from a NEAR Intents 1Click swap,
  and #3 was listed and bought end to end, a self-sale between two of the builder's accounts. Under
  it, "Check it in three minutes" gives three steps: try to cheat a buyer (about 30 s, no wallet),
  read the mainnet sale's deed (about 1 min), and run `npx -y satchel-nft@0.2.0 verify --network mainnet 3`,
  with a button that copies it (about 30 s). The deed section below states the self-sale in its
  eyebrow and in the deed's declaration, no longer a third time in between, and the verify page's
  pick for mainnet #3 now says it was a self-sale, not a market price. "A satchel" says no one holds
  a key to copy; in "Why not just…" Satchel's answer on a signature from before the sale says a
  signed transaction works only until its nonce is spent, and that check 2 shows before you pay
  whether one is still pending. Chain counts on the landing page now say how many are mainnets: 8
  EVM mainnets and their testnets, or 16 EVM chains (8 mainnets and their testnets).
- "Try to cheat the buyer" on the landing page stamps each verdict the way the deed of sale does.
  When a report arrives, a stamp presses in beside the panel's title, or under it on a phone:
  **Provably clean** in green or **Not provable** in amber, with the record version the report
  read; the two refused moves are stamped **Refused** in red. A report that couldn't settle keeps
  its badge. A stamp presses in again each time a move is picked, waits below the window until it
  scrolls into view, and under reduced motion is simply there. Screen readers hear the verdict as
  before, and now the record version too. The pictures of the section in the README and the docs tutorial are
  re-taken. In the landing's short deed, each step's time line now breaks only after its "·".
- Mainnet satchel #3's sale as a deed of sale on the site. Right below the landing page's opening
  section, a short deed: the self-sale stated next to the headline and in a box of its own, the
  buyer's check, the buy and the refused call with their stamps and seal, and a ruler of the six
  steps across 3 min 16 s. `/mainnet` gives #3 a wide card and its showcase now reads "Three
  satchels on mainnet", since #3 sent nothing; `/mainnet/satchel/3#deed` has the full deed, clause by
  clause, under the live report. Every fact on it is in `showcase.ts`, and its test compares each
  one with `deployments/mainnet-sale.json`. The deed's styles and its italic font load only on the
  landing, `/mainnet` and the mainnet satchel pages, its stamps are drawn in place without JavaScript or with reduced motion, and
  its text meets the site's AAA contrast.
- Mainnet satchel #3 was sold on 2026-11-13. `satchel-nft.near` minted it and listed it for
  0.1 NEAR, the buyer's report read `PROVABLY CLEAN` before the buy, `duongnq2798.near` bought it
  in the app naming record version 0 and `satchel-nft.near` was paid, then `satchel-nft.near`'s
  `sign_evm` for it was refused by the owner check. A self-sale: both accounts are the builder's,
  and the owner signed every transaction. `deployments/mainnet-sale.json` holds the transactions
  and both reports, and `node scripts/check-claims.mjs --network mainnet` checks 20 claims, up
  from 15. The README's first use case now ran on both networks. The verify page offers mainnet #3
  among its demo satchels, and until 2026-11-25 the app's guard on them covers it, as do the
  demo guards in `tools/oneclick-exit.mjs` and `tools/mainnet-sale-record.mjs gate`.
- "Use cases you can run" in the README: nine uses that ran on chain (selling a wallet, catching a
  seller, cleaning before a sale, a swap into its own address, a DAO treasury, bounties with earned
  trust, an heir, what came in, a holder's room), each with a page to open and a command that checks
  it. `node scripts/check-use-cases.mjs` runs every check in one go, shares one `check-claims.mjs`
  run per network, runs a check once more a minute later when its only failures were nodes not
  answering, and says which cases hold, haven't run yet or were skipped; `--list` runs nothing.
  The docs' use cases page gains an estate with check-ins and a waiting period, and a section on
  paying contributors from a DAO's treasury.
- The estate ran on testnet: `satchel-estate-1112.testnet`, deployed from the CI's reproducible
  build and locked, held satchel #11 for `buyer.satchel-nft.testnet` with a 3-minute interval and a
  5-minute waiting period. An early approval was refused; both guardians approved and the owner
  cancelled by checking in; they approved again, an early finalize and a forged callback were
  refused, and the heir finalized and received the satchel, which reads `PROVABLY CLEAN` for them.
  The old owner's `sign_evm` through the estate was then refused. `deployments/testnet-estate.json`
  holds every transaction; `node scripts/check-estate.mjs` checks 14 claims.
- A testnet bounty board run on a Sputnik DAO, `satchel-bounty.sputnikv2.testnet`, whose treasury
  owned satchel #10, with no contract change. Its policy, set at creation, is the tiers: one council
  vote passes a `BountyDone`, two of three pass anything else, and a `trusted` role may pass a
  `BountyDone` with its own vote and nothing else (quorum 1 everywhere). The contributor's first
  bounty, 0.5 NEAR, was paid on one council vote; a vote citing it added them to `trusted`; their
  second, 0.2 NEAR, was paid on their own vote. A 2-of-3 vote had #10 pay them on Sepolia, a 1 NEAR
  transfer was voted down, and once the send was final a vote gave them #10 itself.
  `tools/dao-bounty-run.mjs` ran it step by step; `deployments/testnet-dao-bounty.json` holds every
  transaction, and `node scripts/check-dao-bounty.mjs` checks 14 claims and prints the board.
- A public bounty board for any Sputnik DAO at `/dao/<account>` (and `/mainnet/dao/<account>`), read
  live with no wallet. It shows the DAO's roles and its approval tiers in words, from its policy
  (each role's vote rule for each proposal kind); open bounties and their claims; finished bounties
  with their `BountyDone` proposal, voters, roles and payout; each contributor's record, every line
  traced to a proposal, with role changes; and the satchels the DAO owns, with each `sign_evm` and
  `nft_transfer` it voted. A satchel the DAO gave away shows on the receiver's record, among their
  payouts but not in their totals. A `BountyDone` filed by
  someone other than the contributor is marked as such, a proposal whose voting period is over reads
  so, and amounts are exact. Each card fails on its own. A satchel owned by a Sputnik DAO links its
  board. In the package, `sputnikDao` gains readers for the DAO's config, version, proposals,
  bounties and claims, and the transaction index reader is shared.
- `contracts/estate`, a testnet demo contract that owns one satchel and hands it to a named heir
  when its owner stops checking in. Once the owner is overdue, guardians approve a release; the
  approval that reaches the threshold starts a waiting period the owner can cancel by checking in
  (a `sign_evm` through the estate counts as one), and after it anyone can finalize: the estate
  sends the satchel to the heir with `nft_transfer` and records the release only if the transfer
  succeeded. The Satchel contract is unchanged. CI tests the crate and builds it reproducibly;
  `tools/estate-run.mjs` runs it on testnet with timers in minutes, and `scripts/check-estate.mjs`
  checks that run on chain. Not deployed yet, and not audited.

- `tools/mainnet-sale-record.mjs`, which recorded mainnet satchel #3's sale (above). It signs
  nothing and holds no key. `gate` says when the buyer owns the satchel at a final block and it
  isn't listed, and refuses the demo satchels. `find-refused` finds the old owner's failed
  `sign_evm` in FastNEAR's index, since the near CLI prints no hash for a failed call. `check` reads
  every step back from NEAR and the EVM chain, and `record` writes `deployments/mainnet-sale.json`
  only if each step holds and both of the buyer's saved reports (before the buy, after the refusal)
  read `PROVABLY CLEAN`. `scripts/check-claims.mjs` gains a group of 5 claims for that file, or 7
  with a send before the sale, active only once it exists.
- A **Received** card on the satchel page. It lists the USDC, USDT and WETH sent to the satchel's
  address since the network's contract was created, read from each chain's Transfer logs, with a
  total per token and chain and a link to each transaction. Each chain shows as soon as it has been
  read, a node that has lost the start of a chain's logs shows that chain as unread, and a failed
  range shows as a gap. Display only: the report doesn't read it. Mainnet satchel #2 shows the
  5.280549 USDC it received on Arbitrum One. `scripts/check-scan-start.mjs`, read-only, checks the
  card's start blocks against each contract's creation and each chain's first Transfer.
- The README opens with "Satchel in 60 seconds": three satchels to open with no wallet (testnet #5
  reads not provable, testnet #9 after Make it clean, mainnet #2 after its 1Click swap) and the
  claim checker. "Why it is different" now says what it is measured against: handing over a seed
  phrase. The README's link row adds the demo video.

- `scripts/a11y-audit.mjs` audits each app route on sample satchels (testnet #4, #5 and #9, mainnet
  #2, two holder rooms and the 404 page), light only and with no wallet connected, and every docs
  page in both themes; it doesn't open the owner panels, the wallet dialog or the docs search. It
  runs axe-core 4.13's stable rules (WCAG A, AA, AAA and best practices, not the experimental ones),
  then line height, characters per line and paragraph spacing, text past its table cell, text under
  12px and heading levels, and clipped text or a page that scrolls sideways under WCAG 1.4.12's text
  spacing, at 200% text size and at 640 and 320 px. A shard argument splits the runs across
  processes. `--summary` turns its results into one Markdown list. It needs `playwright-core` and
  `axe-core`, which the repository doesn't install; its header says how. The README's "Reading:
  contrast, type and zoom" quotes its runs of 2026-11-12.

- The site's footer shows NEAR's "Built on NEAR" badge, linked to near.org: NEAR's own SVG files from
  its brand hub, unchanged, black on the light pages and white on the docs' dark theme. The landing
  page adds "Built with" above "Built on NEAR": eight names, each linked to where Satchel used it, a
  transaction, testnet satchel #4's holder room, the CI run or the npm release, with no logos. Chain
  Signatures links mainnet satchel #1's `sign_evm`, NEAR Intents 1Click the USDC it paid out on
  Arbitrum One, Sputnik DAO the testnet vote that had satchel #8 sign, the locked contract the mainnet
  transaction that left it 0 keys, and the EVM chains satchel #1's send on Base. A line under them
  says the names show what Satchel uses, not a partnership or an endorsement, and that npm is a
  registered trademark of npm, Inc. The FAQ's note that the page's examples are on testnet now names
  these links to mainnet, Base and Arbitrum One. Tests in `showcase.test.ts` tie six of the links to
  `deployments/`, the npm link to the version the app's commands pin, and the room link to the tour's
  NEP-413 card.

- The README's step 3 ends with one verdict redone by hand: two `curl` reads, satchel #5's
  `signing_record` from `v1.satchel-nft.testnet` at a final block and its address's Sepolia nonce at
  the finalized block, with what they printed on 2026-11-12, and how check 2 (`pendingCheck` in
  `report.ts`) turns them into "A signed transaction may still be pending". `node -e` decodes the
  contract's answer. A PowerShell form uses `Invoke-RestMethod`, because Windows PowerShell 5.1 strips
  the quotes in a body passed to `curl.exe` and the nodes answer `Parse error`.

- The README's comparison with other work: the sentence on Lit's PKPs is dated, with Lit's docs
  archived on 2025-01-13 and its current authentication model as of 2026-11-12; a sentence on
  another hackathon entry's NFT-owned vault, linked to its README at a pinned commit; and "Why not
  swap a Safe's owners?", which links Safe's docs on modules and threat model row 3. The ERC-6551
  bullet in "Why it is different" now says that such an account checks the NFT's current owner each
  time it acts, so a signature made before a sale stops working, but the approvals it granted stay;
  the comparison's ERC-6551 sentence, which said such an account is on one chain, links EIP-6551:
  it can be deployed at the same address on many chains, and the reference account acts only on the
  NFT's own chain.

- The threat model adds row 10a, a sale paid outside `buy`, which nothing freezes or pins, and row
  10b, the window in which an `nft_transfer_call` receiver owns the satchel before
  `nft_resolve_transfer` runs: 42 attacks in all. The README's limits add row 10a.

- A daily watch of the demo until judging ends: `.github/workflows/watch.yml` runs
  `node scripts/check-claims.mjs` on testnet and mainnet and `node scripts/check-dao.mjs`, each once
  more a minute later if it fails, then `curl -fsS` on satchelnft.xyz and `/mainnet`, on Node 22 with
  no install and no secrets. It runs every day at 05:23 UTC from `main`, by hand, and on a pull
  request that changes it or either script; from 2026-11-25, when judging and the demo freeze end, it
  checks nothing. `check-claims.mjs` now tries each read that fails once more, 2 s later; with
  `BASE_RPC` unset, a Base read that `https://base-rpc.publicnode.com` fails goes to Base's own
  `https://mainnet.base.org`, which also serves satchel #2's state at block 55857952 (the last line
  says when it did); and a claim that fails because a Base node or 1Click didn't answer says it is
  not a change to any satchel, and to set `BASE_RPC` or run the check again. Still 13 claims on
  testnet and 15 on mainnet.

- The landing page's "Beyond a sale" section has four cards. Each is one satchel, with the transactions behind
  it where there are any:
  - testnet #4's holder room;
  - satchel #8, which a DAO owned;
  - mainnet #2's swap through 1Click;
  - Make it clean on testnet #9: the state set up on 2026-11-11 and its owner's clean-up on
    2026-11-12, with the approve, the revoke and the send of 0 on Sepolia.

  Each card says what happened and links the satchel's page and a docs page; the verdict is left to the live
  report. The cards are `TOUR` in `showcase.ts`. Its tests check each card's transactions against
  `deployments/`, and each link against the app's routes and the docs pages and their anchors. The demo kit
  adds the cards to what changes with a demo satchel.
- The landing page's "Built on NEAR" list adds:
  - NEAR Intents;
  - Sputnik DAO;
  - NEAR Connect with NEP-413.

  It also links the README's table, which says where each one is used.
- Make it clean: under a report that isn't clean, a satchel's page lists the transactions that would
  fix checks 2 and 3, with their calldata, and gives the owner a button for each one the app can
  send. **Revoke** builds `approve(spender, 0)` for an ERC-20 allowance, `approve(0x0, id)` for an
  ERC-721 approval, `setApprovalForAll(operator, false)` or Permit2 `approve(token, spender, 0, 0)`,
  never `increaseAllowance` or `decreaseAllowance`. **Spend nonce** sends 0 to the satchel's own
  address with empty calldata, for each open nonce a revoke on that chain doesn't spend. Each button
  runs `sendFromSatchel`, with the same guards and wallet prompt as Send from this satchel, and then
  offers Check again, also when the send went out but its receipt wasn't read. The card lists free
  revokes first, shows the approval slot each new row takes, re-reads the record before a revoke
  that takes one, and won't send a 33rd while check 4 passes; more than 10 open nonces on a chain get
  a terminal command instead; an `approve` row that both reads find live, or one it couldn't read,
  gets both calls and no button; a listed satchel, or one whose check 1 fails, gets no buttons, and
  neither does a chain whose pending nonce read lags the report or the chain's latest block; check 4
  has no fix. On a chain with open nonces, it warns that funding the address lets anyone broadcast
  what was signed at them first. Run once on chain, on 2026-11-12: `tools/make-clean-demo.mjs` left
  testnet satchel #9 in the state it fixes, its owner pressed both buttons, and the report read
  `PROVABLY CLEAN` (the entry on the run below). In the package, unreleased and not in npm
  0.2.0: `fixPlan`, `readFixInputs` and `revokeCalldata` in `clean.ts`, with tests that run each
  call it builds through a model of the contract's classifier for those calls (`contractClass` in
  `clean.test.ts`), and `Liveness.standard`, which says whether the ERC-20 or the ERC-721 read found
  a live `approve` row. The handover kit, also unreleased, points to the card's buttons, pins
  `satchel-nft@0.2.0` in its commands, and no longer says there is no revoke button. The threat
  model adds row 21i.

- Make it clean's first run on chain, on testnet satchel #9 on 2026-11-12, in the demo video's take.
  From the card on satchelnft.xyz/satchel/9, the owner's wallet signed **Revoke**,
  `approve(0x65C6…9C8E, 0)` on Sepolia USDC at nonce 1 (record version 4, Sepolia block 12118047),
  then **Spend nonce** on the row "Spend nonce 2", a send of 0 to the satchel's own address (record
  version 5, block 12118062); the app broadcast both. Once Sepolia finalized, about 15 minutes
  later, **Check again** read `PROVABLY CLEAN`: "signed up to nonce 2, finalized nonce is 3", the
  allowance 0. The two sends the setup signed and kept can't be broadcast now.
  `deployments/testnet-make-clean.json` adds the run under `cleaned`, written in by hand from each
  `sign_evm` event, each Sepolia receipt and the report, and the holder room the same wallet opened
  next (owner read at final NEAR block 277348286). The README's section on #9, its status table,
  limits and evidence links, AGENTS.md, the demo kit and the landing page's #9 card say it ran; the
  card links the approve, the revoke and the send of 0 on Sepolia, and `showcase.test.ts` ties them
  to the file. #9 joins the demo satchels: the app's guard (`frozen.ts`), the list the sitemap and
  `llms.txt` read (`DEMO_SATCHELS`; not a quick pick on the verify page), the guides, the threat
  model's row 21h and the demo kit's list of satchels to leave alone until 2026-11-25.
  `make-clean-demo.mjs` refuses #1 to #9 except with `--check`, which only reads: a new setup needs
  a new satchel.

- The demo satchels' guard: on testnet #1 to #9 (#9 added after its run on 2026-11-12) and mainnet
  #1 and #2, whose state the README quotes, the app shows a note in place of send, list, delist,
  transfer, buy and the Make it clean buttons until 2026-11-25, with a link to mint your own
  (`web/src/lib/frozen.ts`). The holder room stays open, and its kit says the card's buttons are off
  on them. It is a guard in the app, not a protection: the CLI and the near CLI can still sign for
  them. The buy, sell, send and transfer guides, the try-to-cheat tutorial and the README now point
  readers to a satchel they mint instead of those ids, and the threat model adds row 21h.

- Send and sale panels: a send that was mined but reverted reads as a warning, and screen readers
  hear which send step is running, then the error or the result. One send runs at a time per
  satchel, not per page. The price and receiver fields have labels ("Price in NEAR", "Receiver's
  NEAR account"), and a transfer asks the owner to confirm the receiver, after the receiver check,
  before the wallet opens; focus moves to that question, and the receiver can't be edited while it
  is checked or the wallet is open.

- A share card, and a section on `/mainnet` for the two satchels that have sent real ETH. A link
  to any page shows `web/src/app/opengraph-image.png` (and the same `twitter-image.png`), 1200 x
  630, with alt text, rendered from `docs/assets/src/og.html` by `render.mjs`; it carries no
  verdict, since a site can keep a card for days and a report can change. Each page has its own
  title, description and `og:url`. `apple-icon.png` and a 16 and 32 pixel `favicon.ico` come from
  the same script. `/mainnet#showcase` links the transactions behind each story: satchel #1 sent
  0.0001 ETH on Base from its page here, and #2 sent 0.00258 ETH on Base to 1Click's deposit
  address and received 5.280549 USDC on Arbitrum One. The numbers are in `web/src/lib/showcase.ts`, and
  `showcase.test.ts` checks each against `deployments/mainnet-first-send.json` and
  `deployments/mainnet-1click-exit.json`. The landing page and the empty mainnet market link to it.

- The verify page takes `5`, `#5` or a satchelnft.xyz link to a satchel's page or room (a mainnet
  link opens on mainnet), and offers testnet #1 and #3 to #6 and mainnet #1 and #2 as quick picks,
  each with one line on what was done with it. The sitemap and `llms.txt` list their pages, and
  testnet #7's.

- A satchel's page, as the server sends it, says what the page checks and on which network, and
  gives the same report's command: `npx -y satchel-nft@0.2.0 verify <id>`, with `--network mainnet`
  on mainnet. It reads nothing from NEAR to say so.

- `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin` on every
  response (`web/next.config.ts`), and a "No page here" page for
  an address the site has no page for.

- Quote an exit: a dry 1Click quote on every mainnet satchel's page, with no wallet. Its panel,
  under the address, reads what the satchel holds of the native coin, USDC and USDT on the 7
  mainnets 1Click serves (not Aurora) and 1Click's `/v0/tokens`, which gives each asset id by
  blockchain and contract address (entries marked "(DEPRECATED)" left out), then posts a dry
  `EXACT_INPUT` quote to `/v0/quote` with the satchel's own address as `recipient` and `refundTo`
  and a destination on one of its own mainnets. The origin defaults to the largest holding at
  1Click's prices, the destination to ETH on Base. `QuoteRequest` in `web/src/lib/oneclick.ts`
  holds `dry: true` and no other value, `dryQuote` refuses any other, and the app never asks for a
  deposit address or shows one. `checkQuote` refuses an answer that doesn't echo the assets, amount,
  recipient, refund address, slippage and deadline asked for, or that carries a deposit address, and
  the panel shows the amount out, the minimum after 1 % slippage, the sum of the quote's `appFees`
  and 1Click's time estimate, and 1Click's errors (a minimum, in the origin's units) as 1Click words
  them. On testnet, which 1Click doesn't serve, the panel is a line that points to mainnet satchel
  #2. On mainnet pages, a satchel's history asks `/v0/status` about the recipients of its latest 5
  native-coin sends and marks a send whose recipient 1Click knows as a deposit address, from the
  chain's native coin, in 1Click's words: satchel #2's Base send reads `1Click swap · SUCCESS ·
  5.280549 USDC to this satchel on Arbitrum One`. Both are silent or contained when 1Click fails, and
  the report reads neither. 35 tests with 1Click's real answers of 2026-11-11 as fixtures (a dry quote
  for satchel #2's USDC, the status of its swap's deposit address, and `/v0/tokens` on the 7 chains).
  The guide [Quote an exit through 1Click](https://satchelnft.xyz/docs/guides/quote-an-exit) has the
  request, the checks, the fees seen that day (20 bps of `appFees` on most routes, 1 bp on some
  stablecoin routes) and a `curl` to read them again; the FAQ answers whether the app swaps (it quotes),
  and the README says what a real swap still takes: a deposit address from a quote that isn't dry,
  which the app never asks for.

- The README goes through the other three tracks Satchel is entered in, each track's brief and
  example prompt requirement by requirement, Met, Partly or Missing, with where to look: Open
  Innovation (an inheritance account), Unstoppable DeFi (a cross-chain DCA vault) and Social Money (a
  bounty board with earned trust), and a line on which of the tracks' "Lean on" hints Satchel uses and why not
  the others. Where it falls short, it says so: the swap through 1Click ran once, from a script and
  the app's Send panel; the script's dry quote (`plan`) needs a funded mainnet satchel other than #1
  and #2, so it can't run with no funds; no bounties, reputation, payout tiers or board exist. Two
  new sections: "Failure cases", read from the locked contract (a lost or stolen NEAR key, the MPC
  network or NEAR down or slow, a DAO council that loses its keys or turns hostile, a holder offline
  during a 1Click refund, a lying RPC, satchelnft.xyz down), and "The case against Satchel". "Not a
  way to launder an existing wallet" now says what a satchel is not for, that `PROVABLY CLEAN` is not
  AML-clean, and that every sale through `buy` is public on NEAR, and a new paragraph, "Who it is
  for", names payees, offboarding and inheritance through a DAO and says Satchel can't recover a lost
  key. The Libraries section says Claude Code loaded NEAR's `near-intents` agent skill while
  building the swap. The demo kit enters Social Money too (track ids `nfts`, `open`, `defi`,
  `social`) under the project name "Satchel (satchelnft.xyz)", since another entry is named
  "Satchel: membership cards that are wallets", and the "What did you build?" text names the
  DAO-owned satchel. The docs' use cases gain payees, offboarding and inheritance through a DAO, and
  what Satchel is not for; the security model gains "When something fails".
- A swap through NEAR Intents' 1Click that keeps a satchel provably clean, run once on mainnet.
  `tools/oneclick-exit.mjs` asks 1Click for an `EXACT_INPUT` quote from ETH on Base to USDC on
  Arbitrum One with the satchel's own address as `recipient` and `refundTo`, checks that 1Click
  echoed the swap type, assets, amount, slippage, deadline, recipient and refund address it asked
  for and that the fee is at most 25 bps, and saves the quote with the satchel's Base nonce at that
  moment (`quote`). `ready` refuses to let the owner send once the
  quote is near its deadline, the satchel has sent since, or 1Click no longer waits; `submit` checks
  the Base transaction and its `sign_evm` against the quote before it saves them and tells
  `/v0/deposit/submit`; `status` follows the swap and reads the USDC on Arbitrum One. It signs
  nothing and needs no API key: the deposit is a plain transfer from the app's Send panel. Mainnet
  satchel #2 was minted, funded with 0.0026 ETH on Base, sent 0.00258 ETH to 1Click's deposit
  address (`sign_evm` `FnFSMSh1…`, Base `0x2d9b1a1c…`), and received 5.280549 USDC on Arbitrum One
  (`0x417322bd…`), where 1Click quoted 5.285374 with a minimum of 5.232520; its report reads
  `PROVABLY CLEAN`. The record is [`deployments/mainnet-1click-exit.json`](deployments/mainnet-1click-exit.json),
  and the README says what it doesn't show: the USDC, or a refund, arrives only if 1Click's system sends it, and
  the report doesn't count an output or a refund in flight. Internal adversarial reviews: five
  before the run and four after it, every kept finding fixed. The script refuses mainnet satchels
  #1 and #2, which the README quotes and which sign nothing until 2026-11-25. It never writes to a
  record whose swap has ended and been read to the end, with its deposit and that deposit's
  `sign_evm` saved: `quote` and `plan` ask for a new `--out`. Until then `submit` and `status` fill
  the record in, in either order, since 1Click can finish before the owner runs `submit`.

- A satchel a Sputnik DAO owns, on testnet, with no contract change.
  `satchel-club.sputnikv2.testnet` (`sputnikdao2` 2.3.1, one council member) owned satchel #8. A
  FunctionCall proposal had the DAO call `sign_evm` with 1 yoctoNEAR and 150 Tgas; the vote that
  approved it made the call, the contract hashed the Sepolia transaction from the proposal's
  arguments and recorded it, and `v1.signer-prod.testnet` signed. The signature is in one of the
  vote's receipts, not in what the vote returns, so `satchel-nft dao finish <near tx>` reads every
  receipt (`signatureFromReceipts`, `signEvmCalls` in `dao.ts`), checks that the contract's
  `evm_signing_hash` equals viem's hash and that the signature recovers to the satchel's address,
  checks the nonce and the balance, asks, and broadcasts. It needs no key: the signature is public.
  It asks FastNEAR's transaction index for the vote's signer, and reads a vote older than a day or
  two from FastNEAR's archival node.
  On Sepolia the send got status 1 and `verify 8` read `PROVABLY CLEAN`; a second proposal had
  the DAO call `nft_transfer` to `buyer.satchel-nft.testnet`, and the report still reads clean.
  `daoProposal(net)` builds both proposals, `daoVote` the vote with the proposal's kind, and
  `sputnikDao(net, id).openProposals()` with `nonceClash` finds an open proposal that already has
  the satchel sign that nonce. `fromContractTx` (`evm.ts`) turns `sign_evm`'s JSON transaction
  back into viem's, refusing what the contract would refuse. Every transaction is in
  [`deployments/testnet-dao.json`](deployments/testnet-dao.json), read back from the chains, and
  `node scripts/check-dao.mjs` checks five claims about the run against NEAR testnet and Sepolia
  (the DAO's version, sole council member, bond and period; the mint to the DAO; both proposals as
  filed and the votes that ran them; and the Sepolia send, its fields and signature); the docs have
  [a walkthrough](https://satchelnft.xyz/docs/tutorials/dao-owned-satchel) and `dao finish` in the
  CLI reference. 28 new tests, with the vote's receipts as a fixture, and
  `derived-keys.json` has the key of `satchel/8`. Not in 0.1.0, and not run on mainnet.
- The holder room: `/satchel/<id>/room` (and `/mainnet/satchel/<id>/room`), a page only the account
  that owns a satchel right now can open, linked from the satchel's page. The holder's wallet signs a
  NEP-413 message (NEAR Connect's `signMessage`) naming the satchel, the network, the contract, the
  account and the time, for the recipient `satchelnft.xyz`. The app's one server route, `/api/room`
  (POST only, 4 KB body limit, `no-store`), writes the message again, verifies the ed25519 signature
  strictly, then reads at one final NEAR block that the key is a full-access key of the account and
  that the account owns the satchel, on every request; it stores nothing. A proof is refused 5
  minutes after its `Issued` time, each NEAR read after 10 seconds without an answer (a 502), and a
  report that takes over 20 seconds still leaves the holder card. Inside: a holder card (account,
  satchel, network, the block read, the key) and a handover kit, what to do before selling, one step
  per check of the satchel's report that doesn't pass, or one step to list it when all four pass. The
  kit names only the chains still open, says where the full approval addresses are, offers no fix
  while check 1 fails (the app and the CLI then sign nothing), and says plainly when a chain is one
  the app and the CLI don't send on. The track brief's gated page is now met in the README and the
  demo kit. The package exports `checkHolder`, `roomMessage`, `ROOM_RECIPIENT`, `ROOM_WINDOW_MS` and
  `ROOM_SKEW_MS` (`holder.ts`), `verifyNep413`, `nep413Hash` and the base64 helpers (`nep413.ts`),
  `handoverKit` (`kit.ts`), `finalBlock`, `viewAt`, `accessKeyAt`, `rpcFor` and `RPC_TIMEOUT_MS`
  (`near.ts`) and `nearBlockUrl` (`config.ts`), and the report's pending and approvals checks gain
  `chains`, the chain and status behind each line; none is in 0.1.0 on npm. 35 new package tests
  (191 in all, with the DAO entry's 28), the NEP-413 ones against two signatures near-cli-rs made, and 5 app tests (20). The docs gain a guide, "Open the holder room" (38 pages with the DAO walkthrough), and a section in the
  security model; the threat model adds rows 24 to 28 (38 attacks) and residual risk 13. AGENTS.md
  adds the checks for it. The README and "Run the web app yourself" no longer say the app has no
  backend: it has one stateless server route.
- The README lists the libraries, templates and AI-written code Satchel uses, as the hackathon's
  rules ask (HACKATHON.md, Q-005): the contract's crates and cargo-near, and that `Cargo.toml` is the
  file cargo-near's `cargo near new` template writes, with Satchel's name, description, repository
  and dependencies; the package's and the app's npm dependencies and fonts; the test and
  CI tools; and that Claude Code wrote most of the code, tests and docs, with no human audit.
- Two contract tests for a sale in the middle of a payout (61 in all). In
  `a_sale_in_the_middle_of_a_payout_keeps_the_send_on_record`, the seller has a send signed, lists,
  and a buyer buys before the MPC network answers: the record the buyer bought still names that
  send's nonce, so the report can't read clean until a transaction at that nonce is final, and the
  buyer can sign at once. In `the_seller_cannot_sign_while_their_payment_is_in_flight`, the seller
  is refused once `buy` has run, while their NEAR is still a pending transfer. A unit test can't run
  the MPC call, so both pin the state each step leaves, not the race between receipts. The deployed
  contract is unchanged.
- Three contract tests for gaps the threat model named (64 in all).
  `nft_transfer_call_ends_the_sellers_listing` shows `nft_transfer_call` deletes the seller's own
  listing row, not only hides it, and the receiver who keeps the token starts unlisted and free to
  sign; with that line taken out, it fails and the bounced-transfer test still passes.
  `a_non_owner_cannot_nft_transfer_the_token` shows near-contract-standards refuses another account
  moving a listed satchel (`Approval extension is disabled`).
  `a_record_at_the_caps_and_its_listing_fit_in_the_mint_deposit` measures the worst case: a 20-digit
  token id owned by a 64-character account, signed for on all 16 chains, with 32 Permit2 rows and a
  listing, takes 8,558 of the 10,000 bytes its 0.1 NEAR mint paid for, and signing past the caps
  adds none. The threat model's rows 10 and 22, which said no test covered these, now name the
  tests. The deployed contract is unchanged.
- The README goes through the NFT track's brief point by point: what a satchel does for owning money,
  earning royalties (not built in: any address can be a payee, and a satchel pays none), holding
  inventory and carrying access rights, then the track's example prompt requirement by requirement
  (met, partly or not yet, with where to look), why an MPC address rather than a NEAR sub-account,
  the prior work on keys tied to NFTs (NEAR's NFT Chain Keys, Lit PKPs, ERC-6551) and how Satchel's
  record differs, why a satchel can't launder an existing wallet,
  and that the contract takes no fee. Limits adds that tokens have no picture. The demo kit's track
  rationale now says the history requirement is only partly met, as the README does.
- A satchel's page, for a visitor while it is listed, shows the price and the seller under its title,
  with a link down to the buy panel. The bar shows the listing the buy panel shows, and the purchase
  still happens only in that panel.
- A satchel's address no longer comes from an RPC. The package derives each satchel's key itself, as
  the MPC contract's `derived_public_key` view does: the MPC network's root key plus `t·G`, where `t`
  is the SHA3-256 hash of `near-mpc-recovery v0.1.0 epsilon derivation:`, the Satchel contract, a comma
  and the path (`deriveMpcKey` in `evm.ts`). The root key of each network is pinned in `config.ts`
  (`mpcRootKey`), so `tokenAddress`, which the app, the CLI and the report use, reads nothing: a lying
  NEAR RPC can no longer change the address of a given satchel. Which satchel is yours (the id a mint
  returns, the tokens an account owns) still comes from the NEAR RPC, or for a mint from the wallet,
  and the threat model says so (row 21g). The token page says under the address that it was derived
  in the browser. The tests derive the keys of testnet satchels #1 to #7 and mainnet #1 and
  get what `derived_public_key` returned (`__fixtures__/derived-keys.json`, 14 new tests, 128 in all), and
  `check-claims.mjs` has two new claims on each network: the pinned root key is the MPC contract's
  `public_key`, and the fixture's keys are its `derived_public_key` (13 claims on testnet, 11 on
  mainnet). The package now depends on `@noble/curves` and `@noble/hashes`, which viem already
  installs. Not in 0.1.0.
- A demo kit, [`docs/DEMO.md`](docs/DEMO.md): a 2:00 video script with a caption and a
  voice-over line per scene, timed against how long each page took to load on satchelnft.xyz; a
  recording checklist; the X post ([`docs/submission/x-post.txt`](docs/submission/x-post.txt))
  and the "What did you build?" text
  ([`docs/submission/what-did-you-build.txt`](docs/submission/what-did-you-build.txt)); the
  submission form's values, with the Website field left empty because the organizers made it a
  spam trap; the tracks and why; and what to leave unchanged until judging ends.
  `node scripts/check-demo-kit.mjs` checks the form text's length; the post's length, close to
  X's count, its tags as whole tags and its question; that the script's tables are well formed
  (the optional scene too), the scenes run 0:00 to 2:00 and none says more than 2.5 words a
  second; and that every satchelnft.xyz page it opens is a route the app has. The web workflow
  runs it.
- A documentation center at `/docs` (satchelnft.xyz/docs): 36 pages in 8 sections, from a
  quickstart and the concepts to a guide for each thing the app does, three tutorials, the library,
  CLI, contract, events, errors and RPC reference, an advanced section, security, troubleshooting,
  a FAQ and a glossary. AGENTS.md, the threat model, SECURITY.md and this changelog render there
  from the repository files. Pages are MDX in `web/content/docs`, built at build time with Shiki
  highlighting; the site has full-text search (Ctrl K), a table of contents per page, breadcrumbs,
  previous and next links, a light and a dark theme, a page-feedback prompt, a sitemap, `robots.txt`,
  `llms.txt` and structured data. `docs.test.ts` compiles every page and fails on a broken link or
  anchor. Every page was checked against the contract, the package and the app's source.
- What's inside a satchel, and its history. Above the report, a satchel's page now shows, beside the
  native balance on each of the network's 8 chains, its USDC, USDT and WETH where a deployment is
  listed: 22 on the mainnets, 11 on the testnets (`TOKENS` in `contents.ts`, each with its source).
  They come from Circle, Tether, USDT0 or the chain, except WETH on Sepolia, from Uniswap's
  deployment list. A token shows the symbol its contract reports: USD₮0, USDT0, USDt, WETH.e, and
  ETH for Binance-Peg ETH on BNB Chain. After `npm run build -w satchel-nft`,
  `node scripts/check-tokens.mjs` reads every address's code, symbol and decimals back from its
  chain. Below the report, a History card lists the mint,
  transfers, signatures, listings, delistings and sales from FastNEAR's transaction index, each
  linked to its transaction. It keeps only the contract's own events from receipts that succeeded,
  and says when it read only part of the index or counts a different number of signatures than the
  record. A sale shows once, without the transfer it logs; a failure in the card can't take the
  report down with it. The report reads neither. In the CLI, `show` prints the tokens too, and
  `history <id>` prints the timeline; neither is in 0.1.0. 17 new unit tests, 111 in all, with
  satchel #7's real transactions as a fixture.
- The npm package `satchel-nft` (`packages/satchel-nft`), published on npm as 0.1.0 on 2026-11-09
  by the owner, from commit `728ed74`. `npx -y satchel-nft@0.1.0 verify 1` runs the report with no
  clone. It holds the clean transfer report, the guards, the send flow and the contract's reads and
  transactions as a library (`import { buildReport } from "satchel-nft"`), and a command,
  `satchel-nft`. Read commands need no keys: `verify`, `show`, `record`, `market`. Sign commands (`mint`, `list`, `delist`, `buy`,
  `transfer`, `send`) have the near CLI sign with the key in its keychain, so the package never
  reads one; it decodes the signed transaction, refuses it unless the signer, receiver, method,
  arguments, gas and deposit are the ones it asked for, shows it, and sends only after `yes` or
  `--yes`. `buy` goes ahead only when the report reads `PROVABLY CLEAN`, naming the record version
  that report read. `--network`, `--json` and exit codes for scripts: 0 done, 1 no, 2 could not run,
  3 sent but the outcome is unknown. Every sign command ran on testnet with satchel #7, minted,
  funded, sent from, listed, sold and handed back with the CLI; the transactions and the refusals
  are in `deployments/testnet-cli.json`. 94 unit tests.
- CI: `package.yml` typechecks and tests the package, packs it, fails if the tarball holds anything
  but the launcher, `dist`, the README, LICENSE and `package.json`, installs the tarball in an empty
  project and runs it on Node 22, then runs the 0.1.0 release from npm. `ci.yml`'s `verify` now
  needs the contract, web and package workflows.
- The first satchel on mainnet. Satchel #1's address, `0xdC269Ead17B522d49db2ceFD38CEF0C5413868F9`,
  was funded with 0.00195 ETH on Base; the satchel was minted to `satchel-nft.near`, then sent
  0.0001 ETH from it on Base at satchelnft.xyz, with the owner approving `sign_evm` in a NEAR wallet.
  Its report reads `PROVABLY CLEAN`. Every step is in `deployments/mainnet-first-send.json`, and
  `node scripts/check-claims.mjs --network mainnet` checks three more claims (9 in all): the mint
  came after the lock; the contract recorded Base nonce 0 as the token's first entry, then asked
  `v1.signer` to sign satchel #1's path over its own hash of those fields; and Base ran that exact
  transaction with that exact signature, in a block now finalized.
- The README, rewritten for both judges and builders: an "evaluate in 5 minutes" path from a fresh
  clone with the real output and timings of each step (the claim checker on both networks, two curl
  reads, hashing the CI wasm, `npm run verify` on every demo satchel, the tests), a status table of
  what is shipped, in progress and planned, a sale step by step with a diagram, the safety layers
  mapped to their code and tests, a section on each NEAR technology Satchel uses and how, the
  mainnet and testnet proof side by side, a quick start with the near CLI, the test inventory with the
  rules that have no unit test, and screenshots of the app read live. Its banner, buttons
  and screenshots are rendered from `docs/assets/src` (`render.mjs` and `screenshots.mjs`, with any
  Chromium browser).
- Deployed to NEAR mainnet at `v1.satchel-nft.near` from the same reproducible build as testnet
  (code hash `94x4MmZKXGetffqJJVePLTdFkJvsmeXRLmi74Mdp2Lph`), initialized with `v1.signer` in the
  deploy transaction and locked by deleting its only key before any satchel was minted. Record in
  `deployments/mainnet.json`. `tools/deploy-mainnet.sh` did it: it reads the chain before each step,
  stops if a name exists without its key or the account runs other code, and asks before it deletes
  the key. `node scripts/check-claims.mjs --network mainnet` checks six claims, the last that
  `nft_total_supply()` was 0 at the block that deleted the key.
- NEAR mainnet in the same web app. Pages under `/mainnet` read and sign on mainnet
  (`v1.satchel-nft.near`, MPC `v1.signer`, the same reproducible build as testnet); every other page
  stays on testnet. A switch in the header moves between them, and any link to the other side loads
  it as a new page. Every read, report, wallet connector and transaction takes its network
  explicitly, from the page's path, and each network remembers its own wallet. Each side sends only
  on its own chains, and connecting an account from the other network says so.
  `npm run verify -- --network mainnet <id>` reads mainnet. The landing page and its FAQ say Satchel is live on mainnet, and that the
  examples on the page are on testnet.
- Documents for reviewers and AI agents:
  - `AGENTS.md`: how to check every claim, with commands and expected output, a map from each rule
    to its code and tests, and how to change the code.
  - `docs/THREAT_MODEL.md`: 29 attacks (the seller's, a buyer's, the deployer's, an RPC's, the
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

### Changed

- `check-claims.mjs` reads the way `check-dao.mjs` does: a read a node answers with HTTP 408, 429
  or 5xx, or whose connection fails, is sent up to 3 more times with backoff, and with
  `NEAR_ARCHIVAL_RPC` unset an archival read FastNEAR's node doesn't answer goes to NEAR's own,
  `https://archival-rpc.<network>.near.org`. Run right after other checks, FastNEAR's archival node
  answered HTTP 429 to both of the old script's tries.
- The README describes Satchel on its own terms and compares it with no other entry in this
  hackathon: the table and the paragraphs that compared it with other entries are gone, and so are
  their mentions in "Satchel in 60 seconds", "Why it is different", the Open Innovation section and
  the demo kit's track table. Prior work that is not an entry (NEAR's NFT Chain Keys, Lit's PKPs,
  ERC-6551, a Safe owner swap) stays in "Others have tied keys to NFTs", under the NFT track's
  brief. The entry with a similar name is still named once, so the two aren't confused.
- The README's table of enforcement layers has three columns: each code cell now ends with its
  tests. In a 1280-pixel window the long test names made the table 966 pixels wide in an 846-pixel
  column, so it scrolled sideways; now it fits.
- The NFT track's example-prompt table in the README has two columns: each Satchel cell now ends
  with where to look, and the first column's heading keeps to one line. In a 1280-pixel window the
  requirement column was 92 pixels wide, a word or two per line, and the table scrolled sideways;
  now it is 256 pixels and the table fits.
- The demo post is up: posted on X on 2026-11-12 at 14:16 UTC from @satchelnfthq, with the 2:06
  video ([the post](https://x.com/satchelnfthq/status/2120883522059837618)). The account has
  Premium, so the post is long: `docs/submission/x-post.txt` is now its text, and
  `check-demo-kit.mjs` checks it against X Premium's 25,000 characters instead of 280, with the same
  tag, link and question checks. The README's status table and `docs/DEMO.md` link the post, and
  `docs/DEMO.md`'s form table gives its URL as the demo post link. It replaces a post from 13:16
  UTC, now deleted, whose third paragraph said nothing on chain shows either trick; an approval left
  behind is on chain, in each chain's logs, so the post now says only the held send leaves nothing.
- "What did you build?" says the point is the check, not the NFT wallet, and adds Make it clean and
  testnet #9. It says what Make it clean fixes, an open nonce or a live approval, and that an
  approval left behind is in each chain's logs; a few phrases are shorter to fit (1,973
  characters).
- The Open Innovation section, in the README and in `docs/DEMO.md`'s track table, leads with what
  Satchel brings to it: a check that nothing the last holder signed can still be used, after a sale
  or after a DAO's vote handed testnet satchel #8 on. It says what Make it clean fixes (an open
  nonce, a live approval) and what nothing fixes (a raw signature, an unclassified call, an approval
  past the 32nd).
- "Others have tied keys to NFTs", after each source was read again on 2026-11-12. NFT Chain Keys
  controls every path under its token id, also signs for accounts the holder approved, keeps no
  record, and is testnet only, with a full access key; the link is pinned to a commit. Lit's
  NFT-based networks, Datil and Naga, are sunset, and the auth methods an owner permitted stayed
  with a PKP after a transfer, with links to the code. ERC-6551: Tokenbound's account can act on
  other chains, and the standard leaves fraud in a sale out of scope; both are linked at pinned
  commits, and "Why it is different" now says it is the standard's reference account that checks the
  NFT's owner each time. The landing page's comparison says NFT Chain Keys sign for chains that take
  secp256k1 ECDSA signatures.

- Text colors meet WCAG 2.2 AAA contrast (1.4.6), 7:1 for text and 4.5:1 for large text, on the
  light pages and the docs' dark theme. New values in `globals.css`: ink-2 `#3b352d`, muted
  `#4f483f`, gold `#ce9b2f`, gold-deep `#845f14` (large text only), a new gold-ink `#5f450f` for
  gold text of any size, leather `#663c22`, ok `#24532d`, warn `#654200` and bad `#82251e`, with
  dark values for muted, gold-ink, leather, ok, warn and bad, and code colors at 7:1 or more on
  every surface in both themes. Translucent text on the ink panels is 75% paper or more, or paper-2;
  the sale flow's other steps dim by color instead of opacity; placeholders are muted instead of ink
  at 50% (3.37:1). The new `contrast.test.ts` computes every token pair the pages use, translucent
  text over its panel included, and fails when one drops under its minimum. The banner, the share
  card, the icons, the README's gold button (Evaluate in 5 minutes) and the four README screenshots
  of the app are rendered again in the new colors, and the README badges use them. `screenshots.mjs`
  waits for mainnet satchel #1's verdict anywhere on the page: the report no longer sits in the
  section it watched, so that shot timed out.
- Reading (WCAG 1.4.8): small text defaults to a line height of 1.5 (`--text-xs--line-height` and
  `--text-sm--line-height`); a paragraph in the app holds about 75 characters a line and docs text
  about 70, table cells, diagram captions and diagram boxes included (a code span that can't wrap
  widens its cell, and the table scrolls); docs paragraphs outside lists sit 2.85 times the font
  size apart, line top to line top. A tinted or ruled box (an error note, the report's footer) is a
  div around its paragraph, so the box keeps its width and its text keeps the measure. The smallest
  text is now 12px: the hero card's stamp and, on phones, its hand-over row, the Ctrl K hint, the
  callout icons and monospace values in 12px text (the fix panel's calls, addresses and calldata)
  were 10.4 to 11.2px.
- Docs: each table's scrollable region is named for the heading above it (`remarkTableNames` in
  `markdown.ts`), numbered when a name would repeat, and a test checks that no page names two tables
  alike; six empty first-column headers have a label. Callouts are `role="note"` instead of
  `<aside>`, the sidebar and the page tools are named landmarks, the network banner is a named
  section, and a code block without highlighting takes keyboard focus so it can be scrolled.
- Lines that said owning the NFT gives full control of its address now say what is true: the NFT's
  owner is the only one who can have anything new signed for the address, and a transaction, an
  approval or a raw signature signed before the sale can still move its assets, which is what the
  report checks. This covers `satchels-and-addresses.mdx`, `transfer.mdx`, `buy.mdx`, `sell.mdx`,
  `sale-on-testnet.mdx`, the docs FAQ, the sale diagram's last step (on How it works, Listings and
  sales and the testnet sale tutorial), the "Mint your first satchel" card on `/satchels`, the nav
  text that `llms.txt` copies and the site's meta description. The docs home (`index.mdx`) and the
  summary line of `llms.txt` no longer say a buyer can check that nothing was kept back: a buyer can
  check what the seller could have kept back, and the report proves what the key signed, not powers
  inside a token's own contract. A satchel's page heads its address "One address on 16 EVM chains,
  signed for only when this NFT's owner asks", where it said "controlled by whoever owns this NFT";
  `mint-and-fund.mdx` quotes the new heading.
- The landing page's "Ways to hand over a wallet." is fairer. It adds a column for NEAR's NFT Chain
  Keys and a row, "Can a signature from before the sale still be used after it?": no for a
  token-bound account, which checks the current owner when it runs; yes for a satchel, until the
  nonce is spent, which check 2 reads. Satchel's answer to emptying it between your check and your
  purchase now starts "No, once the report is clean". On seeing the approvals the seller left, "Only
  by scanning every token contract" is gone: the token-bound account's and NFT Chain Keys' answer is
  "Only by reading each chain's Approval logs", and the seed phrase's is "Only the ones made so far:
  the seller keeps the key and can approve more after you look". A note under the table links the
  token-bound account and NFT Chain Keys code the answers come from, at the commits read. On a phone
  each answer's label comes from the list of columns instead of three fixed labels, and the table
  turns into columns at `lg` instead of `md`.
- The landing page's limits add a fifth: NEAR's MPC network is trusted. Enough colluding nodes could
  sign with any satchel's key, and an upgrade its participants vote for could change how keys are
  derived or who may ask for a signature. The FAQ answer "Who holds a satchel's key?", on the landing
  page and in the docs, no longer says no one can change that rule. It says the contract's code can't
  change but the MPC network is trusted, in the same words, and that a satchel's address is a plain
  EOA, not a smart account: `sign_evm` can't sign an EIP-7702 authorization, and `sign_raw` can, which
  the record counts. "What Satchel trusts" in `security.mdx` says what an upgrade could change too.
- The landing page's FAQ adds "Who sells a wallet? Why not just send the assets?", with the README's
  narrow-demand answer and a link to the use cases, and "What if I pay the seller some other way?":
  only `buy` ties your payment to the record you checked. The docs FAQ says both, and `transfer.mdx`
  says the second.
- A satchel's report card has a scope line under its intro: the report proves what the satchel's key
  signed, not powers inside a token's own contract, and it trusts NEAR's MPC network. It links to
  "What a clean report doesn't say".
- The "What's inside" card on a satchel's page names NFTs (ERC-721, ERC-1155) among the tokens it
  doesn't read.
- `use-cases.mdx` no longer says anyone with testnet NEAR can buy satchel #4 or #6. Both are demo
  satchels the app won't buy until 2026-11-25; to see a sale through, mint a satchel, list it and buy
  it from a second testnet wallet.
- 1Click in the app: a history line for a swap 1Click calls `SUCCESS` links the payout's
  transaction on the destination chain's explorer, the first EVM hash in its status's
  `swapDetails.destinationChainTxHashes` (satchel #2's line links `0x417322bd…` on Arbiscan); a line
  whose status names none, `REFUNDED` and `FAILED` included, still links 1Click's status. **Quote an
  exit** has a slippage limit picker, 0.5 %, 1 % or 3 % (1 % by default, as before); `quoteRequest`
  refuses any other value, `checkQuote` still refuses an answer that doesn't echo the limit asked or
  whose minimum doesn't match it, and every request is still `dry: true`, with no deposit address
  asked for or shown. Tests add a `REFUNDED` and a `FAILED` status for `swapLine` and `swapMarks`,
  each 1Click's real status answer for satchel #2's deposit with the status changed and nothing
  paid out, and a check against 1Click's real minimum in a dry quote at 300 bps: 5 more app tests. The
  README's DeFi track says why the schedule row is missing: each `sign_evm` needs 1 yoctoNEAR, which
  a function-call key can't attach, so a keeper or bot could sign on a schedule only holding the
  owner's full-access key.
- The landing page no longer says to buy testnet satchel #4 with any NEAR wallet. While the demo satchels are
  frozen, #4's card says the app won't buy it until 2026-11-25. It also says how to see a sale through: mint a
  satchel, list it, and buy it from a second wallet.
- The market tags each demo satchel. When every listing is a demo satchel, the market says the same thing.
- Two landing-page lines overstated what Satchel does:
  - The NFT line now says a satchel has no picture per token and no NEP-178 approvals, so a sale goes through
    the contract's own list and buy.
  - The audit line now matches the README's Limits: two internal reviews of the contract, one of them
    adversarial. The security page and the threat model said both were adversarial; they now say the same as
    the README.
- The landing page's Chain Signatures line names both MPC contracts, and its FAQ no longer says that every
  example on the page is on testnet.
- The demo kit no longer says that its 1:18 and 1:42 scenes run only in a local build. It says that
  the clean-up in the 1:18 scene happens once, in the take, which ran on 2026-11-12. Its rules were
  read again from the live HACKATHON.md on 2026-11-11, and they still match.
- The app has 91 tests.
- The README, AGENTS.md and the docs: 222 package tests in 17 files and 81 app tests, the threat
  model's 40 attacks, the web app's pages (Make it clean, Quote an exit), and the DeFi track's rows
  now that the app asks 1Click for dry quotes and shows its status: the dry-run row is met. The
  demo kit's 1:18 scene is Make it clean on testnet satchel #9, and its 1:42 scene is mainnet
  satchel #2 with a dry quote. AGENTS.md adds rows for Make it clean, Quote an exit, the demo
  satchels' guard and the showcase, #7 in its verify table, how long a cold `npx` takes and a
  pointer to the track tables. The README lists all 10 evidence files and what `render.mjs` renders;
  the troubleshooting page and the production checklist point to Make it clean; the landing page and
  the FAQ pin `npx -y satchel-nft@0.2.0`. The sitemap and `llms.txt` add testnet satchel #8, the
  DAO's. "What did you build?" adds the holder room and Quote an exit (1,989 characters) and drops
  its backticks, since the form's field is plain text.
- A satchel's page: the heading reads "Satchel #N", with one line on what a satchel is and what the
  page checks; the verdict at the top links to the report; and "Your satchels" on the card for a
  satchel that doesn't exist is a link. While the page reads NEAR, placeholders the size of what
  loads stand in for "Loading satchel #N…", for the address while the app checks the deployment,
  and for the report's checks, so less of the page moves as it loads. The report's command gains
  `-y`.
- Keyboard and screen readers: a skip link to each page's content and `aria-current` on the
  header's links. The focus ring is two rings, an outline 5.33:1 or more on the light backgrounds
  and inside it one in the card color, 17.3:1 on ink and 8.4:1 on leather; form fields, which sit
  on paper or card, get the outline alone. A form field's border is 3.71:1 or more, up from 1.31:1.
  `ErrorNote` has `role="alert"`; the report's verdict and the verify page's message are
  `aria-live` regions; the verify input sets `aria-invalid` and `aria-describedby`. The address's
  Copy button is named "Copy address" and announces the copy, or that it failed. The verify page's
  check numbers are gold-deep, 3.57:1 on paper, where gold is 2.35:1.
- The landing card's animation moves its dot with `transform` and lights each chain with
  `opacity`, so the browser composites it instead of laying the card out again.
- `node scripts/check-claims.mjs --network mainnet` checks 15 claims, up from 11: satchel #2 minted
  before its Base address held any ETH (its balance read at the blocks around the funding, so
  `BASE_RPC` must serve old state), its first `sign_evm` a plain transfer of the quoted amount to
  1Click's quoted deposit address, that deposit run on Base in a finalized block, and 1Click's
  public status reading `SUCCESS` for that deposit with the record's quote, and naming a payout that
  sent the same address more USDC on Arbitrum One than the quote's minimum (read through
  `ARBITRUM_RPC`, `https://arb1.arbitrum.io/rpc` by default). Satchel #1's signature and Base
  checks are shared with satchel #2's (`signedFirst`, `ranOnBase`), with the same output. The
  README and its "Check every claim" button (33 claims across the three checkers), AGENTS.md and the
  docs' security pages give the new counts.
- `satchel-nft` is 0.2.0 in the repository, ready for its owner to publish; npm still serves
  0.1.0, so every pinned command keeps `@0.1.0` until 0.2.0 is there. The package's README, which
  npm shows, says what changed under "What changed in 0.2.0": the `history` and `dao finish`
  commands, token balances in `show`, every live listing in `market`, addresses derived from the
  pinned root key, the holder room's gate, the handover kit, the Sputnik DAO helpers, and the two
  fields a hand-built `Network` now needs. Its library table marks each of these "new in 0.2.0"
  instead of "not in 0.1.0", and lists `contents` and `tokenHistory`. `docs/RELEASING.md` gives the
  owner's steps: the commit, a clean clone's checks, `npm publish -w satchel-nft`, what to compare
  on npm, and the pull request that moves the pins after. Inside the repository a pinned
  `npx satchel-nft@0.1.0` now fetches 0.1.0 from npm instead of running the checkout, so the
  README's and AGENTS.md's steps for this checkout run `npx satchel-nft` with no version.
- `satchel-nft` 0.2.0 is on npm, published by its owner on 2026-11-10 from commit `2dd4209`
  (`gitHead` `2dd420925c16fc7b9f6ef56bb35d14a489386316`, `dist.shasum`
  `b9822a7ac13476566bc6772ccda08979e5802480`, the shasum a clean clone's `npm pack` gave). The
  tarball's launcher, `package.json`, README and LICENSE are the commit's, and its `dist` is what
  the clone built. Every pinned command outside the package now runs `@0.2.0`: the README,
  AGENTS.md, `docs/DEMO.md`, the docs, the app's pages, and the package workflow, which runs the
  release from npm in an empty folder with a cache of its own. The package's handover kit, which the
  holder room shows, still prints `satchel-nft@0.1.0` commands, a release that has each of them; it
  changes with the next version, and the threat model's residual risk 11 says so. The threat model's
  npm entry, the production checklist's heading, link, `npm view` output and file comparison, the
  security page and the docs header give 0.2.0's facts. The docs' notes that set 0.1.0 apart or
  pointed at the next release (`history`, `dao finish`, the tokens `show` prints, every live listing
  in `market` and `allListings`, each chain's status in `chains`, the address derived from the
  pinned root key) now say "since 0.2.0", some with what 0.1.0 does instead, or are gone. Inside the
  repository the pinned command runs the checkout's build, since the checkout's package is 0.2.0
  too. Two cold runs of `npx -y satchel-nft@0.2.0 verify 1` from an empty folder took 142 s and
  230 s, and each report after them 6 to 11 s; the README, the demo, the quickstart and the cheat
  tutorial say so, and the sale tutorial gives the first-run times. The README's five-minute
  evaluation now starts that download first, in a second terminal, and the docs home's Quickstart
  card promises two minutes for the browser path only. `docs/RELEASING.md` lists both releases and
  adds that the owner's 2FA, confirmed in the browser, needs a real console such as PowerShell: in
  Git Bash's terminal `npm publish` stops with `EOTP`.
- A browser wallet has opened the holder room: Meteor's Chrome extension, connected as
  `satchel-nft.near`, opened mainnet satchel #1's room on satchelnft.xyz (200, the holder card at
  block 223915441, "The satchel reads clean"). **Check again** sent the same signature without
  asking the wallet (200, block 223915478), and a reload went back to **Open the room**, still
  connected. The README's holder room section and Status row, the demo kit's opening and its 1:30
  note, and the holder room guide say so; the kit no longer calls the open room the one screen not
  yet seen, and its note gives where the card, "Checked at" and "Handover kit" sat in a window
  1920 px wide. The kit and the guide add: unlock an extension wallet before opening the page.
- The 2:00 video script shows the holder room. A new 1:30–1:42 scene opens the room of a satchel
  the recording wallet owns: the wallet signs the message, the card "You hold satchel #…" shows the
  final block the owner was read at, then "Handover kit". The #7 page scene now runs 1:18–1:30 and
  mainnet satchel #1 1:42–1:52, each with a shorter line to say, and the terminal 1:52–2:00 with
  the same line. "Before you record" replaces "No wallet is needed" with the wallet that scene
  needs, in a second fresh Chrome profile: a connected wallet stays connected in every satchelnft.xyz
  tab of its profile on its network, and the #7 and mainnet #1 takes must not show an owner's send
  and sale controls. The bullet lists the wallets the app offers (each says it signs messages), which are web
  wallets and which need an extension, and a rehearsal, then a reload so the take signs again,
  since no browser wallet had opened a room yet. The kit's opening and the browser bullet say the
  open room is the one screen not yet seen in a browser. The optional mainnet mint now replaces
  1:18–1:30 and is recorded in the room's profile, mint take first, so the 1:30 scene can open the
  new satchel's room. `check-demo-kit.mjs` also checks paths written alone, such as
  `/satchel/<id>/room`, against the app's routes: 13 of 13.
- The README's holder room section and Status row add the signed run against satchelnft.xyz after
  `main` deployed: 200 for satchel #4's owner at block 277055444, the 403 for another account, and
  405 for a `GET`.
- The demo kit follows HACKATHON.md more closely. Its rules table adds: submit through the form or
  the API, not both, and by the API only after the full JSON payload has been printed and the
  builder has said yes; never commit the payload; read the consent notice word for word; read the
  live file again before submitting; and the README's Q-005, LICENSE and two-projects points. The
  form table quotes the consent notice and gives the API's team size value, `1`.
- "Transfer the NFT and the keys go with it" said a key changes hands, when no one ever holds one.
  The README, the banner, the home page, the docs home and the site's description now say the
  wallet, or the right to sign for it, goes with the NFT. The contract crate's `Cargo.toml`
  description keeps the old words: the contract is left as deployed from commit `87148c6`. The
  README's headline says the 16 chains are 8 mainnets and a testnet of each, and the evaluation
  section says which of its steps fit in five minutes. The "What did you build?" text opens with the
  site and what a satchel is.
- The README, `AGENTS.md`, the package README, the demo kit and the "What did you build?" text said
  that a transfer moves the address, or control of it. It moves the right to have anything new
  signed for it: a transaction, an approval or a raw signature made before the sale still works. The
  report checks that each signed nonce is spent and each approval revoked, and calls a satchel with
  any raw signature not provable. The README's banner image keeps the old line, "Hand over the NFT
  and the address goes with it.", and so does its alt text, until the image is re-rendered from
  `docs/assets/src/banner.html` with `docs/assets/src/render.mjs`. The README's "Why it is
  different" now comes right after its introduction, and its evaluation section says that steps 1 to
  3 need no install, but for step 3's optional wasm check, and that step 4's `npx` run is optional.
  `AGENTS.md` has agents run `check-claims.mjs` before the report, and start the package's install
  or `npx` run in the background, since either outlasts a 2-minute timeout.
- The buy panel also checks that the listing's price and seller, as the page read them, match the
  ones the report checked, not only the record version. Before, a relist at a new price kept the
  record version, so the panel offered the report's price while the page held another; the
  contract would still have refused a purchase at the old price. The buy guide, the errors
  reference and troubleshooting quote the new messages, and the buy guide mentions the price bar.
- The web app runs on `satchel-nft`: its report, guards, send flow and contract calls moved from
  `web/src/lib` into the package, with their tests, so the app and the command run one copy of the
  code. The repository root is an npm workspace (the package and the app, one lockfile); the app
  builds the package before `dev`, `build`, `test` and `typecheck`. `npm run verify` in `web` now
  runs `satchel-nft verify`, and `web/scripts/verify.ts` is gone.
- The README's evaluation runs the report with `npx satchel-nft verify`: from npm with no clone, or
  after installing only the package; testnet satchel #1 now reads record version 7, signed up to
  nonce 4. The threat model lists 32 attacks, and what to trust about the npm release.
- The site's "check it from a terminal" boxes and each report's "run it yourself" line say
  `npx satchel-nft@0.1.0 verify <id>`, from npm, instead of `cd web && npm ci && npm run verify`.
  The README's commands pin the same release.

### Fixed

- The clean transfer report printed an approval line twice once Make it clean had revoked it:
  `approve(spender, 0)` is itemized as a row of its own, and both rows read the same allowance
  (testnet satchel #9: "Sepolia: Approve on 0x1c7d…7238 for 0x65c6…9c8e: allowance is 0", twice).
  `approvalsCheck` now prints one line for rows that name the same chain, contract, token and
  spender and read the same, ending "(2 record rows)", and names each kind it stands for. Every row
  still counts toward the check, and `chains` keeps one entry per row, which Make it clean's plan
  reads. 4 new package tests, 235 in all. The web app prints the new lines from its next deploy;
  `npx satchel-nft@0.2.0 verify` still prints both until the next npm release.
- Docs pages scrolled sideways on 8 page and theme runs at 640 px, 16 at 320 px, 6 under WCAG
  1.4.12's text spacing and 8 at 200% text size: a link's screen-reader text, absolutely placed,
  escaped its table's scroll box, and long URLs used as link text did not break. `.docs-table` is
  `position: relative` and docs links break (`overflow-wrap: break-word`). The hero card's hand-over
  row cut both account names short at 320 px; it wraps them instead.
- Hovering the verdict badge on a satchel's page faded it to 80% opacity, 3.3 to 4.6:1; it draws a
  ring instead. In the docs search, the "Try again" hover was under 7:1 in both themes, the selected
  result's section line was too (4.51:1 light, 4.16:1 dark), and its matched words were under 7:1 on
  the dark theme (6.66:1); they no longer are. At 320 px the docs search button cut "Search the docs"
  short; below 640 px it says "Search". A code block's title, such as the 1Click URL, now wraps
  instead of running out of its box.
- On the docs' dark theme, Satchel's mark in the header and footer was a near-black lock on a
  near-black background. The mark is now drawn inline in the theme's ink and gold (`SatchelMark` in
  `site-header.tsx`), so it is light on the dark theme and unchanged on the light pages.
- On the landing page, satchel #3's 78-digit allowance in "Try to cheat the buyer." ran out of its
  row. At 390 px the whole page scrolled sideways (scrollWidth 656); at 1600 px the line spilled 23 px
  past its highlighted row. In `trick-explorer.tsx` the line now wraps anywhere
  (`[overflow-wrap:anywhere]`), and its flex item can shrink (`min-w-0`).
- Nine of the landing page's 13 sections faded in with a scroll-driven animation (`.reveal` in
  `globals.css`) and stayed at opacity 0 in anything that showed the page without scrolling it: a
  full-page screenshot, a print. The animation and its class are gone; the sections show at once.
- On a 390 px phone the header's nav could wrap onto a second line once its font loaded, which moved
  the page down. Its links are 12 px apart below `sm` (`site-header.tsx`), 16 px from `sm` up.
- Selected text disappeared on the dark panels: the code blocks on the landing and `/mainnet` pages,
  the landing page's satchel card, its "Don't trust the seller. Or us." and "Check one yourself."
  sections, "Try to cheat the buyer.", the testnet and mainnet banners, and the contract box in the
  docs' architecture diagram. `::selection` in `globals.css` set only a gold-soft background, and
  their paper text on it was 1.0 to 1.1:1. Selected text now turns ink: 14.5:1, and 10.8:1 in the docs' dark theme.
- A satchel's history, on its page and from `satchel-nft history`, failed whenever FastNEAR's
  transaction index rate-limited one read. On 2026-11-11 `tx.main.fastnear.com` answered 429 to about
  half the requests, at one every 5 s, and mainnet satchel #2's page showed `Failed to fetch` until
  **Try again**. A browser sees only that, because the index's 429 had no CORS headers. `indexPost`, in
  the new `tx-index.ts`, now sends again a read the index answers with 408, 429 or a 5xx, up to 5 sends
  in all, as FastNEAR's own client does, and one that got no answer at all. Before each new send it
  waits a random time of up to 0.5, 1, 2, then 4 s, or the index's Retry-After, up to 8 s. A read that
  timed out after 20 s isn't sent again. When the last send fails too, the error lists what each send
  got. `satchel-nft dao finish` reads a vote's signer through it, and every error from that read now
  names the vote; before, a network failure, a timeout or an unreadable answer didn't.
  `tools/oneclick-exit.mjs` still says to run it again when that read fails for the network. 9 new
  package tests, 231 in all. `satchel-nft` 0.2.0 on npm still sends each read once, until the next
  release.

- The CLI crashed with an EPIPE stack trace when the program reading its output or its messages
  stopped early; 0.1.0 does too. `satchel-nft show --network mainnet 1 | true` exited 1 with that
  trace, and `verify --bogus 2>&1 | true` exited 1 instead of 2. Now the printing stops, on stdout
  and stderr, and the command keeps its own exit code: those two exit 0 and 2, and
  `verify 5 | true` still exits 1, as bash's `${PIPESTATUS[0]}` shows (`$?` is the reader's code).
  Run by hand on 0.1.0 from npm and on this build; AGENTS.md's rules table has the line. In the
  docs, "Run the web app yourself" now compares the app with `npx satchel-nft` from the checkout,
  since the pinned command runs npm's 0.1.0.

- A page with a saved wallet connection showed "Looking for your wallet…" and the header's
  placeholder for as long as the wallet didn't answer. Meteor's extension, locked, once didn't
  answer for over 17 seconds, until it was unlocked; later loads with it locked answered within 2
  seconds. After 8 seconds the page now offers **Connect wallet** (checked with Meteor's script
  held back: the switch came at 8.3 s, in the room and the header); it still takes an
  account the wallet names later, unless the user has connected or disconnected since, or another
  wallet was saved meanwhile by a connect that failed inside it (`restoreAccount` and
  `fromSameWallet` in `web/src/lib/restore.ts`, 7 tests). Closing the wallet picker leaves the
  wait running, so the page still gets there (checked the same way: **Connect to buy** clicked at
  3.1 s, the picker closed at 4.3 s, **Connect wallet** at 8.2 s). The app has 27 unit tests, as
  the README and AGENTS.md now say; the README no longer counts the rules without one.
  Troubleshooting has a row for it, and AGENTS.md's rules table one more line.
- The README's step 5 ran the package's tests with no install before it, which only worked after
  step 4's optional install. It now says to run `npm ci -w satchel-nft` first if you skipped it.
- The buy panel's gold border never showed, because the card's own border color won; it shows now.
  A long seller account wraps instead of running out of the panel.
- Counts that had gone stale: the threat model has 33 attacks, not 32 (README); the app has 15 unit
  tests, not 3 (README); the docs' security page said 59 contract and 94 package tests (now 61 and
  191). The README banner said the checks run "with npm run verify", which only works inside `web`;
  it now says `npx satchel-nft verify`. The README, AGENTS.md, threat model row 21g and the docs
  name the 9 satchels the derived-key fixture covers (testnet #1 to #8, mainnet #1) instead of "all
  8 satchels", which stopped being true once testnet satchel #8 was minted.
- The README's quick-start output for satchel #1 showed its record before its last signature
  (`max_nonce` 3, 6 signatures, version 6). It now shows what the chain returns: `max_nonce` 4,
  7 signatures, version 7.
- `satchel-nft market`, the web app's market and its "listed now" count could miss listings. The
  contract's `listings` view pages its stored listings and only then drops the stale ones (seller no
  longer owns the token), so a page can come back short, or empty, with more listings after it. The
  CLI stopped at the first page under 100 rows and the app read only the first page. The package now
  has `satchel(net).allListings()`, which reads pages until they cover `nft_total_supply` (each
  stored listing is keyed by a token, and tokens are never burned) and keeps a listing that shows up
  twice once; the CLI and the app use it. The deployed contract is unchanged. It is not in 0.1.0.
  3 new unit tests, 114 in all.
- The npm package's files kept Windows line endings in a Windows checkout, so 0.1.0, packed there,
  ships CRLF in five files, the end of its launcher's first line among them. npm strips that CR when
  it links the command on Linux and macOS, so `npx` runs it, and CI now checks that on Linux. The
  `.gitattributes` keeps the package's files LF in every checkout, so the next release won't.
- `docs/assets/src/screenshots.mjs` left the headless browser running on Windows, where it relaunches
  itself under another process id, then crashed removing its profile. It now closes the browser over
  DevTools, takes only the shots you name, and waits for balances still loading. The README's
  mainnet screenshot is now satchel #1's page.
- The web app's title and footer said Satchel is a wallet on every EVM chain. It is one wallet on
  16 EVM chains: the contract signs only for the chain ids in `SUPPORTED_CHAINS`.
- No pull request could merge: the ruleset on `main` and `dev` requires a check named `verify`,
  which no job reported. Every pull request now runs `.github/workflows/ci.yml`, which calls the
  contract and web workflows and adds `verify`, a job that passes only when both pass. The web checks
  now run on every pull request, not only on ones that touch `web/`. Pushes to `main` and `dev` run
  the two workflows directly, as before.
- `AGENTS.md` placed `SUPPORTED_CHAINS` in `lib.rs`; it is in `contracts/satchel/src/evm.rs`.
- `SECURITY.md` still said Satchel was on NEAR testnet only and named only the testnet contract. It
  now covers both deployments and says what a mainnet satchel's address holds.
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
- `node scripts/check-dao.mjs` printed `4 of 5 claims hold`, or `3 of 5` when the archival NEAR node
  answered HTTP 429: on 2026-11-12 its default Sepolia node,
  `https://ethereum-sepolia-rpc.publicnode.com`, returned the DAO's Sepolia transaction but a null
  receipt for it. With `SEPOLIA_RPC` unset, a Sepolia read that node fails, or answers with null,
  now goes to `https://1rpc.io/sepolia`, then `https://sepolia.gateway.tenderly.co`, and a line
  after the count names the nodes that answered. A read a NEAR or Sepolia node answers with HTTP
  408, 429 or 5xx, or whose connection fails, is sent up to 3 more times, 1, 2 and 4 s apart, or
  longer if the node's Retry-After asks, up to 8 s (FastNEAR's archival node sends `retry-after: 0`
  with its 429s); any other read that fails is tried once more, 2 s later. With `NEAR_ARCHIVAL_RPC`
  unset, an archival read FastNEAR's node still doesn't answer goes to
  `https://archival-rpc.testnet.near.org`; once FastNEAR's has failed a read that NEAR's answered,
  later archival reads go to NEAR's node first, and a line names it too. A claim that fails only
  because a node didn't answer, an error page such as a 403 included, says it is not a change to any
  satchel, and which variable to set; one that fails because every Sepolia node asked answered
  without the transaction says that instead. A NEAR transaction is now read with `wait_until`
  `NONE`, so a wrong hash fails at once with the node's `UNKNOWN_TRANSACTION` error; with `FINAL`,
  the node held the request about 30 s and answered 408, which read as a node not answering. Still 5
  claims. On 2026-11-12, run right after
  `check-claims.mjs`, which reads the same archival node, FastNEAR's still answered HTTP 429 after
  every retry in 2 of 5 runs (`4 of 5`, `1 of 5`). With the archival fallback, 4 runs of 4 started
  the same way printed `5 of 5 claims hold`, one of them through NEAR's node.

### Security

- From an adversarial review of the CLI's signing, which found no way to make it send a transaction
  other than the one it shows: it runs the near CLI by its absolute path, from `--near-cli`,
  `$NEAR_CLI` or PATH's absolute folders only, since Windows runs a `near.exe` from the current
  folder before PATH; it builds nothing from a token view about another token; a transaction counts
  as done only once its status is final; a transaction sent but not read back exits 3 with its hash,
  where it exited as "could not run" and invited a second send; input that ends before an answer is
  a no, where it exited 0; it asks only when both stdin and stderr are terminals; a byte order mark
  in the signed transaction fails the comparison; `--as` must be a NEAR account id. Not fixed then,
  and in the threat model: a satchel's address came from one NEAR RPC (derived locally since, not in
  0.1.0; see Added), and with `--yes` nothing caps a send's fee.
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
