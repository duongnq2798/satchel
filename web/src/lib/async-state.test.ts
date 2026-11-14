import { describe, expect, it } from "vitest";
import { EMPTY, type RunState, ask, settle, tokenFor, viewOf } from "./async-state";

const ok = <T>(value: T) => ({ ok: true as const, value });
const fail = (error: unknown) => ({ ok: false as const, error });

describe("the useAsync state machine", () => {
  it("loads from EMPTY without an initial result", () => {
    expect(viewOf(EMPTY, "a", undefined, undefined)).toEqual({ data: undefined, error: null, lastError: null, loading: true });
  });

  it("shows an initial result as settled, with no read", () => {
    expect(tokenFor(EMPTY, "a")).toEqual({ token: "0:a", first: true });
    expect(viewOf<string>(EMPTY, "a", undefined, "X")).toEqual({ data: "X", error: null, lastError: null, loading: false });
  });

  it("keeps data across keys, keeps it through a failure, and clears lastError on success", () => {
    let s: RunState<number> = settle<number>(EMPTY, "0:a", undefined, ok(1), undefined);
    expect(viewOf(s, "a", undefined, undefined)).toMatchObject({ data: 1, loading: false });

    expect(viewOf(s, "b", undefined, undefined)).toEqual({ data: 1, error: null, lastError: null, loading: true });

    const E = new Error("E");
    s = settle(s, "0:b", undefined, fail(E), undefined);
    expect(viewOf(s, "b", undefined, undefined)).toEqual({ data: 1, error: E, lastError: E, loading: false });

    s = ask(s, "b");
    expect(tokenFor(s, "b")).toEqual({ token: "1:b", first: false });
    expect(viewOf(s, "b", undefined, undefined)).toEqual({ data: 1, error: null, lastError: E, loading: true });

    s = settle(s, "1:b", undefined, ok(2), undefined);
    expect(viewOf(s, "b", undefined, undefined)).toEqual({ data: 2, error: null, lastError: null, loading: false });
  });

  it("clears data when the identity changes with the key", () => {
    const E = new Error("E");
    const u1 = settle<number>(EMPTY, "0:u1", "u1", ok(1), undefined);
    expect(viewOf(u1, "u2", "u2", undefined)).toEqual({ data: undefined, error: null, lastError: null, loading: true });
    const u2 = settle(u1, "0:u2", "u2", fail(E), undefined);
    expect(viewOf(u2, "u2", "u2", undefined)).toEqual({ data: undefined, error: E, lastError: E, loading: false });
    expect(viewOf(u2, "u3", "u3", undefined).lastError).toBeNull();
  });

  it("leaves the current key loading when a stale run settles", () => {
    const s = settle<number>(EMPTY, "0:a", undefined, ok(1), undefined);
    expect(viewOf(s, "b", undefined, undefined).loading).toBe(true);
  });

  it("counts reloads per key and starts over on a new key", () => {
    const s = ask(ask(EMPTY, "a"), "a");
    expect(tokenFor(s, "a")).toEqual({ token: "2:a", first: false });
    expect(tokenFor(s, "b")).toEqual({ token: "0:b", first: true });
  });

  it("keeps an initial result on screen through a reload and its failure", () => {
    const s = ask<string>(EMPTY, "a");
    expect(viewOf(s, "a", undefined, "X")).toMatchObject({ data: "X", loading: true });
    const E = new Error("E");
    const failed = settle(s, "1:a", undefined, fail(E), "X");
    expect(viewOf(failed, "a", undefined, "X")).toEqual({ data: "X", error: E, lastError: E, loading: false });
  });
});
