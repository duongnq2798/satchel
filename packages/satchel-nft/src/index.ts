// satchel-nft: the clean-transfer report and the transactions of Satchel, the NFT that is one
// wallet on 16 EVM chains. The web app at https://satchelnft.xyz and the `satchel-nft` CLI both
// run this code.
//
//   import { MAINNET, buildReport } from "satchel-nft";
//   const report = await buildReport(MAINNET, "1");
//   report?.verdict; // "clean", "not-provable" or "unknown"
export * from "./approvals.js";
export * from "./config.js";
export * from "./evm.js";
export * from "./guard.js";
export * from "./limit.js";
export * from "./near.js";
export * from "./report.js";
export * from "./satchel.js";
export * from "./send.js";
