import {
  type Address,
  type Hex,
  type PublicClient,
  type TransactionSerializableEIP1559,
  createPublicClient,
  formatUnits,
  getAddress,
  http,
  keccak256,
  recoverAddress,
  serializeTransaction,
  toHex,
} from "viem";
import { type ChainInfo, type Network, chainInfo } from "./config.js";
import { view } from "./near.js";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

export function base58Decode(text: string): Uint8Array {
  let n = 0n;
  for (const c of text) {
    const digit = BASE58.indexOf(c);
    if (digit < 0) throw new Error(`not base58: ${c}`);
    n = n * 58n + BigInt(digit);
  }
  let hex = n === 0n ? "" : n.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const body = (hex.match(/../g) ?? []).map((byte) => Number.parseInt(byte, 16));
  const lead = text.match(/^1*/)?.[0].length ?? 0;
  return Uint8Array.from([...new Array(lead).fill(0), ...body]);
}

/** EVM address of an MPC key: the last 20 bytes of keccak256 over the 64-byte uncompressed key. */
export function addressFromMpcKey(publicKey: string): Address {
  if (!publicKey.startsWith("secp256k1:")) throw new Error(`not a secp256k1 key: ${publicKey}`);
  const bytes = base58Decode(publicKey.slice("secp256k1:".length));
  if (bytes.length !== 64) throw new Error(`expected a 64-byte key, got ${bytes.length}`);
  return getAddress(`0x${keccak256(toHex(bytes)).slice(-40)}`);
}

/** The address a token's key controls, derived by `net`'s MPC contract from its Satchel contract and the path. */
export async function tokenAddress(net: Network, path: string): Promise<Address> {
  const key = await view<string>(net, net.mpc, "derived_public_key", {
    path,
    predecessor: net.contract,
    domain_id: 0,
  });
  return addressFromMpcKey(key);
}

/** What the MPC contract returns from `sign` (domain 0, ECDSA). */
export interface MpcSignature {
  scheme?: string;
  big_r: { affine_point: string };
  s: { scalar: string };
  recovery_id: number;
}

/** viem's signature, with `s` normalized to the low half as EVM nodes require. */
export function toEvmSignature(mpc: MpcSignature): { r: Hex; s: Hex; yParity: number } {
  const point = mpc.big_r.affine_point.toLowerCase();
  if (!/^0[23][0-9a-f]{64}$/.test(point)) throw new Error("MPC signature: big_r is not a compressed point");
  let s = BigInt(`0x${mpc.s.scalar}`);
  let yParity = mpc.recovery_id;
  if (yParity !== 0 && yParity !== 1) throw new Error("MPC signature: recovery_id must be 0 or 1");
  if (s > SECP256K1_N / 2n) {
    s = SECP256K1_N - s;
    yParity ^= 1;
  }
  return { r: `0x${point.slice(2)}`, s: `0x${s.toString(16).padStart(64, "0")}`, yParity };
}

/** `Eip1559Tx` as the contract's `sign_evm` takes it. */
export interface ContractTx {
  chain_id: string;
  nonce: string;
  max_priority_fee_per_gas: string;
  max_fee_per_gas: string;
  gas_limit: string;
  to: string;
  value: string;
  data: string;
}

export interface EvmTx {
  chainId: number;
  nonce: number;
  maxPriorityFeePerGas: bigint;
  maxFeePerGas: bigint;
  gas: bigint;
  to: Address;
  value: bigint;
  data: Hex;
}

export function toContractTx(tx: EvmTx): ContractTx {
  return {
    chain_id: tx.chainId.toString(),
    nonce: tx.nonce.toString(),
    max_priority_fee_per_gas: tx.maxPriorityFeePerGas.toString(),
    max_fee_per_gas: tx.maxFeePerGas.toString(),
    gas_limit: tx.gas.toString(),
    to: tx.to,
    value: tx.value.toString(),
    data: tx.data,
  };
}

function serializable(tx: EvmTx): TransactionSerializableEIP1559 {
  return { type: "eip1559", ...tx, accessList: [] };
}

/** The hash the token's key signs (EIP-1559). The contract computes the same one on chain. */
export function signingHash(tx: EvmTx): Hex {
  return keccak256(serializeTransaction(serializable(tx)));
}

export function signedRawTx(tx: EvmTx, signature: { r: Hex; s: Hex; yParity: number }): Hex {
  return serializeTransaction(serializable(tx), signature);
}

export async function recoverSigner(tx: EvmTx, signature: { r: Hex; s: Hex; yParity: number }): Promise<Address> {
  return recoverAddress({ hash: signingHash(tx), signature });
}

const clients = new Map<number, PublicClient>();

export function client(chainId: number): PublicClient {
  const known = clients.get(chainId);
  if (known) return known;
  const info = chainInfo(chainId);
  if (!info) throw new Error(`chain ${chainId} is not supported`);
  const made = createPublicClient({ transport: http(info.rpc, { timeout: 15_000, retryCount: 1 }) }) as PublicClient;
  clients.set(chainId, made);
  return made;
}

const verified = new Map<number, Promise<PublicClient>>();

/** The chain's client, once its RPC has said it serves that chain. Every read the report pins goes through it. */
export function verifiedClient(chainId: number): Promise<PublicClient> {
  const known = verified.get(chainId);
  if (known) return known;
  const c = client(chainId);
  const checked = c.getChainId().then((id) => {
    if (id !== chainId) throw new Error(`${chainInfo(chainId)?.rpc} serves chain ${id}, not ${chainId}`);
    return c;
  });
  checked.catch(() => verified.delete(chainId));
  verified.set(chainId, checked);
  return checked;
}

/**
 * Builds a transaction from a token's address. Fees leave room for a doubled base fee, since the
 * MPC signature takes a few NEAR blocks to arrive. Gas is always estimated: a plain send to a
 * contract runs its `receive()` and needs more than 21000.
 */
export async function prepareTx(chain: ChainInfo, from: Address, to: Address, value: bigint, data: Hex): Promise<EvmTx> {
  const c = await verifiedClient(chain.id);
  const [nonce, block, priority, estimate] = await Promise.all([
    c.getTransactionCount({ address: from, blockTag: "pending" }),
    c.getBlock({ blockTag: "latest" }),
    // No guess: a tip below the chain's minimum (25 gwei on Polygon) is refused after the MPC signed.
    c.estimateMaxPriorityFeePerGas().catch((err: unknown) => {
      throw new Error(`Couldn't read ${chain.name}'s priority fee, so nothing was signed: ${shortError(err)}`);
    }),
    c.estimateGas({ account: from, to, value, data }).catch((err: unknown) => {
      throw new Error(`${chain.name} says this transaction would fail, so nothing was signed: ${shortError(err)}`);
    }),
  ]);
  const baseFee = block.baseFeePerGas ?? 0n;
  return {
    chainId: chain.id,
    nonce,
    maxPriorityFeePerGas: priority,
    maxFeePerGas: baseFee * 2n + priority,
    gas: estimate <= 21_000n ? 21_000n : (estimate * 12n) / 10n,
    to,
    value,
    data,
  };
}

function shortError(err: unknown): string {
  if (err && typeof err === "object" && "shortMessage" in err && typeof err.shortMessage === "string") return err.shortMessage;
  return err instanceof Error ? err.message : String(err);
}

/** OP Stack chains charge an L1 data fee on top of gas, from this predeploy. */
const GAS_PRICE_ORACLE = "0x420000000000000000000000000000000000000F" as const;
const OP_STACK = new Set([10, 11155420, 8453, 84532]);
const getL1FeeAbi = [
  {
    type: "function",
    name: "getL1Fee",
    stateMutability: "view",
    inputs: [{ name: "_data", type: "bytes" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** The L1 data fee the sender pays besides gas, doubled for headroom; 0 off the OP Stack. */
export async function l1Fee(tx: EvmTx): Promise<bigint> {
  if (!OP_STACK.has(tx.chainId)) return 0n;
  const fee = await client(tx.chainId).readContract({
    address: GAS_PRICE_ORACLE,
    abi: getL1FeeAbi,
    functionName: "getL1Fee",
    args: [serializeTransaction(serializable(tx))],
  });
  return fee * 2n;
}

/** Most the transaction can cost the sender: gas at the fee cap, plus the value, plus any L1 fee. */
export function maxCost(tx: EvmTx, extraFee = 0n): bigint {
  return tx.gas * tx.maxFeePerGas + tx.value + extraFee;
}

/** An amount in whole units, to 5 decimals: "0.00184", "< 0.00001", "0". */
export function formatAmount(amount: bigint, decimals: number): string {
  if (amount === 0n) return "0";
  const [whole, fraction = ""] = formatUnits(amount, decimals).split(".");
  const short = fraction.slice(0, 5).replace(/0+$/, "");
  return short ? `${whole}.${short}` : whole === "0" ? "< 0.00001" : whole;
}

/** A native balance, 18 decimals on every chain Satchel signs for. */
export function formatBalance(wei: bigint): string {
  return formatAmount(wei, 18);
}
