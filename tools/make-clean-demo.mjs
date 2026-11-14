// Leaves a testnet satchel in the state the app's "Make it clean" card fixes, on Sepolia: one live
// USDC approval, broadcast, and two signed sends that are never broadcast. Its report then reads
// NOT PROVABLE on check 2 (a signed nonce isn't spent) and check 3 (an approval is live). The owner
// cleans it up in the app, and `--check` prints what Sepolia and the record say.
//
// The satchel must be new: the demo satchels #1 to #11 are quoted in the README and stay untouched
// until 2026-11-25 (#9 is the one this script set up on 2026-11-11, cleaned up in the app on
// 2026-11-12; only `--check` runs on it; #10 and #11 are the DAO bounty and estate runs'). Each step is saved to --out before the next one starts,
// and a rerun skips every step the file already holds, so a run that stops can be run again.
//
//   NEAR_CLI=~/.cargo/bin/near.exe node make-clean-demo.mjs --token <new id> --out <file>
//   node make-clean-demo.mjs --token 9 --out ../deployments/testnet-make-clean.json --check
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { encodeFunctionData, keccak256, maxUint256, parseAbi, parseEther } from "viem";
import { CONTRACT, DEAD, OWNER, addressOf, arg, broadcast, log, sepoliaClient, sepoliaTx, signAndRecover, view } from "./lib.mjs";

// Circle's USDC on Sepolia, the deployment contents.ts lists for chain 11155111.
const USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const ERC20 = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);
// The seller's other satchel, owned by the same account: the approval a seller would leave behind.
const SPENDER_SATCHEL = "7";
const WITHDRAWAL = parseEther("0.01");
const FROZEN = new Set(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"]);

const tokenId = arg("--token");
const out = arg("--out");
if (!tokenId || !out) throw new Error("usage: node make-clean-demo.mjs --token <id> --out <file> [--check]");
if (FROZEN.has(tokenId) && !process.argv.includes("--check")) throw new Error(`satchel #${tokenId} is a demo satchel the README quotes: mint a new one`);
const run = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : {};
const json = (v) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? String(x) : x), 2);

function save(step, detail) {
  run[step] = detail;
  writeFileSync(out, `${json(run)}\n`);
  log(step, detail);
}

/** Has the owner sign `tx` through `sign_evm` and checks the signature recovers to `address`. */
async function sign(address, tx) {
  const signed = await signAndRecover(OWNER, tokenId, tx);
  if (!signed.ok) throw new Error(`sign_evm failed: ${signed.error}`);
  if (signed.recovered.toLowerCase() !== address.toLowerCase()) throw new Error("recovered signer is not the satchel's address");
  return signed;
}

async function check(address, spender) {
  const finalized = await sepoliaClient.getBlock({ blockTag: "finalized" });
  const [record, latestNonce, finalizedNonce, allowance, balance] = await Promise.all([
    view(CONTRACT, "signing_record", { token_id: tokenId }),
    sepoliaClient.getTransactionCount({ address, blockTag: "latest" }),
    sepoliaClient.getTransactionCount({ address, blockNumber: finalized.number }),
    sepoliaClient.readContract({ address: USDC, abi: ERC20, functionName: "allowance", args: [address, spender] }),
    sepoliaClient.getBalance({ address }),
  ]);
  log("check", { address, record, sepolia: { finalizedBlock: finalized.number, latestNonce, finalizedNonce, balance, usdcAllowance: allowance } });
}

async function main() {
  const satchel = await view(CONTRACT, "satchel", { token_id: tokenId });
  if (!satchel) throw new Error(`no satchel #${tokenId} on ${CONTRACT}`);
  const address = await addressOf(tokenId);
  const spender = await addressOf(SPENDER_SATCHEL);
  if (process.argv.includes("--check")) return check(address, spender);
  if (satchel.owner_id !== OWNER) throw new Error(`satchel #${tokenId} is owned by ${satchel.owner_id}, not ${OWNER}`);
  if (satchel.listing) throw new Error(`satchel #${tokenId} is listed: it can't sign`);
  if (!run.satchel) save("satchel", { tokenId, contract: CONTRACT, owner: OWNER, address, chainId: 11155111 });

  if (!run.approved) {
    const balance = await sepoliaClient.getBalance({ address });
    if (balance === 0n) throw new Error(`satchel #${tokenId} (${address}) holds no ETH on Sepolia: fund it and run again`);
    const data = encodeFunctionData({ abi: ERC20, functionName: "approve", args: [spender, maxUint256] });
    const tx = await sepoliaTx(address, { to: USDC, value: 0n, data });
    const signed = await sign(address, tx);
    const sent = await broadcast({ raw: signed.raw, sepoliaTx: keccak256(signed.raw) });
    save("approved", {
      nearTx: signed.hash, nonce: tx.nonce, sepoliaTx: sent.sepoliaTx, block: sent.block,
      token: USDC, spender, spenderSatchel: SPENDER_SATCHEL, amount: "unlimited (2^256 - 1)",
    });
  }

  // Two sends of 0.01 ETH to the dead address, signed at the two nonces after the approval and
  // never broadcast. Their signatures are public in the NEAR receipts, so anyone could still send
  // them: that is what the report flags.
  for (const i of [1, 2]) {
    const key = `kept${i}`;
    if (run[key]) continue;
    const tx = { ...(await sepoliaTx(address, { to: DEAD, value: WITHDRAWAL })), nonce: run.approved.nonce + i };
    const signed = await sign(address, tx);
    save(key, { nearTx: signed.hash, nonce: tx.nonce, to: DEAD, value: String(WITHDRAWAL), signingHash: signed.signingHash, broadcast: false });
  }
  await check(address, spender);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
