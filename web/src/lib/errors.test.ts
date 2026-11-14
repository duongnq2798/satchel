import { NearRpcError } from "satchel-nft";
import { describe, expect, it } from "vitest";
import { PendingTx, TimeoutError, UserRejected, WalletUnsure, errorKind, errorMessage, errorText, walletRefused } from "./errors";

describe("errorKind and errorText", () => {
  it.each([
    [new UserRejected("tx"), "rejected", "Your wallet closed without returning a transaction. If you approved it, it can still go through."],
    [new UserRejected("sign"), "rejected", "Cancelled in your wallet. Nothing was signed."],
    [new UserRejected("connect"), "rejected", "The wallet picker closed. Nothing was connected."],
    [new PendingTx("9xHash", { cause: new Error("no answer in 10 s") }), "pending", "Sent, but NEAR hasn't finalized it yet."],
    [new TimeoutError("No answer from the report in 45 s."), "timeout", "No answer from the report in 45 s."],
    [new NearRpcError("tx", "no answer in 10 s"), "timeout", "NEAR RPC tx failed: no answer in 10 s"],
    [new DOMException("signal timed out", "TimeoutError"), "timeout", "signal timed out"],
    [new Error("The request took too long"), "timeout", "The request took too long"],
    [new Error("RPC returned HTTP 429"), "rate-limit", "A public node is turning requests away for now. Try again in a minute."],
    [new Error("Too Many Requests"), "rate-limit", "A public node is turning requests away for now. Try again in a minute."],
    [
      new TypeError("Failed to fetch dynamically imported module: https://x/_next/static/chunks/a.js"),
      "chunk",
      "Couldn't load part of the page. Check your connection, then try again.",
    ],
    [new Error("Loading chunk 42 failed."), "chunk", "Couldn't load part of the page. Check your connection, then try again."],
    [new TypeError("Failed to fetch"), "unreachable", "Couldn't reach a node. It may be down or blocked; try again."],
    [new TypeError("NetworkError when attempting to fetch resource."), "unreachable", "Couldn't reach a node. It may be down or blocked; try again."],
    [new TypeError("Load failed"), "unreachable", "Couldn't reach a node. It may be down or blocked; try again."],
    [new Error("Rejected"), "other", "Rejected"],
    ["User rejected the request", "other", "User rejected the request"],
    [new Error("Failed to fetch"), "other", "Failed to fetch"],
    [{ message: "plain object" }, "other", "plain object"],
  ])("%s is %s", (error, kind, text) => {
    expect(errorKind(error, true)).toBe(kind);
    expect(errorText(error, true)).toBe(text);
  });

  it("says offline before anything but a wallet's answer", () => {
    const offline = "You seem to be offline. Check your connection, then try again.";
    expect(errorKind(new TypeError("Failed to fetch"), false)).toBe("offline");
    expect(errorText(new TypeError("Failed to fetch"), false)).toBe(offline);
    expect(errorKind(new TimeoutError("No answer from X in 2 s."), false)).toBe("offline");
    expect(errorKind(new UserRejected("sign"), false)).toBe("rejected");
    expect(errorKind(new PendingTx("h"), false)).toBe("pending");
  });

  it("keeps an unsure wallet's hedge, even offline", () => {
    const unsure = new WalletUnsure(new Error("Failed to fetch"));
    expect(errorKind(unsure, false)).toBe("other");
    expect(errorText(unsure, false)).toBe(
      "Your wallet reported an error: Failed to fetch. If you approved it, it can still go through: check before you try again.",
    );
    expect(errorText(new WalletUnsure("HTTP 429 Too Many Requests."), true)).toContain("Requests. If you approved it, it can still go through");
    expect(unsure.cause).toBeInstanceOf(Error);
  });

  it("keeps the hash and cause of a pending transaction", () => {
    const cause = new Error("no answer in 10 s");
    const pending = new PendingTx("9xHash", { cause });
    expect(pending.hash).toBe("9xHash");
    expect(pending.cause).toBe(cause);
    expect(new UserRejected("tx", { cause }).during).toBe("tx");
  });
});

describe("errorMessage", () => {
  it("shows strings, Errors and objects as words", () => {
    expect(errorMessage("plain")).toBe("plain");
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage({ code: 1 })).toBe('{"code":1}');
    expect(errorMessage(undefined)).toBe("undefined");
  });
});

describe("walletRefused", () => {
  it.each(["User rejected", "Request denied", "User cancelled", "Window closed", "AbortError"])("%s is a refusal", (text) => {
    expect(walletRefused(new Error(text))).toBe(true);
  });

  it("is not a refusal for anything else", () => {
    expect(walletRefused(new Error("Insufficient balance"))).toBe(false);
  });
});
