/**
 * INSIDER — THE EDITORIAL PASS.
 *
 * Subtraction, then patterns, then questions — in that order, because the order
 * is the feature.
 *
 *   1. EDITORIAL SUBTRACTION. A second row about the same market has to say
 *      something the first didn't, and low-value truth is still not news. It
 *      needs the finished copy and the finished amounts, so it runs after
 *      narration, and it only ever removes rows.
 *   2. CROSS-MARKET PERSON PATTERNS. What one row structurally cannot see: the
 *      same person's third question this afternoon, everything they touched
 *      today being NO. Runs after subtraction, so a pattern only ever describes
 *      rows the reader will see. A promoted pattern CONSUMES its ordinary
 *      receipts on the app-wide tape.
 *   3. THE QUESTION LAYER. Single-row clues, then composed clues, then
 *      rationing over exactly the corpus the reader will see.
 *
 * Lifted out of `buildTape` whole and pure — no IO, no clock beyond `Date`
 * already baked into the rows. It mutates the rows it is given (and splices the
 * array) because those rows ARE the feed, and returns the diagnostics the
 * caller reports under SIGNAL_DIAGNOSTIC=1.
 */
import { flattenStory, type LiveRow } from "@/lib/live-tape";
import { dropVerbatimDuplicates, editFeed, secondSentenceAdds } from "@/domain/feed-editorial";
import { findPersonPatterns } from "@/domain/person-pattern";
import {
  piQuestion,
  questionAdds,
  questionBudget,
  rationQuestions,
  SEMANTIC_GAIN,
  type QuestionKind,
} from "@/domain/pi-question";
import { composeClues, type ComposedClue } from "@/domain/composed-clue";
import {
  ONE_SIDED_MIN_DAYS,
  LOPSIDED_MIN_LEAD_USD,
  LOPSIDED_RATIO,
  isAbsoluteClaim,
  type SemanticInput,
} from "@/domain/semantic-question";
import type { SignalVector } from "@/domain/signal-vector";
import type { Momentum } from "@/lib/insider/source.server";
import type { Candidate } from "@/lib/insider/composition/significance-pass";

export interface EditorialPassInput<R extends LiveRow> {
  /** The surviving rows, mutated and spliced in place. */
  material: R[];
  /** Inside a market panel the individual transaction IS the subject. */
  scoped: boolean;
  actionById: Map<string, string>;
  copySuppressed: Set<string>;
  signalById: Map<string, SignalVector>;
  momentumById: Map<number, Momentum>;
  standingKindById: Map<string, { kind: string; klass: string }>;
  pulseIds: Set<string>;
  /** Rows the admission gate rejected — evidence for composition, never anchors. */
  unadmitted: Array<Candidate<R>>;
}

export interface QuestionLedgerEntry {
  id: string;
  kind: string;
  source: "row" | "composed";
  gain: number;
  why: string;
  text: string | null;
  rejected: string | null;
  kept: boolean;
}

export interface EditorialPassResult {
  /** Diagnostic: the receipts a promoted story absorbed (newest last). */
  consumedRows: Array<{ id: string; headline: string }>;
  questionLedger: QuestionLedgerEntry[];
}

/**
 * IS THIS ROW ORDINARY EVIDENCE — i.e. may a story that contains it absorb it?
 *
 * Receipts → evidence → pattern → story. Once the pattern has been told at full
 * volume, the constituent transactions are proof, not news. The exception is the
 * constituent that would have been a story without the pattern: anything the
 * voice layer calls an observation or intelligence keeps its slot.
 */
const ORDINARY_EVIDENCE_MAX = 0.5;

export function runEditorialPass<R extends LiveRow>({
  material,
  scoped,
  actionById,
  copySuppressed,
  signalById,
  momentumById,
  standingKindById,
  pulseIds,
  unadmitted,
}: EditorialPassInput<R>): EditorialPassResult {
  // ── 1. SUBTRACTION ───────────────────────────────────────────────────────
  {
    const keep = new Set(
      editFeed(
        material.map((r) => ({
          id: r.id,
          kind: r.kind,
          marketId: String(r.marketId),
          occurredAt: r.occurredAt,
          motif: r.mix?.motif ?? null,
          amountUsd: r.amountUsd ?? null,
          significance: r.mix?.significance ?? null,
          action: actionById.get(r.id) ?? null,
          personal: r.story?.personal ?? false,
          rung: (r.payload as { rung?: number } | null)?.rung ?? null,
          side: r.side === "YES" || r.side === "NO" ? r.side : null,
          // A market_transition is a DERIVED reading of state; every other
          // family is somebody doing something, with a name attached.
          derived: r.kind === "market_transition",
          metric:
            (r.payload as { metric?: "capital" | "price" | "believers" } | null)?.metric ?? null,
          // Every derived market read is a rolling-window statement ("in the
          // last hour"), so two of them are two looks at one state.
          rolling: r.kind === "market_transition",
          /* FAMILY IS THE CLAIM, NOT THE TABLE. Five "just got company" rows
             arrive as three different kinds (a trade, a transition, a
             milestone) and read as one sentence repeated. When the printed
             kicker makes the first-participation claim, that IS the family, so
             the cap can ration it. */
          family: /emptied out|nothing behind it now/i.test(r.story?.headline ?? "")
            ? "side_emptied"
            : /got company|first believers?|first capital|stepped in/i.test(r.story?.headline ?? "")
              ? "side_opened"
              : r.kind === "market_transition"
                ? ((r.payload as { type?: string } | null)?.type ?? null)
                : r.kind,

          // Market-scoped rows need the question to make sense standalone.
          context: r.marketId ? (r.marketTitle ?? "").trim().length > 0 : true,
          suppressed: copySuppressed.has(r.id),
          /* A first-participation row earns its slot when the body says
             something the kicker didn't — a number, a person, a counterpoint.
             Otherwise it is one of five identical "just got company" rows and
             the family cap rations it to one. */
          secondFact: secondSentenceAdds(r.story?.headline ?? "", r.story?.body ?? ""),
        })),
      ).map((r) => r.id),
    );
    for (let i = material.length - 1; i >= 0; i--)
      if (!keep.has(material[i]!.id)) material.splice(i, 1);
  }

  // ── 2. CROSS-MARKET PERSON PATTERNS ──────────────────────────────────────
  /* The pattern text per row, kept even when the pattern is promoted into the
     headline. The question layer below reads it as evidence, and a promoted
     pattern is the strongest evidence of all. */
  const patternById = new Map<string, string>();
  /* Constituent receipts a promoted behavioural story now contains. Dropped
     from the GLOBAL surface only. */
  const consumedByPattern = new Set<string>();
  const ordinaryEvidence = (id: string): boolean => {
    const r = material.find((x) => x.id === id);
    if (!r) return false;
    return (
      (r.mix?.voice ?? "receipt") === "receipt" &&
      (r.mix?.significance ?? 0) < ORDINARY_EVIDENCE_MAX
    );
  };

  for (const p of findPersonPatterns(
    material.map((r) => ({
      id: r.id,
      wallet: r.wallet ?? null,
      marketId: String(r.marketId),
      marketTitle: r.marketTitle ?? null,
      side: r.side === "YES" || r.side === "NO" ? r.side : null,
      action: (actionById.get(r.id) ?? null) as never,
      amountUsd: r.amountUsd ?? null,
      name: r.face?.name ?? null,
      occurredAt: r.occurredAt,
    })),
  )) {
    const target = material.find((r) => r.id === p.rowId);
    if (!target?.story) continue;
    /* WHEN THE PATTERN IS THE INTERESTING PART, IT BECOMES THE STORY — AND IT
       TAKES ITS RECEIPTS WITH IT. Five rows to say one thing, with the one
       thing in the smallest type, is the failure this prevents. Inside a market
       panel the constituents stay, because there the individual transaction IS
       the subject. Promotion happens when the event is receipt-grade (the
       pattern clearly out-informs it) or when the pattern spans other rows the
       reader would otherwise read separately. */
    patternById.set(p.rowId, p.note);
    const collapsible = !scoped && p.consumes.length > 0;
    if (p.lead && ((target.mix?.voice ?? "receipt") === "receipt" || collapsible)) {
      target.story = {
        ...target.story,
        category: "momentum",
        headline: p.lead.headline.toUpperCase(),
        body: p.lead.body,
        pattern: null,
      };
      target.text = flattenStory(target.story);
      if (target.mix) {
        target.mix.voice = "observation";
        target.mix.significance = Math.max(target.mix.significance, 0.5);
      }
      /* ORDINARY EVIDENCE IS CONSUMED; AN UNUSUAL CONSTITUENT SURVIVES. A
         constituent that is itself intelligence-grade (a contradiction, a
         whale, a market state change) is news in its own right. */
      if (collapsible)
        for (const id of p.consumes) if (ordinaryEvidence(id)) consumedByPattern.add(id);

      continue;
    }
    target.story = { ...target.story, pattern: p.note };
  }
  /* Diagnostic only (SIGNAL_DIAGNOSTIC=1): the receipts a promoted behavioural
     story absorbed, so a reviewer can read the before → after directly. */
  const consumedRows: Array<{ id: string; headline: string }> = [];
  const consumedForClues: R[] = [];
  if (consumedByPattern.size > 0)
    for (let i = material.length - 1; i >= 0; i--)
      if (consumedByPattern.has(material[i]!.id)) {
        const [gone] = material.splice(i, 1);
        if (gone) {
          consumedForClues.push(gone);
          consumedRows.push({ id: gone.id, headline: gone.story?.headline ?? "" });
        }
      }

  // ── 3. NO TWO IDENTICAL CARDS ────────────────────────────────────────────
  /* Runs BEFORE the question layer, for the same reason absorption does: two
     survivors can print the exact same loud copy — two markets that "woke up",
     two that have gone the same number of days with no one opposite — because
     the sentence carries no market-specific detail. Collapsing them after
     rationing would spend the question budget on rows the reader never sees,
     so collapse first and let the standing rotation resurface the rest on a
     later build. See feed-editorial `dropVerbatimDuplicates`. */
  {
    const dup = dropVerbatimDuplicates(
      material.flatMap((r) =>
        r.story
          ? [
              {
                id: r.id,
                headline: r.story.headline,
                body: r.story.body,
                significance: r.mix?.significance ?? null,
                informative: false,
              },
            ]
          : [],
      ),
    );
    if (dup.size > 0)
      for (let i = material.length - 1; i >= 0; i--)
        if (dup.has(material[i]!.id)) material.splice(i, 1);
  }

  // ── 4. THE QUESTION LAYER ────────────────────────────────────────────────
  /* facts → detect tension → explain what changed → ASK THE OPEN QUESTION.
     IT RUNS HERE, AND THE POSITION IS THE FEATURE: the corpus the rationer sees
     is exactly the corpus the reader sees, and `findPersonPatterns` has already
     written the patterns the PERSON question reads. */
  /** Diagnostic row for a composed clue (SIGNAL_DIAGNOSTIC=1 reporting). */
  const clueEntry = (c: ComposedClue) => ({
    id: c.rowId,
    kind: c.kind as string,
    source: "composed" as const,
    gain: c.gain,
    why: `${c.why} [${c.members.length} rows]`,
    text: c.text,
    rejected: null as string | null,
    kept: false,
  });
  const questionLedger: QuestionLedgerEntry[] = [];
  {
    const asked: Array<{
      id: string;
      kind: QuestionKind;
      gain: number;
      personal?: boolean;
      text?: string;
    }> = [];
    const drafted = new Map<string, string>();
    /** Ordinary receipts absorbed by a promoted composed clue (see stage 2). */
    const consumedByClue = new Set<string>();

    /* THE PROPOSITION PAIR. Which already-proven STATE, if any, this row sits
       on — the only input the semantic question layer takes beyond the title.
       Nothing here is inferred about what the question MEANS; that stays the
       reader's job, and the PI only asks. See src/domain/semantic-question. */
    const semanticStateFor = (r: R): Omit<SemanticInput, "key"> | null => {
      const title = (r.marketTitle ?? "").trim();
      if (title.length === 0) return null;
      const m = momentumById.get(Number(r.marketId));
      const head = r.story?.headline ?? "";
      const side = r.side === "YES" || r.side === "NO" ? r.side : null;
      const ageDays = m?.marketAgeDays ?? null;

      const byNow = m?.believersYes ?? null;
      const bnNow = m?.believersNo ?? null;
      const sideBelievers = side === "YES" ? byNow : side === "NO" ? bnNow : null;
      const oppBelievers = side === "YES" ? bnNow : side === "NO" ? byNow : null;

      /* READ THE BOOK, NOT THE SENTENCE. This used to key on the printed
         kicker, which meant a copy change silently switched the best question
         in the product off. An empty side with people opposite is a STATE, and
         it is the state the question is about. */
      if (
        /emptied out|nothing behind it now|no one left/i.test(head) ||
        (side != null && sideBelievers === 0 && (oppBelievers ?? 0) > 0)
      )
        return { title, state: "side_emptied", side };

      if (/back from the dead|woke this up|this one's back|^a pulse$/i.test(head))
        return {
          title,
          state: "back_from_dead",
          side: null,
          facts: { quietDays: 7, trades: m?.tradeCount24h ?? null },
        };

      if (
        /got company|first capital|stepped into an empty|empty no more/i.test(head) &&
        ageDays != null
      ) {
        /* FIRST MONEY AGAINST AN ABSOLUTE CLAIM is a different question: the
           proposition already ruled the other answer out, so the arrival is a
           disagreement, not a participation receipt. */
        if (side != null && isAbsoluteClaim(title))
          return { title, state: "first_money_absolute", side, facts: { days: ageDays } };
        return { title, state: "side_got_company", side, facts: { days: ageDays } };
      }

      /* PERSISTENT ONE-SIDEDNESS. "Still nobody will take NO" is only factual
         when NO is empty RIGHT NOW and the market is old enough for "still" to
         mean something, so both are required and the age is the proven floor. */
      const by = m?.believersYes ?? null;
      const bn = m?.believersNo ?? null;
      if (
        by != null &&
        bn != null &&
        ageDays != null &&
        ageDays >= ONE_SIDED_MIN_DAYS &&
        ((by > 0 && bn === 0) || (bn > 0 && by === 0))
      )
        return {
          title,
          state: "one_sided_persistence",
          side: by > 0 ? "YES" : "NO",
          facts: { days: ageDays },
        };

      const cy = m?.capitalHeldYes ?? null;
      const cn = m?.capitalHeldNo ?? null;
      if (cy != null && cn != null) {
        const lead = Math.max(cy, cn);
        const light = Math.min(cy, cn);
        if (lead >= LOPSIDED_MIN_LEAD_USD && light <= lead * LOPSIDED_RATIO)
          return {
            title,
            state: "lopsided_book",
            side: cy >= cn ? "YES" : "NO",
            facts: { leadUsd: lead, laggardUsd: light },
          };
      }
      return null;
    };

    /* STAGE 1 — SINGLE-ROW CLUES. One vector, one named gap. */
    for (const r of material) {
      if (!r.story) continue;
      /* A HEARTBEAT ROW CANNOT INTERROGATE THE READER. It is in the feed
         because the page had gone quiet, not because anything about it is
         unresolved. Stage 2 below is deliberately NOT gated: if this receipt
         turns out to be part of a real pattern, the composed clue may ask. */
      if (pulseIds.has(r.id)) continue;
      const q = piQuestion({
        key: r.id,
        signal: signalById.get(r.id),
        headline: r.story.headline,
        body: r.story.body,
        pattern: r.story.pattern ?? patternById.get(r.id) ?? null,
        actorName: r.face?.name ?? r.people?.[0]?.name ?? null,
        standing: standingKindById.get(r.id) ?? null,
        semantic: semanticStateFor(r),
        unusual: { trades24h: momentumById.get(Number(r.marketId))?.tradeCount24h ?? null },
      });
      if (!q) continue;
      drafted.set(r.id, q.text);
      /* A SEMANTIC QUESTION CARRIES ITS OWN WEIGHT. Its evidence is the proven
         state shape and the proposition, not the row's mechanical vector —
         which on a derived state reading is near zero, i.e. under the
         rationer's floor. */
      const gain =
        q.kind === "semantic"
          ? Math.max(signalById.get(r.id)?.informationGain ?? 0, SEMANTIC_GAIN)
          : (signalById.get(r.id)?.informationGain ?? 0);
      asked.push({
        id: r.id,
        kind: q.kind,
        gain,
        personal: r.face?.relationship != null,
        text: q.text,
      });
      questionLedger.push({
        id: r.id,
        kind: q.kind,
        source: "row",
        gain: signalById.get(r.id)?.informationGain ?? 0,
        why: "single-row signal shape",
        text: q.text,
        rejected: null,
        kept: false,
      });
    }

    /* STAGE 2 — COMPOSED CLUES. The 7:30-dinner stage: facts that are dull
       alone and pointed together. Runs on the FINAL rows, so a composed clue
       can only ever be built from evidence the reader can actually see.
       Evidence includes the receipts a promoted behavioural story absorbed and
       the moves the admission gate rejected — the dust in particular, which is
       how a repositioning is PROVED. Neither can be an anchor:
       `surviving: false` keeps a question off a row the reader cannot see. */
    for (const c of composeClues(
      [...material, ...consumedForClues, ...unadmitted.map(({ r }) => r)].map((r) => ({
        id: r.id,
        marketId: String(r.marketId),
        marketTitle: r.marketTitle ?? null,
        wallet: r.wallet ?? null,
        name: r.face?.name ?? null,
        relationship: (r.face?.relationship as string | null) ?? null,
        side: r.side === "YES" || r.side === "NO" ? r.side : null,
        action: actionById.get(r.id) ?? null,
        amountUsd: r.amountUsd ?? null,
        kind: r.kind,
        occurredAt: r.occurredAt,
        surviving: material.some((m) => m.id === r.id) && !consumedByPattern.has(r.id),
      })),
    )) {
      const target = material.find((r) => r.id === c.rowId);
      if (!target?.story) continue;
      /* WHEN THE COMPOSITION IS THE BETTER CLUE, IT WINS. A row's own question
         is more specific, so it keeps its slot — unless the composed clue is
         measurably stronger, which is common. */
      const own = asked.find((a) => a.id === c.rowId);
      if (own && own.gain >= c.gain) {
        questionLedger.push({
          ...clueEntry(c),
          rejected: "row asks a stronger question",
          kept: false,
        });
        continue;
      }
      // Same echo bar as every other question: it must add a term the row
      // has not already printed.
      const said = `${target.story.headline} ${target.story.body} ${target.story.pattern ?? ""}`;
      if (!questionAdds(c.text, said)) {
        questionLedger.push({ ...clueEntry(c), rejected: "echoes the row", kept: false });
        continue;
      }
      drafted.set(c.rowId, c.text);
      if (own) {
        asked.splice(asked.indexOf(own), 1);
        const prior = questionLedger.find((e) => e.id === c.rowId && e.source === "row");
        if (prior) prior.rejected = "superseded by the composed clue";
      }
      asked.push({
        id: c.rowId,
        kind: c.kind,
        gain: c.gain,
        personal: target.face?.relationship != null,
        text: c.text,
      });
      questionLedger.push(clueEntry(c));

      /* THE COMPOSITION OWNS THE ROW IT ASKS ABOUT — AND CONSUMES ITS EVIDENCE.
         Where the clue is a person's behaviour and the anchor is an ordinary
         receipt, the behaviour becomes the headline and the receipt becomes the
         evidence line under it. */
      if (!scoped && c.lead && (target.mix?.voice ?? "receipt") === "receipt") {
        target.story = {
          ...target.story,
          category: "momentum",
          headline: c.lead.headline.toUpperCase(),
          body: c.lead.body,
          pattern: null,
        };
        target.text = flattenStory(target.story);
        if (target.mix) {
          target.mix.voice = "observation";
          target.mix.significance = Math.max(target.mix.significance, 0.5);
        }
        for (const id of c.members)
          if (id !== c.rowId && ordinaryEvidence(id)) consumedByClue.add(id);
      }
    }

    /* Absorb before rationing, never after: the budget must be spent on rows
       the reader will actually see. */
    if (consumedByClue.size > 0) {
      for (let i = material.length - 1; i >= 0; i--)
        if (consumedByClue.has(material[i]!.id)) {
          const [gone] = material.splice(i, 1);
          if (gone) consumedRows.push({ id: gone.id, headline: gone.story?.headline ?? "" });
        }
      for (let i = asked.length - 1; i >= 0; i--)
        if (consumedByClue.has(asked[i]!.id)) asked.splice(i, 1);
    }

    /* STAGE 3 — RATIONING, over exactly the rows the reader will see. */
    const intelligenceRows = material.filter(
      (r) => (r.mix?.voice ?? "receipt") === "intelligence",
    ).length;
    const keep = rationQuestions(asked, questionBudget(material.length, intelligenceRows));
    for (const r of material) {
      if (!r.story) continue;
      const text = keep.has(r.id) ? (drafted.get(r.id) ?? null) : null;
      if (!text) continue;
      /* A question is the interpretation layer, not a fourth repetition of the
         evidence. Bodies carrying a number, person or counterpoint survive. */
      const body = secondSentenceAdds(r.story.headline, r.story.body) ? r.story.body : "";
      r.story = { ...r.story, body, question: text };
      r.text = flattenStory(r.story);
    }
    /**
     * `kept` IS THE LAST WORD BECAUSE NOTHING BELOW HERE REMOVES A ROW.
     *
     * The defect this used to need reconciling for — a question stamped `kept`
     * on a card that de-duplication then spliced away, so the ledger reported a
     * question no reader would ever see — is gone at the source: stage 3 now
     * collapses identical cards BEFORE the budget is spent. Reconciling after
     * the fact would be a second answer to a question the ordering already
     * settles.
     */
    for (const e of questionLedger) if (keep.has(e.id) && !e.rejected) e.kept = true;
  }

  return { consumedRows, questionLedger };
}
