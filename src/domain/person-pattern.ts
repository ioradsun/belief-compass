/**
 * CROSS-MARKET PERSON PATTERNS — what the PI notices about a PERSON, not a market.
 *
 * Every other layer looks at one question at a time: who moved, how much, which
 * side. A real observer watching the room also notices the thing no single row
 * can contain — that the same person has now backed their third question in an
 * afternoon, that everything they touch today is NO, that they sold out of one
 * belief and immediately bought another.
 *
 * This layer NEVER adds a row. A pattern is an ASIDE attached to the person's
 * newest surviving row: one short observation, at most once per person per feed.
 * That is deliberate — a pattern is context for something the reader is already
 * reading, not a second slot spent on the same behaviour.
 *
 * ZERO IO. Pure, deterministic, fully testable.
 */

export type PatternKind = "rotation" | "sweep" | "one_way" | "streak" | "unwinding";

export interface PatternRow {
  id: string;
  /** The question this row is about, when we have its title. Used to say what
   *  they moved OUT OF and INTO, which is the whole content of a rotation. */
  marketTitle?: string | null;
  /** Lowercased actor. Rows without one are crowd rows and carry no pattern. */
  wallet?: string | null;
  marketId: string;
  side?: "YES" | "NO" | null;
  /** What the move did to their belief: enter | add | reduce | exit | flip … */
  action?: string | null;
  amountUsd?: number | null;
  /** Display name, when we have one. Required for a promotable headline. */
  name?: string | null;
  /** ISO. Newest row of the person is where the aside lands. */
  occurredAt: string;
}

export interface PersonPattern {
  rowId: string;
  wallet: string;
  kind: PatternKind;
  /**
   * WHEN THE PATTERN IS THE STORY, IT SHOULD BE THE HEADLINE.
   *
   * "Not done / Another $0.02 on NO" with an italic aside underneath buries the
   * only interesting thing in the row. Where the pattern out-informs the event
   * — someone unwinding, someone leaning one way across questions, someone on a
   * run — the caller may promote this pair into the row's kicker and body and
   * leave the market underneath. Null when the pattern is mere context, or when
   * we have no name to lead with.
   */
  lead: { headline: string; body: string } | null;
  /** The aside, already written. One sentence, no numbers the row repeats. */
  note: string;
  /**
   * THE ROWS THIS PATTERN IS MADE OF, minus the anchor.
   *
   * A person cutting three positions and flipping a fourth currently arrives as
   * five separate receipts — ONE LESS, BELIEVER LEFT, OUT, BELIEVER LEFT,
   * FLIPPED — plus one italic aside noting that they have stepped back from
   * several questions. The aside is the only informative line there, and it is
   * the smallest. A real investigator does not send five texts; he sends one:
   * "Kodak cut two positions and flipped another this afternoon."
   *
   * So when the caller promotes `lead` into the headline, these ids are the
   * constituent receipts the promoted story now CONTAINS. On the global surface
   * they should be dropped — the behaviour is told once, at full volume. Inside
   * a market's own Recent Activity they must stay: there the individual
   * transaction is the point.
   */
  consumes: string[];
}

export const PATTERN = {
  /** Below this a "move" is dust and says nothing about intent. */
  minUsd: 1,
  /** Two questions is a coincidence you can still see; one is nothing. */
  minMarkets: 2,
  /** Three entries in a window is a person on a run, not a person trading. */
  sweepMarkets: 3,
} as const;

const ENTRIES = new Set(["enter", "add"]);
const EXITS = new Set(["exit", "reduce"]);
/** A flip is a move too: it changes what they believe, not just how much. */
const FLIPS = new Set(["flip", "switch", "side_shift"]);

const WORD = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const count = (n: number): string => WORD[n] ?? String(n);
const nth = (n: number): string =>
  ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh"][n] ?? `${n}th`;

/** How long ago the reader should picture this happening over. */
function span(msFirst: number, msLast: number): string {
  const h = Math.abs(msLast - msFirst) / 3_600_000;
  if (h <= 6) return "in the last few hours";
  if (h <= 26) return "today";
  return "lately";
}

const at = (r: PatternRow): number => Date.parse(r.occurredAt) || 0;

/**
 * Find one pattern per person across the rows the feed is about to show.
 *
 * Precedence is the order a person would say them out loud: rotation (they
 * moved conviction from one question to another) beats a run of entries, which
 * beats a one-sided run, which beats an unwind.
 */
export function findPersonPatterns(rows: readonly PatternRow[]): PersonPattern[] {
  const byWallet = new Map<string, PatternRow[]>();
  for (const r of rows) {
    const w = r.wallet?.toLowerCase();
    if (!w || !r.marketId) continue;
    const amt = Math.abs(Number(r.amountUsd ?? 0));
    if (r.amountUsd != null && amt < PATTERN.minUsd) continue;
    const a = r.action ?? "";
    if (!ENTRIES.has(a) && !EXITS.has(a) && !FLIPS.has(a)) continue;
    const list = byWallet.get(w);
    if (list) list.push(r);
    else byWallet.set(w, [r]);
  }

  const out: PersonPattern[] = [];
  for (const [wallet, list] of byWallet) {
    const markets = new Set(list.map((r) => r.marketId));
    if (markets.size < PATTERN.minMarkets) continue;

    const entries = list.filter((r) => ENTRIES.has(r.action ?? ""));
    const exits = list.filter((r) => EXITS.has(r.action ?? ""));
    const flips = list.filter((r) => FLIPS.has(r.action ?? ""));
    const entryMarkets = new Set(entries.map((r) => r.marketId));
    const exitMarkets = new Set(exits.map((r) => r.marketId));
    const rotated = [...entryMarkets].some((m) => !exitMarkets.has(m)) && exitMarkets.size > 0;

    // The aside lands on the NEWEST row — the one the reader is looking at when
    // the pattern becomes true. Ties break on id so the choice is stable.
    const anchor = [...list].sort(
      (a, b) => at(b) - at(a) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
    )[0]!;
    const when = span(Math.min(...list.map(at)), Math.max(...list.map(at)));

    let kind: PatternKind;
    let note: string;
    if (rotated) {
      kind = "rotation";
      note = `They sold out of one question and backed another ${when}.`;
    } else if (entryMarkets.size >= PATTERN.sweepMarkets) {
      kind = "sweep";
      note = `Their ${nth(entryMarkets.size)} question ${when}.`;
    } else if (
      entryMarkets.size >= PATTERN.minMarkets &&
      entries.every((r) => r.side && r.side === entries[0]!.side)
    ) {
      kind = "one_way";
      note = `${cap(count(entryMarkets.size))} questions ${when}, both on ${entries[0]!.side}.`;
    } else if (entryMarkets.size >= PATTERN.minMarkets) {
      kind = "streak";
      note = `${cap(count(entryMarkets.size))} different questions ${when}.`;
    } else if (exitMarkets.size >= PATTERN.minMarkets) {
      kind = "unwinding";
      note = flips.length
        ? `They have cut ${count(exitMarkets.size)} positions and flipped another ${when}.`
        : `They have stepped back from ${count(exitMarkets.size)} questions ${when}.`;
    } else continue;

    /* A HEADLINE ONLY WHERE THE PATTERN OUT-INFORMS THE EVENT. A streak of
       two ordinary entries is context; backing away from several positions,
       leaning one way across questions, or sweeping a room is the story. */
    const who = (anchor.name ?? list.find((r) => r.name)?.name ?? "").trim();
    const NAME = who.toUpperCase();
    let lead: PersonPattern["lead"] = null;
    if (who) {
      if (kind === "unwinding")
        lead = flips.length
          ? {
              /* Cutting AND flipping is not retreat — it is a person moving
                 their conviction around, which is a different claim and the
                 more interesting one. Say the one the facts support. */
              headline: `${NAME} is repositioning`,
              body: `They cut ${count(exitMarkets.size)} positions and flipped another ${when}.`,
            }
          : {
              headline: `${NAME} is backing away`,
              body: `They've cut ${count(exitMarkets.size)} positions ${when}.`,
            };
      else if (kind === "one_way")
        lead = {
          headline: `${NAME} keeps leaning ${entries[0]!.side}`,
          body: `That's their ${nth(entryMarkets.size)} ${entries[0]!.side} add across ${count(entryMarkets.size)} questions ${when}.`,
        };
      else if (kind === "sweep")
        lead = {
          headline: `${NAME} is working the room`,
          body: `Their ${nth(entryMarkets.size)} question ${when}.`,
        };
      else if (kind === "rotation") {
        /* "Sold out of one question and backed another" is true and says
           nothing: the reader wants to know WHICH, because the pair is the
           clue. Name both when we have both titles. */
        const from = topic(exits.find((r) => r.marketTitle)?.marketTitle);
        const into = topic(
          entries.find((r) => r.marketTitle && !exitMarkets.has(r.marketId))?.marketTitle,
        );
        lead =
          from && into && from !== into
            ? { headline: `${NAME} moved their conviction`, body: `Out of ${from}. Into ${into}.` }
            : {
                headline: `${NAME} moved their conviction`,
                body: `They sold out of one question and backed another ${when}.`,
              };
      }
    }

    out.push({
      rowId: anchor.id,
      wallet,
      kind,
      note,
      lead,
      consumes: list.filter((r) => r.id !== anchor.id).map((r) => r.id),
    });
  }
  return out;
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The SUBJECT of a question, short enough to sit in a sentence about a person.
 * "Will Pump.fun still be top 3 by revenue in 2026?" is about Pump.fun; the
 * rest of the sentence belongs to the market row, not to this one.
 */
const LEAD_IN = /^(will|would|does|do|did|is|are|can|could|should|has|have)\s+/i;
function topic(title: string | null | undefined): string | null {
  const t = (title ?? "").trim().replace(/[?.!]+$/, "");
  if (!t) return null;
  const rest = t.replace(LEAD_IN, "").trim();
  if (!rest) return null;
  const words = rest.split(/\s+/).slice(0, 3).join(" ");
  return words.length > 32 ? words.slice(0, 32).trim() : words;
}
