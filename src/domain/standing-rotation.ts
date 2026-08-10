/**
 * STANDING ROTATION — why the tape keeps having something to say when nothing
 * is happening.
 *
 * A standing story ("still holding YES for 43 days") does not expire, and there
 * are far more true ones than fit a window. The build used to return the same
 * strongest N every time, so once the reader had seen those N, every later fetch
 * returned the identical set — the client's per-reader cooldown then filtered
 * them all out and the "Insider" feed produced no more updates during a quiet
 * stretch, even with hundreds of standing candidates sitting in the pool.
 *
 * The fix is to slide a window through the strength-sorted pool over time. Each
 * full rebuild (the tape's ~90s heartbeat) lands in a new time bucket and starts
 * the window `limit` further along, so it returns a FRESH slice. Those rows are
 * new to the client, so the update gate counts them behind the "↑ N New" control
 * — which is exactly the mechanism the reader taps to pull them in. Over a full
 * cycle every eligible story gets its turn; the client cooldown stops any one
 * repeating inside its window.
 *
 * DETERMINISTIC. The offset is a pure function of the pool size and the clock
 * bucket, so a second fetch inside the same bucket returns the same slice (no
 * churn), and the same inputs always produce the same order (testable without a
 * database). When the pool is no larger than the window there is nothing to
 * rotate, and this is exactly the old behaviour — the strongest, every time.
 *
 * ZERO IO, pure.
 */

/**
 * How long the window sits on one slice before advancing, in ms.
 *
 * Tracks the tape's full-rebuild heartbeat (~90s): one heartbeat, one fresh
 * window. Shorter would advance past slices the reader never fetched; much
 * longer would leave the feed repeating the same slice across several heartbeats.
 */
export const STANDING_ROTATE_MS = 90_000;

/**
 * Where the window starts in the strength-sorted pool for this moment.
 *
 * Advances by a whole `limit` each bucket, so consecutive windows do not overlap
 * until the ring wraps — the reader meets new stories rather than the same ones
 * shifted by one. Returns 0 (no rotation) when the pool cannot fill more than one
 * window, when rotation is disabled, or on any non-finite input.
 */
export function rotationOffset(
  poolLen: number,
  limit: number,
  nowMs: number,
  rotateMs: number = STANDING_ROTATE_MS,
): number {
  if (
    !Number.isFinite(poolLen) ||
    !Number.isFinite(limit) ||
    !Number.isFinite(nowMs) ||
    !(rotateMs > 0) ||
    !(limit > 0) ||
    !(poolLen > limit)
  ) {
    return 0;
  }
  const bucket = Math.floor(nowMs / rotateMs);
  // Guard the sign: a negative clock (never in practice) must not index backwards.
  return (((bucket * limit) % poolLen) + poolLen) % poolLen;
}

/**
 * The pool re-ordered so THIS moment's window is at the front. The caller then
 * applies its own selection (per-market caps, `limit`) to the front of the ring
 * exactly as before — only the starting point moved.
 */
export function rotateForWindow<T>(
  sorted: readonly T[],
  nowMs: number,
  limit: number,
  rotateMs: number = STANDING_ROTATE_MS,
): T[] {
  const off = rotationOffset(sorted.length, limit, nowMs, rotateMs);
  return off === 0 ? [...sorted] : [...sorted.slice(off), ...sorted.slice(0, off)];
}
