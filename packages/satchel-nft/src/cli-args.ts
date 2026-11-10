import { parseArgs } from "node:util";
import { type Address, type Hex, isAddress, isHex, parseEther } from "viem";
import { type ChainInfo, NETWORKS, type Network, type NetworkId, isAccountId, sendChains } from "./config.js";
import type { Keychain } from "./near-cli.js";

export const USAGE = `usage: satchel-nft <command> [options]

Read, no keys needed:
  verify <id>                 the clean transfer report; exits 0 only when it reads PROVABLY CLEAN
  show <id>                   owner, address, listing, and what it holds on the network's EVM
                              chains: the native coin, USDC, USDT and WETH
  record <id>                 the signing record, as the contract returns it
  history <id>                its mint, owners, signatures, listings and sales, from FastNEAR's
                              transaction index
  market                      every listing, with its report's verdict

Sign with a key in the near CLI's keychain, as --as <account>:
  mint                        mint a satchel for 0.1 NEAR
  list <id> <price>           list it for <price> NEAR; it can't sign until sold or delisted
  delist <id>                 take it off the market
  buy <id>                    buy it at its listed price, only if its report reads PROVABLY CLEAN
  transfer <id> <account>     give it to another NEAR account
  send <id> --chain <chain> --to <0x address> --value <amount> [--data <0x calldata>]
                              send from its address on one of the network's EVM chains

For a satchel a Sputnik DAO owns, no keys needed:
  dao finish <near tx>        read the MPC signature from the receipts of the vote that ran
                              sign_evm, check the contract hashed that transaction and the
                              signature recovers to the satchel's address, then broadcast it

Options:
  --network testnet|mainnet   the NEAR network (default testnet)
  --json                      print JSON, for scripts and bots
  --as <account>              the NEAR account that signs
  --yes                       sign (dao finish: broadcast) without asking; needed when there is
                              no terminal to ask in
  --accept-not-clean          let buy go ahead when the report does not read PROVABLY CLEAN
  --keychain legacy|os        where the near CLI keeps the key: ~/.near-credentials (default)
                              or the OS keychain
  --near-cli <path>           the near CLI to sign with (default: $NEAR_CLI, or near on PATH)
  --help, --version

Environment: NEAR_RPC=<url> and RPC_<chain id>=<url> read from nodes you trust instead of the
public defaults, like RPC_8453 for Base.

Exit codes: 0 done (verify: PROVABLY CLEAN), 1 no (not clean, refused, failed on chain), 2 it
could not run, 3 it sent a transaction but could not read its outcome: check it before running again.`;

export const READ_COMMANDS = ["verify", "show", "record", "history", "market"] as const;
export const SIGN_COMMANDS = ["mint", "list", "delist", "buy", "transfer", "send"] as const;
export type CommandName = (typeof READ_COMMANDS)[number] | (typeof SIGN_COMMANDS)[number] | "dao";

export interface CliArgs {
  command: CommandName;
  network: NetworkId;
  json: boolean;
  tokenId?: string;
  /** list: the price in NEAR, as typed. */
  price?: string;
  /** dao finish: the NEAR transaction that ran sign_evm. */
  nearTx?: string;
  /** transfer: the receiving account. */
  receiver?: string;
  /** Sign commands: the signing account, `--as`. */
  signer?: string;
  yes: boolean;
  acceptNotClean: boolean;
  keychain: Keychain;
  nearCli?: string;
  /** send: the chain as typed (id or name), the recipient, the amount in the chain's coin, calldata. */
  chain?: string;
  to?: string;
  value?: string;
  data?: string;
}

export type Parsed = { kind: "run"; args: CliArgs } | { kind: "help" } | { kind: "version" } | { kind: "error"; message: string };

/** Positional arguments after the command, and the options each command takes beyond the shared ones. */
const SHAPE: Record<CommandName, { positionals: string[]; options: string[] }> = {
  verify: { positionals: ["id"], options: [] },
  show: { positionals: ["id"], options: [] },
  record: { positionals: ["id"], options: [] },
  history: { positionals: ["id"], options: [] },
  market: { positionals: [], options: [] },
  mint: { positionals: [], options: [] },
  list: { positionals: ["id", "price"], options: [] },
  delist: { positionals: ["id"], options: [] },
  buy: { positionals: ["id"], options: ["accept-not-clean"] },
  transfer: { positionals: ["id", "account"], options: [] },
  send: { positionals: ["id"], options: ["chain", "to", "value", "data"] },
  dao: { positionals: ["action", "tx"], options: ["yes"] },
};
const SIGN_OPTIONS = ["as", "yes", "keychain", "near-cli"];

const OPTIONS = {
  network: { type: "string" },
  json: { type: "boolean" },
  as: { type: "string" },
  yes: { type: "boolean" },
  "accept-not-clean": { type: "boolean" },
  keychain: { type: "string" },
  "near-cli": { type: "string" },
  chain: { type: "string" },
  to: { type: "string" },
  value: { type: "string" },
  data: { type: "string" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
} as const;

/** A token id as the contract stores it: a u64 in decimal, without leading zeros. */
export function tokenIdArg(text: string): string | null {
  if (!/^\d{1,20}$/.test(text)) return null;
  const n = BigInt(text);
  return n <= 0xffffffffffffffffn ? n.toString() : null;
}

/** The command line, or what is wrong with it. Every option must belong to the command it is given to. */
export function parseCli(argv: string[]): Parsed {
  let parsed: ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true; strict: true }>>;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (err) {
    return { kind: "error", message: err instanceof Error ? err.message : String(err) };
  }
  const { values, positionals } = parsed;
  if (values.help) return { kind: "help" };
  if (values.version) return { kind: "version" };
  const [command, ...rest] = positionals;
  if (command === undefined) return { kind: "help" };
  if (!Object.hasOwn(SHAPE, command)) return { kind: "error", message: `Unknown command ${command}` };
  const name = command as CommandName;
  const shape = SHAPE[name];
  const signs = (SIGN_COMMANDS as readonly string[]).includes(name);

  const allowed = new Set(["network", "json", ...shape.options, ...(signs ? SIGN_OPTIONS : [])]);
  const stray = Object.keys(values).filter((key) => !allowed.has(key));
  if (stray.length > 0) return { kind: "error", message: `${name} does not take --${stray.join(", --")}` };
  if (rest.length !== shape.positionals.length) {
    const want = name === "dao" ? "finish <near tx>" : shape.positionals.map((p) => `<${p}>`).join(" ");
    return { kind: "error", message: `usage: satchel-nft ${name}${want ? ` ${want}` : ""}` };
  }

  const network = values.network ?? "testnet";
  // Own keys only: `"constructor" in NETWORKS` is true too.
  if (!Object.hasOwn(NETWORKS, network)) return { kind: "error", message: `--network is testnet or mainnet, not ${network}` };
  const keychain = values.keychain ?? "legacy";
  if (keychain !== "legacy" && keychain !== "os") return { kind: "error", message: `--keychain is legacy or os, not ${keychain}` };

  const args: CliArgs = {
    command: name,
    network: network as NetworkId,
    json: values.json ?? false,
    yes: values.yes ?? false,
    acceptNotClean: values["accept-not-clean"] ?? false,
    keychain,
    nearCli: values["near-cli"],
  };
  if (shape.positionals[0] === "id") {
    const id = tokenIdArg(rest[0]);
    if (id === null) return { kind: "error", message: `A token id is a whole number, like 1, not ${rest[0]}` };
    args.tokenId = id;
  }
  if (name === "dao") {
    if (rest[0] !== "finish") return { kind: "error", message: `dao takes finish, not ${rest[0]}` };
    // A NEAR transaction hash: 32 bytes in base58, so 32 to 44 characters (leading zero bytes are 1s).
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(rest[1])) return { kind: "error", message: `${rest[1]} is not a NEAR transaction hash` };
    args.nearTx = rest[1];
  }
  if (name === "list") args.price = rest[1];
  if (name === "transfer") args.receiver = rest[1];
  if (signs) {
    if (!values.as) return { kind: "error", message: `${name} signs: name the NEAR account with --as <account>` };
    if (!isAccountId(values.as)) return { kind: "error", message: `--as takes a NEAR account id, like alice.testnet, not ${values.as}` };
    args.signer = values.as;
  }
  if (name === "send") {
    for (const key of ["chain", "to", "value"] as const) {
      if (values[key] === undefined) return { kind: "error", message: `send needs --${key}` };
    }
    Object.assign(args, { chain: values.chain, to: values.to, value: values.value, data: values.data ?? "0x" });
  }
  return { kind: "run", args };
}

/**
 * `send`'s inputs, checked before anything is read or signed: a chain the network's satchels send
 * on, by id or name ("8453", "base", "Base Sepolia"), a 0x address, an amount in the chain's coin
 * with at most 18 decimals, and calldata of whole bytes.
 */
export function sendInputs(
  net: Network,
  args: Pick<CliArgs, "chain" | "to" | "value" | "data">,
): { chain: ChainInfo; to: Address; value: bigint; data: Hex } | { error: string } {
  const chains = sendChains(net);
  const want = (args.chain ?? "").trim().toLowerCase();
  const chain = chains.find((c) => String(c.id) === want || c.name.toLowerCase() === want);
  if (!chain) return { error: `A ${net.id} satchel sends on ${chains.map((c) => `${c.name} (${c.id})`).join(", ")}; not ${args.chain}` };
  const to = args.to ?? "";
  if (!isAddress(to)) return { error: `--to is a 0x address, checksummed if it mixes cases; not ${to}` };
  const value = args.value ?? "";
  if (!/^\d+(\.\d{1,18})?$/.test(value)) return { error: `--value is an amount of ${chain.symbol}, like 0.01; not ${value}` };
  const data = args.data ?? "0x";
  if (!isHex(data) || data.length % 2 !== 0) return { error: "--data is 0x followed by whole bytes" };
  return { chain, to, value: parseEther(value), data };
}
