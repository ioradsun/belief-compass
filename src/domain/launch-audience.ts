/**
 * LAUNCH AUDIENCE — who should see this debate first, and why each of them.
 *
 * Measured against production: 71.2% of markets have zero participants and 2.3%
 * reach five. The workflow ends at "Market Created", which is where the
 * interesting part should begin — so this is the panel that turns publishing
 * into launching.
 *
 * THE SAME RULE AS THE SHELF, FROM THE OTHER END. `@/domain/for-you` refuses to
 * show a row it cannot justify; this refuses to OFFER a person it cannot
 * justify. Both refusals are the same sentence, composed once here and stored
 * on the invitation, so the recipient reads exactly what the sender saw. A
 * person with no reason is not a weaker suggestion — they are someone we have
 * no business putting in front of the creator, and they do not appear.
 *
 * EVERY ROW HAS A DESIGNED ZERO-STATE, because on this platform most of them
 * are empty most of the time and that is not a bug:
 *
 *   Adjacent   ≥1 for 22% of markets, ≥5 for 11%, max 43 — the only dense one
 *   Tribe      median 0, max 3; 11 of 242 wallets (5%) have any
 *   Rivals     0 for every wallet on the platform
 *   Category   crypto 162 · culture 118 · sports 101 · ai 91 — real, untargeted
 *   Followers  0 follow edges exist
 *
 * "No one yet" reads as honest. "0" reads as broken. The rows ship in that
 * order anyway: Adjacent is useful today, and the social rows grow into their
 * place as the graph fills rather than appearing from nowhere later.
 *
 * ZERO IO, pure, fully testable.
 */

export type AudienceKind = "adjacent" | "tribe" | "rival" | "category" | "follower";

/** One person the creator could invite, with the sentence that justifies it. */
export interface AudienceMember {
  wallet: string;
  /** Display name, or null when this person has never set one. */
  name: string | null;
  /** Why THIS person. Stored verbatim on the invitation — see market_invites. */
  reason: string;
  /** True once an invitation to this market from this creator already exists. */
  invited: boolean;
}

/** What each kind needs before it may name anybody. */
export type AudienceEvidence =
  | {
      kind: "adjacent";
      /** A market they hold a position in that resembles this one. */
      similarTitle: string;
      /** How many such markets. One is enough; more is a stronger sentence. */
      similarCount: number;
    }
  | {
      kind: "tribe";
      /** Conviction-weighted agreement, 0..100. */
      agreement: number | null;
      /** Markets the creator and this person have both taken a side in. */
      shared: number | null;
      /** Where they agree most, when one topic dominates. */
      topic: string | null;
    }
  | {
      kind: "rival";
      agreement: number | null;
      shared: number | null;
    }
  | {
      kind: "category";
      /** The category label, already resolved — never a raw slug. */
      label: string;
      /** Markets they have backed in it. */
      backed: number;
    }
  | { kind: "follower" };

export interface AudienceRow {
  kind: AudienceKind;
  /** The row heading. */
  label: string;
  /** One line saying what this group is, shown whether or not it has people. */
  blurb: string;
  people: AudienceMember[];
  /**
   * What to say when `people` is empty. Never "0" and never a generic
   * "nothing here" — each row is empty for its own reason, and saying which one
   * is the difference between an honest panel and a broken-looking one.
   */
  emptyState: string;
}

export const AUDIENCE = {
  /** Below this, "you usually agree" is a coincidence rather than a pattern. */
  minSharedForAgreement: 3,
  /** Agreement at or above this is worth calling agreement. */
  tribeAgreement: 60,
  /** Agreement at or below this is worth calling disagreement. */
  rivalAgreement: 40,
  /** Markets in a category before "they back this category" is a claim. */
  minCategoryBacked: 2,
  /** People offered per row. More is a mailing list, not a recruitment. */
  perRow: 8,
} as const;

const META: Record<AudienceKind, { label: string; blurb: string; empty: string }> = {
  adjacent: {
    label: "Adjacent",
    blurb: "People already backing questions like yours.",
    empty: "No one is in a similar market yet — yours may be the first of its kind.",
  },
  tribe: {
    label: "Your Tribe",
    blurb: "People you usually agree with.",
    empty: "Your Tribe forms as you take sides alongside other people.",
  },
  rival: {
    label: "Your Rivals",
    blurb: "People who usually take the other side.",
    empty: "No one disagrees with you consistently enough yet — that takes shared history.",
  },
  category: {
    label: "Category",
    blurb: "People active in this subject.",
    empty: "No one else has backed a market in this category recently.",
  },
  follower: {
    label: "Followers",
    blurb: "People who chose to hear from you.",
    empty: "No one follows you yet.",
  },
};

/**
 * ADJACENT FIRST, deliberately, and not because it sorts nicely. It is the only
 * audience with real density today, so leading with the social rows would open
 * the panel on three empty groups and teach the creator to close it.
 */
export const AUDIENCE_ORDER: readonly AudienceKind[] = [
  "adjacent",
  "tribe",
  "rival",
  "category",
  "follower",
] as const;

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "…" at 60 chars, so a long question does not swallow the sentence. */
function shortTitle(title: string): string {
  const t = title.trim().replace(/\s+/g, " ");
  return t.length <= 60 ? t : `${t.slice(0, 59)}…`;
}

/**
 * THE RULE. The sentence that justifies inviting this person, or null.
 *
 * Null is not a fallback path — it is a refusal, and the person disappears.
 * There is no default string anywhere in here for the same reason
 * `@/domain/for-you` has none: a reason everyone qualifies for is not a reason.
 */
export function reasonForMember(e: AudienceEvidence): string | null {
  switch (e.kind) {
    case "adjacent": {
      const title = e.similarTitle.trim();
      if (!title || e.similarCount < 1) return null;
      return e.similarCount === 1
        ? `Backed "${shortTitle(title)}"`
        : `Backed ${plural(e.similarCount, "similar market", "similar markets")}, including "${shortTitle(title)}"`;
    }

    case "tribe": {
      const shared = e.shared ?? 0;
      // Agreement without enough shared history is a number, not a relationship.
      if (e.agreement == null || shared < AUDIENCE.minSharedForAgreement) return null;
      if (e.agreement < AUDIENCE.tribeAgreement) return null;
      const base = `You agree ${Math.round(e.agreement)}% of the time across ${plural(shared, "market", "markets")}`;
      return e.topic ? `${base}, most of all on ${e.topic}` : base;
    }

    case "rival": {
      const shared = e.shared ?? 0;
      if (e.agreement == null || shared < AUDIENCE.minSharedForAgreement) return null;
      if (e.agreement > AUDIENCE.rivalAgreement) return null;
      return `You disagree ${Math.round(100 - e.agreement)}% of the time across ${plural(shared, "market", "markets")}`;
    }

    case "category": {
      const label = e.label.trim();
      if (!label || e.backed < AUDIENCE.minCategoryBacked) return null;
      return `Backed ${plural(e.backed, "market", "markets")} in ${label}`;
    }

    case "follower":
      // A follow is itself the reason, and the only one that needs no evidence
      // beyond its own existence: this person deliberately asked to hear from
      // the creator, which is a stronger statement than anything inferred.
      return "Follows you";
  }
}

/** A candidate before the rule has run on it. */
export interface AudienceCandidate {
  wallet: string;
  name: string | null;
  evidence: AudienceEvidence;
  invited?: boolean;
}

export interface ComposeAudienceOptions {
  /** The creator. Never offered their own market — they are already in it. */
  creator?: string;
  /** People already holding a position here. Recruiting them is a no-op. */
  alreadyIn?: ReadonlySet<string>;
  perRow?: number;
}

/**
 * Candidates → the five rows, in order, every one of them present.
 *
 * An empty row is RENDERED, not omitted. The creator learning that they have no
 * Rivals yet is information; a panel that silently shows three rows one day and
 * five the next is a panel nobody can form a model of.
 *
 * A person appears at most once across the whole panel, under their strongest
 * claim — the row order IS the strength order, so the first row that can
 * justify someone keeps them. Seeing the same face under two headings would
 * make the panel look longer than the audience actually is.
 */
export function composeAudience(
  candidates: readonly AudienceCandidate[],
  opts: ComposeAudienceOptions = {},
): AudienceRow[] {
  const creator = opts.creator?.toLowerCase() ?? null;
  const alreadyIn = opts.alreadyIn ?? new Set<string>();
  const perRow = opts.perRow ?? AUDIENCE.perRow;

  const byKind = new Map<AudienceKind, AudienceMember[]>(
    AUDIENCE_ORDER.map((k) => [k, [] as AudienceMember[]]),
  );
  const placed = new Set<string>();

  for (const kind of AUDIENCE_ORDER) {
    for (const c of candidates) {
      if (c.evidence.kind !== kind) continue;
      const wallet = c.wallet.toLowerCase();
      if (!wallet || wallet === creator) continue;
      if (alreadyIn.has(wallet) || placed.has(wallet)) continue;
      const reason = reasonForMember(c.evidence);
      if (!reason) continue;
      const list = byKind.get(kind)!;
      if (list.length >= perRow) continue;
      list.push({ wallet, name: c.name?.trim() || null, reason, invited: c.invited === true });
      placed.add(wallet);
    }
  }

  return AUDIENCE_ORDER.map((kind) => ({
    kind,
    label: META[kind].label,
    blurb: META[kind].blurb,
    people: byKind.get(kind)!,
    emptyState: META[kind].empty,
  }));
}

/* ── Launch Progress ─────────────────────────────────────────────────────── */

/**
 * OUTCOMES, NOT EFFORT.
 *
 * Invitations sent is not an achievement — it is a measure of how hard the
 * creator worked, and a panel that celebrates it is congratulating someone for
 * pressing a button. The ladder is what actually happened to the debate, and
 * "Invited" appears only as the denominator the other rungs are read against.
 */
export interface LaunchProgress {
  invited: number;
  viewed: number;
  /** Took a side here, by any signal. */
  joined: number;
  /** Holds a directional position — money, not a tap. */
  backed: number;
  /** Directional believers in the room, from the read model. */
  participants: number;
}

export interface ProgressStep {
  label: string;
  value: number;
  /** What this number is out of, when there is a meaningful denominator. */
  of: number | null;
  reached: boolean;
  /** The sentence under the step. Always says what the number MEANS. */
  detail: string;
}

/** Five participants is the threshold a market becomes a conversation at. */
export const CONVERSATION_SIZE = 5;

/**
 * The ladder, as steps a creator can read.
 *
 * Deliberately honest about the difference between joined and backed: taking a
 * side costs nothing and holding one costs money, and collapsing them would let
 * a market look alive when nobody had committed anything.
 */
export function launchLadder(p: LaunchProgress): ProgressStep[] {
  return [
    {
      label: "Viewed",
      value: p.viewed,
      of: p.invited || null,
      reached: p.viewed > 0,
      detail:
        p.invited === 0
          ? "Nobody has been invited yet."
          : `${p.viewed} of ${p.invited} invited ${p.viewed === 1 ? "person has" : "people have"} seen it.`,
    },
    {
      label: "Joined",
      value: p.joined,
      of: p.invited || null,
      reached: p.joined > 0,
      detail:
        p.joined === 0 ? "No one has taken a side yet." : `${p.joined} took a side after arriving.`,
    },
    {
      label: "Backed",
      value: p.backed,
      of: p.joined || null,
      reached: p.backed > 0,
      detail:
        p.backed === 0 ? "No one has committed money yet." : `${p.backed} put money behind a side.`,
    },
    {
      label: `Reached ${CONVERSATION_SIZE}`,
      value: p.participants,
      of: CONVERSATION_SIZE,
      reached: p.participants >= CONVERSATION_SIZE,
      // An empty room is told, never counted. "0 of 5 believers" is the bare
      // zero this whole module exists to avoid — it reads as a scoreboard the
      // creator is losing, when the true statement is that nobody has arrived.
      detail:
        p.participants >= CONVERSATION_SIZE
          ? `${p.participants} believers — this is a conversation.`
          : p.participants === 0
            ? `Nobody has taken a side here yet. Only 2.3% of markets reach ${CONVERSATION_SIZE}.`
            : `${p.participants} of ${CONVERSATION_SIZE} believers. Most markets never get here.`,
    },
  ];
}
