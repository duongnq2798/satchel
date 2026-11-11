# Demo kit

What the builder needs to record Satchel's demo video, post it on X and submit Satchel to the NEAR
Hackathon 2026. The rules quoted here come from [nearhackathon.com](https://nearhackathon.com) and its
[HACKATHON.md](https://nearhackathon.com/HACKATHON.md), read on 2026-11-10. Every screen and line
below is what satchelnft.xyz and `satchel-nft` showed that day. The open holder room at 1:30 was
seen on mainnet satchel #1, opened with Meteor's Chrome extension; testnet rooms were opened with
near-cli-rs and curl.

`node scripts/check-demo-kit.mjs` checks the numbers this kit depends on: the form text's length, the
X post's length, tags and question, the script's timing and the pages it opens. CI runs it on every
pull request.

## The rules this kit follows

| Rule | Where it comes from |
| --- | --- |
| The demo post is public on X, says the project was built at NEAR HACKATHON, tags @NEARProtocol and #NEARHackathon, and has the video or screenshots attached. @NearLegion and @NearBuilders are optional | HACKATHON.md, "2. The demo post"; nearhackathon.com, "Final submission" |
| A good post leads with the user problem, shows one complete moment from a real user action to a visible result, says concretely what NEAR enables, and gives a next step: "Link the demo and public repo, and ask a genuine question or invite specific feedback". This kit's post asks a question | HACKATHON.md, "A good demo post" |
| Screenshots are not enough when judges can't open the demo; a hosted demo is a plus. Keep it up until 2026-11-18, ideally 2026-11-25 | HACKATHON.md, Q-012 |
| "What did you build?" takes 20 to 2,000 characters | The form, and HACKATHON.md, "Submission API" (`idea`) |
| The prize account is a mainnet NEAR account: a named one such as `team.near`, or a 64-character implicit one | HACKATHON.md, "What the human decides" |
| The form's Website field must stay empty: "`website` is a spam trap: any non-empty value rejects the submission" | HACKATHON.md, "Submission API" |
| One submission per project. A mistake is fixed through [request-changes](https://nearhackathon.com/request-changes), never by submitting again. One email may submit at most 2 projects | HACKATHON.md, "3. Submit" and "Submission API" |
| Submit when the repository is public and the post is up, through the form or the API, not both. A coding agent sends the API request only after it has printed the full JSON payload and the builder has said yes. The payload holds personal data, so it is never committed | HACKATHON.md, "Never without the human's explicit confirmation" and "3. Submit" |
| The consent notice is read to the builder word for word before they agree | HACKATHON.md, "What the human decides" |
| Read the live HACKATHON.md again before submitting: "dates and rules may change" | HACKATHON.md, its first paragraph |
| The README lists the libraries, templates and AI-written code used ([Libraries, templates and AI-assisted code](../README.md#libraries-templates-and-ai-assisted-code)), the repository has a LICENSE file (MIT), and each of one person's two projects names the other in its README ([Other project by the same builder](../README.md#other-project-by-the-same-builder)) | HACKATHON.md, Q-005, Q-014 and Q-015 |
| Submissions close on 2026-11-14 at 23:59 UTC | nearhackathon.com |

## Before you record

- **Browser.** A fresh Chrome profile or a guest window, so no extension or bookmark shows. Set the
  window to 1280 × 720, or record at 1920 × 1080 with the page zoomed to 150 %. Every scene below
  but the open room at 1:30 was laid out at 1280 × 720; lay that one out in the rehearsal.
- **Open three tabs, each about ten seconds before its take:**
  [satchelnft.xyz](https://satchelnft.xyz) (start at the top; the take scrolls down to "Try to cheat
  the buyer."), [satchelnft.xyz/satchel/7](https://satchelnft.xyz/satchel/7) and
  [satchelnft.xyz/mainnet/satchel/1](https://satchelnft.xyz/mainnet/satchel/1). The fourth, the
  holder room of your own satchel (`/satchel/<id>/room`, or `/mainnet/satchel/<id>/room` for a
  mainnet one), goes in a window of its own: see "A wallet for the 1:30 scene" below. The landing
  page reads all six examples while it loads, so each click in "Try to cheat the buyer" answers at
  once. Satchel #7's page took 2.4 s for "What's inside", 3.0 s for its report and 4.3 s for its
  history on 2026-11-10; mainnet satchel #1's took about 7 s.
- **Terminal.** bash (Git Bash on Windows), Node 22 or later, font size 18 or larger. Run
  `npx -y satchel-nft@0.2.0 verify 5; echo "exit $?"` once before recording: the first run downloads
  the package (142 s and 230 s in two runs here), later ones take 6 to 11 s. The CLI doesn't print its
  exit code, so the `echo` shows it. In the edit, cut the wait.
- **A wallet for the 1:30 scene, in a window of its own.** The room opens only for the account that
  owns the satchel right now, so record it with a wallet that owns one.
  - **Use a second fresh Chrome profile** for the room, and never connect a wallet in the window
    with the other three tabs. A connected wallet stays connected in every satchelnft.xyz tab of its
    profile on its network (testnet pages and `/mainnet` pages keep separate connections), and on a
    satchel that account owns, the page shows "Owned by you", "Send from this satchel" and "Sell or
    transfer". `satchel-nft.testnet` owns #7, and `satchel-nft.near` owns mainnet #1: the takes of
    those two must not show them. The optional mint take shows them on its new satchel, which is
    fine.
  - **The wallet.** Every wallet the app offers says it signs messages (NEP-413): Meteor, Intear,
    Nightly, Ledger and NEAR CLI on testnet, and HOT and MyNearWallet as well on mainnet; one that
    can't gets a message saying so. Meteor and Intear (and MyNearWallet on mainnet) are web wallets:
    import the account into one in that profile before any take that uses it. Nightly is an
    extension only, so it needs a profile with Nightly installed, and its icon then shows in the
    toolbar. HOT, mainnet only, lists its extension, its phone app and Telegram.
  - **No satchel yet?** If none of your accounts owns one, mint one in that profile at
    [satchelnft.xyz/satchels](https://satchelnft.xyz/satchels) (0.1 testnet NEAR plus gas), or
    record the optional mainnet mint below there; a new satchel touches none of the demo satchels
    above.
  - **Unlock the wallet before you open the room's tab.** Once, with Meteor's extension locked, the
    page stayed at "Looking for your wallet…" until it was unlocked.
  - **Rehearse once:** connect the wallet in the room's tab, click **Open the room**, approve, then
    reload the tab. The page held the signature only in memory and the server stores nothing, so
    the take starts at **Open the room** again, with the wallet still connected. In the take, don't
    click **Check again**: it resends the signature without asking the wallet.
  - The other scenes need no wallet, except the optional mint.
- **Captions.** X starts videos muted, so burn the "Caption" column into the video.
- **Export** MP4 (H.264, 30 fps, 1280 × 720 or 1920 × 1080). Keep it at 2:00: X plays up to 2:20
  for an account without Premium.

## The video (2:00)

Voice-over at an unhurried pace, about 150 words a minute. The checker counts the words of each "Say"
cell against its time.

| Time | Screen | Do | Caption | Say |
| --- | --- | --- | --- | --- |
| 0:00–0:08 | satchelnft.xyz, top of the page: "Sell a wallet. Prove nothing stayed behind." | Hold still | Selling a wallet is easy to fake | Selling a crypto wallet is easy to fake. The seller signs a withdrawal, sells you the wallet, then empties it. |
| 0:08–0:22 | Same page, the card on the right, then scroll to "Selling a wallet is easy to fake." | Scroll slowly | 1 NFT = 1 address on 8 EVM chains and their testnets, with NEAR Chain Signatures | Satchel makes the wallet an NFT on NEAR. With Chain Signatures, NEAR's MPC network signs for it: one NFT, one address on eight EVM chains and their testnets, controlled by whoever owns the NFT. |
| 0:22–0:46 | "Try to cheat the buyer." | Click **Keep a signed withdrawal**. Point at "A signed transaction may still be pending" | A 10,000 ETH send, signed and kept: caught | Try to cheat a buyer. This seller kept a signed 10,000 ETH send. Before anything is signed, the contract records it: the highest nonce it signed on each chain, every approval, and a count of anything else. The buyer's browser compares that record with Sepolia and flags it: not provable. |
| 0:46–1:02 | Same section | Click **Leave an approval behind**, then **Play fair** | Approval left live: caught. Nothing kept: provably clean | An approval left for the seller's other address is caught too. Satchel #1 has spent every nonce it signed, approved nothing and signed nothing raw, so it reads provably clean. |
| 1:02–1:18 | Same section | Click **Change it after the buyer checked**. Point at the refused `buy` | Changed after the check: the buy is refused | Listing freezes signing, and the purchase names the record version the buyer checked. This seller changed it after the check, so the contract refused the buy and refunded. |
| 1:18–1:30 | satchelnft.xyz/satchel/7 | Scroll through "What's inside", the report, then "History" | What it holds, the four checks, its history | This satchel's page shows what it holds on eight testnets, the four checks, and its history. One NEAR transaction moved the NFT and its address on every chain. |
| 1:30–1:42 | The holder room of a satchel your wallet owns, `/satchel/<id>/room` (see "Before you record") | Scroll to **Open the room**, click it and approve the message in the wallet; cut the wait. Scroll to "Checked at" in the card "You hold satchel #…", point at it, then scroll to "Handover kit" | Only the current holder gets in, checked at a final NEAR block | Only the current holder opens this room: the wallet signs a message, the server checks the owner at a final NEAR block. Sell it, and the buyer gets in. |
| 1:42–1:52 | satchelnft.xyz/mainnet/satchel/1 | Point at Base, 0.00184 ETH, then "Provably clean" | Live on NEAR mainnet. The contract has 0 access keys | Live on mainnet: this satchel sent real ETH on Base and reads provably clean. The contract has no keys; no one can change it. |
| 1:52–2:00 | A terminal: `npx -y satchel-nft@0.2.0 verify 5; echo "exit $?"`, then an end card: "Sell a wallet. Prove nothing stayed behind. satchelnft.xyz · github.com/duongnq2798/satchel · Built at NEAR HACKATHON" | Run it; cut to the output: `NOT PROVABLE`, then `exit 1` | Same check, any terminal | The same check runs in any terminal. Satchel: sell a wallet, prove nothing stayed behind. |

What each scene shows, so the edit can't drift from the chain:

- **0:22.** Satchel #5. Its report says "Sepolia: signed up to nonce 0, finalized nonce is 0" and
  links the `sign_evm` transaction that was never broadcast.
- **0:46.** Satchel #3, which approved satchel #2's address, owned by the same seller, to spend its
  USDC without limit; then satchel #1, which had seven Sepolia transactions signed at nonces 0 to 4.
  Every one of those nonces is spent: "Sepolia: signed up to nonce 4, finalized nonce is 5".
- **1:02.** Satchel #6: listed clean at record version 0, delisted, a raw payload signed, listed
  again at version 1. A `buy` naming version 0 was refused on chain, and the 1 NEAR came back.
- **1:18.** Satchel #7: minted, sent once on Sepolia, listed, delisted, listed, sold to
  `buyer.satchel-nft.testnet`, handed back, listed and delisted, each with the `satchel-nft` CLI.
- **1:30.** Your own satchel's holder room. The card "You hold satchel #…" lists your account, the
  satchel, the network, "Checked at" with the final NEAR block the server read the key and the owner
  at, and the key. For a satchel that has signed nothing, "Handover kit" says "The satchel reads
  clean". On 2026-11-10 the same request, a `POST /api/room` on satchelnft.xyz signed with
  near-cli-rs for satchel #4, opened the room for its owner at block 277,055,444 and was refused with
  a 403 naming the owner for `buyer.satchel-nft.testnet`. With the page 1280 × 630 px, about what a
  1280 × 720 window leaves under the browser's bars, the card with **Open the room** starts 536 px
  down, so the take scrolls to the button; the holder card and the kit open in its place. Later that
  day Meteor's Chrome extension, connected as `satchel-nft.near`, opened mainnet satchel #1's room:
  the holder card at block 223,915,441 and "The satchel reads clean". In a window 1920 px wide the
  holder card started 538 px down, "Checked at" 662 px and "Handover kit" 855 px. Rehearse it as
  "Before you record" says.
- **1:42.** Mainnet satchel #1: one send on Base at nonce 0, "Base: signed up to nonce 0, finalized
  nonce is 1", and 0.00184 ETH left.
- **1:52.** Satchel #5 again, from the terminal; the command exits 1.

## Optional scene: mint one live (mainnet, 0.1 NEAR)

This replaces 1:18–1:30 when you want a mint in the video. It needs a mainnet wallet with about
0.2 NEAR: the mint costs 0.1 NEAR, plus gas. It adds a satchel and touches none of the demo
satchels. Record it in the room's profile, not in the window with the other tabs, and in this order,
so the 1:30 scene opens the new satchel's room on mainnet:

1. Record the mint take, with no wallet connected yet in that profile.
2. Off camera, open the new satchel's `/mainnet/satchel/<id>/room` and rehearse as "Before you
   record" says: open the room, then reload.
3. Record the 1:30 take in that tab. On this path the main window needs only the landing page and
   mainnet satchel #1.

| Time | Screen | Do | Caption | Say |
| --- | --- | --- | --- | --- |
| 1:18–1:30 | satchelnft.xyz/mainnet/satchels | Click **Connect wallet** and sign in, click **Mint a satchel · 0.1 NEAR** and approve in the wallet; the app opens the new satchel. Cut the waits in the edit | Minted live on mainnet: empty, provably clean | One click mints a satchel on mainnet. Its address is empty on all eight mainnets, and its report reads provably clean: it has signed nothing yet. |

## The X post

Post [`submission/x-post.txt`](submission/x-post.txt) as it is, with the video attached. It leads
with the problem, names Chain Signatures, asks a question, and links the app and the repository. It
fits one post: X counts each link as 23.

If you change the text, run `node scripts/check-demo-kit.mjs`: it checks the length, that the post
still says NEAR HACKATHON and tags @NEARProtocol and #NEARHackathon as whole tags, and that it still
asks a question. Its count is close to X's, not exact: it counts any dotted name as a link, so a
NEAR account longer than 23 characters, such as `buyer.satchel-nft.testnet`, counts 23 there and in
full on X. Check the counter in X's composer before you post.

## The submission form

On [nearhackathon.com](https://nearhackathon.com), "Final submission", after the post is up. The same
fields go to HACKATHON.md's API if a coding agent submits instead, and only after it has printed the
whole JSON payload and you have said yes. Use one way, once:

| Field | Value |
| --- | --- |
| Project name | Satchel |
| Team lead | Your name |
| Email address | The email you use for the hackathon. It may submit 2 projects at most |
| Team size | 1 — Solo builder (the API's value for it is `1`) |
| Tracks | NFTs That Do Something, Open Innovation, Unstoppable DeFi (see below) |
| NEAR wallet address | Your own mainnet account, in lowercase: a named `.near` account or a 64-character implicit one, never a `.testnet` account. A prize, if any, is sent here |
| Repository link | https://github.com/duongnq2798/satchel |
| Demo post link | The URL of your X post |
| What did you build? | The whole of [`submission/what-did-you-build.txt`](submission/what-did-you-build.txt) |
| Website | **Leave it empty.** It is a spam trap: any value rejects the submission |
| Consent | Read the notice, then tick it if you agree: "I agree that the organizers may use these details to review our submission and contact us about this hackathon." |

## Tracks

| Track | Why Satchel fits |
| --- | --- |
| **NFTs That Do Something** (`nfts`), the main one | Its brief asks for "NFTs as accounts — assets that own money". A satchel is an NFT that owns an address on eight EVM chains and their testnets. The track's example prompt asks the README to explain "what stops the old owner from keeping access", a threat model of "every way a seller could try to keep the money", a gated page only current holders can open, and a history view per NFT (what it earned, what it paid out, who held it); Satchel has the first three (the gated page is each satchel's holder room, `/satchel/<id>/room`), and part of the fourth: its history lists owners, sales and signatures, not each payment that came in |
| **Open Innovation** (`open`) | Its hints name chain abstraction: one NEAR transaction moves an address on every chain it lives on |
| **Unstoppable DeFi** (`defi`) | Its hints name NEAR Intents and Chain Signatures. A satchel changes hands in one NEAR transaction with no custodian or escrow, and whatever its address holds moves with it. On mainnet, satchel #2 swapped its ETH on Base for USDC at its own address on Arbitrum One through NEAR Intents' 1Click: the deposit was a plain transfer sent from the app, so it still reads provably clean. The proof is narrower than that sounds: the USDC arrived only because 1Click's system sent it, the report doesn't count what is in flight, and a satchel that has itself made a call the contract can't classify, such as a swap through a DEX router or an LP deposit, reads "not provable" for every later owner, as the README says. This is the loosest of the three fits |

## Keep the demo true until judging ends

The README, AGENTS.md and the landing page (`web/src/lib/copy.ts`, and the `verify 5` output in
`web/src/app/page.tsx`) describe the demo satchels as they are now. `scripts/check-claims.mjs` reads
past transactions, the contract's keys and code, the MPC keys, satchel #2's Base balance and nonce at
block 55857952 and 1Click's live status for its deposit, so it doesn't notice a change to a satchel.
Its mainnet run fails with no satchel changed if `https://base-rpc.publicnode.com` stops serving that
block's state (it served it on 2026-11-11), or if 1Click stops answering for satchel #2's deposit
address: run it again before judging, and if the Base read is what fails, set `BASE_RPC` to an
archive node.
Until 2026-11-25:

- Don't sign anything with testnet satchels #1, #3, #5, #6, #7 or #8, or with mainnet satchels #1
  and #2. A new signature changes the report lines quoted in the README; one with satchel #5 at
  nonce 0 would end the "signed and kept" example. Mainnet #2 holds the USDC of its swap through
  1Click on Arbitrum One: leave it there.
- Don't list, delist, re-list, buy or transfer any demo satchel: testnet #1 to #8 or mainnet #1 and
  #2. The landing card reads #1's owner live beside its hand-over from `satchel-nft.testnet`; #3's example
  says #2's address belongs to the same seller; the README and the 1:18 scene show #7's history; #4
  is for sale for 1 NEAR at record version 0 and #6 at record version 1, and `list` on a listed
  satchel replaces its price; `buyer.satchel-nft.testnet` owns #8, as the DAO walkthrough ends;
  `satchel-nft.near` owns mainnet #1 and #2.
- Keep satchelnft.xyz up (Q-012), and the repository public (Q-014).

If one of these has to change, run `npx -y satchel-nft@0.2.0 verify <id>` for testnet #1, #3, #4,
#5, #6 and #7, `npx -y satchel-nft@0.2.0 verify --network mainnet 1` and `2`, and the README's quick-start
`satchel` view for #1. Then update the README's quoted outputs, AGENTS.md's table,
`web/src/lib/copy.ts`, `VERIFY_OUTPUT` in `web/src/app/page.tsx` and this kit's scene notes in the
same pull request.
