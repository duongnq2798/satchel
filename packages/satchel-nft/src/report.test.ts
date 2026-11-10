import { describe, expect, it } from "vitest";
import { MAINNET, TESTNET } from "./config.js";
import type { ApprovalRecord, SigningRecord } from "./near.js";
import {
  type ChainNonce,
  type ContractFacts,
  approvalsCheck,
  contractCheck,
  countersCheck,
  pendingCheck,
  verdict,
} from "./report.js";

const LOCKED: ContractFacts = {
  accessKeys: 0,
  account: { code_hash: TESTNET.build.codeHash },
  mpcContract: TESTNET.mpc,
};

const RECORD: SigningRecord = {
  evm: [],
  approvals: [],
  approvals_not_itemized: 0,
  unclassified_calls: 0,
  opaque_signatures: 0,
  last_opaque_at: "0",
  version: "0",
};

const ROW: ApprovalRecord = {
  chain_id: "11155111",
  contract: "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238",
  kind: "Approve",
  spender: "0x000000000022d473030f116ddee9f6b43ac78ba3",
  token: null,
  arg: `0x${"f".repeat(64)}`,
};

describe("contract check", () => {
  it("passes a locked contract running the reproducible build through the canonical signer", () => {
    expect(contractCheck(TESTNET, LOCKED).status).toBe("pass");
  });

  it.each([
    ["an access key", { ...LOCKED, accessKeys: 1 }],
    ["other code", { ...LOCKED, account: { code_hash: "11111111111111111111111111111111" } }],
    ["a global contract by account", { ...LOCKED, account: { ...LOCKED.account, global_contract_account_id: "x.testnet" } }],
    ["global code that is not the build", { ...LOCKED, account: { code_hash: "", global_contract_hash: "abc" } }],
    ["another signer", { ...LOCKED, mpcContract: "evil-signer.testnet" }],
  ])("fails with %s", (_, facts) => {
    expect(contractCheck(TESTNET, facts as ContractFacts).status).toBe("fail");
  });

  it("holds mainnet to mainnet's signer", () => {
    const mainnet = { ...LOCKED, mpcContract: MAINNET.mpc };
    expect(contractCheck(MAINNET, mainnet).status).toBe("pass");
    // The testnet deployment, read as if it were mainnet's, fails on its signer.
    const check = contractCheck(MAINNET, LOCKED);
    expect(check.status).toBe("fail");
    expect(check.lines).toContain("Signs through v1.signer-prod.testnet, not the canonical v1.signer");
  });

  it("passes global code pinned to the build's hash", () => {
    const facts = { ...LOCKED, account: { code_hash: "", global_contract_hash: TESTNET.build.codeHash } };
    expect(contractCheck(TESTNET, facts).status).toBe("pass");
  });
});

describe("pending check", () => {
  const sepolia = (maxNonce: bigint, finalizedNonce: bigint | null): ChainNonce => ({
    chainId: 11155111,
    maxNonce,
    finalizedNonce,
    blockNumber: 1n,
  });

  it("passes when nothing was signed", () => {
    expect(pendingCheck([]).status).toBe("pass");
  });

  it("passes once the finalized nonce is above the highest signed nonce", () => {
    expect(pendingCheck([sepolia(0n, 1n)]).status).toBe("pass");
  });

  it("fails while the signed nonce is still open: the token 1 case", () => {
    const check = pendingCheck([sepolia(0n, 0n)]);
    expect(check.status).toBe("fail");
    expect(check.lines[0]).toMatch(/anyone can still broadcast/);
  });

  it("waits, without passing, while the nonce is spent in a block that is not final yet", () => {
    expect(pendingCheck([{ ...sepolia(0n, 0n), latestNonce: 1n }]).status).toBe("unknown");
    expect(pendingCheck([{ ...sepolia(0n, 0n), latestNonce: 0n }]).status).toBe("fail");
  });

  it("is unknown when the nonce cannot be read, and fail outranks unknown", () => {
    expect(pendingCheck([sepolia(0n, null)]).status).toBe("unknown");
    expect(pendingCheck([sepolia(0n, null), { ...sepolia(5n, 3n), chainId: 84532 }]).status).toBe("fail");
    expect(pendingCheck([{ ...sepolia(5n, 3n), chainId: 84532 }, sepolia(0n, null)]).status).toBe("fail");
  });

  it("names each line's chain and how it reads, for the handover kit", () => {
    const check = pendingCheck([sepolia(0n, 1n), { ...sepolia(5n, 3n), chainId: 84532 }, { ...sepolia(0n, null), chainId: 421614 }]);
    expect(check.chains).toEqual([
      { chainId: 11155111, status: "pass" },
      { chainId: 84532, status: "fail" },
      { chainId: 421614, status: "unknown" },
    ]);
    expect(pendingCheck([]).chains).toEqual([]);
  });
});

describe("approvals check", () => {
  it("passes with no rows or only revoked rows", () => {
    expect(approvalsCheck([]).status).toBe("pass");
    expect(approvalsCheck([{ row: ROW, liveness: { live: false, detail: "allowance is 0" } }]).status).toBe("pass");
  });

  it("fails on a live row and is unknown on an unreadable one", () => {
    expect(approvalsCheck([{ row: ROW, liveness: { live: true, detail: "allowance" } }]).status).toBe("fail");
    expect(approvalsCheck([{ row: ROW, liveness: { live: null, detail: "?" } }]).status).toBe("unknown");
    expect(
      approvalsCheck([
        { row: ROW, liveness: { live: null, detail: "?" } },
        { row: ROW, liveness: { live: true, detail: "allowance" } },
      ]).status,
    ).toBe("fail");
  });

  it("names each row's chain and how it reads, for the handover kit", () => {
    const check = approvalsCheck([
      { row: ROW, liveness: { live: false, detail: "allowance is 0" } },
      { row: { ...ROW, chain_id: "1" }, liveness: { live: true, detail: "allowance" } },
      { row: ROW, liveness: { live: null, detail: "?" } },
    ]);
    expect(check.chains).toEqual([
      { chainId: 11155111, status: "pass" },
      { chainId: 1, status: "fail" },
      { chainId: 11155111, status: "unknown" },
    ]);
  });
});

describe("counters check", () => {
  it("passes a record the contract can explain in full", () => {
    expect(countersCheck(RECORD).status).toBe("pass");
  });

  it.each([
    ["a raw signature", { opaque_signatures: 1 }],
    ["an unclassified call", { unclassified_calls: 1 }],
    ["an approval over the cap", { approvals_not_itemized: 1 }],
  ])("fails with %s", (_, extra) => {
    expect(countersCheck({ ...RECORD, ...extra }).status).toBe("fail");
  });
});

describe("verdict", () => {
  const check = (status: "pass" | "fail" | "unknown") => ({ id: "counters" as const, status, title: "", lines: [] });

  it("is clean only when every check passes", () => {
    expect(verdict([check("pass"), check("pass")])).toBe("clean");
    expect(verdict([check("pass"), check("unknown")])).toBe("unknown");
    expect(verdict([check("unknown"), check("fail")])).toBe("not-provable");
  });
});
