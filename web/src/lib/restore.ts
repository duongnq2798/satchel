/**
 * How long a page waits for a saved wallet to name its account before it offers "Connect wallet"
 * instead. On 2026-11-10 Meteor's extension, locked, once didn't answer until it was unlocked, and
 * the page showed only "Looking for your wallet…" until then; other loads with it locked answered
 * within 2 s.
 */
export const RESTORE_TIMEOUT_MS = 8_000;

/**
 * `read`'s answer, or null if the saved wallet, as `saved` reads it, changed while `read` ran. A
 * connect that fails inside the wallet the user picked leaves that wallet saved, so a late answer from
 * the wallet saved before would name an account the page can't sign with.
 */
export async function fromSameWallet(
  saved: () => string | null,
  read: () => Promise<string | null>,
): Promise<string | null> {
  const before = saved();
  const accountId = await read();
  return saved() === before ? accountId : null;
}

/**
 * Asks a saved wallet which account it has, through `read`, and passes the answer to `answer`: an
 * account, or null for none. If the wallet hasn't answered after `ms`, `answer(null)` comes first, so
 * the page can offer "Connect wallet"; an account the wallet names later still follows, once it is
 * unlocked. A late "none" is dropped: by then the page says that already, and the user may have
 * connected since. Returns a function that stops every later call.
 */
export function restoreAccount(
  read: () => Promise<string | null>,
  answer: (accountId: string | null) => void,
  ms: number = RESTORE_TIMEOUT_MS,
): () => void {
  let live = true;
  let late = false;
  const timer = setTimeout(() => {
    late = true;
    if (live) answer(null);
  }, ms);
  const settle = (accountId: string | null) => {
    clearTimeout(timer);
    if (live && !(late && accountId === null)) answer(accountId);
  };
  read().then(settle, () => settle(null));
  return () => {
    live = false;
    clearTimeout(timer);
  };
}
