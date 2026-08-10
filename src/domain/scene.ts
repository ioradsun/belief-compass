/**
 * ONE WORLD, MANY POINTS OF VIEW — the model behind /lab-9f3c7a21b4.
 *
 * SCENARIO = FACTS. ROLE = POINT OF VIEW. There is no separate fixture for
 * "Challenger Sarah" and "Challenged Mike" when they are describing the same
 * event: there is one `World` saying what happened, and every surface derives its
 * view from it. Two fixtures would let the two sides drift, and drifting sides are
 * exactly the bug this page exists to catch.
 *
 * THE ORACLE, and it is the reason this is a domain module rather than a page.
 * Eyeballing two panels side by side catches a disagreement only if somebody
 * happens to look at the right pair at the right moment. `checkWorld` instead
 * COMPUTES the agreement: it derives what each participant is told, then asserts
 * the invariants across those derivations. If Sarah is told "Mike showed up" while
 * Mike still has an open card, that is a failing check with a name, not a thing a
 * reviewer might notice.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: invent copy. Every sentence on the page comes
 * from the real modules — `progressLine`, `tableLine`, `callLine`, `convictionMatch`,
 * `recipientState`. A scene that wrote its own strings would be a mockup of what
 * the product might say, and would keep passing after the product stopped saying
 * it.
 *
 * ZERO IO, pure, fully testable — including the checker, which has its own tests
 * proving it FAILS on worlds that are genuinely inconsistent. A green oracle that
 * cannot go red is worse than no oracle.
 */
import { mergeChain } from "@/domain/chain";
import { convictionMatch } from "@/domain/relationship";
import { recipientState, tableProgress, progressLine, tableLine } from "@/domain/table";
import type { RecipientFact, RecipientState } from "@/domain/table";
import { callLine } from "@/domain/call-line";
import type { CallerRelation, Challenge, ChallengeState } from "@/domain/challenge";
import type { TableRow } from "@/lib/table.server";

/** Whose eyes the page is looking through. */
export type Role = "challenger" | "challenged" | "bystander";

export const ROLES: readonly Role[] = ["challenger", "challenged", "bystander"];

/** One person in the world, and what they did about the Challenge. */
export interface Participant {
  name: string;
  wallet: string;
  relation: CallerRelation;
  /** The pair's record with the CHALLENGER — what Conviction Match reads. */
  together: number;
  shared: number;
  /** What they did. `open` means they have not answered. */
  state: RecipientState;
  /**
   * WHICH WAY THEY WENT WHEN THEY ANSWERED. Declared, never derived.
   *
   * Only meaningful for `showed_up`. Absent means the card prints no side — the
   * honest rendering of a row stamped before the side was kept, and a state the
   * lab must be able to show because production is full of them.
   */
  side?: "YES" | "NO" | null;
  /**
   * PRIOR ANSWERED CHALLENGES BETWEEN THIS PAIR — the reciprocity run.
   *
   * A declared fact of the scenario, exactly like `together`/`shared` beside it,
   * and it belongs to the pair rather than to this one question. **0 means the
   * card says nothing**, which is the common case and the default: a run is the
   * rarest thing on this surface and inventing one everywhere would make the lab
   * flatter every relationship in it.
   */
  run: number;
}

/**
 * EVERYTHING THAT HAPPENED. No view, no formatting, no perspective — the facts a
 * role is then applied to.
 */
export interface World {
  question: string;
  /** Who put it on the table, and what they hold. */
  challenger: { name: string; wallet: string; side: "YES" | "NO" | null };
  /** Everybody it reached, frozen at the moment it went up. */
  audience: Participant[];
  /** How many things the challenger has up right now, including this one. */
  activeChallenges: number;
  /** Closed already, and why. */
  closed: null | "creator" | "all_responded";
}

const facts = (p: Participant): RecipientFact => ({
  respondedAtMs: p.state === "showed_up" ? 1 : null,
  passedAtMs: p.state === "passed" ? 1 : null,
});

/** What the person who put it up is told. Aggregate only, by design. */
export interface ChallengerView {
  question: string;
  capacity: string | null;
  progress: string | null;
  /** True when every recipient is terminal — the auto-close trigger. */
  shouldClose: boolean;
  reached: number;
  showedUp: number;
  passed: number;
}

export function challengerView(w: World): ChallengerView {
  const p = tableProgress(w.audience.map(facts));
  return {
    question: w.question,
    capacity: tableLine(w.activeChallenges),
    progress: progressLine(p),
    shouldClose: p.allResponded,
    reached: p.reached,
    showedUp: p.showedUp,
    passed: p.passed,
  };
}

/** What one recipient is told — or null when the card is no longer theirs to see. */
export interface ChallengedView {
  name: string;
  badge: "Tribe" | "Rival";
  question: string;
  /** The real sentence, from the real composer. */
  line: string | null;
  match: number | null;
  together: number;
  shared: number;
  /** Whether anybody is still waiting on this person. */
  inQueue: boolean;
  /**
   * WHAT THE CARD SAYS NOW.
   *
   * `inQueue` used to be the whole answer, because an answered card was deleted.
   * It is not deleted any more — it transforms and goes quiet — so the lab needs
   * both facts: whether this person still owes an answer, and what their card
   * currently reads as. A world where those two disagree is a world where the
   * queue is counting outcomes, which is the failure `checkWorld` looks for.
   */
  state: ChallengeState;
}

/**
 * BADGE, not label. Twin renders Tribe and Opp renders Rival, because those two
 * words are withheld from every surface while the evidence for them is this thin.
 */
const BADGE: Record<CallerRelation, "Tribe" | "Rival"> = {
  twin: "Tribe",
  tribe: "Tribe",
  opp: "Rival",
  inverse: "Rival",
};

export function challengedView(w: World, who: Participant): ChallengedView {
  return {
    name: who.name,
    badge: BADGE[who.relation],
    question: w.question,
    // The real composer, with the real refusals. A caller with no side gets the
    // sentence that needs none rather than the row vanishing.
    line: callLine({
      name: w.challenger.name,
      act: w.challenger.side ? "trade" : "market_created",
      side: w.challenger.side,
      marketId: 1,
      callerWallet: w.challenger.wallet,
    }),
    match: convictionMatch(who.together, who.shared),
    together: who.together,
    shared: who.shared,
    // ANSWERED AND PASSED ARE BOTH TERMINAL — nobody is waiting on this person any
    // more, and the closed Challenge takes everyone with it.
    inQueue: w.closed == null && who.state !== "showed_up" && who.state !== "passed",
    // The recipient's own three states. `viewed` collapses into `waiting`, which
    // is the whole point of it: a glance is not an answer, so the card still reads
    // as a question.
    state: who.state === "showed_up" ? "showed_up" : who.state === "passed" ? "passed" : "waiting",
  };
}

/**
 * THE WORLD, IN THE SHAPES THE REAL COMPONENTS ASK FOR.
 *
 * These two functions are the whole reason /lab-9f3c7a21b4 can claim to be a camera
 * rather than a mockup: the page does not build cards, it builds `TableRow[]` and
 * `Challenge[]` — the exact payloads `getTable` and `getChallenges` return — and
 * hands them to the shipped components. They live here rather than in the route so
 * they can be tested without a DOM, and so a change to either payload breaks a type
 * check instead of a page nobody happened to open.
 */
export function tableRowsFor(w: World, now = 0): TableRow[] {
  // A CLOSED CHALLENGE STILL HAS A ROW. It is the only way its author ever learns
  // what happened, so `closed` changes the row's state rather than removing it —
  // which is exactly the bug this models: `tableFor` used to drop it.
  const first: TableRow = {
    id: 1,
    marketId: 1,
    title: w.question,
    createdAtMs: now,
    recipients: w.audience.map(facts),
    closedAtMs: w.closed ? now : null,
    closeReason: w.closed,
    /**
     * WHO TURNED UP, NAMED — and the side comes from the scenario, not from a
     * guess. `showed_up` participants are the only ones here: a passer must not
     * be nameable on the creator's card, and the fixture is where that would be
     * easiest to get wrong.
     */
    responders: w.audience
      .filter((p) => p.state === "showed_up")
      .map((p) => ({ name: p.name, side: p.side ?? null })),
  };
  if (w.activeChallenges <= 0) return w.closed ? [first] : [];
  return [
    first,
    // The rest exist only to reach the capacity the scene asked for. The first row
    // is the one with a story; these are what a full table looks like around it.
    ...Array.from({ length: w.activeChallenges - 1 }, (_, i) => ({
      id: i + 2,
      marketId: i + 2,
      title: `Another question already on the table (${i + 2})`,
      createdAtMs: now,
      recipients: [],
      closedAtMs: null,
      closeReason: null,
      responders: [],
    })),
  ];
}

/**
 * The incoming side of the SAME event — one card per person still holding it.
 *
 * A CARD WITHOUT A SENTENCE IS NOT A CARD. `callLine` returning null is the
 * product's own refusal, and the lab honours it by dropping the row rather than
 * shipping an empty `reason`, because a fixture that manufactured a fallback would
 * make the gate unfalsifiable here in exactly the way it is not in the app.
 */
export function challengesFor(w: World, now = 0): Challenge[] {
  const out: Challenge[] = [];
  for (const p of w.audience) {
    const v = challengedView(w, p);
    if (v.line == null) continue;
    /**
     * A CARD THE READER HAS ANSWERED IS STILL THEIR CARD.
     *
     * This used to require `inQueue` and drop everything else, which modelled the
     * old behaviour exactly: an answer deleted the row. The row now survives its
     * own ending — quieter, with no × and no prompt — so the fixture emits it, and
     * the lab can show both halves of one interaction on one screen.
     *
     * A CLOSED Challenge still takes its cards with it: the creator took the
     * question down, so there is nothing on anyone's rail to be quiet about.
     */
    if (w.closed != null) continue;
    out.push({
      marketId: 100 + out.length,
      title: w.question,
      caller: { wallet: w.challenger.wallet, name: w.challenger.name },
      relation: p.relation,
      callerSide: w.challenger.side,
      together: p.together,
      shared: p.shared,
      reason: v.line,
      atMs: now,
      state: v.state,
      stateAtMs: now,
      /**
       * THE RUN IS A DECLARED FACT, LIKE THE SHARED RECORD BESIDE IT.
       *
       * This briefly said a `World` could not carry one, on the grounds that it
       * describes a single question and holds no prior history. That was wrong on
       * its own terms: `together` and `shared` ARE prior history between the same
       * pair, declared by the same fixture, and rendered on the same card as
       * Conviction Match. A run is no more invented than they are.
       *
       * It matters because it was the one shipped element with no visual coverage
       * anywhere — a line nobody had ever seen render. `checkWorld` now holds the
       * rule that made the earlier instinct right: a card may not show a run the
       * scenario did not declare.
       */
      reciprocity: p.run > 0 ? { run: p.run, bothWays: true, endedRun: 0 } : null,
    });
  }
  return out;
}

/** One invariant, evaluated against this world. */
export interface Check {
  name: string;
  ok: boolean;
  /** Why, in the language of the product rather than of the code. */
  detail: string;
}

/**
 * DOES EVERY SIDE OF THE STORY AGREE?
 *
 * Each check is a sentence the product says out loud somewhere, evaluated against
 * the derived views rather than against the raw facts — so a formatting change
 * that breaks the agreement fails here even though the underlying world is fine.
 */
export function checkWorld(w: World): Check[] {
  const mine = challengerView(w);
  const views = w.audience.map((p) => ({ p, v: challengedView(w, p) }));
  const out: Check[] = [];

  // 1 · The count the creator sees must equal the people who actually answered.
  const reallyShowed = w.audience.filter((p) => p.state === "showed_up").length;
  out.push({
    name: "Showed-up count matches who answered",
    ok: mine.showedUp === reallyShowed,
    detail: `creator is told ${mine.showedUp}; ${reallyShowed} actually took a side`,
  });

  // 2 · Nobody who showed up is still being waited on — and their card is still
  //     there, saying so. Both halves matter: the first was the original bug (an
  //     answered card that keeps asking), the second is the one that replaced it
  //     (an answered card deleted at the moment it became worth showing).
  const stuck = views.filter(({ p, v }) => p.state === "showed_up" && v.inQueue);
  const answered = w.audience.filter((p) => p.state === "showed_up").length;
  const kept = challengesFor(w).filter((c) => c.state === "showed_up").length;
  out.push({
    name: "An answered card stops asking, and stays",
    ok: stuck.length === 0 && (w.closed != null || kept === answered),
    detail: stuck.length
      ? `${stuck.map(({ p }) => p.name).join(", ")} answered but the card is still asking`
      : w.closed != null
        ? "the Challenge is closed, so nobody's rail is still holding it"
        : `${kept} of ${answered} answered cards survive as outcomes rather than vanishing`,
  });

  // 3 · A pass is terminal for the recipient AND counted for the creator.
  const passers = w.audience.filter((p) => p.state === "passed");
  const passesAgree =
    mine.passed === passers.length && passers.every((p) => !challengedView(w, p).inQueue);
  out.push({
    name: "A pass is terminal on both sides",
    ok: passesAgree,
    detail: `creator is told ${mine.passed}; ${passers.length} passed and none still hold the card`,
  });

  // 4 · Viewing is not answering. A viewer must still be waiting on both sides.
  const viewers = w.audience.filter((p) => p.state === "viewed");
  const viewingCounted = viewers.length > 0 && mine.showedUp > reallyShowed;
  out.push({
    name: "Viewing is not showing up",
    ok: !viewingCounted && viewers.every((p) => challengedView(w, p).inQueue || w.closed != null),
    detail: viewers.length
      ? `${viewers.length} looked without answering, and none were counted`
      : "nobody is in the viewed state",
  });

  // 5 · Everyone terminal ⇒ it should close. Anyone waiting ⇒ it must not.
  const allTerminal =
    w.audience.length > 0 &&
    w.audience.every((p) => p.state === "showed_up" || p.state === "passed");
  out.push({
    name: "Auto-close agrees with the recipients",
    ok: mine.shouldClose === allTerminal,
    detail: allTerminal
      ? "everyone answered, so it should close"
      : "somebody is still deciding, so it must stay up",
  });

  // 6 · Conviction Match is the same number wherever it appears.
  const mismatched = views.filter(({ p, v }) => v.match !== convictionMatch(p.together, p.shared));
  out.push({
    name: "Conviction Match is one number everywhere",
    ok: mismatched.length === 0,
    detail: mismatched.length
      ? `${mismatched.map(({ p }) => p.name).join(", ")} would read a different % here than in People`
      : "every pair reads the same % on every surface",
  });

  // 6b · A card may not show a run the scenario did not declare.
  //
  // The rule the brief calls "never say again, usually or first time without
  // evidence", enforced where it can actually be checked. A run is prior history
  // between two people; if the card can produce one the World never stated, the
  // number is coming from somewhere other than the facts — which is precisely how
  // a relationship surface starts flattering people.
  const invented = challengesFor(w).filter((c, i) => {
    const declared = w.audience[i]?.run ?? 0;
    return (c.reciprocity?.run ?? 0) !== declared;
  });
  out.push({
    name: "No card invents a run the scenario did not declare",
    ok: invented.length === 0,
    detail:
      invented.length > 0
        ? `${invented.length} card(s) show a back & forth the World never stated`
        : "every run on screen is a fact the scenario declared",
  });

  // 6c · ONE CARD PER PERSON PER MARKET, whichever roles the reader is playing.
  //
  // The rail merges the incoming call and the reader's own Challenge by market,
  // so a person who was brought into a question and then relayed it must see ONE
  // card that changed colour — never the same question twice in one column. This
  // maps every incoming card onto the market the fixture's table row uses, which
  // is the exact collision the merge exists to resolve.
  const overlapped = mergeChain(
    challengesFor(w).map((c) => ({ ...c, marketId: 1 })),
    tableRowsFor(w),
  );
  const dupes = overlapped.length - new Set(overlapped.map((c) => c.marketId)).size;
  const bothRoles = overlapped.filter((c) => c.incoming && c.mine);
  out.push({
    name: "One card per person per market, in both roles at once",
    ok: dupes === 0 && bothRoles.every((c) => c.tone === "blue"),
    detail:
      dupes > 0
        ? `${dupes} question(s) would appear twice in one column`
        : `${overlapped.length} card(s), and a reader who relayed reads as the one asking`,
  });

  // 7 · The cap is never exceeded, whatever the fixture says.
  out.push({
    name: "Never more than three on the table",
    ok: w.activeChallenges <= 3,
    detail: `${w.activeChallenges} active`,
  });

  // 8 · YES and NO are the same act. Flipping every side changes nothing.
  const flipped: World = {
    ...w,
    challenger: {
      ...w.challenger,
      side: w.challenger.side === "YES" ? "NO" : w.challenger.side === "NO" ? "YES" : null,
    },
  };
  const same = challengerView(flipped);
  out.push({
    name: "YES and NO satisfy a Challenge identically",
    ok: same.showedUp === mine.showedUp && same.progress === mine.progress,
    detail: "flipping the challenger's side leaves every count and sentence unchanged",
  });

  return out;
}

/** A world where every check passes — the shape the presets are built from. */
const person = (
  name: string,
  relation: CallerRelation,
  together: number,
  shared: number,
  state: RecipientState,
  /** Prior answered challenges between this pair. 0 — the default — is silence. */
  run = 0,
): Participant => ({
  name,
  wallet: `0x${name.toLowerCase().padEnd(8, "0")}`,
  relation,
  together,
  shared,
  state,
  run,
});

/**
 * THE SCENES. Each is a story worth being able to reach in one click, and the
 * granular controls tune from there. Named for what they are about rather than
 * for the fields they set.
 */
export const SCENES: Record<string, { label: string; world: World }> = {
  quiet: {
    label: "Nobody is waiting",
    world: {
      question: "Will Bitcoin hit $200K before 2027?",
      challenger: { name: "Sarah", wallet: "0xsarah", side: "YES" },
      audience: [],
      activeChallenges: 0,
      closed: null,
    },
  },
  fresh: {
    label: "Just put it up",
    world: {
      question: "Will Bitcoin hit $200K before 2027?",
      challenger: { name: "Sarah", wallet: "0xsarah", side: "YES" },
      audience: [
        person("Mike", "opp", 2, 9, "open"),
        person("Priya", "tribe", 23, 25, "open"),
        person("Rasoul", "tribe", 9, 11, "open"),
      ],
      activeChallenges: 1,
      closed: null,
    },
  },
  traction: {
    label: "Gaining traction",
    world: {
      question: "Will AI replace most entry-level coding jobs by 2030?",
      challenger: { name: "Sarah", wallet: "0xsarah", side: "NO" },
      audience: [
        person("Mike", "opp", 2, 9, "showed_up", 5),
        person("Priya", "tribe", 23, 25, "showed_up"),
        person("Rasoul", "tribe", 9, 11, "viewed"),
        person("John", "inverse", 1, 8, "passed"),
        person("Dana", "tribe", 7, 12, "open", 3),
      ],
      activeChallenges: 2,
      closed: null,
    },
  },
  finished: {
    label: "Everyone answered",
    world: {
      question: "Will the Fed cut rates twice this year?",
      challenger: { name: "Sarah", wallet: "0xsarah", side: "YES" },
      audience: [
        person("Mike", "opp", 2, 9, "showed_up"),
        person("Priya", "tribe", 23, 25, "showed_up"),
        person("John", "inverse", 1, 8, "passed"),
      ],
      activeChallenges: 3,
      closed: null,
    },
  },
  rivalShowsUp: {
    label: "The Rival who shows up",
    world: {
      question: "Will ETH outperform BTC this year?",
      challenger: { name: "Sarah", wallet: "0xsarah", side: "NO" },
      audience: [person("Mike", "opp", 2, 9, "showed_up", 7)],
      activeChallenges: 1,
      closed: null,
    },
  },
  thin: {
    label: "Too thin to place",
    world: {
      question: "Will this new question find its people?",
      challenger: { name: "Sarah", wallet: "0xsarah", side: "YES" },
      audience: [person("Quiet Fox", "tribe", 1, 2, "open")],
      activeChallenges: 1,
      closed: null,
    },
  },
  exited: {
    label: "The challenger has since exited",
    world: {
      question: "Will Bitcoin hit $200K before 2027?",
      // No side — the caller went flat after putting it up. The Challenge must
      // survive: putting it on the table is what they did, and it stays true.
      challenger: { name: "Sarah", wallet: "0xsarah", side: null },
      audience: [person("Mike", "opp", 2, 9, "open")],
      activeChallenges: 1,
      closed: null,
    },
  },
  full: {
    label: "Table is full",
    world: {
      question: "Will Bitcoin hit $200K before 2027?",
      challenger: { name: "Sarah", wallet: "0xsarah", side: "YES" },
      audience: [person("Mike", "opp", 2, 9, "open")],
      activeChallenges: 3,
      closed: null,
    },
  },
  /**
   * THE ENDING THE CREATOR NEVER USED TO SEE. `tableFor` closed this and dropped
   * it in the same pass, so the best outcome the product can produce was the one
   * its author was least likely to witness. Reachable in one click now, precisely
   * so it stays visible.
   */
  everyoneShowed: {
    label: "Finished — everyone showed up",
    world: {
      question: "Will ETH outperform BTC this year?",
      challenger: { name: "Sarah", wallet: "0xsarah", side: "NO" },
      audience: [
        person("Mike", "opp", 2, 9, "showed_up"),
        person("Priya", "tribe", 23, 25, "showed_up"),
        person("Rasoul", "tribe", 9, 11, "showed_up"),
      ],
      activeChallenges: 0,
      closed: "all_responded",
    },
  },
  nobodyShowed: {
    label: "Finished — nobody did",
    world: {
      question: "Will quantum computing break RSA before 2030?",
      challenger: { name: "Sarah", wallet: "0xsarah", side: "YES" },
      audience: [person("Mike", "opp", 2, 9, "passed"), person("Priya", "tribe", 23, 25, "passed")],
      activeChallenges: 0,
      closed: "all_responded",
    },
  },
  tookItDown: {
    label: "You took it off the table",
    world: {
      question: "Will the Fed cut rates twice this year?",
      challenger: { name: "Sarah", wallet: "0xsarah", side: "YES" },
      audience: [
        person("Mike", "opp", 2, 9, "showed_up"),
        person("Priya", "tribe", 23, 25, "open"),
      ],
      activeChallenges: 0,
      closed: "creator",
    },
  },
  crowd: {
    label: "Stress test — twenty people",
    world: {
      question:
        "Will a question this long still lay out correctly when somebody writes far more than anybody expected them to write in a single market title?",
      challenger: { name: "Sarah", wallet: "0xsarah", side: "YES" },
      audience: Array.from({ length: 20 }, (_, i) =>
        person(
          `Person ${i + 1}`,
          i % 3 === 0 ? "opp" : "tribe",
          i,
          Math.max(1, i + 2),
          i < 4 ? "showed_up" : i < 6 ? "passed" : i < 9 ? "viewed" : "open",
        ),
      ),
      activeChallenges: 3,
      closed: null,
    },
  },
};

export const SCENE_KEYS = Object.keys(SCENES);
export { recipientState };
