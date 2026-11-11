"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Address } from "viem";
import {
  type ChainFix,
  type FixAction,
  type FixPlan,
  type ManualFix,
  type Report,
  type SatchelView,
  type SendStep,
  chainInfo,
  fixPlan,
  formatBalance,
  readFixInputs,
  satchel,
} from "satchel-nft";
import { useNetwork } from "./network";
import { FrozenNote, SendSteps, useSatchelSend } from "./send-panel";
import { Badge, Button, Card, CopyButton, ErrorNote, Mono } from "./ui";
import { useAsync } from "./use-async";
import { useWallet } from "./wallet";

/**
 * "Make it clean", under a report that isn't clean: the transactions that would fix what checks 2
 * and 3 found, from `fixPlan` in `satchel-nft`. Anyone can read the plan and its calldata. Only the
 * owner gets buttons, and each one sends through `useSatchelSend`, with the same guards and wallet
 * prompt as Send from this satchel.
 */

/** What became of a fix sent from this card: mined, mined and reverted, or broadcast with no receipt read. */
type Sent = "success" | "reverted" | "broadcast";

/** The steps a send reaches only after sign_evm returned, so the record's version went up. */
const SIGNED: SendStep[] = ["recover", "broadcast", "confirm"];

export function FixPanel({
  token,
  address,
  report,
  frozen = false,
  onRecheck,
}: {
  token: SatchelView;
  address: Address;
  report: Report | undefined;
  /** A demo satchel: the plan shows, its buttons don't (`lib/frozen.ts`). */
  frozen?: boolean;
  onRecheck: () => void;
}) {
  const net = useNetwork();
  const { accountId } = useWallet();
  // Only a report about this satchel, on this network, at the address this page derived.
  const about =
    report &&
    report.verdict !== "clean" &&
    report.network === net.id &&
    report.contract === net.contract &&
    report.tokenId === token.token_id &&
    report.address === address
      ? report
      : undefined;
  const inputs = useAsync(
    () => (about ? readFixInputs(about, token.record) : Promise.resolve(null)),
    `${net.id}:${token.token_id}:${about?.checkedAt ?? "none"}:${token.record.version}`,
  );
  const plan = useMemo(() => (inputs.data ? fixPlan(inputs.data) : null), [inputs.data]);
  const sender = useSatchelSend(token.token_id, address);
  // The fix being sent, and the plan it was clicked in: a key only names an action within its plan.
  const [running, setRunning] = useState<{ key: string; plan: FixPlan | null } | null>(null);
  // The fixes sent since this plan was read, so their buttons don't offer them again.
  const [sent, setSent] = useState<{ key: string; status: Sent }[]>([]);
  // How many of them reached sign_evm, so the record's version is expected to have gone up by as many.
  const signedSince = useRef(0);
  // The plan on screen. A send still running when a new one arrives (Check again, a sale action)
  // counts for the plan it was clicked in, not the new one.
  const current = useRef(plan);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new plan is what should clear the list
  useEffect(() => {
    current.current = plan;
    setSent([]);
    signedSince.current = 0;
  }, [plan]);
  if (!about) return null;

  const owner = accountId !== null && accountId === token.owner_id;
  // Not while a new read is on its way: the plan on screen may be the one before the last fix. Not
  // while the page shows a listing either, even one the report didn't see: a listed satchel can't sign.
  const canClick = owner && !frozen && !token.listing && plan?.canSend === true && !inputs.loading;
  // A fix whose receipt wait failed after its broadcast still went out: offer Check again for it too.
  const broadcast = sender.result !== null || (sender.step === "confirm" && sender.error !== null);

  async function fix(action: FixAction, key: string) {
    // One at a time: a second click while one runs would only move the spinner (the lock refuses it).
    if (sender.busy) return;
    const from = plan;
    setRunning({ key, plan: from });
    const { result, reached } = await sender.run(async () => {
      const chain = chainInfo(action.chainId);
      if (!chain) throw new Error(`Chain ${action.chainId} isn't one the app knows. Nothing was signed.`);
      if (action.slot.kind === "takes") {
        // The slot was counted from the record this plan read. A signature made since, from the CLI,
        // another tab or another device, can fill it, and this revoke would then be only counted.
        // The contract can't catch that: sign_evm names no record version.
        const fresh = await satchel(net).get(token.token_id);
        if (fresh === null || BigInt(fresh.record.version) > BigInt(token.record.version) + BigInt(signedSince.current)) {
          throw new Error("The record changed since this plan was read. Click Check again. Nothing was signed.");
        }
      }
      return { chain, to: action.to, value: action.value, data: action.data };
    });
    // A plan read since then counts from the record it read itself: adding this send to it could let a
    // signature from elsewhere past the check above, and its keys name other actions. The steps under
    // the plan still show what became of this send.
    if (current.current !== from) return;
    if (reached !== null && SIGNED.includes(reached)) signedSince.current += 1;
    if (result) setSent((s) => [...s, { key, status: result.status }]);
    else if (reached === "confirm") setSent((s) => [...s, { key, status: "broadcast" }]);
  }

  return (
    <div id="make-it-clean" className="scroll-mt-24">
      <Card className="border-warn/40">
        <h2 className="font-display text-xl font-semibold">Make it clean</h2>
        <p className="mt-1 text-sm text-muted">
          The transactions that would fix what checks 2 and 3 found, read at each chain&apos;s latest block. Anyone can read
          them and their calldata. Each button sends through the same steps as Send from this satchel: the contract builds
          and records the transaction, the owner&apos;s wallet approves sign_evm, and the app checks the signature before it
          broadcasts.
        </p>
        {frozen ? (
          <FrozenNote />
        ) : (
          !owner && (
            <p className="mt-3 text-sm text-ink-2 [overflow-wrap:anywhere]">
              {accountId === null
                ? `Connect the owner's wallet, ${token.owner_id}, to send them.`
                : `Only the owner, ${token.owner_id}, can send them.`}
            </p>
          )
        )}
        <div className="mt-3">
          <ErrorNote error={inputs.error} />
        </div>
        {!plan && inputs.loading && <p className="mt-3 text-sm text-muted">Reading each chain&apos;s latest block…</p>}
        {plan && (
          <>
            {plan.notes.map((note) => (
              <p key={note} className="mt-3 rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">
                {note}
              </p>
            ))}
            {token.listing && !about.listing && (
              <p className="mt-3 rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">
                The satchel was listed after this report was read, and a listed satchel can&apos;t sign. Its owner has to delist
                it first, under Sell or transfer, then check again.
              </p>
            )}
            {plan.unfixable.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-sm text-ink-2">
                {plan.unfixable.map((line) => (
                  <li key={line} className="break-words">
                    {line}
                  </li>
                ))}
              </ul>
            )}
            {plan.chains.map((chain) => (
              <ChainSection
                key={chain.chainId}
                chain={chain}
                canClick={canClick}
                running={sender.busy && running?.plan === plan ? running.key : null}
                sent={sent}
                onFix={fix}
              />
            ))}
            {plan.notes.length === 0 && plan.chains.length === 0 && (
              <p className="mt-3 text-sm text-ink-2">
                Nothing to send: at each chain&apos;s latest block, nothing the report found is left to fix. Check again once
                those blocks are finalized.
              </p>
            )}
          </>
        )}
        <SendSteps sender={sender} />
        {broadcast && (
          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
            <Button variant="primary" onClick={onRecheck}>
              Check again
            </Button>
            <p className="min-w-0 flex-1 text-sm text-muted">
              The report reads each chain at a finalized block, which can lag its latest block: about 3 s on Avalanche Fuji,
              about 13 minutes on Sepolia, sometimes longer. If a line hasn&apos;t changed yet, check again a little later.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}

function ChainSection({
  chain,
  canClick,
  running,
  sent,
  onFix,
}: {
  chain: ChainFix;
  canClick: boolean;
  running: string | null;
  sent: { key: string; status: Sent }[];
  onFix: (action: FixAction, key: string) => void;
}) {
  return (
    <section className="mt-5">
      <h3 className="font-medium">
        {chain.name} ({chain.chainId})
      </h3>
      <p className="text-sm text-muted">
        Balance {chain.balance === null ? "unread" : `${formatBalance(chain.balance)} ${chain.symbol}`}
        {chain.nextNonce !== null && ` · next nonce ${chain.nextNonce}`}
        {chain.openNonces > 0n && ` · ${chain.openNonces} signed nonce(s) open`}
      </p>
      {chain.notes.map((note) => (
        <p key={note} className="mt-1 text-sm text-ink-2 [overflow-wrap:anywhere]">
          {note}
        </p>
      ))}
      <ol className="mt-3 space-y-3">
        {chain.actions.map((action, i) => {
          const key = `${chain.chainId}:${i}:${action.to}:${action.data}`;
          return (
            <ActionItem
              key={key}
              action={action}
              chainName={chain.name}
              symbol={chain.symbol}
              done={sent.find((s) => s.key === key)?.status}
              button={canClick && action.refused === undefined}
              busy={running === key}
              onFix={() => onFix(action, key)}
            />
          );
        })}
        {chain.manual.map((m) => (
          <ManualItem key={m.row} fix={m} />
        ))}
      </ol>
    </section>
  );
}

function ActionItem({
  action,
  chainName,
  symbol,
  done,
  button,
  busy,
  onFix,
}: {
  action: FixAction;
  chainName: string;
  symbol: string;
  done: Sent | undefined;
  button: boolean;
  busy: boolean;
  onFix: () => void;
}) {
  // Each button and copy button names its fix for screen readers: a plan can list several alike.
  const named = `${action.title}, ${chainName}`;
  return (
    <li className="rounded-xl border border-line p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{action.title}</p>
          <p className="mt-0.5 text-sm text-muted">{action.cost}</p>
        </div>
        {done === "success" ? (
          <Badge tone="ok">Sent</Badge>
        ) : done === "reverted" ? (
          <Badge tone="warn">Reverted</Badge>
        ) : done === "broadcast" ? (
          <Badge>Broadcast, receipt not read</Badge>
        ) : (
          button && (
            <Button variant="primary" busy={busy} onClick={onFix}>
              {action.kind === "revoke" ? "Revoke" : "Spend nonce"}
              <span className="sr-only">: {named}</span>
            </Button>
          )
        )}
      </div>
      <dl className="mt-2 grid gap-x-3 gap-y-1 text-xs sm:grid-cols-[5rem_1fr]">
        <dt className="text-muted">Call</dt>
        <dd className="min-w-0">
          <Mono>{action.call}</Mono>
        </dd>
        <dt className="text-muted">To</dt>
        <dd className="min-w-0">
          <Mono>{action.to}</Mono>
        </dd>
        <dt className="text-muted">Value</dt>
        <dd>0 {symbol}</dd>
        <dt className="text-muted">Calldata</dt>
        <dd className="min-w-0">
          <span role="group" aria-label={`Calldata of ${named}`} className="flex min-w-0 items-start gap-2">
            <Mono>{action.data}</Mono>
            {action.data !== "0x" && <CopyButton value={action.data} />}
          </span>
        </dd>
        {action.nonce !== null && (
          <>
            <dt className="text-muted">Nonce</dt>
            <dd>{action.nonce.toString()}, if the fixes above it on this chain are sent first</dd>
          </>
        )}
      </dl>
      {action.refused && <p className="mt-2 text-sm text-warn">{action.refused}</p>}
    </li>
  );
}

function ManualItem({ fix }: { fix: ManualFix }) {
  return (
    <li className="rounded-xl border border-dashed border-line p-3 text-sm">
      <p className="font-medium">No button for approval row {fix.row + 1}</p>
      <p className="mt-0.5 text-muted">{fix.why}</p>
      <ul className="mt-2 space-y-2 text-xs">
        {fix.calls.map((c) => (
          <li key={c.data} className="min-w-0">
            <Mono>{c.call}</Mono>, sent to <Mono>{c.to}</Mono>
            <span role="group" aria-label={`Calldata of ${c.call}, approval row ${fix.row + 1}`} className="mt-1 flex items-start gap-2">
              <Mono>{c.data}</Mono>
              <CopyButton value={c.data} />
            </span>
          </li>
        ))}
      </ul>
    </li>
  );
}
