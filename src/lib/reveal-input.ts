/**
 * Assemble the Conviction Reveal engine input from the data a deck already holds.
 * Pure glue — it maps app shapes (believers, network people) into the neutral
 * signals the pure engine ranks. Both desktop and mobile call this, so the reveal
 * is identical on both.
 */
import type { ConvictionRevealInput, RevealFace, Side } from "@/domain/conviction-reveal";
import type { Believer } from "@/lib/evidence.functions";

type NetPerson = {
  wallet: string;
  displayName: string;
  avatarUrl: string | null;
  relationship: string;
};

const lc = (w: string) => w.toLowerCase();
const faceOf = (p: {
  wallet: string;
  name?: string;
  displayName?: string;
  avatarUrl: string | null;
}): RevealFace => ({
  name: p.displayName ?? p.name ?? "",
  avatarUrl: p.avatarUrl ?? null,
  wallet: p.wallet,
});

export function assembleRevealInput(args: {
  side: Side;
  marketId: number;
  believersYes: number;
  believersNo: number;
  /** Real holders on this market (from the evidence query), each with a side. */
  believers: Believer[];
  /** The viewer's network (from getNetwork), each with a relationship. */
  people: NetPerson[];
  /** The House's pick for this market, if it had a read. */
  housePredicted?: Side | "PASS" | null;
  surpriseStreak?: number;
  momentum?: "accelerating" | "shifted" | null;
  creatorName?: string | null;
}): ConvictionRevealInput {
  const side = args.side;
  const other: Side = side === "YES" ? "NO" : "YES";
  const bySide = new Map(args.believers.map((b) => [lc(b.wallet), b.side]));

  const believerFaces = args.believers.filter((b) => b.side === side).map(faceOf);
  const twinPerson = args.people.find(
    (p) => p.relationship === "twin" && bySide.get(lc(p.wallet)) === side,
  );
  const tribe = args.people
    .filter(
      (p) =>
        ["twin", "tribe"].includes(p.relationship) &&
        bySide.get(lc(p.wallet)) === side &&
        lc(p.wallet) !== (twinPerson ? lc(twinPerson.wallet) : ""),
    )
    .map(faceOf);
  const opps = args.people
    .filter(
      (p) => ["opp", "inverse"].includes(p.relationship) && bySide.get(lc(p.wallet)) === other,
    )
    .map(faceOf);

  const believersOnSide = side === "YES" ? args.believersYes : args.believersNo;

  return {
    side,
    seed: args.marketId,
    housePredicted: args.housePredicted ?? null,
    surpriseStreak: args.surpriseStreak ?? 0,
    believers: believersOnSide,
    firstBeliever: believersOnSide === 1,
    believerFaces,
    tribe,
    opps,
    twin: twinPerson ? faceOf(twinPerson) : null,
    momentum: args.momentum ?? null,
    creatorName: args.creatorName ?? null,
  };
}
