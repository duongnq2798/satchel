// Checks the README's claims about satchel #8, which a Sputnik DAO owned on testnet, against NEAR
// testnet and Sepolia: the DAO and its council, the mint, the vote that had the satchel sign, the
// Sepolia transaction that ran, and the vote that gave it away. It reads the transactions in
// deployments/testnet-dao.json. Node 22 or later, no install, no wallet, no key.
// Usage: node scripts/check-dao.mjs
// NEAR_RPC, NEAR_ARCHIVAL_RPC and SEPOLIA_RPC replace the default nodes.
import { readFileSync } from "node:fs";

const RUN = JSON.parse(readFileSync(new URL("../deployments/testnet-dao.json", import.meta.url), "utf8"));
const RPC = process.env.NEAR_RPC ?? "https://rpc.testnet.fastnear.com";
const ARCHIVAL = process.env.NEAR_ARCHIVAL_RPC ?? "https://archival-rpc.testnet.fastnear.com";
const SEPOLIA_RPC = process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com";
const CONTRACT = RUN.contract;
const MPC = RUN.mpc;
const DAO = RUN.dao;
const TOKEN = RUN.tokenId;
const COUNCIL = "satchel-nft.testnet";
const BUYER = "buyer.satchel-nft.testnet";
const SEPOLIA = "11155111";

/** The transaction of the step whose description starts with `start`. */
function step(start) {
  const found = RUN.steps.find((s) => s.step.startsWith(start));
  if (!found) throw new Error(`deployments/testnet-dao.json has no step "${start}…"`);
  return found;
}
const CREATE = step("Create the DAO");
const MINT = step("Mint satchel #8");
const SIGN_PROPOSAL = step("Proposal 0");
const SIGN_VOTE = step("Vote approving proposal 0");
const SEND = step("satchel-nft dao finish").sepolia;
const TRANSFER_PROPOSAL = step("Proposal 1");
const TRANSFER_VOTE = step("Vote approving proposal 1");

async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "satchel", method, params }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status} from ${url}`);
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error.cause ?? body.error)}`);
  return body.result;
}

/** Calls a view method of `account` now, or at `blockId` on the archival node. */
async function view(account, method, args = {}, blockId) {
  const params = {
    account_id: account,
    request_type: "call_function",
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  };
  const { result } =
    blockId === undefined
      ? await rpc(RPC, "query", { finality: "final", ...params })
      : await rpc(ARCHIVAL, "query", { block_id: blockId, ...params });
  return JSON.parse(Buffer.from(result).toString());
}

const tx = (hash, sender) =>
  rpc(ARCHIVAL, "EXPERIMENTAL_tx_status", { tx_hash: hash, sender_account_id: sender, wait_until: "FINAL" });
const json = (base64) => JSON.parse(Buffer.from(base64, "base64").toString() || "null");

/** The transaction's one function call, to `receiver`, signed by `signer`. */
function callOf(t, signer, receiver) {
  const call = t.transaction.actions.length === 1 ? t.transaction.actions[0].FunctionCall : undefined;
  if (!call || t.transaction.receiver_id !== receiver) throw new Error(`not one call to ${receiver}`);
  if (t.transaction.signer_id !== signer) throw new Error(`signed by ${t.transaction.signer_id}`);
  if (!("SuccessValue" in t.status)) throw new Error(`ended ${JSON.stringify(t.status)}`);
  return { method: call.method_name, args: json(call.args) };
}

/** The function calls `from` made on `to` in the transaction's receipts. */
const callsIn = (t, from, to) =>
  t.receipts
    .filter((r) => r.predecessor_id === from && r.receiver_id === to)
    .flatMap((r) => r.receipt.Action?.actions ?? [])
    .map((a) => a.FunctionCall)
    .filter(Boolean)
    .map((c) => ({ method: c.method_name, rawArgs: c.args, args: json(c.args), deposit: c.deposit, gas: String(c.gas) }));

/** The NEP-297 events `executor` logged in the transaction, parsed, with the block it ran in. */
const eventsBy = (t, executor) =>
  t.receipts_outcome
    .filter((o) => o.outcome.executor_id === executor)
    .flatMap((o) =>
      o.outcome.logs
        .filter((l) => l.startsWith("EVENT_JSON:"))
        .map((l) => ({ ...JSON.parse(l.slice("EVENT_JSON:".length)), block: o.block_hash })),
    );

/**
 * The one proposal the DAO ran in a vote: filed by the council member in `filed` (add_proposal
 * returned its id, with the kind get_proposal shows), approved in the vote `t`, and run as filed.
 */
async function voted(filedHash, t, id) {
  const add = await tx(filedHash, COUNCIL);
  const call = callOf(add, COUNCIL, DAO);
  if (call.method !== "add_proposal" || json(add.status.SuccessValue) !== id) {
    throw new Error(`${filedHash.slice(0, 8)}… is ${call.method}, returning ${add.status.SuccessValue}`);
  }
  const vote = callOf(t, COUNCIL, DAO);
  if (vote.method !== "act_proposal" || vote.args.id !== id || vote.args.action !== "VoteApprove") {
    throw new Error(`${vote.method}(${JSON.stringify(vote.args)})`);
  }
  const proposal = await view(DAO, "get_proposal", { id });
  if (proposal.status !== "Approved") throw new Error(`proposal ${id} is ${proposal.status}`);
  if (JSON.stringify(proposal.kind) !== JSON.stringify(call.args.proposal.kind)) {
    throw new Error(`proposal ${id} is ${JSON.stringify(proposal.kind)}, filed as ${JSON.stringify(call.args.proposal.kind)}`);
  }
  const actions = proposal.kind.FunctionCall?.actions ?? [];
  if (proposal.kind.FunctionCall?.receiver_id !== CONTRACT || actions.length !== 1) {
    throw new Error(`proposal ${id} is ${JSON.stringify(proposal.kind)}`);
  }
  // What the vote ran is the proposal as filed: same method, arguments, deposit and gas.
  const ran = callsIn(t, DAO, CONTRACT);
  const [filed] = actions;
  if (
    ran.length !== 1 ||
    ran[0].method !== filed.method_name ||
    ran[0].rawArgs !== filed.args ||
    ran[0].deposit !== filed.deposit ||
    ran[0].gas !== String(filed.gas)
  ) {
    throw new Error(`the vote ran ${JSON.stringify(ran)}, proposal ${id} is ${JSON.stringify(filed)}`);
  }
  return ran[0];
}

const CLAIMS = [
  {
    claim: `${DAO} is a Sputnik DAO 2.3.1 from the sputnikv2.testnet factory: ${COUNCIL} its only member, bond 0, proposals open for one hour`,
    check: async () => {
      const create = callOf(await tx(CREATE.tx, COUNCIL), COUNCIL, "sputnikv2.testnet");
      if (create.method !== "create" || `${create.args.name}.sputnikv2.testnet` !== DAO) throw new Error(`create(${create.args.name})`);
      const [version, policy] = await Promise.all([view(DAO, "version"), view(DAO, "get_policy")]);
      if (version !== "2.3.1") throw new Error(`version() is ${version}`);
      // Every role is a group, and the only account in any of them is the council member.
      const groups = policy.roles.map((r) => r.kind.Group);
      const members = [...new Set(groups.flat())];
      if (groups.some((g) => !Array.isArray(g)) || members.length !== 1 || members[0] !== COUNCIL) {
        throw new Error(`its roles are ${JSON.stringify(policy.roles.map((r) => r.kind))}`);
      }
      if (policy.proposal_bond !== "0" || policy.proposal_period !== "3600000000000") {
        throw new Error(`bond ${policy.proposal_bond}, period ${policy.proposal_period} ns`);
      }
      return `${CREATE.tx.slice(0, 8)}… create; version() 2.3.1; get_policy: one group, ${COUNCIL}; bond 0, period 3600 s`;
    },
  },
  {
    claim: `Satchel #${TOKEN} was minted straight to the DAO`,
    check: async () => {
      const t = await tx(MINT.tx, COUNCIL);
      const mint = callOf(t, COUNCIL, CONTRACT);
      if (mint.method !== "mint" || mint.args.receiver_id !== DAO) throw new Error(`${mint.method} to ${mint.args.receiver_id}`);
      const event = eventsBy(t, CONTRACT).find((e) => e.standard === "nep171" && e.event === "nft_mint")?.data?.[0];
      if (event?.owner_id !== DAO || event.token_ids?.join() !== TOKEN) throw new Error(`the contract logged ${JSON.stringify(event)}`);
      return `${MINT.tx.slice(0, 8)}… nft_mint: token ${TOKEN} to ${DAO}`;
    },
  },
  {
    claim: `Proposal 0 and the vote that approved it had satchel #${TOKEN} sign: the DAO called sign_evm with the proposal's arguments, the contract recorded it and ${MPC} signed the hash evm_signing_hash gives`,
    check: async () => {
      const t = await tx(SIGN_VOTE.tx, COUNCIL);
      const call = await voted(SIGN_PROPOSAL.tx, t, 0);
      if (call.method !== "sign_evm" || call.args.token_id !== TOKEN || call.args.tx.chain_id !== SEPOLIA) {
        throw new Error(`the DAO called ${call.method}(${JSON.stringify(call.args)})`);
      }
      const entry = eventsBy(t, CONTRACT).find((e) => e.standard === "satchel" && e.event === "sign_evm")?.data?.[0];
      const hash = await view(CONTRACT, "evm_signing_hash", { tx: call.args.tx });
      if (entry?.token_id !== TOKEN || entry.nonce !== call.args.tx.nonce || entry.record_version !== "1" || entry.payload !== hash) {
        throw new Error(`the contract logged ${JSON.stringify(entry)}; the hash of the call is ${hash}`);
      }
      const asked = callsIn(t, CONTRACT, MPC).find((c) => c.method === "sign")?.args.request;
      if (asked?.path !== `satchel/${TOKEN}` || asked.payload_v2?.Ecdsa !== hash) {
        throw new Error(`asked ${MPC} for ${JSON.stringify(asked)}`);
      }
      // The vote returns nothing: the signature is the value of a receipt the MPC contract ran.
      const sigs = t.receipts_outcome
        .filter((o) => o.outcome.executor_id === MPC && "SuccessValue" in o.outcome.status)
        .map((o) => json(o.outcome.status.SuccessValue))
        .filter((v) => v?.big_r?.affine_point);
      if (sigs.length !== 1) throw new Error(`${sigs.length} MPC signatures in the vote's receipts`);
      if (json(t.status.SuccessValue) !== null) throw new Error(`the vote returned ${t.status.SuccessValue}`);
      return `${SIGN_PROPOSAL.tx.slice(0, 8)}… filed proposal 0, ${SIGN_VOTE.tx.slice(0, 8)}… ran it as filed: sign_evm(${TOKEN}), Sepolia nonce ${entry.nonce}, record version 1; ${MPC} signed ${hash.slice(0, 10)}… for ${asked.path}`;
    },
  },
  {
    claim: `Sepolia ran exactly that signed transaction, from satchel #${TOKEN}'s address, in a block that is now finalized`,
    check: async () => {
      const [t, sent, receipt, final] = await Promise.all([
        tx(SIGN_VOTE.tx, COUNCIL),
        rpc(SEPOLIA_RPC, "eth_getTransactionByHash", [SEND.tx]),
        rpc(SEPOLIA_RPC, "eth_getTransactionReceipt", [SEND.tx]),
        rpc(SEPOLIA_RPC, "eth_getBlockByNumber", ["finalized", false]),
      ]);
      if (!sent || !receipt) throw new Error(`${SEPOLIA_RPC} has no transaction ${SEND.tx}`);
      const signed = callsIn(t, DAO, CONTRACT)[0]?.args.tx;
      if (!signed) throw new Error("the vote made no sign_evm call");
      const fields = {
        chainId: [sent.chainId, signed.chain_id],
        nonce: [sent.nonce, signed.nonce],
        maxPriorityFeePerGas: [sent.maxPriorityFeePerGas, signed.max_priority_fee_per_gas],
        maxFeePerGas: [sent.maxFeePerGas, signed.max_fee_per_gas],
        gas: [sent.gas, signed.gas_limit],
        value: [sent.value, signed.value],
      };
      for (const [name, [onSepolia, inCall]] of Object.entries(fields)) {
        if (BigInt(onSepolia) !== BigInt(inCall)) throw new Error(`${name} is ${BigInt(onSepolia)} on Sepolia, ${inCall} in sign_evm`);
      }
      const data = (signed.data ?? "0x").toLowerCase();
      if (sent.type !== "0x2" || sent.to?.toLowerCase() !== signed.to.toLowerCase() || sent.input !== data || sent.accessList?.length) {
        throw new Error("the transaction on Sepolia is not the one sign_evm built");
      }
      // The signature Sepolia checked is the MPC contract's: r is big_r's x coordinate. Its sender is
      // the address that signature recovers to.
      const sig = t.receipts_outcome
        .filter((o) => o.outcome.executor_id === MPC && "SuccessValue" in o.outcome.status)
        .map((o) => json(o.outcome.status.SuccessValue))
        .find((v) => v?.big_r?.affine_point);
      if (!sig) throw new Error("no MPC signature in the vote's receipts");
      const r = BigInt(`0x${sig.big_r.affine_point.slice(2)}`);
      if (BigInt(sent.r) !== r || BigInt(sent.s) !== BigInt(`0x${sig.s.scalar}`) || Number(sent.yParity ?? sent.v) !== sig.recovery_id) {
        throw new Error(`the signature on Sepolia is not the one ${MPC} returned`);
      }
      if (sent.from.toLowerCase() !== RUN.address.toLowerCase()) throw new Error(`sent from ${sent.from}`);
      if (receipt.status !== "0x1" || BigInt(receipt.blockNumber) !== BigInt(SEND.block)) {
        throw new Error(`status ${receipt.status} in block ${BigInt(receipt.blockNumber)}`);
      }
      if (BigInt(final.number) < BigInt(receipt.blockNumber)) {
        throw new Error(`Sepolia has finalized up to block ${BigInt(final.number)}, not ${BigInt(receipt.blockNumber)} yet`);
      }
      return `${SEND.tx.slice(0, 10)}… from ${RUN.address}, nonce ${BigInt(sent.nonce)}, block ${BigInt(receipt.blockNumber)}, status 1, finalized`;
    },
  },
  {
    claim: `Proposal 1 and the vote that approved it gave satchel #${TOKEN} to ${BUYER} with nft_transfer, and its record stayed at version 1`,
    check: async () => {
      const t = await tx(TRANSFER_VOTE.tx, COUNCIL);
      const call = await voted(TRANSFER_PROPOSAL.tx, t, 1);
      if (call.method !== "nft_transfer" || call.args.token_id !== TOKEN || call.args.receiver_id !== BUYER) {
        throw new Error(`the DAO called ${call.method}(${JSON.stringify(call.args)})`);
      }
      const event = eventsBy(t, CONTRACT).find((e) => e.standard === "nep171" && e.event === "nft_transfer");
      const moved = event?.data?.[0];
      if (moved?.old_owner_id !== DAO || moved.new_owner_id !== BUYER || moved.token_ids?.join() !== TOKEN) {
        throw new Error(`the contract logged ${JSON.stringify(event)}`);
      }
      // Right after the transfer, at the block of the contract's receipt.
      const [token, record] = await Promise.all([
        view(CONTRACT, "nft_token", { token_id: TOKEN }, event.block),
        view(CONTRACT, "signing_record", { token_id: TOKEN }, event.block),
      ]);
      if (token?.owner_id !== BUYER || record.version !== "1") throw new Error(`owner ${token?.owner_id}, record version ${record.version}`);
      return `${TRANSFER_PROPOSAL.tx.slice(0, 8)}… filed proposal 1, ${TRANSFER_VOTE.tx.slice(0, 8)}… ran it as filed: nft_transfer from ${DAO} to ${BUYER}; record version 1`;
    },
  },
];

let failed = 0;
for (const { claim, check } of CLAIMS) {
  try {
    console.log(`[PASS] ${claim}\n       ${await check()}`);
  } catch (err) {
    failed += 1;
    console.log(`[FAIL] ${claim}\n       ${err.message}`);
  }
}
console.log(`\n${CLAIMS.length - failed} of ${CLAIMS.length} claims hold (${RPC}, archival ${ARCHIVAL}, ${SEPOLIA_RPC})`);
process.exitCode = failed ? 1 : 0;
