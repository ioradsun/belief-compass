/**
 * FOR YOU — one rule, and it is the only one.
 *
 *   A row may appear only if the system can state why THIS person.
 *
 * "You and Sarah usually agree on AI." "You backed 3 similar markets." "A Rival
 * took the other side of one of yours." "Two people in your Tribe joined." All
 * of those are reasons. "New market" is not — it is true of every market for
 * everybody, and a shelf that shows it has quietly become the live tape with a
 * more flattering title.
 *
 * SO THE REASON IS NOT DECORATION, IT IS THE ADMISSION TICKET. `reasonFor`
 * returns `null` when the evidence for a candidate is missing or too thin to
 * say anything specific, and `composeForYou` drops every candidate that has no
 * sentence. There is deliberately no fallback string: a default reason would
 * make the gate unfalsifiable, because everything would pass it.
 *
 * WHY THE SHELF MATTERS MORE THAN IT LOOKS. This platform has no notification
 * channel of any kind — no email, no push, no service worker, no inbox. An
 * invitation is a stored row someone finds next time they look, which makes
 * this shelf the ENTIRE delivery mechanism for every person-to-person signal
 * the product has. If it degrades into "here is what's new", nothing else picks
 * up the slack.
 *
 * ZERO IO, pure, fully testable.
 */

export type ForYouKind = "invited" | "tribe" | "rival" | "similar" | "followed";

/** How strongly a kind speaks. A person naming you outranks a computed match. */
const KIND_RANK: Record<ForYouKind, number> = {
  invited: 5,
  rival: 4,
  tribe: 3,
  followed: 2,
  similar: 1,
};

/** A person named in a reason. Anonymous people are counted, never named. */
export interface NamedPerson {
  wallet: string;
  /** Display name, or null when this person has never set one. */
  name: string | null;
}

/**
 * Everything the shelf could possibly show, before the rule runs.
 *
 * Each kind carries ONLY the evidence its sentence needs. A candidate that
 * arrives without that evidence is not a weaker row — it is a row that cannot
 * be justified, and it does not appear.
 */
export type ForYouCandidate =
  | {
      kind: "invited";
      marketId: number;
      title: string;
      atMs: number;
      /** Composed at send time and stored — see the market_invites migration. */
      reason: string;
      /** Everyone who invited them to this market. */
      from: NamedPerson[];
    }
  | {
      kind: "tribe";
      marketId: number;
      title: string;
      atMs: number;
      /** People in the viewer's Tribe who have taken a side here. */
      people: NamedPerson[];
      /** Shared topic, when one dominates. Sharpens the sentence; never required. */
      topic: string | null;
    }
  | {
      kind: "rival";
      marketId: number;
      title: string;
      atMs: number;
      /** People the viewer usually disagrees with who took the OTHER side. */
      people: NamedPerson[];
      /** The side the viewer holds here, which is what makes it a challenge. */
      viewerSide: "YES" | "NO" | null;
    }
  | {
      kind: "followed";
      marketId: number;
      title: string;
      atMs: number;
      /** People the viewer follows who created or took a side here. */
      people: NamedPerson[];
    }
  | {
      kind: "similar";
      marketId: number;
      title: string;
      atMs: number;
      /** How many markets the viewer has backed that this one resembles. */
      backedSimilar: number;
    };

export interface ForYouRow {
  marketId: number;
  title: string;
  kind: ForYouKind;
  /** Why THIS person. Never empty — a row without one does not exist. */
  reason: string;
  atMs: number;
}

export const FOR_YOU = {
  /** One person is a coincidence; the sentence needs at least this many. */
  minPeople: 1,
  /**
   * Below this, "you backed similar markets" is a claim about one market, and a
   * single overlap is the weakest evidence on the shelf. Two is a pattern.
   */
  minSimilar: 2,
  /** Named people in one sentence before the rest become "+N more". */
  maxNamed: 2,
  /** Rows on the shelf. Beyond this it is a feed, and the feed already exists. */
  maxRows: 6,
} as const;

/** "Sarah", "Sarah and Ana", "Sarah, Ana and 3 others". */
function nameList(people: readonly NamedPerson[]): string | null {
  const named = people.map((p) => p.name?.trim()).filter((n): n is string => !!n);

  // Nobody has a name: the sentence still works as a count, because "2 people in
  // your Tribe took sides here" is a reason about the viewer even when none of
  // them has introduced themselves. Once ANYONE has a name, leading with it
  // beats leading with a tally, so the unnamed fold into "+N others".
  if (named.length === 0) {
    if (people.length === 0) return null;
    return `${people.length} ${people.length === 1 ? "person" : "people"}`;
  }

  const shown = named.slice(0, FOR_YOU.maxNamed);
  const rest = people.length - shown.length;
  const head = shown.length === 1 ? shown[0] : `${shown[0]} and ${shown[1]}`;
  return rest <= 0 ? head : `${head} and ${rest} ${rest === 1 ? "other" : "others"}`;
}

/**
 * THE RULE. A sentence, or null when this candidate cannot justify itself.
 *
 * Every branch either produces something specific to the viewer or refuses.
 * There is no `?? "New market"` anywhere in here, and adding one would delete
 * the feature.
 */
export function reasonFor(c: ForYouCandidate): string | null {
  switch (c.kind) {
    case "invited": {
      // The stored sentence is authoritative — it is what the sender saw when
      // they chose this person, and rewriting it now would make the invitation
      // say something they never said.
      const reason = c.reason.trim();
      if (!reason) return null;
      const who = nameList(c.from);
      return who ? `${who} invited you · ${reason}` : `You were invited · ${reason}`;
    }

    case "tribe": {
      if (c.people.length < FOR_YOU.minPeople) return null;
      const who = nameList(c.people);
      if (!who) return null;
      const verb = c.people.length === 1 ? "took a side" : "took sides";
      return c.topic
        ? `${who} from your Tribe ${verb} here — you usually agree on ${c.topic}`
        : `${who} from your Tribe ${verb} here`;
    }

    case "rival": {
      if (c.people.length < FOR_YOU.minPeople) return null;
      const who = nameList(c.people);
      if (!who) return null;
      // Without a side of the viewer's own this is not a challenge, it is just
      // someone with an opinion — which is not a reason about THIS person.
      if (!c.viewerSide) return null;
      return `${who} you usually disagree with took the other side of your ${c.viewerSide}`;
    }

    case "followed": {
      if (c.people.length < FOR_YOU.minPeople) return null;
      const who = nameList(c.people);
      if (!who) return null;
      return `${who} you follow ${c.people.length === 1 ? "is" : "are"} here`;
    }

    case "similar": {
      if (!Number.isFinite(c.backedSimilar) || c.backedSimilar < FOR_YOU.minSimilar) return null;
      return `You backed ${c.backedSimilar} markets like this one`;
    }
  }
}

export interface ComposeOptions {
  /** Markets the viewer already holds a position in — never recommend those. */
  alreadyIn?: ReadonlySet<number>;
  max?: number;
}

/**
 * Candidates → the shelf.
 *
 * Drops anything that cannot say why, then keeps the STRONGEST reason per
 * market: a market someone personally invited you to should not also appear as
 * "you backed 3 similar markets", and one line about a market is a shelf while
 * three is a nag.
 *
 * Ordering is kind first, then recency. A person naming you outranks a computed
 * match no matter how recent the computation, because the shelf's promise is
 * that everything on it is about you specifically, and an invitation is the
 * least arguable version of that.
 */
export function composeForYou(
  candidates: readonly ForYouCandidate[],
  opts: ComposeOptions = {},
): ForYouRow[] {
  const alreadyIn = opts.alreadyIn ?? new Set<number>();
  const best = new Map<number, ForYouRow>();

  for (const c of candidates) {
    if (alreadyIn.has(c.marketId)) continue;
    const reason = reasonFor(c);
    if (!reason) continue;
    const row: ForYouRow = {
      marketId: c.marketId,
      title: c.title,
      kind: c.kind,
      reason,
      atMs: c.atMs,
    };
    const prev = best.get(c.marketId);
    if (
      !prev ||
      KIND_RANK[row.kind] > KIND_RANK[prev.kind] ||
      (KIND_RANK[row.kind] === KIND_RANK[prev.kind] && row.atMs > prev.atMs)
    ) {
      best.set(c.marketId, row);
    }
  }

  return [...best.values()]
    .sort(
      (a, b) => KIND_RANK[b.kind] - KIND_RANK[a.kind] || b.atMs - a.atMs || a.marketId - b.marketId,
    )
    .slice(0, opts.max ?? FOR_YOU.maxRows);
}
