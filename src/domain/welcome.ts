/**
 * Welcome — pure selection & aggregation, no IO.
 *
 * "Conviction needs company." When people join a side you already hold, you can
 * welcome them in one tap. This module is the pure core of both directions:
 *
 *  - selectWelcomable: from the recent new-believers on markets you hold, keep
 *    only those on YOUR side, that aren't you, and that you haven't welcomed yet.
 *  - summarizeReceived: fold the welcomes you received into one aggregated line
 *    (never twelve notifications — one "N believers welcomed you").
 *
 * All matching is lower-cased and deduped so a wallet is offered / counted once
 * per tribe (market + side).
 */

export type Side = "YES" | "NO";

export interface DirectionalEvent {
  wallet: string;
  marketId: number;
  newSide: Side;
  /** Canonical occurrence — events must arrive newest-first for dedup to keep the latest. */
  occurredAt: string;
}

export interface Welcomable {
  wallet: string;
  marketId: number;
  side: Side;
  /** When they became directional — drives "since your last visit". */
  occurredAt: string;
}

export interface ReceivedWelcome {
  welcomer: string;
  marketId: number;
  side: Side;
}

/** Stable identity of one welcome (recipient in a given tribe). */
export function welcomeKey(recipient: string, marketId: number, side: Side): string {
  return `${recipient.toLowerCase()}:${marketId}:${side}`;
}

/**
 * Who the viewer can welcome: new believers on the exact side the viewer holds,
 * excluding the viewer and anyone already welcomed. `events` should be newest
 * first; the first occurrence of each (wallet, market, side) wins.
 */
export function selectWelcomable(params: {
  viewer: string;
  positions: Map<number, Side>;
  events: DirectionalEvent[];
  alreadyWelcomed: Set<string>;
  cap?: number;
}): Welcomable[] {
  const { viewer, positions, events, alreadyWelcomed, cap = 30 } = params;
  const v = viewer.toLowerCase();
  const seen = new Set<string>();
  const out: Welcomable[] = [];
  for (const e of events) {
    const side = positions.get(e.marketId);
    if (!side || side !== e.newSide) continue; // must be on YOUR side
    const w = e.wallet.toLowerCase();
    if (w === v) continue; // never yourself
    const key = welcomeKey(w, e.marketId, side);
    if (alreadyWelcomed.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ wallet: w, marketId: e.marketId, side, occurredAt: e.occurredAt });
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Fold received welcomes into one aggregated summary: distinct welcomers (each
 * person counts once even if they welcomed you on several markets), and the
 * single tribe when every welcome is for the same side of the same market.
 */
export function summarizeReceived(welcomes: ReceivedWelcome[]): {
  count: number;
  welcomers: string[];
  tribe: { marketId: number; side: Side } | null;
} {
  const welcomers = [...new Set(welcomes.map((w) => w.welcomer.toLowerCase()))];
  const tribes = new Set(welcomes.map((w) => `${w.marketId}:${w.side}`));
  const tribe =
    tribes.size === 1 && welcomes.length > 0
      ? { marketId: welcomes[0].marketId, side: welcomes[0].side }
      : null;
  return { count: welcomers.length, welcomers, tribe };
}

/* ───────────────────── The Daily Room — relationship-first ────────────────── */

/**
 * "Joined your side" is a market-local fact. WHO joined is the social payload,
 * and the DNA engine already knows: Twin / Tribe / Opp / Inverse / Neutral.
 * The room groups arrivals by that relationship, so the rare event (an Opp
 * crossing to your side) never hides behind five anonymous new believers.
 */
export type RoomGroup = "crossing" | "twin" | "tribe" | "new";

export const ROOM_GROUP_ORDER: RoomGroup[] = ["crossing", "twin", "tribe", "new"];

export const ROOM_GROUP_LABEL: Record<RoomGroup, string> = {
  crossing: "Rival who crossed over",
  twin: "Closest conviction match",
  tribe: "Your Tribe",
  new: "New to your circle",
};

export const ROOM_GROUP_BLURB: Record<RoomGroup, string> = {
  crossing: "You normally land on opposite sides. On this one, you didn't.",
  twin: "Your closest match in conviction — and they just backed your side again.",
  tribe: "You've backed the same side more often than not. Add one more.",
  new: "",
};

/** DNA label → room group. Opp/Inverse arriving on YOUR side is a crossing. */
export function roomGroupFor(relationship: string | null | undefined): RoomGroup {
  switch (relationship) {
    case "opp":
    case "inverse":
      return "crossing";
    case "twin":
      return "twin";
    case "tribe":
      return "tribe";
    default:
      return "new";
  }
}

export interface RoomPerson {
  wallet: string;
  name: string;
  avatarUrl: string | null;
  marketId: number;
  marketTitle: string;
  side: Side;
  occurredAt: string;
  /** Canonical DNA label, or null when there isn't enough shared history yet. */
  relationship: string | null;
  agreement: number | null;
  sharedBeliefs: number | null;
  /** Arrived since the viewer last opened the room. */
  isNew: boolean;
}

export interface RoomSection {
  group: RoomGroup;
  label: string;
  blurb: string;
  people: RoomPerson[];
  /** How many of these arrived since the last visit. */
  fresh: number;
}

/**
 * One card per person (a wallet that joined you on three markets is still one
 * human), grouped by relationship and ordered rarest-signal-first.
 */
export function groupRoom(people: RoomPerson[]): RoomSection[] {
  const seen = new Set<string>();
  const byGroup = new Map<RoomGroup, RoomPerson[]>();
  for (const p of people) {
    const w = p.wallet.toLowerCase();
    if (seen.has(w)) continue;
    seen.add(w);
    const g = roomGroupFor(p.relationship);
    const list = byGroup.get(g);
    if (list) list.push(p);
    else byGroup.set(g, [p]);
  }
  const out: RoomSection[] = [];
  for (const group of ROOM_GROUP_ORDER) {
    const list = byGroup.get(group);
    if (!list || list.length === 0) continue;
    out.push({
      group,
      label: ROOM_GROUP_LABEL[group],
      blurb: ROOM_GROUP_BLURB[group],
      people: list,
      fresh: list.filter((p) => p.isNew).length,
    });
  }
  return out;
}

/**
 * Why this face is in your room, in commonality terms only.
 *
 * `why` is the event that put them here (they took a side you already hold).
 * `history` is how much you already have in common — the reason it matters.
 * Names are deliberately absent: the room is explored by what you share, and
 * identity is the reward for looking closer.
 */
export function roomReason(p: RoomPerson): { why: string; history: string } {
  const why = `Backed ${p.side} with you on "${p.marketTitle}"`;
  const shared = p.sharedBeliefs ?? 0;
  const agree = p.agreement;
  const group = roomGroupFor(p.relationship);

  if (group === "new" || shared < 1 || agree == null) {
    return { why, history: "Your first market together" };
  }
  const markets = plural(shared, "market", "markets");
  if (group === "crossing") {
    return {
      why,
      history: `Across ${markets} you agree only ${agree}% of the time — today you match`,
    };
  }
  return { why, history: `You agree ${agree}% of the time across ${markets}` };
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The one line at the top of the room. It answers "why should I care about this
 * person?", so the RELATIONSHIP is the headline, not the activity: who they are
 * to you (Tribe / Rival / closest match / new to Conviction), led by a name when
 * there is one. The rarest relationship leads; everyone else folds into "+N more".
 */
export function roomHeadline(sections: RoomSection[], hasVisitedBefore: boolean): string {
  const total = sections.reduce((n, s) => n + s.people.length, 0);
  if (total === 0) return "No new people in your circle";

  const freshTotal = sections.reduce((n, s) => n + s.fresh, 0);
  const useFresh = hasVisitedBefore && freshTotal > 0;

  const counted = sections
    .map((s) => ({
      group: s.group,
      people: useFresh ? s.people.filter((p) => p.isNew) : s.people,
    }))
    .filter((x) => x.people.length > 0);

  if (counted.length === 0) {
    // Nothing new since last time, but these people are still unmet.
    return total === 1
      ? "1 person is still waiting to meet you"
      : `${total} people are still waiting to meet you`;
  }

  const lead = counted[0];
  const rest = counted.slice(1).reduce((sum, x) => sum + x.people.length, 0);
  const head = leadClause(lead.group, lead.people[0]?.name ?? "", lead.people.length);
  return rest > 0 ? `${head} · +${rest} more` : head;
}

/**
 * Relationship-first copy. One person = named and specific; several = the name
 * still leads ("and N others") so the line stays a discovery, not a tally.
 */
function leadClause(group: RoomGroup, name: string, n: number): string {
  const named = name.trim().length > 0;
  const others = n - 1;
  const withOthers = (verbOne: string, verbMany: string) =>
    named
      ? n === 1
        ? `${name} ${verbOne}`
        : `${name} and ${others} ${others === 1 ? "other" : "others"} ${verbMany}`
      : `${n} people ${verbMany}`;

  switch (group) {
    case "crossing":
      return named
        ? n === 1
          ? `${name}, one of your Rivals, just crossed to your side`
          : `${name} and ${others} ${others === 1 ? "other Rival" : "other Rivals"} just crossed to your side`
        : `${n} Rivals just crossed to your side`;
    case "twin":
      return named
        ? n === 1
          ? `${name} is one of your closest conviction matches`
          : `${name} and ${others} ${others === 1 ? "other" : "others"} are among your closest conviction matches`
        : `${n} of your closest conviction matches showed up`;
    case "tribe":
      return withOthers("just became part of your Tribe", "just became part of your Tribe");
    default:
      return withOthers("now shares one of your convictions", "now share your convictions");
  }
}
