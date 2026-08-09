/**
 * PULSE RELEASE — who decides that the page has gone quiet.
 *
 * The audit's one open question was where "silence" is measured. The obvious
 * server answer — the age of the newest event — is NOT the same variable and
 * can diverge badly: an event that occurred twelve minutes ago but was released
 * to this reader thirty seconds ago is event-age twelve minutes and reader
 * silence thirty seconds. Padding the column in that state would be answering a
 * question nobody asked.
 *
 * The first-principles variable is TIME SINCE THE READER LAST SAW A NEWLY
 * ARRIVING ROW, and only the client knows it: the server's shared tape is one
 * cached answer handed to every visitor (see insider/cache TAPE_KEY), so a
 * per-reader clock could not reach it without either poisoning that cache or
 * inventing a fake proxy for it.
 *
 * So the work is split along the line each side can actually see:
 *
 *   SERVER  candidacy. Computes the batch floor as it always has, plus the
 *           floor at full silence pressure, and tags every row that passes only
 *           the second one `pulse: true`. Deterministic, viewer-blind, cacheable.
 *   CLIENT  release. Holds those rows and lets one through only when this
 *           reader has genuinely been sitting in front of a still page.
 *
 * A held pulse row is never destroyed — it stays in the query cache and is
 * reconsidered on the next poll, so a silence that continues eventually gets its
 * heartbeat and a silence that ends never does.
 *
 * ZERO IO, pure, deterministic.
 */

export const PULSE = {
  /**
   * How long a reader must have seen nothing new before ordinary activity is
   * worth showing. Short enough that a slow-but-alive market feels inhabited,
   * long enough that a normal feed never reaches it — during real activity the
   * clock is reset by every released row, so this branch is simply unreachable.
   */
  silentForMs: 90_000,
  /** One heartbeat per evaluation. A pulse batch would be a fabricated burst. */
  perBatch: 1,
} as const;

export interface PulseGateInput {
  /** ms since this reader last saw a row ARRIVE (not since an event occurred). */
  silentForMs: number;
  /** Rows admitted on their own merits waiting in this batch. */
  freshSignalCount: number;
  /** Rows still queued for release from earlier batches. */
  queued: number;
}

/**
 * How many held pulse rows may be released right now.
 *
 * Zero whenever anything real is already on its way to the reader: a heartbeat
 * is only ever the answer to an empty screen, never a supplement to a full one.
 */
export function pulseReleaseCount(i: PulseGateInput): number {
  if (i.freshSignalCount > 0 || i.queued > 0) return 0;
  if (i.silentForMs < PULSE.silentForMs) return 0;
  return PULSE.perBatch;
}
