"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { type Address, type Hex, formatEther, isAddress, isHex, parseEther } from "viem";
import {
  type ChainInfo,
  type MpcSignature,
  type SendDeps,
  type SendResult,
  type SendStep,
  liveSendDeps,
  nearTxUrl,
  sendChains,
  sendFromSatchel,
} from "satchel-nft";
import { TimeoutError, errorMessage } from "@/lib/errors";
import { FROZEN_NOTE } from "@/lib/frozen";
import { appPath } from "@/lib/routes";
import { sendFailure } from "@/lib/send-failure";
import { TIMING, deadline } from "@/lib/timing";
import { useNetwork } from "./network";
import { Button, Card, ErrorNote, ExternalLink } from "./ui";
import { useWait } from "./use-async";
import { useWallet } from "./wallet";

const STEPS: { id: SendStep; label: string }[] = [
  { id: "build", label: "Build the transaction and check the balance" },
  { id: "hash", label: "Check the contract hashes it the same way" },
  { id: "wallet", label: "Approve sign_evm in your wallet; NEAR's MPC network signs" },
  { id: "recover", label: "Check the signature recovers to this satchel's address" },
  { id: "broadcast", label: "Broadcast" },
  { id: "confirm", label: "Wait for the receipt" },
];

/**
 * The satchels with a send running, as `<network>:<token id>`: one send at a time per satchel, from
 * any panel, since a second one would sign the same pending nonce again. Keyed, so a send left
 * running on one satchel's page doesn't block another satchel after the app navigates.
 */
const sending = new Set<string>();

/** How long the contract's own hash of the transaction may take before the send stops, unsigned. */
const HASH_MS = 15_000;

/** `deps` with the contract's hash bounded, so a hung NEAR view fails step 2 and frees the lock. */
function bounded(deps: SendDeps): SendDeps {
  return {
    ...deps,
    contractHash: (tx) =>
      deadline(deps.contractHash(tx), HASH_MS, "NEAR RPC").catch((err: unknown) => {
        throw err instanceof TimeoutError ? new TimeoutError(`${err.message} Nothing was signed.`) : err;
      }),
  };
}

export interface SendInput {
  chain: ChainInfo;
  to: Address;
  value: bigint;
  data: Hex;
}

export interface SendRun {
  /** False when nothing was sent: another send was running, or `build` threw (its error is shown). */
  started: boolean;
  result: SendResult | null;
  /** The last step the send reached, so a caller can tell a send that was broadcast from one that wasn't. */
  reached: SendStep | null;
}

/**
 * Sends from a satchel through `sendFromSatchel`, with every guard it runs and the wallet's prompt,
 * and keeps the steps, the links and the result for `SendSteps`. Send from this satchel and the
 * Make it clean card both send this way.
 */
export function useSatchelSend(tokenId: string, address: Address) {
  const { send } = useWallet();
  const net = useNetwork();
  const [step, setStep] = useState<SendStep | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<SendResult | null>(null);
  // The links stay up if a later step fails: the NEAR call, and the EVM hash once it is signed.
  const [links, setLinks] = useState<{ chain?: ChainInfo; fee?: bigint; nearTx?: string; evmTx?: string }>({});
  const [busy, setBusy] = useState(false);

  /**
   * Builds the transaction's fields with `build`, which may read the chain first, then sends. The
   * lock is taken before `build` runs, so a second click can't start a send meanwhile.
   */
  async function run(build: () => SendInput | Promise<SendInput>): Promise<SendRun> {
    const lock = `${net.id}:${tokenId}`;
    if (sending.has(lock)) {
      if (!busy) setError(new Error("Another send from this satchel is still running. Wait for it to finish."));
      return { started: false, result: null, reached: null };
    }
    sending.add(lock);
    setBusy(true);
    setError(null);
    setResult(null);
    setStep(null);
    setLinks({});
    let reached: SendStep | null = null;
    try {
      let input: SendInput;
      try {
        input = await build();
      } catch (err) {
        setError(err);
        return { started: false, result: null, reached };
      }
      const signWithWallet = async (tx: Parameters<typeof send>[0]) => {
        const { hash, value: signature } = await send<MpcSignature>(tx, (p) => {
          // The NEAR call's link as soon as the wallet returns it, before MPC answers.
          if (p.phase === "sent") setLinks((l) => ({ ...l, nearTx: p.hash }));
        });
        return { hash, signature };
      };
      setLinks({ chain: input.chain });
      const done = await sendFromSatchel(
        { net, tokenId, from: address, ...input },
        bounded(liveSendDeps(net, signWithWallet)),
        (s, detail) => {
          reached = s;
          setStep(s);
          if (s === "wallet" && detail) setLinks((l) => ({ ...l, fee: BigInt(detail) }));
          if (s === "recover" && detail) setLinks((l) => ({ ...l, nearTx: detail }));
          if ((s === "broadcast" || s === "confirm") && detail) setLinks((l) => ({ ...l, evmTx: detail }));
        },
      );
      setResult(done);
      return { started: true, result: done, reached };
    } catch (err) {
      setError(err);
      return { started: true, result: null, reached };
    } finally {
      sending.delete(lock);
      setBusy(false);
    }
  }

  return { step, error, result, links, busy, run };
}

/**
 * The steps of the last send, as they run, then its result and links. Screen readers hear the step
 * running as a sentence (the glyphs are hidden from them), then the error or the result.
 */
export function SendSteps({ sender }: { sender: ReturnType<typeof useSatchelSend> }) {
  const net = useNetwork();
  const { step, error, result, links } = sender;
  const reached = step ? STEPS.findIndex((s) => s.id === step) : -1;
  const running = reached >= 0 && !result && !error ? `Step ${reached + 1} of ${STEPS.length}: ${STEPS[reached].label}` : "";
  const slow = useWait(sender.busy && step === "wallet", TIMING.wallet) === "slow";
  // Maybe signed (a cancel, an unsure wallet, a sign_evm NEAR hasn't finished) or maybe on chain: not "failed".
  const { outgoing, unsure } = sendFailure(step, error);
  const ended = unsure ? "Stopped" : "Failed";
  return (
    <div>
      <p role="status" className="sr-only">
        {running || (error && reached >= 0 ? `${ended} at step ${reached + 1}: ${STEPS[reached].label}` : "")}
      </p>
      {step && (
        <ol className="mt-4 space-y-1 text-sm">
          {STEPS.map((s, i) => {
            const done = i < reached || result !== null;
            const current = i === reached && !done;
            const hint = current && !error && slow;
            return (
              <li key={s.id} className={i <= reached ? "text-ink" : "text-muted"}>
                <span aria-hidden="true">{done ? "✓" : current ? (error ? (unsure ? "!" : "✗") : "…") : "·"}</span>{" "}
                <span className="sr-only">{done ? "Done: " : current ? (error ? `${ended}: ` : "Running: ") : "Next: "}</span>
                {s.label}
                {s.id === "wallet" && links.fee !== undefined && links.chain && (
                  <span className="text-muted">
                    {" "}
                    (fees up to {formatEther(links.fee)} {links.chain.symbol}, paid by the satchel)
                  </span>
                )}
                {/* In the layout for the whole send, invisible until the wallet is slow, so it never pushes the page down. */}
                {s.id === "wallet" && sender.busy && (
                  <span className={`mt-1 block text-muted ${hint ? "" : "invisible"}`} aria-hidden={hint ? undefined : true}>
                    Still waiting for your wallet or NEAR&apos;s MPC network. Reloading stops the wait; if you approved, check
                    History before sending again.
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <div aria-live="polite">
        <div className="mt-3">
          {outgoing ? (
            <div role="alert" className="rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">
              <p>{errorMessage(error)}</p>
              <p className="mt-1">It may already be on chain. Open its link and check History before you send again.</p>
            </div>
          ) : (
            <ErrorNote error={error}>{unsure && <p className="mt-1">Check History before you send again.</p>}</ErrorNote>
          )}
        </div>
        {result &&
          (result.status === "success" ? (
            <div className="mt-3 rounded-xl bg-ok-soft px-3 py-2 text-sm text-ok">
              <p>Sent.</p>
            </div>
          ) : (
            <div className="mt-3 rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">
              <p>Included, but the transaction reverted.</p>
            </div>
          ))}
      </div>
      {(links.nearTx || links.evmTx) && (
        <p className="mt-2 text-sm">
          {links.evmTx && links.chain && (
            <ExternalLink href={`${links.chain.explorer}/tx/${links.evmTx}`}>View on {links.chain.name}</ExternalLink>
          )}
          {links.evmTx && links.nearTx && " · "}
          {links.nearTx && <ExternalLink href={nearTxUrl(net, links.nearTx)}>sign_evm on NEAR</ExternalLink>}
        </p>
      )}
    </div>
  );
}

/** In place of a panel's owner or buy actions on a demo satchel (`lib/frozen.ts`). */
export function FrozenNote() {
  const net = useNetwork();
  return (
    <div className="mt-3.5 rounded-xl bg-paper-2 px-3 py-2 text-sm text-ink-2">
      <p>
        {FROZEN_NOTE}{" "}
        <Link href={appPath(net, "/satchels")} className="underline decoration-line underline-offset-4 hover:decoration-ink">
          Mint your own satchel
        </Link>{" "}
        to try them.
      </p>
    </div>
  );
}

export function SendPanel({
  tokenId,
  address,
  onDone,
  frozen = false,
}: {
  tokenId: string;
  address: Address;
  onDone: () => void;
  /** A demo satchel: the form is off (`lib/frozen.ts`). */
  frozen?: boolean;
}) {
  const net = useNetwork();
  const chains = sendChains(net);
  const [chainId, setChainId] = useState(chains[0].id);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [data, setData] = useState("0x");
  const sender = useSatchelSend(tokenId, address);
  const chain = chains.find((c) => c.id === chainId) ?? chains[0];

  async function submit(e: FormEvent) {
    e.preventDefault();
    const { started } = await sender.run(() => {
      if (!isAddress(to)) throw new Error("Enter the recipient's 0x address");
      let value: bigint;
      try {
        value = parseEther(amount.trim() === "" ? "0" : amount.trim());
      } catch {
        throw new Error(`Enter an amount in ${chain.symbol}`);
      }
      if (value < 0n) throw new Error(`Enter an amount in ${chain.symbol}`);
      if (!isHex(data) || data.length % 2 !== 0) throw new Error("Calldata must be 0x followed by whole bytes");
      return { chain, to: to as Address, value, data: data as Hex };
    });
    if (started) onDone();
  }

  return (
    <Card>
      <h2 className="font-display text-xl font-semibold">Send from this satchel</h2>
      <p className="mt-1 text-sm text-muted">
        The contract builds and hashes the transaction, records its nonce in the public record, then asks the MPC network to
        sign. Your wallet only approves the NEAR call.
      </p>
      {frozen ? (
        <FrozenNote />
      ) : (
        <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-[1fr_2fr_1fr]">
          <label className="grid gap-1 text-sm">
            <span className="text-muted">Chain</span>
            <select
              value={chainId}
              onChange={(e) => setChainId(Number(e.target.value))}
              className="rounded-xl border border-line bg-paper px-3 py-2"
            >
              {chains.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted">To</span>
            <input
              value={to}
              onChange={(e) => setTo(e.target.value.trim())}
              placeholder="0x000000000000000000000000000000000000dEaD"
              className="rounded-xl border border-line bg-paper px-3 py-2 font-mono text-xs"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted">Amount ({chain.symbol})</span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.0001"
              inputMode="decimal"
              className="rounded-xl border border-line bg-paper px-3 py-2"
            />
          </label>
          <details className="text-sm sm:col-span-3">
            <summary className="cursor-pointer text-muted">Calldata (advanced)</summary>
            <textarea
              value={data}
              onChange={(e) => setData(e.target.value.trim())}
              rows={2}
              aria-label="Calldata"
              className="mt-2 w-full rounded-xl border border-line bg-paper px-3 py-2 font-mono text-xs"
            />
            <p className="mt-1 text-xs text-muted">
              The contract classifies the call. Approvals are itemized and must be revoked before a clean sale; anything it
              can&apos;t classify makes this satchel unprovable for every later owner.
            </p>
          </details>
          <div className="sm:col-span-3">
            <Button type="submit" variant="primary" busy={sender.busy}>
              Sign and send
            </Button>
          </div>
        </form>
      )}
      <SendSteps sender={sender} />
    </Card>
  );
}
