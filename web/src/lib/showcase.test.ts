import { existsSync, readFileSync } from "node:fs";
import { MAINNET, TESTNET } from "satchel-nft";
import { formatEther, formatUnits, getAddress, parseUnits } from "viem";
import { describe, expect, it } from "vitest";
import { FROZEN } from "./frozen";
import { appPath } from "./routes";
import {
  BUILT_WITH,
  DEMO_SATCHELS,
  FIRST_SEND,
  MAINNET_CLAIMS,
  MAINNET_SALE,
  ONECLICK_EXIT,
  SHOWCASE,
  SITE_HOSTS,
  TOUR,
  formatSpan,
  parseSatchelInput,
  refNetwork,
  roomDescription,
  secondsBetween,
  tokenDescription,
  tokenPageNote,
  utcDate,
  utcDateTime,
  utcTime,
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

  it("satchel #3's sale: deployments/mainnet-sale.json, every fact its deed shows", () => {
    const run = evidence("mainnet-sale.json");
    const sale = MAINNET_SALE;
    expect(run.network).toBe("mainnet");
    expect([run.contract, run.mpc]).toEqual([MAINNET.contract, MAINNET.mpc]);
    expect([run.tokenId, run.path, getAddress(run.address)]).toEqual([sale.tokenId, sale.path, sale.address]);
    expect([run.seller, run.buyer]).toEqual([sale.seller, sale.buyer]);
    // yoctoNEAR: NEAR has 24 decimals. The listing and the buy named the same price and record version.
    const yocto = parseUnits(sale.price, 24).toString();
    expect([run.price, run.list.price, run.buy.price, run.buy.paid.deposit]).toEqual([yocto, yocto, yocto, yocto]);
    // Clause I: what the mint paid.
    expect(run.mint.deposit).toBe(parseUnits(sale.mint.deposit, 24).toString());
    expect([run.recordVersion, run.list.recordVersion, run.buy.recordVersion]).toEqual([sale.recordVersion, sale.recordVersion, sale.recordVersion]);
    // The four transactions: time, hash and the block that included it.
    for (const step of ["mint", "list", "buy", "refused"] as const) {
      expect([run[step].at, run[step].tx, run[step].block], step).toEqual([sale[step].at, sale[step].tx, sale[step].block]);
    }
    expect(run.buy.signer).toBe(sale.buyer);
    expect(run.buy.paid).toMatchObject({ receipt: sale.buy.paid.receipt, to: sale.seller, block: sale.buy.paid.block });
    expect(sale.buy.paid.to).toBe(sale.seller);
    // The two reports: a read each, at its time, for the owner of the moment.
    for (const [report, quoted] of [
      [run.reportBeforeBuy, sale.checked],
      [run.verified, sale.checkedAgain],
    ] as const) {
      expect([report.checkedAt, report.result, report.owner, report.recordVersion]).toEqual([quoted.at, quoted.result, quoted.owner, sale.recordVersion]);
      expect(report.command).toBe(verifyCommand(MAINNET, sale.tokenId));
      expect(report.pending).toBe("Nothing was ever signed for this token through sign_evm");
    }
    expect([sale.checked.owner, sale.checkedAgain.owner]).toEqual([sale.seller, sale.buyer]);
    // "the old owner's next sign_evm was refused": by the owner check, after the buy, for 0 wei to 0x…dEaD on Base.
    expect(run.refused.panic).toBe(sale.refused.panic);
    expect(run.refused.receiptBlock).toBe(sale.refused.receiptBlock);
    expect([run.refused.ownerAtBlock, run.refused.recordVersionAtBlock]).toEqual([sale.buyer, sale.recordVersion]);
    const tx = run.refused.args.tx;
    expect([run.refused.args.token_id, Number(tx.chain_id), getAddress(tx.to), tx.value]).toEqual([sale.tokenId, sale.refused.chainId, sale.refused.to, sale.refused.value]);
    expect(Number(run.refused.block)).toBeGreaterThan(Number(run.buy.block));
    // Each step after the one before it, in time and in blocks.
    const times = [sale.mint.at, sale.list.at, sale.checked.at, sale.buy.at, sale.refused.at, sale.checkedAgain.at].map(Date.parse);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    const blocks = [sale.mint.block, sale.list.block, sale.buy.block, sale.refused.block].map(Number);
    expect([...blocks].sort((a, b) => a - b)).toEqual(blocks);
  });

  it("satchel #3's deed agrees with the README it links to", () => {
    const readme = readFileSync(new URL("../../../README.md", import.meta.url), "utf8");
    const sale = MAINNET_SALE;
    // The README_SALE anchor's heading, and the README's table under it.
    const section = readme.split(/^#### Satchel #3, sold to a second account$/m)[1]?.split(/^#{2,4} /m)[0] ?? "";
    expect(section).not.toBe("");
    // "The README gives the next block, where its receipts began to run": one past the block that included each.
    for (const step of ["mint", "list", "buy", "refused"] as const) {
      expect(section, step).toContain(`block ${Number(sale[step].block) + 1}`);
    }
    expect(sale.refused.receiptBlock).toBe(String(Number(sale.refused.block) + 1));
    // The terminal's note: "20 claims, five of them about this sale".
    expect(readme).toContain(`NEAR mainnet: ${MAINNET_CLAIMS.total} claims`);
    expect(section).toContain(`the last ${MAINNET_CLAIMS.sale} claims of \`node scripts/check-claims.mjs --network mainnet\``);
  });

  it("satchel #3's deed counts its spans from the record's times", () => {
    const sale = MAINNET_SALE;
    // "21 seconds later the old owner asked to sign for it"
    expect(formatSpan(secondsBetween(sale.buy.at, sale.refused.at))).toBe("21 s");
    // "3 min 16 s, mint to second check"
    expect(formatSpan(secondsBetween(sale.mint.at, sale.checkedAgain.at))).toBe("3 min 16 s");
    expect(formatSpan(secondsBetween(sale.mint.at, sale.checkedAgain.at), true)).toBe("3 minutes 16 seconds");
    expect(formatSpan(secondsBetween(sale.mint.at, sale.buy.at), true)).toBe("2 minutes 20 seconds");
    expect(formatSpan(secondsBetween(sale.mint.at, sale.list.at), true)).toBe("12 seconds");
    expect(formatSpan(61, true)).toBe("1 minute 1 second");
    // The deed shows each time cut to the second, never rounded up past what happened.
    expect([sale.checked.at, sale.checkedAgain.at].map(utcTime)).toEqual(["01:19:34 UTC", "01:22:31 UTC"]);
    expect(utcDate(sale.mint.at)).toBe("13 November 2026");
    expect(utcDate(sale.checkedAgain.at)).toBe(utcDate(sale.mint.at));
    // The report card and the holder room write theirs in UTC too, beside the deed's and the history's.
    expect(utcDateTime(sale.checked.at)).toBe("2026-11-13 01:19:34 UTC");
    expect(utcDateTime(Date.parse(sale.checked.at))).toBe(utcDateTime(sale.checked.at));
    expect(utcTime(Date.parse(sale.checked.at))).toBe("01:19:34 UTC");
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
    const text = [
      ...SHOWCASE.map((c) => `${c.title} ${c.subtitle} ${c.story}`),
      ...DEMO_SATCHELS.map((d) => d.story),
      // The feature's name is not a verdict.
      ...TOUR.map((c) => `${c.title} ${c.body}`.replaceAll("Make it clean", "")),
    ].join("\n");
    expect(text).not.toMatch(/clean|provabl|pass(es|ed)?\b/i);
  });
});

describe("the landing page's tour matches the evidence files", () => {
  const card = (network: string, tokenId: string) => {
    const found = TOUR.find((c) => c.network === network && c.tokenId === tokenId);
    if (!found) throw new Error(`no card for ${network} #${tokenId}`);
    return found;
  };

  it("has the four cards the section's heading counts", () => {
    expect(TOUR.map((c) => `${c.network} #${c.tokenId}`)).toEqual(["testnet #4", "testnet #8", "mainnet #2", "testnet #9"]);
  });

  it("links each card to its own satchel's page or room, on its network", () => {
    for (const c of TOUR) {
      const net = c.network === "mainnet" ? MAINNET : TESTNET;
      expect(parseSatchelInput(`https://satchelnft.xyz${appPath(net, c.path)}`), c.title).toEqual({ tokenId: c.tokenId, network: c.network });
      const [page, anchor] = c.docs.split("#");
      expect(page).toMatch(/^\/docs\//);
      const file = new URL(`../../content/docs/en${page.slice("/docs".length)}.mdx`, import.meta.url);
      expect(existsSync(file), c.docs).toBe(true);
      if (anchor) expect(readFileSync(file, "utf8"), c.docs).toMatch(new RegExp(`^#+ ${anchor.replaceAll("-", " ")}$`, "im"));
    }
  });

  it("testnet #8's votes: deployments/testnet-dao.json", () => {
    const run = evidence("testnet-dao.json");
    const c = card("testnet", run.tokenId);
    const votes = run.steps.filter((s: { method?: string }) => s.method === "act_proposal").map((s: { tx: string }) => s.tx);
    const send = run.steps.find((s: { step: string }) => s.step.startsWith("satchel-nft dao finish")).sepolia.tx;
    expect(votes).toHaveLength(2);
    expect(c.txs.map((t) => t.href)).toEqual([
      `https://testnet.nearblocks.io/txns/${votes[0]}`,
      `https://sepolia.etherscan.io/tx/${send}`,
      `https://testnet.nearblocks.io/txns/${votes[1]}`,
    ]);
    expect(run.dao).toMatch(/\.sputnikv2\.testnet$/);
    expect(c.body).toContain("buyer.satchel-nft.testnet");
    expect(run.steps.some((s: { step: string }) => /buyer\.satchel-nft\.testnet with nft_transfer/.test(s.step))).toBe(true);
  });

  it("mainnet #2's swap uses the showcase's numbers", () => {
    const c = card("mainnet", ONECLICK_EXIT.tokenId);
    expect(c.body).toContain(`${ONECLICK_EXIT.sent} ETH`);
    expect(c.body).toContain(`${ONECLICK_EXIT.received} USDC`);
    expect(c.txs.map((t) => t.href)).toEqual([
      `https://basescan.org/tx/${ONECLICK_EXIT.depositTx}`,
      `https://arbiscan.io/tx/${ONECLICK_EXIT.payoutTx}`,
    ]);
  });

  it("testnet #9's approval, kept sends and clean-up: deployments/testnet-make-clean.json", () => {
    const run = evidence("testnet-make-clean.json");
    const { revoke, spend } = run.cleaned;
    const c = card("testnet", run.satchel.tokenId);
    expect(c.txs.map((t) => t.href)).toEqual([
      `https://sepolia.etherscan.io/tx/${run.approved.sepoliaTx}`,
      `https://sepolia.etherscan.io/tx/${revoke.sepoliaTx}`,
      `https://sepolia.etherscan.io/tx/${spend.sepoliaTx}`,
    ]);
    expect(c.body).toContain(`satchel #${run.approved.spenderSatchel}'s address`);
    expect([run.kept1.nonce, run.kept2.nonce, run.kept1.broadcast, run.kept2.broadcast]).toEqual([1, 2, false, false]);
    // The clean-up spent the kept sends' nonces: the revoke of the approval at 1, a send of 0 to
    // itself at 2.
    expect([revoke.nonce, spend.nonce]).toEqual([run.kept1.nonce, run.kept2.nonce]);
    expect(revoke.call).toBe(`approve(${run.approved.spender}, 0)`);
    expect(getAddress(revoke.to)).toBe(getAddress(run.approved.token));
    expect([getAddress(spend.to), spend.value]).toEqual([getAddress(run.satchel.address), "0"]);
    expect(c.body).toContain("the revoke at nonce 1 and a send of 0 at nonce 2");
    expect(c.body).toContain(`On ${run.cleaned.date} the owner pressed both`);
    expect([run.cleaned.report.verdict, run.cleaned.report.recordVersion]).toEqual(["PROVABLY CLEAN", spend.recordVersion]);
    expect(c.txs.slice(1).map((t) => t.label)).toEqual([`The revoke, nonce ${revoke.nonce}`, `The send of 0, nonce ${spend.nonce}`]);
    expect(run.cleaned.report.excerpt.some((l: string) => l.endsWith("allowance is 0"))).toBe(true);
    expect(c.body).toContain("the allowance went to 0");
    const story = DEMO_SATCHELS.find((d) => d.network === "testnet" && d.tokenId === run.satchel.tokenId)?.story;
    expect(story).toContain(`on ${run.cleaned.date} its owner revoked the approval and spent both nonces`);
  });
});

describe("the landing page's Built with row matches the evidence files", () => {
  const cell = (name: string) => {
    const found = BUILT_WITH.find((b) => b.name === name);
    if (!found) throw new Error(`no cell for ${name}`);
    return found;
  };

  it("has the eight cells the grid lays out in rows of four", () => {
    expect(BUILT_WITH).toHaveLength(8);
  });

  it("Chain Signatures and the EVM chains: deployments/mainnet-first-send.json", () => {
    const run = evidence("mainnet-first-send.json");
    expect(run.mpc).toBe(MAINNET.mpc);
    expect(cell("NEAR Chain Signatures").href).toBe(`https://nearblocks.io/txns/${run.nearTx}`);
    expect(Number(run.chainId)).toBe(8453);
    expect(cell("EVM chains").href).toBe(`https://basescan.org/tx/${run.baseTx}`);
  });

  it("1Click: the payout 1Click's status names, deployments/mainnet-1click-exit.json", () => {
    const run = evidence("mainnet-1click-exit.json");
    expect(run.status.status).toBe("SUCCESS");
    const payouts = run.status.swapDetails.destinationChainTxHashes.map((tx: { hash: string }) => tx.hash);
    expect(payouts).toHaveLength(1);
    expect(cell("NEAR Intents 1Click").href).toBe(`https://arbiscan.io/tx/${payouts[0]}`);
  });

  it("Sputnik DAO: the vote that had satchel #8 sign, deployments/testnet-dao.json", () => {
    const run = evidence("testnet-dao.json");
    const [vote] = run.steps.filter((s: { method?: string }) => s.method === "act_proposal");
    expect(vote.step).toMatch(/calls sign_evm/);
    expect(cell("Sputnik DAO").href).toBe(`https://testnet.nearblocks.io/txns/${vote.tx}`);
  });

  it("the locked contract and its build: deployments/mainnet.json", () => {
    const run = evidence("mainnet.json");
    expect(run.contract).toBe(MAINNET.contract);
    expect(run.access_keys_after_lock).toBe(0);
    expect(cell("Locked NEP-171 contract").href).toBe(`https://nearblocks.io/txns/${run.lock_tx}`);
    expect(cell("NEP-330 reproducible build").href).toBe(run.build.ci_run);
  });

  it("npm: the version the app's commands pin; NEP-413: the room the tour opens", () => {
    const pinned = /satchel-nft@(\S+)/.exec(verifyCommand(TESTNET, "1"))?.[1];
    const npm = cell("satchel-nft on npm");
    expect(npm.href).toBe(`https://www.npmjs.com/package/satchel-nft/v/${pinned}`);
    expect(npm.label).toBe(`version ${pinned}`);
    const room = TOUR.find((c) => c.tech.startsWith("NEP-413"));
    expect(room?.network).toBe("testnet");
    expect(cell("NEP-413 and NEAR Connect").href).toBe(appPath(TESTNET, room?.path ?? ""));
    expect(cell("NEP-413 and NEAR Connect").label).toBe(`testnet satchel #${room?.tokenId}'s room`);
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
  it("offers testnet #1, #3 to #6, #8 (the DAO's) and #9 (Make it clean) and mainnet #1 to #3 as quick picks, and lists #7, #10 and #11 too", () => {
    const ids = (network: string, pick?: boolean) =>
      DEMO_SATCHELS.filter((d) => d.network === network && (pick === undefined || d.pick === pick)).map((d) => d.tokenId);
    expect(ids("testnet", true)).toEqual(["1", "3", "4", "5", "6", "8", "9"]);
    expect(ids("mainnet", true)).toEqual(["1", "2", "3"]);
    expect(ids("testnet")).toEqual(["1", "3", "4", "5", "6", "7", "8", "9", "10", "11"]);
  });

  it("tells #10's and #11's runs as deployments/testnet-dao-bounty.json and testnet-estate.json record them", () => {
    const story = (id: string) => DEMO_SATCHELS.find((d) => d.network === "testnet" && d.tokenId === id)?.story ?? "";
    const run = (name: string) => {
      const file = evidence(name);
      const step = (key: string) => {
        const found = file.steps.find((s: { key: string }) => s.key === key);
        if (!found) throw new Error(`${name} has no step ${key}`);
        return found;
      };
      return { file, step };
    };

    const bounty = run("testnet-dao-bounty.json");
    expect(bounty.file.tokenId).toBe("10");
    const paid = ["doneVote", "done2Vote"].map((key) => /pays \S+ ([\d.]+) NEAR/.exec(bounty.step(key).step)?.[1]);
    expect(story("10")).toContain(`bounties of ${paid.join(" and ")} NEAR`);
    const send = bounty.step("finish").sepolia;
    expect([send.status, getAddress(send.from), getAddress(send.to)]).toEqual([
      "success",
      getAddress(bounty.file.address),
      getAddress(bounty.file.contributorAddress.address),
    ]);
    expect(story("10")).toContain(`pay them ${formatEther(BigInt(send.valueWei))} Sepolia ETH`);
    expect(bounty.step("giveVote2").step).toContain(`${bounty.file.contributor} owns satchel #10`);

    const estate = run("testnet-estate.json");
    expect(estate.file.tokenId).toBe("11");
    expect([estate.file.guardians.length, estate.file.threshold]).toEqual([2, 2]);
    expect(story("11")).toContain("two guardians' approvals");
    expect(estate.step("cancel").step).toContain("cancels it");
    expect(estate.step("finalize").step).toContain("satchel #11 moves to the heir");
  });

  it("says next to mainnet #3's sale that it was a self-sale", () => {
    const story = DEMO_SATCHELS.find((d) => d.network === "mainnet" && d.tokenId === MAINNET_SALE.tokenId)?.story ?? "";
    expect(story).toContain(`Sold for ${MAINNET_SALE.price} NEAR`);
    expect(story).toContain("a self-sale between two of the builder's accounts, not a market price");
  });

  it("lists exactly the satchels the app's guard covers, but testnet #2, which is retired", () => {
    for (const net of ["testnet", "mainnet"] as const) {
      const listed = DEMO_SATCHELS.filter((d) => d.network === net).map((d) => d.tokenId);
      expect([...listed, ...(net === "testnet" ? ["2"] : [])].sort()).toEqual([...FROZEN[net]].sort());
    }
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
