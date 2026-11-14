import { readFileSync } from "node:fs";
import { getAddress } from "viem";
import { base, sepolia } from "viem/chains";
import { describe, expect, it } from "vitest";
import { LIVE, LIVE_ARCHIVAL, LIVE_EVM_RPC, type NetworkName, live, liveArchival, liveRpc, txProjection } from "./__fixtures__/live.js";
import derived from "./__fixtures__/derived-keys.json" with { type: "json" };
import { type OneCall, loadFixture } from "./__fixtures__/replay.js";
import { MPC_CONTRACTS, MPC_ROOT_KEYS, MPC_SIGN_DOMAINS, auditSignTx, crossCheckDerivation, proveEvmTx, proveRawTx, readOnlyEvmClient } from "./chain-signatures.js";
import { ENDPOINTS, type TxStatusView, blockAt, fastnearSenderLookup, pinnedReader, readTx } from "./near-rpc.js";

// chain-signatures against the real chains, through the public endpoints (each can be pointed
// elsewhere, see __fixtures__/live.ts), readOnlyRpc for NEAR and readOnlyEvmClient for EVM. Skipped
// unless SATCHEL_LIVE=1 (final blocks, regular RPC) or SATCHEL_LIVE_ARCHIVAL=1 (historical
// transactions, archival RPC):
//   SATCHEL_LIVE=1 npm test -w satchel-nft -- chain-signatures.live
//   SATCHEL_LIVE_ARCHIVAL=1 npm test -w satchel-nft -- chain-signatures.live
// The Sepolia proof needs a node that serves the receipt of 0x27e3…5ba3, so LIVE_EVM_RPC.sepolia
// defaults to sepolia.gateway.tenderly.co (SATCHEL_LIVE_SEPOLIA_RPC overrides it): on 2026-11-14
// config.ts's publicnode Sepolia node answered that transaction but a null receipt for it.

const deployment = (file: string) => JSON.parse(readFileSync(new URL(`../../../deployments/${file}`, import.meta.url), "utf8"));
const NET = { testnet: deployment("testnet.json"), mainnet: deployment("mainnet.json") } as { testnet: { contract: string }; mainnet: { contract: string } };
const E2E = deployment("testnet-e2e.json");
const DAO = deployment("testnet-dao.json");
const FIRST_SEND = deployment("mainnet-first-send.json");
const EXIT = deployment("mainnet-1click-exit.json");
const SALE = deployment("mainnet-sale.json");

/** tx-bench.testnet's ed25519 key for path "", as v1.signer-prod.testnet's derived_public_key gave it. */
const TX_BENCH_ED25519 = "ed25519:pJisEEQe9mw8Ew2faGNAHzu6wijjtUhjorKGReGTkpi";

const fixture = (name: string) => loadFixture<OneCall<TxStatusView>>(`primitives/chain-signatures/tx-${name}.json`);
const senders = { testnet: fastnearSenderLookup(ENDPOINTS.testnet.txApi), mainnet: fastnearSenderLookup(ENDPOINTS.mainnet.txApi) };
const audit = (network: NetworkName, hash: string) =>
  live(() =>
    auditSignTx(liveArchival(network), hash, { senderLookup: senders[network], mpcContract: MPC_CONTRACTS[network], rootKeys: MPC_ROOT_KEYS[network] }),
  );
const failing = (proof: { checks: { id: string; ok: boolean; detail: string }[] }) => proof.checks.filter((c) => !c.ok).map((c) => `${c.id}: ${c.detail}`);

describe.skipIf(!LIVE)("chain-signatures live, final blocks", () => {
  it("reads public_key for the signing domains 0, 1, 4 and 5 on both MPC contracts equal to MPC_ROOT_KEYS", async () => {
    for (const network of ["mainnet", "testnet"] as const) {
      const reader = await live(() => pinnedReader(liveRpc(network)));
      for (const domain of [0, 1, 4, 5] as const) {
        expect(await live(() => reader.view<string>(MPC_CONTRACTS[network], "public_key", { domain_id: domain }))).toBe(MPC_ROOT_KEYS[network][domain]);
      }
      console.log(`${network} root keys for domains 0, 1, 4, 5 equal MPC_ROOT_KEYS at block ${reader.block.height} (${reader.block.hash})`);
    }
  });

  it("finds in each MPC contract's state() exactly the signing domains MPC_SIGN_DOMAINS lists, each key on its curve", async () => {
    // Only the domain list is read out of state(); the rest (the participants) is not printed.
    const domainsOf = (state: unknown): { id: number; purpose?: unknown }[] | null => {
      if (typeof state !== "object" || state === null) return null;
      const own = (state as { domains?: unknown }).domains;
      if (Array.isArray(own) && own.every((d) => typeof (d as { id?: unknown })?.id === "number")) return own as { id: number }[];
      for (const value of Object.values(state)) {
        const found = domainsOf(value);
        if (found) return found;
      }
      return null;
    };
    for (const network of ["mainnet", "testnet"] as const) {
      const reader = await live(() => pinnedReader(liveRpc(network)));
      const domains = domainsOf(await live(() => reader.view<unknown>(MPC_CONTRACTS[network], "state")));
      expect(domains).not.toBeNull();
      const sign = (domains ?? []).filter((d) => d.purpose === "Sign").map((d) => d.id);
      expect(sign.map(String)).toEqual(Object.keys(MPC_SIGN_DOMAINS));
      for (const id of sign) expect(MPC_ROOT_KEYS[network][id as 0 | 1 | 4 | 5].startsWith(`${MPC_SIGN_DOMAINS[id]}:`)).toBe(true);
      const list = (domains ?? []).map((d) => JSON.stringify(d)).join(" ");
      console.log(`${network} ${MPC_CONTRACTS[network]} state() domains at block ${reader.block.height} (${reader.block.hash}): ${list}`);
    }
  });

  it("derives satchel/1-8 (domain 0) and tx-bench.testnet's \"\" (domain 1) as v1.signer-prod.testnet's derived_public_key does", async () => {
    const cases = [
      ...Array.from({ length: 8 }, (_, i) => ({ predecessor: NET.testnet.contract, path: `satchel/${i + 1}`, domain: 0 as const })),
      { predecessor: "tx-bench.testnet", path: "", domain: 1 as const },
    ];
    const check = await live(() => crossCheckDerivation(liveRpc("testnet"), MPC_CONTRACTS.testnet, cases));
    expect(check.results.map((r) => `${r.path} ${r.domain} ${r.match}`)).toEqual(cases.map((c) => `${c.path} ${c.domain} true`));
    expect(check.results[0].contract).toBe(derived.testnet.keys["satchel/1"]);
    expect(check.results[8].contract).toBe(TX_BENCH_ED25519);
    expect(check.rootKeys).toEqual({ 0: MPC_ROOT_KEYS.testnet[0], 1: MPC_ROOT_KEYS.testnet[1] });
    console.log(`testnet derivation matches the contract at block ${check.block.height} (${check.block.hash})`);
  });

  it("derives satchel/1 in domains 4 and 5 on both networks, and tx-bench.testnet's \"\" on testnet, as each derived_public_key does", async () => {
    for (const network of ["mainnet", "testnet"] as const) {
      const cases = [
        { predecessor: NET[network].contract, path: "satchel/1", domain: 4 },
        { predecessor: NET[network].contract, path: "satchel/1", domain: 5 },
        ...(network === "testnet"
          ? [
              { predecessor: "tx-bench.testnet", path: "", domain: 4 },
              { predecessor: "tx-bench.testnet", path: "", domain: 5 },
            ]
          : []),
      ];
      const check = await live(() => crossCheckDerivation(liveRpc(network), MPC_CONTRACTS[network], cases));
      expect(check.results.map((r) => `${r.path} ${r.domain} ${r.match}`)).toEqual(cases.map((c) => `${c.path} ${c.domain} true`));
      expect(check.rootKeys).toEqual({ 4: MPC_ROOT_KEYS[network][4], 5: MPC_ROOT_KEYS[network][5] });
      console.log(`${network} domain 4 and 5 derivation matches the contract at block ${check.block.height} (${check.block.hash})`);
    }
  });
});

describe.skipIf(!LIVE_ARCHIVAL)("chain-signatures live, historical transactions", () => {
  it("audits testnet EZLX…: one signed domain-0 request by the Satchel contract for satchel/1, verified, and its raw Sepolia transaction proven", async () => {
    const result = await audit("testnet", E2E.steps[1].tx);
    expect(result.verdict).toBe("all-verified");
    expect(result.requests).toHaveLength(1);
    const [request] = result.requests;
    expect(request.request).toMatchObject({ domain: 0, predecessor: NET.testnet.contract, path: "satchel/1" });
    expect(request.status).toBe("signed");
    expect(request.verify?.ok).toBe(true);
    expect(request.evmAddress).toBe(E2E.steps[1].recovered);
    const proof = proveRawTx({ audit: result, raw: E2E.steps[2].raw, expectedChainId: 11155111 });
    expect(failing(proof)).toEqual([]);
    expect(proof.verdict).toBe("proven");
  });

  it("audits testnet 2ryQps…, the DAO vote, and proves its Sepolia transaction", async () => {
    const result = await audit("testnet", DAO.steps[5].tx);
    expect(result.signerId).toBe("satchel-nft.testnet");
    expect(result.verdict).toBe("all-verified");
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0].request.receiptId).toBe("FWa3axK2KxKWq2tf1YpNNLNeb8QPf8dayhbBhZSJpDYv");
    expect(result.requests[0].callback?.receiptId).toBe("5Y8LFFZm63VdfMLWumJxA4eZ55dzdCEWNXc5rvGBxP4a");
    expect(result.requests[0].verify?.ok).toBe(true);
    const client = readOnlyEvmClient(sepolia, LIVE_EVM_RPC.sepolia);
    const proof = await proveEvmTx({ audit: result, client, hash: DAO.steps[7].sepolia.tx, expectedChainId: 11155111 });
    expect(failing(proof)).toEqual([]);
    expect(proof.verdict).toBe("proven");
    expect(proof.evm).toMatchObject({ nonce: 0, blockNumber: DAO.steps[7].sepolia.block, status: "success" });
  });

  it("audits testnet FgbW…: tx-bench.testnet's ed25519 request with the empty path, verified", async () => {
    const result = await audit("testnet", "FgbWCHbK6AAYAJ31tBNZHph3M7V3Ltt4aGrX7mvGtKWm");
    expect(result.verdict).toBe("all-verified");
    const [request] = result.requests;
    expect(request.request).toMatchObject({
      domain: 1,
      predecessor: "tx-bench.testnet",
      path: "",
      payload: { kind: "eddsa", hex: "7e2b493e288257e87e31b17500f513fb59c1c4a5f61cd08ba57759dacdbd4829" },
    });
    expect(request.derivedKey).toBe(TX_BENCH_ED25519);
    expect(request.verify).toEqual({ ok: true, reason: "ok" });
  });

  it("proves mainnet satchel #1's Base send (2xqwe8… and 0x8044…9532) and satchel #2's 1Click deposit (FnFSMSh1… and 0x2d9b…7d74)", async () => {
    const client = readOnlyEvmClient(base, LIVE_EVM_RPC.base);
    const first = await audit("mainnet", FIRST_SEND.nearTx);
    expect(first.verdict).toBe("all-verified");
    const sent = await proveEvmTx({ audit: first, client, hash: FIRST_SEND.baseTx, expectedChainId: 8453 });
    expect(failing(sent)).toEqual([]);
    expect(sent.verdict).toBe("proven");
    expect(sent.evm).toMatchObject({ from: getAddress(FIRST_SEND.address), nonce: 0, blockNumber: FIRST_SEND.block });

    const exit = await audit("mainnet", EXIT.deposit.nearTx);
    expect(exit.verdict).toBe("all-verified");
    const deposit = await proveEvmTx({ audit: exit, client, hash: EXIT.deposit.tx, expectedChainId: 8453 });
    expect(failing(deposit)).toEqual([]);
    expect(deposit.verdict).toBe("proven");
    expect(deposit.evm).toMatchObject({ from: getAddress(EXIT.address), blockNumber: EXIT.deposit.block });
  });

  it("finds no requests in the refused sign_evm calls, testnet GqFsnm… and mainnet 33UTwy…", async () => {
    for (const [network, hash] of [
      ["testnet", E2E.steps[4].tx],
      ["mainnet", SALE.refused.tx],
    ] as const) {
      const result = await audit(network, hash);
      expect(result.requests).toHaveLength(0);
      expect(result.verdict).toBe("no-requests");
    }
  });

  it("re-reads every recorded transaction with the receipts its fixture holds", async () => {
    const recorded = [
      ["testnet", "EZLX"],
      ["testnet", "2ryQps"],
      ["testnet", "GqFsnm"],
      ["testnet", "FgbW"],
      ["testnet", "9FsA"],
      ["testnet", "HthQSVE"],
      ["mainnet", "2xqwe8"],
      ["mainnet", "FnFSMSh1"],
      ["mainnet", "33UTwy"],
    ] as const;
    for (const [network, name] of recorded) {
      const { result } = fixture(name);
      const tx = await live(() => readTx(liveArchival(network), result.transaction.hash, { senderLookup: senders[network] }));
      expect(txProjection(tx), name).toEqual(txProjection(result));
      // The block that included it is still the recorded one.
      expect((await live(() => blockAt(liveArchival(network), { blockHash: tx.transaction_outcome.block_hash }))).hash).toBe(
        result.transaction_outcome.block_hash,
      );
    }
  });
});
