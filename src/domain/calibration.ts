/**
 * THE LOCKED 10 — conviction.company's V1 calibration sequence.
 *
 * POV OWNS THE MARKET; conviction.company OWNS THE SEQUENCE. These ten questions
 * were authored to read a new person's conviction DNA in a fixed, deliberate
 * order, so the sequence is server-owned and hard-coded here rather than selected
 * dynamically. The array points at the ten real POV `onChainMarketId`s — it never
 * duplicates their question text, because the text lives on the market and can
 * change; the id is the identity.
 *
 * The order below is the order a new reader experiences them in. It is the whole
 * design of the calibration, so it is written out once, in one place, and nothing
 * downstream re-sorts it.
 *
 *   2832  I'd rather look like a delusional idiot early than a boring copycat late.
 *   2833  Have you lost sleep going down a rabbit hole for absolutely no reason.
 *   2834  Do you care more about why people do things than what they did?
 *   2835  Are you obsessed with finding out how people really make money?
 *   2836  Toxic excellence beats wholesome mediocrity.
 *   2837  Would you bet on the person you hate the most in life if the payout was right?
 *   2838  Bad music taste can make someone less attractive.
 *   2839  When everyone is arguing about something, do you want in?
 *   2840  Have you changed your mind after making the hugest deal that you were right?
 *   2841  If someone is talking shit about you, do you demand the screenshots?
 *
 * Pure: no IO, no clock. The feed pins these; the card tags them; nothing here
 * knows about either.
 */

/** The V1 calibration sequence, in the exact order a new reader answers them. */
export const CALIBRATION_SEQUENCE: readonly number[] = [
  2832, 2833, 2834, 2835, 2836, 2837, 2838, 2839, 2840, 2841,
] as const;

/** O(1) membership — "is this market one of the Locked 10". */
export const CALIBRATION_IDS: ReadonlySet<number> = new Set(CALIBRATION_SEQUENCE);

/** The banner every calibration card wears, above the question. */
export const CALIBRATION_TAG = "Conviction Calibration";

/** Is this market part of the Locked 10 calibration sequence? */
export function isCalibrationMarket(marketId: number): boolean {
  return CALIBRATION_IDS.has(marketId);
}

/**
 * The calibration questions still owed to this reader, IN SEQUENCE ORDER.
 *
 * A market drops out of the pin the moment the reader has DECIDED it (a recorded
 * yes/no/pass) — that is the whole "don't show it again until all are exhausted"
 * rule, expressed as a set difference rather than a stateful queue. `seen` is the
 * current browsing session's sightings: a card scrolled past this session is not
 * re-pinned to the very front on the next poll (it returns on a fresh session,
 * because a calibration question is worth asking again until it is answered).
 *
 * Returns [] once every question has been decided — the signal that calibration
 * is exhausted and the ordinary feed takes over.
 */
export function pinnedCalibration(
  decided: ReadonlySet<number>,
  seen: ReadonlySet<number> = new Set(),
): number[] {
  return CALIBRATION_SEQUENCE.filter((id) => !decided.has(id) && !seen.has(id));
}
