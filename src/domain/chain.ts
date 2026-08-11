/**
 * ONE CARD PER PERSON PER MARKET — the chain, seen from the middle of it.
 *
 * The rail used to render the same question twice: an amber "CHALLENGED YOU"
 * card when somebody brought you in, and, further down, a blue "YOU CHALLENGED"
 * card once you relayed it. Two cards, one question, one reader — and no visible
 * connection between them, so the single most important thing that happens here
 * (a chain passing THROUGH a person) was the one thing the surface could not show.
 *
 * So there is one card, keyed by market, and the card changes as the viewer's
 * role changes:
 *
 *     somebody brought me in (amber)
 *       → I showed up
 *       → I relayed it (blue)
 *       → my people are answering
 *       → the chain continued past me
 *
 * THE COLOUR IS THE ROLE, NOT THE SECTION. Amber has always meant "somebody is
 * waiting on you" and blue "you are waiting on them"; a merged card keeps that
 * mapping by carrying the colour itself and switching it the moment the reader
 * stops being the one who was asked and becomes the one who is asking.
 *
 * ZERO IO, pure, fully testable. Nothing here reads a side, and nothing here can
 * name somebody who passed: passers never enter `responders`, and a `Challenge`
 * only ever describes the reader's own row.
 */
import type { Challenge } from "@/domain/challenge";
import type { TableRow } from "@/lib/table.server";

/** Where the reader stands in this chain right now. */
export type ChainStage = "brought_in" | "showed_up" | "relayed";

/**
 * WHERE IT CAME FROM — two names, and never a tree.
 *
 * A diagram of a chain is a diagram; a sentence is a fact somebody can read in
 * the half-second they give a card. Both halves are independently absent, because
 * a chain one link long has no "through" and an unresolved root has no "started by".
 */
export interface Provenance {
  /** Who put the question up in the first place. */
  startedBy: string | null;
  /** Who brought the reader in. Null when that is the same person. */
  through: string | null;
  /**
   * WHO CARRIED IT PAST ME, and how many tables it is on because of them.
   *
   * Names only — these people spent one of their own three slots, which is a
   * public, deliberate act. Nobody who declined can appear here.
   */
  relayedBy: string[];
  relayTables: number;
}

export const EMPTY_PROVENANCE: Provenance = {
  startedBy: null,
  through: null,
  relayedBy: [],
  relayTables: 0,
};

export interface ChainCard {
  marketId: number;
  title: string | null;
  /** Amber while somebody is waiting on the reader; blue once they relayed it. */
  tone: "amber" | "blue";
  stage: ChainStage;
  /** The reader's own incoming row, when somebody brought them in. */
  incoming: Challenge | null;
  /** The reader's own Challenge, when they relayed it. */
  mine: TableRow | null;
  /** Still live in either direction — a queue item, not history. */
  live: boolean;
  /** Newest thing that happened on this card, for ordering. */
  atMs: number;
}

/**
 * ONE LIST, ONE CARD PER MARKET.
 *
 * NEVER TWO CARDS FOR THE SAME VIEWER AND MARKET, and the merge key is the
 * market precisely because that is the thing the reader recognises. A person who
 * was called in by Sundeep and then relayed to their own people is looking at ONE
 * question the whole way through.
 */
export function mergeChain(
  incoming: readonly Challenge[],
  table: readonly TableRow[],
): ChainCard[] {
  const byMarket = new Map<number, ChainCard>();

  const touch = (marketId: number, title: string | null): ChainCard => {
    const found = byMarket.get(marketId);
    if (found) {
      if (!found.title && title) found.title = title;
      return found;
    }
    const made: ChainCard = {
      marketId,
      title,
      tone: "amber",
      stage: "brought_in",
      incoming: null,
      mine: null,
      live: false,
      atMs: 0,
    };
    byMarket.set(marketId, made);
    return made;
  };

  for (const c of incoming) {
    const card = touch(c.marketId, c.title);
    // The strongest incoming row wins if two ever arrive: `composeChallenges`
    // already collapses callers to one card, so this is a guard rather than a path.
    if (!card.incoming || c.stateAtMs > card.incoming.stateAtMs) card.incoming = c;
    card.atMs = Math.max(card.atMs, c.stateAtMs);
  }
  for (const r of table) {
    const card = touch(r.marketId, r.title);
    if (!card.mine || r.createdAtMs > card.mine.createdAtMs) card.mine = r;
    card.atMs = Math.max(card.atMs, r.createdAtMs, r.closedAtMs ?? 0);
  }

  for (const card of byMarket.values()) {
    const relayed = card.mine != null;
    const answered = card.incoming?.state === "showed_up";
    card.stage = relayed ? "relayed" : answered ? "showed_up" : "brought_in";
    // THE COLOUR FOLLOWS THE ROLE. Relaying is the moment the reader stops being
    // the one who was asked, so it — and only it — turns the card blue.
    card.tone = relayed ? "blue" : "amber";
    card.live =
      card.incoming?.state === "waiting" || (card.mine != null && card.mine.closedAtMs == null);
  }

  return [...byMarket.values()].sort((a, b) => rank(a) - rank(b) || b.atMs - a.atMs);
}

/** Waiting on the reader first, then what they have up, then endings. */
function rank(c: ChainCard): number {
  if (c.incoming?.state === "waiting") return 0;
  if (c.mine && c.mine.closedAtMs == null) return 1;
  return 2;
}

/**
 * "Started by Maya · Reached you through Sundeep" — one line, and no diagram.
 *
 * When the person who started it is the person who brought you in there is only
 * one fact, so it prints one clause. A chain that cannot name its root says the
 * half it knows rather than inventing the other.
 */
export function provenanceLine(p: Provenance): string | null {
  const started = p.startedBy?.trim() || null;
  const through = p.through?.trim() || null;
  if (!started && !through) return null;
  if (!started) return `Reached you through ${through}`;
  if (!through || through === started) return `Started by ${started}`;
  return `Started by ${started} · Reached you through ${through}`;
}

/* ── The relay offer ─────────────────────────────────────────────────────── */

/**
 * THE HEADING AT THE EMOTIONAL PEAK.
 *
 * NEVER "PASS IT ON". `Pass` already means "not for me" in this product, and one
 * word cannot mean both declining and continuing.
 */
export const RELAY_TITLE = "Keep the chain moving";

/** What the button says. Absent when there is nobody left to ask. */
export function relayButtonLabel(reachable: number): string | null {
  if (reachable <= 0) return null;
  return `Challenge all ${reachable}`;
}

/**
 * WHAT IT COSTS, said plainly beside the button.
 *
 * Three is an editorial cap, not a balance, so this states what the act consumes
 * rather than what remains — no fraction to watch run down, no allowance.
 */
export const RELAY_COST = "Holds 1 of your 3 Challenge slots";
