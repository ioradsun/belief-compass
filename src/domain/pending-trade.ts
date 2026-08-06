/**
 * A TRANSACTION IN FLIGHT SURVIVES THE PAGE — the pure half.
 *
 * THE DEFECT. The pending hash lived only in React state. A reader who
 * refreshed, backgrounded the app on iOS long enough for Safari to evict the
 * page, or lost connection during the ten seconds a Base block takes, came back
 * to an interface that had forgotten a transaction was in flight — and offered
 * them the buy control again. Signing twice is irreversible and unrecoverable
 * by support, which makes this the most expensive failure the product has.
 *
 * WHAT IS STORED AND WHY EACH FIELD. The hash is the claim; the wallet is who
 * it belongs to (a second account on the same browser must not inherit it); the
 * market and side let the interface say what is pending rather than "something";
 * `submittedAt` bounds it, because a hash we can never resolve must eventually
 * stop blocking the reader.
 *
 * IT IS NEVER CLEARED SILENTLY. A record that ages past `staleAfterMs` is not
 * deleted — it is reported as UNRESOLVED, so the interface can say "we lost
 * track of this, check your wallet" instead of quietly re-enabling a control
 * that might submit the same trade again. Silence is the one outcome that
 * recreates the bug.
 *
 * ZERO IO, pure, fully testable. The caller owns storage.
 */

export interface PendingTrade {
  hash: string;
  /** Lower-cased. A different account must never adopt this record. */
  wallet: string;
  marketId: number;
  side: "YES" | "NO";
  action: "BUY" | "SELL";
  /** Epoch ms at submission — set before the block lands. */
  submittedAt: number;
}

export const PENDING_TRADE = {
  /**
   * Past this, we stop claiming to know. Two minutes is far beyond a Base block
   * (~2s, and a congested one is still seconds) while staying inside the span a
   * reader would plausibly wait — so crossing it means something genuinely went
   * wrong, not that the chain was slow.
   */
  staleAfterMs: 120_000,
} as const;

export type PendingState =
  | { status: "none" }
  /** Still inside the window where the chain is expected to answer. */
  | { status: "pending"; trade: PendingTrade; ageMs: number }
  /**
   * Submitted, never resolved, and now too old to keep waiting on. The reader
   * must be told — never silently returned to a state that can re-submit.
   */
  | { status: "unresolved"; trade: PendingTrade; ageMs: number };

const isSide = (v: unknown): v is "YES" | "NO" => v === "YES" || v === "NO";
const isAction = (v: unknown): v is "BUY" | "SELL" => v === "BUY" || v === "SELL";

/**
 * Parse a stored record, rejecting anything malformed.
 *
 * Storage is shared with every other tab and survives deploys, so a record
 * written by an older build — or by nothing at all — has to be treated as
 * untrusted input rather than as a shape we can assume.
 */
export function parsePending(raw: unknown): PendingTrade | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const hash = typeof o.hash === "string" && o.hash.startsWith("0x") ? o.hash : null;
  const wallet = typeof o.wallet === "string" ? o.wallet.toLowerCase() : null;
  const marketId = Number(o.marketId);
  const submittedAt = Number(o.submittedAt);
  if (!hash || !wallet) return null;
  if (!Number.isFinite(marketId) || !Number.isFinite(submittedAt)) return null;
  if (!isSide(o.side) || !isAction(o.action)) return null;
  return { hash, wallet, marketId, side: o.side, action: o.action, submittedAt };
}

/**
 * What the interface should do about a stored record right now.
 *
 * A record belonging to a DIFFERENT wallet reads as `none`: it is not this
 * reader's transaction, and showing it would attribute someone else's pending
 * trade to them. It is also not deleted here — the owning account may still
 * come back for it.
 */
export function pendingState(
  trade: PendingTrade | null,
  viewer: string | null | undefined,
  nowMs: number,
): PendingState {
  if (!trade) return { status: "none" };
  if (!viewer || trade.wallet !== viewer.toLowerCase()) return { status: "none" };
  const ageMs = Math.max(0, nowMs - trade.submittedAt);
  return ageMs >= PENDING_TRADE.staleAfterMs
    ? { status: "unresolved", trade, ageMs }
    : { status: "pending", trade, ageMs };
}

/**
 * Does a pending record block a new submission?
 *
 * BOTH states block, and that is the point. `pending` blocks because the chain
 * has not answered; `unresolved` blocks because we do not KNOW whether it
 * answered, and "unknown" must never be rendered as "safe to try again". The
 * reader clears an unresolved record deliberately, having checked their wallet.
 */
export function blocksNewTrade(state: PendingState): boolean {
  return state.status !== "none";
}

/** What the reader is told, in the terms they are actually worried about. */
export function pendingCopy(state: PendingState): { title: string; body: string } | null {
  if (state.status === "none") return null;
  const what = `${state.trade.action === "BUY" ? "Backing" : "Selling"} ${state.trade.side}`;
  if (state.status === "pending") {
    return {
      title: `${what} — waiting for Base to confirm`,
      // Three questions, in the order a person asks them: what happened, where
      // is my money, may I leave. The last sentence is only true because the
      // record is persisted; do not ship it without the persistence.
      body: "Your wallet has been debited. This usually takes a few seconds. You can safely leave this screen — the result will be here when you come back.",
    };
  }
  return {
    title: `${what} — we lost track of this transaction`,
    // Never "failed". We do not know that it failed, and saying so is what
    // makes a reader submit a second time.
    body: "It may still have gone through. Check your wallet or the block explorer before trying again.",
  };
}
