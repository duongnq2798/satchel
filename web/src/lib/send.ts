import { type Address, type Hex, getAddress } from "viem";
import type { ChainInfo } from "./config";
import {
  type EvmTx,
  type MpcSignature,
  client,
  maxCost,
  prepareTx,
  recoverSigner,
  signedRawTx,
  signingHash,
  toContractTx,
  toEvmSignature,
} from "./evm";
import { satchel, satchelTx, type WalletTx } from "./satchel";

export type SendStep = "build" | "hash" | "wallet" | "recover" | "broadcast" | "confirm";

export interface SendRequest {
  tokenId: string;
  from: Address;
  chain: ChainInfo;
  to: Address;
  value: bigint;
  data: Hex;
}

export interface SendResult {
  nearTx: string;
  evmTx: Hex;
  status: "success" | "reverted";
}

/** Everything the flow touches outside itself, so each guard can be tested without a chain. */
export interface SendDeps {
  prepare: (r: SendRequest) => Promise<EvmTx>;
  balance: (chainId: number, address: Address) => Promise<bigint>;
  contractHash: (tx: EvmTx) => Promise<string>;
  /** Has the wallet sign `sign_evm` and resolves to the NEAR tx hash and the MPC signature. */
  signWithWallet: (tx: WalletTx) => Promise<{ hash: string; signature: MpcSignature | null }>;
  broadcast: (chainId: number, raw: Hex) => Promise<Hex>;
  confirm: (chainId: number, hash: Hex) => Promise<"success" | "reverted">;
}

export const liveSendDeps = (
  signWithWallet: SendDeps["signWithWallet"],
): SendDeps => ({
  prepare: (r) => prepareTx(r.chain, r.from, r.to, r.value, r.data),
  balance: (chainId, address) => client(chainId).getBalance({ address }),
  contractHash: (tx) => satchel.signingHash(toContractTx(tx)),
  signWithWallet,
  broadcast: (chainId, raw) => client(chainId).sendRawTransaction({ serializedTransaction: raw }),
  confirm: async (chainId, hash) => (await client(chainId).waitForTransactionReceipt({ hash, timeout: 180_000 })).status,
});

/**
 * Sends from a token's address: build the EVM transaction, check the contract hashes it the same
 * way, have the owner's wallet call `sign_evm`, check the MPC signature recovers to the token's
 * address, then broadcast. Every check runs before the step that would spend anything.
 */
export async function sendFromSatchel(
  request: SendRequest,
  deps: SendDeps,
  onStep: (step: SendStep, detail?: string) => void = () => {},
): Promise<SendResult> {
  onStep("build");
  const tx = await deps.prepare(request);
  const balance = await deps.balance(request.chain.id, request.from);
  const cost = maxCost(tx);
  if (balance < cost) {
    throw new Error(
      `This satchel holds ${balance} wei on ${request.chain.name} and the transaction can cost up to ${cost}. Fund ${request.from} first.`,
    );
  }

  onStep("hash");
  const local = signingHash(tx);
  const onChain = `0x${await deps.contractHash(tx)}`;
  if (onChain !== local) throw new Error(`The contract would sign ${onChain}, not ${local}. Nothing was signed.`);

  onStep("wallet");
  const signed = await deps.signWithWallet(satchelTx.signEvm(request.tokenId, toContractTx(tx)));
  if (signed.signature === null) {
    throw new Error(`sign_evm (${signed.hash}) finished without a signature. Your record shows the nonce; signing again is safe.`);
  }

  onStep("recover", signed.hash);
  const signature = toEvmSignature(signed.signature);
  const recovered = await recoverSigner(tx, signature);
  if (getAddress(recovered) !== getAddress(request.from)) {
    throw new Error(`The signature recovers to ${recovered}, not this satchel's ${request.from}. Nothing was broadcast.`);
  }

  onStep("broadcast", signed.hash);
  const evmTx = await deps.broadcast(request.chain.id, signedRawTx(tx, signature));

  onStep("confirm", evmTx);
  const status = await deps.confirm(request.chain.id, evmTx);
  return { nearTx: signed.hash, evmTx, status };
}
