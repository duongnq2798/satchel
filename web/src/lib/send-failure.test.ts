import { describe, expect, it } from "vitest";
import { PendingTx, UserRejected, WalletUnsure } from "./errors";
import { sendFailure } from "./send-failure";

/** viem's error for a failed node request: not a TypeError, and its text may say 429. */
class HttpRequestError extends Error {
  override name = "HttpRequestError";
}

describe("sendFailure", () => {
  it("is nothing without an error", () => {
    expect(sendFailure("confirm", null)).toEqual({ outgoing: false, unsure: false });
  });

  it.each(["broadcast", "confirm"] as const)("never offers a plain retry at %s, online or not", (step) => {
    const lost = new HttpRequestError("HTTP request failed. Details: Too Many Requests");
    expect(sendFailure(step, lost, false)).toEqual({ outgoing: true, unsure: true });
    expect(sendFailure(step, lost, true)).toEqual({ outgoing: true, unsure: true });
  });

  it("is unsure, not outgoing, for a cancel, an unsure wallet or an unfinished sign_evm", () => {
    expect(sendFailure("wallet", new UserRejected("tx"), false)).toEqual({ outgoing: false, unsure: true });
    expect(sendFailure("wallet", new WalletUnsure(new Error("x")), false)).toEqual({ outgoing: false, unsure: true });
    expect(sendFailure("wallet", new PendingTx("h"), true)).toEqual({ outgoing: false, unsure: true });
  });

  it("is a plain failure before anything was signed", () => {
    expect(sendFailure("build", new Error("Enter the recipient's 0x address"), true)).toEqual({ outgoing: false, unsure: false });
    expect(sendFailure("hash", new TypeError("Failed to fetch"), false)).toEqual({ outgoing: false, unsure: false });
  });
});
