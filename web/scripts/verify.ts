// Prints the clean-transfer report for a token, read live from NEAR testnet and each EVM chain in
// its record. No wallet and no keys: `npm run verify -- 1`.
import { NETWORK } from "../src/lib/config";
import { buildReport } from "../src/lib/report";

const MARK = { pass: "PASS", fail: "FAIL", unknown: "????" } as const;

async function main() {
  const tokenId = process.argv[2];
  if (!tokenId) {
    console.error("usage: npm run verify -- <token_id>");
    process.exit(2);
  }
  const report = await buildReport(tokenId);
  if (report === null) {
    console.error(`No satchel #${tokenId} on ${NETWORK.contract}`);
    process.exit(1);
  }
  console.log(`Satchel #${report.tokenId} on ${NETWORK.contract} (${NETWORK.id})`);
  console.log(`owner ${report.owner}, address ${report.address}, record version ${report.recordVersion}`);
  if (report.listing) console.log(`listed by ${report.listing.seller} at record version ${report.listing.record_version}`);
  for (const check of report.checks) {
    console.log(`\n[${MARK[check.status]}] ${check.title}`);
    for (const line of check.lines) console.log(`       ${line}`);
  }
  const verdicts = { clean: "PROVABLY CLEAN", "not-provable": "NOT PROVABLE", unknown: "COULD NOT CHECK EVERYTHING" };
  console.log(`\n${verdicts[report.verdict]} (checked ${report.checkedAt})`);
  process.exit(report.verdict === "clean" ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(2);
});
