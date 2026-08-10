/**
 * COMPOSED CLUES — the questions no single row can ask.
 *
 * 7:30 dinner. Champagne. Strawberries. None of those facts is interesting and
 * none of them proves anything. Put them next to each other and a question
 * writes itself: business dinner?
 *
 * Everything else in the question layer is event-centric: it looks at ONE row's
 * SignalVector and asks whether that row, alone, exposes a gap. That is the
 * wrong shape for Insider. The most interesting things in the room are almost
 * never inside one receipt — they are the relationship BETWEEN receipts:
 *
 *   the same person across several questions,
 *   a side that was empty an hour ago and now has three people in it,
 *   a creator and the speed of the answer,
 *   money arriving while the price does nothing,
 *   several of the reader's own people landing on the same side.
 *
 * So this module runs over the FINAL surviving rows and groups them into clue
 * candidates. A group may earn a question even when every constituent row is a
 * plain receipt that would never qualify on its own. It attaches the question to
 * the group's anchor row (the newest one the reader will see).
 *
 * RULES, same as the rest of the layer:
 *   - only facts already printed in the feed may be used;
 *   - the question names the candidate readings and asserts neither;
 *   - no hidden knowledge, no causation, no prediction, no advice;
 *   - deterministic: variants are hashed off stable ids, never random.
 *
 * ZERO IO. Pure and fully testable.
 */
import { pickVariant } from "./pi-voice";
import type { QuestionKind } from "./pi-question";

/**
 * The summed capital that makes "moving around" worth a headline. Below it the
 * behaviour is true and small, and stays a receipt.
 */
export const MATERIAL_REPOSITION_USD = 25;

export interface ClueRow {
  id: string;
  marketId: string;
  marketTitle?: string | null;
  /** Lowercased actor, when the row is about one person. */
  wallet?: string | null;
  name?: string | null;
  /** The viewer's tag for this actor ("tribe", "rival", …), when signed in. */
  relationship?: string | null;
  side?: "YES" | "NO" | null;
  /** enter | add | reduce | exit | flip | created | … */
  action?: string | null;
  /**
   * False for a row the reader will NOT see — a receipt already absorbed into a
   * promoted behavioural story. Such rows are still EVIDENCE (they are why the
   * behaviour is a fact), so they count towards a clue; they simply cannot be
   * the row a question hangs on.
   */
  surviving?: boolean;
  amountUsd?: number | null;
  /** The row family — "market_created" anchors the creator→reaction clue. */
  kind?: string | null;
  occurredAt: string;
}

export interface ComposedClue {
  /** The surviving row the question hangs on. */
  rowId: string;
  kind: QuestionKind;
  text: string;
  /** Ranking weight, comparable with a SignalVector's informationGain. */
  gain: number;
  /** The rows this clue is made of — diagnostics, and the echo check. */
  members: string[];
  /** Plain-language reason, for the corpus diagnostic. */
  why: string;
  /**
   * THE COMPOSITION SHOULD OWN THE ROW IT ASKS ABOUT.
   *
   * A question about four moves bolted onto a receipt that establishes one of
   * them is a mismatch the reader can see: "NO had no one. Then Md.Sabbir
   * stepped in. … 4 changes in a few hours. Backing away, or moving conviction
   * somewhere else?" The body proves the wrong thing. Where the clue is about a
   * PERSON — the only family where the composition is a behaviour rather than a
   * coincidence of timing — it carries the headline and body the row should be
   * wearing, and the caller promotes it and consumes the ordinary receipts
   * underneath. Null where the receipt is still the better subject.
   */
  lead?: { headline: string; body: string } | null;
}

const HOUR = 3600_000;
const ms = (iso: string) => Date.parse(iso) || 0;
const money = (n: number) => (n >= 1000 ? `$${Math.round(n / 100) / 10}k` : `$${Math.round(n)}`);
const REDUCING = new Set(["exit", "reduce", "sell"]);
const ADDING = new Set(["enter", "add", "buy"]);

/** The subject of a question, short enough to sit inside a sentence. */
const LEAD_IN = /^(will|would|does|do|did|is|are|can|could|should|has|have|the|a|an)\s+/i;
export function subject(title: string | null | undefined): string | null {
  let t = (title ?? "").trim().replace(/[?.!]+$/, "");
  if (!t) return null;
  for (let i = 0; i < 3; i++) t = t.replace(LEAD_IN, "").trim();
  const w = t.split(/\s+/).filter(Boolean);
  if (w.length === 0) return null;
  const proper = (x?: string) => !!x && /^[A-Z0-9]/.test(x);
  return proper(w[0]) && proper(w[1]) ? `${w[0]} ${w[1]}` : w[0]!;
}

const byTime = (a: ClueRow, b: ClueRow) => ms(a.occurredAt) - ms(b.occurredAt);
const lives = (r: ClueRow) => r.surviving !== false;
/** The newest row the reader can actually see, or null when none survives. */
const anchorOf = (rows: ClueRow[]): ClueRow | null =>
  [...rows].filter(lives).sort(byTime).at(-1) ?? null;

function group<T>(rows: T[], key: (r: T) => string | null | undefined): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    if (!k) continue;
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  return out;
}

/**
 * Every clue the current window supports, strongest first. At most one per
 * anchor row; the caller rations further.
 */
export function composeClues(rows: ClueRow[]): ComposedClue[] {
  const out: ComposedClue[] = [];
  out.push(...personClues(rows));
  out.push(...marketClues(rows));
  out.push(...networkClues(rows));

  // One clue per anchor row, strongest first, then deterministic by id.
  const seen = new Set<string>();
  return out
    .sort((a, b) => b.gain - a.gain || a.rowId.localeCompare(b.rowId))
    .filter((c) => (seen.has(c.rowId) ? false : (seen.add(c.rowId), true)));
}

// ── PERSON: several actions by one person become one behaviour ───────────────

/** The latest receipt, as one clause of evidence under a behavioural headline. */
function latestLine(anchor: ClueRow): string | null {
  const where = subject(anchor.marketTitle);
  const a = anchor.action ?? "";
  const s = anchor.side ?? null;
  const verb = REDUCING.has(a)
    ? s
      ? `out of ${s}`
      : "out"
    : a === "flip"
      ? s
        ? `over to ${s}`
        : "over"
      : s
        ? `into ${s}`
        : "in";
  return where ? `Latest: ${verb} on ${where}.` : null;
}

function personClues(rows: ClueRow[]): ComposedClue[] {
  const out: ComposedClue[] = [];
  for (const [wallet, all] of group(rows, (r) => r.wallet?.toLowerCase())) {
    const acts = all.filter((r) => r.action);
    if (acts.length < 2) continue;
    const anchor = anchorOf(acts);
    if (!anchor) continue;
    const members = acts.map((r) => r.id);
    const who = anchor.name?.trim() || "they";
    const named = (anchor.name ?? acts.find((r) => r.name)?.name ?? "").trim();
    const NAME = named.toUpperCase();
    const markets = new Set(acts.map((r) => r.marketId));
    const cut = acts.filter((r) => REDUCING.has(r.action!));
    const put = acts.filter((r) => ADDING.has(r.action!));
    const flips = acts.filter((r) => r.action === "flip");
    const key = `${wallet}:${anchor.id}`;
    const evidence = latestLine(anchor);

    /* A CLEAN SWAP IS A ROTATION, NOT A REPOSITIONING. One sale here, one
       purchase there, and we can name both questions — which is a better line
       than a count of "changes". Anything busier than that is repositioning. */
    const cleanSwap = acts.length === 2 && cut.length === 1 && put.length === 1 && markets.size > 1;

    /* MATERIALITY DECIDES WHO GETS THE HEADLINE.
       Three $0.90 moves genuinely prove "moving around", and saying it at full
       volume is still wrong: the loudest line in the feed would be spent on
       $2.70. The behaviour stays a quiet receipt (lead: null) unless the
       repositioning is PROVEN meaningful — a side flip, real summed capital, or
       the same directional behaviour repeated across questions. */
    const summedUsd = acts.reduce((t, r) => t + Math.abs(Number(r.amountUsd ?? 0)), 0);
    const directional =
      markets.size >= 3 ||
      (cut.length >= 2 && put.length === 0) ||
      (put.length >= 2 && cut.length === 0);
    const meaningful = flips.length > 0 || summedUsd >= MATERIAL_REPOSITION_USD || directional;

    // REPOSITIONING — money leaving one belief while joining another, or a
    // string of changes too varied to call a retreat.
    if (
      !cleanSwap &&
      ((cut.length > 0 && (put.length > 0 || flips.length > 0)) || acts.length >= 3)
    ) {
      const n = acts.length;
      const spread = markets.size > 1;
      const retreat = put.length + flips.length === 0;
      /* THE LEAD OWNS THE COUNT; THE QUESTION MUST NOT REPEAT IT. When a named
         lead is present the body already says "N positions changed across M
         questions in the last few hours" — so a question that opens "N changes
         in a few hours" is the same count twice in one row. With a lead, the
         question drops to the ask alone; without one (attached to a receipt),
         it keeps the self-contained form because nothing else states the count. */
      const canLead = !!named && meaningful;
      const repoText = canLead
        ? retreat
          ? pickVariant(`${key}:retreatq`, [
              `Backing away, or making room for something else?`,
              `Losing conviction, or just lightening up?`,
            ])
          : pickVariant(`${key}:repositionq`, [
              `Backing away, or moving conviction somewhere else?`,
              `Changing the read, or just moving capital?`,
            ])
        : retreat
          ? pickVariant(`${key}:retreat`, [
              /* POSITIONS ARE QUESTIONS, NOT TRANSACTIONS. Four sells across two
                 markets is two positions cut; saying "4 positions" next to a
                 body that says "two" is the kind of small contradiction that
                 costs the whole feed its credibility. */
              `${markets.size} position${markets.size === 1 ? "" : "s"} cut in a few hours. Backing away, or making room for something else?`,
              `${n} changes, all in one direction. Losing conviction, or just lightening up?`,
            ])
          : pickVariant(`${key}:reposition`, [
              `${n} changes in a few hours. Backing away, or moving conviction somewhere else?`,
              `Out of one, into another. Changing the read, or just moving capital?`,
            ]);
      out.push({
        rowId: anchor.id,
        kind: "person_repositioning",
        gain: 0.42 + Math.min(0.06, 0.015 * n) + (spread ? 0.03 : 0),
        members,
        why: `${n} actions by one person across ${markets.size} question(s)`,
        text: repoText,
        /* THE BEHAVIOUR IS THE STORY; THE RECEIPT IS THE EVIDENCE. */
        lead: canLead
          ? {
              headline: `${NAME} is moving around`,
              body: [
                `${markets.size > 1 ? `${n} positions changed across ${markets.size} questions` : `${n} changes on one question`} in the last few hours.`,
                evidence,
              ]
                .filter(Boolean)
                .join(" "),
            }
          : null,
      });

      continue;
    }

    // ROTATION — an exit here, an entry there.
    if (cut.length > 0 && put.length > 0 && markets.size > 1) {
      const from = subject(cut[0]!.marketTitle);
      const into = subject(put[0]!.marketTitle);
      const swap = !!(from && into && from !== into);
      /* WHEN THE LEAD CARRIES THE MOVE, THE QUESTION MUST NOT REPEAT IT. With a
         named lead the row already says "Out of X. Into Y."; a question that
         opens "Out of X, into Y" again is the same clause twice in one row. So
         the question drops to the ask alone here — and is varied, so several
         rotations in one window don't all ask in unison. Only the
         receipt-attached form (no lead) still spells the move out, because
         nothing else in that row does. */
      const canLead = !!named && swap;
      out.push({
        rowId: anchor.id,
        kind: "person_rotation",
        gain: 0.44,
        members,
        why: "one person left one question and backed another",
        text: canLead
          ? pickVariant(`${key}:rotq`, [
              `A new read, or the same money looking for a home?`,
              `Changing the thesis, or just chasing a warmer spot?`,
              `New conviction, or the same capital hunting a home?`,
            ])
          : swap
            ? `Out of ${from}, into ${into}. A new read, or the same money looking for a home?`
            : `${who} sold one belief and bought another. New read, or same money, new home?`,
        lead: canLead
          ? {
              headline: `${NAME} moved their conviction`,
              body: `Out of ${from}. Into ${into}.`,
            }
          : null,
      });
      continue;
    }

    // SAME SIDE, SEVERAL QUESTIONS — only when it is provably repeated.
    const sides = new Set(acts.filter((r) => r.side).map((r) => r.side));
    if (markets.size >= 2 && sides.size === 1 && put.length >= 2) {
      const side = [...sides][0];
      out.push({
        rowId: anchor.id,
        kind: "person_same_side",
        gain: 0.38,
        members,
        why: `${markets.size} questions backed, all ${side}`,
        text: pickVariant(`${key}:sameside`, [
          `Same side on ${markets.size} questions today. Building conviction, or just adding exposure?`,
          `Everything they touched today is ${side}. One thesis, or one habit?`,
        ]),
        lead: named
          ? {
              headline: `${NAME} keeps leaning ${side}`,
              body: `${markets.size} questions today, every one of them ${side}.`,
            }
          : null,
      });

      continue;
    }

    // IN AND OUT — entered and left the same question inside the window.
    const perMarket = group(acts, (r) => r.marketId);
    for (const [, list] of perMarket) {
      if (list.length < 2) continue;
      const inRow = list.find((r) => ADDING.has(r.action!));
      const outRow = list.find((r) => REDUCING.has(r.action!));
      const inOutAnchor = anchorOf(list);
      if (!inOutAnchor || !inRow || !outRow || ms(outRow.occurredAt) <= ms(inRow.occurredAt))
        continue;
      const hours = Math.max(1, Math.round((ms(outRow.occurredAt) - ms(inRow.occurredAt)) / HOUR));
      out.push({
        rowId: inOutAnchor.id,
        kind: "in_and_out",
        gain: 0.36,
        members: list.map((r) => r.id),
        why: `same person in and out of one question within ${hours}h`,
        text: `In and out of the same question within ${hours} hour${hours === 1 ? "" : "s"}. Testing it, or changing their mind?`,
      });
    }
  }
  return out;
}

// ── MARKET: several events on one question become one shape ──────────────────

function marketClues(rows: ClueRow[]): ComposedClue[] {
  const out: ComposedClue[] = [];
  for (const [, all] of group(rows, (r) => r.marketId)) {
    if (all.length < 2) continue;
    const entries = all.filter((r) => r.action && ADDING.has(r.action) && r.wallet);
    const wallets = new Set(entries.map((r) => r.wallet!.toLowerCase()));

    // CREATOR → FAST ANSWER. Only when the creation itself is in this window,
    // so "quickly" is measured against a fact the reader can see.
    const created = all.find((r) => r.kind === "market_created");
    if (created && wallets.size >= 2) {
      const first = [...entries].sort(byTime)[0]!;
      const gapH = (ms(first.occurredAt) - ms(created.occurredAt)) / HOUR;
      const pickupAnchor = anchorOf(entries);
      if (pickupAnchor && gapH >= 0 && gapH <= 2) {
        out.push({
          rowId: pickupAnchor.id,
          kind: "creator_pickup",
          gain: 0.46,
          members: [created.id, ...entries.map((r) => r.id)],
          why: `opened, then ${wallets.size} people answered within ${Math.max(1, Math.round(gapH * 60))} min`,
          text: `Opened, and answered by ${wallets.size} people almost immediately. What made this one easy to call?`,
        });
        continue;
      }
    }

    // A SIDE THAT FILLED UP AT ONCE.
    for (const side of ["YES", "NO"] as const) {
      const onSide = entries.filter((r) => r.side === side);
      const people = new Set(onSide.map((r) => r.wallet!.toLowerCase()));
      if (people.size < 3) continue;
      const times = onSide.map((r) => ms(r.occurredAt)).sort((a, b) => a - b);
      const spanH = (times.at(-1)! - times[0]!) / HOUR;
      const onSideAnchor = anchorOf(onSide);
      if (spanH > 2 || !onSideAnchor) continue;
      out.push({
        rowId: onSideAnchor.id,
        kind: "side_burst",
        gain: 0.43,
        members: onSide.map((r) => r.id),
        why: `${people.size} people took ${side} within ${Math.max(1, Math.round(spanH * 60))} min`,
        text: `${people.size} people took ${side} inside an hour. One burst, or the start of a crowd?`,
      });
    }

    // MONEY ARRIVED, BUT MOSTLY FROM ONE HAND.
    const sized = entries.filter((r) => (r.amountUsd ?? 0) > 0);
    if (sized.length >= 3 && wallets.size >= 3) {
      const total = sized.reduce((s, r) => s + (r.amountUsd ?? 0), 0);
      const perWallet = new Map<string, number>();
      for (const r of sized)
        perWallet.set(
          r.wallet!.toLowerCase(),
          (perWallet.get(r.wallet!.toLowerCase()) ?? 0) + (r.amountUsd ?? 0),
        );
      const top = Math.max(...perWallet.values());
      const sizedAnchor = anchorOf(sized);
      if (sizedAnchor && total >= 100 && top / total >= 0.6) {
        out.push({
          rowId: sizedAnchor.id,
          kind: "capital_concentrated_arrival",
          gain: 0.4,
          members: sized.map((r) => r.id),
          why: `${wallets.size} wallets, ${money(total)}, ${Math.round((top / total) * 100)}% from one`,
          text: `${wallets.size} wallets, ${money(total)}. Is the weight spread out, or mostly one person?`,
        });
      }
    }
  }
  return out;
}

// ── NETWORK: the reader's own people, moving together ────────────────────────

function networkClues(rows: ClueRow[]): ComposedClue[] {
  const out: ComposedClue[] = [];
  for (const [, all] of group(rows, (r) => r.marketId)) {
    const known = all.filter(
      (r) => r.relationship && r.relationship !== "neutral" && r.side && r.wallet,
    );
    const people = new Set(known.map((r) => r.wallet!.toLowerCase()));
    if (people.size < 2) continue;
    const sides = new Set(known.map((r) => r.side));
    const anchor = anchorOf(known);
    if (!anchor) continue;
    out.push(
      sides.size === 1
        ? {
            rowId: anchor.id,
            kind: "network_convergence",
            gain: 0.5,
            members: known.map((r) => r.id),
            why: `${people.size} of the reader's people took ${[...sides][0]} here`,
            text: `${people.size} of your people landed on the same side here. One conversation, or two independent reads?`,
          }
        : {
            rowId: anchor.id,
            kind: "network_split",
            gain: 0.52,
            members: known.map((r) => r.id),
            why: "the reader's people are on opposite sides of one question",
            text: `Your people are split on this one. Worth seeing what each of them saw?`,
          },
    );
  }
  return out;
}
