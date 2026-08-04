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

/**
 * THE ONE RELATIONSHIP VOCABULARY. Four labels, and the words for them.
 *
 * Read the stored names carefully, because they invert: the engine's `inverse`
 * is the product's OPP — the strongest, hardest-earned opposite — and `opp` is
 * the milder Rival tier. Twin↔Opp are the two earned badges; Tribe↔Rival are the
 * two groups.
 */
export const NETWORK_LABEL_TEXT: Record<NetworkLabel, string> = {
  twin: "Twin",
  tribe: "Tribe",
  opp: "Rival",
  inverse: "Opp",
};

/**
 * How strongly each label pulls, on ONE scale that the whole app shares: which
 * face leads a stack, which relationship a sentence names, how much a row is
 * worth to this reader.
 *
 * Opp sits level with Twin by design. Twin answers "who thinks like me?"; Opp
 * answers "who consistently challenges me?" Both are people worth meeting, and
 * ranking the strongest opposite BELOW the milder Rival — as four separate
 * copies of this table used to — quietly built a product that only wanted you to
 * meet people who agree with you.
 */
export const NETWORK_STRENGTH: Record<NetworkLabel, number> = {
  twin: 1,
  inverse: 0.95,
  tribe: 0.75,
  opp: 0.7,
};

/** Aligned labels — the ones that may honestly be called "your people". */
export const isAlignedLabel = (l: NetworkLabel): boolean => l === "twin" || l === "tribe";
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
const LABEL_TEXT = NETWORK_LABEL_TEXT;
const isAligned = isAlignedLabel;
// Prominence when picking the single lead face — the shared scale, not a copy.
const RANK = NETWORK_STRENGTH;

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
  /**
   * A CONTINUITY rather than a change — someone is still holding a belief they
   * have held for a long time (src/domain/standing-fact). It gets its own name
   * because every other category answers "what happened", and folding this into
   * one of them would label a fact that has no "when" as though it did.
   */
  | "conviction"
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
