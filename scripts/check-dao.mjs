// Checks the README's claims about satchel #8, which a Sputnik DAO owned on testnet, against NEAR
// testnet and Sepolia: the DAO and its council, the mint, the vote that had the satchel sign, the
// Sepolia transaction that ran, and the vote that gave it away. It reads the transactions in
// deployments/testnet-dao.json. Node 22 or later, no install, no wallet, no key.
// Usage: node scripts/check-dao.mjs
// NEAR_RPC, NEAR_ARCHIVAL_RPC and SEPOLIA_RPC replace the default nodes. A read a node answers with
// HTTP 408, 429 or 5xx, or whose connection fails, is sent up to 6 more times, 1, 2 and 4 s apart
// and then 8 s, or longer if the node's Retry-After asks, up to 8 s, and not again if it asks for
// more than 30 s; any other read that fails, a timeout included, is tried once more, 2 s later.
// Archival reads go out one at a time. With NEAR_ARCHIVAL_RPC unset, an archival read FastNEAR
// doesn't answer goes to NEAR's own archival node, and once NEAR's node has answered one, later
// archival reads go to it first and to FastNEAR's last, until FastNEAR's answers one NEAR's didn't.
// With SEPOLIA_RPC unset, a Sepolia read the default node fails, or answers with null, goes to
// 1rpc.io's public node, then to Tenderly's. A claim that fails only because a node didn't answer
// says it is not a change to any satchel, and what to do. One that fails because every Sepolia node
// asked answered without the transaction says that instead. One that an archival node answered with
// an error, after another didn't answer, names both. A hash an archival node doesn't know fails its
// claim with that node's error, not as a node not answering.
import { readFileSync } from "node:fs";

const RUN = JSON.parse(readFileSync(new URL("../deployments/testnet-dao.json", import.meta.url), "utf8"));
const RPC = process.env.NEAR_RPC ?? "https://rpc.testnet.fastnear.com";
const ARCHIVAL = process.env.NEAR_ARCHIVAL_RPC ?? "https://archival-rpc.testnet.fastnear.com";
/**
 * Read only if NEAR_ARCHIVAL_RPC is unset and the default node doesn't answer, and first once one of
 * these has answered a read. On 2026-11-12 FastNEAR's archival node answered HTTP 429 to every retry
 * when this ran right after check-claims.mjs, which reads from it too; this node returned the same
 * transactions, in about 4 s each.
 */
const ARCHIVAL_FALLBACKS = ["https://archival-rpc.testnet.near.org"];
const SEPOLIA_RPC = process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com";
/**
 * Read only if SEPOLIA_RPC is unset and the default node fails. On 2026-11-12 the default node
 * returned the DAO's Sepolia transaction but a null receipt for it; these two returned both.
 */
const SEPOLIA_FALLBACKS = ["https://1rpc.io/sepolia", "https://sepolia.gateway.tenderly.co"];
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

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A node that didn't answer. `busy` (HTTP 408, 429 or 5xx, or a failed connection) marks one worth
 * asking again soon; a timeout, any other HTTP error but a 400 with a JSON-RPC error, or a reply that
 * isn't JSON is not.
 */
class NoAnswer extends Error {
  constructor(message, { busy = false, retryAfter = null } = {}) {
    super(message);
    this.busy = busy;
    this.retryAfter = retryAfter;
  }
}

async function rpcOnce(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "satchel", method, params }),
    signal: AbortSignal.timeout(30_000),
  }).catch((err) => {
    // A request that timed out after 30 s gets one more try, like any other failure, not three.
    throw new NoAnswer(`${method}: ${err.message} from ${url}`, { busy: err.name !== "TimeoutError" });
  });
  if (res.status === 408 || res.status === 429 || res.status >= 500) {
    // Retry-After in seconds; a date, or no header, leaves the backoff as it is.
    const header = res.headers.get("retry-after");
    const seconds = header === null || header.trim() === "" ? Number.NaN : Number(header);
    throw new NoAnswer(`${method}: HTTP ${res.status} from ${url}`, {
      busy: true,
      retryAfter: Number.isFinite(seconds) && seconds >= 0 ? seconds : null,
    });
  }
  if (!res.ok) {
    // nearcore answers 400, with a JSON error, to a request it can't parse: the request is wrong, not
    // the node. Any other error page, a 403 or a 404, is a node not answering.
    const error = res.status === 400 ? (await res.json().catch(() => null))?.error : undefined;
    if (error) throw new Error(`${method}: HTTP 400, ${JSON.stringify(error.cause ?? error)} from ${url}`);
    throw new NoAnswer(`${method}: HTTP ${res.status} from ${url}`);
  }
  const body = await res.json().catch((err) => {
    // A body that stalls past the timeout, or a connection cut off partway, is not "not JSON".
    throw err.name === "SyntaxError"
      ? new NoAnswer(`${method}: a reply that is not JSON from ${url}`)
      : new NoAnswer(`${method}: ${err.message} from ${url}`, { busy: err.name !== "TimeoutError" });
  });
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error.cause ?? body.error)} from ${url}`);
  return body.result;
}

/**
 * Sends a read, and again while the node is busy: up to 7 sends, 1, 2 and 4 s apart and then 8 s, or
 * longer if its Retry-After asks, up to 8 s. A node whose Retry-After asks for more than 30 s isn't
 * asked again for this read. Any other failure is tried once more, 2 s later.
 */
async function rpc(url, method, params) {
  for (let sent = 1; ; sent += 1) {
    try {
      return await rpcOnce(url, method, params);
    } catch (err) {
      const busy = err instanceof NoAnswer && err.busy;
      // NEAR's archival node asked for 329 s on 2026-11-14: more sends only met more 429s.
      if (sent >= (busy ? 7 : 2) || (busy && (err.retryAfter ?? 0) > 30)) throw err;
      const backoff = 1_000 * 2 ** (sent - 1);
      // A Retry-After can only make the wait longer: FastNEAR's archival node sends `retry-after: 0`
      // with its 429s, and asking again at once only meets another 429.
      await wait(busy ? Math.min(Math.max(backoff, (err.retryAfter ?? 0) * 1_000), 8_000) : 2_000);
    }
  }
}

/**
 * A NEAR read from `url`, which the variable `name` sets. A node that still doesn't answer fails the
 * claim with a line that says so.
 */
async function near(url, name, method, params) {
  try {
    return await rpc(url, method, params);
  } catch (err) {
    if (!(err instanceof NoAnswer)) throw err;
    throw new Error(`${err.message}. That is a NEAR node not answering, not a change to any satchel: wait a minute and run it again, or set ${name} to another node`);
  }
}

/**
 * The archival nodes that answered reads, and the Sepolia nodes that answered a read the default node
 * failed, which the last lines name.
 */
const answeredBy = { archival: new Set(), sepolia: new Set() };

/**
 * The archival nodes in the order a read asks them: NEAR_ARCHIVAL_RPC alone or, with it unset,
 * FastNEAR's and then NEAR's own. The node that answered the last read, with a result or an error,
 * is asked first: once a fallback answers a read FastNEAR's didn't, later reads ask it first and
 * FastNEAR's last, until FastNEAR's answers one the fallback didn't.
 */
let archivalNodes = process.env.NEAR_ARCHIVAL_RPC ? [ARCHIVAL] : [ARCHIVAL, ...ARCHIVAL_FALLBACKS];

function answered(url) {
  if (archivalNodes[0] !== url) archivalNodes = [url, ...archivalNodes.filter((u) => u !== url)];
}

/**
 * Archival reads go out one at a time, in the order they were asked for. On 2026-11-14 FastNEAR's
 * archival node let about 8 reads through at once and then about one every 5 s: reads sent together
 * only raced for the same few, and the one that lost every race used up its sends.
 */
let archivalTurn = Promise.resolve();

function archival(method, params) {
  const read = archivalTurn.then(() => archivalRead(method, params));
  archivalTurn = read.catch(() => {});
  return read;
}

/**
 * An archival read from the first of `archivalNodes` that answers. Only a node that doesn't answer is
 * passed over. An error the first node asked answers with fails the claim. One a later node answers
 * with fails it too, and names the nodes before it that didn't answer: no other node checked it.
 */
async function archivalRead(method, params) {
  const urls = archivalNodes;
  const errors = [];
  for (const [i, url] of urls.entries()) {
    try {
      const result = await rpc(url, method, params);
      answered(url);
      answeredBy.archival.add(url);
      return result;
    } catch (err) {
      if (!(err instanceof NoAnswer)) {
        answered(url);
        if (i === 0) throw err;
        throw new Error(`${[...errors, err.message].join("; ")}. ${urls.slice(0, i).join(" and ")} did not answer, and ${url} answered with that error: run it again, or set NEAR_ARCHIVAL_RPC to an archival node you trust`);
      }
      errors.push(err.message);
    }
  }
  const nodes = urls.length === 1 ? "That is a NEAR node" : `Those are ${urls.length} NEAR nodes`;
  throw new Error(`${errors.join("; ")}. ${nodes} not answering, not a change to any satchel: wait a minute and run it again, or set NEAR_ARCHIVAL_RPC to another archival node`);
}
/**
 * A Sepolia read from SEPOLIA_RPC or, with it unset, from the default node and then each fallback.
 * A null result, or none, counts as a failed read: every read here asks for something that exists.
 * Only a read no node answered is blamed on the nodes.
 */
async function sepolia(method, params) {
  const urls = process.env.SEPOLIA_RPC ? [SEPOLIA_RPC] : [SEPOLIA_RPC, ...SEPOLIA_FALLBACKS];
  const errors = [];
  let unanswered = 0;
  for (const url of urls) {
    try {
      let result = await rpc(url, method, params);
      if (result == null) {
        await wait(2_000);
        result = await rpc(url, method, params);
      }
      if (result == null) throw new Error(`${method}: ${result === null ? "null" : "no result"} from ${url}`);
      if (url !== SEPOLIA_RPC) answeredBy.sepolia.add(url);
      return result;
    } catch (err) {
      if (err instanceof NoAnswer) unanswered += 1;
      errors.push(err.message);
    }
  }
  const failures = errors.join("; ");
  if (unanswered === urls.length) {
    const nodes = urls.length === 1 ? "That is a Sepolia node" : `Those are ${urls.length} Sepolia nodes`;
    throw new Error(`${failures}. ${nodes} failing, not a change to any satchel: set SEPOLIA_RPC to another Sepolia node and run it again`);
  }
  if (unanswered === 0) {
    // Every node answered, so this is no outage: Sepolia, or every node asked, doesn't have it.
    const [nodes, them] = urls.length === 1 ? ["The Sepolia node answered", "that node"] : [`All ${urls.length} Sepolia nodes answered`, "every one of them"];
    throw new Error(`${failures}. ${nodes} without it: Sepolia may not have it, or ${them} may be missing it. If you trust another Sepolia node, set SEPOLIA_RPC to it and run it again`);
  }
  throw new Error(`${failures}. Some Sepolia nodes did not answer, and the rest answered without it: run it again, or set SEPOLIA_RPC to another node`);
}

/** Calls a view method of `account` now, or at `blockId` on an archival node. */
async function view(account, method, args = {}, blockId) {
  const params = {
    account_id: account,
    request_type: "call_function",
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  };
  const { result } =
    blockId === undefined
      ? await near(RPC, "NEAR_RPC", "query", { finality: "final", ...params })
      : await archival("query", { block_id: blockId, ...params });
  return JSON.parse(Buffer.from(result).toString());
}

/**
 * A transaction as an archival node has it now. With wait_until "FINAL", nearcore holds a request for
 * a transaction it doesn't know about 30 s and answers HTTP 408, so a wrong hash would be blamed on
 * the nodes; with "NONE" it answers UNKNOWN_TRANSACTION at once. One that isn't final fails the claim.
 */
async function tx(hash, sender) {
  const t = await archival("EXPERIMENTAL_tx_status", { tx_hash: hash, sender_account_id: sender, wait_until: "NONE" });
  if (t.final_execution_status !== "FINAL") throw new Error(`${hash.slice(0, 8)}… is ${t.final_execution_status}, not final`);
  return t;
}
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
      // `sepolia` never returns null or nothing: a read no node answers with a result fails the claim.
      const [t, sent, receipt, final] = await Promise.all([
        tx(SIGN_VOTE.tx, COUNCIL),
        sepolia("eth_getTransactionByHash", [SEND.tx]),
        sepolia("eth_getTransactionReceipt", [SEND.tx]),
        sepolia("eth_getBlockByNumber", ["finalized", false]),
      ]);
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
if ([...answeredBy.archival].some((u) => u !== ARCHIVAL)) {
  console.log(`Archival reads came from ${[...answeredBy.archival].join(" and ")}: a read one of them didn't answer went to the next, and later reads to the one that answered last first`);
}
if (answeredBy.sepolia.size) console.log(`Sepolia reads that ${SEPOLIA_RPC} failed came from ${[...answeredBy.sepolia].join(" and ")}`);
process.exitCode = failed ? 1 : 0;
