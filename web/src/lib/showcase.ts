import { CHAINS, MAINNET, NETWORKS, type Network, type NetworkId, TESTNET, chainInfo, nearTxUrl } from "satchel-nft";
import type { TxLink } from "./copy";

/**
 * The guided path for a judge or a buyer: the mainnet satchels, two that sent real ETH and one sold to
 * a second account, the demo satchels with one line each, and the command that checks any of them from
 * a terminal. The numbers come from deployments/; showcase.test.ts reads those files and fails on any
 * drift. A card tells what happened, never the verdict: that is read live on the satchel's page. The
 * deed of #3's sale quotes its two reports, each with the time it was read.
 */

/** The terminal command that prints satchel `tokenId`'s report on `net`, from the release on npm. */
export function verifyCommand(net: Network, tokenId: string): string {
  return `npx -y satchel-nft@0.2.0 verify ${net.id === "mainnet" ? "--network mainnet " : ""}${tokenId}`;
}

/** What a satchel's page shows, for its description in search results and share cards. */
export function tokenDescription(net: Network, tokenId: string): string {
  return `Satchel #${tokenId} on NEAR ${net.id}: its address on ${CHAINS.length} EVM chains, what it holds, and its clean transfer report, checked in your browser.`;
}

/** What a satchel's holder room is, for its description. */
export function roomDescription(net: Network, tokenId: string): string {
  return `The holder room of satchel #${tokenId} on NEAR ${net.id}: its current owner signs a message to open a holder card and a handover kit.`;
}

/** What a satchel's page checks and how to check it without the page, for a reader that runs no JavaScript. */
export function tokenPageNote(net: Network, tokenId: string): { text: string; command: string } {
  return {
    text:
      `This page reads satchel #${tokenId} from ${net.contract} on NEAR ${net.id} and runs its clean transfer report in ` +
      "your browser: whether the contract can sign behind its record, whether a signed transaction may still be " +
      "pending, whether an approval is still live, and whether the record explains everything signed. The same " +
      "report from a terminal, with Node 22 or later and no wallet:",
    command: verifyCommand(net, tokenId),
  };
}

const BASE = 8453;
const ARBITRUM_ONE = 42161;

function evmTxUrl(chainId: number, hash: string): string {
  const chain = chainInfo(chainId);
  if (!chain) throw new Error(`No explorer for chain ${chainId}`);
  return `${chain.explorer}/tx/${hash}`;
}

/** Mainnet satchel #1's one send, from its page in this app (deployments/mainnet-first-send.json). */
export const FIRST_SEND = {
  tokenId: "1",
  address: "0xdC269Ead17B522d49db2ceFD38CEF0C5413868F9",
  chainId: BASE,
  mintTx: "HCYB168yrYuR7U4THAbKZqyMgZ6pzSnWWNhLQNQJEU8g",
  /** ETH on Base, at nonce 0. */
  sent: "0.0001",
  signTx: "2xqwe8AAWwvssHNCMUioME2SCJeYAKcneV8iVCpa1Cj4",
  sendTx: "0x8044dd8cd53ea5aa7165b031098450d64a6c6910fc0cc9c3e138a480e6ac9532",
} as const;

/** Mainnet satchel #2's swap through NEAR Intents' 1Click (deployments/mainnet-1click-exit.json). */
export const ONECLICK_EXIT = {
  tokenId: "2",
  address: "0xf5383275EFedde8B90F59de8E8D15b1E23B4965f",
  mintTx: "8NE2xLniZaPhbitfZiD2qww1P1nC1zqQQ3QBTCdjYo1d",
  /** ETH on Base, sent at nonce 0 to the deposit address of 1Click's quote. */
  sent: "0.00258",
  depositAddress: "0x588f8C4419974bC735Ac784B3dA41B44c42bb64b",
  signTx: "FnFSMSh1dpjkYC6fMT2aSgvFNYUjyuc6xVLGAymcupEA",
  depositTx: "0x2d9b1a1c1b25c4443390af46dd176af24b93ebbb9e59d602bec76d585b607d74",
  /** USDC on Arbitrum One, at the satchel's own address. */
  received: "5.280549",
  payoutTx: "0x417322bdacc90439ada251ab53ca96117f4c5dcda5ad9671636b2dcd45243209",
} as const;

/**
 * Mainnet satchel #3's sale to a second account, and its old owner refused after it
 * (deployments/mainnet-sale.json): every fact the deed of sale shows, and three it leaves out that the
 * test checks against the record too (the first report's owner, and the blocks the payment and the
 * refusal ran in). A self-sale, both accounts the builder's. Times are UTC as the record has them.
 * A block is the one that included the transaction; its receipts ran in later blocks.
 */
export const MAINNET_SALE = {
  tokenId: "3",
  /** The MPC derivation path, and the address it gives on every EVM chain. */
  path: "satchel/3",
  address: "0x2bc44B0D9D05A2a1161AB6f560501Ca870A172A7",
  seller: "satchel-nft.near",
  buyer: "duongnq2798.near",
  /** NEAR, the listing's price. */
  price: "0.1",
  /** What the listing and the buy named. Nothing was ever signed for #3, so it never moved. */
  recordVersion: "0",
  /** `deposit`: NEAR, what the mint paid for the token's storage. */
  mint: { at: "2026-11-13T01:19:15Z", tx: "mHornX2SqE442ikUyZoZwreSm9cSdrYAF4vneWmLVwn", block: "224293453", deposit: "0.1" },
  list: { at: "2026-11-13T01:19:27Z", tx: "7xzmgbStV7o5WL2DrFA2qw8hqRftv5qwp1UwcGh4UCB6", block: "224293475" },
  /** The buyer's report before paying: a read, no transaction. */
  checked: { at: "2026-11-13T01:19:34.480Z", result: "PROVABLY CLEAN", owner: "satchel-nft.near" },
  buy: {
    at: "2026-11-13T01:21:35Z",
    tx: "FFYeAebswG8wHUwLXpmtd7okAxExZwtLMPgwSQUx3Kbo",
    block: "224293699",
    /** The receipt that paid the seller the price. */
    paid: { receipt: "EbK3MHAkHahfDSNF3BpEQd2hbKceVjcHKrtAHT2HjTjH", to: "satchel-nft.near", block: "224293701" },
  },
  /** The old owner's sign_evm after the sale, 0 wei to 0x…dEaD on Base, and the owner check's answer. */
  refused: {
    at: "2026-11-13T01:21:56Z",
    tx: "33UTwyVyAf6CQY5a953rtdmAyF98WZKVwAnqAdY3Vk6X",
    block: "224293735",
    receiptBlock: "224293736",
    chainId: BASE,
    to: "0x000000000000000000000000000000000000dEaD",
    value: "0",
    panic: "Smart contract panicked: Satchel: only the token's owner can do this",
  },
  /** The report again after the refusal, for the new owner. */
  checkedAgain: { at: "2026-11-13T01:22:31.790Z", result: "PROVABLY CLEAN", owner: "duongnq2798.near" },
} as const;

/**
 * `node scripts/check-claims.mjs --network mainnet`, as the README counts it: its claims, and how many
 * of them, the last ones, check satchel #3's sale. The deed's terminal quotes both.
 */
export const MAINNET_CLAIMS = { total: "20", sale: "five" } as const;

/** Whole seconds from `from` to `to`, counted from the times as the deed shows them: cut to the second. */
export function secondsBetween(from: string, to: string): number {
  return Math.floor(Date.parse(to) / 1000) - Math.floor(Date.parse(from) / 1000);
}

/** A span the way the deed writes it: "21 s", "3 min 16 s"; `long` spells it out for a screen reader. */
export function formatSpan(seconds: number, long = false): string {
  const [m, s] = [Math.floor(seconds / 60), seconds % 60];
  const unit = (n: number, short: string, word: string) => (long ? `${n} ${word}${n === 1 ? "" : "s"}` : `${n} ${short}`);
  return m ? `${unit(m, "min", "minute")} ${unit(s, "s", "second")}` : unit(s, "s", "second");
}

/** "01:19:34 UTC": an ISO time's (or epoch milliseconds') time of day, cut to the second. */
export function utcTime(at: string | number): string {
  return `${new Date(at).toISOString().slice(11, 19)} UTC`;
}

/**
 * "2026-11-13 01:19:34 UTC": an ISO time (or epoch milliseconds), cut to the second, in UTC whatever
 * the viewer's time zone, as the deed and the history write theirs, so no time reads like tomorrow's.
 */
export function utcDateTime(at: string | number): string {
  return `${new Date(at).toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

/** "13 November 2026": an ISO time's day, in UTC. */
export function utcDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export interface ShowcaseCard {
  tokenId: string;
  title: string;
  subtitle: string;
  address: string;
  story: string;
  txs: readonly TxLink[];
}

/**
 * The mainnet satchels that sent real ETH from this app, each with the transactions behind its story.
 * Satchel #3 sent nothing: its card, after these, is a small deed of its sale (components/landing/deed).
 */
export const SHOWCASE: readonly ShowcaseCard[] = [
  {
    tokenId: FIRST_SEND.tokenId,
    title: `${FIRST_SEND.sent} ETH sent on Base`,
    subtitle: "from this app, signed by NEAR's MPC network",
    address: FIRST_SEND.address,
    story: `Minted by satchel-nft.near, which then sent ${FIRST_SEND.sent} ETH from the satchel's page here. The contract recorded Base at nonce 0 before ${MAINNET.mpc} signed, and the app checked that the signature recovers to the satchel's address before it broadcast the send.`,
    txs: [
      { label: "Mint", href: nearTxUrl(MAINNET, FIRST_SEND.mintTx) },
      { label: "sign_evm on NEAR", href: nearTxUrl(MAINNET, FIRST_SEND.signTx) },
      { label: "The send on Base", href: evmTxUrl(BASE, FIRST_SEND.sendTx) },
    ],
  },
  {
    tokenId: ONECLICK_EXIT.tokenId,
    title: `${ONECLICK_EXIT.sent} ETH on Base swapped for ${ONECLICK_EXIT.received} USDC on Arbitrum One`,
    subtitle: "through NEAR Intents' 1Click",
    address: ONECLICK_EXIT.address,
    story: `1Click quoted the swap with the satchel's own address as recipient and refund address, and gave a deposit address on Base. The owner sent ${ONECLICK_EXIT.sent} ETH there from the satchel's page here, a plain transfer that the contract recorded like any other send. ${ONECLICK_EXIT.received} USDC then reached the same address on Arbitrum One, and 1Click's status names it as this deposit's payout. The report covers what the satchel's key signed, not a swap still in flight.`,
    txs: [
      { label: "Mint", href: nearTxUrl(MAINNET, ONECLICK_EXIT.mintTx) },
      { label: "sign_evm on NEAR", href: nearTxUrl(MAINNET, ONECLICK_EXIT.signTx) },
      { label: "The deposit on Base", href: evmTxUrl(BASE, ONECLICK_EXIT.depositTx) },
      { label: "The USDC on Arbitrum One", href: evmTxUrl(ARBITRUM_ONE, ONECLICK_EXIT.payoutTx) },
      {
        label: "1Click's status, as JSON",
        href: `https://1click.chaindefuser.com/v0/status?depositAddress=${ONECLICK_EXIT.depositAddress}`,
      },
    ],
  },
];

const SEPOLIA = 11155111;

/** Testnet satchel #8's two votes (deployments/testnet-dao.json). */
const DAO_RUN = {
  tokenId: "8",
  buyer: "buyer.satchel-nft.testnet",
  signVote: "2ryQpsJRq8zQwxCdHzJszi5dBBxjECF4Jt59J1NmPG4M",
  sendTx: "0x27e3262bb3208da84ab3332b018f9f88210b69ec4d85ed5b5299238a38945ba3",
  transferVote: "6GSVLR17camU72fkcVyt58Ryo9SpscNE3RhdDo5rHABg",
} as const;

/** Testnet satchel #9: the state it was left in for Make it clean, then the clean-up (deployments/testnet-make-clean.json). */
const MAKE_CLEAN = {
  tokenId: "9",
  /** When the state was set up. */
  date: "2026-11-11",
  approveTx: "0xdeef1d5c70b00db68cf1fa2fc568535bd12686b4c690d6218f82f5dba88cab42",
  spenderSatchel: "7",
  /** The card's two sends from the owner's wallet, on Sepolia: the revoke at nonce 1, the send of 0 at nonce 2. */
  cleaned: {
    date: "2026-11-12",
    revokeTx: "0xe7fdde14c08ce7f43bbc3ef940634cf4eddabc308188d76bb53a929f69661b13",
    spendTx: "0xd44a2279073fe923b87503c93b6e82aa4abd43dbecc80739e274d19412184f10",
  },
} as const;

export interface TourCard {
  network: NetworkId;
  tokenId: string;
  /** The NEAR piece it shows. */
  tech: string;
  title: string;
  body: string;
  /** The satchel's page, or its room, on its network's side of the site. */
  path: string;
  cta: string;
  /** The docs page that explains it. */
  docs: string;
  txs: readonly TxLink[];
}

/**
 * What a satchel does beyond a sale, one card each, for the landing page. Like the showcase, a card
 * tells what happened and leaves the verdict to the satchel's live page.
 */
export const TOUR: readonly TourCard[] = [
  {
    network: "testnet",
    tokenId: "4",
    tech: "NEP-413 · NEAR Connect",
    title: "A room only the holder opens",
    body: "The holder's wallet signs a NEP-413 message: no transaction, no fee. The server checks the signature, that the key has full access and that the account owns the satchel at one final block, then shows a holder card and a handover kit. Sell or transfer the satchel and the room opens for the new holder instead.",
    path: "/satchel/4/room",
    cta: "Open satchel #4's room",
    docs: "/docs/guides/holder-room",
    txs: [],
  },
  {
    network: "testnet",
    tokenId: DAO_RUN.tokenId,
    tech: "Sputnik DAO",
    title: "Owned by a DAO's vote",
    body: `Satchel #${DAO_RUN.tokenId} was minted to a Sputnik DAO. One vote had it sign a send on Sepolia, which the contract recorded like any other; a second vote gave it to ${DAO_RUN.buyer}, and its address on every chain moved in that vote's transaction.`,
    path: `/satchel/${DAO_RUN.tokenId}`,
    cta: `Read satchel #${DAO_RUN.tokenId}'s report`,
    docs: "/docs/tutorials/dao-owned-satchel",
    txs: [
      { label: "The vote that signed", href: nearTxUrl(TESTNET, DAO_RUN.signVote) },
      { label: "The send on Sepolia", href: evmTxUrl(SEPOLIA, DAO_RUN.sendTx) },
      { label: "The vote that gave it away", href: nearTxUrl(TESTNET, DAO_RUN.transferVote) },
    ],
  },
  {
    network: "mainnet",
    tokenId: ONECLICK_EXIT.tokenId,
    tech: "NEAR Intents · 1Click",
    title: "Swapped through NEAR Intents",
    body: `Mainnet satchel #${ONECLICK_EXIT.tokenId} sent ${ONECLICK_EXIT.sent} ETH on Base to a 1Click deposit address, and ${ONECLICK_EXIT.received} USDC reached its own address on Arbitrum One. On any mainnet satchel's page, Quote an exit asks 1Click, on a click and with no wallet, for a dry quote of the native coin, USDC or USDT it holds on the chains 1Click serves.`,
    path: `/satchel/${ONECLICK_EXIT.tokenId}`,
    cta: `Open mainnet satchel #${ONECLICK_EXIT.tokenId}`,
    docs: "/docs/guides/quote-an-exit",
    txs: [
      { label: "The deposit on Base", href: evmTxUrl(BASE, ONECLICK_EXIT.depositTx) },
      { label: "The USDC on Arbitrum One", href: evmTxUrl(ARBITRUM_ONE, ONECLICK_EXIT.payoutTx) },
    ],
  },
  {
    network: "testnet",
    tokenId: MAKE_CLEAN.tokenId,
    tech: "Chain Signatures",
    title: "Fix it before you sell",
    body: `On ${MAKE_CLEAN.date} its owner's script left satchel #${MAKE_CLEAN.tokenId} with a live USDC approval for satchel #${MAKE_CLEAN.spenderSatchel}'s address and two sends signed but never broadcast. Make it clean planned the revoke at nonce 1 and a send of 0 at nonce 2, a button each for the owner. On ${MAKE_CLEAN.cleaned.date} the owner pressed both: the allowance went to 0, and neither kept send can be broadcast now.`,
    path: `/satchel/${MAKE_CLEAN.tokenId}`,
    cta: `Open satchel #${MAKE_CLEAN.tokenId}`,
    docs: "/docs/concepts/clean-transfer-report#make-it-clean",
    txs: [
      { label: "The approve on Sepolia", href: evmTxUrl(SEPOLIA, MAKE_CLEAN.approveTx) },
      { label: "The revoke, nonce 1", href: evmTxUrl(SEPOLIA, MAKE_CLEAN.cleaned.revokeTx) },
      { label: "The send of 0, nonce 2", href: evmTxUrl(SEPOLIA, MAKE_CLEAN.cleaned.spendTx) },
    ],
  },
];

/** The transaction that deleted the mainnet contract's last access key (deployments/mainnet.json). */
const MAINNET_LOCK_TX = "Dw29ZbeRNSLgyoeXGEdnDhxCMWB7L3w4vhKpYqmN9qqE";

export interface BuiltWith extends TxLink {
  name: string;
}

/**
 * What the landing page says Satchel is built with, each linked to where it ran. Names in text, not logos:
 * most of these marks need their owner's permission, and none of these projects is a partner.
 */
export const BUILT_WITH: readonly BuiltWith[] = [
  { name: "NEAR Chain Signatures", label: "sign_evm on mainnet", href: nearTxUrl(MAINNET, FIRST_SEND.signTx) },
  { name: "NEAR Intents 1Click", label: "USDC paid out on Arbitrum One", href: evmTxUrl(ARBITRUM_ONE, ONECLICK_EXIT.payoutTx) },
  { name: "Sputnik DAO", label: "a testnet vote that signed", href: nearTxUrl(TESTNET, DAO_RUN.signVote) },
  { name: "NEP-413 and NEAR Connect", label: "testnet satchel #4's room", href: "/satchel/4/room" },
  { name: "Locked NEP-171 contract", label: "the mainnet lock: 0 keys left", href: nearTxUrl(MAINNET, MAINNET_LOCK_TX) },
  { name: "NEP-330 reproducible build", label: "the CI run", href: MAINNET.build.ciRun },
  { name: "satchel-nft on npm", label: "version 0.2.0", href: "https://www.npmjs.com/package/satchel-nft/v/0.2.0" },
  { name: "EVM chains", label: "a send on Base", href: evmTxUrl(BASE, FIRST_SEND.sendTx) },
];

export interface DemoSatchel {
  network: NetworkId;
  tokenId: string;
  /** What happened to it, from the README and docs/DEMO.md. Never its verdict, which can change. */
  story: string;
  /** Offered as a quick pick on the verify pages. */
  pick: boolean;
}

/** The satchels the README and the demo video show, on both networks. docs/DEMO.md says what must not change about them. */
export const DEMO_SATCHELS: readonly DemoSatchel[] = [
  { network: "testnet", tokenId: "1", story: "Handed to a buyer in one NEAR transaction; the old owner's next sign_evm was refused", pick: true },
  { network: "testnet", tokenId: "3", story: "Approved satchel #2's address, which the same seller owns, to spend its USDC without limit", pick: true },
  { network: "testnet", tokenId: "4", story: "Listed for 1 NEAR at record version 0; a signature asked for while it was listed was refused", pick: true },
  { network: "testnet", tokenId: "5", story: "A 10,000 ETH send on Sepolia was signed and never broadcast", pick: true },
  { network: "testnet", tokenId: "6", story: "Listed, delisted, signed a raw payload and listed again; a buy naming the old record version was refused", pick: true },
  { network: "testnet", tokenId: "7", story: "Sent once on Sepolia, then listed, sold and handed back, each step with the satchel-nft CLI", pick: false },
  { network: "testnet", tokenId: "8", story: "Minted to a Sputnik DAO; one vote had it sign a Sepolia send, a second gave it to buyer.satchel-nft.testnet", pick: true },
  {
    network: "testnet",
    tokenId: MAKE_CLEAN.tokenId,
    story: `Two Sepolia sends signed and never broadcast, and a live USDC approval; on ${MAKE_CLEAN.cleaned.date} its owner revoked the approval and spent both nonces from its page`,
    pick: true,
  },
  { network: "mainnet", tokenId: FIRST_SEND.tokenId, story: `Sent ${FIRST_SEND.sent} ETH on Base from this app`, pick: true },
  {
    network: "mainnet",
    tokenId: ONECLICK_EXIT.tokenId,
    story: `Swapped ${ONECLICK_EXIT.sent} ETH on Base for ${ONECLICK_EXIT.received} USDC on Arbitrum One through 1Click`,
    pick: true,
  },
  {
    network: "mainnet",
    tokenId: MAINNET_SALE.tokenId,
    story: `Sold for ${MAINNET_SALE.price} NEAR in a self-sale between two of the builder's accounts, not a market price; the old owner's next sign_evm was refused`,
    pick: true,
  },
];

/** The hosts whose satchel links the verify page takes. */
export const SITE_HOSTS: readonly string[] = ["satchelnft.xyz", "www.satchelnft.xyz"];

/** A satchel the user named: its id, and the network a pasted link names, or null for the page's own. */
export interface SatchelRef {
  tokenId: string;
  network: NetworkId | null;
}

/**
 * What a user typed into the verify box: an id ("5", "#5") on the page's network, or a link to a
 * satchel's page or room on `hosts` ("satchelnft.xyz/mainnet/satchel/2"), which names its network.
 * Leading zeros are dropped, as the contract stores ids. Null for anything else.
 */
export function parseSatchelInput(text: string, hosts: readonly string[] = SITE_HOSTS): SatchelRef | null {
  const typed = text.trim();
  const id = /^#?\s*(\d{1,19})$/.exec(typed);
  if (id) return { tokenId: BigInt(id[1]).toString(), network: null };
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`);
  } catch {
    return null;
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || !hosts.includes(url.host)) return null;
  const path = /^\/(mainnet\/)?satchel\/(\d{1,19})(?:\/room)?\/?$/.exec(url.pathname);
  if (!path) return null;
  return { tokenId: BigInt(path[2]).toString(), network: path[1] ? MAINNET.id : TESTNET.id };
}

/** The network a parsed satchel belongs to: the link's, or else the page's. */
export function refNetwork(ref: SatchelRef, page: Network): Network {
  return ref.network ? NETWORKS[ref.network] : page;
}
