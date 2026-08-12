/**
 * Calibration — the server side of the Locked 10.
 *
 * The pure sequence lives in `@/domain/calibration`; this module answers the two
 * questions the feed builder needs to pin it: which of the ten this viewer has
 * already DECIDED, and the read-model rows for the ones it still owes them.
 *
 * DECIDED MEANS RECORDED, NEVER INFERRED. A calibration question is answered by a
 * yes/no/pass, and every one of those is written to `viewer_market_decisions` —
 * a pass by `finalizePass`, a purchase by `finalizeBet`, and a free calibration
 * yes/no by `expressBelief` (see beliefs.functions). So completion is a single
 * indexed read of that one ledger, exactly as `viewer-decisions.server` intends,
 * and never a guess assembled from belief tables or token balances.
 *
 * Server-only: reached through server functions that have already verified the
 * caller. Best-effort by construction — a read failure returns "nothing decided"
 * / "no rows", which shows a calibration card again rather than emptying a feed.
 */
import { serviceClient } from "@/lib/supabase-clients";
import { FEED_COLUMNS } from "@/lib/markets.functions";
import { CALIBRATION_SEQUENCE } from "@/domain/calibration";

/** A read-model row as the feed carries it (same shape `listFeed` produces). */
type CalibrationRow = Record<string, unknown> & { onchain_id: number };

/**
 * Which of the Locked 10 this viewer has already decided (yes/no/pass).
 *
 * One bounded read — the decisions ledger, filtered to the ten ids. On any error
 * it returns an empty set: re-showing a calibration card the viewer already
 * answered is strictly safer than the alternative failure, an empty feed.
 */
export async function calibrationDecidedFor(wallet: string): Promise<Set<number>> {
  try {
    const sb = serviceClient();
    const { data, error } = await sb
      .from("viewer_market_decisions")
      .select("market_id")
      .eq("viewer_wallet", wallet.toLowerCase())
      .in("market_id", CALIBRATION_SEQUENCE as unknown as number[]);
    if (error || !data) return new Set();
    return new Set(data.map((r) => Number(r.market_id)));
  } catch {
    return new Set();
  }
}

/**
 * The read-model rows for a set of calibration ids, keyed by onchain_id.
 *
 * The calibration markets are brand-new and quiet, so they rank far below any
 * pool page the feed retrieves — the pin cannot rely on finding them there and
 * reads them by primary key instead. Selected with the exact `FEED_COLUMNS` the
 * feed uses, so a pinned card is the same shape as every other card (title,
 * prices, believers, capital); the momentum/tribe enrichment a fresh market has
 * none of is simply absent, which the card already renders as silence.
 *
 * `sb` is passed in so the caller shares its own service client (and can be null,
 * in which case the caller skips the pin rather than this throwing).
 */
export async function fetchCalibrationRows(
  sb: ReturnType<typeof serviceClient>,
  ids: readonly number[],
): Promise<Map<number, CalibrationRow>> {
  const out = new Map<number, CalibrationRow>();
  if (ids.length === 0) return out;
  try {
    const { data, error } = await sb
      .from("market_state")
      .select(FEED_COLUMNS)
      .in("onchain_id", ids as number[]);
    if (error || !data) return out;
    for (const row of data as unknown as CalibrationRow[]) {
      out.set(Number(row.onchain_id), row);
    }
  } catch {
    // A pin that cannot read its rows simply does not pin — the ordinary feed
    // still renders.
  }
  return out;
}
