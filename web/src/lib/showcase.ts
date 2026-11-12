import { CHAINS, MAINNET, NETWORKS, type Network, type NetworkId, TESTNET, chainInfo, nearTxUrl } from "satchel-nft";
import type { TxLink } from "./copy";

/**
 * The guided path for a judge or a buyer: the mainnet satchels that sent real ETH, the demo satchels
 * with one line each, and the command that checks any of them from a terminal. The numbers come from
 * deployments/; showcase.test.ts reads those files and fails on any drift. A card tells what happened,
 * never the verdict: that is read live on the satchel's page.
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

export interface ShowcaseCard {
  tokenId: string;
  title: string;
  subtitle: string;
  address: string;
  story: string;
  txs: readonly TxLink[];
}

/** The mainnet satchels that sent real ETH from this app, each with the transactions behind its story. */
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

/** The state testnet satchel #9 was left in for Make it clean (deployments/testnet-make-clean.json). */
const MAKE_CLEAN = {
  tokenId: "9",
  /** When the state was set up, and the card last checked against the live page. */
  date: "2026-11-11",
  approveTx: "0xdeef1d5c70b00db68cf1fa2fc568535bd12686b4c690d6218f82f5dba88cab42",
  spenderSatchel: "7",
  kept: ["CLpsgUtaBSN5s4rvZgXHDpUJf9MQeE4QzQZVPrC22D2Y", "E33gHExEGo1xkUr49UrMR2uLj5UUH95tCWHhxUnKQDHJ"],
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
    body: `On ${MAKE_CLEAN.date} its owner's script left satchel #${MAKE_CLEAN.tokenId} with a live USDC approval for satchel #${MAKE_CLEAN.spenderSatchel}'s address and two sends signed but never broadcast. For that state, Make it clean, under its report, plans two sends, the revoke at nonce 1 and a send of 0 at nonce 2, with their calldata and a button for each for the owner. They hadn't run on ${MAKE_CLEAN.date}; the page shows what is left now.`,
    path: `/satchel/${MAKE_CLEAN.tokenId}`,
    cta: `Open satchel #${MAKE_CLEAN.tokenId}`,
    docs: "/docs/concepts/clean-transfer-report#make-it-clean",
    txs: [
      { label: "The approve on Sepolia", href: evmTxUrl(SEPOLIA, MAKE_CLEAN.approveTx) },
      { label: "Kept send, nonce 1", href: nearTxUrl(TESTNET, MAKE_CLEAN.kept[0]) },
      { label: "Kept send, nonce 2", href: nearTxUrl(TESTNET, MAKE_CLEAN.kept[1]) },
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
  { network: "testnet", tokenId: "8", story: "Minted to a Sputnik DAO, whose vote had it sign a Sepolia send; a second vote gave it to buyer.satchel-nft.testnet", pick: false },
  { network: "mainnet", tokenId: FIRST_SEND.tokenId, story: `Sent ${FIRST_SEND.sent} ETH on Base from this app`, pick: true },
  {
    network: "mainnet",
    tokenId: ONECLICK_EXIT.tokenId,
    story: `Swapped ${ONECLICK_EXIT.sent} ETH on Base for ${ONECLICK_EXIT.received} USDC on Arbitrum One through 1Click`,
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
