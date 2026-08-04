/**
 * Feed story engine — the narrative layer (pure, v1).
 *
 * ZERO IO. Composes the ranked "beats" that make a market card feel alive and
 * personal, in the order the product tells the story:
 *   1. event        — what just happened (the real-time anchor)
 *   2. momentum      — the picture (who's moving, which way, how fast)
 *   3. relationship  — the color (your people, by name + face)
 *
 * Two hard rules, both enforced by tests:
 *   • Voice: energetic and honest — concrete numbers, present tense, NO hype
 *     words (whale / smart money / pouring / exploding / moon / degen / loading up).
 *   • Privacy: only wallets in the VIEWER'S network are ever named. The crowd is
 *     always an anonymous count — this module never receives, and never invents,
 *     a name for a non-network wallet.
 */

export type Side = "YES" | "NO";
export type NetworkLabel = "twin" | "tribe" | "opp" | "inverse";
export type BeatKind = "event" | "momentum" | "relationship";
export type BeatTone = "yes" | "no" | "neutral" | "hot";

export interface StoryBeat {
  kind: BeatKind;
  text: string;
  tone: BeatTone;
  /** Classification glyph for the momentum beat (🔥 🌱 💎 …). */
  emoji?: string;
}

/** A named person — ONLY ever someone in the viewer's network. */
export interface NetworkFace {
  wallet: string;
  name: string;
  avatarUrl: string | null;
  relationship: NetworkLabel;
  side: Side;
}

export interface StoryInput {
  /** Recent-event anchor. `text` is a pre-built factual line (e.g. market_state.live_line). */
  recent?: { text: string | null; kind?: string | null; occurredAt?: string | null } | null;
  momentum: {
    newBackers1h?: number | null;
    newBackers24h?: number | null;
    uniqueWallets24h?: number | null;
    moneyYesPct?: number | null;
    peopleYesPct?: number | null;
    believersYes?: number | null;
    believersNo?: number | null;
    volumeUsd?: number | null;
  };
  classification?: string | null; // opportunity_type: hot | early | hidden | contested | conviction | new
  /** The viewer's network members active in THIS market (already resolved + faced). */
  network?: NetworkFace[];
}

export interface MarketStory {
  beats: StoryBeat[];
  /** Network faces for the pile (real identity). Capped. */
  faces: NetworkFace[];
  /** The crowd behind the dominant side — a count, never names. */
  crowd: { side: Side; count: number } | null;
}

const CLASS_EMOJI: Record<string, string> = {
  hot: "🔥",
  early: "🌱",
  hidden: "💎",
  contested: "⚖️",
  conviction: "🧠",
  new: "🆕",
};

const num = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? 0 : Number(n));

/** Money's leading side + how lopsided (0..50 points from even). */
function moneyLean(moneyYesPct: number | null | undefined) {
  const p = num(moneyYesPct);
  const side: Side = p >= 50 ? "YES" : "NO";
  return { side, gap: Math.abs(p - 50) };
}

// ── momentum beat ─────────────────────────────────────────────────────────────
function momentumBeat(input: StoryInput): StoryBeat | null {
  const m = input.momentum;
  const cls = input.classification ?? null;
  const emoji = cls ? CLASS_EMOJI[cls] : undefined;
  const { side } = moneyLean(m.moneyYesPct);
  const tone: BeatTone = cls === "hot" ? "hot" : side === "YES" ? "yes" : "no";
  const n1h = num(m.newBackers1h);
  const n24h = num(m.newBackers24h);
  const active = num(m.uniqueWallets24h);

  // People vs money divergence — the strongest honest hook when it exists.
  const pYes = num(m.peopleYesPct);
  const mYes = num(m.moneyYesPct);
  const divergent =
    m.peopleYesPct != null && m.moneyYesPct != null && (pYes - 50) * (mYes - 50) < 0;

  let text: string;
  switch (cls) {
    case "hot":
      text =
        n1h > 0
          ? `Money's moving to ${side} — ${n1h} backed it in the last hour`
          : `Heating up — ${active} active today`;
      break;
    case "early":
      text = n24h > 0 ? `Quietly growing — ${n24h} new believers today` : "Small but growing";
      break;
    case "hidden":
      text = `More going on here than the size shows — ${active} active today`;
      break;
    case "contested":
      text = "Split down the middle — both sides still buying";
      break;
    case "conviction":
      text = `Holders are staying put — ${side} has held through the swings`;
      break;
    case "new":
      text = n24h > 0 ? `Just opened — ${n24h} already in` : "Just opened";
      break;
    default:
      if (divergent) {
        text = `People lean ${pYes >= 50 ? "YES" : "NO"}, money leans ${side}`;
      } else if (n1h > 0) {
        text = `${n1h} backed ${side} in the last hour`;
      } else if (mYes > 0) {
        text = `${Math.round(mYes >= 50 ? mYes : 100 - mYes)}% of the money is on ${side}`;
      } else {
        return null;
      }
  }

  // Overlay divergence onto a classification line when both are strong.
  if (divergent && cls && cls !== "contested") {
    text += ` · people lean ${pYes >= 50 ? "YES" : "NO"}`;
  }
  return { kind: "momentum", text, tone, emoji };
}

// ── relationship beat ─────────────────────────────────────────────────────────
const LABEL_TEXT: Record<NetworkLabel, string> = {
  twin: "Twin",
  tribe: "Tribe",
  // One vocabulary: a mid-tier opposite is a Rival; the strongest is an Opp.
  opp: "Rival",
  inverse: "Opp",
};
const isAligned = (l: NetworkLabel) => l === "twin" || l === "tribe";
// Prominence when picking the single lead face.
const RANK: Record<NetworkLabel, number> = { twin: 4, opp: 3, tribe: 2, inverse: 1 };

function relationshipBeat(network: NetworkFace[]): StoryBeat | null {
  if (network.length === 0) return null;
  const aligned = network.find((f) => isAligned(f.relationship));
  const opposed = network.find((f) => !isAligned(f.relationship));

  // Split — an ally and an adversary on opposite sides is the rarest, best beat.
  if (aligned && opposed && aligned.side !== opposed.side) {
    return {
      kind: "relationship",
      text: `Your ${LABEL_TEXT[aligned.relationship]} and your ${LABEL_TEXT[opposed.relationship]} are split here`,
      tone: "neutral",
    };
  }

  const lead = [...network].sort((a, b) => RANK[b.relationship] - RANK[a.relationship])[0];
  const tone: BeatTone = lead.side === "YES" ? "yes" : "no";
  let text: string;
  switch (lead.relationship) {
    case "twin":
      text = `${lead.name} (your Twin) is on ${lead.side}`;
      break;
    case "tribe":
      text = `${lead.name} (your Tribe) backed ${lead.side}`;
      break;
    case "opp":
      text = `Your Rival ${lead.name} is on ${lead.side}`;
      break;
    default:
      text = `Your Opp ${lead.name} backed ${lead.side}`;
  }
  return { kind: "relationship", text, tone };
}

// ── event beat ────────────────────────────────────────────────────────────────
function eventBeat(input: StoryInput): StoryBeat | null {
  const t = input.recent?.text?.trim();
  if (!t) return null;
  const { side } = moneyLean(input.momentum.moneyYesPct);
  return { kind: "event", text: t, tone: side === "YES" ? "yes" : "no" };
}

/**
 * Compose the ordered story for one market. Beats appear in narrative order
 * (event → momentum → relationship), each omitted when there's nothing true to
 * say. `faces` + `crowd` drive the avatar pile.
 */
export function composeMarketStory(input: StoryInput): MarketStory {
  const network = (input.network ?? []).slice(0, 4);
  const beats: StoryBeat[] = [];
  const ev = eventBeat(input);
  const mo = momentumBeat(input);
  const re = relationshipBeat(network);
  if (ev) beats.push(ev);
  if (mo) beats.push(mo);
  if (re) beats.push(re);

  const { side } = moneyLean(input.momentum.moneyYesPct);
  const crowdCount = num(input.momentum.newBackers24h) || num(input.momentum.uniqueWallets24h);
  const crowd = crowdCount > 0 ? { side, count: crowdCount } : null;

  return { beats, faces: network, crowd };
}

// ============================================================================
// Live-event story — one Live-feed row.
//
// THE FEED IS ABOUT PEOPLE. Money is how a belief becomes visible, never the
// subject of the sentence. "Someone backed NO with $8,400" — not "$8,400 moved
// into NO". The reader should finish a row knowing what a person did.
//
// Three lines, three DIFFERENT jobs. No line may repeat another:
//   1. HEADLINE     — what changed, as a 2–3 word kicker. Not a sentence.
//   2. BODY         — who did what. One sentence, person first, money as a
//                     supporting clause.
//   3. ATTRIBUTION  — only what the sentence could not carry: how big the side
//                     is now, how long they had held. Null when there is
//                     nothing left to add, which is most of the time.
//
// The old shape said the same thing three ways —
//   CONVICTION SHIFTED / "A believer switched." / "duckfacts.eth switched sides."
// — three lines, one fact, and the person arrived last and smallest. Now:
//   SWITCHED SIDES / "duckfacts.eth switched to NO."
//
// Two hard rules, both enforced by tests:
//   • Terminology: never wallet / address / transaction / position / holder / the
//     "YES tribe" (a Tribe belongs to the USER and is cross-market; YES/NO are
//     market SIDES — you back / join / enter a side, you don't join its tribe).
//   • Privacy: a network member's SIDE is never revealed here — their row is a
//     side-blind belonging signal (YOUR TWIN / YOUR TRIBE / YOUR OPP) until the
//     viewer has chosen. Non-network single actors may be named (pov.co identity).
// ============================================================================

export type LiveCategory =
  | "fresh_market"
  | "growing"
  | "shrinking"
  | "capital_in"
  | "capital_out"
  | "milestone"
  | "momentum"
  | "twin"
  | "tribe"
  | "opp"
  | "inverse";

export interface LiveStory {
  category: LiveCategory;
  /** A 2–3 word kicker naming the change. Never a sentence. */
  headline: string;
  /** The behaviour, person first: "Ana backed YES with $420." */
  body: string;
  /** Only what the body could not carry (scale, tenure). Usually null. */
  attribution: string | null;
  tone: BeatTone;
  /** True for network-relative rows (get the "about you" wash). */
  personal: boolean;
}

export interface LiveStoryInput {
  kind: string; // trade_burst | large_trade | round_trip | market_created | believer_milestone | tribe_doubled | side_shift
  side: Side | null;
  action?: "BUY" | "SELL" | null;
  amountUsd?: number | null;
  /** Wallets in a burst; 1/undefined for a single actor. */
  walletCount?: number | null;
  /** Named actor for a single-wallet row; null for a multi-wallet burst. */
  actor?: { name: string; relationship: NetworkLabel | null } | null;
  /** The market question — the hero of a fresh_market row. */
  question?: string | null;
  /** Believer milestone threshold. */
  threshold?: number | null;
  market?: {
    believersYes?: number | null;
    believersNo?: number | null;
  } | null;
}

const usd = (n: number): string =>
  "$" +
  (n >= 1000
    ? n.toLocaleString("en-US", { maximumFractionDigits: 0 })
    : n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 2 : 0 }));

const sideTone = (side: Side | null, negative = false): BeatTone =>
  side == null ? "neutral" : side === "YES" ? (negative ? "no" : "yes") : negative ? "yes" : "no";

const REL_HEADLINE: Record<NetworkLabel, string> = {
  twin: "YOUR TWIN",
  tribe: "YOUR TRIBE",
  opp: "YOUR RIVAL",
  inverse: "YOUR OPP",
};

/**
 * The side-blind body for a network member's move — never names their side.
 *
 * The headline already says WHO they are to you ("YOUR TWIN"), so the sentence
 * says what they DID and nothing else. It used to re-describe the relationship
 * here too ("Your closest match just entered this market") and then a third
 * time in the attribution ("· in your network").
 */
function personalBody(
  name: string | null,
  rel: NetworkLabel,
  action: "BUY" | "SELL" | null | undefined,
): string {
  const who = name ?? FALLBACK_WHO[rel];
  return action === "SELL" ? `${who} stepped back.` : `${who} entered.`;
}

/** How to refer to a network member whose identity we don't have. */
const FALLBACK_WHO: Record<NetworkLabel, string> = {
  twin: "Your closest match",
  tribe: "Someone in your Tribe",
  opp: "Your strongest rival",
  inverse: "Someone who mirrors you",
};

/**
 * Compose one Live-feed row. Network members get a side-blind belonging row; the
 * crowd and non-network actors get a market-story row. Always: headline (market)
 * → body (change) → attribution (who, small, last).
 */
export function composeLiveStory(input: LiveStoryInput): LiveStory {
  const side = input.side;
  const sideStr = side ?? "";
  const who = input.actor?.name ?? null;

  // ── A new question. The question is the hero; the timestamp already says
  //    "just" — so the old "Just opened." attribution is deleted, not moved. ──
  if (input.kind === "market_created") {
    return {
      category: "fresh_market",
      headline: "NEW MARKET",
      body: input.question?.trim() || "A new question opened.",
      attribution: who ? `${who} opened it.` : null,
      tone: "neutral",
      personal: false,
    };
  }

  // ── A round number of people now believe the same thing. ──
  if (input.kind === "believer_milestone") {
    const n = num(input.threshold).toLocaleString("en-US");
    return {
      category: "milestone",
      headline: "MILESTONE",
      body: side ? `${sideStr} reached ${n} believers.` : `${n} people back this question.`,
      attribution: null,
      tone: sideTone(side),
      personal: false,
    };
  }

  // ── A side's believers doubled in a day. ──
  if (input.kind === "tribe_doubled") {
    return {
      category: "momentum",
      headline: "SURGING",
      body: side ? `Believers in ${sideStr} doubled today.` : "Believers doubled today.",
      attribution: null,
      tone: sideTone(side),
      personal: false,
    };
  }

  // ── Someone in your network moved. The headline is the relationship, so the
  //    sentence is only what they did — and their SIDE is never revealed. ──
  const rel = input.actor?.relationship ?? null;
  if (rel) {
    return {
      category: rel,
      headline: REL_HEADLINE[rel],
      body: personalBody(who, rel, input.action),
      attribution: null,
      tone: "neutral", // never leak the side
      personal: true,
    };
  }

  const amt = num(input.amountUsd);
  const sell = input.action === "SELL";
  const n = num(input.walletCount) || 1;
  const sideBelievers = side === "YES" ? input.market?.believersYes : input.market?.believersNo;
  const remaining = sideBelievers == null ? null : num(sideBelievers);
  /** How big the side is now — the one thing a behaviour sentence can't carry. */
  const scale =
    remaining == null
      ? null
      : `${remaining.toLocaleString("en-US")} believer${remaining === 1 ? "" : "s"} now.`;

  // ── Someone changed their mind. The rarest and most interesting move. ──
  if (input.kind === "side_shift") {
    return {
      category: "momentum",
      headline: "SWITCHED SIDES",
      body: side
        ? `${who ?? "A believer"} switched to ${sideStr}.`
        : `${who ?? "A believer"} switched sides.`,
      attribution: null,
      tone: sideTone(side),
      personal: false,
    };
  }

  // ── In and out inside a day — conviction that didn't hold. ──
  if (input.kind === "round_trip") {
    return {
      category: "momentum",
      headline: "IN AND OUT",
      body: `${who ?? "A believer"} backed ${sideStr} and left the same day.`,
      attribution: null,
      tone: "neutral",
      personal: false,
    };
  }

  // ── Serious money. The PERSON acts; the amount is what they acted with. ──
  if (input.kind === "large_trade") {
    return sell
      ? {
          category: "capital_out",
          headline: "BIG EXIT",
          body: `${who ?? "Someone"} pulled ${usd(amt)} out of ${sideStr}.`,
          attribution: scale,
          tone: sideTone(side, true),
          personal: false,
        }
      : {
          category: "capital_in",
          headline: "BIG BACKING",
          body: `${who ?? "Someone"} backed ${sideStr} with ${usd(amt)}.`,
          attribution: scale,
          tone: sideTone(side),
          personal: false,
        };
  }

  // ── The everyday heartbeat: people arriving, people stepping back. ──
  if (sell) {
    return {
      category: "shrinking",
      headline: `${sideStr} IS SHRINKING`,
      body: who
        ? `${who} left ${sideStr}.`
        : n > 1
          ? `${n} people left ${sideStr}.`
          : `Someone left ${sideStr}.`,
      attribution: scale,
      tone: sideTone(side, true),
      personal: false,
    };
  }
  return {
    category: "growing",
    headline: `${sideStr} IS GROWING`,
    body: who
      ? `${who} joined ${sideStr}.`
      : n > 1
        ? `${n} people joined ${sideStr}.`
        : `Someone joined ${sideStr}.`,
    attribution: scale,
    tone: sideTone(side),
    personal: false,
  };
}
