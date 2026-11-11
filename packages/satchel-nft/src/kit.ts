import { NETWORKS, chainInfo, sendChains } from "./config.js";
import type { Check, Report, Status } from "./report.js";

/**
 * The handover kit: what a satchel's holder does before a sale, from its clean transfer report.
 * One step per check that fails or could not be read, saying what it means and how to fix it with
 * what the app and the CLI really do; one step when every check passes.
 */
export type KitAction =
  /** Something the holder can do now. */
  | "fix"
  /** Nothing to do but check again later. */
  | "wait"
  /** It can't be undone: tell the buyer. */
  | "disclose"
  /** Not the holder's to fix. */
  | "not-yours"
  /** Every check passes. */
  | "list";

export interface KitStep {
  /** The check the step is about; null for the step of a satchel that reads clean. */
  check: Check["id"] | null;
  action: KitAction;
  title: string;
  /** What the check found, in the report's own lines. */
  found: string[];
  means: string;
  /** What to do, in order. */
  todo: string[];
  /** The docs section with the details, a path on satchelnft.xyz. */
  docs?: string;
}

/** The chains of `check`'s lines that read `status`, each once. */
function chainsWith(check: Check, status: Status): number[] {
  return [...new Set((check.chains ?? []).filter((c) => c.status === status).map((c) => c.chainId))];
}

function named(chainIds: number[]): string {
  return chainIds.map((id) => `${chainInfo(id)?.name ?? "chain"} (${id})`).join(", ");
}

/** `report` as `buildReport` or `assemble` make it: the kit reads the chains of checks 2 and 3. */
export function handoverKit(report: Report): KitStep[] {
  const id = report.tokenId;
  const mainnet = report.network === "mainnet";
  const page = `${mainnet ? "/mainnet" : ""}/satchel/${id}`;
  const cli = (command: string) => `npx -y satchel-nft@0.2.0 ${command}${mainnet ? " --network mainnet" : ""}`;
  // The page's "Make it clean" card, under the report, has a button for each fix the kit names.
  const card = `Make it clean, under the report on ${page}`;
  const verify = cli(`verify ${id}`);
  // The app and the CLI check the deployment before every transaction (assertDeployment), delisting
  // included: while check 1 fails, they sign nothing, so no step can send a fix.
  const canSign = report.checks.find((c) => c.id === "contract")?.status === "pass";
  // They send only on the chains of the satchel's own network. A record can name others: the
  // contract signs for all 16 on either network when someone calls sign_evm directly.
  const own = sendChains(NETWORKS[report.network]);
  const sendable = (chainId: number) => own.some((c) => c.id === chainId);
  // A listed satchel can't sign, so every fix that sends starts by delisting.
  const delist = report.listing
    ? [`Delist it first, with Delist on ${page} or ${cli(`delist ${id} --as <you>`)}: a listed satchel can't sign.`]
    : [];
  const elsewhere = (chainIds: number[], what: string) =>
    `The app and the CLI don't send on ${named(chainIds)} from a ${report.network} satchel: they send only on the ${own.length} ${mainnet ? "mainnets" : "testnets"}. To ${what} there, call sign_evm yourself with the near CLI, then add the signature and broadcast the transaction, as /docs/developers/contract#sign_evm shows. Or tell the buyer: the report shows it until then.`;
  const unreadNow = (chainIds: number[]) =>
    `${named(chainIds)} couldn't be read. Check again in a few minutes, or read it from a node you trust: RPC_<chain id>=<url> ${verify}`;
  // A pending chain reads unknown when its RPC didn't answer or when its latest send isn't final yet
  // (pendingCheck); the check's chains don't say which, so the step names both.
  const unconfirmed = (chainIds: number[]) =>
    `${named(chainIds)} couldn't be confirmed yet: a transaction there may not be final, or its RPC didn't answer. Check again in a few minutes; if it stays this way, read it from a node you trust: RPC_<chain id>=<url> ${verify}`;
  const notAToken =
    "If an approval keeps saying it could not read from an RPC you trust, the contract it names may not be a token (an approval sent to a wallet address, say). Nothing reads that row, so the satchel can't read clean: tell the buyer.";
  const unread = (check: Check, means: string, more: string[] = []): KitStep => ({
    check: check.id,
    action: "wait",
    title: check.title,
    found: check.lines,
    means,
    todo: [
      "Check again in a few minutes: a block can take a while to be finalized (about 13 minutes on Sepolia).",
      `If a chain stays unreadable, its public RPC may be down. Read it from a node you trust: RPC_<chain id>=<url> ${verify}`,
      ...more,
    ],
  });
  const blocked = (check: Check, means: string): KitStep => ({
    check: check.id,
    action: "not-yours",
    title: check.title,
    found: check.lines,
    means,
    todo: [
      "While check 1 fails, the app and the CLI sign nothing: they check the deployment before every transaction, delisting included. So neither can send this fix.",
      "Don't offer the satchel as clean. Once check 1 passes, check again: this step then says how to fix it.",
    ],
    docs: "/docs/concepts/clean-transfer-report",
  });

  const steps: KitStep[] = [];
  for (const check of report.checks) {
    if (check.status === "pass") continue;
    const found = check.lines;
    const open = chainsWith(check, "fail");
    const here = open.filter(sendable);
    const away = open.filter((c) => !sendable(c));
    const unknown = chainsWith(check, "unknown");
    switch (check.id) {
      case "contract":
        steps.push({
          check: check.id,
          action: "not-yours",
          title: "The contract fails its own check: not yours to fix",
          found,
          means:
            "Check 1 is about the deployment, not this satchel: the contract account has a key, runs code that isn't the reproducible build, or signs through another MPC contract. While it fails, no satchel on it can read clean.",
          todo: [
            "Nothing you do with the satchel changes this. Don't offer it as clean.",
            `A NEAR RPC that lies about the contract fails this check too, so run NEAR_RPC=<url> ${verify} against a node you trust before you decide anything.`,
          ],
          docs: "/docs/concepts/clean-transfer-report",
        });
        break;
      case "pending": {
        if (check.status === "unknown") {
          steps.push(
            unread(
              check,
              "The report couldn't confirm every signed nonce is spent: a transaction is in a block that isn't finalized yet, or a chain's RPC didn't answer.",
            ),
          );
          break;
        }
        const means =
          "The satchel signed a transaction whose nonce isn't spent at a finalized block. Its signature is public in the NEAR receipt, so anyone can still broadcast it, after the sale too. A buyer can't rule out that it empties the address.";
        if (!canSign) {
          steps.push(blocked(check, means));
          break;
        }
        steps.push({
          check: check.id,
          action: "fix",
          title: "Spend every signed nonce",
          found,
          means,
          todo: [
            ...delist,
            ...(here.length > 0
              ? [
                  `On ${named(here)}, click Spend nonce in ${card}: each one sends 0 to the satchel's own address, and the card counts how many each chain needs. From a terminal, ${cli(`send ${id} --chain <chain> --to ${report.address} --value 0 --as <you>`)} sends the same. Each send needs gas on that chain, but the transaction signed at each open nonce is public: once the address can pay for it, anyone can broadcast it before your send. History on ${page} lists what each one sends. Fund only what the sends need, and send them right after.`,
                  "Neither the app nor the CLI lets you type a nonce: each send takes the address's next unspent one, and a revoke on the same chain spends one too. The card offers a Spend nonce for each open nonce its revokes don't spend; with the CLI, send once for each nonce from the next unspent one up to the highest signed one.",
                ]
              : []),
            ...(away.length > 0 ? [elsewhere(away, "spend each open nonce")] : []),
            ...(unknown.length > 0 ? [unconfirmed(unknown)] : []),
            "Wait until the last send's block is finalized, then check again.",
          ],
          docs: "/docs/guides/sell#spend-every-signed-nonce",
        });
        break;
      }
      case "approvals": {
        if (check.status === "unknown") {
          steps.push(
            unread(
              check,
              "The report couldn't read every approval on chain: a chain's RPC didn't answer or answered for another chain, or the contract an approval names doesn't answer the call that reads it.",
              [notAToken],
            ),
          );
          break;
        }
        const means =
          "An approval the satchel signed still lets its spender move the address's tokens. After a sale, the spender could take them from the buyer.";
        if (!canSign) {
          steps.push(blocked(check, means));
          break;
        }
        steps.push({
          check: check.id,
          action: "fix",
          title: "Revoke every live approval",
          found,
          means,
          todo: [
            ...delist,
            ...(here.length > 0
              ? [
                  `For each live approval above on ${named(here)}, click Revoke in ${card}: it builds the revoking call, shows its calldata, and sends it through the same checks and wallet prompt as Send from this satchel. From a terminal, send that calldata to the contract the approval names with ${cli(`send ${id} --chain <chain> --to <contract> --value 0 --data <calldata> --as <you>`)}: the CLI has no revoke command, so you give it the calldata.`,
                ]
              : []),
            `The lines above shorten addresses. Each approval's full contract, spender and, for Permit2, token are under Raw record in the Signing record on ${page}, or in ${cli(`record ${id}`)}.`,
            "ERC-20 approve or increaseAllowance: approve(spender, 0). ERC-721 approve: approve(0x0000000000000000000000000000000000000000, tokenId). setApprovalForAll: setApprovalForAll(operator, false). Permit2: approve(token, spender, 0, 0), sent to Permit2.",
            "Not increaseAllowance(spender, 0), which changes nothing on chain, and not decreaseAllowance, a call the contract can't classify: that makes the satchel not provable for good.",
            "Each approve revoke, approve(spender, 0) or approve(0x0000…0000, tokenId), is itemized as a new row and takes one of the 32 slots. Once all 32 are full it is counted instead, and check 4 fails for good. The card shows the slot each revoke takes, and won't send one that would be the 33rd while check 4 passes.",
            ...(away.length > 0 ? [elsewhere(away, "revoke an approval")] : []),
            ...(unknown.length > 0 ? [unreadNow(unknown), notAToken] : []),
            "Wait until the revoke's block is finalized, then check again.",
          ],
          docs: "/docs/guides/sell#revoke-every-approval",
        });
        break;
      }
      case "counters":
        steps.push({
          check: check.id,
          action: "disclose",
          title: "Tell the buyer: this satchel can't read clean",
          found,
          means:
            "The record counts something the contract can't explain: a raw signature, a call it couldn't classify, or an approval past the 32nd. No one can rule out what these left behind.",
          todo: [
            "Nothing undoes it. The counters only grow, so the satchel stays not provable for you and for every later owner.",
            "Tell a buyer before they pay. Their report shows the same lines, the app has them tick a box to buy it anyway, and satchel-nft buy refuses it without --accept-not-clean.",
          ],
          docs: "/docs/guides/sell#get-the-report-to-read-clean",
        });
        break;
    }
  }
  if (steps.length > 0) return steps;

  return [
    {
      check: null,
      action: "list",
      title: "The satchel reads clean",
      found: [],
      means: "All four checks pass: every nonce it signed is spent, every approval is revoked, and nothing it signed is unexplained.",
      todo: [
        report.listing
          ? `It is listed at record version ${report.listing.record_version}. Signing stays frozen until it sells or you delist it.`
          : `List it, with List for sale on ${page} or ${cli(`list ${id} <price> --as <you>`)}. Listing freezes signing and pins record version ${report.recordVersion}, the one a buyer checks.`,
        "Check again after any new signature. Each one raises the record version, and a purchase that names the old version is refused.",
      ],
      docs: "/docs/guides/sell#list-it",
    },
  ];
}
