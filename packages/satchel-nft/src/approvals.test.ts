import type { PublicClient } from "viem";
import { describe, expect, it } from "vitest";
import { approvalLiveness } from "./approvals.js";
import type { ApprovalRecord } from "./near.js";

const WALLET = "0x96DA1468E95Ab31A698891f0150095f86b5a282B";
const SPENDER = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const AT = { blockNumber: 100n, now: 1_000n };

/** A client whose reads answer from a table keyed by function name; a missing entry reverts. */
function fakeClient(answers: Record<string, unknown>, seen: { blockNumber?: bigint }[] = []): PublicClient {
  return {
    readContract: async (args: { functionName: string; blockNumber?: bigint }) => {
      seen.push({ blockNumber: args.blockNumber });
      if (!(args.functionName in answers)) throw new Error("execution reverted");
      return answers[args.functionName];
    },
  } as unknown as PublicClient;
}

const row = (kind: ApprovalRecord["kind"], extra: Partial<ApprovalRecord> = {}): ApprovalRecord => ({
  chain_id: "11155111",
  contract: "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238",
  kind,
  spender: SPENDER.toLowerCase(),
  token: null,
  arg: "0x05",
  ...extra,
});

describe("approval liveness", () => {
  it("pins every read to the finalized block", async () => {
    const seen: { blockNumber?: bigint }[] = [];
    await approvalLiveness(fakeClient({ allowance: 0n }, seen), WALLET, row("Approve"), AT);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => s.blockNumber === 100n)).toBe(true);
  });

  it("finds a live ERC-20 allowance", async () => {
    const r = await approvalLiveness(fakeClient({ allowance: 7n }), WALLET, row("Approve"), AT);
    expect(r).toMatchObject({ live: true, standard: "erc20" });
    expect((await approvalLiveness(fakeClient({ allowance: 7n }), WALLET, row("IncreaseAllowance"), AT)).standard).toBe("erc20");
  });

  it("finds a live ERC-721 approval of the row's token id", async () => {
    const r = await approvalLiveness(fakeClient({ getApproved: SPENDER }), WALLET, row("Approve"), AT);
    expect(r).toMatchObject({ live: true, standard: "erc721" });
  });

  it("counts an Approve row live if either reading says so, and says which", async () => {
    const r = await approvalLiveness(fakeClient({ allowance: 0n, getApproved: SPENDER }), WALLET, row("Approve"), AT);
    expect(r).toMatchObject({ live: true, standard: "erc721" });
    // A contract that answers both reads live: the fix plan can't tell which revoke it takes.
    const both = await approvalLiveness(fakeClient({ allowance: 3n, getApproved: SPENDER }), WALLET, row("Approve"), AT);
    expect(both).toMatchObject({ live: true, detail: "allowance of 3 still granted", standard: "both" });
    // Not live: no standard to name.
    expect((await approvalLiveness(fakeClient({ allowance: 0n }), WALLET, row("Approve"), AT)).standard).toBeUndefined();
  });

  it("passes a revoked approval and refuses to guess when nothing can be read", async () => {
    expect((await approvalLiveness(fakeClient({ allowance: 0n }), WALLET, row("Approve"), AT)).live).toBe(false);
    expect((await approvalLiveness(fakeClient({}), WALLET, row("Approve"), AT)).live).toBeNull();
    expect((await approvalLiveness(fakeClient({}), WALLET, row("IncreaseAllowance"), AT)).live).toBeNull();
  });

  it("passes approve(0x0, id), the way an ERC-721 approval is cleared", async () => {
    // getApproved reads 0x0, which equals the row's spender; that must not count as live.
    const cleared = row("Approve", { spender: "0x0000000000000000000000000000000000000000", arg: "0x07" });
    const r = await approvalLiveness(fakeClient({ getApproved: "0x0000000000000000000000000000000000000000" }), WALLET, cleared, AT);
    expect(r.live).toBe(false);
  });

  it("reads operators", async () => {
    expect((await approvalLiveness(fakeClient({ isApprovedForAll: true }), WALLET, row("SetApprovalForAll"), AT)).live).toBe(true);
    expect((await approvalLiveness(fakeClient({ isApprovedForAll: false }), WALLET, row("SetApprovalForAll"), AT)).live).toBe(false);
  });

  it("treats a Permit2 allowance as live until it expires", async () => {
    const permit2 = row("Permit2Approve", { token: "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238" });
    expect((await approvalLiveness(fakeClient({ allowance: [5n, 1_000, 0] }), WALLET, permit2, AT)).live).toBe(true);
    expect((await approvalLiveness(fakeClient({ allowance: [5n, 999, 0] }), WALLET, permit2, AT)).live).toBe(false);
    expect((await approvalLiveness(fakeClient({ allowance: [0n, 5_000, 0] }), WALLET, permit2, AT)).live).toBe(false);
    expect((await approvalLiveness(fakeClient({}), WALLET, permit2, AT)).live).toBeNull();
    expect((await approvalLiveness(fakeClient({}), WALLET, row("Permit2Approve"), AT)).live).toBeNull();
  });
});
