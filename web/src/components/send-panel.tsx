"use client";

import { type FormEvent, useRef, useState } from "react";
import { type Address, type Hex, formatEther, isAddress, isHex, parseEther } from "viem";
import { type ChainInfo, nearTxUrl, sendChains } from "@/lib/config";
import type { MpcSignature } from "@/lib/evm";
import { type SendResult, type SendStep, liveSendDeps, sendFromSatchel } from "@/lib/send";
import { useNetwork } from "./network";
import { Button, Card, ErrorNote, ExternalLink } from "./ui";
import { useWallet } from "./wallet";

const STEPS: { id: SendStep; label: string }[] = [
  { id: "build", label: "Build the transaction and check the balance" },
  { id: "hash", label: "Check the contract hashes it the same way" },
  { id: "wallet", label: "Approve sign_evm in your wallet; NEAR's MPC network signs" },
  { id: "recover", label: "Check the signature recovers to this satchel's address" },
  { id: "broadcast", label: "Broadcast" },
  { id: "confirm", label: "Wait for the receipt" },
];

export function SendPanel({ tokenId, address, onDone }: { tokenId: string; address: Address; onDone: () => void }) {
  const { send } = useWallet();
  const net = useNetwork();
  const chains = sendChains(net);
  const [chainId, setChainId] = useState(chains[0].id);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [data, setData] = useState("0x");
  const [step, setStep] = useState<SendStep | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<SendResult | null>(null);
  // The links stay up if a later step fails: the NEAR call, and the EVM hash once it is signed.
  const [links, setLinks] = useState<{ chain?: ChainInfo; fee?: bigint; nearTx?: string; evmTx?: string }>({});
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const chain = chains.find((c) => c.id === chainId) ?? chains[0];

  async function submit(e: FormEvent) {
    e.preventDefault();
    // One flow at a time: a second one would sign the same pending nonce again.
    if (running.current) return;
    setError(null);
    setResult(null);
    setStep(null);
    setLinks({});
    let value: bigint;
    try {
      if (!isAddress(to)) throw new Error("Enter the recipient's 0x address");
      value = parseEther(amount.trim() === "" ? "0" : amount.trim());
      if (value < 0n) throw new Error(`Enter an amount in ${chain.symbol}`);
      if (!isHex(data) || data.length % 2 !== 0) throw new Error("Calldata must be 0x followed by whole bytes");
    } catch (err) {
      setError(err instanceof Error && !/parseEther|Number/.test(err.message) ? err : new Error(`Enter an amount in ${chain.symbol}`));
      return;
    }
    const signWithWallet = async (tx: Parameters<typeof send>[0]) => {
      const { hash, value: signature } = await send<MpcSignature>(tx);
      return { hash, signature };
    };
    running.current = true;
    setBusy(true);
    setLinks({ chain });
    try {
      const done = await sendFromSatchel(
        { net, tokenId, from: address, chain, to: to as Address, value, data: data as Hex },
        liveSendDeps(net, signWithWallet),
        (s, detail) => {
          setStep(s);
          if (s === "wallet" && detail) setLinks((l) => ({ ...l, fee: BigInt(detail) }));
          if (s === "recover" && detail) setLinks((l) => ({ ...l, nearTx: detail }));
          if ((s === "broadcast" || s === "confirm") && detail) setLinks((l) => ({ ...l, evmTx: detail }));
        },
      );
      setResult(done);
    } catch (err) {
      setError(err);
    } finally {
      running.current = false;
      setBusy(false);
      onDone();
    }
  }

  const reached = step ? STEPS.findIndex((s) => s.id === step) : -1;
  return (
    <Card>
      <h2 className="font-display text-xl font-semibold">Send from this satchel</h2>
      <p className="mt-1 text-sm text-muted">
        The contract builds and hashes the transaction, records its nonce in the public record, then asks the MPC network to
        sign. Your wallet only approves the NEAR call.
      </p>
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
            className="mt-2 w-full rounded-xl border border-line bg-paper px-3 py-2 font-mono text-xs"
          />
          <p className="mt-1 text-xs text-muted">
            The contract classifies the call. Approvals are itemized and must be revoked before a clean sale; anything it
            can't classify makes this satchel unprovable for every later owner.
          </p>
        </details>
        <div className="sm:col-span-3">
          <Button type="submit" variant="primary" busy={busy}>
            Sign and send
          </Button>
        </div>
      </form>
      {step && (
        <ol className="mt-4 space-y-1 text-sm">
          {STEPS.map((s, i) => (
            <li key={s.id} className={i <= reached ? "text-ink" : "text-muted"}>
              {i < reached || result ? "✓" : i === reached ? (error ? "✗" : "…") : "·"} {s.label}
              {s.id === "wallet" && links.fee !== undefined && links.chain && (
                <span className="text-muted">
                  {" "}
                  (fees up to {formatEther(links.fee)} {links.chain.symbol}, paid by the satchel)
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
      <div className="mt-3">
        <ErrorNote error={error} />
      </div>
      {result && (
        <p className="mt-3 rounded-xl bg-ok-soft px-3 py-2 text-sm text-ok">
          {result.status === "success" ? "Sent." : "Included, but the transaction reverted."}
        </p>
      )}
      {(links.nearTx || links.evmTx) && (
        <p className="mt-2 text-sm">
          {links.evmTx && links.chain && (
            <ExternalLink href={`${links.chain.explorer}/tx/${links.evmTx}`}>View on {links.chain.name}</ExternalLink>
          )}
          {links.evmTx && links.nearTx && " · "}
          {links.nearTx && <ExternalLink href={nearTxUrl(net, links.nearTx)}>sign_evm on NEAR</ExternalLink>}
        </p>
      )}
    </Card>
  );
}
