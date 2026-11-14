import { readFileSync } from "node:fs";
import { type RpcCall, RpcError } from "../near-rpc.js";

// Recorded chain answers, replayed. Every fixture under primitives/ was written by
// scripts/capture-primitive-fixtures.mjs and is never edited by hand: a test that needs a broken
// answer changes a deep copy and says what it changed.

/** Where a fixture came from. */
export interface Provenance {
  network: "mainnet" | "testnet" | "base" | "sepolia" | "upstream";
  /** The node's origin only. */
  rpc?: string;
  /** A deployments file and JSON path, or a URL and commit for upstream data. */
  source?: string;
  method?: string;
  params?: unknown;
  block?: { height: number; hash: string; why: string };
  capturedAt: string;
  capturedBy: "scripts/capture-primitive-fixtures.mjs";
  /** From `status`: version.version and version.build of each node read. */
  nodeVersion?: string;
  modified: false;
  notes?: string;
}

/** Many recorded calls. A recorded `error` is the JSON-RPC error the node answered. */
export interface Cassette {
  provenance: Provenance;
  calls: { method: string; params: unknown; result?: unknown; error?: unknown }[];
}

/** One recorded call. */
export interface OneCall<T = unknown> {
  provenance: Provenance;
  result: T;
}

/**
 * A fixture under src/__fixtures__, read with readFileSync and JSON.parse, so tsc infers no type for
 * a large answer. `relativePath` is relative to src/__fixtures__.
 */
export function loadFixture<T = Cassette>(relativePath: string): T {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8")) as T;
}

/** A one-call fixture as a cassette of that call, from its provenance's method and params. */
export function cassetteOf(fixture: OneCall): Cassette {
  const { method, params } = fixture.provenance;
  if (typeof method !== "string") throw new Error("replay: the fixture's provenance names no method");
  return { provenance: fixture.provenance, calls: [{ method, params, result: fixture.result }] };
}

/** JSON with every object's keys sorted: how calls are matched. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((k) => record[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

type Call = Cassette["calls"][number];

function index(cassette: Cassette) {
  const byKey = new Map<string, Call>();
  for (const call of cassette.calls) {
    const key = `${call.method} ${canonicalJson(call.params)}`;
    if (!byKey.has(key)) byKey.set(key, call);
  }
  const used = new Set<Call>();
  const find = (method: string, params: unknown): Call => {
    const call = byKey.get(`${method} ${canonicalJson(params)}`);
    if (!call) throw new Error(`replay: no recorded answer for ${method} ${canonicalJson(params)}`);
    used.add(call);
    return call;
  };
  const unused = () => cassette.calls.filter((c) => !used.has(c)).map((c) => ({ method: c.method, params: c.params }));
  return { find, unused };
}

/**
 * An RpcCall that answers from `cassette`, matching method and params (keys sorted). An unrecorded
 * call throws, so a unit test can never reach the network. A recorded error throws as the RpcError
 * httpRpc would throw for it. `unused()` lists the recorded calls nothing asked for.
 */
export function replayRpc(cassette: Cassette): RpcCall & { unused(): { method: string; params: unknown }[] } {
  const { find, unused } = index(cassette);
  const endpoint = cassette.provenance.rpc ?? "replay";
  const call = async <T>(method: string, params: unknown): Promise<T> => {
    const recorded = find(method, params);
    if (recorded.error !== undefined) {
      throw new RpcError({ method, kind: "rpc-error", endpoint, detail: JSON.stringify(recorded.error), data: recorded.error });
    }
    return structuredClone(recorded.result) as T;
  };
  return Object.assign(call as RpcCall, { unused });
}

/** An EIP-1193 request function that answers from `cassette`, as replayRpc does for NEAR. */
export function replayEvm(cassette: Cassette): ((args: { method: string; params?: unknown }) => Promise<unknown>) & {
  unused(): { method: string; params: unknown }[];
} {
  const { find, unused } = index(cassette);
  const request = async ({ method, params }: { method: string; params?: unknown }) => {
    const recorded = find(method, params ?? []);
    if (recorded.error !== undefined) throw Object.assign(new Error(`replay: ${method} answered an error`), { data: recorded.error });
    return structuredClone(recorded.result);
  };
  return Object.assign(request, { unused });
}
