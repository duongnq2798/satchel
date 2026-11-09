// Builds the satchels the landing page shows, one for each thing the clean-transfer report
// catches and one clean satchel for sale, on NEAR testnet and Sepolia:
//
//   pending   OWNER mints it and has a 10,000 ETH Sepolia send signed, then never broadcasts it.
//             The signature sits in a public NEAR receipt and goes through the moment the address
//             holds that much, which no faucet pays out, so it stays open. The report: NOT
//             PROVABLE, a signed transaction may still be pending.
//   approval  OWNER mints it; satchel FUNDER sends it gas money; it approves the pending satchel's
//             address, which OWNER also controls, to spend its USDC. The report: NOT PROVABLE,
//             an approval is still live.
//   forSale   OWNER mints it, FUNDER sends it 0.002 ETH, OWNER lists it for 1 NEAR. Nothing was
//             ever signed for it, so the report reads PROVABLY CLEAN and anyone can buy it.
//
// FUNDER (default satchel #1, owned by BUYER) pays from its own address through `sign_evm`, so
// it stays provably clean: every send it signs is broadcast.
//
// Each step writes its result to --out as soon as it is done, a signed send before it is
// broadcast, and a run given an --out that already holds steps skips them, so a run that stops
// partway resumes without minting or signing again.
//
// Usage (near CLI on PATH, or NEAR_CLI=/path/to/near):
//   node demo-gallery.mjs [--out ../deployments/testnet-gallery.json]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { encodeFunctionData, maxUint256, parseAbi, parseEther } from "viem";
import { BUYER, CONTRACT, DEAD, OWNER, addressOf, arg, broadcast, call, log, sepoliaClient, sepoliaTx, signAndRecover, signSend, view } from "./lib.mjs";

/** Circle's USDC on Sepolia. */
const USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const ERC20 = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);
const FUNDER = process.env.SATCHEL_FUNDER ?? "1";
const GAS_MONEY = parseEther("0.002");
const WITHDRAWAL = parseEther("10000");
const PRICE = "1000000000000000000000000"; // 1 NEAR
const OUT = arg("--out");

const state = OUT && existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { network: "testnet", contract: CONTRACT, funder: FUNDER };

function save(step, detail) {
  log(step, detail);
  if (OUT) writeFileSync(OUT, `${JSON.stringify({ ...state, ranAt: new Date().toISOString() }, null, 2)}\n`);
}

async function mint() {
  const res = await call(OWNER, "mint", {}, { deposit: "0.1 NEAR", gas: "50 Tgas" });
  if (!res.ok) throw new Error(`mint failed: ${res.error}`);
  const tokenId = res.value.token_id;
  return { tokenId, owner: OWNER, address: await addressOf(tokenId), mintTx: res.hash };
}

async function minted(key) {
  if (!state[key]) {
    state[key] = await mint();
    save(`${key}: minted`, state[key]);
  }
  return state[key];
}

/** Sends from satchel `tokenId` into `satchel[key]`, saving the signed send before broadcasting it. */
async function send(satchel, key, tokenId, signer, fields, extra = {}) {
  if (satchel[key]?.block) return;
  if (!satchel[key]) {
    satchel[key] = await signSend(tokenId, signer, fields);
    save(`satchel #${tokenId}: signed, broadcasting`, satchel[key].sepoliaTx);
  }
  satchel[key] = { ...(await broadcast(satchel[key])), ...extra };
  save(`satchel #${tokenId}: sent`, satchel[key]);
}

async function main() {
  const funder = await view(CONTRACT, "nft_token", { token_id: FUNDER });
  if (funder?.owner_id !== BUYER) throw new Error(`satchel #${FUNDER} is owned by ${funder?.owner_id}, not ${BUYER}`);

  const pending = await minted("pending");
  if (!pending.signTx) {
    // 0x…dEaD is in use, so the send costs 21000; the address holds nothing, so no node can estimate it.
    const withdrawal = await sepoliaTx(pending.address, { to: DEAD, value: WITHDRAWAL, gas: 21000n });
    const signed = await signAndRecover(OWNER, pending.tokenId, withdrawal);
    if (!signed.ok) throw new Error(`sign_evm failed: ${signed.error}`);
    if (signed.recovered.toLowerCase() !== pending.address.toLowerCase()) throw new Error("recovered signer is not the token's address");
    Object.assign(pending, { signTx: signed.hash, nonce: withdrawal.nonce, value: String(WITHDRAWAL), signingHash: signed.signingHash, broadcast: false });
    save("pending: signed, not broadcast", pending);
  }

  const approval = await minted("approval");
  await send(approval, "funded", FUNDER, BUYER, { to: approval.address, value: GAS_MONEY });
  const data = encodeFunctionData({ abi: ERC20, functionName: "approve", args: [pending.address, maxUint256] });
  await send(approval, "approved", approval.tokenId, OWNER, { to: USDC, value: 0n, data }, { token: USDC, spender: pending.address });
  const { spender } = approval.approved;
  const allowance = await sepoliaClient.readContract({ address: USDC, abi: ERC20, functionName: "allowance", args: [approval.address, spender] });
  if (allowance !== maxUint256) throw new Error(`allowance reads ${allowance}, expected the maximum`);

  const forSale = await minted("forSale");
  await send(forSale, "funded", FUNDER, BUYER, { to: forSale.address, value: GAS_MONEY });
  if (!forSale.listTx) {
    const listed = await call(OWNER, "list", { token_id: forSale.tokenId, price: PRICE }, { deposit: "1 yoctoNEAR", gas: "30 Tgas" });
    if (!listed.ok) throw new Error(`list failed: ${listed.error}`);
    Object.assign(forSale, { listTx: listed.hash, price: PRICE });
    save("forSale: listed", forSale);
  }
  console.log("\nGALLERY PASS");
}

main().catch((err) => {
  console.error(`\nGALLERY FAIL: ${err.message}`);
  process.exit(1);
});
