"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { useNetwork } from "@/components/network";
import { Button, Card } from "@/components/ui";
import { appPath } from "@/lib/config";
import { CHECKS } from "@/lib/copy";

export default function Verify() {
  const router = useRouter();
  const net = useNetwork();
  const [id, setId] = useState("1");
  const [error, setError] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{1,19}$/.test(id.trim())) {
      setError("Enter a token id, like 1");
      return;
    }
    router.push(appPath(net, `/satchel/${id.trim()}`));
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-display text-4xl font-semibold tracking-tight">Verify a satchel</h1>
        <p className="mt-1 text-ink-2">
          Before you buy or accept one, check what its previous owners could have kept back. No wallet needed.
        </p>
      </div>
      <Card>
        <form onSubmit={submit} className="flex flex-wrap items-start gap-2">
          <div>
            <input
              value={id}
              onChange={(e) => {
                setId(e.target.value);
                setError("");
              }}
              inputMode="numeric"
              aria-label="Token id"
              className="w-40 rounded-xl border border-line bg-paper px-3 py-2"
            />
            {error && <p className="mt-1 text-sm text-bad">{error}</p>}
          </div>
          <Button type="submit" variant="primary">
            Check it
          </Button>
        </form>
      </Card>
      <ol className="space-y-4">
        {CHECKS.map((c, i) => (
          <li key={c.title} className="flex gap-3">
            <span className="font-display text-2xl text-gold">{i + 1}</span>
            <div>
              <p className="font-medium">{c.title}</p>
              <p className="text-sm text-ink-2">{c.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
