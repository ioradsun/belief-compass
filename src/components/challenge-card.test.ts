import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { convictionMatch } from "@/domain/relationship";
import { composeChallenges, CALLER_RELATIONS, type CallEvidence } from "@/domain/challenge";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
/** Comments stripped: this file EXPLAINS at length what it refuses to render. */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

const rail = () => code("src/components/ChallengeRail.tsx");

const ev = (over: Partial<CallEvidence> = {}): CallEvidence => ({
  marketId: 1,
  title: "Will AI replace most entry-level coding jobs by 2030?",
  caller: { wallet: "0xsarah", name: "Sarah" },
  relation: "tribe",
  act: "trade",
  callerSide: "YES",
  together: 9,
  shared: 11,
  atMs: Date.parse("2026-08-07T00:00:00Z"),
  ...over,
});

/**
 * THE CARD ANSWERS THREE QUESTIONS: who called me, why do I care, what are they
 * asking me to weigh in on. Everything below is a thing that would blur one of
 * those, asserted as absent.
 */
describe("the Challenge card shows the relationship, not a market tile", () => {
  it("shows Conviction Match from the canonical calculation", () => {
    const c = rail();
    expect(c).toMatch(/convictionMatch\(/);
    expect(c).toMatch(/Conviction Match/);
    // Never recomputed locally — a pair cannot be 82% in People and 79% here.
    expect(c).not.toMatch(/agreement\s*[/*]|together\s*\/\s*shared/);
  });

  it("prints the arithmetic beside the percentage", () => {
    expect(rail()).toMatch(/together\}? of \{?c\.shared|c\.together\} of \{c\.shared\}/);
  });

  it("tells the story in order: person, then belief, then evidence", () => {
    // The order IS the argument — here is a person, here is what they hold, and
    // here is what your history with them says about whether you'll hold it too.
    // The evidence used to sit between the question and the belief, which made
    // the card read as a statistic that happened to mention somebody's position.
    const c = rail();
    const name = c.indexOf("{c.caller.name}");
    const title = c.indexOf("{c.title}");
    const belief = c.indexOf("{c.reason}");
    // The RENDERED evidence line, not the screen-reader label — the aria string
    // assembled at the top of the button also names Conviction Match, and it is
    // deliberately ordered for a different reader.
    const evidence = c.indexOf("% Conviction Match ·");
    expect(name).toBeGreaterThan(-1);
    expect(title).toBeGreaterThan(name);
    expect(belief).toBeGreaterThan(title);
    expect(evidence).toBeGreaterThan(belief);
  });

  it("never shows a wager", () => {
    // "Mike put $500 down" turns a social signal into financial pressure, and
    // would make the loudest voice the wealthiest one. The market shows size to
    // anyone who opens it.
    const c = rail();
    expect(c).not.toMatch(/amountUsd|amountEth|stake|wager|\$\{.*usd/i);
  });

  it("has no Accept and no Decline", () => {
    // Opening is not accepting; taking a side is. A CTA would add a step before
    // the only step that means anything — and "Decline" would make a private
    // preference feel like a public verdict.
    const c = rail();
    expect(c).not.toMatch(/Accept|Decline|Reject|Ignore/i);
  });

  it("makes the card itself the affordance", () => {
    expect(rail()).toMatch(/onClick=\{\(\) => onSelect\(c\.marketId\)\}/);
  });
});

describe("the words the card is allowed to say", () => {
  it("never renders Twin or Opp while they are held back", () => {
    // RELATIONSHIP_TEXT still maps twin→"Twin" and inverse→"Opp". Rendering them
    // here would put words on this rail that the People rail withholds — the
    // same person reading "Twin" in one column and no label in the other.
    const c = rail();
    expect(c).not.toMatch(/RELATIONSHIP_TEXT/);
    expect(c).toMatch(/twin:\s*"Tribe"/);
    expect(c).toMatch(/inverse:\s*"Rival"/);
  });

  it("never says Neutral, Unplaced or Unknown", () => {
    expect(rail()).not.toMatch(/"Neutral"|"Unplaced"|"Unknown"|"Other"/);
  });
});

describe("dismissal is private, and costs nothing", () => {
  it("keeps the dismissal viewer-local rather than writing it down", () => {
    // The one place localStorage is CORRECT: a preference owed to nobody, whose
    // worst failure mode is a card reappearing. Contrast the acknowledgement set
    // this feature deleted — that hid durable evidence somebody else had earned.
    const c = code("src/lib/open-calls.ts");
    expect(c).toMatch(/localStorage/);
    expect(c).toMatch(/calls-hidden/);
  });

  it("tells nobody and records nothing", () => {
    // No server call on the dismissal path: no caller notification, no Now row,
    // no relationship number moving. Absence is the whole feature.
    const c = code("src/lib/open-calls.ts");
    const dismissBlock = c.slice(
      c.indexOf("export function hideCall("),
      c.indexOf("export function useHiddenCalls("),
    );
    expect(dismissBlock).not.toMatch(/await|fetch|Fn\(|serverFn|mutate/);
  });

  it("removes the card from the count, not just from view", () => {
    // The badge must equal what is on screen — three means three people are
    // actually waiting, which is what makes the number worth having.
    //
    // THE MECHANISM CHANGED AND THE PROPERTY DID NOT. This used to `.filter()` the
    // row out of the payload entirely. The card now survives its own ending, so
    // filtering would make it vanish on the tap and return as an outcome on the
    // next refetch — a card that disappears and comes back looks like a bug. It is
    // RESTATED as passed instead, which takes it out of `open` just as completely.
    const c = code("src/lib/open-calls.ts");
    expect(c).toMatch(/c\.state === "waiting" && dismissed\.has\(String\(c\.marketId\)\)/);
    expect(c).toMatch(/open: all\.filter\(\(c\) => c\.state === "waiting"\)/);
  });

  it("gives the phone a hit target a thumb can actually find", () => {
    // The × sits on top of a card whose entire body opens the market, so a
    // near-miss dismisses the call instead — and nothing undoes a dismissal.
    // 32px square is the floor; the glyph itself stays quiet.
    const dismiss = rail().slice(rail().indexOf("onDismiss(c.marketId)"));
    expect(dismiss).toMatch(/h-8 w-8/);
    // No hover-only reveal: a phone has no hover, so opacity-50 hover:opacity-100
    // left it permanently at half strength exactly where it was hardest to hit.
    expect(dismiss).not.toMatch(/opacity-50/);
  });
});

describe("one count, two surfaces", () => {
  it("badges the mobile menu from the same hook the rail renders from", () => {
    // On a phone the rail is two taps inside a menu, and the count used to live
    // only on the segmented control INSIDE it — you had to already be there to
    // learn you should go. Deriving the badge separately would let the menu say
    // 3 while the rail shows 2, which makes the number not worth believing.
    const route = code("src/routes/index.tsx");
    expect(route).toMatch(/useOpenCalls\(wallet\)\.open\.length/);
    expect(rail()).toMatch(/useOpenCalls\(wallet\)/);
    // The rail must not keep a second private copy of the dismissed set.
    expect(rail()).not.toMatch(/localStorage/);
  });
});

describe("what the card renders is what the payload can prove", () => {
  it("withholds the percentage on thin evidence rather than inventing one", () => {
    expect(rail()).toMatch(/RELATIONSHIP_MIN_SHARED/);
  });

  it("agrees with the People card for the same pair", () => {
    // One calculation, one answer, everywhere. This is the assertion that makes
    // "82% in People, 79% in Challenge" impossible rather than merely unlikely.
    for (const [t, s] of [
      [9, 11],
      [2, 9],
      [23, 25],
      [0, 8],
    ] as const) {
      const [row] = composeChallenges([ev({ together: t, shared: s })]);
      expect(convictionMatch(row.together ?? 0, row.shared ?? 0)).toBe(convictionMatch(t, s));
    }
  });

  it("carries the pair's record onto every surviving challenge", () => {
    for (const relation of CALLER_RELATIONS) {
      const [row] = composeChallenges([ev({ relation })]);
      expect(row.together).toBe(9);
      expect(row.shared).toBe(11);
    }
  });

  it("drops a call whose market has no question", () => {
    // The gate moved out of the sentence composer when the sentence moved to
    // call-line, which never sees a title. A card asking a reader to weigh in on
    // a blank is worse than no card.
    expect(composeChallenges([ev({ title: "   " })])).toEqual([]);
  });
});

describe("a failed read is not an empty room", () => {
  it("distinguishes 'could not load' from a quiet room", () => {
    // `buildChallenges` opens with an unguarded serviceClient(), and createClient
    // throws SYNCHRONOUSLY without a key — so a deployment missing the service
    // role key threw on every call while this panel rendered the calm empty
    // sentence, indefinitely. Nobody was told and no row was written.
    const c = rail();
    expect(c).toMatch(/failed \?/);
    expect(c).toMatch(/Could not load who is waiting on you/);
    // The quiet case renders nothing at all now, and it must still sit BEHIND
    // the failure check — never in front of it. "Quiet" means nothing waiting AND
    // nothing that recently happened: an outcome on screen is not an empty room.
    expect(c.indexOf("failed ?")).toBeLessThan(
      c.indexOf("open.length === 0 && recent.length === 0 ? null"),
    );
  });

  it("surfaces the error from the shared hook rather than swallowing it", () => {
    const c = code("src/lib/open-calls.ts");
    expect(c).toMatch(/isError/);
    expect(c).toMatch(/failed: isError/);
  });
});

/**
 * THE CARD TRANSFORMS RATHER THAN DISAPPEARING.
 *
 * WHAT THIS REPLACED, AND WHY IT WAS WRONG. `buildChallenges` filtered
 * `responded_at IS NULL`, so the instant somebody took a side their card was gone.
 * The reasoning was that a queue with completed items in it is a to-do list, and
 * that is true of a to-do list — it is not true of the one thing this entire system
 * exists to produce. Somebody revealing where they stand because somebody else
 * asked was the single fact most likely to be deleted at the exact moment it became
 * true. The card now survives its own ending, says what happened, asks for nothing,
 * and ages out on the same week the creator's side already keeps.
 */
describe("an answered card stops asking and stays", () => {
  it("renders the outcome from the shared composer, never a status word", () => {
    const c = rail();
    expect(c).toMatch(/outcomeLine\(c\.state, c\.caller\.name/);
    // No state name, no record vocabulary, no id. The row says what two people did.
    for (const w of ["Completed", "Responded", "Answered by", "Status", "Challenge #"])
      expect(c).not.toContain(w);
  });

  it("drops the prompt once the reader has taken a side", () => {
    // "Maya believes YES. Take this one." beside a position already held is the
    // product asking for something it already got.
    expect(rail()).toMatch(/\{!done && \(/);
  });

  it("takes the pass control away when there is nothing left to pass on", () => {
    // A control that would re-record a choice already made invites a reader to
    // undo something the other person has been told about.
    expect(rail()).toMatch(/\{!done && \(\s*<button/);
  });

  it("goes quieter in exactly the way the outbound side already does", () => {
    // One vocabulary for "this ended": dashed, transparent, never greyed out —
    // it steps back because it needs nothing, not because it stopped mattering.
    const c = rail();
    expect(c).toMatch(/border-dashed/);
    expect(c).not.toMatch(/opacity-40|grayscale|disabled:/);
  });

  it("keeps the badge counting people, never outcomes", () => {
    // The mobile badge and the tab number must keep meaning "somebody is waiting
    // on you". Badging the payoff would turn it into another chore.
    const calls = code("src/lib/open-calls.ts");
    expect(calls).toMatch(/open: all\.filter\(\(c\) => c\.state === "waiting"\)/);
    expect(code("src/routes/index.tsx")).toMatch(/useOpenCalls\(wallet\)\.open\.length/);
  });

  it("reuses the element rather than unmounting one and mounting another", () => {
    // Keyed by market on ONE list, so the row a reader was looking at when they
    // took a side stays where it is and changes what it says. Two lists would
    // have re-created the bug: a card vanishing here and reappearing there.
    const c = rail();
    expect(c).toMatch(
      /\[\.\.\.open\.slice\(0, shown\), \.\.\.recent\.slice\(0, CHALLENGE\.maxRecent\)\]/,
    );
    expect(c).toMatch(/key=\{c\.marketId\}/);
  });

  it("never lets outcomes crowd out the people still waiting", () => {
    // FOUND BY RENDERING IT. Against a real scenario the rail showed three
    // outcomes above two people still waiting, and the column stopped reading as
    // "who needs something from me" — the payoff had displaced the request. The
    // rest are one tap away under "See all", which is where a history belongs.
    expect(rail()).toMatch(/recent\.slice\(0, CHALLENGE\.maxRecent\)/);
    // The QUEUE is never capped by the same number: a person waiting on you is
    // not surplus, and `shown` pages through every one of them.
    expect(rail()).toMatch(/open\.slice\(0, shown\)/);
  });
});

describe("a pass is the reader's own, said in the reader's own words", () => {
  it("restates the card instead of deleting it, so nothing flickers back", () => {
    // A row filtered out locally would vanish on the tap and return as an outcome
    // on the next refetch. A card that disappears and comes back looks like a bug.
    const c = code("src/lib/open-calls.ts");
    expect(c).toMatch(/passedNow\(/);
    expect(c).toMatch(/state: "passed"/);
  });

  it("never names anybody else as having passed", () => {
    // The creator is told a count and never a name — a pass is a choice about a
    // question, not a verdict on a person.
    const c = rail() + code("src/components/ChallengeHistory.tsx");
    for (const w of ["passed on you", "they passed", "passedBy", "whoPassed"])
      expect(c).not.toContain(w);
  });
});

/**
 * THE RUN, AND THE WORD IT IS NOT ALLOWED TO USE.
 */
describe("reciprocity reaches the card as a fact, not a score", () => {
  it("reads the run from the payload rather than counting anything locally", () => {
    const c = rail();
    expect(c).toMatch(/backAndForthLine\(/);
    // Nothing here recomputes a run: one calculation, one answer, every surface.
    expect(c).not.toMatch(/\.filter\(.*responded|run \+= 1|reduce\(/);
  });

  it("says none of the words that would make it a game", () => {
    // "badge" is deliberately absent from this list: the TRIBE / RIVAL chip has
    // been called a badge since long before any of this, and it names a
    // relationship the engine measured rather than an achievement anybody earned.
    const c = rail();
    for (const w of ["streak", "Streak", "🔥", "confetti", "leaderboard", "combo", "milestone"])
      expect(c).not.toContain(w);
    expect(c).not.toMatch(/\bXP\b|\bpoints\b|\bcoins\b/);
  });
});

/**
 * SEE ALL — the complete history, and the ways it could become a second feed.
 */
describe("the full history is complete, chronological, and not a feed", () => {
  const history = () => code("src/components/ChallengeHistory.tsx");

  it("is reachable from the rail", () => {
    expect(rail()).toMatch(/<ChallengeHistory/);
    expect(history()).toMatch(/See all/);
  });

  it("runs through no scorer, no ranking and no admission rule", () => {
    // The invariant that keeps this from becoming the Insider tape with a
    // different heading. Insider already answers "what is happening", one tab
    // across, for everybody; this answers "what have we done", for two people.
    const c = history();
    for (const w of ["significance", "score", "rank", "eligib", "admit", "boost", "trending"])
      expect(c.toLowerCase()).not.toContain(w);
  });

  it("reuses the one sheet rather than growing a second one", () => {
    expect(history()).toMatch(/from "@\/components\/Sheet"/);
    // And the roster it came from now renders the same component.
    expect(code("src/components/CaseFile.tsx")).toMatch(/<Sheet/);
  });

  it("speaks the same row vocabulary as the profile's own history", () => {
    // One interaction cannot be described two ways on two screens.
    expect(history()).toMatch(/historyRows\(/);
    expect(code("src/components/PersonProfile.tsx")).toMatch(/historyRows\(/);
  });

  it("never reports a failed read as an empty history", () => {
    // Here the confident zero would tell somebody with a year of relationships
    // that they have never challenged anybody.
    const c = history();
    expect(c).toMatch(/isError/);
    expect(c).toMatch(/Could not load your history/);
    expect(c.indexOf("isError ?")).toBeLessThan(c.indexOf("groups.length === 0"));
  });

  it("admits when it stopped at its read bound", () => {
    // A bounded read presented as the whole story is the worst possible lie on
    // the one surface whose entire promise is completeness.
    expect(history()).toMatch(/truncated/);
    expect(code("src/lib/challenge.server.ts")).toMatch(/truncated:/);
  });

  it("costs the rail nothing until somebody asks for it", () => {
    expect(history()).toMatch(/enabled: !!wallet && open/);
  });
});
