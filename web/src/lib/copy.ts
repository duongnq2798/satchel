/** The four checks, in the words the landing page and the verify page share. */
export const CHECKS = [
  {
    title: "The contract can't sign behind the record",
    body: "The contract account has no access keys, runs the reproducible build, and signs only through NEAR's canonical Chain Signatures contract. Nobody, its deployer included, can request a signature for a satchel's key except through sign_evm and sign_raw.",
  },
  {
    title: "No signed transaction is still pending",
    body: "The contract records the highest nonce it ever signed on each chain. Once the address's nonce at a finalized block is above it, every transaction a previous owner signed is either on chain or void.",
  },
  {
    title: "No approval left behind",
    body: "Every approve, increaseAllowance, setApprovalForAll and Permit2 approval the contract signed is itemized, up to 32 per satchel. Each one must read as revoked on chain: allowance 0, operator off, approval cleared.",
  },
  {
    title: "Nothing the record can't explain",
    body: "Raw signatures, calls the contract can't classify (multicalls, swaps, ownership transfers) and approvals over the cap are counted. Any one of them makes a satchel unprovable, and the report says so instead of guessing.",
  },
] as const;

const NEAR_TX = "https://testnet.nearblocks.io/txns/";
const SEPOLIA_TX = "https://sepolia.etherscan.io/tx/";

export interface TxLink {
  label: string;
  href: string;
}

interface TrickBase {
  id: string;
  /** What the seller does, as the button says it. */
  label: string;
  tokenId: string;
  title: string;
  body: string;
  txs: readonly TxLink[];
}

/** A satchel the seller left dirty (or didn't): its live report shows what the buyer would see. */
export interface ReportTrick extends TrickBase {
  kind: "report";
  /** The report line the story is about; null for the clean one. */
  check: "pending" | "approvals" | "counters" | null;
}

/** A call the contract refused on chain: who made it, the call, and the contract's answer. */
export interface RefusedTrick extends TrickBase {
  kind: "refused";
  caller: "seller" | "buyer";
  call: string;
  reason: string;
}

export type Trick = ReportTrick | RefusedTrick;

/**
 * What a seller can try, each shown with a real satchel or a real refused transaction on testnet,
 * made by tools/demo-gallery.mjs (evidence in deployments/testnet-gallery.json).
 */
export const TRICKS: readonly Trick[] = [
  {
    id: "fair",
    kind: "report",
    label: "Play fair",
    tokenId: "1",
    check: null,
    title: "Nothing to hide, and the report shows it",
    body: "Its owners have sent from it on Sepolia. Every nonce it ever signed for has been used, so no old signature can be replayed, and it never signed an approval.",
    txs: [
      { label: "sign_evm on NEAR", href: `${NEAR_TX}27myw3U1iMmPvvGajeao1mqPaoqKu3C6SJQt7VL6FRCd` },
      { label: "The send on Sepolia", href: `${SEPOLIA_TX}0x43c37e67eed3c849acfc4b3f525a762d9c862c9fec017b0391c49ee2f89d6965` },
    ],
  },
  {
    id: "withdrawal",
    kind: "report",
    label: "Keep a signed withdrawal",
    tokenId: "5",
    check: "pending",
    title: "A 10,000 ETH send is signed and waiting",
    body: "The seller had a send signed for it and never broadcast it. The signature sits in a public NEAR receipt, so it goes through the moment the address holds that much.",
    txs: [{ label: "sign_evm, never broadcast", href: `${NEAR_TX}G66SfkVz9dbf4AeJam5jiLnZNmZGAAYpaLgDWPCa5Ga7` }],
  },
  {
    id: "approval",
    kind: "report",
    label: "Leave an approval behind",
    tokenId: "3",
    check: "approvals",
    title: "Someone else can still spend its USDC",
    body: "The seller let satchel #2's address, which they also control, spend this satchel's USDC without limit, and never revoked it.",
    txs: [
      { label: "sign_evm on NEAR", href: `${NEAR_TX}VCULtPKmd1TpD4Bu9N87dMVwXecxjUsBG6CnG5kdW4C` },
      { label: "The approve on Sepolia", href: `${SEPOLIA_TX}0x56b2735c807429a1f6fc9bb35b63736500bc716accd1fbb213be8b3d17b94169` },
    ],
  },
  {
    id: "raw",
    kind: "report",
    label: "Sign a raw payload",
    tokenId: "6",
    check: "counters",
    title: "A signature the record can't explain",
    body: "The seller had the MPC network sign 32 bytes the contract did not build. They could be a transaction on another chain or a message; no one can tell, so the report won't call it clean.",
    txs: [{ label: "sign_raw on NEAR", href: `${NEAR_TX}4J8Y6WSPpW5d8pH6PpBGnC5NDVvuAKLzaDSYwRs1kwzB` }],
  },
  {
    id: "frozen",
    kind: "refused",
    label: "Sign while it's listed",
    tokenId: "4",
    title: "Signing is frozen while it's for sale",
    body: "The seller asked for one more signature while satchel #4 was listed. The contract refused, so what a buyer checks stays true until the sale.",
    caller: "seller",
    call: 'sign_evm({ token_id: "4", tx: … })',
    reason: "Satchel: signing is frozen while the token is listed",
    txs: [{ label: "The refused call", href: `${NEAR_TX}5ZaKqJUxEUauvpENMMp4KQoCwWRNqmAyHskpTF6Axft8` }],
  },
  {
    id: "changed",
    kind: "refused",
    label: "Change it after the buyer checked",
    tokenId: "6",
    title: "The buyer's check is part of the purchase",
    body: "Satchel #6 was listed clean at record version 0. The seller delisted it, signed a raw payload and listed it again at version 1. A buyer who had checked version 0 tried to buy and was refused, and got their 1 NEAR back.",
    caller: "buyer",
    call: 'buy({ token_id: "6", record_version: "0", price: 1 NEAR })',
    reason: "Satchel: the signing record changed since you checked it",
    txs: [
      { label: "Listed clean", href: `${NEAR_TX}GoSfXxf7pgpb8fNCCbiFuxpT6gAYt5LW3Ve49R4oBL3z` },
      { label: "Delisted", href: `${NEAR_TX}8X7vStD8r1AwVqdJfDkhsfiKoj8v5KJubXrhBdtJ35M` },
      { label: "sign_raw", href: `${NEAR_TX}4J8Y6WSPpW5d8pH6PpBGnC5NDVvuAKLzaDSYwRs1kwzB` },
      { label: "Listed again", href: `${NEAR_TX}6UNoo28pdrTjDJbnREPLe8k4JNW1xpGVHKwHyZeUzdxG` },
      { label: "The refused buy", href: `${NEAR_TX}7HQPu9qeJauNrJLaMNCUuMJVska3u3uYsoGyp7gsCfWv` },
    ],
  },
];

/** The clean demo satchel that is for sale. */
export const FOR_SALE = "4";

/** Satchel #1's hand-over in the end-to-end run (deployments/testnet-e2e.json). */
export const HANDOVER = {
  tokenId: "1",
  from: "satchel-nft.testnet",
  transferTx: `${NEAR_TX}3sLuGS9pEnvURpha3QQBtumExxKC2f3GMJSRaccvNBwB`,
  refusedTx: `${NEAR_TX}GqFsnmFLcpDjJVC1b4qUPYxHRTP1Rw2vcVKxga3PVRvU`,
  address: "0x96DA1468E95Ab31A698891f0150095f86b5a282B",
} as const;

/** Transactions anyone can open to check the claims on the landing page. */
export const EVIDENCE: readonly (TxLink & { what: string })[] = [
  { what: "Deployed and initialized from the reproducible build", label: "7pocx72c…", href: `${NEAR_TX}7pocx72c1bcDbNehTG32T18ukjR82byP3PfF9vmX44Uk` },
  { what: "Its only key deleted: nobody can redeploy it", label: "6FYx6hV5…", href: `${NEAR_TX}6FYx6hV5PRCfaUd6t4VEkz1bfkknxN8ymyw4nSP6YgAK` },
  { what: "Satchel #1 minted", label: "3kBMVhva…", href: `${NEAR_TX}3kBMVhva8pagScLwGJDNwF6Bfbzno9LxAVN5JKENvPxo` },
  { what: "Satchel #1 handed to a buyer", label: "3sLuGS9p…", href: HANDOVER.transferTx },
  { what: "The previous owner's next sign_evm refused", label: "GqFsnmFL…", href: HANDOVER.refusedTx },
  { what: "The buyer signs for the same address", label: "9GYTuZJo…", href: `${NEAR_TX}9GYTuZJoQAKcYib8NCEKXtcqDkRjGfy9nLavajkGaLnM` },
  { what: "A later send of the buyer's on Sepolia", label: "0x43c37e67…", href: `${SEPOLIA_TX}0x43c37e67eed3c849acfc4b3f525a762d9c862c9fec017b0391c49ee2f89d6965` },
  { what: "A second init call refused: new is private", label: "BeoXbii9…", href: `${NEAR_TX}BeoXbii9WeodnG2XZarxZidtvqS6RzzA9KNqJnZRLrWv` },
  { what: "Signing refused while listed", label: "5ZaKqJUx…", href: `${NEAR_TX}5ZaKqJUxEUauvpENMMp4KQoCwWRNqmAyHskpTF6Axft8` },
  { what: "A buy naming an old record version refused", label: "7HQPu9qe…", href: `${NEAR_TX}7HQPu9qeJauNrJLaMNCUuMJVska3u3uYsoGyp7gsCfWv` },
];
