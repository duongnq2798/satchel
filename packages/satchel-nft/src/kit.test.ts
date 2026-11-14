import { describe, expect, it } from "vitest";
import { MAINNET, type Network, TESTNET } from "./config.js";
import { handoverKit } from "./kit.js";
import type { ApprovalRecord, SatchelView, SigningRecord } from "./near.js";
import { type ApprovalState, type ChainNonce, type ContractFacts, assemble } from "./report.js";

const RECORD: SigningRecord = {
  evm: [],
  approvals: [],
  approvals_not_itemized: 0,
  unclassified_calls: 0,
  opaque_signatures: 0,
  last_opaque_at: "0",
  version: "3",
};

const ROW: ApprovalRecord = {
  chain_id: "11155111",
  contract: "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238",
  kind: "Approve",
  spender: "0x000000000022d473030f116ddee9f6b43ac78ba3",
  token: null,
  arg: `0x${"f".repeat(64)}`,
};

interface Setup {
  net?: Network;
  facts?: Partial<ContractFacts>;
  record?: Partial<SigningRecord>;
  nonces?: ChainNonce[];
  approvals?: ApprovalState[];
  listed?: boolean;
}

/** A report as `buildReport` assembles it, from the same pure checks, for satchel #4. */
function report({ net = TESTNET, facts, record, nonces = [], approvals = [], listed = false }: Setup = {}) {
  const view: SatchelView = {
    token_id: "4",
    owner_id: "holder.testnet",
    path: "satchel/4",
    record: { ...RECORD, ...record },
    listing: listed ? { seller: "holder.testnet", price: "1", record_version: "3", listed_at: "0" } : null,
  };
  const locked: ContractFacts = { accessKeys: 0, account: { code_hash: net.build.codeHash }, mpcContract: net.mpc, ...facts };
  return assemble({ net, view, address: "0x0000000000000000000000000000000000000001", facts: locked, nonces, approvals });
}

const open: ChainNonce = { chainId: 11155111, maxNonce: 4n, finalizedNonce: 2n, latestNonce: 2n, blockNumber: 1n };

describe("handoverKit", () => {
  it("has one step when every check passes: list it, and check again after any signature", () => {
    const steps = handoverKit(report());
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ check: null, action: "list", title: "The satchel reads clean" });
    expect(steps[0].todo[0]).toContain("pins record version 3");
    expect(steps[0].todo[0]).toContain("npx -y satchel-nft@0.3.0 list 4 <price> --as <you>");
    expect(steps[0].todo[1]).toMatch(/after any new signature/);
    // Already listed: nothing to list, signing is frozen.
    expect(handoverKit(report({ listed: true }))[0].todo[0]).toMatch(/listed at record version 3/);
  });

  it("says the contract check is not the holder's to fix", () => {
    const steps = handoverKit(report({ facts: { accessKeys: 1 } }));
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ check: "contract", action: "not-yours" });
    expect(steps[0].found).toContain("1 access key(s) on v1.satchel-nft.testnet: whoever holds one can sign around the record");
    expect(steps[0].todo.join(" ")).toMatch(/Nothing you do with the satchel changes this/);
  });

  it("spends an open nonce with the card's buttons or the CLI, one per open nonce, delisting first when listed", () => {
    const [step] = handoverKit(report({ nonces: [open], record: { evm: [{ chain_id: "11155111", max_nonce: "4", signatures: 3 }] } }));
    expect(step).toMatchObject({ check: "pending", action: "fix", docs: "/docs/guides/sell#spend-every-signed-nonce" });
    expect(step.found[0]).toMatch(/^Sepolia: signed up to nonce 4, finalized nonce is 2/);
    const todo = step.todo.join("\n");
    expect(step.todo[0]).toMatch(/^On Sepolia \(11155111\), click Spend nonce in Make it clean/);
    expect(todo).toContain("Make it clean, under the report on /satchel/4");
    expect(todo).toContain("npx -y satchel-nft@0.3.0 send 4 --chain <chain> --to 0x0000000000000000000000000000000000000001 --value 0 --as <you>");
    expect(todo).toMatch(/Neither the app nor the CLI lets you type a nonce/);
    expect(todo).toMatch(/a revoke on the same chain spends one too/);
    expect(todo).toMatch(/send once for each nonce/);
    // Funding the address lets anyone land what was signed at an open nonce first.
    expect(todo).toContain(
      "the transaction signed at each open nonce is public: once the address can pay for it, anyone can broadcast it before your send. History on /satchel/4 lists what each one sends.",
    );
    expect(todo).not.toMatch(/Delist/);
    expect(handoverKit(report({ nonces: [open], listed: true }))[0].todo[0]).toMatch(/^Delist it first/);
  });

  it("names only the chains whose nonce is open, and says which couldn't be confirmed", () => {
    const spent: ChainNonce = { ...open, maxNonce: 0n, finalizedNonce: 1n };
    const unread: ChainNonce = { ...open, chainId: 421614, finalizedNonce: null, latestNonce: null };
    const [step] = handoverKit(report({ nonces: [spent, { ...open, chainId: 84532 }, unread] }));
    expect(step).toMatchObject({ check: "pending", action: "fix" });
    expect(step.found).toHaveLength(3);
    expect(step.todo[0]).toMatch(/^On Base Sepolia \(84532\), click Spend nonce/);
    expect(step.todo.join("\n")).not.toMatch(/Sepolia \(11155111\)/);
    expect(step.todo).toContain(
      "Arbitrum Sepolia (421614) couldn't be confirmed yet: a transaction there may not be final, or its RPC didn't answer. Check again in a few minutes; if it stays this way, read it from a node you trust: RPC_<chain id>=<url> npx -y satchel-nft@0.3.0 verify 4",
    );
  });

  it("doesn't say a chain whose latest send isn't final yet couldn't be read", () => {
    // Read fine: its latest block is past the signed nonce, its finalized block not yet.
    const notFinal: ChainNonce = { ...open, chainId: 84532, maxNonce: 4n, finalizedNonce: 3n, latestNonce: 5n };
    const [step] = handoverKit(report({ nonces: [open, notFinal] }));
    expect(step).toMatchObject({ check: "pending", action: "fix" });
    expect(step.found[1]).toBe(
      "Base Sepolia: signed up to nonce 4; a transaction at that nonce is in a recent block that is not finalized yet. Check again once it is",
    );
    expect(step.todo[0]).toMatch(/^On Sepolia \(11155111\), click Spend nonce/);
    const todo = step.todo.join("\n");
    expect(todo).toContain("Base Sepolia (84532) couldn't be confirmed yet: a transaction there may not be final");
    expect(todo).not.toMatch(/couldn't be read/);
  });

  it("says plainly that the app and the CLI don't send on a chain of the other network", () => {
    // The testnet contract signs for chain 1 too, when someone calls sign_evm directly.
    const ethereum: ChainNonce = { ...open, chainId: 1, maxNonce: 3n, finalizedNonce: 0n, latestNonce: 0n };
    const steps = handoverKit(
      report({
        nonces: [{ ...open, maxNonce: 0n, finalizedNonce: 1n }, ethereum],
        approvals: [{ row: { ...ROW, chain_id: "1" }, liveness: { live: true, detail: "allowance of 5 still granted" } }],
      }),
    );
    expect(steps.map((s) => [s.check, s.action])).toEqual([
      ["pending", "fix"],
      ["approvals", "fix"],
    ]);
    for (const step of steps) {
      const todo = step.todo.join("\n");
      expect(todo).toMatch(/The app and the CLI don't send on Ethereum \(1\) from a testnet satchel: they send only on the 8 testnets/);
      expect(todo).toMatch(/call sign_evm yourself with the near CLI/);
      expect(todo).not.toMatch(/On Ethereum|Make it clean|For each live approval above on/);
    }
  });

  it("gives no fix while the contract fails its check, since the app and the CLI then sign nothing", () => {
    const live: ApprovalState = { row: ROW, liveness: { live: true, detail: "allowance of 5 still granted" } };
    const steps = handoverKit(report({ facts: { accessKeys: 1 }, nonces: [open], approvals: [live], listed: true }));
    expect(steps.map((s) => [s.check, s.action])).toEqual([
      ["contract", "not-yours"],
      ["pending", "not-yours"],
      ["approvals", "not-yours"],
    ]);
    for (const step of steps.slice(1)) {
      const todo = step.todo.join("\n");
      expect(todo).toMatch(/While check 1 fails, the app and the CLI sign nothing/);
      expect(todo).not.toMatch(/Delist|Make it clean|satchel-nft@0\.2\.0 send/);
    }
  });

  it("revokes a live approval with the card's Revoke button, or with calldata given to the CLI", () => {
    const [step] = handoverKit(report({ approvals: [{ row: ROW, liveness: { live: true, detail: "allowance of 5 still granted" } }] }));
    expect(step).toMatchObject({ check: "approvals", action: "fix", docs: "/docs/guides/sell#revoke-every-approval" });
    expect(step.found).toEqual(["Sepolia: Approve on 0x1c7d…7238 for 0x0000…8ba3: allowance of 5 still granted"]);
    const todo = step.todo.join("\n");
    expect(step.todo[0]).toMatch(/^For each live approval above on Sepolia \(11155111\), click Revoke in Make it clean, under the report on \/satchel\/4/);
    expect(todo).not.toContain("There is no revoke button");
    expect(todo).toContain("npx -y satchel-nft@0.3.0 send 4 --chain <chain> --to <contract> --value 0 --data <calldata> --as <you>");
    expect(todo).toContain("the CLI has no revoke command, so you give it the calldata");
    expect(todo).toContain("approve(spender, 0)");
    expect(todo).toContain("won't send one that would be the 33rd");
    expect(todo).toContain("setApprovalForAll(operator, false)");
    // The found lines shorten addresses: the kit says where the full ones are.
    expect(todo).toContain("under Raw record in the Signing record on /satchel/4, or in npx -y satchel-nft@0.3.0 record 4.");
    // An ERC-721 revoke takes a slot too.
    expect(todo).toContain("Each approve revoke, approve(spender, 0) or approve(0x0000…0000, tokenId), is itemized as a new row and takes one of the 32 slots");
  });

  it("can't undo a counter: the satchel stays not provable for every later owner, so tell the buyer", () => {
    const steps = handoverKit(report({ record: { opaque_signatures: 1, unclassified_calls: 2 } }));
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ check: "counters", action: "disclose" });
    expect(steps[0].found).toHaveLength(2);
    expect(steps[0].todo.join(" ")).toMatch(/Nothing undoes it.*not provable for you and for every later owner/);
    expect(steps[0].todo.join(" ")).toMatch(/Tell a buyer before they pay/);
  });

  it("waits and checks again when a check couldn't be read, with the CLI for the satchel's network", () => {
    const steps = handoverKit(
      report({
        net: MAINNET,
        nonces: [{ ...open, chainId: 8453, finalizedNonce: null, latestNonce: null }],
        approvals: [{ row: { ...ROW, chain_id: "8453" }, liveness: { live: null, detail: "could not read allowance or getApproved" } }],
      }),
    );
    expect(steps.map((s) => [s.check, s.action])).toEqual([
      ["pending", "wait"],
      ["approvals", "wait"],
    ]);
    expect(steps[0].found).toEqual(["Base: could not read the nonce at a finalized block"]);
    expect(steps[0].todo[1]).toContain("RPC_<chain id>=<url> npx -y satchel-nft@0.3.0 verify 4 --network mainnet");
    // An approval on a contract that isn't a token never reads, whatever the RPC.
    expect(steps[1].means).toMatch(/doesn't answer the call that reads it/);
    expect(steps[1].todo.join(" ")).toMatch(/may not be a token.*tell the buyer/);
  });

  it("lists one step per check that isn't passing, in the report's order", () => {
    const steps = handoverKit(
      report({
        facts: { mpcContract: "evil-signer.testnet" },
        nonces: [open],
        approvals: [{ row: ROW, liveness: { live: true, detail: "operator still approved" } }],
        record: { approvals_not_itemized: 1 },
      }),
    );
    expect(steps.map((s) => s.check)).toEqual(["contract", "pending", "approvals", "counters"]);
    // While the contract fails, nothing can be signed, so no step is a fix.
    expect(steps.map((s) => s.action)).toEqual(["not-yours", "not-yours", "not-yours", "disclose"]);
    expect(steps.every((s) => s.means.length > 0 && s.todo.length > 0)).toBe(true);
  });
});
