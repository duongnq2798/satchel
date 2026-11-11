import {
  type Address,
  type Hex,
  type PublicClient,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  erc721Abi,
  getAddress,
  toFunctionSelector,
  zeroAddress,
} from "viem";
import { describe, expect, it, vi } from "vitest";
import type { Liveness } from "./approvals.js";
import { type FixAction, type FixChainState, type FixPlan, fixPlan, readFixInputs, revokeCalldata } from "./clean.js";
import { MAINNET, type Network, TESTNET } from "./config.js";
import type { ApprovalRecord, SatchelView, SigningRecord } from "./near.js";
import { type ApprovalState, type ChainNonce, type ContractFacts, assemble } from "./report.js";

// readFixInputs reads chains through verifiedClient; the one test of it answers from a table.
const fake = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("./evm.js", async (original) => ({
  ...(await original<typeof import("./evm.js")>()),
  verifiedClient: async () => fake.client,
}));

const FUJI = 43113;
const SEPOLIA = 11155111;
const ADDRESS = "0xEc0E9015578Bac30FC60345a963A9e8d10d52E68" as Address;
const USDC = "0x5425890298aed601595a70ab815c96711a31bc65";
const SPENDER = "0x1111111111111111111111111111111111111111";
const OPERATOR = "0x2222222222222222222222222222222222222222";
const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3";
const NFT = "0x3333333333333333333333333333333333333333";

const word = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}`;
const MAX = word((1n << 256n) - 1n);

const row = (extra: Partial<ApprovalRecord> = {}): ApprovalRecord => ({
  chain_id: String(FUJI),
  contract: USDC,
  kind: "Approve",
  spender: SPENDER,
  token: null,
  arg: MAX,
  ...extra,
});

const LIVE20: Liveness = { live: true, detail: "allowance of 5 still granted", standard: "erc20" };
const LIVE721: Liveness = { live: true, detail: "token 7 still approved", standard: "erc721" };
const LIVE: Liveness = { live: true, detail: "operator still approved" };
const OFF: Liveness = { live: false, detail: "allowance is 0" };

interface Setup {
  net?: Network;
  facts?: Partial<ContractFacts>;
  record?: Partial<SigningRecord>;
  /** Check 2's reads at the finalized block, one per evm row. */
  nonces?: ChainNonce[];
  /** Each approval row: its liveness at the finalized block (the report's) and at the latest (the plan's). */
  rows?: { row: ApprovalRecord; then: Liveness; now: Liveness }[];
  chains?: FixChainState[];
  listed?: boolean;
}

const RECORD: SigningRecord = {
  evm: [],
  approvals: [],
  approvals_not_itemized: 0,
  unclassified_calls: 0,
  opaque_signatures: 0,
  last_opaque_at: "0",
  version: "3",
};

function plan({ net = TESTNET, facts, record, nonces = [], rows = [], chains = [], listed = false }: Setup): FixPlan {
  const full: SigningRecord = { ...RECORD, approvals: rows.map((r) => r.row), ...record };
  const view: SatchelView = {
    token_id: "9",
    owner_id: "satchel-nft.testnet",
    path: "satchel/9",
    record: full,
    listing: listed ? { seller: "satchel-nft.testnet", price: "1", record_version: full.version, listed_at: "0" } : null,
  };
  const locked: ContractFacts = { accessKeys: 0, account: { code_hash: net.build.codeHash }, mpcContract: net.mpc, ...facts };
  const approvals: ApprovalState[] = rows.map((r) => ({ row: r.row, liveness: r.then }));
  const report = assemble({ net, view, address: ADDRESS, facts: locked, nonces, approvals });
  return fixPlan({ report, record: full, chains, approvals: rows.map((r) => r.now) });
}

const evm = (chainId: number, maxNonce: number) => ({ chain_id: String(chainId), max_nonce: String(maxNonce), signatures: maxNonce + 1 });
/** Check 2 failing on `chainId`: signed up to `max`, the finalized and latest nonces at `at`. */
const open = (chainId: number, max: number, at: number): ChainNonce => ({
  chainId,
  maxNonce: BigInt(max),
  finalizedNonce: BigInt(at),
  latestNonce: BigInt(at),
  blockNumber: 1n,
});
const spent = (chainId: number, max: number): ChainNonce => ({ ...open(chainId, max, max + 1) });
const state = (chainId: number, pending: number, extra: Partial<FixChainState> = {}): FixChainState => ({
  chainId,
  pendingNonce: BigInt(pending),
  latestNonce: BigInt(pending),
  balance: 10n ** 17n,
  ...extra,
});

const actions = (p: FixPlan): FixAction[] => p.chains.flatMap((c) => c.actions);
const text = (p: FixPlan) => [...p.notes, ...p.chains.flatMap((c) => c.notes)].join("\n");

/**
 * The contract's `Eip1559Tx::classify` (evm.rs) for the calls a plan sends: empty calldata is a
 * value transfer; an approval selector that grants nothing is a revocation; any other approval is
 * a row, whose fields are what the contract itemizes.
 */
function contractClass(to: Address, data: Hex, chainId: number): "value" | "revocation" | ApprovalRecord {
  if (data === "0x") return "value";
  const selector = data.slice(0, 10);
  const words = (data.slice(10).match(/.{64}/g) ?? []).map((w) => `0x${w}`);
  const address = (w: string) => `0x${w.slice(-40)}`;
  const zero = (w: string) => BigInt(w) === 0n;
  const base = { chain_id: String(chainId), contract: to.toLowerCase(), token: null };
  switch (selector) {
    case "0x095ea7b3":
      return { ...base, kind: "Approve", spender: address(words[0]), arg: words[1] };
    case "0xa22cb465":
      if (zero(words[1])) return "revocation";
      return { ...base, kind: "SetApprovalForAll", spender: address(words[0]), arg: words[1] };
    case "0x87517c45":
      if (zero(words[2])) return "revocation";
      return { ...base, kind: "Permit2Approve", spender: address(words[1]), token: address(words[0]), arg: words[2] };
    default:
      throw new Error(`a plan sent ${selector}, which the contract counts as unclassified`);
  }
}

/** Every action costs the record what the contract would itemize for it. */
function checkCosts(p: FixPlan) {
  for (const a of actions(p)) {
    const cls = contractClass(a.to, a.data, a.chainId);
    if (cls === "value" || cls === "revocation") expect(a.slot, a.title).toEqual({ kind: "none" });
    else expect(a.slot.kind, a.title).not.toBe("none");
  }
}

describe("revokeCalldata", () => {
  const spender = getAddress(SPENDER);
  it("is viem's encoding of each standard's revoking call, and nothing the contract can't classify", () => {
    expect(revokeCalldata.erc20(spender)).toBe(encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, 0n] }));
    // The calldata the sell guide spells out for this spender.
    expect(revokeCalldata.erc20(spender)).toBe(
      "0x095ea7b300000000000000000000000011111111111111111111111111111111111111110000000000000000000000000000000000000000000000000000000000000000",
    );
    expect(revokeCalldata.erc721(7n)).toBe(encodeFunctionData({ abi: erc721Abi, functionName: "approve", args: [zeroAddress, 7n] }));
    expect(revokeCalldata.operator(spender)).toBe(
      encodeFunctionData({ abi: erc721Abi, functionName: "setApprovalForAll", args: [spender, false] }),
    );
    const token = getAddress(USDC);
    expect(revokeCalldata.permit2(token, spender)).toBe(
      toFunctionSelector("approve(address,address,uint160,uint48)") +
        encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint160" }, { type: "uint48" }], [token, spender, 0n, 0]).slice(2),
    );
    // The contract's selectors (evm.rs), so each call is classified as the plan says.
    expect(revokeCalldata.erc20(spender).slice(0, 10)).toBe("0x095ea7b3");
    expect(revokeCalldata.operator(spender).slice(0, 10)).toBe("0xa22cb465");
    expect(revokeCalldata.permit2(token, spender).slice(0, 10)).toBe("0x87517c45");
    expect(contractClass(spender, revokeCalldata.operator(spender), FUJI)).toBe("revocation");
    expect(contractClass(spender, revokeCalldata.permit2(token, spender), FUJI)).toBe("revocation");
  });
});

describe("fixPlan", () => {
  it("has nothing to do for a clean satchel", () => {
    const p = plan({ record: { evm: [evm(FUJI, 0)] }, nonces: [spent(FUJI, 0)], chains: [state(FUJI, 1)] });
    expect(p).toEqual({ canSend: true, notes: [], chains: [], unfixable: [] });
  });

  it("revokes a live ERC-20 allowance with approve(spender, 0), which takes the next slot and the open nonce", () => {
    // Testnet #9's plan: a live USDC approval on Fuji, and nonce 1 signed but never sent.
    const p = plan({
      record: { evm: [evm(FUJI, 1)] },
      nonces: [open(FUJI, 1, 1)],
      rows: [{ row: row(), then: LIVE20, now: LIVE20 }],
      chains: [state(FUJI, 1)],
    });
    expect(p.canSend).toBe(true);
    expect(p.chains).toHaveLength(1);
    const [chain] = p.chains;
    expect(chain).toMatchObject({ chainId: FUJI, name: "Avalanche Fuji", sendable: true, nextNonce: 1n, openNonces: 1n });
    expect(chain.actions).toHaveLength(1);
    expect(chain.actions[0]).toMatchObject({
      kind: "revoke",
      to: getAddress(USDC),
      value: 0n,
      data: revokeCalldata.erc20(getAddress(SPENDER)),
      call: `approve(${getAddress(SPENDER)}, 0)`,
      rows: [0],
      slot: { kind: "takes", slot: 2 },
      nonce: 1n,
    });
    expect(chain.actions[0].cost).toMatch(/^Takes approval slot 2 of 32/);
    expect(chain.actions[0].refused).toBeUndefined();
    // The revoke takes nonce 1 itself, so no spend is needed.
    expect(chain.notes.join("\n")).toMatch(/1 nonce\(s\) are open on Avalanche Fuji, and each revoke on this chain takes the next one, so the revokes spend them all/);
    expect(chain.notes.join("\n")).toMatch(/pays its gas from the satchel's balance there/);
    checkCosts(p);
  });

  it("spends the open nonces a revoke doesn't cover, with sends of 0 to the satchel's own address", () => {
    const p = plan({
      record: { evm: [evm(FUJI, 3)] },
      nonces: [open(FUJI, 3, 1)],
      rows: [{ row: row(), then: LIVE20, now: LIVE20 }],
      chains: [state(FUJI, 1)],
    });
    const list = actions(p);
    expect(list.map((a) => [a.kind, a.nonce, a.title])).toEqual([
      ["revoke", 1n, `Revoke 0x1111…1111's allowance on 0x5425…Bc65`],
      ["spend", 2n, "Spend nonce 2"],
      ["spend", 3n, "Spend nonce 3"],
    ]);
    for (const spend of list.slice(1)) {
      expect(spend).toMatchObject({ to: ADDRESS, value: 0n, data: "0x", slot: { kind: "none" }, rows: [] });
    }
    expect(text(p)).toMatch(/3 nonce\(s\) are open on Avalanche Fuji, and each revoke on this chain takes the next one, so 2 nonce spend\(s\) cover the rest/);
    checkCosts(p);
  });

  it("counts open nonces from the pending nonce, not the finalized one", () => {
    // Finalized at 2, but one send at nonce 2 is already pending: only 3 and 4 are open.
    const p = plan({ record: { evm: [evm(SEPOLIA, 4)] }, nonces: [open(SEPOLIA, 4, 2)], chains: [state(SEPOLIA, 3, { latestNonce: 2n })] });
    expect(p.chains[0].openNonces).toBe(2n);
    expect(actions(p).map((a) => a.nonce)).toEqual([3n, 4n]);
  });

  it("spends up to 10 open nonces from the app, and says more can't be fixed from here", () => {
    const ten = plan({ record: { evm: [evm(FUJI, 9)] }, nonces: [open(FUJI, 9, 0)], chains: [state(FUJI, 0)] });
    expect(actions(ten)).toHaveLength(10);
    expect(actions(ten).every((a) => a.kind === "spend" && a.refused === undefined)).toBe(true);

    const eleven = plan({ record: { evm: [evm(FUJI, 10)] }, nonces: [open(FUJI, 10, 0)], chains: [state(FUJI, 0)] });
    expect(actions(eleven)).toHaveLength(0);
    expect(eleven.chains[0].openNonces).toBe(11n);
    expect(text(eleven)).toContain("11 nonces are open on Avalanche Fuji, more than the app sends one by one (10), so they can't be fixed from here");
    expect(text(eleven)).toContain(`npx -y satchel-nft@0.2.0 send 9 --chain 43113 --to ${ADDRESS} --value 0 --as <you>:`);
    expect(text(eleven)).toContain("send 0 to the satchel's own address once per open nonce, with npx");

    // With a revoke on the chain, it keeps its button and takes one of them; the command covers the rest.
    const twelve = plan({
      record: { evm: [evm(FUJI, 11)] },
      nonces: [open(FUJI, 11, 0)],
      rows: [{ row: row(), then: LIVE20, now: LIVE20 }],
      chains: [state(FUJI, 0)],
    });
    expect(actions(twelve).map((a) => [a.kind, a.nonce])).toEqual([["revoke", 0n]]);
    expect(text(twelve)).toContain("send 0 to the satchel's own address once for each open nonce the revokes on this chain don't take, with npx");
  });

  it("trusts check 2 over a nonce read that lags it, and sends nothing on that chain", () => {
    // Probe: signed up to 4, finalized at 5 (check 2 passes), but the RPC answers 3 as pending.
    const p = plan({
      record: { evm: [evm(FUJI, 4)] },
      nonces: [spent(FUJI, 4)],
      rows: [{ row: row(), then: LIVE20, now: LIVE20 }],
      chains: [state(FUJI, 3)],
    });
    const [chain] = p.chains;
    expect(chain.openNonces).toBe(0n);
    expect(chain.actions.map((a) => [a.kind, a.nonce])).toEqual([["revoke", null]]);
    expect(chain.actions[0].refused).toMatch(/^The RPC for Avalanche Fuji answered a nonce that is already spent/);
    expect(text(p)).toContain(
      "The RPC for Avalanche Fuji answered 3 as the next nonce, though the report read a later one at a finalized block. A send there now could sign a nonce that is already spent, so the plan sends nothing on Avalanche Fuji. Check again.",
    );
    expect(text(p)).not.toMatch(/pays its gas/);

    // Pending below the latest block's own count: the same lag, while check 2 still fails.
    const behind = plan({ record: { evm: [evm(FUJI, 4)] }, nonces: [open(FUJI, 4, 2)], chains: [state(FUJI, 2, { latestNonce: 3n })] });
    expect(actions(behind)).toEqual([]);
    expect(behind.chains[0].openNonces).toBe(0n);
    expect(text(behind)).toMatch(/answered 2 as the next nonce, though the address's nonce at its latest block is already 3/);
  });

  it("waits for finality when the latest nonce is past the signed one, with no button", () => {
    // The report: finalized nonce 4, latest 5, so check 2 reads unknown on Sepolia.
    const notFinal: ChainNonce = { chainId: SEPOLIA, maxNonce: 4n, finalizedNonce: 4n, latestNonce: 5n, blockNumber: 1n };
    const p = plan({ record: { evm: [evm(SEPOLIA, 4)] }, nonces: [notFinal], chains: [state(SEPOLIA, 5)] });
    expect(actions(p)).toEqual([]);
    expect(p.chains[0].openNonces).toBe(0n);
    expect(text(p)).toContain(
      "The transaction at nonce 4 is in a recent block that isn't finalized yet, so no nonce is left to spend. Check 2 passes for Sepolia once it is: check again then.",
    );
    // Sent, but not in a block yet.
    const mempool = plan({ record: { evm: [evm(SEPOLIA, 4)] }, nonces: [open(SEPOLIA, 4, 4)], chains: [state(SEPOLIA, 5, { latestNonce: 4n })] });
    expect(actions(mempool)).toEqual([]);
    expect(text(mempool)).toMatch(/A transaction at nonce 4 is sent but not in a block yet/);
  });

  it("says when a chain's nonce couldn't be read, and still offers its revokes", () => {
    const p = plan({
      record: { evm: [evm(FUJI, 1)] },
      nonces: [open(FUJI, 1, 1)],
      rows: [{ row: row(), then: LIVE20, now: LIVE20 }],
      chains: [{ chainId: FUJI, pendingNonce: null, latestNonce: null, balance: null }],
    });
    expect(actions(p).map((a) => [a.kind, a.nonce])).toEqual([["revoke", null]]);
    expect(text(p)).toMatch(/Couldn't read the satchel's nonce on Avalanche Fuji/);
    expect(text(p)).toMatch(/Couldn't read the satchel's balance on Avalanche Fuji/);
  });

  it("warns when the satchel has nothing to pay gas with", () => {
    // Only a revoke to send: nothing signed is waiting for gas.
    const p = plan({
      record: { evm: [evm(FUJI, 0)] },
      nonces: [spent(FUJI, 0)],
      rows: [{ row: row(), then: LIVE20, now: LIVE20 }],
      chains: [state(FUJI, 1, { balance: 0n })],
    });
    expect(text(p)).toContain("The satchel holds 0 AVAX on Avalanche Fuji, and each fix pays its gas there: fund its address first");
    expect(text(p)).not.toMatch(/is public/);
  });

  it("warns that funding a satchel with open nonces lets anyone broadcast what was signed at them", () => {
    const p = plan({ record: { evm: [evm(FUJI, 0)] }, nonces: [open(FUJI, 0, 0)], chains: [state(FUJI, 0, { balance: 0n })] });
    expect(text(p)).toContain(
      "The satchel holds 0 AVAX on Avalanche Fuji, and each fix pays its gas there, so a send stops before your wallet opens until the address is funded.",
    );
    expect(text(p)).not.toMatch(/fund its address first/);
    expect(text(p)).toContain(
      "The transaction signed at each open nonce on Avalanche Fuji is public. Once the address can pay for it, anyone can broadcast it before your fix. History on this page lists what each one sends. Fund only what the fixes need, and send them right after.",
    );
    // A funded satchel gets the same caution: the old transaction can land as soon as it can pay.
    const funded = plan({ record: { evm: [evm(FUJI, 0)] }, nonces: [open(FUJI, 0, 0)], chains: [state(FUJI, 0)] });
    expect(text(funded)).toMatch(/The transaction signed at each open nonce on Avalanche Fuji is public/);
  });

  it("clears an ERC-721 approval with approve(0x0, id), and builds no button when it can't tell the standard", () => {
    const nft = row({ contract: NFT, arg: word(7n) });
    const p = plan({
      record: { evm: [evm(FUJI, 0)] },
      nonces: [spent(FUJI, 0)],
      rows: [
        { row: nft, then: LIVE721, now: LIVE721 },
        // Both reads live: approve(spender, 0) would approve token 0 on an ERC-721 contract.
        { row: row({ contract: NFT, arg: word(8n) }), then: { ...LIVE20, standard: "both" }, now: { ...LIVE20, standard: "both" } },
        // Neither read answered.
        { row: row({ contract: NFT, arg: word(9n) }), then: { live: null, detail: "x" }, now: { live: null, detail: "could not read allowance or getApproved" } },
      ],
      chains: [state(FUJI, 1)],
    });
    expect(actions(p)).toHaveLength(1);
    expect(actions(p)[0]).toMatchObject({
      to: getAddress(NFT),
      data: revokeCalldata.erc721(7n),
      call: `approve(${zeroAddress}, 7)`,
      rows: [0],
      slot: { kind: "takes", slot: 4 },
    });
    // The row it adds is granted to the zero address, which reads as no right.
    expect(contractClass(getAddress(NFT), actions(p)[0].data, FUJI)).toMatchObject({ spender: zeroAddress, arg: word(7n) });
    const [both, unread] = p.chains[0].manual;
    expect(both.row).toBe(1);
    expect(both.why).toMatch(/^Both reads find it live/);
    expect(both.calls.map((c) => c.data)).toEqual([revokeCalldata.erc20(getAddress(SPENDER)), revokeCalldata.erc721(8n)]);
    expect(unread.row).toBe(2);
    expect(unread.why).toMatch(/^Couldn't read it at the latest block \(could not read allowance or getApproved\)/);
    expect(unread.calls).toHaveLength(2);
    checkCosts(p);
  });

  it("puts free revokes first: operators off and Permit2 to 0 take no slot", () => {
    const p = plan({
      record: { evm: [evm(FUJI, 2)] },
      nonces: [spent(FUJI, 2)],
      rows: [
        { row: row(), then: LIVE20, now: LIVE20 },
        { row: row({ kind: "SetApprovalForAll", contract: NFT, spender: OPERATOR, arg: word(1n) }), then: LIVE, now: LIVE },
        { row: row({ kind: "Permit2Approve", contract: PERMIT2, token: USDC, arg: word(5n) }), then: LIVE, now: LIVE },
      ],
      chains: [state(FUJI, 3)],
    });
    expect(actions(p).map((a) => [a.call, a.slot.kind, a.nonce])).toEqual([
      [`setApprovalForAll(${getAddress(OPERATOR)}, false)`, "none", 3n],
      [`approve(${getAddress(USDC)}, ${getAddress(SPENDER)}, 0, 0)`, "none", 4n],
      [`approve(${getAddress(SPENDER)}, 0)`, "takes", 5n],
    ]);
    // The Permit2 revoke goes to Permit2, not to the token.
    expect(actions(p)[1].to).toBe(getAddress(PERMIT2));
    expect(actions(p)[0].cost).toBe("Free: the contract logs it as a revocation and itemizes nothing.");
    checkCosts(p);
  });

  it("sends one revoke for two rows it clears together", () => {
    const p = plan({
      rows: [
        { row: row({ arg: word(100n) }), then: LIVE20, now: LIVE20 },
        { row: row({ arg: word(200n) }), then: LIVE20, now: LIVE20 },
      ],
      record: { evm: [evm(FUJI, 1)] },
      nonces: [spent(FUJI, 1)],
      chains: [state(FUJI, 2)],
    });
    expect(actions(p)).toHaveLength(1);
    expect(actions(p)[0]).toMatchObject({ rows: [0, 1], slot: { kind: "takes", slot: 3 } });
  });

  describe("the 32 approval slots", () => {
    /** `n` approval rows, revoked long ago, on other contracts. */
    const filler = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        row: row({ contract: `0x${(i + 16).toString(16).padStart(40, "a")}`, arg: word(BigInt(i + 1)) }),
        then: OFF,
        now: OFF,
      }));
    const live = (extra: Partial<ApprovalRecord> = {}) => ({ row: row(extra), then: LIVE20, now: LIVE20 });
    const base = { record: { evm: [evm(FUJI, 0)] }, nonces: [spent(FUJI, 0)], chains: [state(FUJI, 1)] };

    it("gives a revoke slot 32 when 31 rows are full", () => {
      // 30 old rows and the live one: 31.
      const p = plan({ ...base, rows: [...filler(30), live()] });
      expect(actions(p)[0]).toMatchObject({ slot: { kind: "takes", slot: 32 }, nonce: 1n });
      expect(actions(p)[0].refused).toBeUndefined();
    });

    it("refuses a revoke that would be the 33rd row, since check 4 would then fail for good", () => {
      const p = plan({ ...base, rows: [...filler(31), live()] });
      expect(actions(p)[0].slot).toEqual({ kind: "over" });
      expect(actions(p)[0].refused).toMatch(/^This revoke would be a 33rd approval row, which the contract only counts, and check 4 would then fail for good/);
      expect(actions(p)[0].nonce).toBeNull();
    });

    it("sends a 33rd row once check 4 already fails: a counted row costs nothing more", () => {
      const p = plan({ ...base, record: { ...base.record, approvals_not_itemized: 1 }, rows: [...filler(31), live()] });
      expect(actions(p)[0]).toMatchObject({ slot: { kind: "over" }, nonce: 1n });
      expect(actions(p)[0].refused).toBeUndefined();
      expect(actions(p)[0].cost).toBe(
        "Counted, not itemized: the record's 32 approval rows are full, counting the revokes this plan sends before it. Check 4 already fails, so this costs the record nothing more.",
      );
      expect(text(p)).toMatch(/^Check 4 fails, and no transaction fixes it/);
    });

    it("counts slots across the plan: of two revokes with 31 rows full, the second is refused", () => {
      const p = plan({ ...base, rows: [...filler(29), live(), live({ contract: NFT })] });
      expect(actions(p).map((a) => [a.slot, a.refused === undefined])).toEqual([
        [{ kind: "takes", slot: 32 }, true],
        [{ kind: "over" }, false],
      ]);
    });

    it("counts a revoke on a chain whose nonce read lags after the ones it sends, so it takes no slot they need", () => {
      // 29 old rows, a live one on Sepolia, listed first, whose RPC answers a spent nonce, and one on Fuji: 31.
      const p = plan({
        record: { evm: [evm(SEPOLIA, 4), evm(FUJI, 0)] },
        nonces: [spent(SEPOLIA, 4), spent(FUJI, 0)],
        rows: [...filler(29), live({ chain_id: String(SEPOLIA), contract: NFT }), live()],
        chains: [state(SEPOLIA, 3), state(FUJI, 1)],
      });
      const [sepolia, fuji] = [SEPOLIA, FUJI].map((id) => p.chains.find((c) => c.chainId === id)?.actions[0]);
      expect(fuji).toMatchObject({ slot: { kind: "takes", slot: 32 }, nonce: 1n });
      expect(fuji?.refused).toBeUndefined();
      expect(sepolia).toMatchObject({ slot: { kind: "over" }, nonce: null });
      expect(sepolia?.refused).toMatch(/^The RPC for Sepolia answered a nonce that is already spent/);
      checkCosts(p);
    });

    it("refuses an over-the-limit revoke on another network's chain as elsewhere, not toward Send from this satchel", () => {
      // 29 old rows, a live one on Ethereum, which the app doesn't send on, and one on Fuji: 31.
      const p = plan({
        record: { evm: [evm(FUJI, 0), evm(1, 0)] },
        nonces: [spent(FUJI, 0), spent(1, 0)],
        rows: [...filler(29), live({ chain_id: "1", contract: NFT }), live()],
        chains: [state(FUJI, 1), state(1, 1)],
      });
      const [fuji, ethereum] = [FUJI, 1].map((id) => p.chains.find((c) => c.chainId === id)?.actions[0]);
      expect(fuji).toMatchObject({ slot: { kind: "takes", slot: 32 }, nonce: 1n });
      expect(ethereum?.slot).toEqual({ kind: "over" });
      expect(ethereum?.refused).toBe(
        "The app doesn't send on Ethereum from a testnet satchel: it sends only on the 8 testnets. Signed with the near CLI, it would also be a 33rd approval row, which the contract only counts, and check 4 would then fail for good.",
      );
      expect(ethereum?.refused).not.toMatch(/Send from this satchel/);
      checkCosts(p);
    });

    it("sends a revoke whose row is already there with all 32 full: the contract merges it", () => {
      const revoked = { row: row({ arg: word(0n) }), then: OFF, now: OFF };
      const p = plan({ ...base, rows: [...filler(30), revoked, live()] });
      expect(actions(p)[0]).toMatchObject({ slot: { kind: "merges", row: 31 }, nonce: 1n });
      expect(actions(p)[0].refused).toBeUndefined();
      expect(actions(p)[0].cost).toBe("No new slot: it is the same row as approval row 31, which the contract merges it with.");
    });

    it("still offers free revokes with all 32 full", () => {
      const p = plan({ ...base, rows: [...filler(31), { row: row({ kind: "SetApprovalForAll", spender: OPERATOR, arg: word(1n) }), then: LIVE, now: LIVE }] });
      expect(actions(p)[0]).toMatchObject({ slot: { kind: "none" }, nonce: 1n });
      expect(actions(p)[0].refused).toBeUndefined();
    });
  });

  it("gives no fix for check 4, and says so", () => {
    const p = plan({ record: { opaque_signatures: 1, unclassified_calls: 2 } });
    expect(p.chains).toEqual([]);
    expect(p.unfixable).toHaveLength(2);
    expect(p.unfixable[0]).toMatch(/raw signature/);
    expect(text(p)).toMatch(/^Check 4 fails, and no transaction fixes it: its counters only grow/);
    // With other fixes too, the note stays, and nothing in the plan is for check 4.
    const both = plan({
      record: { evm: [evm(FUJI, 0)], approvals_not_itemized: 1 },
      nonces: [open(FUJI, 0, 0)],
      chains: [state(FUJI, 0)],
    });
    expect(actions(both).map((a) => a.kind)).toEqual(["spend"]);
    expect(both.unfixable).toEqual(["1 approval(s) signed after the list was full. No one can rule out what these left behind"]);
  });

  it("sends nothing while check 1 fails or the satchel is listed", () => {
    const setup = { record: { evm: [evm(FUJI, 0)] }, nonces: [open(FUJI, 0, 0)], chains: [state(FUJI, 0)] };
    const broken = plan({ ...setup, facts: { accessKeys: 1 } });
    expect(broken.canSend).toBe(false);
    expect(text(broken)).toMatch(/^Check 1 fails, so the app signs nothing/);
    const listed = plan({ ...setup, listed: true });
    expect(listed.canSend).toBe(false);
    expect(text(listed)).toMatch(/Its owner has to delist it first/);
    // The plan and its calldata still show.
    expect(actions(listed)).toHaveLength(1);
  });

  it("refuses a chain of the other network, and says how to send there", () => {
    const p = plan({
      record: { evm: [evm(1, 0)] },
      nonces: [open(1, 0, 0)],
      rows: [{ row: row({ chain_id: "1" }), then: LIVE20, now: LIVE20 }],
      chains: [state(1, 0)],
    });
    expect(p.chains[0]).toMatchObject({ chainId: 1, sendable: false });
    expect(actions(p).map((a) => a.kind)).toEqual(["revoke"]);
    expect(actions(p)[0].refused).toBe("The app doesn't send on Ethereum from a testnet satchel: it sends only on the 8 testnets.");
    expect(text(p)).toMatch(/1 signed nonce\(s\) are open on Ethereum/);
    expect(text(p)).toMatch(/call sign_evm yourself with the near CLI/);
  });

  it("waits for a revoke that isn't final yet instead of offering it again", () => {
    const p = plan({
      record: { evm: [evm(FUJI, 1)] },
      nonces: [{ chainId: FUJI, maxNonce: 1n, finalizedNonce: 1n, latestNonce: 2n, blockNumber: 1n }],
      rows: [{ row: row(), then: LIVE20, now: OFF }],
      chains: [state(FUJI, 2)],
    });
    expect(actions(p)).toEqual([]);
    expect(text(p)).toMatch(/An approval on Avalanche Fuji is revoked in a recent block that isn't finalized yet/);
    expect(text(p)).toMatch(/The transaction at nonce 1 is in a recent block that isn't finalized yet/);
  });

  it("acts on nothing when the record changed since the report", () => {
    const p = plan({ record: { evm: [evm(FUJI, 0)] }, nonces: [open(FUJI, 0, 0)], chains: [state(FUJI, 0)] });
    expect(actions(p)).toHaveLength(1);
    const view = { ...RECORD, evm: [evm(FUJI, 0)] };
    const net = TESTNET;
    const report = assemble({
      net,
      view: { token_id: "9", owner_id: "a.testnet", path: "satchel/9", record: view, listing: null },
      address: ADDRESS,
      facts: { accessKeys: 0, account: { code_hash: net.build.codeHash }, mpcContract: net.mpc },
      nonces: [open(FUJI, 0, 0)],
      approvals: [],
    });
    const stale = fixPlan({ report, record: { ...view, version: "4" }, chains: [state(FUJI, 0)], approvals: [] });
    expect(stale).toMatchObject({ canSend: false, chains: [] });
    expect(stale.notes).toEqual(["The report read record version 3, and the record is now at version 4. Check again before you fix anything."]);
  });

  it("names the mainnet flag in the CLI command of a mainnet satchel", () => {
    const p = plan({ net: MAINNET, record: { evm: [evm(8453, 11)] }, nonces: [open(8453, 11, 0)], chains: [state(8453, 0)] });
    expect(text(p)).toContain("--as <you> --network mainnet: each send takes the next one");
  });

  it("never builds increaseAllowance or decreaseAllowance", () => {
    const p = plan({
      record: { evm: [evm(FUJI, 0)] },
      nonces: [spent(FUJI, 0)],
      rows: [{ row: row({ kind: "IncreaseAllowance", arg: word(5n) }), then: LIVE20, now: LIVE20 }],
      chains: [state(FUJI, 1)],
    });
    expect(actions(p)).toHaveLength(1);
    expect(actions(p)[0].data.slice(0, 10)).toBe("0x095ea7b3");
    for (const a of actions(p)) expect(["0x39509351", "0xa457c2d7"]).not.toContain(a.data.slice(0, 10));
  });
});

describe("readFixInputs", () => {
  it("reads the pending nonce, the balance and each approval at the latest block", async () => {
    const seen: { fn: string; block?: bigint; tag?: string }[] = [];
    fake.client = {
      getBlock: async () => ({ number: 500n, timestamp: 1_000n }),
      getTransactionCount: async (args: { blockTag?: string; blockNumber?: bigint }) => {
        seen.push({ fn: "nonce", block: args.blockNumber, tag: args.blockTag });
        return args.blockTag === "pending" ? 3 : 2;
      },
      getBalance: async (args: { blockNumber?: bigint }) => {
        seen.push({ fn: "balance", block: args.blockNumber });
        return 7n;
      },
      readContract: async (args: { functionName: string; blockNumber?: bigint }) => {
        seen.push({ fn: args.functionName, block: args.blockNumber });
        if (args.functionName === "allowance") return 9n;
        throw new Error("execution reverted");
      },
    } as unknown as PublicClient;
    const record: SigningRecord = { ...RECORD, evm: [evm(FUJI, 2)], approvals: [row()] };
    const report = { address: ADDRESS } as Parameters<typeof readFixInputs>[0];
    const inputs = await readFixInputs(report, record);
    expect(inputs.chains).toEqual([{ chainId: FUJI, pendingNonce: 3n, latestNonce: 2n, balance: 7n }]);
    expect(inputs.approvals).toEqual([{ live: true, detail: "allowance of 9 still granted", standard: "erc20" }]);
    expect(seen.filter((s) => s.tag !== "pending").every((s) => s.block === 500n)).toBe(true);
    expect(seen).toContainEqual({ fn: "nonce", block: undefined, tag: "pending" });
  });

  it("leaves a chain it can't read as null", async () => {
    fake.client = {
      getBlock: async () => {
        throw new Error("down");
      },
    } as unknown as PublicClient;
    const record: SigningRecord = { ...RECORD, evm: [evm(FUJI, 2)], approvals: [row()] };
    const inputs = await readFixInputs({ address: ADDRESS } as Parameters<typeof readFixInputs>[0], record);
    expect(inputs.chains).toEqual([{ chainId: FUJI, pendingNonce: null, latestNonce: null, balance: null }]);
    expect(inputs.approvals[0].live).toBeNull();
  });
});
