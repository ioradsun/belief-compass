/**
 * PERCENTAGES NEED DENOMINATORS.
 *
 * A stored market transition says "−100% over 24H". Read aloud that is the
 * loudest sentence in the feed, and it is the same sentence whether $2,000 left
 * or $1.80 did. The percentage is true either way, which is exactly the problem:
 * the reader is being handed an importance the fact does not have.
 *
 * This is the pass that puts the number back next to the money. It runs at READ
 * time, on top of `modernizeTransitionCopy`, because the denominator lives in
 * market state (the side's 24h capital delta) and was never in the payload the
 * emitter froze.
 *
 * Three outcomes, and only one of them is loud:
 *
 *   MATERIAL   — real money moved. Say the dollars, not the percentage:
 *                "The entire $147 behind YES left today."
 *   ORDINARY   — some money moved. Same dollars-first sentence, quieter voice.
 *   DUST       — the percentage is arithmetic on pocket change. The row stays
 *                (it is true, and it is a receipt), but it loses the percentage
 *                and loses the right to be ranked as intelligence.
 *
 * When we cannot see the denominator at all, we do NOT get to shout: an
 * unmeasurable percentage is demoted to a receipt rather than trusted. Missing
 * evidence is never the same as evidence of size.
 */
import { modernizeTransitionCopy, type TransitionCopy } from "./legacy-voice";

/** Above this, dollars are worth leading with. */
export const MATERIAL_USD = 25;
/** At or below this, a percentage is arithmetic on pocket change. */
export const DUST_USD = 5;

/** How loudly this row is allowed to speak, before the signal vector has a say. */
export type CopyLevel = "receipt" | "observation";

export interface DenominatorContext {
  /** Dollars behind the percentage — the side's 24h capital movement. */
  usd: number | null;
  /** "YES" | "NO" when the row names a side. */
  side: string | null;
}

export interface RetoldTransition extends TransitionCopy {
  level: CopyLevel;
  /** The dollars the copy is standing on, when we could see them. */
  usd: number | null;
}

/** "$1.8" reads like a rounding error; "$1.80" reads like money. */
function money(usd: number): string {
  if (usd >= 1000) return `$${Math.round(usd).toLocaleString("en-US")}`;
  if (usd >= 100) return `$${Math.round(usd)}`;
  if (usd >= 10) return `$${usd.toFixed(0)}`;
  return `$${usd.toFixed(2)}`;
}

/**
 * The percentage the row printed, and which way it points.
 *
 * Read from the RAW pair, not the modernized copy: the retelling drops the sign
 * ("65% of the money left in 24H"), so direction has to come from the sentence
 * that still carries it.
 */
function readPct(raw: string): { pct: number; falling: boolean } | null {
  const m = raw.match(/([-−+]?)\s*([\d.]+)%/);
  if (!m) return null;
  const pct = Number(m[2]);
  if (!Number.isFinite(pct)) return null;
  const falling = m[1] === "-" || m[1] === "−" || /leaving|left|fell|thin|lighter|empt/i.test(raw);
  return { pct, falling };
}

/** Does this row carry any figure at all, or is it a bare state announcement? */
function hasFigure(text: string): boolean {
  return /\d/.test(text);
}

/**
 * Retell a stored transition with its denominator in view.
 *
 * Pure. Never invents a number: every dollar figure here comes from `ctx.usd`,
 * and when that is absent the copy loses volume rather than gaining a guess.
 */
export function retellTransition(
  rawHeadline: string,
  rawDetail: string | null | undefined,
  key: string,
  ctx: DenominatorContext,
): RetoldTransition {
  const base = modernizeTransitionCopy(rawHeadline, rawDetail ?? "", key);
  const raw = `${rawHeadline ?? ""} ${rawDetail ?? ""}`;
  const move = readPct(raw);
  const usd = Number.isFinite(ctx.usd as number) && (ctx.usd as number) > 0 ? (ctx.usd as number) : null;
  const side = (ctx.side ?? "").toUpperCase() === "NO" ? "NO" : ctx.side ? "YES" : null;
  const it = side ?? "this side";

  // NO PERCENTAGE, NO NUMBER AT ALL — "First believers just stepped in." is a
  // true structural fact with nothing else to contribute. It stays a receipt:
  // the headline may keep it, but it must not be ranked as a clue.
  /* A percentage only earns a dollar denominator when it IS money. Price
     re-ratings ("YES re-rated +5.3%") are a different quantity: restating one
     as "$6,931 arrived" would be a fabrication. */
  const aboutMoney =
    /\b(money|capital|funded)\b/i.test(raw) && !/re-rated|\bprice\b/i.test(raw);

  if (!move || !aboutMoney) {
    return { ...base, usd, level: hasFigure(base.detail) ? "observation" : "receipt" };
  }

  // A PERCENTAGE WE CANNOT SIZE. Demoted, not deleted — see the header.
  /* No denominator, no percentage. An unsized "100% of the money left" reads
     like a collapse whether the side held $3 or $30,000, so the share is
     dropped rather than shouted, and the row falls to receipt volume. */
  if (usd == null)
    return {
      headline: base.headline,
      detail: move.falling
        ? `Money came off ${it} today. The size behind it isn't confirmed yet.`
        : `Money went on ${it} today. The size behind it isn't confirmed yet.`,
      usd: null,
      level: "receipt",
    };

  const all = move.pct >= 99;

  if (usd <= DUST_USD) {
    // The percentage is dropped entirely. What is left is the honest receipt.
    return {
      headline: move.falling ? `Small money off ${it}` : `Small money on ${it}`,
      detail: move.falling
        ? `Only ${money(usd)} was behind it${all ? ", and it left" : ""}.`
        : `${money(usd)} arrived. That's what's there.`,
      usd,
      level: "receipt",
    };
  }

  const detail = move.falling
    ? all
      ? `The entire ${money(usd)} behind ${it} left today.`
      : `${money(usd)} left ${it} today.`
    : `${money(usd)} arrived on ${it} today.`;

  return {
    headline: base.headline,
    detail,
    usd,
    level: usd >= MATERIAL_USD ? "observation" : "receipt",
  };
}

/**
 * A ROW MAY NEVER SPEAK LOUDER THAN ITS OWN SENTENCE.
 *
 * The signal vector reads market state; this reads the copy we actually
 * printed. Where they disagree the quieter one wins, because the reader only
 * ever sees the sentence.
 */
export function capVoice(
  level: "receipt" | "observation" | "intelligence",
  ceiling: CopyLevel | undefined,
): "receipt" | "observation" | "intelligence" {
  if (!ceiling) return level;
  if (ceiling === "receipt") return "receipt";
  return level === "intelligence" ? "observation" : level;
}

/**
 * The most significance a receipt-grade transition may carry.
 *
 * Not a new scorer — a ceiling. Sparsity is the product: an unsized percentage
 * or a bare "first believers" should be available below the clues, never
 * competing with them. Above `CADENCE.minQuality`, so nothing disappears.
 */
export const RECEIPT_SIGNIFICANCE_CEILING = 0.3;
