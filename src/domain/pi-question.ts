/**
 * THE QUESTION LAYER — the last stage of the Insider pipeline.
 *
 *     facts → detect tension → explain what changed → ASK THE OPEN QUESTION → rank
 *
 * Everything before this file establishes what is true and says it plainly. This
 * file does the one thing that makes the feed read like an investigator rather
 * than a faster ticker: when two facts genuinely do not fit together, it asks
 * the reader the question the data has exposed — and never answers it.
 *
 * FOUR RULES, ALL ENFORCED BELOW.
 *
 * 1. THE QUESTION IS EARNED, NOT DECORATIVE. Only a row the vector already calls
 *    Intelligence, carrying a named unresolved shape (a contradiction, a silence
 *    after real money, a hierarchy that changed hands, a person unwinding), may
 *    ask anything. Receipts and milestones never do.
 * 2. IF THE FACTS ALREADY ANSWER IT, THERE IS NO QUESTION. A `resolved` clue has
 *    its own ending ("Now it's moving") — asking after that is theatre.
 * 3. THE QUESTION COMES FROM THE SIGNAL, NOT FROM A BADGE. Every line here is
 *    written against a specific `tensionKind` / `concentrationKind` / signal, so
 *    it can only ask about the gap those numbers actually expose. There is no
 *    generic "why now?" pool.
 * 4. NO HYPOTHESIS THE EVIDENCE DOES NOT SUPPORT. The PI may name the two
 *    candidate readings the data leaves open ("winding down, or making room?")
 *    and must never assert either, imply hidden knowledge, or manufacture
 *    urgency.
 *
 * THE GRAMMAR. 7:30 dinner. Champagne. Strawberries. "Business dinner?" The
 * investigator does not invent what happened; he puts the facts next to each
 * other and asks the question their combination creates. Every line below does
 * exactly one of four things:
 *
 *   RECONCILE  two facts that do not naturally fit ("More believers, less
 *              money. Are smaller positions replacing a bigger one?")
 *   IDENTIFY   the person or capital on the other side ("The biggest position
 *              is gone. Who carries this side now?")
 *   DISTINGUISH between two structural readings ("Is conviction spreading, or
 *              thinning out?")
 *   CHALLENGE  the obvious reading ("Higher price. Same crowd. What changed
 *              underneath it?")
 *
 * Banned by construction, because they claim something the tape cannot see:
 * "did they know something", "what did they see", "why hasn't this been priced",
 * "is the price about to follow". No privileged knowledge, no expectation, no
 * prediction. And the question must live one inference PAST the receipt — never
 * "did money leave?" under a row that just said money left.
 *
 * Determinism is inherited from pi-voice: variants are a hash of a stable key,
 * so a row asks the same question on every refresh, on server and client.
 */
import { piHash, pickVariant, voiceLevel, INTELLIGENCE_GAIN_MIN, type VoiceInput } from "./pi-voice";
import { semanticQuestion, type SemanticInput } from "./semantic-question";

/** The shape of gap being asked about. One per feed window (see `rationQuestions`). */
export type QuestionKind =
  | "people_up_capital_down"
  | "capital_up_price_flat"
  | "price_up_believers_flat"
  | "believers_left_price_rose"
  | "whales_out_newcomers_in"
  | "nonresponse"
  | "before_price"
  | "largest_holder_left"
  | "newcomers_replaced_a_whale"
  | "concentrating"
  | "person_unwinding"
  | "unusual"
  /* CONTINUITY AGAINST CHANGE. Tenure alone asks nothing; tenure that survived
     a proven move is two facts that do not sit together. */
  | "standing_contrast"

  /* COMPOSED SHAPES — earned by a GROUP of rows rather than by one vector.
     See src/domain/composed-clue.ts. A clue built from several plain receipts
     is often the most interesting thing in the window, so these rank beside
     single-row shapes rather than beneath them. */
  | "person_repositioning"
  | "person_rotation"
  | "person_same_side"
  | "in_and_out"
  | "creator_pickup"
  | "side_burst"
  | "capital_concentrated_arrival"
  | "network_convergence"
  | "network_split"

  /* THE PROPOSITION SHAPE. Not a mechanic at all: the reader's own question,
     asked of the thing they took a side on. See src/domain/semantic-question. */
  | "semantic";

export type PIQuestion = { text: string; kind: QuestionKind };

export type QuestionInput = {
  /** Stable per-row key — the row id. Drives variant choice. */
  key: string;
  signal: VoiceInput | null | undefined;
  headline: string;
  body: string;
  /** Cross-market person observation, when the row has one. */
  pattern?: string | null;
  /** Display name of the single actor, when the row is about one person. */
  actorName?: string | null;
  /**
   * Set for continuity rows. `klass` decides whether the row may ask at all —
   * a receipt ("still here") and an observation ("still here, and one position
   * left") have nothing unresolved in them; only a proven contrast does — and
   * `kind` decides which contrast is being asked about.
   */
  standing?: { kind: string; klass: string } | null;
  /**
   * The market STATE + PROPOSITION pair, when the row is one of the few proven
   * shapes where the title makes the behaviour interesting. This is the only
   * question source in the file that is not a mechanic, and it is deliberately
   * the LAST one tried: a contradiction in the numbers is more specific than a
   * question about the title, so mechanics always win the slot when they exist.
   */
  semantic?: Omit<SemanticInput, "key"> | null;
  /**
   * Exact counts behind an "unusual" read, when known. Without them the
   * unusualness question has nothing concrete to point at and is not asked —
   * "what is different about it?" is a shrug, not a question.
   */
  unusual?: { trades24h?: number | null } | null;
};

/**
 * The proposition question, or null. Shared by every exit path below so that a
 * row which produces no mechanical clue can still be interesting, and a row
 * which produces one is never overwritten by a weaker semantic line.
 */
function semanticFor(input: QuestionInput): PIQuestion | null {
  if (!input.semantic) return null;
  const text = semanticQuestion({ ...input.semantic, key: input.key });
  if (!text) return null;
  // Same echo bar as every other question: it must add something the row's own
  // two sentences did not already print.
  if (!questionAdds(text, `${input.headline} ${input.body} ${input.pattern ?? ""}`)) return null;
  return { text, kind: "semantic" };
}


/**
 * The floor of the editorial budget — a quiet window still gets to be curious.
 *
 * There used to be a flat ceiling of three, which was right for a feed called
 * Now and wrong for a product called Insider. The question is one of the main
 * reasons the feed exists: it is the moment the reader stops scrolling and
 * opens the market. Three per window meant a rich hour of evidence shipped as
 * a list of conclusions with two questions buried in it.
 */
export const MIN_QUESTION_BUDGET = 3;
/** Nothing justifies more than this in one window. Curiosity, not a quiz. */
export const MAX_QUESTION_BUDGET = 9;
/**
 * The weakest a candidate may be and still be worth a slot, on the same scale
 * as `informationGain` (intelligence starts at 0.12). Below this the window
 * simply stops asking rather than filling its budget with filler.
 */
export const QUESTION_WEIGHT_FLOOR = 0.1;
/** A clue this strong is kept even when the budget is spent. */
export const PREMIUM_GAIN = 0.6;
/**
 * WHAT A SEMANTIC QUESTION IS WORTH IN THE RATIONER.
 *
 * This is the fix for the best layup in the corpus going unasked. "NO has
 * nothing behind it now" on a market that literally asks whether $20 is worth
 * the trade-off is the strongest question the product can ask — and it was
 * being weighed with the DERIVED ROW'S mechanical `informationGain`, which for
 * a state reading is ~0, i.e. below `QUESTION_WEIGHT_FLOOR`. The row never lost
 * an argument; it was never in the room. A semantic question's evidence is the
 * proven STATE SHAPE, not the vector, so it carries its own weight.
 */
export const SEMANTIC_GAIN = 0.45;

/**
 * The state shapes whose question must come from the proposition rather than
 * from whatever metric the vector happened to notice. These rows lead with the
 * state in their own headline, so any other source produces a question about
 * evidence the reader was never shown.
 */
export const STATE_LED_QUESTION: ReadonlySet<string> = new Set([
  "side_emptied",
  "back_from_dead",
  "side_got_company",
  "first_money_absolute",
]);



/**
 * How many questions this window has earned.
 *
 * Roughly one per five surviving stories — a healthy 20–30 row Insider feed
 * lands at 5–7 — widened when the window is genuinely anomalous (lots of
 * intelligence-grade rows) and never below the floor. Scarcity exists to
 * prevent interrogation, not to suppress real curiosity, so this is a budget
 * and not a cap: `rationQuestions` still refuses to spend it on weak shapes.
 */
export function questionBudget(surviving: number, intelligenceRows = 0): number {
  const base = Math.max(MIN_QUESTION_BUDGET, Math.round(surviving / 5));
  const rich = intelligenceRows >= 5 ? 2 : intelligenceRows >= 3 ? 1 : 0;
  return Math.min(MAX_QUESTION_BUDGET, base + rich);
}

/** A person visibly reducing exposure across a market — the pattern layer's words. */
const UNWINDING = /backing away|unwinding|cutting|reducing|stepped back|trimming/i;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function personQuestions(name: string | null): string[] {
  const who = name && name.trim().length > 0 ? name.trim() : "they";
  const Who = cap(who);
  return [
    `Two positions cut in a few hours. Losing conviction, or just lightening up?`,
    `Is ${who} winding down, or making room for something else?`,
    `${Who} left in pieces rather than all at once. Exit, or position sizing?`,
  ];
}

/**
 * THE QUESTION COMES FROM THE CONTRAST, NEVER FROM THE TENURE. "How long have
 * they held?" is answered by the row itself. "The price moved and the longest
 * holder didn't" is two facts that have to be reconciled, which is the only
 * thing worth asking about a standing story.
 */
function standingQuestions(kind: string, name: string | null): string[] {
  const who = name && name.trim().length > 0 ? name.trim() : "the longest holder";
  switch (kind) {
    case "held_through_price_move":
      return [
        "The price moved. The longest-held positions didn't. What is holding that conviction in place?",
        "Everything around them repriced and they sat still. Which of those two readings is the market?",
      ];
    case "whale_stayed_others_left":
      return [
        `Smaller positions left and the biggest one stayed. Is ${who} early, or the last one out?`,
        "The crowd thinned and the weight didn't move. Who is right about this side?",
      ];
    case "holder_stayed_capital_left":
      return [
        "Money came off this side and the oldest position stayed on it. Which one is reading it wrong?",
        `Capital left. ${cap(who)} didn't. What do they know about this side that the money doesn't?`,
      ];
    case "one_sided_persistence":
      return [
        "One side has been occupied for weeks and nobody has taken the other. Is that agreement, or absence?",
      ];
    default:
      return [];
  }
}

/**
 * The question this row has earned, or null — which is the answer for the large
 * majority of rows.
 */
export function piQuestion(input: QuestionInput): PIQuestion | null {
  const v = input.signal;
  /* THE QUESTION MUST INVESTIGATE THE STORY THE READER JUST READ.
     Mechanics normally outrank the proposition, and for a row whose headline is
     itself a mechanic that is right. But when the headline IS a state shape —
     a side emptied, a dormant market woke up, a side finally got money — a
     mechanical question sourced from a different metric reads as two unrelated
     documents stapled together ("Nobody touched this for a week. Then 2 trades
     landed… Fewer believers, higher price. Which is the real reading?"). For
     those shapes the proposition question is tried FIRST, because it is the one
     that investigates the clue the row actually printed. */
  if (input.semantic && STATE_LED_QUESTION.has(input.semantic.state)) {
    const led = semanticFor(input);
    if (led) return led;
  }
  /* NO VECTOR IS NOT THE SAME AS NOTHING TO ASK. Synthesized rows (continuity,
     person milestones) can arrive without a market vector and still sit on a
     proven state. */
  if (!v) return semanticFor(input);


  /* CONTINUITY ROWS ANSWER TO THEIR OWN RULE. A receipt and an observation are
     true and finished; only a proven contrast leaves something open, and what
     it leaves open is the contrast rather than anything the vector saw. */
  if (input.standing) {
    /* A receipt and an observation leave no MECHANICAL gap — but persistence
       against a proposition is exactly the case §19 asks for: fifteen days on
       one side of a question nobody will argue the other half of. So the
       semantic layer is offered here even when the contrast question is not. */
    if (input.standing.klass !== "intelligence") return semanticFor(input);
    const variants = standingQuestions(input.standing.kind, input.actorName ?? null);
    if (variants.length === 0) return semanticFor(input);
    const text = pickVariant(`${input.key}:standing_contrast`, variants);
    if (!questionAdds(text, `${input.headline} ${input.body}`)) return semanticFor(input);
    return { text, kind: "standing_contrast" };
  }


  /* RULE 1 — only a genuine clue may ask anything.
     Intelligence (a contradiction, a timed silence, pronounced unusualness)
     qualifies outright. Two observation-level shapes also do, because they are
     gaps in the evidence even when the market's own vector stays quiet:

     a. A PROVEN CROSS-MARKET UNWINDING. The pattern layer only writes "stepped
        back from two questions" once it has seen both, so the behaviour is a
        fact in hand. It used to be gated behind `concentration > 0`, which the
        feed sets to zero on purpose (the holder hierarchy before the event is
        not reconstructed in-feed) — an unrelated missing field was making the
        one PERSON-shaped question unreachable in production. The pattern is now
        its own sufficient evidence.
     b. A PROVEN CHANGE IN THE HOLDER HIERARCHY, where the vector does see it.

     Everything else stays declarative. */
  const level = voiceLevel(v);
  const unwinding = !!input.pattern && UNWINDING.test(input.pattern);
  /* A pronounced before-price gap qualifies too: `voiceLevel` deliberately
     tops out at observation for it (it is one reading, not a contradiction),
     but "the positions moved and the price didn't" is precisely an unresolved
     pair of facts. */
  const hierarchyGap = v.signals.concentration >= 0.6;
  const beforePriceGap = v.signals.beforePrice >= 0.6;
  const eligible =
    level === "intelligence" ||
    unwinding ||
    ((hierarchyGap || beforePriceGap) && v.informationGain >= INTELLIGENCE_GAIN_MIN);
  /* A row with no mechanical gap is not automatically silent. It may still be a
     proven STATE against a proposition, which is a different kind of gap and
     the one a human notices first. */
  if (!eligible) return semanticFor(input);
  // RULE 2 — a clue with a proven ending answers itself.
  if (v.clue === "resolved") return semanticFor(input);

  const s = v.signals;
  let kind: QuestionKind | null = null;
  let variants: string[] = [];

  if (s.tension > 0 && v.tensionKind) {
    kind = v.tensionKind;
    switch (v.tensionKind) {
      case "people_up_capital_down":
        variants = [
          "More believers, less money. Are smaller positions replacing a bigger one?",
          "Who left while everyone else was arriving?",
          "More hands, less money. Is conviction spreading, or thinning out?",
        ];
        break;
      case "capital_up_price_flat":
        variants = [
          "More money. Same price. What's absorbing it?",
          "Money keeps arriving and the price holds. Who is taking the other side?",
          "If this much came in, what is selling into it?",
        ];
        break;
      case "price_up_believers_flat":
        variants = [
          "Higher price. Same crowd. What changed underneath it?",
          "Higher price. Same crowd. Did existing positions get bigger?",
          "Is this broader conviction, or the same believers paying more?",
        ];
        break;
      case "believers_left_price_rose":
        variants = [
          "People left and the price rose. Who bought what they sold?",
          "Fewer believers, higher price. Which of those is the real reading?",
        ];
        break;
      case "whales_out_newcomers_in":
        variants = [
          "Big positions out, small ones in. Is the conviction the same size?",
          "Fewer, larger holders replaced by more, smaller ones. Handover, or thinning?",
        ];
        break;
    }
  } else if (s.nonresponse > 0) {
    kind = "nonresponse";
    variants = [
      "Money came in. Price stayed put. What took the other side?",
      "That much landed and the price held. Who was selling into it?",
      "Real money, no move. Is the other side deeper than it looks?",
    ];
  } else if (s.concentration > 0 && v.concentrationKind) {
    switch (v.concentrationKind) {
      case "largest_holder_left":
        kind = "largest_holder_left";
        variants = [
          "The biggest position is gone. Who carries this side now?",
          "Does anyone left here hold a position that size?",
        ];
        break;
      case "newcomers_replaced_a_whale":
        kind = "newcomers_replaced_a_whale";
        variants = [
          "More people, smaller positions. Is conviction spreading, or thinning out?",
          "The weight moved from one holder to several. Same conviction, or less of it?",
        ];
        break;
      case "concentrating":
        kind = "concentrating";
        variants = [
          "How much of this side is really one person?",
          "A crowd on paper. If that holder leaves, what is left behind them?",
        ];
        break;
      default:
        kind = null;
    }
  } else if (s.beforePrice > 0) {
    kind = "before_price";
    variants = [
      "The money moved and the price didn't. Which one is wrong?",
      "Positions changed before the price. Who is quietly taking the other side?",
    ];
  } else if (s.unusual >= 0.8) {
    kind = "unusual";
    /* "What is different about it?" is not a question, it is a shrug: it names
       no fact and could sit under any row in the feed. An unusualness question
       has to point at the one thing the reader could actually go and check —
       whether the volume is one participant or many. */
    /* AND IT MUST COUNT SOMETHING. "Busier than this market has ever been" names
       no number the reader can check, which is why it read as a template and
       survived long enough to become the canonical example of generic copy. The
       question now requires the trade count that makes it concrete, and simply
       is not asked without it. */
    const n = input.unusual?.trades24h ?? null;
    variants =
      n != null && n > 0
        ? [
            `${n} ${n === 1 ? "trade" : "trades"} today against this market's usual trickle. One wallet, or a crowd?`,
            `${n} ${n === 1 ? "trade" : "trades"} in a day here. Did they all come from one side?`,
          ]
        : [];
  }


  // A person visibly unwinding is the one PERSON-shaped question. It may lead
  // when the market shapes above found nothing, because the behaviour is the
  // unresolved thing.
  if (!kind && input.pattern && UNWINDING.test(input.pattern)) {
    kind = "person_unwinding";
    variants = personQuestions(input.actorName ?? null);
  }
  // ...and it overrides a bare concentration or unusualness read, where the
  // person IS the gap: "busier than usual" is a weaker reading of the same
  // rows than "the same person stepped back from two questions".
  if (
    (kind === "largest_holder_left" || kind === "concentrating" || kind === "unusual") &&
    input.pattern &&
    UNWINDING.test(input.pattern)
  ) {
    kind = "person_unwinding";
    variants = personQuestions(input.actorName ?? null);
  }

  if (!kind || variants.length === 0) return semanticFor(input);

  const text = pickVariant(`${input.key}:${kind}`, variants);

  // RULE 4-adjacent: a question that only repeats the sentence above it is not
  // a question, it is an echo. It must introduce something the row hasn't said.
  if (!questionAdds(text, `${input.headline} ${input.body} ${input.pattern ?? ""}`))
    return semanticFor(input);

  return { text, kind };
}

const STOP = new Set([
  "the","a","an","is","are","was","were","and","or","but","if","it","its","this","that","these",
  "those","to","of","in","on","at","for","with","by","as","from","did","do","does","has","have",
  "had","not","no","yes","just","still","now","who","what","why","how","them","they","their",
  "there","here","been","be","more","less","than","into","out","up","down","over","anyone",
  "someone","something","else","much","many","one","two","same","other","another","while","when",
]);

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9$%.\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));

/**
 * True when the question introduces a term the row has not already printed —
 * the canonical rule ("if it doesn't change how I read the line above, it isn't
 * intelligence") applied to the third line.
 */
export function questionAdds(question: string, said: string): boolean {
  const known = new Set(words(said));
  const fresh = words(question).filter((w) => !known.has(w));
  return fresh.length >= 2;
}

/**
 * Window-wide rationing. Keeps the strongest few questions and at most one of
 * each shape, so a busy hour cannot turn the feed into a quiz. Returns the set
 * of row ids allowed to keep their question.
 */
export function rationQuestions(
  rows: Array<{ id: string; kind: QuestionKind; gain: number; personal?: boolean; text?: string }>,
  max: number = MIN_QUESTION_BUDGET,
): Set<string> {
  /* A REPEATED SHAPE PAYS, IT IS NOT BANNED.
     The old rule kept at most one question of each kind, which sounds like
     variety and behaves like censorship: two genuinely strong contradictions in
     one window are two genuinely strong contradictions, and silencing the
     second one is an editorial lie. Instead each repeat of a shape halves that
     candidate's effective weight, so a second "people up, capital down" has to
     beat everything else on the board to be worth its slot.

     Selection is greedy over the decayed weights rather than a single sort,
     so a premium clue arriving late never loses to three mediocre ones that
     happened to be scored first. */
  const keep = new Set<string>();
  const used = new Map<QuestionKind, number>();
  /* THE SAME SENTENCE TWICE IS NOT VARIETY, IT IS A BUG THE READER CAN SEE.
     Shape decay allows a repeated KIND when both clues are strong, but two rows
     whose variants hashed to identical words read as a template. The second one
     is dropped outright. */
  const spoken = new Set<string>();
  const norm = (t: string | undefined) => (t ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const pool = [...rows].sort(
    (a, b) => b.gain - a.gain || (piHash(a.id) - piHash(b.id) || a.id.localeCompare(b.id)),
  );

  const weight = (r: { kind: QuestionKind; gain: number; personal?: boolean }) =>
    (r.gain + (r.personal ? 0.08 : 0)) * Math.pow(0.5, used.get(r.kind) ?? 0);

  // Premium clues bypass scarcity: the whole point of a budget is to protect
  // these, so they may never be the thing it excludes.
  for (const r of pool)
    if (r.gain >= PREMIUM_GAIN && !spoken.has(norm(r.text))) {
      keep.add(r.id);
      spoken.add(norm(r.text));
      used.set(r.kind, (used.get(r.kind) ?? 0) + 1);
    }

  /* The budget governs ORDINARY picks. Premium clues sit outside it — counting
     them against it would make the strongest evidence in the window crowd out
     everything else, which is the opposite of what a budget is for. */
  const premiumCount = keep.size;
  while (keep.size - premiumCount < max) {
    let best: (typeof pool)[number] | null = null;
    let bestW = -Infinity;
    for (const r of pool) {
      if (keep.has(r.id) || (r.text != null && spoken.has(norm(r.text)))) continue;
      const w = weight(r);
      if (w > bestW) {
        best = r;
        bestW = w;
      }
    }
    /* Never manufacture a question to fill the budget: once the decayed weight
       of the best remaining candidate falls below the bar, the window is done
       asking. */
    if (!best || bestW < QUESTION_WEIGHT_FLOOR) break;
    keep.add(best.id);
    spoken.add(norm(best.text));
    used.set(best.kind, (used.get(best.kind) ?? 0) + 1);
  }
  return keep;
}
