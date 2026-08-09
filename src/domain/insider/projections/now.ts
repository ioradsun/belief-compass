/**
 * INSIDER NOW — "of everything the Insider knows, what deserves your attention,
 * and in what order?"
 *
 * This projection owns the EDITORIAL DECISION the tape used to make inside the
 * component: rank the candidates (dominance caps, family variety, significance —
 * `mixFeed`), choose the window by that rank, then render the chosen rows in the
 * reader's temporal model (`arrangeFeed`), and name the honest tail state
 * (`tailState`). One place, one answer, reusable by any surface.
 *
 * WHAT STAYS IN THE COMPONENT: animation and attention mechanics — the update
 * gate, the arrival scheduler, scroll behaviour. Intelligence is domain work;
 * "when does this row slide in" is UI work. The split is deliberate.
 *
 * PARITY BY CONSTRUCTION: this composes the exact primitives the tape called, in
 * the same order, so the rendered column is unchanged — only its owner is.
 *
 * Pure, ZERO IO, deterministic.
 */
import { mixFeed, type MixCandidate } from "../../feed-cadence";
import {
  arrangeFeed,
  tailState,
  type DisplayRow,
  type TailState,
} from "../../live-display";

/** The minimum a row must carry to be placed by Now: a place in time + a rank. */
export interface NowRow extends DisplayRow {
  /** The mixer's view of this row. Absent ⇒ no quality signal; recency decides. */
  mix?: MixCandidate | null;
}

export interface NowQuery {
  /**
   * How many timed rows to show. `null` = show everything the caller released,
   * in the caller's order — an embedded rail is short and scrolls inside a host
   * panel, so windowing is not its concern.
   */
  limit: number | null;
  /** Rows the reader explicitly asked for; they lead the column. */
  pinned?: ReadonlySet<string>;
  /**
   * Rank the window against THIS candidate set rather than the rows being
   * placed. The tape ranks the full admitted pool, then places only what the
   * arrival scheduler has released so far — the two are the same editorial
   * judgment applied at two moments. Defaults to `rows`.
   */
  rankOver?: readonly NowRow[];
  /** Arrivals held behind the "N New" control, for the tail state. */
  pending?: number;
  /** A fetch is in flight; the tail must not claim "caught up". */
  loading?: boolean;

}

export interface InsiderNowFeed<T extends NowRow> {
  /** What to render, in display order. */
  shown: T[];
  /** Older eligible rows beyond the window — the "Show earlier" count. */
  hidden: number;
  /** more | streaming | caught_up | empty. */
  tail: TailState;
}

/**
 * Rank lookup for a candidate set: the mixer's quality order, by row id.
 * `null` when nothing carries a mix — the tape then falls back to recency.
 */
export function nowRanking(rows: readonly NowRow[]): Map<string, number> | null {
  const cands = rows.map((r) => r.mix).filter((m): m is MixCandidate => m != null);
  if (cands.length === 0) return null;
  const map = new Map<string, number>();
  mixFeed(cands).forEach((m, i) => map.set(m.id, i));
  return map;
}

/** SELECT by rank, DISPLAY by time, then say which tail state the feed is in. */
export function now<T extends NowRow>(
  rows: readonly T[],
  query: NowQuery,
): InsiderNowFeed<T> {
  const arranged =
    query.limit == null
      ? { shown: [...rows], hidden: 0 }
      : (() => {
          const rank = nowRanking(query.rankOver ?? rows);
          return arrangeFeed(rows, {
            rankOf: (id) => rank?.get(id),
            limit: query.limit,
            ...(query.pinned ? { pinned: query.pinned } : {}),
          });
        })();

  return {
    shown: arranged.shown,
    hidden: arranged.hidden,
    tail: tailState({
      shown: arranged.shown.length,
      hidden: arranged.hidden,
      pending: query.pending ?? 0,
      loading: query.loading ?? false,
    }),
  };
}
