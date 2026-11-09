// Prints the clean-transfer report for a token, read live from NEAR and each EVM chain in its
// record. No wallet and no keys: `npm run verify -- 1` on testnet, or
// `npm run verify -- --network mainnet 1`.
//
// The report is only as honest as the RPCs it reads. To read from nodes you trust instead of the
// public defaults, set NEAR_RPC=<url> and RPC_<chain id>=<url>, like RPC_11155111 for Sepolia.
import { CHAINS, NETWORKS } from "../src/lib/config";
import { nearChainId, nearRpcUrl, setNearRpc } from "../src/lib/near";
import { buildReport } from "../src/lib/report";
import { VERIFY_USAGE, parseVerifyArgs } from "../src/lib/verify-args";

const MARK = { pass: "PASS", fail: "FAIL", unknown: "????" } as const;

function applyRpcOverrides() {
  if (process.env.NEAR_RPC) setNearRpc(process.env.NEAR_RPC);
  for (const chain of CHAINS) {
    const url = process.env[`RPC_${chain.id}`];
    if (url) chain.rpc = url;
  }
}

// Exit codes go through process.exitCode: process.exit() with fetches still open aborts on Windows.
async function main(): Promise<number> {
  const args = parseVerifyArgs(process.argv.slice(2));
  if (args === null) {
    console.error(VERIFY_USAGE);
    return 2;
  }
  const net = NETWORKS[args.network];
  applyRpcOverrides();
  // An RPC for the other network would answer every read, about the wrong chain.
  const chain = await nearChainId(net);
  if (chain !== net.id) {
    console.error(`${nearRpcUrl(net)} serves NEAR ${chain}, not ${net.id}`);
    return 2;
  }
  const report = await buildReport(net, args.tokenId);
  if (report === null) {
    console.error(`No satchel #${args.tokenId} on ${net.contract}`);
    return 1;
  }
  console.log(`Satchel #${report.tokenId} on ${net.contract} (${net.id})`);
  console.log(`owner ${report.owner}, address ${report.address}, record version ${report.recordVersion}`);
  if (report.listing) console.log(`listed by ${report.listing.seller} at record version ${report.listing.record_version}`);
  for (const check of report.checks) {
    console.log(`\n[${MARK[check.status]}] ${check.title}`);
    for (const line of check.lines) console.log(`       ${line}`);
  }
  const verdicts = { clean: "PROVABLY CLEAN", "not-provable": "NOT PROVABLE", unknown: "COULD NOT CHECK EVERYTHING" };
  console.log(`\n${verdicts[report.verdict]} (checked ${report.checkedAt})`);
  console.log(`read from ${report.sources?.join(", ")}`);
  return report.verdict === "clean" ? 0 : 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 2;
  },
);
