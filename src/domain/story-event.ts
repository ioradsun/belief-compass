/**
 * STORY ENGINE — the one interpreter of what a market's numbers MEAN.
 *
 * Everything interesting that happens to a market becomes a Story Event here.
 * Not a trade engine, a conviction engine and a transition engine — three
 * systems that would drift apart within a release. One engine, one vocabulary,
 * one set of disciplines, and a growing list of things it knows how to notice.
 *
 * The side feed reports the FACTS of one side ("4 believers joined YES"). This
 * reads YES and NO together and names the single most informative thing a
 * neutral observer would say about the whole market:
 *
 *   STRUCTURAL  NO overtook YES · the market is evenly split
 *   COMMUNITY   YES believers doubled · YES passed 100 believers
 *   MOMENTUM    YES is accelerating · participation is broadening
 *   TENSION     more believers, less capital · price moved, conviction did not
 *   SOCIAL      a Tribe is forming around YES
 *   DECLINE     NO is losing believers
 *
 * Adding a new kind of story is adding one STORYTELLER to the list at the
 * bottom — a pure function that either sees its state or returns null. It
 * inherits the whole apparatus for free:
 *
 *   • PRIORITY — the list is strict priority order. A contradiction carries more
 *     information than a plain gain, so it is named first, and exactly one story
 *     is emitted per read. The market never says two things at once.
 *   • HYSTERESIS — a state has a strong ENTER bar and a looser EXIT bar (via the
 *     caller-supplied `prev`), so a reading doesn't flap on every trade.
 *   • FINGERPRINT — a stable id (type + side) so callers dedupe and never repeat
 *     the same insight (see src/domain/transition-emit).
 *   • NO NEW THRESHOLDS — it reuses the feed's own triggers (capitalTrigger,
 *     FEED_TRIGGERS) and the metric-display rules.
 *
 * Claims that need a baseline ("4× normal") are only made when a trustworthy
 * baseline is supplied. Never faked.
 *
 * ZERO IO, pure, fully testable.
 */
import { capitalTrigger, FEED_TRIGGERS } from "./feed-event";
import { formatPct } from "./metric-display";
import { MATERIAL, type MaterialMove } from "./market-change";

export type Side = "YES" | "NO";

export type StoryEventType =
  // STRUCTURAL — the market's own answer changed.
  | "majority_flipped"
  | "market_balanced"
  // COMMUNITY — the crowd itself changed shape.
  | "side_doubled"
  | "believer_milestone"
  | "market_dividing"
  // TENSION — two signals disagree, which is always worth saying.
  | "people_capital_divergence"
  | "concentration_rising"
  | "price_conviction_divergence"
  // MOMENTUM
  | "accelerating"
  | "participation_broadening"
  // MATERIAL — a move big enough that saying nothing would be the error.
  | "material_move"
  // CELEBRATION — the community growing, said as the good news it is.
  | "capital_milestone"
  | "market_reawakened"
  // SOCIAL
  | "tribe_forming"
  // DECLINE
  | "losing_conviction";

/** One side's already-computed window, normalized. Money is USD. */
export interface SideWindow {
  believerDelta: number;
  believerBase: number;
  capitalDeltaUsd: number;
  capitalBaseUsd: number;
  pricePct?: number | null;
  /** Recent capital inflow (USD) for the acceleration check vs baseline. */
  recentCapitalUsd?: number | null;
}

/**
 * Trade counts over the standard windows, as market_state already stores them.
 *
 * Cumulative: `trades7d` includes `trades24h`. When the two are EQUAL and there
 * were trades today, every trade of the week happened in the last day — the
 * market was silent for six days and has just woken. That is an exact reading of
 * fields we already keep, with no new history to store.
 */
export interface MarketActivity {
  trades24h: number;
  trades7d: number;
}

export interface MarketBaseline {
  /**
   * The ranker's acceleration multiple (recent trade rate ÷ normal 24h rate),
   * from accelerationFrom — the canonical, server-computed baseline. Preferred
   * over the raw capital fields below; when present it drives the acceleration
   * state directly (attributed to whichever side is drawing capital now).
   */
  accelerationMultiple?: number | null;
  /** The market's normal capital velocity (USD over the same recent window). */
  normalCapitalUsd?: number | null;
}

export interface MarketSocial {
  tribeJoinedYes: number;
  tribeJoinedNo: number;
}

export interface StoryEventInput {
  /** Short label of the active timeframe, for copy ("1D", "1H"). */
  timeframeShort: string;
  yes: SideWindow;
  no: SideWindow;
  baseline?: MarketBaseline | null;
  /** Trade counts, for the reawakening read. Absent → no such claim is made. */
  activity?: MarketActivity | null;
  social?: MarketSocial | null;
  /**
   * Moves that cleared the product's materiality bar, heaviest first, already
   * computed and ranked by src/domain/market-change.
   *
   * This is a FLOOR, not a lead. The storytellers above it describe moves that
   * have a shape — an answer flipping, people arriving while money leaves — and
   * every one of those is also a large move, so putting this first would replace
   * meaning with a percentage. Its job is that a five-percent move can never
   * pass unreported: before it existed, a market whose YES capital rose 12% with
   * no other structure emitted NOTHING, because no storyteller was looking for
   * a plain gain.
   */
  material?: MaterialMove[] | null;
  /** The previously-emitted transition, for hysteresis. */
  prev?: { type: StoryEventType; side?: Side } | null;
  /** USD → the viewer's display unit, for evidence/detail. Optional. */
  money?: (usd: number) => string;
}

export interface MetricEvidence {
  label: string;
  value: string;
}

export interface StoryEvent {
  type: StoryEventType;
  side?: Side;
  tier: 1 | 2 | 3;
  headline: string;
  detail?: string;
  evidence: MetricEvidence[];
  /** Stable id of the state (type + side) — for dedup and anti-spam. */
  fingerprint: string;
}

const TIER: Record<StoryEventType, 1 | 2 | 3> = {
  majority_flipped: 1,
  side_doubled: 1,
  believer_milestone: 2,
  market_balanced: 2,
  market_dividing: 1,
  people_capital_divergence: 1,
  tribe_forming: 1,
  concentration_rising: 2,
  price_conviction_divergence: 2,
  participation_broadening: 2,
  accelerating: 2,
  material_move: 1,
  capital_milestone: 1,
  market_reawakened: 2,
  losing_conviction: 3,
};

const plural = (n: number, one: string, many: string): string => (Math.abs(n) === 1 ? one : many);

/** Acceleration hysteresis: enter loud, stay until it clearly calms. */
const ACCEL_ENTER = FEED_TRIGGERS.capital.spikeMultiple; // 3×
const ACCEL_EXIT = 2; // 2×
/** A believer swing this size is "meaningful" (reuses the people trigger). */
const BEL = FEED_TRIGGERS.believers.minAbs;

/** Trades in a day before a silent market may be called awake again. */
const MIN_REAWAKEN_TRADES = 2;
/** A Tribe cluster this size on one side reads as a movement forming. */
const TRIBE_FORMING_MIN = 3;
/** Believer counts worth announcing when a side crosses them. */
export const BELIEVER_MILESTONES = [10, 50, 100, 500, 1_000, 5_000] as const;

/**
 * Committed capital worth announcing when a MARKET crosses it, in USD.
 *
 * The brief asked for $1,000 / $10,000 / $100,000. Measured across 1,000 live
 * markets, the largest holds $197 in total and only three are above $100 — so
 * those three rungs alone would have been a celebration that could never fire.
 * They are kept, as headroom this platform should grow into, and the ladder
 * starts where the community actually is: thirteen markets are already past $10
 * and four past $50, so the first crossings are days away rather than years.
 *
 * A market total, not a side: "this question has drawn $100" is the community
 * story. Which side holds it is a different sentence, and the rails tell it.
 */
export const CAPITAL_MILESTONES = [10, 50, 100, 500, 1_000, 10_000, 100_000] as const;

/** The largest rung strictly between a base and a current, or null. */
function crossed(rungs: readonly number[], base: number, current: number): number | null {
  if (!(current > base)) return null;
  let hit: number | null = null;
  for (const r of rungs) if (base < r && r <= current) hit = r;
  return hit;
}
/**
 * A market is "balanced" when neither side holds more than this share of
 * believers. Wide enough that one arrival can't toggle it on and off.
 */
const BALANCED_MAX_SHARE = 0.55;
/** Below this the sides are too small for "majority" to mean anything. */
const STRUCTURAL_MIN_BELIEVERS = 6;

const money = (fn: StoryEventInput["money"], usd: number): string =>
  fn ? fn(Math.abs(usd)) : `$${Math.abs(usd).toFixed(2)}`;

const fp = (type: StoryEventType, side?: Side): string => `${type}:${side ?? "market"}`;
const held = (prev: StoryEventInput["prev"], type: StoryEventType, side?: Side): boolean =>
  !!prev && prev.type === type && prev.side === side;

/** The side carrying the most capital action — for a deterministic tie-break. */
function dominantSide(input: StoryEventInput): Side {
  return Math.abs(input.no.capitalDeltaUsd) > Math.abs(input.yes.capitalDeltaUsd) ? "NO" : "YES";
}

/**
 * Interpret the snapshot into the single strongest current transition, or null
 * when nothing rises above noise. Deterministic: candidates are tried in strict
 * priority order and the first that clears its (hysteresis-aware) bar wins.
 */
export function emitStoryEvent(input: StoryEventInput): StoryEvent | null {
  const { yes, no, baseline, social, prev, money: fmt } = input;

  // Sides in a deterministic order — the one with the most capital action first.
  const sides: [Side, SideWindow][] =
    dominantSide(input) === "YES"
      ? [
          ["YES", yes],
          ["NO", no],
        ]
      : [
          ["NO", no],
          ["YES", yes],
        ];
  const firstOf = (fn: (side: Side, s: SideWindow) => StoryEvent | null) => {
    for (const [side, s] of sides) {
      const r = fn(side, s);
      if (r) return r;
    }
    return null;
  };

  // The capital SAFEGUARD: a move must clear BOTH an absolute floor AND a
  // market-relative bar (feed-event's own capitalTrigger), so −$1 in a tiny market
  // and −$500 of normal noise in a huge one never become a story. No new thresholds.
  const capitalMoved = (s: SideWindow): boolean =>
    capitalTrigger({ deltaUsd: s.capitalDeltaUsd, priorUsd: s.capitalBaseUsd });

  // Where each side stood before this window, and where it stands now. Both are
  // already in the snapshot — believerBase is the count at the window's open —
  // so structural and community stories need no new data, only the arithmetic.
  const yesNow = yes.believerBase + yes.believerDelta;
  const noNow = no.believerBase + no.believerDelta;
  const totalNow = yesNow + noNow;
  const bigEnough = totalNow >= STRUCTURAL_MIN_BELIEVERS;

  // 0 — MAJORITY FLIPPED. The market's own answer changed inside this window.
  // Nothing else it could say is bigger than this.
  const majorityFlipped = (): StoryEvent | null => {
    if (!bigEnough) return null;
    const wasYes = yes.believerBase > no.believerBase;
    const isYes = yesNow > noNow;
    if (wasYes === isYes) return null;
    if (yes.believerBase === no.believerBase || yesNow === noNow) return null;
    const side: Side = isYes ? "YES" : "NO";
    const from: Side = isYes ? "NO" : "YES";
    return {
      type: "majority_flipped",
      side,
      tier: TIER.majority_flipped,
      headline: `${side} overtook ${from}.`,
      detail: `${side} now has more believers than ${from} for the first time this ${input.timeframeShort}.`,
      evidence: [
        { label: "YES believers", value: `${yesNow}` },
        { label: "NO believers", value: `${noNow}` },
      ],
      fingerprint: fp("majority_flipped", side),
    };
  };

  // COMMUNITY — a side's crowd doubled inside the window.
  const sideDoubled = (side: Side, sw: SideWindow): StoryEvent | null => {
    const now = sw.believerBase + sw.believerDelta;
    const enter = sw.believerBase >= BEL && sw.believerDelta >= sw.believerBase;
    // Once said, it holds while the side is still at least half again as big.
    const hold =
      held(prev, "side_doubled", side) && now >= sw.believerBase * 1.5 && sw.believerDelta > 0;
    if (!enter && !hold) return null;
    return {
      type: "side_doubled",
      side,
      tier: TIER.side_doubled,
      headline: `Believers in ${side} doubled.`,
      detail: `${side} went from ${sw.believerBase} to ${now} believers this ${input.timeframeShort}.`,
      evidence: [{ label: "Believers", value: `${sw.believerBase} → ${now}` }],
      fingerprint: fp("side_doubled", side),
    };
  };

  // COMMUNITY — a side crossed a round number of believers inside the window.
  const milestone = (side: Side, sw: SideWindow): StoryEvent | null => {
    if (sw.believerDelta <= 0) return null;
    const now = sw.believerBase + sw.believerDelta;
    const crossed = [...BELIEVER_MILESTONES].reverse().find((m) => sw.believerBase < m && now >= m);
    if (crossed == null) return null;
    return {
      type: "believer_milestone",
      side,
      tier: TIER.believer_milestone,
      headline: `${side} passed ${crossed.toLocaleString("en-US")} believers.`,
      detail: `${now.toLocaleString("en-US")} people now back ${side}.`,
      evidence: [{ label: "Believers", value: now.toLocaleString("en-US") }],
      // The threshold is part of the identity: crossing 100 and later 500 are
      // two different stories, and neither should silence the other.
      fingerprint: `${fp("believer_milestone", side)}:${crossed}`,
    };
  };

  // STRUCTURAL — the market arrived at genuine disagreement.
  const balanced = (): StoryEvent | null => {
    if (!bigEnough || totalNow === 0) return null;
    const share = Math.max(yesNow, noNow) / totalNow;
    const wasTotal = yes.believerBase + no.believerBase;
    const wasShare = wasTotal > 0 ? Math.max(yes.believerBase, no.believerBase) / wasTotal : 1;
    // Only worth saying when it BECAME balanced; holding is looser so it doesn't flap.
    const bar = held(prev, "market_balanced") ? 0.6 : BALANCED_MAX_SHARE;
    if (!(share <= bar)) return null;
    if (!held(prev, "market_balanced") && wasShare <= BALANCED_MAX_SHARE) return null;
    return {
      type: "market_balanced",
      tier: TIER.market_balanced,
      headline: "The market is evenly split.",
      detail: `${yesNow} back YES, ${noNow} back NO.`,
      evidence: [
        { label: "YES believers", value: `${yesNow}` },
        { label: "NO believers", value: `${noNow}` },
      ],
      fingerprint: fp("market_balanced"),
    };
  };

  // 1 — PEOPLE / CAPITAL DIVERGENCE (the most information: people in, money out).
  const peopleCapital = (side: Side, s: SideWindow): StoryEvent | null => {
    const active = s.believerDelta >= BEL && s.capitalDeltaUsd < 0 && capitalMoved(s);
    const hold =
      held(prev, "people_capital_divergence", side) &&
      s.believerDelta > 0 &&
      s.capitalDeltaUsd < 0 &&
      capitalMoved(s);
    if (!active && !hold) return null;
    const left = money(fmt, s.capitalDeltaUsd);
    return {
      type: "people_capital_divergence",
      side,
      tier: TIER.people_capital_divergence,
      headline: "More believers. Less capital.",
      detail: `${s.believerDelta} ${plural(s.believerDelta, "person", "people")} joined while ${left} left the market.`,
      evidence: [
        { label: "Believers", value: `+${s.believerDelta}` },
        { label: "Capital", value: `−${left}` },
      ],
      fingerprint: fp("people_capital_divergence", side),
    };
  };

  // 2 — CAPITAL CONCENTRATION (money in, but no broader participation).
  const concentration = (side: Side, s: SideWindow): StoryEvent | null => {
    const active = s.capitalDeltaUsd > 0 && s.believerDelta <= 0 && capitalMoved(s);
    const hold =
      held(prev, "concentration_rising", side) &&
      s.capitalDeltaUsd > 0 &&
      s.believerDelta <= 0 &&
      capitalMoved(s);
    if (!active && !hold) return null;
    const gained = money(fmt, s.capitalDeltaUsd);
    return {
      type: "concentration_rising",
      side,
      tier: TIER.concentration_rising,
      headline: `Capital is concentrating on ${side}.`,
      detail: `${side} gained ${gained} without adding new believers.`,
      evidence: [
        { label: "Capital", value: `+${gained}` },
        { label: "Believers", value: `${s.believerDelta >= 0 ? "+" : ""}${s.believerDelta}` },
      ],
      fingerprint: fp("concentration_rising", side),
    };
  };

  // 3 — PRICE / CONVICTION DIVERGENCE (price re-rated with no one behind it).
  const priceDivergence = (side: Side, s: SideWindow): StoryEvent | null => {
    const p = s.pricePct ?? 0;
    const active = p >= FEED_TRIGGERS.price.minPct && s.believerDelta <= 0;
    const hold =
      held(prev, "price_conviction_divergence", side) && p >= ACCEL_EXIT && s.believerDelta <= 0;
    if (!active && !hold) return null;
    return {
      type: "price_conviction_divergence",
      side,
      tier: TIER.price_conviction_divergence,
      headline: "Price moved, but conviction did not.",
      detail: `${side} re-rated ${formatPct(p)} with no new believers behind it.`,
      evidence: [
        { label: "Price", value: formatPct(p) },
        { label: "Believers", value: `${s.believerDelta >= 0 ? "+" : ""}${s.believerDelta}` },
      ],
      fingerprint: fp("price_conviction_divergence", side),
    };
  };

  // 4 — MARKET DIVIDING (both sides gaining believers, comparably).
  const marketDividing = (): StoryEvent | null => {
    const enter = yes.believerDelta >= BEL && no.believerDelta >= BEL;
    const hold = yes.believerDelta >= 1 && no.believerDelta >= 1;
    if (!(held(prev, "market_dividing") ? hold : enter)) return null;
    const min = Math.min(yes.believerDelta, no.believerDelta);
    const max = Math.max(yes.believerDelta, no.believerDelta);
    if (!(max === 0 || min / max >= 0.5)) return null; // lopsided → directional, not divided
    return {
      type: "market_dividing",
      tier: TIER.market_dividing,
      headline: "The market is becoming divided.",
      detail: `Both sides are gaining believers (+${yes.believerDelta} YES · +${no.believerDelta} NO).`,
      evidence: [
        { label: "YES believers", value: `+${yes.believerDelta}` },
        { label: "NO believers", value: `+${no.believerDelta}` },
      ],
      fingerprint: fp("market_dividing"),
    };
  };

  // SOCIAL — a Tribe cluster forming (viewer-specific; only when social is passed).
  const tribeForming = (): StoryEvent | null => {
    if (!social) return null;
    const forming: Side | null =
      social.tribeJoinedYes >= TRIBE_FORMING_MIN && social.tribeJoinedYes >= social.tribeJoinedNo
        ? "YES"
        : social.tribeJoinedNo >= TRIBE_FORMING_MIN
          ? "NO"
          : null;
    if (!forming) return null;
    const n = forming === "YES" ? social.tribeJoinedYes : social.tribeJoinedNo;
    return {
      type: "tribe_forming",
      side: forming,
      tier: TIER.tribe_forming,
      headline: `A Tribe is forming around ${forming}.`,
      detail: `${n} of your Tribe backed ${forming}.`,
      evidence: [{ label: "Tribe", value: `+${n}` }],
      fingerprint: fp("tribe_forming", forming),
    };
  };

  // 5 — ACCELERATION — from the canonical ranker multiple (preferred), else raw
  // capital velocity. Attributed to the side drawing capital; never faked.
  const acceleration = (): StoryEvent | null => {
    const accelSide = (multiple: number): StoryEvent | null => {
      const side: Side = yes.capitalDeltaUsd >= no.capitalDeltaUsd ? "YES" : "NO";
      const s = side === "YES" ? yes : no;
      // A multiple alone is not a story. "Accelerating" claims money is moving
      // right now, so it must clear the SAME capital safeguard every other
      // capital transition clears — otherwise a single dust trade against a
      // near-zero baseline reads as 24× normal with nothing to see in the market.
      const gaining = s.capitalDeltaUsd > 0 && capitalMoved(s);
      const bar = held(prev, "accelerating", side) ? ACCEL_EXIT : ACCEL_ENTER;
      if (!(gaining && multiple >= bar)) return null;
      return {
        type: "accelerating",
        side,
        tier: TIER.accelerating,
        headline: `${side} is accelerating.`,
        detail: `Flow is ${multiple.toFixed(1)}× normal.`,
        evidence: [{ label: "Flow", value: `${multiple.toFixed(1)}× normal` }],
        fingerprint: fp("accelerating", side),
      };
    };
    if (baseline?.accelerationMultiple != null) {
      const r = accelSide(baseline.accelerationMultiple);
      if (r) return r;
    }

    if (baseline?.normalCapitalUsd != null && baseline.normalCapitalUsd > 0) {
      for (const [side, s] of sides) {
        const recent = s.recentCapitalUsd ?? s.capitalDeltaUsd;
        if (recent <= 0) continue;
        // Same safeguard as the multiple path: money must actually have moved.
        if (!capitalMoved(s)) continue;
        const multiple = recent / baseline.normalCapitalUsd;
        const bar = held(prev, "accelerating", side) ? ACCEL_EXIT : ACCEL_ENTER;
        if (multiple >= bar) {
          return {
            type: "accelerating",
            side,
            tier: TIER.accelerating,
            headline: `${side} is accelerating.`,
            detail: `Flow is ${multiple.toFixed(1)}× normal.`,
            evidence: [{ label: "Flow", value: `${multiple.toFixed(1)}× normal` }],
            fingerprint: fp("accelerating", side),
          };
        }
      }
    }
    return null;
  };

  // 6 — SIMPLE MOMENTUM: participation broadening (people AND money rising together).
  const broadening = (side: Side, s: SideWindow): StoryEvent | null => {
    const active = s.believerDelta >= BEL && s.capitalDeltaUsd > 0 && capitalMoved(s);
    const hold =
      held(prev, "participation_broadening", side) &&
      s.believerDelta >= 1 &&
      s.capitalDeltaUsd > 0 &&
      capitalMoved(s);
    if (!active && !hold) return null;
    return {
      type: "participation_broadening",
      side,
      tier: TIER.participation_broadening,
      headline: "Participation is broadening.",
      detail: `Believers and capital are rising together on ${side}.`,
      evidence: [
        { label: "Believers", value: `+${s.believerDelta}` },
        { label: "Capital", value: `+${money(fmt, s.capitalDeltaUsd)}` },
      ],
      fingerprint: fp("participation_broadening", side),
    };
  };

  // …and directional decline as the last resort.
  const losing = (): StoryEvent | null => {
    const side: Side | null =
      yes.believerDelta <= -BEL && yes.believerDelta <= no.believerDelta
        ? "YES"
        : no.believerDelta <= -BEL
          ? "NO"
          : null;
    if (!side) return null;
    const d = side === "YES" ? yes.believerDelta : no.believerDelta;
    return {
      type: "losing_conviction",
      side,
      tier: TIER.losing_conviction,
      headline: `${side} is losing believers.`,
      detail: `${Math.abs(d)} ${plural(d, "believer", "believers")} left ${side}.`,
      evidence: [{ label: "Believers", value: `${d}` }],
      fingerprint: fp("losing_conviction", side),
    };
  };

  /**
   * THE STORYTELLERS, in strict priority order. Adding a new kind of story is
   * adding a line here; everything above it keeps working unchanged.
   *
   * The ordering is a claim about information, not about excitement: the market
   * changing its own answer outranks a contradiction, a contradiction outranks a
   * plain gain, and a plain gain outranks a decline that any chart already shows.
   */
  /**
   * THE COMMUNITY CROSSED A NUMBER. A market total, from the two sides added —
   * the same arithmetic the panels show, so the feed and the tile agree.
   *
   * The base is only trustworthy when BOTH sides reported a real delta; the
   * emitter passes zero for a side whose history is missing, and a crossing
   * measured against a fabricated zero would announce a milestone on a market
   * that has been sitting above it for weeks. So a crossing needs a base above
   * nothing — a market's very first dollars are `first capital`, told elsewhere.
   */
  const capitalMilestone = (): StoryEvent | null => {
    const base = yes.capitalBaseUsd + no.capitalBaseUsd;
    const now = base + yes.capitalDeltaUsd + no.capitalDeltaUsd;
    if (base <= 0) return null;
    const rung = crossed(CAPITAL_MILESTONES, base, now);
    if (rung == null) return null;
    return {
      type: "capital_milestone",
      tier: TIER.capital_milestone,
      headline: `This question has drawn ${money(fmt, rung)}`,
      detail: `Committed capital passed ${money(fmt, rung)} ${input.timeframeShort === "24H" ? "today" : `over ${input.timeframeShort}`}.`,
      evidence: [{ label: "Committed", value: money(fmt, now) }],
      fingerprint: `capital_milestone:${rung}`,
    };
  };

  /**
   * THE MARKET CAME BACK. Every trade of the week landed in the last day, so the
   * six days before it were silent.
   *
   * It must already have been FUNDED to count: a market that opened yesterday
   * also has all of its week's trades in the last day, and calling a birth a
   * return would be the feed misreading its own community.
   */
  const reawakened = (): StoryEvent | null => {
    const a = input.activity;
    /* ONE TRADE IS NOT A RETURN. At `> 0` this announced "This question is alive
       again — First trades in a week, 1 trade today" off a single fill, and
       because the claim is CLOCK-driven, every dormant market reaching that bar
       in the same sweep says it at once — four identical rows in one window,
       which reads as a glitch rather than news. A return needs a second person
       to agree it happened. */
    if (!a || a.trades24h < MIN_REAWAKEN_TRADES || a.trades7d !== a.trades24h) return null;
    if (yes.capitalBaseUsd + no.capitalBaseUsd <= 0) return null;
    return {
      type: "market_reawakened",
      tier: TIER.market_reawakened,
      /* "This question is alive again / First trades in a week — 1 trade today"
         is telemetry: it reports the query that found the row. The fact is that
         a room nobody had entered in a week has people in it, and saying it as
         before-and-after is both truer to what happened and worth reading. */
      headline: "Back from the dead",
      detail: `Nobody touched this for a week. Then ${a.trades24h} ${plural(a.trades24h, "trade", "trades")} landed.`,
      evidence: [{ label: "Trades today", value: String(a.trades24h) }],
      fingerprint: "market_reawakened:market",
    };
  };

  /**
   * THE FLOOR. Whatever else did or did not have a shape, a move this size is
   * reported. The fingerprint carries the metric and the side, so a capital move
   * and a price move on the same market are separate episodes and the dedup
   * store cannot let one hide the other.
   */
  const material = (): StoryEvent | null => {
    const m = (input.material ?? [])[0];
    if (!m) return null;
    const side = m.side ?? undefined;
    const sw = side === "YES" ? yes : side === "NO" ? no : null;

    /* A SIDE'S FIRST BELIEVER IS ALREADY TOLD, BY NAME. The conviction feed
       emits "<person> is the first to back YES" off the very same trade. Saying
       it again here as an anonymous MAJOR MOVE gives the reader two badges for
       one fact, and makes the named telling — the better one — look like a
       different class of news. First CAPITAL has no such twin, so it stays. */
    if (m.kind === "arrival" && m.metric !== "capital") return null;

    /* CAPITAL LEFT BECAUSE A PERSON LEFT. When the side's believers fall in the
       same window, the exit is already reported with a name, an amount and the
       question ("Alex left YES with $15 · 4 believers now"). "Capital on YES
       fell −83%" is that same event told worse; at a full drain it reads −100%,
       which is precisely what LAST BELIEVER LEFT already says. A capital fall
       with believers UNCHANGED is a real, separate story — a holder trimming —
       and still reports. */
    if (m.metric === "capital" && m.direction === "down" && sw && sw.believerDelta < 0) return null;

    const dir = m.direction === "up" ? "rose" : "fell";
    const pct = m.pct == null ? null : formatPct(m.pct);
    const where = side ?? "the market";

    const headline =
      m.kind === "arrival"
        ? m.metric === "capital"
          ? `First capital backs ${where}`
          : `${where} has its first believers`
        : m.kind === "crowd"
          ? `${where} ${m.delta > 0 ? "gained" : "lost"} ${Math.abs(Math.round(m.delta))} ${plural(m.delta, "believer", "believers")}`
          : m.metric === "price"
            ? `${where} ${m.direction === "up" ? "got more expensive" : "got cheaper"}`
            : m.metric === "capital"
              ? /* MONEY MOVING, NOT AN ACCOUNTING LINE. "Capital on YES rose
                   +12%" is a ledger entry; money piling in is a crowd doing
                   something. Note the fall stays measured on purpose — an exit
                   already suppresses this row, so what survives is a holder
                   trimming, and calling that a collapse would be a lie told for
                   drama. */
                m.direction === "up"
                ? `Money is piling into ${where}`
                : `Money is leaving ${where}`
              : `Believers on ${where} ${dir} ${pct ?? ""}`.trim();

    return {
      type: "material_move",
      side,
      tier: TIER.material_move,
      headline,
      /* The move, not the rule that admitted it. This used to append "— at or
         beyond the N% the feed treats as news", which explains our own threshold
         to a reader who has no use for it; it is editorial policy leaking into
         the story. The number and the window are the fact. */
      detail: pct == null ? undefined : `${pct} over ${input.timeframeShort}`,
      evidence: [
        {
          label: m.metric === "capital" ? "Capital" : m.metric === "price" ? "Price" : "Believers",
          value: pct ?? `${m.delta > 0 ? "+" : "−"}${Math.abs(Math.round(m.delta))}`,
        },
      ],
      // The metric is part of the identity: without it, a capital move and a
      // price move on the same side would collapse into one episode and the
      // second would never be told.
      fingerprint: `material_move:${m.metric}:${side ?? "market"}`,
    };
  };

  const tellers: Array<() => StoryEvent | null> = [
    majorityFlipped, //          the answer itself changed
    () => firstOf(peopleCapital), //  people in, money out
    () => firstOf(concentration), //  money in, nobody new
    () => firstOf(priceDivergence), // price moved, conviction didn't
    () => firstOf(sideDoubled), //    a crowd doubled
    marketDividing, //           both sides gaining
    () => firstOf(milestone), //      a round number crossed
    capitalMilestone, //         the community's money crossed one too
    reawakened, //               silent for a week, trading again
    tribeForming, //             your people are clustering
    acceleration, //             faster than this market's own normal
    balanced, //                 genuine, settled disagreement
    () => firstOf(broadening), //     people and money rising together
    material, //                 the floor: a 5% move is never silently dropped
    losing, //                   the last resort
  ];

  for (const tell of tellers) {
    const story = tell();
    if (story) return story;
  }
  return null;
}
