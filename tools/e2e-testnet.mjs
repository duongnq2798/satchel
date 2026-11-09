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
// Transactions are signed by near CLI from the legacy keychain (~/.near-credentials); this script
// never reads a key. Usage (near CLI on PATH, or NEAR_CLI=/path/to/near):
//   node e2e-testnet.mjs [--out ../deployments/testnet-e2e.json]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createPublicClient, http, keccak256, recoverAddress, serializeTransaction, toHex } from "viem";
import { sepolia } from "viem/chains";

const CONTRACT = process.env.SATCHEL_CONTRACT ?? "v1.satchel-nft.testnet";
const OWNER = process.env.SATCHEL_OWNER ?? "satchel-nft.testnet";
const BUYER = process.env.SATCHEL_BUYER ?? "buyer.satchel-nft.testnet";
const MPC = "v1.signer-prod.testnet";
const NEAR_CLI = process.env.NEAR_CLI ?? "near";
const NEAR_RPC = process.env.NEAR_RPC ?? "https://rpc.testnet.fastnear.com";
const SEPOLIA_RPC = process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com";
const OUT = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : null;
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

const evidence = { network: "testnet", contract: CONTRACT, mpc: MPC, steps: [] };
const sepoliaClient = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC) });

function log(step, detail) {
  console.log(`\n== ${step}`);
  if (detail !== undefined) console.log(typeof detail === "string" ? detail : JSON.stringify(detail, null, 2));
}

async function rpc(method, params) {
  const res = await fetch(NEAR_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

async function view(account, method, args) {
  const result = await rpc("query", {
    request_type: "call_function",
    finality: "final",
    account_id: account,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  });
  return JSON.parse(Buffer.from(result.result).toString());
}

/**
 * Signs a function call with near CLI (`display`, so the CLI never sends it), broadcasts it over
 * RPC and waits for the final outcome. The CLI prints no transaction id for a refused call, so the
 * hash is computed here: sha256 of the signed bytes minus the 65-byte ed25519 signature.
 * Returns {hash, ok, value, error}.
 */
async function call(signer, method, args, { deposit = "0 NEAR", gas = "300 Tgas" } = {}) {
  const output = execFileSync(
    NEAR_CLI,
    [
      "contract", "call-function", "as-transaction", CONTRACT, method,
      "json-args", JSON.stringify(args),
      "prepaid-gas", gas, "attached-deposit", deposit,
      "sign-as", signer, "network-config", "testnet", "sign-with-legacy-keychain", "display",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const signed = output.split("Signed transaction (serialized as base64):")[1]?.trim().split(/s+/)[0];
  if (!signed) throw new Error(`no signed transaction in near CLI output:
${output}`);
  const bytes = Buffer.from(signed, "base64");
  const hash = base58Encode(createHash("sha256").update(bytes.subarray(0, bytes.length - 65)).digest());
  await rpc("send_tx", { signed_tx_base64: signed, wait_until: "NONE" });
  let outcome;
  for (let attempt = 0; !outcome; attempt++) {
    try {
      outcome = await rpc("tx", { tx_hash: hash, sender_account_id: signer, wait_until: "FINAL" });
    } catch (err) {
      if (attempt >= 20) throw err;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  const status = outcome.status;
  if (status.SuccessValue !== undefined) {
    const raw = Buffer.from(status.SuccessValue, "base64").toString();
    return { hash, ok: true, value: raw ? JSON.parse(raw) : null };
  }
  return { hash, ok: false, error: JSON.stringify(status.Failure) };
}

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Encode(bytes) {
  let n = BigInt(`0x${Buffer.from(bytes).toString("hex") || "0"}`);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

function base58Decode(s) {
  let n = 0n;
  for (const c of s) n = n * 58n + BigInt(ALPHABET.indexOf(c));
  let hex = n.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const lead = s.match(/^1*/)[0].length;
  return Buffer.concat([Buffer.alloc(lead), Buffer.from(hex, "hex")]);
}

/** EVM address of a token: keccak256 of the 64-byte public key the MPC contract derives. */
async function tokenAddress(path) {
  const pk = await view(MPC, "derived_public_key", { path, predecessor: CONTRACT, domain_id: 0 });
  const bytes = base58Decode(pk.replace("secp256k1:", ""));
  if (bytes.length !== 64) throw new Error(`unexpected public key length ${bytes.length}`);
  return { publicKey: pk, address: `0x${keccak256(toHex(bytes)).slice(-40)}` };
}

/** viem signature from the MPC response, normalized to low s as EVM nodes require. */
function toEvmSignature(mpc) {
  const r = `0x${mpc.big_r.affine_point.slice(2).toLowerCase()}`;
  let s = BigInt(`0x${mpc.s.scalar}`);
  let yParity = mpc.recovery_id;
  if (s > SECP256K1_N / 2n) {
    s = SECP256K1_N - s;
    yParity ^= 1;
  }
  return { r, s: `0x${s.toString(16).padStart(64, "0")}`, yParity };
}

async function sepoliaTx(address) {
  const [nonce, fees] = await Promise.all([
    sepoliaClient.getTransactionCount({ address, blockTag: "pending" }),
    sepoliaClient.estimateFeesPerGas(),
  ]);
  return {
    chainId: 11155111,
    nonce,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    maxFeePerGas: fees.maxFeePerGas,
    gas: 21000n,
    to: "0x000000000000000000000000000000000000dEaD",
    value: 1n,
    data: "0x",
  };
}

function contractTx(tx) {
  return {
    chain_id: String(tx.chainId),
    nonce: String(tx.nonce),
    max_priority_fee_per_gas: String(tx.maxPriorityFeePerGas),
    max_fee_per_gas: String(tx.maxFeePerGas),
    gas_limit: String(tx.gas),
    to: tx.to,
    value: String(tx.value),
    data: tx.data,
  };
}

async function signAndRecover(signer, tokenId, expected) {
  const tx = await sepoliaTx(expected);
  const signingHash = keccak256(serializeTransaction({ type: "eip1559", ...tx }));
  const onChainHash = await view(CONTRACT, "evm_signing_hash", { tx: contractTx(tx) });
  if (`0x${onChainHash}` !== signingHash) throw new Error(`contract hash ${onChainHash} != viem ${signingHash}`);
  const res = await call(signer, "sign_evm", { token_id: tokenId, tx: contractTx(tx) }, { deposit: "1 yoctoNEAR" });
  if (!res.ok) return { ...res, tx };
  const signature = toEvmSignature(res.value);
  const recovered = await recoverAddress({ hash: signingHash, signature });
  const raw = serializeTransaction({ type: "eip1559", ...tx }, signature);
  return { ...res, tx, signingHash, signature, recovered, raw };
}

async function main() {
  log("contract", { contract: CONTRACT, mpc: await view(CONTRACT, "mpc_contract", {}) });

  const minted = await call(OWNER, "mint", {}, { deposit: "0.1 NEAR", gas: "50 Tgas" });
  if (!minted.ok) throw new Error(`mint failed: ${minted.error}`);
  const tokenId = minted.value.token_id;
  const path = await view(CONTRACT, "derivation_path", { token_id: tokenId });
  const { publicKey, address } = await tokenAddress(path);
  log("1-2. minted and derived", { tokenId, owner: OWNER, path, publicKey, address, tx: minted.hash });
  evidence.steps.push({ step: "mint", tx: minted.hash, tokenId, path, address });

  const first = await signAndRecover(OWNER, tokenId, address);
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
  const refused = await call(OWNER, "sign_evm", { token_id: tokenId, tx: contractTx(await sepoliaTx(address)) }, { deposit: "1 yoctoNEAR" });
  const refusedRight = !refused.ok && refused.error.includes("only the token's owner");
  const buyer = await signAndRecover(BUYER, tokenId, address);
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

main().catch((err) => {
  console.error(`\nE2E FAIL: ${err.message}`);
  process.exit(1);
});
