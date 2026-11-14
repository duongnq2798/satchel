/** A wait that ran out. Its message says what didn't answer, and in how long. */
export class TimeoutError extends Error {
  override name = "TimeoutError";
}

const REJECTED = {
  tx: "Your wallet closed without returning a transaction. If you approved it, it can still go through.",
  sign: "Cancelled in your wallet. Nothing was signed.",
  connect: "The wallet picker closed. Nothing was connected.",
} as const;

/** The user closed or refused the wallet's prompt. Made only at the wallet boundary, never from text elsewhere. */
export class UserRejected extends Error {
  override name = "UserRejected";
  constructor(
    readonly during: keyof typeof REJECTED,
    options?: { cause?: unknown },
  ) {
    super(REJECTED[during], options);
  }
}

const PENDING = "Sent, but NEAR hasn't finalized it yet.";

/** The wallet returned `hash`, but NEAR hadn't finished it when the page stopped waiting. */
export class PendingTx extends Error {
  override name = "PendingTx";
  constructor(
    readonly hash: string,
    options?: { cause?: unknown },
  ) {
    super(PENDING, options);
  }
}

/**
 * The wallet's own send threw after its prompt opened, with no hash and no refusal: the transaction
 * may still have gone out, so the page never words it as a plain failure to retry.
 */
export class WalletUnsure extends Error {
  override name = "WalletUnsure";
  constructor(cause: unknown) {
    const said = errorMessage(cause).trim();
    const stop = /[.!?]$/.test(said) ? "" : ".";
    super(`Your wallet reported an error: ${said}${stop} If you approved it, it can still go through: check before you try again.`, { cause });
  }
}

export type ErrorKind = "rejected" | "pending" | "offline" | "timeout" | "rate-limit" | "chunk" | "unreachable" | "other";

const TIMEOUT = /no answer (from .+ )?in \d|timed? ?out|took too long/i;
const RATE_LIMIT = /HTTP 429|too many requests|rate.?limit/i;
const CHUNK = /dynamically imported module|loading chunk|importing a module script failed/i;
const UNREACHABLE = /failed to fetch|networkerror|load failed/i;

const nameOf = (error: unknown) => (error && typeof error === "object" && "name" in error ? error.name : undefined);

/** What kind of failure `error` is, checked in a fixed order; free text never makes one `rejected`. */
export function errorKind(error: unknown, online = typeof navigator === "undefined" || navigator.onLine): ErrorKind {
  if (error instanceof UserRejected) return "rejected";
  if (error instanceof PendingTx) return "pending";
  // Its own hedged words, even offline: "check your connection, then try again" could send it twice.
  if (error instanceof WalletUnsure) return "other";
  if (online === false) return "offline";
  const text = errorMessage(error);
  if (error instanceof TimeoutError || nameOf(error) === "TimeoutError" || TIMEOUT.test(text)) return "timeout";
  if (RATE_LIMIT.test(text)) return "rate-limit";
  if (CHUNK.test(text)) return "chunk";
  if (error instanceof TypeError && UNREACHABLE.test(text)) return "unreachable";
  return "other";
}

/** `error` as a sentence for the page: what happened and what to do, by its kind. */
export function errorText(error: unknown, online?: boolean): string {
  switch (errorKind(error, online)) {
    case "rejected":
      return REJECTED[(error as UserRejected).during];
    case "pending":
      return PENDING;
    case "offline":
      return "You seem to be offline. Check your connection, then try again.";
    case "rate-limit":
      return "A public node is turning requests away for now. Try again in a minute.";
    case "chunk":
      return "Couldn't load part of the page. Check your connection, then try again.";
    case "unreachable":
      return "Couldn't reach a node. It may be down or blocked; try again.";
    default:
      return errorMessage(error);
  }
}

/** Wallets reject with strings, Errors or plain objects; show each as words, not "[object Object]". */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

/** Only for an error the wallet's own call threw (connect, signAndSendTransaction, signMessage). */
export function walletRefused(error: unknown): boolean {
  return /reject|denied|cancel|closed|abort/i.test(errorMessage(error));
}
