import { afterEach, describe, expect, it, vi } from "vitest";
import vote from "./__fixtures__/dao-vote-outcome.json" with { type: "json" };
import outcome from "./__fixtures__/sign-evm-outcome.json" with { type: "json" };
import { MAINNET, TESTNET } from "./config.js";
import {
  type DaoProposal,
  type FinishDeps,
  type TxStatus,
  daoProposal,
  daoVote,
  finishSignEvm,
  nonceClash,
  proposedSignatures,
  readTxStatus,
  signEvmCalls,
  signatureFromReceipts,
  sputnikDao,
} from "./dao.js";
import { type ContractTx, fromContractTx, signingHash, toContractTx } from "./evm.js";
import { decodeBase64, encodeArgs, outcomeValue } from "./near.js";

const DAO = "club.sputnikv2.testnet";
const TX: ContractTx = {
  chain_id: "11155111",
  nonce: "0",
  max_priority_fee_per_gas: "2",
  max_fee_per_gas: "20",
  gas_limit: "21000",
  to: "0x000000000000000000000000000000000000dEaD",
  value: "1",
  data: "0x",
};
// Token 1's first signature on testnet, over TX (deployments/testnet-e2e.json).
const TOKEN_1_ADDRESS = "0x96DA1468E95Ab31A698891f0150095f86b5a282B";
const SIGNATURE_VALUE = (outcome.status as { SuccessValue: string }).SuccessValue;

const proposal = (id: number, kind: DaoProposal["kind"], status: DaoProposal["status"] = "InProgress", at = Date.now()): DaoProposal => ({
  id,
  proposer: "member.testnet",
  description: "",
  kind,
  status,
  submission_time: (BigInt(at) * 1_000_000n).toString(),
});
const signs = (tokenId: string, tx: ContractTx, receiver = TESTNET.contract) => ({
  FunctionCall: {
    receiver_id: receiver,
    actions: [{ method_name: "sign_evm", args: encodeArgs({ token_id: tokenId, tx }), deposit: "1", gas: "150000000000000" }],
  },
});

describe("DAO proposals", () => {
  it("has the DAO call sign_evm with the transaction as its arguments, 1 yoctoNEAR and 150 TGas", () => {
    const { proposal: p } = daoProposal(TESTNET).signEvm("9", TX);
    const call = p.kind.FunctionCall;
    expect(call.receiver_id).toBe("v1.satchel-nft.testnet");
    expect(call.actions).toHaveLength(1);
    expect(call.actions[0]).toMatchObject({ method_name: "sign_evm", deposit: "1", gas: "150000000000000" });
    expect(JSON.parse(decodeBase64(call.actions[0].args))).toEqual({ token_id: "9", tx: TX });
    expect(p.description).toBe("Satchel #9 signs nonce 0 on Sepolia: 1 wei to 0x000000000000000000000000000000000000dEaD");
    expect(daoProposal(MAINNET).signEvm("9", TX, "pay").proposal).toMatchObject({
      description: "pay",
      kind: { FunctionCall: { receiver_id: "v1.satchel-nft.near" } },
    });
  });

  it("hands a satchel on with nft_transfer and 30 TGas", () => {
    const action = daoProposal(TESTNET).transfer("9", "team.testnet").proposal.kind.FunctionCall.actions[0];
    expect(action).toMatchObject({ method_name: "nft_transfer", deposit: "1", gas: "30000000000000" });
    expect(JSON.parse(decodeBase64(action.args))).toEqual({ token_id: "9", receiver_id: "team.testnet" });
  });

  it("votes with the proposal's kind as get_proposal returned it", () => {
    const kind = signs("9", TX);
    expect(daoVote(3, kind)).toEqual({ id: 3, action: "VoteApprove", proposal: kind });
    expect(daoVote(3, kind, "VoteReject").action).toBe("VoteReject");
  });
});

describe("nonceClash", () => {
  it("finds an open proposal that signs the same nonce for the same satchel and chain", () => {
    const open = [proposal(4, signs("9", TX)), proposal(5, signs("9", { ...TX, nonce: "1" }))];
    expect(nonceClash(TESTNET, open, "9", "11155111", "1")?.id).toBe(5);
    expect(nonceClash(TESTNET, open, "9", "11155111", "2")).toBeNull();
    expect(nonceClash(TESTNET, open, "9", "84532", "0")).toBeNull();
    expect(nonceClash(TESTNET, open, "10", "11155111", "0")).toBeNull();
  });

  it("compares numbers as the contract reads them: +1, 01 and 1 are the same nonce", () => {
    const open = [proposal(6, signs("9", { ...TX, chain_id: "011155111", nonce: "+1" })), proposal(7, signs("9", { ...TX, nonce: "-2" }))];
    expect(nonceClash(TESTNET, open, "9", "11155111", "1")?.id).toBe(6);
    expect(nonceClash(TESTNET, open, "9", "11155111", "01")?.id).toBe(6);
    // The contract can't read "-2", so that proposal can't sign anything.
    expect(nonceClash(TESTNET, open, "9", "11155111", "2")).toBeNull();
    expect(() => nonceClash(TESTNET, open, "9", "sepolia", "1")).toThrow(/decimal strings/);
  });

  it("reads only sign_evm calls on this network's contract, and skips arguments that aren't JSON", () => {
    const other = proposal(1, signs("9", TX, "v2.satchel-nft.testnet"));
    const garbled = proposal(2, { FunctionCall: { receiver_id: TESTNET.contract, actions: [{ method_name: "sign_evm", args: btoa("{"), deposit: "1", gas: "1" }] } });
    const transfer = proposal(3, daoProposal(TESTNET).transfer("9", "a.testnet").proposal.kind);
    const policy = proposal(4, { ChangePolicy: {} });
    for (const p of [other, garbled, transfer, policy]) expect(proposedSignatures(TESTNET, p)).toEqual([]);
    expect(nonceClash(TESTNET, [other, garbled, transfer, policy], "9", "11155111", "0")).toBeNull();
    expect(proposedSignatures(TESTNET, proposal(5, signs("9", TX)))).toEqual([{ tokenId: "9", tx: TX }]);
  });
});

describe("sputnikDao(net, dao).openProposals", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps in-progress and failed proposals inside the proposal period, reading newest first", async () => {
    const now = Date.UTC(2026, 10, 10, 12);
    const hour = 3_600_000;
    // A one-hour period: #0 is past it, #1 to #4 are inside it.
    const stored = [
      proposal(0, "x", "InProgress", now - 3 * hour),
      proposal(1, "x", "Approved", now - 50 * 60_000),
      proposal(2, "x", "Failed", now - 40 * 60_000),
      proposal(3, "x", "Rejected", now - 30 * 60_000),
      proposal(4, "x", "InProgress", now - 60_000),
    ];
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        const { params } = JSON.parse(init.body);
        const args = JSON.parse(atob(params.args_base64));
        calls.push(params.method_name);
        expect(params.account_id).toBe(DAO);
        const value =
          params.method_name === "get_last_proposal_id"
            ? stored.length
            : params.method_name === "get_policy"
              ? { proposal_bond: "0", proposal_period: (BigInt(hour) * 1_000_000n).toString() }
              : stored.slice(args.from_index, args.from_index + args.limit);
        const result = [...new TextEncoder().encode(JSON.stringify(value))];
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: "satchel", result: { result } }));
      }),
    );
    const open = await sputnikDao(TESTNET, DAO).openProposals(now);
    expect(open.map((p) => p.id)).toEqual([2, 4]);
    expect(calls.filter((c) => c === "get_proposals")).toHaveLength(1);
  });

  it("reads pages of 100 from the newest, and stops at the page that reaches past the period", async () => {
    const now = Date.UTC(2026, 10, 10, 12);
    const hour = 3_600_000;
    // 250 proposals: #0 to #119 are older than the one-hour period, #120 to #249 are inside it.
    const stored = Array.from({ length: 250 }, (_, id) => proposal(id, "x", "InProgress", id < 120 ? now - 2 * hour : now - 60_000));
    const pages: [number, number][] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        const { params } = JSON.parse(init.body);
        const args = JSON.parse(atob(params.args_base64));
        if (params.method_name === "get_proposals") pages.push([args.from_index, args.limit]);
        const value =
          params.method_name === "get_last_proposal_id"
            ? stored.length
            : params.method_name === "get_policy"
              ? { proposal_bond: "0", proposal_period: (BigInt(hour) * 1_000_000n).toString() }
              : stored.slice(args.from_index, args.from_index + args.limit);
        const result = [...new TextEncoder().encode(JSON.stringify(value))];
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: "satchel", result: { result } }));
      }),
    );
    const open = await sputnikDao(TESTNET, DAO).openProposals(now);
    expect(pages).toEqual([
      [150, 100],
      [50, 100],
    ]);
    expect(open.map((p) => p.id)).toEqual(Array.from({ length: 130 }, (_, i) => 120 + i));
  });
});

/** A vote that ran sign_evm on `net`'s contract for `tokenId` and `tx`, and the MPC answer `value`. */
function voteTx(tokenId: string, tx: ContractTx, value: string | null, net = TESTNET): TxStatus {
  return {
    transaction: { hash: "Vote111111111111111111111111111111111111111", signer_id: "member.testnet", receiver_id: DAO },
    status: { SuccessValue: "" },
    receipts: [
      {
        receipt_id: "R1",
        predecessor_id: DAO,
        receiver_id: net.contract,
        receipt: { Action: { actions: [{ FunctionCall: { method_name: "sign_evm", args: encodeArgs({ token_id: tokenId, tx }), deposit: "1", gas: 150e12 } }] } },
      },
    ],
    receipts_outcome: [
      { id: "R0", outcome: { executor_id: DAO, status: { SuccessValue: "" } } },
      { id: "R1", outcome: { executor_id: net.contract, status: { SuccessReceiptId: "R2" } } },
      { id: "R2", outcome: { executor_id: net.mpc, status: { SuccessReceiptId: "R3" } } },
      { id: "R3", outcome: { executor_id: net.mpc, status: value === null ? "Unknown" : { SuccessValue: value } } },
      { id: "R4", outcome: { executor_id: DAO, status: { SuccessValue: "" } } },
    ],
  };
}

describe("signatureFromReceipts", () => {
  it("finds the MPC answer in any receipt the MPC contract ran, not only in the final status", () => {
    expect(signatureFromReceipts(TESTNET, voteTx("1", TX, SIGNATURE_VALUE))).toMatchObject({ scheme: "Secp256k1", recovery_id: 1 });
    expect(signatureFromReceipts(TESTNET, voteTx("1", TX, null))).toBeNull();
  });

  it("takes no signature from a receipt another account ran", () => {
    const tx = voteTx("1", TX, null);
    tx.receipts_outcome[4].outcome.status = { SuccessValue: SIGNATURE_VALUE };
    expect(signatureFromReceipts(TESTNET, tx)).toBeNull();
    expect(signatureFromReceipts(MAINNET, voteTx("1", TX, SIGNATURE_VALUE))).toBeNull();
  });

  it("refuses two different signatures in one transaction", () => {
    const tx = voteTx("1", TX, SIGNATURE_VALUE);
    const other = JSON.parse(decodeBase64(SIGNATURE_VALUE));
    other.recovery_id = 0;
    tx.receipts_outcome.push({ id: "R5", outcome: { executor_id: TESTNET.mpc, status: { SuccessValue: encodeArgs(other) } } });
    expect(() => signatureFromReceipts(TESTNET, tx)).toThrow(/holds 2 MPC signatures/);
    tx.receipts_outcome[5].outcome.status = { SuccessValue: SIGNATURE_VALUE };
    expect(signatureFromReceipts(TESTNET, tx)).not.toBeNull();
  });
});

describe("finishSignEvm", () => {
  function deps(read: TxStatus, overrides: Partial<FinishDeps> = {}): FinishDeps {
    return {
      readTx: async () => read,
      contractHash: async (tx) => signingHash(fromContractTx(tx)).slice(2),
      extraFee: async () => 0n,
      balance: async () => 10n ** 18n,
      minedNonce: async () => 0,
      receipt: async () => null,
      approve: vi.fn(async () => {}),
      broadcast: vi.fn(async () => "0xabc" as const),
      confirm: async () => "success" as const,
      ...overrides,
    };
  }

  it("recovers the satchel's address from the receipts, asks, then broadcasts", async () => {
    const d = deps(voteTx("1", TX, SIGNATURE_VALUE));
    const steps: string[] = [];
    const result = await finishSignEvm(TESTNET, "Vote111111111111111111111111111111111111111", d, (s) => steps.push(s));
    expect(steps).toEqual(["read", "hash", "recover", "broadcast", "confirm"]);
    expect(result).toMatchObject({ tokenId: "1", caller: DAO, from: TOKEN_1_ADDRESS, status: "success", alreadyMined: false });
    expect(toContractTx(result.tx)).toEqual(TX);
    // Gas at the fee cap: 21000 × 20 wei.
    expect(result.fee).toBe(420_000n);
    expect(d.approve).toHaveBeenCalledOnce();
    expect(d.broadcast).toHaveBeenCalledWith(11155111, expect.stringMatching(/^0x02f865/));
  });

  it("counts an L1 data fee in what it can cost, and reads numbers the way the contract does", async () => {
    const d = deps(voteTx("1", { ...TX, nonce: "+0", value: "01" }, SIGNATURE_VALUE), { extraFee: async () => 5n });
    const result = await finishSignEvm(TESTNET, "v", d);
    expect(result.fee).toBe(420_005n);
    expect(toContractTx(result.tx)).toEqual(TX);
  });

  it("refuses a vote that ran two sign_evm calls, or none on this network's contract", async () => {
    const two = voteTx("1", TX, SIGNATURE_VALUE);
    two.receipts?.push({ ...two.receipts[0], receipt_id: "R1b" });
    await expect(finishSignEvm(TESTNET, "v", deps(two))).rejects.toThrow(/made 2 sign_evm calls/);
    const elsewhere = voteTx("1", TX, SIGNATURE_VALUE);
    if (elsewhere.receipts) elsewhere.receipts[0].receiver_id = "v2.satchel-nft.testnet";
    await expect(finishSignEvm(TESTNET, "v", deps(elsewhere))).rejects.toThrow(/made no sign_evm call on v1.satchel-nft.testnet/);
  });

  it("says why nothing can be sent when sign_evm or the MPC contract failed", async () => {
    const panic = { ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: Satchel: only the token's owner can do this" } } } };
    const refused = voteTx("1", TX, null);
    refused.receipts_outcome[1].outcome.status = { Failure: panic };
    await expect(finishSignEvm(TESTNET, "v", deps(refused))).rejects.toThrow(/sign_evm failed in v: .*only the token's owner/);
    const garbled = voteTx("1", TX, null);
    if (garbled.receipts) (garbled.receipts[0].receipt as { Action: { actions: { FunctionCall: { args: string } }[] } }).Action.actions[0].FunctionCall.args = btoa("{");
    garbled.receipts_outcome[1].outcome.status = { Failure: panic };
    await expect(finishSignEvm(TESTNET, "v", deps(garbled))).rejects.toThrow(/sign_evm failed in v/);
    const unsigned = voteTx("1", TX, null);
    unsigned.receipts_outcome[3].outcome.status = { Failure: { ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: "Signature request has timed out." } } } } };
    await expect(finishSignEvm(TESTNET, "v", deps(unsigned))).rejects.toThrow(/v1.signer-prod.testnet didn't sign in v: .*timed out.*counts nonce 0/);
  });

  it("broadcasts nothing when the contract hashes the transaction differently", async () => {
    const d = deps(voteTx("1", TX, SIGNATURE_VALUE), { contractHash: async () => "00".repeat(32) });
    await expect(finishSignEvm(TESTNET, "v", d)).rejects.toThrow(/The contract hashes this transaction to 0x00/);
    expect(d.approve).not.toHaveBeenCalled();
  });

  it("broadcasts nothing when the signature recovers to another satchel's address", async () => {
    // Token 1's signature, with the call claiming token 2.
    const d = deps(voteTx("2", TX, SIGNATURE_VALUE));
    await expect(finishSignEvm(TESTNET, "v", d)).rejects.toThrow(/not satchel #2's 0x/);
    expect(d.broadcast).not.toHaveBeenCalled();
  });

  it("reports a transaction someone already broadcast without sending it again", async () => {
    const d = deps(voteTx("1", TX, SIGNATURE_VALUE), { receipt: async () => "success" });
    await expect(finishSignEvm(TESTNET, "v", d)).resolves.toMatchObject({ status: "success", alreadyMined: true });
    expect(d.approve).not.toHaveBeenCalled();
    expect(d.broadcast).not.toHaveBeenCalled();
  });

  it("refuses a spent nonce, a nonce ahead of the address's next one, and an address that can't pay", async () => {
    const read = voteTx("1", TX, SIGNATURE_VALUE);
    const spent = deps(read, { minedNonce: async () => 1 });
    await expect(finishSignEvm(TESTNET, "v", spent)).rejects.toThrow(/Nonce 0 of 0x96DA.* is already spent on Sepolia\. Check https:\/\/sepolia\.etherscan\.io\/tx\/0x/);
    // A node that answers with a lower count than the transaction's nonce.
    const behind = deps(read, { minedNonce: async () => -1 });
    await expect(finishSignEvm(TESTNET, "v", behind)).rejects.toThrow(/next nonce on Sepolia is -1, .*Nothing was broadcast/);
    await expect(finishSignEvm(TESTNET, "v", deps(read, { balance: async () => 1n }))).rejects.toThrow(/Fund it and run this again/);
    for (const d of [spent, behind]) expect(d.broadcast).not.toHaveBeenCalled();
  });

  it("reads the receipt again when the nonce is spent: it may be this transaction, mined meanwhile", async () => {
    let reads = 0;
    const d = deps(voteTx("1", TX, SIGNATURE_VALUE), { minedNonce: async () => 1, receipt: async () => (reads++ === 0 ? null : "success") });
    await expect(finishSignEvm(TESTNET, "v", d)).resolves.toMatchObject({ status: "success", alreadyMined: true });
    expect(d.broadcast).not.toHaveBeenCalled();
  });

  it("says when the MPC answer hasn't arrived, and refuses a call it can't send", async () => {
    await expect(finishSignEvm(TESTNET, "v", deps(voteTx("1", TX, null)))).rejects.toThrow(/no MPC signature yet/);
    const mainnetChain = voteTx("1", { ...TX, chain_id: "8453" }, SIGNATURE_VALUE);
    await expect(finishSignEvm(TESTNET, "v", deps(mainnetChain))).rejects.toThrow(/doesn't send on chain 8453/);
    const none = voteTx("1", TX, SIGNATURE_VALUE);
    none.receipts = [];
    await expect(finishSignEvm(TESTNET, "v", deps(none))).rejects.toThrow(/made no sign_evm call/);
  });
});

describe("readTxStatus", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks the index only for the signer, and reads a vote the regular node dropped from the archival one", async () => {
    const hash = "Vote111111111111111111111111111111111111111";
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { body: string }) => {
        asked.push(url);
        const body = JSON.parse(init.body);
        if (url === `${TESTNET.txApi}/v0/transactions`) {
          expect(body.tx_hashes).toHaveLength(1);
          return new Response(JSON.stringify({ transactions: [{ transaction: { signer_id: "member.testnet" } }] }));
        }
        expect(body.params).toEqual({ tx_hash: body.params.tx_hash, sender_account_id: "member.testnet", wait_until: "FINAL" });
        if (url === TESTNET.nearRpc) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: "satchel", error: { name: "TIMEOUT_ERROR", cause: { name: "TIMEOUT_ERROR" } } }));
        }
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: "satchel", result: voteTx("1", TX, SIGNATURE_VALUE) }));
      }),
    );
    const read = await readTxStatus(TESTNET, hash);
    expect(read.transaction.hash).toBe(hash);
    expect(asked).toEqual([`${TESTNET.txApi}/v0/transactions`, TESTNET.nearRpc, "https://archival-rpc.testnet.fastnear.com"]);
    // A node that answers about another transaction is refused.
    await expect(readTxStatus(TESTNET, "Other1111111111111111111111111111111111111")).rejects.toThrow(/answered about Vote1111/);
  });
});

// The vote that approved satchel-club.sputnikv2.testnet's proposal 0 on 2026-11-10: the DAO had
// satchel #8 sign 0.0001 Sepolia ETH to 0x…dEaD at nonce 0 (deployments/testnet-dao.json).
describe("the vote that had satchel #8 sign through its DAO, on testnet", () => {
  const read = vote as unknown as TxStatus;
  const SATCHEL_8 = "0x2aA82C50d1E0C0e9872Fe45A6C1e1DA673bcA5F0";
  const HASH = "0b95701fc2a989725c9fdca6577b9c574f80a9630b1d697a31036c807d22b332";

  it("returned nothing itself: the signature is only in a receipt", () => {
    expect(outcomeValue(read)).toBeNull();
    expect(signatureFromReceipts(TESTNET, read)).toMatchObject({ scheme: "Secp256k1", recovery_id: 0 });
  });

  it("ran one sign_evm, from the DAO, with the proposal's transaction", () => {
    const calls = signEvmCalls(TESTNET, read);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ caller: "satchel-club.sputnikv2.testnet", tokenId: "8" });
    expect(calls[0].tx).toEqual({
      chain_id: "11155111",
      nonce: "0",
      max_priority_fee_per_gas: "1000000000",
      max_fee_per_gas: "5000000000",
      gas_limit: "21000",
      to: "0x000000000000000000000000000000000000dEaD",
      value: "100000000000000",
      data: "0x",
    });
    expect(signingHash(fromContractTx(calls[0].tx as ContractTx))).toBe(`0x${HASH}`);
  });

  it("finishes: the hash is the contract's, the signature recovers to satchel #8's address", async () => {
    const broadcast = vi.fn(async () => "0x27e3262bb3208da84ab3332b018f9f88210b69ec4d85ed5b5299238a38945ba3" as const);
    const result = await finishSignEvm(TESTNET, read.transaction.hash, {
      readTx: async () => read,
      contractHash: async () => HASH,
      extraFee: async () => 0n,
      balance: async () => 10n ** 16n,
      minedNonce: async () => 0,
      receipt: async () => null,
      approve: async () => {},
      broadcast,
      confirm: async () => "success",
    });
    expect(result).toMatchObject({ tokenId: "8", from: SATCHEL_8, hash: "0x27e3262bb3208da84ab3332b018f9f88210b69ec4d85ed5b5299238a38945ba3" });
    expect(broadcast).toHaveBeenCalledWith(11155111, result.raw);
  });
});
