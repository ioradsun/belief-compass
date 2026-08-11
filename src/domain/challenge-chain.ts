/**
 * HOW A BELIEF TRAVELLED THROUGH PEOPLE — one question, answered three ways.
 *
 * THE SCREEN THIS SERVES IS DELIBERATELY SMALL. It is not a graph explorer and
 * must never become one: no node canvas, no zoom, no force-directed anything.
 * Three sections, in this order, because it is the order a person cares about:
 *
 *   HOW IT REACHED YOU   identity and provenance. People, not pointers.
 *   YOUR BRANCH          the part you caused.
 *   THE WHOLE CHAIN      social proof, in aggregate.
 *
 * UNKNOWN ANCESTRY IS NOT A ROOT, and this is the invariant the whole module is
 * built around. If the walk reaches Maya and cannot prove what came before her,
 * the honest sentence is "… → Maya → Sundeep → You · Earlier links unavailable".
 * It is NOT "Started by Maya". Naming a root the data cannot support would
 * credit the wrong person with originating a question, permanently, on a screen
 * whose entire subject is who started what.
 *
 * It is the same rule this codebase now enforces in four other places — a
 * post-trade balance is `null` rather than zero, a refused audience is `failed`
 * rather than `none`, a market with no indexed resolution is not "closed" — and
 * it is the same sentence every time: ABSENCE OF EVIDENCE IS NOT EVIDENCE OF
 * ABSENCE.
 *
 * THE PRIVACY BOUNDARY IS STRUCTURAL, NOT EDITORIAL. The projection simply has
 * nowhere to put the names this view must not show. There is no field for
 * "people waiting in somebody else's branch", no field for passers, and no field
 * for eligible-but-unasked recipients — so a future component cannot render them
 * by accident, and a future reader cannot be asked to fetch them "just for the
 * aggregate". The walk stops carrying names the moment it leaves the viewer's
 * own branch.
 *
 * ZERO IO, pure, fully testable.
 */
import type { Side } from "@/domain/post-action";
import type { CardPerson, CardResponder } from "@/domain/challenge-card";

/**
 * ONE STEP OF THE ROUTE THAT REACHED THE VIEWER.
 *
 * Every person on this path publicly put a question up or publicly asked
 * somebody — both deliberate acts. Nobody appears here for having been asked.
 */
export interface ChainLink {
  person: CardPerson;
  /** What they held when they asked. Null when they held no side. */
  side: Side | null;
}

export interface UpstreamPath {
  /** Earliest provable ancestor first; the viewer is NOT included. */
  path: ChainLink[];
  /**
   * How many links the route is, counting the viewer. Derived from `path`, so
   * it cannot disagree with what is rendered above it.
   */
  depth: number;
  /**
   * THE WALK COULD NOT PROVE THE WHOLE ROUTE.
   *
   * True when it hit its bound, found a cycle, lost an ancestor, or crossed a
   * market boundary. The first name in `path` is then the earliest link that
   * could be VERIFIED — never a root — and the view must say so.
   */
  truncated: boolean;
}

/**
 * THE PART THE VIEWER CAUSED, and the only place names are shown below them.
 *
 * `responders` are named because they took a public on-chain position. Everybody
 * else is a count: waiting people did not choose to be visible, and passers are
 * never named anywhere, by a rule older than this file.
 */
export interface ViewerBranch {
  /** Recipient opportunities on this branch. Never described as people. */
  reached: number;
  showedUp: number;
  passed: number;
  waiting: number;
  responders: CardResponder[];
  /** People who deliberately carried it on from here. */
  relayers: CardPerson[];
}

/**
 * EVERYTHING BEYOND THE VIEWER'S BRANCH, AS NUMBERS ONLY.
 *
 * Three counts with three different meanings, and the third is the one that
 * invites a lie. `recipientOpportunities` counts call ROWS; once a chain forks,
 * the same person can hold two of them. It is rendered secondary and never
 * described as people — "42 people joined" from a number that means 42 rows is
 * the specific sentence this shape exists to make unwriteable.
 */
export interface WholeChain {
  /** Unique wallets that actually answered, anywhere in the chain. */
  uniqueResponders: number;
  /** Unique wallets that deliberately relayed, anywhere in the chain. */
  uniqueRelayers: number;
  /** Call rows created across every branch. Opportunities, not humans. */
  recipientOpportunities: number;
  /**
   * The aggregate could not be completed — a bounded read, or a branch whose
   * ancestry did not verify. The counts are then a FLOOR, and the view says so
   * rather than presenting a partial sweep as a total.
   */
  partial: boolean;
}

export interface ChallengeChainProjection {
  marketId: number;
  question: string;
  upstream: UpstreamPath;
  /** Null when the viewer never put this question up. */
  viewerBranch: ViewerBranch | null;
  wholeChain: WholeChain;
}

/* ── Copy. Restrained on purpose; rotation is a later phase. ──────────────── */

export const CHAIN_TITLE = "Challenge chain";
export const UPSTREAM_TITLE = "How it reached you";
export const BRANCH_TITLE = "Your branch";
export const WHOLE_TITLE = "The whole chain";

/**
 * "Earlier links unavailable" — the sentence that replaces an invented root.
 *
 * Deliberately flat. It is not an error the reader can act on and not a fault
 * worth apologising for; it is the boundary of what the ledger can prove, said
 * once and quietly.
 */
export const TRUNCATED_NOTE = "Earlier links unavailable";

/**
 * "3 links deep" — and "at least 3 links deep" when the route was truncated.
 *
 * FOUND BY RENDERING IT. Beside a route that begins with an ellipsis, a bare
 * "3 links deep" is a count of something the walk explicitly could not finish
 * counting: the honest value is a FLOOR. The ellipsis and the note beside it
 * carry the caveat visually, but the number was still making a claim of its own
 * one line below them.
 *
 * It is the same rule as everywhere else in this system — an unfinished read
 * reports what it can prove and says that is a minimum. Absent for a direct
 * call, because "1 link deep" is a sentence nobody needs about being asked by
 * one person.
 */
export function depthLine(u: UpstreamPath): string | null {
  if (u.depth < 2) return null;
  return u.truncated ? `at least ${u.depth} links deep` : `${u.depth} links deep`;
}

/**
 * THE ROUTE AS PEOPLE — "Maya → Sundeep → You", with a leading ellipsis when
 * the beginning could not be proved.
 *
 * The viewer's own name is supplied rather than assumed, so this can render
 * "You" on their screen without the domain knowing anything about identity.
 */
export function routeNames(u: UpstreamPath, viewerLabel = "You"): string[] {
  const names = u.path.map((l) => l.person.name.trim()).filter(Boolean);
  return [...(u.truncated ? ["…"] : []), ...names, viewerLabel];
}

/**
 * WHO STARTED IT — and null the moment that cannot be proved.
 *
 * This is the function the whole module exists to constrain. A truncated walk
 * has no root to report, and returning the earliest verified link instead would
 * be exactly the lie: the reader has no way to tell "Maya started this" from
 * "Maya is as far back as we could see".
 */
export function startedBy(u: UpstreamPath): string | null {
  if (u.truncated) return null;
  const first = u.path[0]?.person.name.trim();
  return first ? first : null;
}

/** "Maya brought you in" — the direct parent, which is always provable. */
export function broughtYouIn(u: UpstreamPath): string | null {
  const last = u.path[u.path.length - 1]?.person.name.trim();
  return last ? `${last} brought you in` : null;
}

/** "2 of 9 showed up · 7 still deciding · 1 person kept it moving". */
export function branchLines(b: ViewerBranch): string[] {
  const out: string[] = [];
  if (b.reached > 0) out.push(`${b.showedUp} of ${b.reached} showed up`);
  if (b.waiting > 0) out.push(`${b.waiting} still deciding`);
  /**
   * A PASSER IS COUNTED AND NEVER NAMED, and the count appears only once
   * somebody has actually passed — a standing "0 passed" invites the reader to
   * watch a rejection counter that is usually empty.
   */
  if (b.passed > 0) out.push(`${b.passed} passed`);
  if (b.relayers.length > 0)
    out.push(
      `${b.relayers.length} ${b.relayers.length === 1 ? "person" : "people"} kept it moving`,
    );
  return out;
}

/** The two whole-chain lines that are about humans. */
export function wholeChainLines(w: WholeChain): string[] {
  const out: string[] = [];
  if (w.uniqueResponders > 0)
    out.push(`${w.uniqueResponders} ${w.uniqueResponders === 1 ? "person" : "people"} showed up`);
  if (w.uniqueRelayers > 0)
    out.push(`${w.uniqueRelayers} ${w.uniqueRelayers === 1 ? "person" : "people"} kept it moving`);
  return out;
}

/**
 * THE THIRD LINE, AND THE REASON IT IS ITS OWN FUNCTION.
 *
 * It says "recipient opportunities", not people, because that is what the number
 * is. Kept separate from `wholeChainLines` so a caller renders it in the
 * secondary style deliberately rather than folding it in with two sentences that
 * ARE about humans.
 */
export function opportunitiesLine(w: WholeChain): string | null {
  if (w.recipientOpportunities <= 0) return null;
  const n = w.recipientOpportunities;
  return `${n} recipient ${n === 1 ? "opportunity was" : "opportunities were"} created`;
}

/** "Counted so far" — an aggregate that could not be completed is a floor. */
export const PARTIAL_NOTE = "Counted so far";

/**
 * WORDS THIS VIEW MUST NEVER USE.
 *
 * The graph words describe a data structure rather than people who answered a
 * question — and this is the one screen most likely to slide into them, because
 * the underlying thing genuinely is a tree. `viewed` and `seen` are here because
 * a chain that reported who LOOKED would turn provenance into surveillance,
 * which is the failure mode the privacy boundary exists to prevent.
 */
export const CHAIN_BANNED_WORDS: readonly string[] = [
  "node",
  "parent",
  "root",
  "edge",
  "graph",
  "traversal",
  "depth-first",
  "viewed",
  "seen by",
  "joined",
  "members",
  "passed on you",
];

/** Everything a fully-rendered chain can say, for the banned-word gate. */
export function chainVocabulary(p: ChallengeChainProjection, viewerLabel = "You"): string {
  return [
    CHAIN_TITLE,
    UPSTREAM_TITLE,
    BRANCH_TITLE,
    WHOLE_TITLE,
    routeNames(p.upstream, viewerLabel).join(" → "),
    depthLine(p.upstream),
    p.upstream.truncated ? TRUNCATED_NOTE : null,
    broughtYouIn(p.upstream),
    ...(p.viewerBranch ? branchLines(p.viewerBranch) : []),
    ...wholeChainLines(p.wholeChain),
    opportunitiesLine(p.wholeChain),
    p.wholeChain.partial ? PARTIAL_NOTE : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
