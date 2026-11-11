import { readFileSync } from "node:fs";
import { MAINNET, TESTNET } from "satchel-nft";
import { formatEther, formatUnits, getAddress } from "viem";
import { describe, expect, it } from "vitest";
import {
  DEMO_SATCHELS,
  FIRST_SEND,
  ONECLICK_EXIT,
  SHOWCASE,
  SITE_HOSTS,
  parseSatchelInput,
  refNetwork,
  roomDescription,
  tokenDescription,
  tokenPageNote,
  verifyCommand,
} from "./showcase";

// biome-ignore lint/suspicious/noExplicitAny: evidence files, read as they are
const evidence = (name: string): any => JSON.parse(readFileSync(new URL(`../../../deployments/${name}`, import.meta.url), "utf8"));

describe("the mainnet showcase matches the evidence files", () => {
  it("satchel #1's send: deployments/mainnet-first-send.json", () => {
    const run = evidence("mainnet-first-send.json");
    expect(run.network).toBe("mainnet");
    expect(run.contract).toBe(MAINNET.contract);
    expect(run.mpc).toBe(MAINNET.mpc);
    expect(run.tokenId).toBe(FIRST_SEND.tokenId);
    expect(getAddress(run.address)).toBe(FIRST_SEND.address);
    expect(run.mintTx).toBe(FIRST_SEND.mintTx);
    expect(run.nearTx).toBe(FIRST_SEND.signTx);
    expect(run.baseTx).toBe(FIRST_SEND.sendTx);
    expect(Number(run.chainId)).toBe(FIRST_SEND.chainId);
    expect(run.nonce).toBe("0");
    expect(formatEther(BigInt(run.valueWei))).toBe(FIRST_SEND.sent);
    // "from the satchel's page here"
    expect(run.sentWith).toBe("https://satchelnft.xyz/mainnet/satchel/1");
  });

  it("satchel #2's swap: deployments/mainnet-1click-exit.json", () => {
    const run = evidence("mainnet-1click-exit.json");
    const { quote, quoteRequest } = run.quote;
    expect(run.network).toBe("mainnet");
    expect(run.contract).toBe(MAINNET.contract);
    expect(run.tokenId).toBe(ONECLICK_EXIT.tokenId);
    expect(getAddress(run.address)).toBe(ONECLICK_EXIT.address);
    expect(run.mint.tx).toBe(ONECLICK_EXIT.mintTx);
    // ETH on Base for USDC on Arbitrum One, with the satchel as recipient and refund address.
    expect([run.route.origin.symbol, run.route.origin.blockchain]).toEqual(["ETH", "base"]);
    expect([run.route.destination.symbol, run.route.destination.blockchain]).toEqual(["USDC", "arb"]);
    expect(quoteRequest.swapType).toBe("EXACT_INPUT");
    expect(getAddress(quoteRequest.recipient)).toBe(ONECLICK_EXIT.address);
    expect(getAddress(quoteRequest.refundTo)).toBe(ONECLICK_EXIT.address);
    expect(quote.depositAddress).toBe(ONECLICK_EXIT.depositAddress);
    expect(formatEther(BigInt(quote.amountIn))).toBe(ONECLICK_EXIT.sent);
    // The deposit: a sign_evm at nonce 0 on Base.
    expect(run.deposit.chainId).toBe("8453");
    expect(run.deposit.nonce).toBe("0");
    expect(run.deposit.nearTx).toBe(ONECLICK_EXIT.signTx);
    expect(run.deposit.tx).toBe(ONECLICK_EXIT.depositTx);
    // What reached the satchel on Arbitrum One, and 1Click's status naming it as the payout.
    expect(run.arrival.chainId).toBe("42161");
    expect(formatUnits(BigInt(run.arrival.received), run.route.destination.decimals)).toBe(ONECLICK_EXIT.received);
    expect(run.arrival.txs.map((tx: { hash: string }) => tx.hash)).toEqual([ONECLICK_EXIT.payoutTx]);
    expect(run.status.status).toBe("SUCCESS");
    expect(run.status.swapDetails.originChainTxHashes.map((tx: { hash: string }) => tx.hash)).toEqual([ONECLICK_EXIT.depositTx]);
    expect(run.status.swapDetails.destinationChainTxHashes.map((tx: { hash: string }) => tx.hash)).toEqual([ONECLICK_EXIT.payoutTx]);
    // The command the record says it ran is the one the app shows.
    expect(run.verified.command).toBe(verifyCommand(MAINNET, ONECLICK_EXIT.tokenId));
  });

  it("each card links every transaction its story names, on the right explorer", () => {
    const [first, swap] = SHOWCASE;
    expect(first.txs.map((t) => t.href)).toEqual([
      `https://nearblocks.io/txns/${FIRST_SEND.mintTx}`,
      `https://nearblocks.io/txns/${FIRST_SEND.signTx}`,
      `https://basescan.org/tx/${FIRST_SEND.sendTx}`,
    ]);
    expect(swap.txs.map((t) => t.href)).toEqual([
      `https://nearblocks.io/txns/${ONECLICK_EXIT.mintTx}`,
      `https://nearblocks.io/txns/${ONECLICK_EXIT.signTx}`,
      `https://basescan.org/tx/${ONECLICK_EXIT.depositTx}`,
      `https://arbiscan.io/tx/${ONECLICK_EXIT.payoutTx}`,
      `https://1click.chaindefuser.com/v0/status?depositAddress=${ONECLICK_EXIT.depositAddress}`,
    ]);
    expect(first.title).toContain(FIRST_SEND.sent);
    expect(swap.title).toContain(ONECLICK_EXIT.sent);
    expect(swap.title).toContain(ONECLICK_EXIT.received);
  });

  it("tells the story and leaves the verdict to the live report", () => {
    const text = [...SHOWCASE.map((c) => `${c.title} ${c.subtitle} ${c.story}`), ...DEMO_SATCHELS.map((d) => d.story)].join("\n");
    expect(text).not.toMatch(/clean|provabl|pass(es|ed)?\b/i);
  });
});

describe("the testnet demo stories match deployments/testnet-gallery.json", () => {
  const gallery = evidence("testnet-gallery.json");
  const story = (id: string) => DEMO_SATCHELS.find((d) => d.network === "testnet" && d.tokenId === id)?.story ?? "";

  it("#3 approved satchel #2's address", () => {
    expect(gallery.approval.approved.tokenId).toBe("3");
    expect(gallery.approval.approved.spender).toBe(gallery.retiredPending.address);
    expect(gallery.retiredPending.tokenId).toBe("2");
    expect(story("3")).toContain("satchel #2's address");
  });

  it("#4 was listed for 1 NEAR and refused a signature", () => {
    expect(gallery.forSale.tokenId).toBe("4");
    expect(gallery.forSale.price).toBe(`1${"0".repeat(24)}`);
    expect(gallery.forSale.refusedSign.reason).toBe("Satchel: signing is frozen while the token is listed");
    expect(story("4")).toContain("1 NEAR at record version 0");
  });

  it("#5 signed a 10,000 ETH send and never broadcast it", () => {
    expect(gallery.pending.tokenId).toBe("5");
    expect(formatEther(BigInt(gallery.pending.value))).toBe("10000");
    expect(gallery.pending.broadcast).toBe(false);
    expect(story("5")).toContain("10,000 ETH");
  });

  it("#6 was relisted after a raw signature, and the buy naming the old version was refused", () => {
    expect(gallery.relisted.tokenId).toBe("6");
    expect([gallery.relisted.checkedVersion, gallery.relisted.listedVersion]).toEqual(["0", "1"]);
    expect(gallery.relisted.refusedBuy.reason).toBe("Satchel: the signing record changed since you checked it");
  });
});

describe("the demo satchels", () => {
  it("offers testnet #1, #3 to #6 and mainnet #1 and #2 as quick picks, and lists #7 and #8 too", () => {
    const ids = (network: string, pick?: boolean) =>
      DEMO_SATCHELS.filter((d) => d.network === network && (pick === undefined || d.pick === pick)).map((d) => d.tokenId);
    expect(ids("testnet", true)).toEqual(["1", "3", "4", "5", "6"]);
    expect(ids("mainnet", true)).toEqual(["1", "2"]);
    expect(ids("testnet")).toEqual(["1", "3", "4", "5", "6", "7", "8"]);
  });
});

describe("verifyCommand and the token page's note", () => {
  it("pins the release on npm and adds --network mainnet on mainnet", () => {
    expect(verifyCommand(TESTNET, "5")).toBe("npx -y satchel-nft@0.2.0 verify 5");
    expect(verifyCommand(MAINNET, "1")).toBe("npx -y satchel-nft@0.2.0 verify --network mainnet 1");
  });

  it("names the satchel, the contract, the network and the command", () => {
    const note = tokenPageNote(MAINNET, "2");
    expect(note.text).toContain("satchel #2");
    expect(note.text).toContain(MAINNET.contract);
    expect(note.text).toContain("NEAR mainnet");
    expect(note.command).toBe(verifyCommand(MAINNET, "2"));
  });

  it("gives a satchel's page and its holder room a description that names the satchel and the network", () => {
    expect(tokenDescription(TESTNET, "5")).toMatch(/^Satchel #5 on NEAR testnet: /);
    expect(roomDescription(TESTNET, "4")).toContain("satchel #4 on NEAR testnet");
    expect(roomDescription(MAINNET, "1")).toContain("satchel #1 on NEAR mainnet");
  });
});

describe("parseSatchelInput", () => {
  it("takes an id, with or without #, on the page's network", () => {
    expect(parseSatchelInput("5")).toEqual({ tokenId: "5", network: null });
    expect(parseSatchelInput("  #5 ")).toEqual({ tokenId: "5", network: null });
    expect(parseSatchelInput("# 12")).toEqual({ tokenId: "12", network: null });
    expect(parseSatchelInput("007")).toEqual({ tokenId: "7", network: null });
    expect(parseSatchelInput("1234567890123456789")).toEqual({ tokenId: "1234567890123456789", network: null });
  });

  it("takes a link to a satchel's page or room, which names its network", () => {
    expect(parseSatchelInput("https://satchelnft.xyz/satchel/5")).toEqual({ tokenId: "5", network: "testnet" });
    expect(parseSatchelInput("satchelnft.xyz/mainnet/satchel/2")).toEqual({ tokenId: "2", network: "mainnet" });
    expect(parseSatchelInput("https://www.satchelnft.xyz/satchel/3/room?x=1#report")).toEqual({ tokenId: "3", network: "testnet" });
    expect(parseSatchelInput("https://satchelnft.xyz/mainnet/satchel/1/")).toEqual({ tokenId: "1", network: "mainnet" });
    expect(parseSatchelInput("HTTPS://SatchelNFT.xyz/satchel/4")).toEqual({ tokenId: "4", network: "testnet" });
  });

  it("takes this deployment's own host when the page passes it", () => {
    expect(parseSatchelInput("http://localhost:3000/satchel/6")).toBeNull();
    expect(parseSatchelInput("http://localhost:3000/satchel/6", [...SITE_HOSTS, "localhost:3000"])).toEqual({ tokenId: "6", network: "testnet" });
  });

  it("refuses anything else", () => {
    for (const text of [
      "",
      "#",
      "-1",
      "5.0",
      "1e3",
      "12345678901234567890",
      "five",
      "https://evil.example/satchel/5",
      "https://satchelnft.xyz.evil.example/satchel/5",
      "https://satchelnft.xyz/satchel/abc",
      "https://satchelnft.xyz/satchels",
      "https://satchelnft.xyz/market",
      "https://satchelnft.xyz/mainnet/mainnet/satchel/1",
      "javascript:alert(1)",
      "ftp://satchelnft.xyz/satchel/5",
    ]) {
      expect(parseSatchelInput(text), text).toBeNull();
    }
  });

  it("goes to the link's network, or else the page's", () => {
    expect(refNetwork({ tokenId: "2", network: "mainnet" }, TESTNET)).toBe(MAINNET);
    expect(refNetwork({ tokenId: "2", network: null }, MAINNET)).toBe(MAINNET);
    expect(refNetwork({ tokenId: "2", network: null }, TESTNET)).toBe(TESTNET);
  });
});
