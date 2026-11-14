"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  type KitAction,
  type KitStep,
  ROOM_RECIPIENT,
  ROOM_WINDOW_MS,
  type RoomProof,
  bytesToBase64,
  nearAccountUrl,
  nearBlockUrl,
  roomMessage,
} from "satchel-nft";
import { TimeoutError, errorKind } from "@/lib/errors";
import { FROZEN_NOTE, isFrozen } from "@/lib/frozen";
import type { RoomResponse } from "@/lib/room-request";
import { appPath } from "@/lib/routes";
import { utcDateTime, utcTime } from "@/lib/showcase";
import { TIMING } from "@/lib/timing";
import { MINT_PATH } from "@/lib/try-it";
import { NoMessageSigning, signMessage } from "@/lib/wallet";
import { useNetwork } from "./network";
import { RoomIntro } from "./room-intro";
import { Badge, Button, Card, ErrorNote, ExternalLink, Mono, VERDICT, WaitLine } from "./ui";
import { useWait } from "./use-async";
import { ConnectButton, useWallet } from "./wallet";
import { WalletPending } from "./wallet-pending";

const ACTION: Record<KitAction, { label: string; tone: "ok" | "warn" | "bad" | "plain" }> = {
  fix: { label: "Fix", tone: "warn" },
  wait: { label: "Check again later", tone: "plain" },
  disclose: { label: "Tell the buyer", tone: "bad" },
  "not-yours": { label: "Not yours to fix", tone: "plain" },
  list: { label: "Ready", tone: "ok" },
};

/** Stop reusing a proof a little before the server would call it expired. */
const REUSE_MARGIN_MS = 15_000;

/**
 * A page only the account that owns the satchel right now can open. The wallet signs a NEP-413
 * message; /api/room checks it, the key and the owner at a final NEAR block on every request.
 */
export function HolderRoom({ tokenId }: { tokenId: string }) {
  const net = useNetwork();
  const { accountId, ready } = useWallet();
  const [proof, setProof] = useState<RoomProof | null>(null);
  const [room, setRoom] = useState<RoomResponse | null>(null);
  const [refusal, setRefusal] = useState<{ status: number; error: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<"sign" | "check" | null>(null);
  const running = useRef(false);
  const busyWait = useWait(busy !== null, busy === "sign" ? TIMING.wallet : TIMING.action);

  // A proof belongs to one account on one network: switching either closes the room.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the reset should run when these change
  useEffect(() => {
    setProof(null);
    setRoom(null);
    setRefusal(null);
    setError(null);
  }, [accountId, net.id, tokenId]);

  async function submit(p: RoomProof) {
    setBusy("check");
    let res: Response;
    try {
      // A little past the route's 60 s limit, so a hung function still ends in words.
      res = await fetch("/api/room", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ network: net.id, ...p }),
        cache: "no-store",
        signal: AbortSignal.timeout(65_000),
      });
    } catch (err) {
      throw errorKind(err) === "timeout" ? new TimeoutError("The room didn't answer in 65 s.") : err;
    }
    const body = (await res.json().catch(() => null)) as (RoomResponse & { error?: string }) | null;
    if (res.ok && body !== null) {
      setRoom(body);
      setRefusal(null);
    } else {
      setRoom(null);
      setRefusal({ status: res.status, error: body?.error ?? `The room answered ${res.status}` });
    }
  }

  async function run(work: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setError(null);
    try {
      await work();
    } catch (err) {
      // A cancel in the wallet shows as a neutral note (UserRejected, from lib/wallet).
      setError(err);
    } finally {
      running.current = false;
      setBusy(null);
    }
  }

  const open = () =>
    run(async () => {
      if (accountId === null) return;
      setBusy("sign");
      setRefusal(null);
      const issuedAt = new Date().toISOString();
      const nonce = crypto.getRandomValues(new Uint8Array(32));
      const message = roomMessage(net, tokenId, accountId, issuedAt);
      const signed = await signMessage(net, { message, recipient: ROOM_RECIPIENT, nonce }, accountId);
      const next: RoomProof = { tokenId, accountId, ...signed, nonce: bytesToBase64(nonce), issuedAt };
      setProof(next);
      await submit(next);
    });

  const reuseUntil = proof ? Date.parse(proof.issuedAt) + ROOM_WINDOW_MS - REUSE_MARGIN_MS : 0;
  // The same proof while it is in its window, then a new signature. After a 401 the server called
  // this proof expired or wrong, whatever this device's clock says: sign again.
  const checkAgain = () => (proof && refusal?.status !== 401 && Date.now() < reuseUntil ? run(() => submit(proof)) : open());

  return (
    <div className="space-y-6">
      <RoomIntro tokenId={tokenId} />

      {!room && (
        <Card>
          {!ready ? (
            <WalletPending />
          ) : accountId === null ? (
            <div className="space-y-3">
              <div>
                <p className="text-sm">Connect the NEAR {net.id} account that owns satchel #{tokenId}.</p>
                <p className="mt-1 text-sm text-muted">
                  Not yours?{" "}
                  <Link href={MINT_PATH} className="underline decoration-line underline-offset-4 hover:decoration-ink">
                    Mint a testnet satchel
                  </Link>{" "}
                  to open a room of your own.
                </p>
              </div>
              <ConnectButton align="left" />
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm [overflow-wrap:anywhere]">
                Connected as <strong>{accountId}</strong>. Your wallet will ask you to sign:
              </p>
              <pre className="overflow-x-auto rounded-xl bg-paper-2 p-3 font-mono text-xs whitespace-pre-wrap [overflow-wrap:anywhere]">
                {roomMessage(net, tokenId, accountId, "the time you click")}
              </pre>
              <Button
                variant="primary"
                onClick={open}
                busy={busy !== null}
                busyText={busy === "check" ? "Checking your key and the owner…" : "Waiting for your wallet…"}
              >
                Open the room
              </Button>
              <WaitLine
                className="min-h-10"
                wait={busyWait}
                slow={busy === "sign" ? "Still waiting for your wallet. Look for its window or extension." : undefined}
              >
                {busy === "check"
                  ? "Checking your key and the owner at a final block, then reading the report: up to 20 s."
                  : "Approve the message in your wallet."}
              </WaitLine>
            </div>
          )}
        </Card>
      )}

      {error instanceof NoMessageSigning ? (
        <Card className="border-warn/40!">
          <p className="text-sm">
            {error.message}. Connect another wallet, or sign the message with near-cli-rs and send it with curl, as{" "}
            <Link href="/docs/guides/holder-room#from-a-terminal" className="underline underline-offset-4">
              the holder room guide
            </Link>{" "}
            shows.
          </p>
        </Card>
      ) : (
        <ErrorNote error={error} />
      )}

      {refusal && (
        <Card className="border-bad/40!">
          <div role="alert">
            <p className="text-sm font-medium text-bad">
              {refusal.status === 403 ? "The room stays closed" : `The room answered ${refusal.status}`}
            </p>
            <p className="mt-1 text-sm [overflow-wrap:anywhere]">{refusal.error}</p>
          </div>
          {proof && (
            <div className="mt-3">
              <Button onClick={checkAgain} busy={busy !== null}>
                Check again
              </Button>
            </div>
          )}
        </Card>
      )}

      {room && (
        <>
          <HolderCard room={room} reuseUntil={reuseUntil} busy={busy !== null} onCheckAgain={checkAgain} />
          <Kit room={room} />
        </>
      )}
    </div>
  );
}

function HolderCard({
  room,
  reuseUntil,
  busy,
  onCheckAgain,
}: { room: RoomResponse; reuseUntil: number; busy: boolean; onCheckAgain: () => void }) {
  const net = useNetwork();
  const { holder, satchel } = room;
  const rows: [string, ReactNode][] = [
    ["Account", <ExternalLink key="a" href={nearAccountUrl(net, holder.accountId)}>{holder.accountId}</ExternalLink>],
    [
      "Satchel",
      <span key="s">
        #{holder.tokenId} on <Mono>{holder.contract}</Mono>, record version {satchel.record.version}
        {satchel.listing ? ", listed" : ""}
      </span>,
    ],
    ["Network", `NEAR ${holder.network}`],
    [
      "Checked at",
      <span key="b">
        block <ExternalLink href={nearBlockUrl(net, holder.block.hash)}>{holder.block.height.toLocaleString("en")}</ExternalLink>,{" "}
        <time dateTime={holder.block.timestamp}>{utcDateTime(holder.block.timestamp)}</time>
      </span>,
    ],
    ["Key", <Mono key="k">{holder.publicKey}</Mono>],
  ];
  return (
    <Card className="border-ok/40!">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-semibold">You hold satchel #{holder.tokenId}</h2>
        <Badge tone="ok">Holder</Badge>
      </div>
      <dl className="mt-3 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd className="min-w-0 [overflow-wrap:anywhere]">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-muted">
        Checked again on every request; no cookie. Check again sends this signature until{" "}
        <time dateTime={new Date(reuseUntil).toISOString()}>{utcTime(reuseUntil)}</time>; after that, it asks your wallet
        to sign again.
      </p>
      <div className="mt-3">
        <Button onClick={onCheckAgain} busy={busy}>
          Check again
        </Button>
      </div>
    </Card>
  );
}

function Kit({ room }: { room: RoomResponse }) {
  const net = useNetwork();
  const { report, kit, holder } = room;
  const page = appPath(net, `/satchel/${holder.tokenId}`);
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-semibold">Handover kit</h2>
        {report && <Badge tone={VERDICT[report.verdict].tone}>{VERDICT[report.verdict].label}</Badge>}
      </div>
      <p className="mt-1 text-sm text-muted">
        What to do before you sell satchel #{holder.tokenId}, from its clean transfer report, read on the server just now.
        Anyone can read the same report on the satchel&apos;s page. When it isn&apos;t clean, the page also shows Make it clean
        under the report: the revokes and nonce spends that would fix checks 2 and 3, and an owner&apos;s button for each one
        the app can send.
      </p>
      {isFrozen(net, holder.tokenId) && (
        <div className="mt-3 rounded-xl bg-paper-2 px-3 py-2 text-sm text-ink-2">
          <p>
            {FROZEN_NOTE} On this satchel&apos;s page, Make it clean shows the plan without its buttons, so the steps below that
            name a button don&apos;t apply here until then. This is a guard in the app only: the CLI commands below still sign.
          </p>
        </div>
      )}
      {room.reportError && (
        <div className="mt-3 rounded-xl bg-bad-soft px-3 py-2 text-sm text-bad">
          <p>{room.reportError}. Open the report on the satchel&apos;s page instead.</p>
        </div>
      )}
      {kit && (
        <ol className="mt-4 space-y-5">
          {kit.map((step) => (
            <KitItem key={step.check ?? step.action} step={step} />
          ))}
        </ol>
      )}
      <p className="mt-5 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-sm">
        <Link href={page} className="underline decoration-line underline-offset-4 hover:decoration-ink">
          Satchel #{holder.tokenId}&apos;s page
        </Link>
        <Link href={`${page}#report`} className="underline decoration-line underline-offset-4 hover:decoration-ink">
          Its clean transfer report
        </Link>
      </p>
    </Card>
  );
}

function KitItem({ step }: { step: KitStep }) {
  const action = ACTION[step.action];
  return (
    <li className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={action.tone}>{action.label}</Badge>
        <p className="font-medium">{step.title}</p>
      </div>
      {step.found.length > 0 && (
        <ul className="mt-1 max-w-[36em] space-y-0.5 text-sm text-muted">
          {step.found.map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: two approval rows can read the same
            <li key={i} className="[overflow-wrap:anywhere]">
              {line}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-sm text-ink-2">{step.means}</p>
      <ol className="mt-2 max-w-[36em] list-decimal space-y-1 pl-5 text-sm">
        {step.todo.map((line) => (
          <li key={line} className="[overflow-wrap:anywhere]">
            {line}
          </li>
        ))}
      </ol>
      {step.docs && (
        <p className="mt-2 text-sm">
          <Link href={step.docs} className="underline decoration-line underline-offset-4 hover:decoration-ink">
            More in the docs
          </Link>
        </p>
      )}
    </li>
  );
}
