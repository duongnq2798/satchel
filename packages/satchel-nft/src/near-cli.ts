import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";
import { type Network, TGAS } from "./config.js";
import { type ExecutionOutcome, finalOutcome, nearRpc } from "./near.js";
import type { WalletTx } from "./satchel.js";

/**
 * Signs Satchel transactions with the near CLI (near-cli-rs), which holds the key: this package
 * never reads one. The CLI only signs (`display`); the transaction is decoded and checked against
 * what was asked for, field by field, before it is broadcast over RPC.
 */
export type Keychain = "legacy" | "os";

export interface NearCli {
  /** The near CLI binary's absolute path, from `resolveNearCli`. */
  bin: string;
  /** `legacy` signs with ~/.near-credentials, `os` with the OS keychain. */
  keychain: Keychain;
}

function runnable(file: string, windows: boolean): boolean {
  try {
    if (!statSync(file).isFile()) return false;
    if (!windows) accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * The absolute path of the near CLI to run. A path is used as given. A bare name is looked up only
 * in PATH's absolute entries: given a bare name, Windows runs a `near.exe` from the current folder
 * first, so a folder you run this in could hand your key to a program it planted.
 */
export function resolveNearCli(bin: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  const windows = platform === "win32";
  const p = windows ? path.win32 : path.posix;
  const script = /\.(cmd|bat|ps1)$/i;
  if (bin.includes("/") || (windows && bin.includes("\\"))) {
    const file = p.resolve(bin);
    if (windows && script.test(file)) throw new Error(`${file} is a script: pass the path of near.exe itself with --near-cli`);
    if (!runnable(file, windows)) throw new Error(`No near CLI at ${file}`);
    return file;
  }
  const names = windows && !/\.exe$/i.test(bin) ? [`${bin}.exe`] : [bin];
  const entries = (env.PATH ?? env.Path ?? "").split(p.delimiter).filter((entry) => entry !== "" && p.isAbsolute(entry));
  for (const entry of entries) {
    for (const name of names) {
      const file = p.join(entry, name);
      if (runnable(file, windows)) return file;
    }
  }
  throw new Error(`No ${names[0]} in PATH's absolute folders. Install near-cli-rs, or pass --near-cli <path to it>`);
}

/** The near CLI arguments that sign `tx` as `signer` on `net` without sending it. */
export function nearCliArgs(net: Network, signer: string, tx: WalletTx, keychain: Keychain): string[] {
  const call = onlyCall(tx);
  const gas = BigInt(call.gas);
  if (gas % TGAS !== 0n) throw new Error(`gas ${gas} is not a whole number of Tgas`);
  return [
    "contract",
    "call-function",
    "as-transaction",
    tx.receiverId,
    call.methodName,
    "json-args",
    JSON.stringify(call.args),
    "prepaid-gas",
    `${gas / TGAS} Tgas`,
    "attached-deposit",
    `${BigInt(call.deposit)} yoctoNEAR`,
    "sign-as",
    signer,
    "network-config",
    net.id,
    keychain === "os" ? "sign-with-keychain" : "sign-with-legacy-keychain",
    "display",
  ];
}

function onlyCall(tx: WalletTx) {
  if (tx.actions.length !== 1 || tx.actions[0].type !== "FunctionCall") {
    throw new Error("Only a single function call can be signed");
  }
  return tx.actions[0].params;
}

/** The signed transaction in the near CLI's output, which it prints to stderr. */
export function signedFromOutput(output: string): string {
  const signed = output.split("Signed transaction (serialized as base64):")[1]?.trim().split(/\s+/)[0];
  if (!signed || !/^[A-Za-z0-9+/]+=*$/.test(signed)) {
    const tail = output.trim().split("\n").slice(-8).join("\n");
    throw new Error(`The near CLI did not sign. Its output ends with:\n${tail}`);
  }
  return signed;
}

/** A function call as a signed NEAR transaction carries it. */
export interface DecodedTx {
  signerId: string;
  publicKey: string;
  nonce: bigint;
  receiverId: string;
  methodName: string;
  args: string;
  gas: bigint;
  deposit: bigint;
  /** base58 sha256 of the unsigned transaction: the hash NEAR knows it by. */
  hash: string;
}

const ED25519 = 0;
const SECP256K1 = 1;
const KEY_LENGTH = { [ED25519]: 32, [SECP256K1]: 64 } as Record<number, number>;
const SIGNATURE_LENGTH = { [ED25519]: 64, [SECP256K1]: 65 } as Record<number, number>;
const FUNCTION_CALL = 2;

/**
 * Decodes a borsh SignedTransaction (V0) that holds exactly one function call. Anything else, a
 * second action, a V1 transaction or trailing bytes, is refused rather than skipped.
 */
export function decodeSignedTx(base64: string): DecodedTx {
  const bytes = Uint8Array.from(Buffer.from(base64, "base64"));
  let at = 0;
  const take = (n: number) => {
    if (at + n > bytes.length) throw new Error("The signed transaction ends early");
    const out = bytes.subarray(at, at + n);
    at += n;
    return out;
  };
  const u8 = () => take(1)[0];
  const u32 = () => Buffer.from(take(4)).readUInt32LE(0);
  const u64 = () => Buffer.from(take(8)).readBigUInt64LE(0);
  const u128 = () => {
    const lo = u64();
    return (u64() << 64n) | lo;
  };
  const string = () => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(take(u32()));
  let keyType = -1;
  const key = () => {
    keyType = u8();
    const length = KEY_LENGTH[keyType];
    if (length === undefined) throw new Error(`Unknown key type ${keyType}`);
    return `${keyType === ED25519 ? "ed25519" : "secp256k1"}:${base58Encode(take(length))}`;
  };

  // A V0 transaction starts with the signer's name length, 2 to 64, so its first byte is never 1.
  if (bytes[0] === 1) throw new Error("The near CLI signed a V1 transaction; sign with a full access or function call key");
  const signerId = string();
  const publicKey = key();
  const nonce = u64();
  const receiverId = string();
  take(32); // block hash
  if (u32() !== 1) throw new Error("The signed transaction must hold exactly one action");
  if (u8() !== FUNCTION_CALL) throw new Error("The signed transaction's action is not a function call");
  const methodName = string();
  const args = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(take(u32()));
  const gas = u64();
  const deposit = u128();
  const unsigned = bytes.subarray(0, at);

  const signatureType = u8();
  if (signatureType !== keyType) throw new Error("The signature's type is not the key's");
  take(SIGNATURE_LENGTH[signatureType]);
  if (at !== bytes.length) throw new Error("The signed transaction has trailing bytes");

  const hash = base58Encode(createHash("sha256").update(unsigned).digest());
  return { signerId, publicKey, nonce, receiverId, methodName, args, gas, deposit, hash };
}

/** JSON with object keys sorted, so two encodings of the same value compare equal. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v,
  );
}

/** Throws unless the near CLI signed exactly `tx`, as `signer`, and nothing else. */
export function assertSignedAsAsked(decoded: DecodedTx, signer: string, tx: WalletTx): void {
  const call = onlyCall(tx);
  const differences: string[] = [];
  const same = (what: string, got: unknown, want: unknown) => got !== want && differences.push(`${what} is ${got}, not ${want}`);
  same("the signer", decoded.signerId, signer);
  same("the receiver", decoded.receiverId, tx.receiverId);
  same("the method", decoded.methodName, call.methodName);
  same("the gas", decoded.gas, BigInt(call.gas));
  same("the deposit", decoded.deposit, BigInt(call.deposit));
  let args: unknown;
  try {
    args = JSON.parse(decoded.args);
  } catch {
    args = decoded.args;
  }
  if (canonical(args) !== canonical(call.args)) differences.push(`the arguments are ${decoded.args}, not ${JSON.stringify(call.args)}`);
  if (differences.length > 0) throw new Error(`The near CLI signed something else, so nothing was sent: ${differences.join("; ")}`);
}

/** Runs the near CLI to sign `tx`. Returns the signed transaction, base64. */
export function signWithNearCli(cli: NearCli, net: Network, signer: string, tx: WalletTx): string {
  const run = spawnSync(cli.bin, nearCliArgs(net, signer, tx, cli.keychain), {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  });
  if (run.error) {
    throw new Error(`Could not run the near CLI (${cli.bin}): ${run.error.message}. Install near-cli-rs, or pass --near-cli <path>`);
  }
  return signedFromOutput(`${run.stdout}\n${run.stderr}`);
}

/**
 * Thrown once a signed transaction may have reached the network but its outcome could not be read:
 * it may have run, so running the command again could do it twice.
 */
export class OutcomeUnknown extends Error {
  constructor(
    readonly hash: string,
    cause: unknown,
  ) {
    super(`Sent ${hash}, but its outcome couldn't be read: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

/**
 * Signs `tx` with the near CLI, checks it, sends it and waits until every receipt is final.
 * `beforeSend` sees what the near CLI signed and can still stop it by throwing.
 */
export async function signAndSend(
  cli: NearCli,
  net: Network,
  signer: string,
  tx: WalletTx,
  beforeSend: (decoded: DecodedTx) => Promise<void> | void = () => {},
): Promise<{ hash: string; outcome: ExecutionOutcome }> {
  const signed = signWithNearCli(cli, net, signer, tx);
  const decoded = decodeSignedTx(signed);
  assertSignedAsAsked(decoded, signer, tx);
  await beforeSend(decoded);
  try {
    await nearRpc(net, "send_tx", { signed_tx_base64: signed, wait_until: "NONE" });
    return { hash: decoded.hash, outcome: await finalOutcome(net, decoded.hash, signer) };
  } catch (err) {
    throw new OutcomeUnknown(decoded.hash, err);
  }
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) {
    out = BASE58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}
