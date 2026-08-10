/**
 * FEED EDITORIAL — the subtraction pass.
 *
 * Everything upstream decides what is TRUE and how BIG it is. This decides what
 * is worth a human's attention, and it works by removing rows, never by adding
 * or rewriting them. Two rules, both of them things a good editor would say out
 * loud:
 *
 *   1. A SECOND ROW ABOUT THE SAME MARKET MUST SAY SOMETHING THE FIRST DIDN'T.
 *      "Money is leaving YES" three times on one question is one fact printed
 *      three times. Same market + same motif collapses to the newest telling,
 *      unless the magnitude moved materially — in which case the story really
 *      did progress and the second row has earned its slot.
 *
 *   2. LOW-VALUE TRUTH IS STILL NOT NEWS. A penny exit is technically an event
 *      and costs a reader the same attention as a real one. So does a third
 *      conviction from somebody they have never met. Both are dropped.
 *
 * ZERO IO, pure, deterministic, fully testable.
 */

export interface EditorialRow {
  id: string;
  kind: string;
  marketId: string;
  /** ISO. Newest wins inside a repeat group. */
  occurredAt: string;
  /** Semantic identity of the story being told. No motif → never a repeat. */
  motif?: string | null;
  amountUsd?: number | null;
  significance?: number | null;
  /** What the actor did to their belief, when the row is a trade. */
  action?: string | null;
  /** True when the row is about somebody the reader is connected to. */
  personal?: boolean | null;
  /** The rung a person-milestone row crossed. */
  rung?: number | null;
  /** Which side the row is about, when it is about one. */
  side?: "YES" | "NO" | null;
  /**
   * True when the row is a DERIVED reading of market state (a capital/price
   * move) rather than a named thing a person did. Derived rows are the ones
   * that can restate somebody else's story.
   */
  derived?: boolean | null;
  /** What the derived row measured. */
  metric?: "capital" | "price" | "believers" | null;
  /**
   * Whether the reader has enough context to understand the row on its own —
   * chiefly, whether we know WHICH QUESTION it is about. `undefined` means the
   * caller is not asserting either way; only an explicit `false` drops the row.
   */
  context?: boolean | null;
  /**
   * True when the row is a ROLLING-WINDOW reading — a statement about the last
   * hour/day rather than about a moment. Two of these on one market are two
   * observations of overlapping windows, not two developments.
   */
  rolling?: boolean | null;
  /** Event family, for capping how much of the feed one family may occupy. */
  family?: string | null;
  /**
   * The copy layer already decided this row should not be printed — chiefly a
   * percentage it could not size, or a percentage over pocket change. See
   * `retellTransition`. Editorial honours that verdict rather than re-deriving
   * it, because only the copy layer knows what sentence would have shipped.
   */
  suppressed?: boolean | null;
  /**
   * Does the row carry a SECOND FACT — something beyond the bare structural
   * announcement? "NO just got company" is an event type. "NO was empty, three
   * wallets stepped in within the hour" is intelligence. First-participation
   * rows without a second fact are ordinary, and ordinary is allowed at most
   * one slot.
   */
  secondFact?: boolean | null;
}


export const EDITORIAL = {
  /**
   * Below this, an exit is a rounding error. Reporting "AMIR left with $0.01"
   * spends a reader's attention on a penny.
   */
  minExitUsd: 1,
  /**
   * How much the same story must have moved to earn a second row. 1.5× is the
   * smallest change a reader would describe as "it got worse".
   */
  escalation: 1.5,
  /**
   * The first conviction count worth telling a stranger about. Three matters
   * structurally — it is where relationships can start forming — but it is not
   * automatically interesting to anyone else, so it needs the reader to already
   * know the person.
   */
  /**
   * A conviction count only becomes news for STRANGERS at real scale. 5 is a
   * fact about somebody the reader has never met; 25 is a standing. Below the
   * bar the row still ships when the person is personally relevant.
   */
  minMilestoneRung: 25,
  /**
   * How close a derived market move has to be to a named trade on the same side
   * before it counts as a restatement of it. Six hours is the window in which a
   * reader would still connect the two as one development.
   */
  causalWindowMs: 6 * 3_600_000,
  /**
   * How many rows one family may occupy in a single feed. Resurrection is
   * CLOCK-driven — every dormant market crosses the bar in the same sweep — so
   * without a cap a quiet day fills the feed with "back from the dead" and the
   * feed looks padded rather than alive.
   */
  /**
   * FIRST PARTICIPATION IS AN EVENT TYPE, NOT INTELLIGENCE. Every quiet side
   * eventually gets its first backer, so a feed that treats each one as a story
   * prints five versions of "just got company". One bare telling per feed; a
   * telling that carries a second fact is exempt (see `capFamilies`).
   */
  familyCaps: {
    market_reawakened: 2,
    /* An unanswered market is inventory with a clock on it. One is context;
       three ("opened 7 hours ago", "13 hours ago", "19 hours ago") is the same
       non-event printed until it becomes the feed's dominant motif. */
    market_created: 1,
    first_believer: 1,
    side_opened: 1,
    first_capital: 1,
    /* CONTINUITY RATIONED WHERE EVERY OTHER FAMILY IS — this is the cap that
       replaced the standing lane's scheduler. A bare tenure receipt is the
       weakest true thing the feed can say: ONE is the whole allowance, because
       two of them back to back read as a template. Persistence beside a real
       change (observation) or against a proven move (intelligence) is a market
       reading and gets the same allowance as any other. */
    standing_fact: 1,
    standing_signal: 3,
    /* "EMPTIED OUT" IS A LOUD SENTENCE. Printed twice in a window, with no
       amount behind either, it sounds like the feed shouting. One per window
       unless the second telling brings its own evidence. */
    side_emptied: 1,

  } as Record<string, number>,
} as const;

/** The families whose cap only applies to the bare, single-fact telling. */
const SECOND_FACT_EXEMPT = new Set([
  "first_believer",
  "side_opened",
  "first_capital",
  "side_emptied",
]);


const num = (v: number | null | undefined): number =>
  v == null || !Number.isFinite(Number(v)) ? 0 : Math.abs(Number(v));

/** How big this telling is, for comparing two versions of the same story. */
function magnitude(r: EditorialRow): number {
  const amt = num(r.amountUsd);
  return amt > 0 ? amt : num(r.significance);
}

/**
 * Would this make one person say "wait, what happened?" to another? If not, it
 * should not take a slot.
 */
export function earnsSlot(r: EditorialRow): boolean {
  // The copy layer already looked at the sentence this row would print and
  // said it isn't worth printing. Nothing here overrides that.
  if (r.suppressed) return false;
  // A row a reader cannot place — no question, no market — is a fact without a
  // subject. "NEW BELIEVER · Someone backed YES" of WHAT?
  if (r.context === false) return false;
  if (r.action === "exit" && r.amountUsd != null && num(r.amountUsd) < EDITORIAL.minExitUsd)
    return false;
  if (r.kind === "person_milestone" && (r.rung ?? 0) < EDITORIAL.minMilestoneRung && !r.personal)
    return false;
  return true;
}

/**
 * ONE FAMILY MAY NOT OWN THE FEED. Keeps the first N rows of a capped family in
 * the caller's order (which is already strongest-first) and drops the rest.
 */
export function capFamilies<T extends EditorialRow>(rows: readonly T[]): T[] {
  const seen = new Map<string, number>();
  return rows.filter((r) => {
    const cap = r.family ? EDITORIAL.familyCaps[r.family] : undefined;
    if (cap == null) return true;
    // A first-participation row that brought a second fact ("price hasn't
    // moved", "your rival was one of the first two in") is no longer the
    // generic announcement the cap exists to ration.
    if (r.secondFact && SECOND_FACT_EXEMPT.has(r.family!)) return true;
    const n = (seen.get(r.family!) ?? 0) + 1;
    seen.set(r.family!, n);
    return n <= cap;
  });
}

/**
 * A DERIVED MOVE THAT SOMEBODY ELSE'S STORY ALREADY EXPLAINS IS NOT NEWS.
 *
 * "BELIEVER LEFT NO — Alex left with $15" and "Capital on NO fell 83%" are one
 * event measured twice: the second is the arithmetic consequence of the first.
 * The named telling is strictly better (it has a person, an amount and a
 * reason), so when both are in hand for the same market and side inside the
 * causal window, the derived reading yields.
 */
export function collapseCausal<T extends EditorialRow>(rows: readonly T[]): T[] {
  const causal = rows.filter((r) => !r.derived);
  if (causal.length === 0) return [...rows];
  const at = (r: EditorialRow) => Date.parse(r.occurredAt) || 0;
  return rows.filter((r) => {
    if (!r.derived) return true;
    return !causal.some(
      (c) =>
        c.marketId === r.marketId &&
        (r.side == null || c.side == null || c.side === r.side) &&
        Math.abs(at(c) - at(r)) <= EDITORIAL.causalWindowMs,
    );
  });
}

/** Materially different tellings of the same story, in either direction. */
function escalated(kept: EditorialRow, next: EditorialRow): boolean {
  const a = magnitude(kept);
  const b = magnitude(next);
  if (a <= 0 || b <= 0) return false;
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return hi / lo >= EDITORIAL.escalation;
}

/**
 * Collapse repeated snapshots of one fact. Rows keep their input order; only
 * the redundant repeats are removed, so the caller's ordering (and any pinning
 * above it) survives untouched.
 */
export function pruneRepeats<T extends EditorialRow>(rows: readonly T[]): T[] {
  // Newest first inside each group, so the surviving telling is the latest one.
  const order = [...rows].sort((a, b) =>
    a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0,
  );
  const keptByGroup = new Map<string, T[]>();
  const dropped = new Set<string>();
  for (const r of order) {
    if (!r.motif) continue;
    const key = `${r.marketId}|${r.motif}`;
    const kept = keptByGroup.get(key);
    if (!kept) {
      keptByGroup.set(key, [r]);
      continue;
    }
    /* ROLLING WINDOWS NEVER REPEAT. "3 joined / $215 left" at 50m and
       "9 joined / $85 left" at 1h are the same rolling state read twice over
       overlapping windows; printing both invites a reader to count one
       development as two. The newest reading REPLACES the older one, and only a
       change of category (a different motif) earns a second row. Moment events
       — a trade, an exit — keep the escalation exemption, because a bigger
       second one genuinely did happen. */
    if (!r.rolling && !kept.some((k) => k.rolling) && kept.every((k) => escalated(k, r)))
      kept.push(r);
    else dropped.add(r.id);
  }
  return rows.filter((r) => !dropped.has(r.id));
}

/**
 * THE CANONICAL RULE: IF THE SECOND SENTENCE DOES NOT CHANGE HOW YOU READ THE
 * FIRST, IT IS NOT INTELLIGENCE.
 *
 * "NO JUST GOT COMPANY / First believers just stepped in." is one fact said
 * twice. Intelligence needs the body to add something the kicker could not
 * carry — a number, a person, a second side, a time, or a contradiction.
 * Returns false when the body is a restatement, and the caller lowers the
 * row's voice rather than dropping it.
 */
export function secondSentenceAdds(headline: string, detail: string): boolean {
  const h = (headline ?? "").toLowerCase().trim();
  const d = (detail ?? "").toLowerCase().trim();
  if (!d) return false;
  // A figure, a share, a name or a counterpoint is always new information.
  if (/[\d$%]/.test(d)) return true;
  if (/\b(but|while|without|yet|still|hasn't|hasn'|no one|nobody|first two)\b/.test(d)) return true;
  /* Synonym families. A restatement rarely reuses the exact words — "NO just
     got company" and "First believers just stepped in" share no vocabulary and
     make the identical claim. Collapse each family to one token so the overlap
     check sees the claim rather than the phrasing. */
  const FAMILIES: Array<[RegExp, string]> = [
    [/got company|first believers?|first backers?|stepped in|showed up|someone backed|opened up|no longer empty/g, "arrival"],
    [/got heavier|piling in|money (came|went) (in|on)|capital arrived/g, "inflow"],
    [/money (is )?leaving|money came off|capital left|thinned out|emptied/g, "outflow"],
    [/back from the dead|woke up|reawakened|quiet again/g, "revival"],
  ];
  const fold = (t: string) => FAMILIES.reduce((acc, [re, tok]) => acc.replace(re, tok), t);
  // Otherwise: does the body reuse the headline's own words and nothing else?
  const stop = new Set(["the", "a", "an", "just", "is", "was", "in", "on", "it", "its", "to", "of", "and", "this", "that", "has", "have", "some", "into", "off", "up", "down", "now", "here", "they", "their"]);
  const words = (t: string) => new Set(t.replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w && !stop.has(w)));
  const hw = words(fold(h));
  const dw = [...words(fold(d))];
  if (dw.length === 0) return false;
  const fresh = dw.filter((w) => !hw.has(w) && ![...hw].some((x) => x.startsWith(w) || w.startsWith(x)));
  return fresh.length >= 2;
}

/** Both rules, in the order an editor applies them. */
export function editFeed<T extends EditorialRow>(rows: readonly T[]): T[] {
  return capFamilies(pruneRepeats(collapseCausal(rows.filter(earnsSlot))));
}

/** A row as the no-duplicate-cards rule needs it: its loud copy and its rank. */
export interface VerbatimRow {
  id: string;
  /** The kicker, as printed. */
  headline: string;
  /** The one sentence under it, as printed. */
  body: string;
  /** Higher wins the single surviving slot. */
  significance?: number | null;
  /** A telling that also asks a question is the more informative survivor. */
  informative?: boolean | null;
}

/** Strictly more deserving of the one slot a group of identical cards may keep. */
function outranks(a: VerbatimRow, b: VerbatimRow): boolean {
  const sa = num(a.significance);
  const sb = num(b.significance);
  if (sa !== sb) return sa > sb;
  if (!!a.informative !== !!b.informative) return !!a.informative;
  return false; // a full tie keeps the earlier row
}

/**
 * NO TWO IDENTICAL CARDS.
 *
 * Everything above chooses rows on significance and rations how many of a KIND
 * may appear; none of it can see that two survivors print the EXACT same loud
 * copy. A market waking up and another waking up both say "IT WOKE UP / This
 * market had gone quiet for a week…", word for word, because the sentence
 * carries no market-specific detail — the title sits below it, muted. Two
 * markets that have each gone sixteen days with no one opposite read
 * "16 DAYS. STILL NO ONE ON NO." twice. One such card is a fact; two side by
 * side read as a bug.
 *
 * So the last editorial act collapses rows whose headline AND body are
 * byte-identical (case- and whitespace-normalised) to their single strongest
 * telling — tie-broken toward the one that also asks a question — and returns
 * the ids to drop. Only the LOUD copy counts: a differing question or a
 * differing muted title still reads as the same card, and two rows with
 * different bodies (two different people who "STEPPED IN") are genuinely
 * different news and both stay. Nothing is lost for good — the standing window
 * rotates, so a dropped market takes the slot on a later build.
 */
export function dropVerbatimDuplicates<T extends VerbatimRow>(rows: readonly T[]): Set<string> {
  const norm = (x: string) => (x ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const best = new Map<string, T>();
  const drop = new Set<string>();
  for (const r of rows) {
    const key = `${norm(r.headline)} ${norm(r.body)}`;
    // A row with no loud copy at all is not a card this rule can compare.
    if (key === " ") continue;
    const held = best.get(key);
    if (!held) {
      best.set(key, r);
      continue;
    }
    // Keep the stronger of the two; the other is a duplicate card.
    if (outranks(r, held)) {
      drop.add(held.id);
      best.set(key, r);
    } else {
      drop.add(r.id);
    }
  }
  return drop;
}
