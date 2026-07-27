/**
 * The data contract between the Conviction data layer and the client.
 *
 * The client renders these shapes and computes NOTHING. All belief math,
 * matching, confidence thresholds, ranking, aggregation and formatting happen
 * upstream (see conviction-contract.server.ts).
 *
 * Honesty is enforced by the shape: `matchPct: null` / `relationshipRead: null`
 * mean the data layer judged confidence insufficient. The UI must render the
 * empty state — never a faded or estimated number.
 */

export type ProfileState = "none" | "provisional" | "qualified";

export type Viewer = {
  address: string | null;
  profile: ProfileState;
  /** drives the "back N more beliefs" progression copy */
  beliefsBacked: number;
};

export type SideKey = "y" | "n";

export type Person = {
  /** deterministic neutral alias, or the person's real POV name */
  alias: string;
  avatarSeed: string;
  /** null unless confidence-qualified → no ring, no number */
  matchPct: number | null;
  /** preformatted, e.g. "$4,200 · 38 days" */
  positionLabel: string;
  avatarUrl?: string | null;
};

export type Perspective = {
  text: string;
  authorAlias: string;
  heldDays: number;
  statedAtEntry: boolean;
  /** supplied, never computed client-side */
  isTopVoice: boolean;
};

/** One independent perpetual instrument. Never derived from the other side. */
export type Side = {
  price: number;
  changePct: number;
  /** sparkline, independent — never mirrored */
  series: number[];
  believers: number;
  /** preformatted display, e.g. "$184K" */
  capital: string;
  /** viewer-relative, already ranked; [] when unqualified */
  people: Person[];
  moreFromTribe: number;
  perspective: Perspective | null;
};

export type Belief = {
  id: string;
  category: string;
  question: string;
  creatorAlias: string;
  openedAgo: string;
  y: Side;
  n: Side;
  /** the persistent line; null when unqualified */
  relationshipRead: string | null;
  history: {
    volumeToday: string;
    volumeChangePct: string;
    newBelievers: number;
    believerSplit: string;
    series: { y: number[]; n: number[] };
  };
  /** ranked upstream */
  believers: Array<Person & { side: SideKey }>;
  defense: Array<Perspective & { side: SideKey; relationship: string | null }>;
};

export type Position = {
  beliefId: string;
  question: string;
  side: SideKey;
  value: string;
  /** rendered NEUTRAL, never green/red */
  changeLabel: string;
  /** null unless qualified */
  socialContext: string | null;
};

export type RoomStory = {
  beliefId: string;
  marker: "tribe" | "attention" | "neutral";
  markerLabel: string;
  story: string;
  question: string;
  values: string;
  ago: string;
};

export type OnboardingBelief = { id: string; category: string; question: string };
