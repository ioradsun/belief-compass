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
          ? `Money's moving to ${side} — ${n1h} backed in the last hour`
          : `Heating up — ${active} active today`;
      break;
    case "early":
      text = n24h > 0 ? `Quietly growing — ${n24h} new backers today` : "Small but growing";
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
  opp: "Opp",
  inverse: "Inverse",
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
      text = `Your Opp ${lead.name} is on ${lead.side}`;
      break;
    default:
      text = `Your Inverse ${lead.name} backed ${lead.side}`;
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
// Live-event story — one line per Live-tape row.
//
// Turns a single on-chain action into a FOMO-shaped sentence:
//   {who} {joined / left / defected to} the {SIDE} tribe for ${amt}
//   — {the single strongest true momentum hook}
//
// Every clause is TRUE (numbers come from the row + market_state). Gamified
// framing (tribe / joined / defected / heating up) is allowed; fabricated hype
// (whale / smart money / guaranteed / moon / pouring) is not.
// ============================================================================

export interface LiveStoryInput {
  /** Named actor for a single-wallet row; null for a multi-wallet burst. */
  actor?: { name: string; relationship: NetworkLabel | null } | null;
  /** Wallets in a burst (for the crowd line); 1/undefined for a single actor. */
  walletCount?: number | null;
  side: Side | null;
  action?: "BUY" | "SELL" | null;
  /** A position_changed_side event — the actor switched sides. */
  flip?: boolean;
  amountUsd?: number | null;
  market?: {
    believersYes?: number | null;
    believersNo?: number | null;
    newBackers1h?: number | null;
    moneyYesPct?: number | null;
    peopleYesPct?: number | null;
    opportunityType?: string | null;
  } | null;
}

const capWord = (s: string) => s[0].toUpperCase() + s.slice(1);

/** The single strongest true momentum hook for a Live line (or ""). */
function liveMomentumClause(input: LiveStoryInput, side: Side): string {
  const m = input.market;
  if (!m) return "";
  const sideBackers = side === "YES" ? num(m.believersYes) : num(m.believersNo);
  const n1h = num(m.newBackers1h);
  const moneyOnSide =
    m.moneyYesPct == null ? 0 : side === "YES" ? num(m.moneyYesPct) : 100 - num(m.moneyYesPct);
  const divergent =
    m.peopleYesPct != null &&
    m.moneyYesPct != null &&
    (num(m.peopleYesPct) - 50) * (num(m.moneyYesPct) - 50) < 0;
  const buy = !input.flip && input.action !== "SELL";

  if (buy) {
    // Urgency first, then bandwagon, then dominance.
    if (n1h >= 3 || m.opportunityType === "hot")
      return n1h >= 2 ? `${side} is heating up, ${n1h} joined this hour` : `${side} is heating up`;
    if (sideBackers >= 5) return `${sideBackers} now hold ${side}`;
    if (moneyOnSide >= 60) return `the money's ${Math.round(moneyOnSide)}% ${side}`;
    return "";
  }
  // Selling / defecting — the contrarian or cooling angle.
  if (divergent) {
    const moneySide: Side = num(m.moneyYesPct) >= 50 ? "YES" : "NO";
    return `the money leans ${moneySide}`;
  }
  if (sideBackers >= 5) return `${sideBackers} still hold ${side}`;
  return "";
}

export function composeLiveStory(input: LiveStoryInput): { text: string; tone: BeatTone } {
  const side = input.side;
  const tone: BeatTone = side === "YES" ? "yes" : side === "NO" ? "no" : "neutral";
  const stake =
    input.amountUsd && input.amountUsd > 0
      ? ` for $${
          input.amountUsd >= 1000
            ? input.amountUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })
            : input.amountUsd.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })
        }`
      : "";

  const clause = side ? liveMomentumClause(input, side) : "";
  const tail = clause ? ` — ${clause}` : "";

  // Crowd burst (no named actor).
  if (!input.actor) {
    const n = num(input.walletCount) || 1;
    const verb = input.action === "SELL" ? "pulled out of" : "piled into";
    return {
      text: `${n} ${n === 1 ? "believer" : "believers"} ${verb} ${side ?? ""}${stake}${tail}`.trim(),
      tone,
    };
  }

  const who = input.actor.relationship
    ? `${input.actor.name} (${capWord(input.actor.relationship)})`
    : input.actor.name;

  let verbPhrase: string;
  // Consistent tribe metaphor (matches "Welcome to the YES Tribe", tribe health,
  // tribe milestones): joined ↔ left, plus defected for a side switch.
  if (input.flip) verbPhrase = `defected to ${side ?? ""}`.trim();
  else if (input.action === "SELL") verbPhrase = `left the ${side ?? ""} tribe`.trim();
  else verbPhrase = `joined the ${side ?? ""} tribe`.trim();

  return { text: `${who} ${verbPhrase}${stake}${tail}`.trim(), tone };
}
