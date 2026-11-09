// Shared by the testnet scripts: NEAR RPC reads, function calls signed by near CLI, the MPC
// address of a token, and Sepolia transactions signed through `sign_evm`.
//
// Transactions are signed by near CLI from the legacy keychain (~/.near-credentials); nothing here
// reads a key.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createPublicClient, http, keccak256, recoverAddress, serializeTransaction, toHex } from "viem";
import { sepolia } from "viem/chains";

export const CONTRACT = process.env.SATCHEL_CONTRACT ?? "v1.satchel-nft.testnet";
export const OWNER = process.env.SATCHEL_OWNER ?? "satchel-nft.testnet";
export const BUYER = process.env.SATCHEL_BUYER ?? "buyer.satchel-nft.testnet";
export const MPC = "v1.signer-prod.testnet";
export const DEAD = "0x000000000000000000000000000000000000dEaD";
const NEAR_CLI = process.env.NEAR_CLI ?? "near";
const NEAR_RPC = process.env.NEAR_RPC ?? "https://rpc.testnet.fastnear.com";
const SEPOLIA_RPC = process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com";
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

export const sepoliaClient = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC) });

/** The value after `--name` on the command line, or null. */
export function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
}

export function log(step, detail) {
  console.log(`\n== ${step}`);
  if (detail !== undefined) {
    console.log(typeof detail === "string" ? detail : JSON.stringify(detail, (_, v) => (typeof v === "bigint" ? String(v) : v), 2));
  }
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

export async function view(account, method, args) {
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
export async function call(signer, method, args, { deposit = "0 NEAR", gas = "300 Tgas" } = {}) {
  const cli = spawnSync(
    NEAR_CLI,
    [
      "contract", "call-function", "as-transaction", CONTRACT, method,
      "json-args", JSON.stringify(args),
      "prepaid-gas", gas, "attached-deposit", deposit,
      "sign-as", signer, "network-config", "testnet", "sign-with-legacy-keychain", "display",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (cli.error) throw new Error(`could not run ${NEAR_CLI}: ${cli.error.message}`);
  // near CLI prints its report, the signed transaction included, to stderr.
  const output = `${cli.stdout}${cli.stderr}`;
  const signed = output.split("Signed transaction (serialized as base64):")[1]?.trim().split(/\s+/)[0];
  if (!signed) throw new Error(`no signed transaction in near CLI output:\n${output}`);
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

/** EVM address of a derivation path: keccak256 of the 64-byte public key the MPC contract derives. */
export async function tokenAddress(path) {
  const pk = await view(MPC, "derived_public_key", { path, predecessor: CONTRACT, domain_id: 0 });
  const bytes = base58Decode(pk.replace("secp256k1:", ""));
  if (bytes.length !== 64) throw new Error(`unexpected public key length ${bytes.length}`);
  return { publicKey: pk, address: `0x${keccak256(toHex(bytes)).slice(-40)}` };
}

/** EVM address of a token, through its derivation path. */
export async function addressOf(tokenId) {
  return (await tokenAddress(await view(CONTRACT, "derivation_path", { token_id: tokenId }))).address;
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

/**
 * A Sepolia EIP-1559 transaction from `address` at its next nonce. The gas limit is the node's
 * estimate plus 20%, even for a plain send: Sepolia charges about 205k gas to send to an address
 * that has never been used, and a 21000 limit reverts. No node can estimate for an address that
 * can't pay yet, so only a caller signing for one passes `gas` itself. The fee cap is twice the
 * node's estimate, so a rising base fee can't leave a signed transaction stuck in the mempool.
 */
export async function sepoliaTx(address, { to = DEAD, value = 1n, data = "0x", gas } = {}) {
  const [nonce, fees] = await Promise.all([
    sepoliaClient.getTransactionCount({ address, blockTag: "pending" }),
    sepoliaClient.estimateFeesPerGas(),
  ]);
  return {
    chainId: 11155111,
    nonce,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    maxFeePerGas: fees.maxFeePerGas * 2n,
    gas: gas ?? ((await sepoliaClient.estimateGas({ account: address, to, value, data })) * 12n) / 10n,
    to,
    value,
    data,
  };
}

export function contractTx(tx) {
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

/**
 * Has `signer` call `sign_evm` for `tx`, after checking the contract hashes it as viem does, and
 * recovers the signer from the MPC signature. Returns the call's result plus the signing hash,
 * the recovered address and the raw signed transaction.
 */
export async function signAndRecover(signer, tokenId, tx) {
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

/**
 * Signs a Sepolia transaction from a token's address as `signer`, its owner, through `sign_evm`,
 * and checks the signature recovers to the address. Refuses before signing if the address can't
 * pay for it. The signature is public in the NEAR receipt from then on, and the satchel isn't
 * clean until the transaction is on chain, so the result holds what `broadcast` needs to finish
 * the job, rerun as often as it takes: the raw transaction and its hash.
 */
export async function signSend(tokenId, signer, fields = {}) {
  const address = await addressOf(tokenId);
  const tx = await sepoliaTx(address, fields);
  const balance = await sepoliaClient.getBalance({ address });
  const cost = tx.maxFeePerGas * tx.gas + tx.value;
  if (balance < cost) throw new Error(`satchel #${tokenId} (${address}) holds ${balance} wei on Sepolia and needs ${cost}; fund it and run again`);
  const signed = await signAndRecover(signer, tokenId, tx);
  if (!signed.ok) throw new Error(`sign_evm for satchel #${tokenId} failed: ${signed.error}`);
  if (signed.recovered.toLowerCase() !== address.toLowerCase()) throw new Error("recovered signer is not the token's address");
  return { tokenId, address, nearTx: signed.hash, nonce: tx.nonce, raw: signed.raw, sepoliaTx: keccak256(signed.raw) };
}

/**
 * Broadcasts a send `signSend` returned and waits for its receipt. Safe to repeat: when the node
 * already has the transaction, or has mined it, the wait goes on by its hash.
 */
export async function broadcast(signed) {
  await sepoliaClient.sendRawTransaction({ serializedTransaction: signed.raw }).catch((err) => {
    if (!/already known|nonce too low/i.test(`${err.details ?? ""} ${err.message}`)) throw err;
  });
  const receipt = await sepoliaClient.waitForTransactionReceipt({ hash: signed.sepoliaTx, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error(`Sepolia transaction ${signed.sepoliaTx} reverted`);
  const { raw, ...sent } = signed;
  return { ...sent, block: String(receipt.blockNumber) };
}

/** Signs and sends a Sepolia transaction from a token's address; see `signSend`. */
export async function sendFrom(tokenId, signer, fields = {}) {
  return broadcast(await signSend(tokenId, signer, fields));
}
