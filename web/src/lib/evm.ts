import {
  type Address,
  type Hex,
  type PublicClient,
  type TransactionSerializableEIP1559,
  createPublicClient,
  getAddress,
  http,
  keccak256,
  recoverAddress,
  serializeTransaction,
  toHex,
} from "viem";
import { type ChainInfo, NETWORK, chainInfo } from "./config";
import { view } from "./near";

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

/** The address a token's key controls, derived by the MPC contract from this contract and the path. */
export async function tokenAddress(path: string): Promise<Address> {
  const key = await view<string>(NETWORK.mpc, "derived_public_key", {
    path,
    predecessor: NETWORK.contract,
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

/**
 * Builds a transaction from a token's address. Fees leave room for a doubled base fee, since the
 * MPC signature takes a few NEAR blocks to arrive.
 */
export async function prepareTx(chain: ChainInfo, from: Address, to: Address, value: bigint, data: Hex): Promise<EvmTx> {
  const c = client(chain.id);
  const [nonce, block, priority, gas] = await Promise.all([
    c.getTransactionCount({ address: from, blockTag: "pending" }),
    c.getBlock({ blockTag: "latest" }),
    c.estimateMaxPriorityFeePerGas().catch(() => 1_000_000_000n),
    data === "0x" ? Promise.resolve(21_000n) : c.estimateGas({ account: from, to, value, data }),
  ]);
  const baseFee = block.baseFeePerGas ?? 0n;
  return {
    chainId: chain.id,
    nonce,
    maxPriorityFeePerGas: priority,
    maxFeePerGas: baseFee * 2n + priority,
    gas: data === "0x" ? gas : (gas * 12n) / 10n,
    to,
    value,
    data,
  };
}

/** Most the transaction can cost the sender: gas at the fee cap, plus the value. */
export function maxCost(tx: EvmTx): bigint {
  return tx.gas * tx.maxFeePerGas + tx.value;
}
