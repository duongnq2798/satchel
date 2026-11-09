import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAINNET, TESTNET } from "./config.js";
import { base58Decode } from "./evm.js";
import { assertSignedAsAsked, base58Encode, decodeSignedTx, nearCliArgs, resolveNearCli, signedFromOutput } from "./near-cli.js";
import { satchelTx } from "./satchel.js";

/** A borsh SignedTransaction (V0), written independently of the decoder under test. */
function encode(fields: {
  signer?: string;
  keyType?: 0 | 1;
  receiver?: string;
  actions?: Uint8Array[];
  signatureType?: 0 | 1;
  extra?: number[];
}): { base64: string; unsigned: Uint8Array } {
  const parts: number[] = [];
  const u32 = (n: number) => parts.push(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff);
  const string = (s: string) => {
    const b = new TextEncoder().encode(s);
    u32(b.length);
    parts.push(...b);
  };
  const keyType = fields.keyType ?? 0;
  string(fields.signer ?? "alice.testnet");
  parts.push(keyType, ...new Array(keyType === 0 ? 32 : 64).fill(7));
  parts.push(5, 0, 0, 0, 0, 0, 0, 0); // nonce 5
  string(fields.receiver ?? "v1.satchel-nft.testnet");
  parts.push(...new Array(32).fill(9)); // block hash
  const actions = fields.actions ?? [functionCall("list", '{"price":"1000000000000000000000000","token_id":"4"}', 30n, 1n)];
  u32(actions.length);
  for (const a of actions) parts.push(...a);
  const unsigned = Uint8Array.from(parts);
  const signatureType = fields.signatureType ?? keyType;
  parts.push(signatureType, ...new Array(signatureType === 0 ? 64 : 65).fill(3), ...(fields.extra ?? []));
  return { base64: Buffer.from(Uint8Array.from(parts)).toString("base64"), unsigned };
}

function le(value: bigint, bytes: number): number[] {
  return Array.from({ length: bytes }, (_, i) => Number((value >> BigInt(8 * i)) & 0xffn));
}

function functionCall(method: string, args: string, tgas: bigint, deposit: bigint): Uint8Array {
  const m = new TextEncoder().encode(method);
  const a = new TextEncoder().encode(args);
  return Uint8Array.from([2, ...le(BigInt(m.length), 4), ...m, ...le(BigInt(a.length), 4), ...a, ...le(tgas * 10n ** 12n, 8), ...le(deposit, 16)]);
}

const LIST = satchelTx(TESTNET).list("4", 10n ** 24n);

describe("nearCliArgs", () => {
  it("asks the near CLI to sign exactly the call, and only to display it", () => {
    expect(nearCliArgs(TESTNET, "alice.testnet", LIST, "legacy")).toEqual([
      "contract",
      "call-function",
      "as-transaction",
      "v1.satchel-nft.testnet",
      "list",
      "json-args",
      '{"token_id":"4","price":"1000000000000000000000000"}',
      "prepaid-gas",
      "30 Tgas",
      "attached-deposit",
      "1 yoctoNEAR",
      "sign-as",
      "alice.testnet",
      "network-config",
      "testnet",
      "sign-with-legacy-keychain",
      "display",
    ]);
    const mint = nearCliArgs(MAINNET, "bob.near", satchelTx(MAINNET).mint(), "os");
    expect(mint.slice(-6)).toEqual(["sign-as", "bob.near", "network-config", "mainnet", "sign-with-keychain", "display"]);
    expect(mint).toContain("100000000000000000000000 yoctoNEAR");
    expect(mint).not.toContain("send");
  });
});

describe("signedFromOutput", () => {
  it("finds the signed transaction in the near CLI's report", () => {
    const output = "Unsigned transaction:\n...\nSigned transaction (serialized as base64):\n  AAAB+/9z==\n\nHere is your console command";
    expect(signedFromOutput(output)).toBe("AAAB+/9z==");
  });

  it("shows the end of the output when there is none", () => {
    expect(() => signedFromOutput("Error: Access key file for account <alice.testnet> on network <testnet> not found!")).toThrow(
      /did not sign[\s\S]*Access key file/,
    );
  });
});

describe("decodeSignedTx", () => {
  it("reads a function call and hashes the unsigned transaction", () => {
    const { base64, unsigned } = encode({});
    const tx = decodeSignedTx(base64);
    expect(tx).toMatchObject({
      signerId: "alice.testnet",
      nonce: 5n,
      receiverId: "v1.satchel-nft.testnet",
      methodName: "list",
      gas: 30n * 10n ** 12n,
      deposit: 1n,
    });
    expect(tx.publicKey).toBe(`ed25519:${base58Encode(new Uint8Array(32).fill(7))}`);
    expect(tx.hash).toBe(base58Encode(createHash("sha256").update(unsigned).digest()));
  });

  it("reads a secp256k1 key and its 65-byte signature", () => {
    expect(decodeSignedTx(encode({ keyType: 1 }).base64).publicKey).toMatch(/^secp256k1:/);
  });

  it("refuses anything but one function call, whole and alone", () => {
    const call = functionCall("delist", '{"token_id":"4"}', 30n, 1n);
    expect(() => decodeSignedTx(encode({ actions: [call, call] }).base64)).toThrow(/exactly one action/);
    expect(() => decodeSignedTx(encode({ actions: [Uint8Array.from([3, ...le(1n, 16)])] }).base64)).toThrow(/not a function call/);
    expect(() => decodeSignedTx(encode({ extra: [0] }).base64)).toThrow(/trailing bytes/);
    expect(() => decodeSignedTx(encode({ signatureType: 1 }).base64)).toThrow(/signature's type is not the key's/);
    const whole = encode({}).base64;
    expect(() => decodeSignedTx(Buffer.from(whole, "base64").subarray(0, 60).toString("base64"))).toThrow(/ends early/);
    const v1 = Buffer.from(whole, "base64");
    v1[0] = 1;
    expect(() => decodeSignedTx(v1.toString("base64"))).toThrow(/V1/);
  });
});

describe("assertSignedAsAsked", () => {
  const signed = decodeSignedTx(encode({}).base64);

  it("passes the transaction that was asked for, whatever the order of its JSON keys", () => {
    expect(() => assertSignedAsAsked(signed, "alice.testnet", LIST)).not.toThrow();
  });

  it("refuses a different signer, receiver, method, gas, deposit or argument", () => {
    const tx = satchelTx(TESTNET);
    expect(() => assertSignedAsAsked(signed, "bob.testnet", LIST)).toThrow(/the signer is alice.testnet, not bob.testnet/);
    expect(() => assertSignedAsAsked(signed, "alice.testnet", satchelTx(MAINNET).list("4", 10n ** 24n))).toThrow(/the receiver/);
    expect(() => assertSignedAsAsked(signed, "alice.testnet", tx.delist("4"))).toThrow(/the method is list, not delist/);
    expect(() => assertSignedAsAsked(signed, "alice.testnet", tx.list("4", 2n * 10n ** 24n))).toThrow(/the arguments/);
    expect(() => assertSignedAsAsked(signed, "alice.testnet", tx.list("5", 10n ** 24n))).toThrow(/the arguments/);
    const moreGas = encode({ actions: [functionCall("list", '{"token_id":"4","price":"1000000000000000000000000"}', 31n, 1n)] });
    expect(() => assertSignedAsAsked(decodeSignedTx(moreGas.base64), "alice.testnet", LIST)).toThrow(/the gas/);
    const moreDeposit = encode({ actions: [functionCall("list", '{"token_id":"4","price":"1000000000000000000000000"}', 30n, 2n)] });
    expect(() => assertSignedAsAsked(decodeSignedTx(moreDeposit.base64), "alice.testnet", LIST)).toThrow(/the deposit is 2, not 1/);
  });

  it("keeps a byte order mark, so a name that only looks the same is refused", () => {
    const bom = decodeSignedTx(encode({ signer: "\uFEFFalice.testnet" }).base64);
    expect(() => assertSignedAsAsked(bom, "alice.testnet", LIST)).toThrow(/the signer/);
    const bomReceiver = decodeSignedTx(encode({ receiver: "\uFEFFv1.satchel-nft.testnet" }).base64);
    expect(() => assertSignedAsAsked(bomReceiver, "alice.testnet", LIST)).toThrow(/the receiver/);
  });
});

describe("resolveNearCli", () => {
  const windows = process.platform === "win32";
  const dir = mkdtempSync(path.join(tmpdir(), "near-cli-"));
  const exe = path.join(dir, windows ? "near.exe" : "near");
  writeFileSync(exe, "");
  chmodSync(exe, 0o755);

  it("finds near in PATH's absolute folders, never in the current folder or a relative one", () => {
    expect(resolveNearCli("near", { PATH: [".", "bin", dir].join(path.delimiter) })).toBe(exe);
    const before = process.cwd();
    process.chdir(dir);
    try {
      expect(() => resolveNearCli("near", { PATH: [".", "", "bin"].join(path.delimiter) })).toThrow(/No near/);
    } finally {
      process.chdir(before);
    }
  });

  it("takes a path as given, if a program is there", () => {
    expect(resolveNearCli(exe, {})).toBe(exe);
    expect(() => resolveNearCli(path.join(dir, "missing", "near"), {})).toThrow(/No near CLI at/);
  });

  it("refuses npm's near.cmd on Windows, which runs only through a shell", () => {
    expect(() => resolveNearCli("C:\\tools\\near.cmd", {}, "win32")).toThrow(/is a script/);
  });
});

describe("base58Encode", () => {
  it("keeps leading zero bytes and round-trips with base58Decode", () => {
    expect(base58Encode(Uint8Array.from([0, 0, 1]))).toBe("112");
    const bytes = Uint8Array.from([0, 255, 1, 2, 3, 250]);
    expect(base58Decode(base58Encode(bytes))).toEqual(bytes);
  });
});
