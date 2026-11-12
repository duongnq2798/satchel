"use client";

import Link from "next/link";
import { Component, type ReactNode } from "react";
import {
  CHAINS,
  type DaoBounty,
  type DaoBountyClaim,
  type DaoPolicy,
  type DaoProposal,
  type Network,
  accountTransactions,
  limiter,
  nearAccountUrl,
  nearRpcUrl,
  nearTxUrl,
  satchel,
  sputnikDao,
  view,
} from "satchel-nft";
import {
  type ApprovalTier,
  type DaoActivity,
  type DaoIndexedTx,
  type FtMeta,
  type ProposalTxs,
  approvalTiers,
  claimCandidates,
  contributorRecords,
  daoActivity,
  duration,
  finishedBounties,
  isDaoPolicy,
  lapsed,
  nsToMs,
  openBounties,
  roleSummaries,
  satchelSignings,
  tokenAmount,
  tokensIn,
  utc,
} from "@/lib/dao-board";
import { appPath } from "@/lib/routes";
import { useNetwork } from "./network";
import { Badge, Button, Card, ErrorNote, ExternalLink, Mono, Placeholder, errorMessage } from "./ui";
import { useAsync } from "./use-async";

/** The newest proposals and transactions the board reads: enough for a community's board, few enough for a public RPC. */
const MAX_PROPOSALS = 1000;
const MAX_TXS = 1000;
/** The most accounts whose claims it asks the DAO for. */
const MAX_CLAIMERS = 200;

const STATUS: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "plain" }> = {
  InProgress: { label: "Open for votes", tone: "plain" },
  Approved: { label: "Approved", tone: "ok" },
  Rejected: { label: "Rejected", tone: "bad" },
  Removed: { label: "Removed", tone: "bad" },
  Expired: { label: "Expired", tone: "warn" },
  Moved: { label: "Moved", tone: "plain" },
  Failed: { label: "Failed", tone: "bad" },
};

const linkClass = "underline decoration-line underline-offset-4 hover:decoration-ink";

async function readDao(net: Network, daoId: string) {
  const dao = sputnikDao(net, daoId);
  const [config, policy, version] = await Promise.all([dao.config(), dao.policy(), dao.version().catch(() => null)]);
  if (!isDaoPolicy(policy)) throw new Error(`${daoId} answered get_policy, but not with a Sputnik DAO's policy`);
  // The page shows only text from the config and the version: anything else in their place shows as nothing.
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  return { config: { name: text(config?.name), purpose: text(config?.purpose) }, policy, version: text(version) || null };
}

/** `shape()`, or `fallback` when an odd answer makes it throw: these run in the board itself, outside every card's boundary. */
function orElse<T>(shape: () => T, fallback: T): T {
  try {
    return shape();
  } catch {
    return fallback;
  }
}

/** Every bounty, and the claim count of each one with times left: only those can be claimed. A count that fails stays unread. */
async function readBounties(net: Network, daoId: string) {
  const dao = sputnikDao(net, daoId);
  const bounties = await dao.allBounties();
  const limit = limiter(3);
  const counts = new Map<number, number>();
  await Promise.all(
    bounties
      .filter((b) => b.times > 0)
      .map((b) =>
        limit(() =>
          dao.bountyClaimCount(b.id).then(
            (n) => void counts.set(b.id, n),
            () => {},
          ),
        ),
      ),
  );
  return { bounties, counts };
}

async function readClaims(net: Network, daoId: string, accounts: string[]) {
  const dao = sputnikDao(net, daoId);
  const limit = limiter(3);
  const found = new Map<string, DaoBountyClaim[]>();
  await Promise.all(
    accounts.map((account) =>
      limit(async () => {
        const claims = await dao.bountyClaims(account);
        if (claims.length > 0) found.set(account, claims);
      }),
    ),
  );
  return found;
}

/** Each token's `ft_metadata`, or null for one that doesn't answer it: its amounts then show in its smallest unit. */
async function readMetas(net: Network, tokens: string[]) {
  const limit = limiter(3);
  const metas = new Map<string, FtMeta | null>();
  await Promise.all(tokens.map((t) => limit(async () => void metas.set(t, await view<FtMeta>(net, t, "ft_metadata").catch(() => null)))));
  return metas;
}

/** A Sputnik DAO's public bounty board, read live; nothing on it signs. */
export function DaoBoard({ daoId }: { daoId: string }) {
  const net = useNetwork();
  const key = `${net.id}:${daoId}`;
  const dao = useAsync(() => readDao(net, daoId), key);
  const proposals = useAsync(() => sputnikDao(net, daoId).recentProposals(MAX_PROPOSALS), key);
  const bounties = useAsync(() => readBounties(net, daoId), key);
  const index = useAsync(async () => {
    const { txs, ...read } = await accountTransactions<DaoIndexedTx>(net, daoId, MAX_TXS);
    return { ...read, activity: daoActivity(daoId, txs) };
  }, key);
  const satchels = useAsync(() => satchel(net).tokensFor(daoId), key);

  // Claims are kept by claimer: ask for them once the accounts that may hold one are known, and only
  // when some bounty with times left counts a claim (or its count couldn't be read).
  const claimable = orElse(() => bounties.data?.bounties.some((b) => b.times > 0 && bounties.data?.counts.get(b.id) !== 0) ?? false, false);
  const settled = dao.data !== undefined && bounties.data !== undefined && !proposals.loading && !index.loading;
  const policy = dao.data?.policy;
  const candidates =
    settled && policy && claimable
      ? orElse(() => claimCandidates(policy, proposals.data?.proposals ?? [], index.data?.activity ?? null), []).slice(0, MAX_CLAIMERS)
      : [];
  const claims = useAsync(
    async () => (candidates.length ? readClaims(net, daoId, candidates) : new Map<string, DaoBountyClaim[]>()),
    `${key}:${settled}:${candidates.join(",")}`,
  );
  const tokens = orElse(() => tokensIn(bounties.data?.bounties ?? [], proposals.data?.proposals ?? []), []);
  const metas = useAsync(() => readMetas(net, tokens), `${net.id}:${tokens.join(",")}`);

  const rpc = new URL(nearRpcUrl(net)).host;
  const heading = (
    <div>
      <p className="text-sm text-muted">Sputnik DAO on NEAR {net.id}</p>
      <h1 className="font-display text-4xl font-semibold tracking-tight">Bounty board</h1>
      <p className="mt-2 text-ink-2 [overflow-wrap:anywhere]">
        <ExternalLink href={nearAccountUrl(net, daoId)}>{daoId}</ExternalLink>&apos;s open bounties, claims, payouts and each
        contributor&apos;s record, read in your browser from NEAR {net.id} through {rpc}. Nothing on this page signs or sends
        anything, and it needs no wallet.
      </p>
    </div>
  );

  if (dao.data === undefined) {
    return (
      <div className="space-y-6">
        {heading}
        {dao.error ? (
          <Card>
            <h2 className="font-display text-xl font-semibold">No Sputnik DAO to show</h2>
            <p className="mt-1 text-sm text-muted [overflow-wrap:anywhere]">
              The board reads {daoId}&apos;s get_config and get_policy views, and they didn&apos;t answer, or not as a Sputnik
              DAO&apos;s would.
            </p>
            <div className="mt-3 space-y-3 [overflow-wrap:anywhere]">
              <ErrorNote error={dao.error} />
              <Button onClick={dao.reload}>Try again</Button>
            </div>
          </Card>
        ) : (
          <>
            <p role="status" className="sr-only">
              Reading {daoId} from NEAR…
            </p>
            <Placeholder className="h-72 rounded-2xl!" />
            <Placeholder className="h-48 rounded-2xl!" />
          </>
        )}
      </div>
    );
  }

  const { config, version } = dao.data;
  const activity = index.data?.activity ?? null;
  const metaMap = metas.data ?? new Map<string, FtMeta | null>();
  const proposalList = proposals.data?.proposals;
  const indexNote = <IndexNote index={index} />;
  const indexDown = index.error !== null && index.error !== undefined;
  // Every card shapes its own answers inside its boundary, so an odd answer takes down that card alone.
  return (
    <div className="space-y-6">
      {heading}

      <Contained title="The DAO">
        <DaoCard daoId={daoId} name={config.name} purpose={config.purpose} version={version} policy={dao.data.policy} />
      </Contained>

      <Contained title="Open bounties">
        <Card>
          <h2 className="font-display text-xl font-semibold">Open bounties</h2>
          <p className="mt-1 text-sm text-muted">
            Bounties with times left, and who has claimed each. A contributor claims one with bounty_claim and reports it done
            with bounty_done, which files a BountyDone proposal for the vote.
          </p>
          {bounties.error ? (
            <Retry error={bounties.error} onRetry={bounties.reload} />
          ) : !bounties.data ? (
            <Placeholder className="mt-3 h-24" />
          ) : (
            <OpenBountyList
              bounties={bounties.data}
              claims={claims.data ?? new Map()}
              proposals={proposalList ?? []}
              activity={activity}
              metas={metaMap}
              claimsReady={claims.data !== undefined && !claims.loading && settled}
              claimsError={claims.error}
              onRetryClaims={claims.reload}
              asked={candidates.length}
            />
          )}
          <p className="mt-3 text-xs text-muted">
            Read from get_bounties and get_bounty_number_of_claims. The DAO keeps claims by claimer, with no list of them all, so
            the page asks get_bounty_claims for every member, proposer and contributor, and every account FastNEAR&apos;s index
            saw claim a bounty{candidates.length ? `: ${candidates.length} account(s)` : ""}.
          </p>
        </Card>
      </Contained>

      <Contained title="Finished bounties">
        <Card>
          <h2 className="font-display text-xl font-semibold">Finished bounties</h2>
          <p className="mt-1 text-sm text-muted">
            Each BountyDone proposal: it says a contributor finished a bounty, and the DAO&apos;s members vote to pay them. The
            contributor files their own with bounty_done; anyone the policy lets propose can file one in their name.
          </p>
          {proposals.error ? (
            <Retry error={proposals.error} onRetry={proposals.reload} />
          ) : !proposalList || !bounties.data ? (
            bounties.error ? (
              <p className="mt-3 text-sm text-muted">The bounties couldn&apos;t be read, so neither can what they paid.</p>
            ) : (
              <Placeholder className="mt-3 h-24" />
            )
          ) : (
            <FinishedList
              proposals={proposalList}
              bounties={bounties.data.bounties}
              policy={dao.data.policy}
              activity={activity}
              metas={metaMap}
              indexDown={indexDown}
            />
          )}
          <p className="mt-3 text-xs text-muted">
            The proposals come from get_proposals{proposals.data ? `: ${proposalLimit(proposals.data)}` : ""}. Who voted, and how,
            is the proposal&apos;s own; each voter&apos;s role is read from today&apos;s policy, since the DAO keeps how many votes
            each role gave, not which role each voter voted in.
          </p>
          {indexNote}
        </Card>
      </Contained>

      <Contained title="Contributors">
        <Card>
          <h2 className="font-display text-xl font-semibold">Contributors</h2>
          <p className="mt-1 text-sm text-muted">
            Each contributor&apos;s record, built from the proposals alone: every line is an approved proposal, or a finished
            bounty they reported themselves that is still in progress, with its number.
          </p>
          {proposals.error ? (
            <p className="mt-3 text-sm text-muted">The proposals couldn&apos;t be read: see Finished bounties.</p>
          ) : bounties.error ? (
            <p className="mt-3 text-sm text-muted">The bounties couldn&apos;t be read, so neither can what they paid: see Open bounties.</p>
          ) : !proposalList || !bounties.data || !proposals.data ? (
            <Placeholder className="mt-3 h-24" />
          ) : (
            <RecordList
              proposals={proposalList}
              bounties={bounties.data.bounties}
              policy={dao.data.policy}
              activity={activity}
              metas={metaMap}
              partial={proposals.data.filed > MAX_PROPOSALS}
            />
          )}
          {proposals.data && <p className="mt-3 text-xs text-muted">Built from get_proposals: {proposalLimit(proposals.data)}.</p>}
          {indexNote}
        </Card>
      </Contained>

      <Contained title="Satchels the DAO owns">
        <Card>
          <h2 className="font-display text-xl font-semibold">Satchels the DAO owns</h2>
          <p className="mt-1 text-sm text-muted">
            A satchel is an address on {CHAINS.length} EVM chains, and only its owner can have anything new signed for it: here,
            this account, which answers get_policy as a Sputnik DAO does. If it runs sputnikdao2 and holds no access key of its
            own, it signs only through proposals its members vote on.
          </p>
          {satchels.error ? (
            <Retry error={satchels.error} onRetry={satchels.reload} />
          ) : !satchels.data ? (
            <Placeholder className="mt-3 h-16" />
          ) : satchels.data.length === 0 ? (
            <p className="mt-3 text-sm text-muted">The DAO owns no satchel on {net.contract}.</p>
          ) : (
            <ul className="mt-3 flex flex-wrap gap-2">
              {satchels.data.map((t) => (
                <li key={t.token_id}>
                  <Link
                    href={appPath(net, `/satchel/${t.token_id}`)}
                    className="inline-flex items-center justify-center rounded-full border border-line bg-card px-4 py-2 text-sm font-medium text-ink transition hover:border-ink"
                  >
                    Satchel #{t.token_id}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {proposalList && <SigningList net={net} proposals={proposalList} policy={dao.data.policy} activity={activity} />}
          <p className="mt-3 text-xs text-muted">
            Read from nft_tokens_for_owner on {net.contract}
            {satchels.data?.length === 100 ? ", which answers 100 at most" : ""}, and the DAO&apos;s sign_evm proposals from its
            proposals.
          </p>
        </Card>
      </Contained>
    </div>
  );
}

/** Keeps a failure in one display-only card from taking the rest of the board down with it. */
class Contained extends Component<{ title: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Card>
        <h2 className="font-display text-xl font-semibold">{this.props.title}</h2>
        <p className="mt-1 text-sm text-muted">This part of the board couldn&apos;t be shown. The rest doesn&apos;t use it.</p>
      </Card>
    );
  }
}

function DaoCard({ daoId, name, purpose, version, policy }: { daoId: string; name: string; purpose: string; version: string | null; policy: DaoPolicy }) {
  const net = useNetwork();
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-semibold [overflow-wrap:anywhere]">{name || daoId}</h2>
        {version && <Badge>sputnikdao2 {version}</Badge>}
      </div>
      {purpose && <p className="mt-1 max-w-[36em] text-ink-2 [overflow-wrap:anywhere]">{purpose}</p>}

      <h3 className="mt-5 font-medium">Roles and members</h3>
      <ul className="mt-2 space-y-4">
        {roleSummaries(policy).map((role) => (
          <li key={role.name} className="min-w-0 text-sm">
            <p>
              <strong className="font-medium">{role.name}</strong> <span className="text-muted">· {role.who}</span>
            </p>
            {role.members && role.members.length > 0 && (
              <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                {role.members.map((m) => (
                  <li key={m} className="[overflow-wrap:anywhere]">
                    <ExternalLink href={nearAccountUrl(net, m)}>{m}</ExternalLink>
                  </li>
                ))}
              </ul>
            )}
            <ul className="mt-1 max-w-[36em] space-y-0.5 text-ink-2">
              {role.can.map((line) => (
                <li key={line} className="[overflow-wrap:anywhere]">
                  {line}
                </li>
              ))}
              {role.can.length === 0 && <li>No permissions</li>}
            </ul>
          </li>
        ))}
      </ul>

      <h3 className="mt-5 font-medium">What passes a proposal</h3>
      <p className="mt-1 max-w-[36em] text-sm text-muted">
        From the policy&apos;s vote rules, as sputnikdao2 counts approve votes: the first role to reach its number passes the
        proposal, and its vote runs it.
      </p>
      <ul className="mt-2 space-y-3 text-sm">
        {approvalTiers(policy).map((tier) => (
          <TierItem key={tier.words} tier={tier} />
        ))}
      </ul>

      <p className="mt-5 text-sm text-ink-2 [overflow-wrap:anywhere]">
        A proposal&apos;s bond is {tokenAmount("", policy.proposal_bond)}, and it stays open for votes for {duration(policy.proposal_period)}.
        A claim&apos;s bond is {tokenAmount("", policy.bounty_bond)}; giving the bounty up within{" "}
        {duration(policy.bounty_forgiveness_period)} of claiming it returns the bond.
      </p>
      <p className="mt-3 text-xs text-muted">Read from the DAO&apos;s get_config, get_policy and version views at a final block.</p>
    </Card>
  );
}

/** A proposal's status badge. One still in progress past its voting period can no longer pass, so it doesn't say open. */
function StatusBadge({ proposal, lapsed }: { proposal: DaoProposal; lapsed: boolean }) {
  const status = lapsed
    ? { label: "Voting period over", tone: "warn" as const }
    : (STATUS[proposal.status] ?? { label: proposal.status, tone: "plain" as const });
  return <Badge tone={status.tone}>{status.label}</Badge>;
}

function Retry({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="mt-3 space-y-3 [overflow-wrap:anywhere]">
      <ErrorNote error={error} />
      <Button onClick={onRetry}>Try again</Button>
    </div>
  );
}

function proposalLimit({ proposals, filed }: { proposals: DaoProposal[]; filed: number }): string {
  if (filed === 0) return "the DAO has filed none";
  if (filed > MAX_PROPOSALS) return `the newest ${MAX_PROPOSALS} of the ${filed} filed, so older ones are missing`;
  const removed = filed - proposals.length;
  return `all ${filed} filed${removed > 0 ? `, of which the DAO removed ${removed}` : ""}`;
}

/** Where the transaction links come from, and what is missing when the index didn't answer or answered in part. */
function IndexNote({ index }: { index: { data?: { scanned: number; complete: boolean; source: string }; error: unknown; loading: boolean } }) {
  if (index.error) {
    return (
      <p className="mt-1 text-xs text-warn [overflow-wrap:anywhere]">
        FastNEAR&apos;s transaction index didn&apos;t answer, so no transaction is linked: {errorMessage(index.error)}
      </p>
    );
  }
  if (!index.data) return <p className="mt-1 text-xs text-muted">Reading the DAO&apos;s transactions from FastNEAR&apos;s index…</p>;
  return (
    <p className="mt-1 text-xs text-muted">
      Transactions are linked from FastNEAR&apos;s index of the DAO&apos;s account at {new URL(index.data.source).host}, not from the
      DAO&apos;s state: {index.data.scanned} of its transactions
      {index.data.complete ? "." : ", not all of them, so the oldest have no link."}
    </p>
  );
}

function TxLink({ hash, children }: { hash: string; children: ReactNode }) {
  const net = useNetwork();
  return <ExternalLink href={nearTxUrl(net, hash)}>{children}</ExternalLink>;
}

function KindList({ kinds }: { kinds: string[] }) {
  if (kinds.length <= 4) return <Mono>{kinds.join(", ")}</Mono>;
  return (
    <details className="inline">
      <summary className="cursor-pointer">
        <Mono>{kinds.slice(0, 3).join(", ")}</Mono> and {kinds.length - 3} other kinds
      </summary>
      <Mono className="mt-1 block text-ink-2">{kinds.slice(3).join(", ")}</Mono>
    </details>
  );
}

function TierItem({ tier }: { tier: ApprovalTier }) {
  return (
    <li className="min-w-0 [overflow-wrap:anywhere]">
      <KindList kinds={tier.kinds} />
      <span className="block text-ink-2">{tier.words}</span>
      {tier.ownVote.length > 0 && (
        <span className="block text-xs text-muted">
          bounty_done&apos;s proposer is the contributor, so a member of {tier.ownVote.join(" or ")} who finishes a bounty can approve
          it with their own vote.
        </span>
      )}
    </li>
  );
}

function OpenBountyList({
  bounties,
  claims,
  proposals,
  activity,
  metas,
  claimsReady,
  claimsError,
  onRetryClaims,
  asked,
}: {
  bounties: { bounties: DaoBounty[]; counts: Map<number, number> };
  claims: Map<string, DaoBountyClaim[]>;
  proposals: DaoProposal[];
  activity: DaoActivity | null;
  metas: Map<string, FtMeta | null>;
  claimsReady: boolean;
  claimsError: unknown;
  onRetryClaims: () => void;
  asked: number;
}) {
  const open = openBounties(bounties.bounties, bounties.counts, claims, proposals, activity, metas, Date.now());
  const closed = bounties.bounties.filter((b) => b.times === 0).map((b) => b.id);
  return (
    <>
      {open.length === 0 && <p className="mt-3 text-sm text-muted">No bounty has times left.</p>}
      {claimsError !== null && claimsError !== undefined && <Retry error={claimsError} onRetry={onRetryClaims} />}
      <ol className="mt-3 space-y-5">
        {open.map((o) => {
          const free = o.claimCount === null ? null : Math.max(0, o.bounty.times - o.claimCount);
          return (
            <li key={o.bounty.id} id={`bounty-${o.bounty.id}`} className="min-w-0 scroll-mt-24">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">
                  Bounty #{o.bounty.id} · {o.amount}
                </p>
                <Badge tone={free === 0 ? "plain" : "gold"}>
                  {o.bounty.times} time{o.bounty.times === 1 ? "" : "s"} left
                  {free === null ? "" : free === 0 ? ", all claimed" : `, ${free} open`}
                </Badge>
              </div>
              <p className="mt-1 max-w-[36em] text-sm whitespace-pre-line [overflow-wrap:anywhere]">{o.bounty.description}</p>
              <p className="mt-1 text-xs text-muted">
                A claim may ask for up to {o.maxDeadline}.
                {o.postedBy !== null && ` Posted by proposal #${o.postedBy}.`}
              </p>
              {o.claimCount === null && <p className="mt-1 text-xs text-warn">Its claim count couldn&apos;t be read.</p>}
              {o.claims.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm">
                  {o.claims.map((c) => (
                    <li key={`${c.account}:${c.since}`} className="[overflow-wrap:anywhere]">
                      <ExternalLinkAccount account={c.account} /> claimed it on {utc(c.since)}, until {utc(c.until)}
                      {c.tx && (
                        <>
                          {" "}
                          · <TxLink hash={c.tx}>tx</TxLink>
                        </>
                      )}
                      {c.completed && <span className="block text-xs text-ink-2">Reported done: its BountyDone proposal waits for the vote.</span>}
                      {c.expired && (
                        <span className="block text-xs text-warn">Past its deadline: anyone can free the slot with bounty_done.</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {claimsReady && o.unfound > 0 && (
                <p className="mt-1 text-xs text-muted">
                  The DAO counts {o.unfound} more claim(s), by accounts outside the {asked} the page asked about.
                </p>
              )}
              {!claimsReady && o.claimCount !== 0 && !claimsError && <p className="mt-1 text-xs text-muted">Reading its claims…</p>}
              {claimsReady && o.claimCount === 0 && <p className="mt-1 text-xs text-muted">No claims yet.</p>}
            </li>
          );
        })}
      </ol>
      {closed.length > 0 && (
        <p className="mt-4 text-sm text-muted">
          Done as many times as posted, so closed: bounty {closed.map((id) => `#${id}`).join(", ")}.
        </p>
      )}
    </>
  );
}

function ExternalLinkAccount({ account }: { account: string }) {
  const net = useNetwork();
  return <ExternalLink href={nearAccountUrl(net, account)}>{account}</ExternalLink>;
}

function ProposalLinks({ txs, indexDown }: { txs: ProposalTxs | null; indexDown: boolean }) {
  if (txs === null) return indexDown ? null : <span className="text-muted">Reading its transactions…</span>;
  if (!txs.filed && txs.acts.length === 0) return <span className="text-muted">FastNEAR&apos;s index holds none of its transactions.</span>;
  return (
    <span>
      {txs.filed ? (
        <>
          Filed in <TxLink hash={txs.filed.tx}>{txs.filed.tx.slice(0, 8)}…</TxLink>
        </>
      ) : (
        <span className="text-muted">The index doesn&apos;t hold the transaction that filed it</span>
      )}
      {txs.acts.length > 0 && (
        <>
          {"; acted on in "}
          {txs.acts.map((a, i) => (
            <span key={`${a.tx}:${i}`}>
              {i > 0 && ", "}
              <TxLink hash={a.tx}>{a.tx.slice(0, 8)}…</TxLink>
            </span>
          ))}
        </>
      )}
      .
    </span>
  );
}

function FinishedList({
  proposals,
  bounties,
  policy,
  activity,
  metas,
  indexDown,
}: {
  proposals: DaoProposal[];
  bounties: DaoBounty[];
  policy: DaoPolicy;
  activity: DaoActivity | null;
  metas: Map<string, FtMeta | null>;
  indexDown: boolean;
}) {
  const items = finishedBounties(proposals, bounties, policy, activity, metas, Date.now());
  if (items.length === 0) return <p className="mt-3 text-sm text-muted">No bounty has been reported done yet.</p>;
  return (
    <ol className="mt-3 space-y-5">
      {items.map((f) => {
        return (
          <li key={f.proposal.id} id={`proposal-${f.proposal.id}`} className="min-w-0 scroll-mt-24 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium [overflow-wrap:anywhere]">
                Proposal #{f.proposal.id}: bounty #{f.bountyId},{" "}
                {f.ownReport ? (
                  <>
                    done by <ExternalLinkAccount account={f.contributor} />
                  </>
                ) : (
                  <>
                    filed by <ExternalLinkAccount account={f.proposal.proposer} />, naming <ExternalLinkAccount account={f.contributor} />
                  </>
                )}
              </p>
              <StatusBadge proposal={f.proposal} lapsed={f.lapsed} />
            </div>
            {f.bounty && <p className="mt-1 max-w-[36em] whitespace-pre-line text-ink-2 [overflow-wrap:anywhere]">{f.bounty.description}</p>}
            {f.proposal.description && (
              <p className="mt-1 max-w-[36em] whitespace-pre-line text-muted [overflow-wrap:anywhere]">
                {f.ownReport ? "Their note" : `${f.proposal.proposer}'s note`}: {f.proposal.description}
              </p>
            )}
            <p className="mt-1 text-xs text-muted">Filed {utc(nsToMs(f.proposal.submission_time))}.</p>
            {!f.ownReport && (
              <p className="mt-1 text-xs text-warn [overflow-wrap:anywhere]">
                Filed with add_proposal, not by {f.contributor}&apos;s own bounty_done, so it isn&apos;t their report.
                {f.proposal.status === "InProgress" &&
                  ` The DAO doesn't check that ${f.contributor} claimed the bounty: if they hold no claim on it, any vote that would decide it fails.`}
              </p>
            )}
            {f.lapsed && (
              <p className="mt-1 text-xs text-warn">
                Its voting period is over, so it can no longer pass.
                {f.ownReport &&
                  " Finalizing it marks it expired, returns the bond and frees the claim; a vote marks it expired too, but does neither."}
              </p>
            )}
            <ul className="mt-2 space-y-0.5">
              {f.votes.length === 0 && <li className="text-muted">No votes yet.</li>}
              {f.votes.map((v) => (
                <li key={v.account} className="[overflow-wrap:anywhere]">
                  <ExternalLinkAccount account={v.account} /> voted {v.vote}
                  {v.roles.length
                    ? `, as ${v.roles.join(" and ")}`
                    : v.holderRoles.length
                      ? ", in no group of today's policy"
                      : ", in no role today's policy counts"}
                  {v.holderRoles.length > 0 &&
                    ` (${v.holderRoles.join(" or ")}, ${v.holderRoles.length === 1 ? "a role of token holders, counts" : "roles of token holders, count"} it if they hold enough delegated tokens, which the page doesn't read)`}
                  {v.tx && (
                    <>
                      {" "}
                      · <TxLink hash={v.tx}>tx</TxLink>
                    </>
                  )}
                </li>
              ))}
            </ul>
            {f.counts.length > 0 && <p className="mt-1 text-xs text-muted">Vote counts: {f.counts.join("; ")}.</p>}
            {f.payout && (
              <p className="mt-2 [overflow-wrap:anywhere]">
                Paid {f.payout.words}
                {f.payout.tx ? (
                  <>
                    {" "}
                    · <TxLink hash={f.payout.tx}>payout tx</TxLink>
                  </>
                ) : (
                  <span className="block text-xs text-muted">
                    {indexDown
                      ? "The index didn't answer, so the payout isn't linked."
                      : f.txs === null
                        ? "Reading the index…"
                        : "The index shows no transaction paying it, among those it holds for the DAO."}
                  </span>
                )}
              </p>
            )}
            <p className="mt-1 text-xs [overflow-wrap:anywhere]">
              <ProposalLinks txs={f.txs} indexDown={indexDown} />
            </p>
          </li>
        );
      })}
    </ol>
  );
}

function RecordList({
  proposals,
  bounties,
  policy,
  activity,
  metas,
  partial,
}: {
  proposals: DaoProposal[];
  bounties: DaoBounty[];
  policy: DaoPolicy;
  activity: DaoActivity | null;
  metas: Map<string, FtMeta | null>;
  /** The DAO filed more proposals than the page read, so the records leave out the oldest. */
  partial: boolean;
}) {
  const records = contributorRecords(proposals, bounties, policy, activity, metas, Date.now());
  if (records.length === 0) return <p className="mt-3 text-sm text-muted">No contributor has a record yet: no bounty paid, role given or transfer made.</p>;
  return (
    <ol className="mt-3 space-y-5">
      {records.map((r) => (
        <li key={r.account} className="min-w-0 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium [overflow-wrap:anywhere]">
              <ExternalLinkAccount account={r.account} />
            </p>
            <Badge tone={r.finished.length ? "ok" : "plain"}>
              {r.finished.length} finished bount{r.finished.length === 1 ? "y" : "ies"}
            </Badge>
          </div>
          {r.totals.length > 0 && (
            <p className="mt-1 text-ink-2 [overflow-wrap:anywhere]">
              Paid {r.totals.join(" and ")} {partial ? `across the newest ${MAX_PROPOSALS} proposals` : "in all"}.
            </p>
          )}
          <RecordSection title="Finished bounties">
            {r.finished.map((line) => (
              <li key={line.proposalId} className="[overflow-wrap:anywhere]">
                <a href={`#proposal-${line.proposalId}`} className={linkClass}>
                  Proposal #{line.proposalId}
                </a>
                : {line.words}
                {line.tx && (
                  <>
                    {" "}
                    · <TxLink hash={line.tx}>tx</TxLink>
                  </>
                )}
              </li>
            ))}
          </RecordSection>
          {r.waiting.length > 0 && (
            <p className="mt-2 text-ink-2">
              Waiting for the vote:{" "}
              {r.waiting.map((id, i) => (
                <span key={id}>
                  {i > 0 && ", "}
                  <a href={`#proposal-${id}`} className={linkClass}>
                    proposal #{id}
                  </a>
                </span>
              ))}
            </p>
          )}
          {r.lapsed.length > 0 && (
            <p className="mt-2 text-ink-2">
              Voting period over, so it can no longer pass:{" "}
              {r.lapsed.map((id, i) => (
                <span key={id}>
                  {i > 0 && ", "}
                  <a href={`#proposal-${id}`} className={linkClass}>
                    proposal #{id}
                  </a>
                </span>
              ))}
            </p>
          )}
          <RecordSection title="Role changes">
            {r.roles.map((line) => (
              <RecordItem key={line.proposalId} line={line} />
            ))}
          </RecordSection>
          <RecordSection title="Payouts">
            {r.payouts.map((line) => (
              <RecordItem key={line.proposalId} line={line} />
            ))}
          </RecordSection>
        </li>
      ))}
    </ol>
  );
}

function RecordSection({ title, children }: { title: string; children: ReactNode[] }) {
  if (children.length === 0) return null;
  return (
    <div className="mt-2">
      <p className="text-xs text-muted">{title}</p>
      <ul className="mt-0.5 space-y-0.5">{children}</ul>
    </div>
  );
}

function RecordItem({ line }: { line: { proposalId: number; words: string; tx: string | null } }) {
  return (
    <li className="[overflow-wrap:anywhere]">
      Proposal #{line.proposalId}: {line.words}
      {line.tx && (
        <>
          {" "}
          · <TxLink hash={line.tx}>tx</TxLink>
        </>
      )}
    </li>
  );
}

function SigningList({
  net,
  proposals,
  policy,
  activity,
}: {
  net: Network;
  proposals: DaoProposal[];
  policy: DaoPolicy;
  activity: DaoActivity | null;
}) {
  const signings = satchelSignings(net, proposals, activity);
  if (signings.length === 0) return null;
  const now = Date.now();
  return (
    <>
      <h3 className="mt-5 font-medium">Signatures the DAO voted</h3>
      <ol className="mt-2 space-y-2 text-sm">
        {signings.map((s) => {
          return (
            <li key={`${s.proposal.id}:${s.tokenId}`} className="min-w-0 [overflow-wrap:anywhere]">
              <StatusBadge proposal={s.proposal} lapsed={lapsed(s.proposal, policy, now)} /> Proposal #{s.proposal.id}:{" "}
              <Link href={appPath(net, `/satchel/${s.tokenId}`)} className={linkClass}>
                satchel #{s.tokenId}
              </Link>{" "}
              signs {s.words}
              {s.tx && (
                <>
                  {" "}
                  · <TxLink hash={s.tx}>vote tx</TxLink>
                </>
              )}
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-xs text-muted">
        A passed vote has the contract sign; someone still has to broadcast the signed transaction. The satchel&apos;s report checks
        whether each signed nonce is spent.
      </p>
    </>
  );
}

/**
 * On a satchel's page: when its owner's get_policy answers as a Sputnik DAO's does, a line that links
 * the DAO's board. That checks the answer's shape only, not the owner's code or keys, and the line
 * says no more. Silent for any other owner, and when the read fails.
 */
export function DaoBoardLink({ owner }: { owner: string }) {
  const net = useNetwork();
  const dao = useAsync(
    () =>
      sputnikDao(net, owner)
        .policy()
        .then(isDaoPolicy, () => false),
    `${net.id}:${owner}`,
  );
  if (!dao.data) return null;
  return (
    <p className="mt-1 text-sm text-ink-2 [overflow-wrap:anywhere]">
      Its owner answers get_policy as a Sputnik DAO does. If it runs sputnikdao2 and holds no access key of its own, it has
      this satchel sign only through proposals its members vote on.{" "}
      <Link href={appPath(net, `/dao/${owner}`)} className={`font-medium text-leather ${linkClass}`}>
        The DAO&apos;s bounty board
      </Link>
    </p>
  );
}
