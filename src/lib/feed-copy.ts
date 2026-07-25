/**
 * conviction.company — Feed Copy Engine.
 *
 * The layer between a data row and the card. It turns ONE signal into ONE small
 * story: a hook, the belief, a story, and — only when tension is real — a turn.
 * It changes no data and no ranking; it only decides how a card *reads*.
 *
 * Every line obeys two bars (the "say-it-out-loud-and-true" test):
 *   1. would a human say this to a friend, and
 *   2. is it provably true from the data?
 * So: suspense from unresolved FACTS, never adjectives ("and climbing" needs
 * measured acceleration; say "backed", never "know about"); the split shows only
 * at MATERIAL divergence; and the five wealth states are never conflated —
 * appreciation/realized copy is gated behind verified cost basis, so until then
 * we tell only capital-flow (committed/withdrawn) stories.
 *
 * ZERO IO. Pure and fully unit-tested.
 */
import { fmtUsd, type Side } from "./conviction-feed";

// Money and people must disagree by at least this many points to be a "turn".
// A 5–1 split is agreement, not tension. Config, not a literal.
export const MATERIAL_DIVERGENCE_PTS = 15;
// Below this, a dollar figure is a footnote, not a hook — lead with the human.
export const MATERIAL_WEALTH_USD = 1000;

export type CopyBehavior =
  | "born" // a creator planted a belief
  | "joined" // a new position on a side
  | "increase" // added to an existing position
  | "reduce" // pulling capital back out (flow, not loss)
  | "flow" // network/crowd capital flow, aggregate
  | "unattributed"; // a move with nobody you know inside it

export type ActionKind = "back_sides" | "open" | "review" | "convictions";

/**
 * Distinct visual story forms, so the timeline changes shape instead of stacking
 * identical cards. Each renders differently; the sequencer (feed-sequence.ts)
 * uses these + intensity to pace the feed like film editing.
 */
export type CardFormat =
  | "birth" // a belief is planted — big question, minimal copy
  | "character" // a recognizable person moved — lead with them
  | "crowd" // faces dominate — a group arriving or splitting
  | "scoreboard" // a meaningful market move — big number
  | "tension" // split-screen money vs people
  | "rare" // your echo and your opposite agree — used sparingly
  | "quiet"; // a breather — persistence, low activity

// A move must swing at least this much to earn a scoreboard.
export const SCOREBOARD_MOVE_PCT = 20;

export interface CopyInput {
  behavior: CopyBehavior;
  actorName: string | null; // already resolved to a clean name, or null at network scale
  actorScale: "individual" | "group" | "market";
  actorRole: "people" | "opp" | "creator" | "tribe" | "rivals" | "market" | null;
  belief: string; // the market question
  side: Side | null; // the side the story is about
  capitalCommitted: number | null; // USD in (flow — always honest)
  capitalWithdrawn: number | null; // USD out (flow — NOT profit)
  backersTotal: number; // people who have backed this market
  believersYes: number | null;
  believersNo: number | null;
  priceFell: boolean; // did the price fall before this act? (for "added after it fell")
  priceChgPct: number | null; // the market's headline move, for the scoreboard
  moneyYesPct: number | null; // money-weighted YES%
  peopleYesPct: number | null; // head-count YES%
  yesCapitalUsd: number | null; // capital backing YES (per-side market cap)
  noCapitalUsd: number | null; // capital backing NO
  convergence: boolean; // People AND Opp landed on the same side (rare)
  variantSeed: number; // stable per-market seed so wording varies but never flickers
  isViewerHolding: boolean; // the viewer owns this position → Review
}

export interface CardCopy {
  hook: string;
  belief: string;
  story: string;
  turn: string | null;
  action: { kind: ActionKind; label: string };
  format: CardFormat; // which visual shape to render
  intensity: number; // 0 (quiet breather) .. 2 (high drama) — drives pacing
  timeLabel: string; // names the event behind the timestamp ("Created", "Backed", …)
  shape: string | null; // broad-vs-concentrated conviction sentence, when there's a story
}

/**
 * Resolve any raw identity to clean prose: strip "(on farcaster)"-style suffixes
 * and never surface a bare 0x… address as a name.
 */
export function cleanName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const n = raw
    .trim()
    .replace(/\s*\((?:on\s+)?[^)]*\)\s*$/i, "")
    .trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(n)) return null;
  return n.length > 0 ? n : null;
}

export function isMaterialDivergence(moneyYes: number | null, peopleYes: number | null): boolean {
  return (
    moneyYes != null &&
    peopleYes != null &&
    Math.abs(moneyYes - peopleYes) >= MATERIAL_DIVERGENCE_PTS
  );
}

/** The one place the split earns its keep — phrased as tension, never a stat block. */
function divergenceTurn(moneyYes: number, peopleYes: number): string {
  const py = Math.round(peopleYes);
  const pn = 100 - py;
  return `The money's ${Math.round(moneyYes)}% YES. The people are split ${py}–${pn}.`;
}

// Broad-vs-concentrated thresholds: one side needs clearly more believers while
// capital stays near-even for "many believers vs a few whales" to be a real story.
export const BROAD_BELIEVER_RATIO = 2; // ≥2× the believers on one side
export const NEAR_EQUAL_CAPITAL_RATIO = 1.4; // capital within ~40%

/**
 * The story only this app can tell: do PEOPLE (believer count) and CAPITAL
 * (money backing) agree? When one side has far more believers but the capital is
 * near-even, conviction is broad on one side and concentrated (whales) on the
 * other. Returns null when they agree — agreement is not a story.
 */
export function convictionShape(i: {
  believersYes: number | null;
  believersNo: number | null;
  yesCapitalUsd: number | null;
  noCapitalUsd: number | null;
}): string | null {
  const { believersYes: by, believersNo: bn, yesCapitalUsd: cy, noCapitalUsd: cn } = i;
  if (by == null || bn == null || by + bn < 3) return null; // too few to characterize
  if (cy == null || cn == null || cy + cn <= 0) return null;
  const yesLeadsBelievers = by >= bn;
  const bMore = Math.max(by, bn);
  const bLess = Math.min(by, bn);
  if (bLess === 0) return null;
  const believerRatio = bMore / bLess;
  const capRatio = Math.min(cy, cn) > 0 ? Math.max(cy, cn) / Math.min(cy, cn) : Infinity;
  if (believerRatio < BROAD_BELIEVER_RATIO || capRatio > NEAR_EQUAL_CAPITAL_RATIO) return null;
  const broad = yesLeadsBelievers ? "YES" : "NO";
  const concentrated = yesLeadsBelievers ? "NO" : "YES";
  const x = believerRatio >= 10 ? `${Math.round(believerRatio)}×` : `${believerRatio.toFixed(1)}×`;
  return `${broad} has ${x} more believers but nearly equal capital — conviction is broad on ${broad}, concentrated on ${concentrated}.`;
}

/** The natural visual shape for a signal, before the sequencer varies the order. */
function pickFormat(i: CopyInput, hasTension: boolean): { format: CardFormat; intensity: number } {
  const bigMove = i.priceChgPct != null && Math.abs(i.priceChgPct) >= SCOREBOARD_MOVE_PCT;
  if (i.convergence) return { format: "rare", intensity: 2 }; // rarest: both poles agree
  if (hasTension) return { format: "tension", intensity: 2 };
  switch (i.behavior) {
    case "born":
      return { format: "birth", intensity: 1 };
    case "reduce":
      return { format: "character", intensity: 2 }; // backing away is a turn
    case "joined":
    case "increase":
      if (i.actorRole === "people" || i.actorRole === "opp")
        return { format: "character", intensity: i.actorRole === "opp" ? 2 : 1 };
      return bigMove ? { format: "scoreboard", intensity: 1 } : { format: "crowd", intensity: 1 };
    case "flow":
      if (bigMove) return { format: "scoreboard", intensity: 1 };
      return i.backersTotal >= 3
        ? { format: "crowd", intensity: 1 }
        : { format: "quiet", intensity: 0 };
    default:
      return bigMove ? { format: "scoreboard", intensity: 1 } : { format: "quiet", intensity: 0 };
  }
}

const ACTION_LABEL: Record<ActionKind, string> = {
  back_sides: "Back a side",
  open: "Open Market",
  review: "Review Position",
  convictions: "See Their Convictions",
};

// A timestamp must always name its event — never a bare "4h ago".
const TIME_LABEL: Record<CopyBehavior, string> = {
  born: "Created",
  joined: "Backed",
  increase: "Added",
  reduce: "Reduced",
  flow: "Last traded",
  unattributed: "Last moved",
};

/** Deterministic pick — same market always reads the same, but neighbors differ. */
function variant<T>(options: T[], seed: number): T {
  return options[((seed % options.length) + options.length) % options.length];
}

export function composeCard(i: CopyInput): CardCopy {
  const name = cleanName(i.actorName);
  const side = i.side;
  const committed = i.capitalCommitted;
  const withdrawn = i.capitalWithdrawn;
  const bigCommit = committed != null && committed >= MATERIAL_WEALTH_USD;
  const divergent = isMaterialDivergence(i.moneyYesPct, i.peopleYesPct);
  const turn = divergent ? divergenceTurn(i.moneyYesPct!, i.peopleYesPct!) : null;

  let hook = "";
  let story = "";
  let action: ActionKind = "open";

  switch (i.behavior) {
    case "born": {
      hook = name
        ? variant(
            [
              `${name} planted a new belief.`,
              `${name} put a new question on the table.`,
              `A new belief, from ${name}.`,
            ],
            i.variantSeed,
          )
        : variant(
            [
              `A new belief just appeared.`,
              `A new question just went up.`,
              `Someone planted a new belief.`,
            ],
            i.variantSeed,
          );
      const split =
        i.believersYes != null && i.believersNo != null && i.believersYes + i.believersNo > 0
          ? ` — ${i.believersYes} yes, ${i.believersNo} no`
          : "";
      const who =
        i.backersTotal === 1
          ? `1 person has backed it so far`
          : `${i.backersTotal} people have backed it so far`;
      story = `${who}${split}.`;
      action = "open";
      break;
    }
    case "joined": {
      hook = name
        ? bigCommit
          ? `${name} just put ${fmtUsd(committed!)} behind ${side}.`
          : variant(
              [
                `${name} just backed ${side}.`,
                `${name} took the ${side} side.`,
                `${name} put their weight behind ${side}.`,
              ],
              i.variantSeed,
            )
        : bigCommit
          ? `${fmtUsd(committed!)} just went into ${side}.`
          : `Someone new backed ${side}.`;
      story =
        i.backersTotal > 1
          ? `${i.backersTotal} people are behind this now.`
          : `They're the first one in.`;
      action = divergent ? "back_sides" : "open";
      break;
    }
    case "increase": {
      hook = name ? `${name} doubled down on ${side}.` : `More conviction piled into ${side}.`;
      const added = bigCommit ? `added ${fmtUsd(committed!)} more` : `added more`;
      story = i.priceFell
        ? `They ${added} after the price fell — not hedging, conviction.`
        : `They ${added} to ${side}.`;
      action = divergent ? "back_sides" : "open";
      break;
    }
    case "reduce": {
      // Flow language only — pulling capital out is NOT a realized loss.
      hook = name ? `${name} is backing away.` : `Money is leaving ${side}.`;
      story =
        withdrawn != null && withdrawn >= MATERIAL_WEALTH_USD
          ? `Pulled ${fmtUsd(withdrawn)} out of it.`
          : `They cut their position.`;
      // The story is about who this person is, not this one market.
      action = i.actorRole === "people" || i.actorRole === "opp" ? "convictions" : "open";
      break;
    }
    case "flow": {
      const inflow = committed != null && (withdrawn == null || committed >= withdrawn);
      const amount = inflow ? committed : withdrawn;
      const big = amount != null && amount >= MATERIAL_WEALTH_USD;
      // Dynamic hook: lead with money only when it's genuinely big; else the crowd.
      hook = big
        ? `${fmtUsd(amount!)} ${inflow ? "moved into" : "left"} ${side}.`
        : i.backersTotal > 0
          ? `${i.backersTotal} ${i.backersTotal === 1 ? "person" : "people"} just backed ${side}.`
          : `Money is moving on ${side}.`;
      story = big
        ? i.backersTotal > 0
          ? `${i.backersTotal} ${i.backersTotal === 1 ? "person" : "people"} ${inflow ? "took" : "cut"} that side.`
          : `The crowd is ${inflow ? "leaning in" : "stepping back"}.`
        : `Real money on the table, no clear favorite yet.`;
      action = divergent ? "back_sides" : "open";
      break;
    }
    case "unattributed":
    default: {
      hook = `Something's moving here.`;
      story =
        i.backersTotal > 0
          ? `${i.backersTotal} ${i.backersTotal === 1 ? "person has" : "people have"} taken a side — no one you follow yet.`
          : `A move with nobody you follow inside it — yet.`;
      action = "open";
      break;
    }
  }

  // The rarest signal in the system: your echo and your opposite on one side.
  if (i.convergence) {
    hook = `Your People and your Opp both backed ${side}.`;
    story = `They almost never agree.`;
    action = "back_sides";
  }

  if (i.isViewerHolding) action = "review";

  const shape = convictionShape(i);
  const { format, intensity } = pickFormat(i, turn != null || shape != null);
  return {
    hook,
    belief: i.belief,
    story,
    turn,
    action: { kind: action, label: ACTION_LABEL[action] },
    format,
    intensity,
    timeLabel: TIME_LABEL[i.behavior],
    shape,
  };
}
