// End-to-end check of a deployed Satchel contract on NEAR testnet, against the real MPC network.
//
//   1. mint a token as OWNER
//   2. derive its EVM address from the MPC contract (`derived_public_key`)
//   3. `sign_evm` a Sepolia transaction and recover the signer with viem: it must be that address
//   4. broadcast it if the address holds Sepolia ETH (otherwise print the raw transaction)
//   5. read the signing record: it must show the nonce
//   6. transfer the NFT to BUYER: OWNER's next `sign_evm` must fail, BUYER's must recover to the
//      same address
//   7. call `new` from OWNER: it must fail
//
// `send <token_id> <signer>` signs a Sepolia transfer from a token's address as <signer> (its
// owner) and broadcasts it. Fund the address first; the script prints it if the balance is short.
//
// Transactions are signed by near CLI from the legacy keychain (~/.near-credentials); this script
// never reads a key. Usage (near CLI on PATH, or NEAR_CLI=/path/to/near):
//   node e2e-testnet.mjs [--out ../deployments/testnet-e2e.json]
//   node e2e-testnet.mjs send <token_id> <signer> [--out ../deployments/testnet-sepolia-send.json]
import { writeFileSync } from "node:fs";
import { BUYER, CONTRACT, MPC, OWNER, addressOf, arg, call, contractTx, log, sendFrom, sepoliaClient, sepoliaTx, signAndRecover, tokenAddress, view } from "./lib.mjs";

const OUT = arg("--out");
// A fresh token's address holds nothing, so no node can estimate gas for it; a plain send to
// 0x…dEaD, an address in use, costs 21000.
const UNFUNDED = { gas: 21000n };
const evidence = { network: "testnet", contract: CONTRACT, mpc: MPC, steps: [] };

async function main() {
  log("contract", { contract: CONTRACT, mpc: await view(CONTRACT, "mpc_contract", {}) });

  const minted = await call(OWNER, "mint", {}, { deposit: "0.1 NEAR", gas: "50 Tgas" });
  if (!minted.ok) throw new Error(`mint failed: ${minted.error}`);
  const tokenId = minted.value.token_id;
  const path = await view(CONTRACT, "derivation_path", { token_id: tokenId });
  const { publicKey, address } = await tokenAddress(path);
  log("1-2. minted and derived", { tokenId, owner: OWNER, path, publicKey, address, tx: minted.hash });
  evidence.steps.push({ step: "mint", tx: minted.hash, tokenId, path, address });

  const first = await signAndRecover(OWNER, tokenId, await sepoliaTx(address, UNFUNDED));
  if (!first.ok) throw new Error(`sign_evm failed: ${first.error}`);
  const match = first.recovered.toLowerCase() === address.toLowerCase();
  log("3. sign_evm through the MPC network", {
    tx: first.hash,
    signingHash: first.signingHash,
    recovered: first.recovered,
    matchesTokenAddress: match,
  });
  if (!match) throw new Error("recovered signer is not the token's address");
  evidence.steps.push({ step: "sign_evm (owner)", tx: first.hash, nonce: first.tx.nonce, recovered: first.recovered });

  const balance = await sepoliaClient.getBalance({ address });
  const cost = first.tx.maxFeePerGas * first.tx.gas + first.tx.value;
  if (balance >= cost) {
    const sent = await sepoliaClient.sendRawTransaction({ serializedTransaction: first.raw });
    log("4. broadcast on Sepolia", `https://sepolia.etherscan.io/tx/${sent}`);
    evidence.steps.push({ step: "broadcast", sepoliaTx: sent });
  } else {
    log("4. not broadcast", `${address} holds ${balance} wei on Sepolia; it needs ${cost}. Raw signed tx:\n${first.raw}`);
    evidence.steps.push({ step: "not broadcast (no Sepolia ETH)", raw: first.raw });
  }

  const record = await view(CONTRACT, "signing_record", { token_id: tokenId });
  log("5. signing record", record);
  const chain = record.evm.find((c) => c.chain_id === "11155111");
  if (!chain || BigInt(chain.max_nonce) < BigInt(first.tx.nonce)) throw new Error("record does not show the nonce");

  const moved = await call(OWNER, "nft_transfer", { receiver_id: BUYER, token_id: tokenId }, { deposit: "1 yoctoNEAR", gas: "30 Tgas" });
  if (!moved.ok) throw new Error(`nft_transfer failed: ${moved.error}`);
  const refused = await call(OWNER, "sign_evm", { token_id: tokenId, tx: contractTx(await sepoliaTx(address, UNFUNDED)) }, { deposit: "1 yoctoNEAR" });
  const refusedRight = !refused.ok && refused.error.includes("only the token's owner");
  const buyer = await signAndRecover(BUYER, tokenId, await sepoliaTx(address, UNFUNDED));
  const buyerMatch = buyer.ok && buyer.recovered.toLowerCase() === address.toLowerCase();
  log("6. after nft_transfer to the buyer", {
    transfer: moved.hash,
    previousOwnerRefused: refusedRight,
    previousOwnerTx: refused.hash,
    buyerSigned: buyer.hash,
    buyerRecovered: buyer.recovered,
    sameAddress: buyerMatch,
  });
  if (!refusedRight) throw new Error(`previous owner was not refused: ${JSON.stringify(refused)}`);
  if (!buyerMatch) throw new Error("buyer's signature does not recover to the token's address");
  evidence.steps.push(
    { step: "nft_transfer", tx: moved.hash, to: BUYER },
    { step: "sign_evm (previous owner) refused", tx: refused.hash },
    { step: "sign_evm (buyer)", tx: buyer.hash, recovered: buyer.recovered },
  );

  const init = await call(OWNER, "new", { mpc_contract: OWNER }, { gas: "30 Tgas" });
  const reason = init.error?.match(/Method new is private|The contract has already been initialized/)?.[0];
  log("7. init from another account", { tx: init.hash, refused: !init.ok, reason });
  if (init.ok || !reason) throw new Error(`new was not refused: ${JSON.stringify(init)}`);
  evidence.steps.push({ step: "new from another account refused", tx: init.hash, reason });

  if (OUT) {
    writeFileSync(OUT, `${JSON.stringify({ ...evidence, ranAt: new Date().toISOString() }, null, 2)}\n`);
    log("evidence written", OUT);
  }
  console.log("\nE2E PASS");
}

async function send(tokenId, signer) {
  const owner = await view(CONTRACT, "nft_token", { token_id: tokenId }).then((t) => t?.owner_id);
  log("token", { tokenId, owner, signer, address: await addressOf(tokenId) });
  const sent = await sendFrom(tokenId, signer);
  log("sent on Sepolia", { ...sent, url: `https://sepolia.etherscan.io/tx/${sent.sepoliaTx}` });
  log("signing record", await view(CONTRACT, "signing_record", { token_id: tokenId }));
  if (OUT) {
    const { address, nearTx, sepoliaTx: evmTx, block } = sent;
    const out = { network: "testnet", contract: CONTRACT, tokenId, signer, address, nearTx, sepoliaTx: evmTx, block, ranAt: new Date().toISOString() };
    writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
  }
  console.log("\nSEND PASS");
}

(process.argv[2] === "send" ? send(process.argv[3], process.argv[4]) : main()).catch((err) => {
  console.error(`\nE2E FAIL: ${err.message}`);
  process.exit(1);
});
