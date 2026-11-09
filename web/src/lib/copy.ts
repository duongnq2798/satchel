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
    body: "Every approve, increaseAllowance, setApprovalForAll and Permit2 approval the contract signed is itemized. Each one must read as revoked on chain: allowance 0, operator off, approval cleared.",
  },
  {
    title: "Nothing the record can't explain",
    body: "Raw signatures, calls the contract can't classify (multicalls, swaps, ownership transfers) and approvals over the cap are counted. Any one of them makes a satchel unprovable, and the report says so instead of guessing.",
  },
] as const;

/**
 * The satchels the landing page shows, built on testnet by tools/demo-gallery.mjs. Each badge is
 * read live; `check` names the line of the report the story is about.
 */
export const GALLERY = {
  examples: [
    {
      tokenId: "1",
      check: null,
      title: "Used, then handed on",
      body: "Its owners have sent from it on Sepolia. Every nonce it ever signed for has been used, so no old signature can be replayed, and it never signed an approval.",
    },
    {
      tokenId: "5",
      check: "pending",
      title: "A signed withdrawal is waiting",
      body: "The seller had a 10,000 ETH send signed for it and never broadcast it. The signature is public, so it goes through the moment the address holds that much.",
    },
    {
      tokenId: "3",
      check: "approvals",
      title: "An approval was left behind",
      body: "The seller let satchel #2's address, which they also control, spend this satchel's USDC without limit. That right is still live.",
    },
  ],
  forSale: "4",
} as const;
