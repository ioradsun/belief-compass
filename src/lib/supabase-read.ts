/**
 * READING A TABLE WITHOUT LYING ABOUT THE ANSWER.
 *
 * `const { data } = await sb.from(…)` then `data ?? []` is the most common line in
 * this codebase and the source of its most expensive bug. It reads as defensive.
 * It is the opposite: it takes "the question could not be asked" and returns "the
 * answer is nothing", and nothing is a MEANING. An empty array becomes a count,
 * a count becomes a sentence, and the sentence is delivered with total confidence
 * to somebody it is false about.
 *
 * It has happened at least twice in surfaces we have since had to repair. A
 * blocked `wallet_beliefs` read made `expressedBeliefs` zero, and zero rendered
 * "Take 5 sides and we'll work out who your people are" — the first-run onboarding
 * line — to established users. A blocked `viewer_dna_cache` read was
 * indistinguishable from a cold cache, so the reader was told their network was
 * still forming, forever, while every request errored.
 *
 * SO THE FIX IS NOT VIGILANCE, IT IS THE DEFAULT. Auditing 80 call sites once
 * leaves 80 chances to reintroduce it. These helpers make the honest read SHORTER
 * than the dishonest one — no destructure, no `?? []` — so the path of least
 * effort stops being the one that invents an answer.
 *
 * WHEN NOT TO USE THEM. Where an empty result genuinely loses only DETAIL and the
 * page stays true without it — display-name overrides, category labels, the faces
 * on a feed card — a throw would turn "slightly less colour" into "the whole page
 * 500s", which is a worse trade. `serviceClientOrNull` exists for the same reason.
 * The rule is not "never tolerate a failure". It is: NEVER LET A FAILURE BECOME A
 * CLAIM.
 */

interface ReadError {
  message: string;
  code?: string;
  details?: string | null;
}

interface ListResult<T> {
  data: T[] | null;
  error: ReadError | null;
}

interface RowResult<T> {
  data: T | null;
  error: ReadError | null;
}

function fail(what: string, error: ReadError): never {
  // LOUD AS WELL AS FATAL. A caller can swallow a throw; the log survives it, and
  // this is the line an operator greps for when a surface has gone quiet.
  console.error(`[read] ${what} failed`, { code: error.code, message: error.message });
  throw new Error(`${what} failed: ${error.message}`);
}

/**
 * Every row, or an exception — never a confident empty list.
 *
 * `what` is a short human phrase, not a table name, because it ends up in a log an
 * operator reads at speed: "this wallet's beliefs", not "wallet_beliefs select".
 */
export function rowsOf<T>(res: ListResult<T>, what: string): T[] {
  if (res.error) fail(what, res.error);
  return res.data ?? [];
}

/**
 * One row or none, with the difference between "no such row" and "could not ask"
 * preserved.
 *
 * PostgREST's `maybeSingle()` returns `{ data: null, error: null }` for a genuine
 * miss, so an error being present is unambiguous — which is exactly the
 * distinction `readViewerDnaCache` was losing when it treated a blocked read as a
 * cold cache.
 */
export function rowOf<T>(res: RowResult<T>, what: string): T | null {
  if (res.error) fail(what, res.error);
  return res.data ?? null;
}
