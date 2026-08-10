import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  TABLE_SLOTS,
  TABLE_BANNED,
  showedUpHeadline,
  showedUpSide,
  keptItMovingLine,
  keepMovingLine,
  branchLiveLine,
  TERMINAL_STATES,
  recipientState,
  tableProgress,
  shouldAutoClose,
  spotsOpen,
  canPutOnTable,
  tableLine,
  progressLine,
  finishedLine,
  finishedVisible,
  FINISHED_WINDOW_MS,
  type RecipientFact,
} from "./table";

const open = (): RecipientFact => ({ respondedAtMs: null, passedAtMs: null });
const showed = (): RecipientFact => ({ respondedAtMs: 1, passedAtMs: null });
const passed = (): RecipientFact => ({ respondedAtMs: null, passedAtMs: 1 });
const many = (n: number, f: () => RecipientFact) => Array.from({ length: n }, f);

/**
 * THE HARD INVARIANTS. Each of these is a sentence the product says out loud, and
 * a thing that would quietly stop being true if somebody changed the wrong line.
 */
describe("three on the table", () => {
  it("caps at three, from one canonical place", () => {
    expect(TABLE_SLOTS).toBe(3);
    expect(spotsOpen(0)).toBe(3);
    expect(spotsOpen(2)).toBe(1);
    expect(spotsOpen(3)).toBe(0);
    expect(canPutOnTable(2)).toBe(true);
    expect(canPutOnTable(3)).toBe(false);
    // A fourth cannot be reasoned into existence by a bad count.
    expect(spotsOpen(9)).toBe(0);
    expect(canPutOnTable(9)).toBe(false);
  });

  it("reads as capacity, never as currency", () => {
    // "2 / 3 USED" turns an editorial choice into a balance being spent.
    expect(tableLine(2)).toBe("2 on the table · 1 spot open");
    expect(tableLine(1)).toBe("1 on the table · 2 spots open");
    // At capacity it stops mentioning room, because there is none to describe —
    // and nothing warns until somebody actually tries to add a fourth.
    expect(tableLine(3)).toBe("3 on the table");
    // Nothing on the table is not "0 on the table"; it is no line at all.
    expect(tableLine(0)).toBeNull();
  });

  it("never says the slot number out loud", () => {
    // `slot_no` is bookkeeping that makes the cap race-safe. Nobody has a
    // "Challenge #2", so no rendered string may contain one.
    for (const n of [0, 1, 2, 3]) expect(tableLine(n) ?? "").not.toMatch(/#|slot/i);
  });
});

describe("what became of one person's chance to weigh in", () => {
  it("counts YES and NO identically", () => {
    // The invariant the whole mechanism rests on, and the input type is what
    // guarantees it: RecipientFact carries no side, so agreement CANNOT reach
    // this decision however the code is later edited.
    const keys = Object.keys(showed());
    expect(keys).not.toContain("side");
    expect(recipientState(showed())).toBe("showed_up");
  });

  it("treats viewing as not showing up", () => {
    // Opening a question is not answering it. A recipient who looked and left is
    // still open, and a Challenge must not close on the strength of a glance.
    expect(recipientState(open())).toBe("open");
    expect(TERMINAL_STATES.has("viewed")).toBe(false);
    expect(TERMINAL_STATES.has("open")).toBe(false);
  });

  it("treats passing as terminal but never as showing up", () => {
    expect(recipientState(passed())).toBe("passed");
    expect(TERMINAL_STATES.has("passed")).toBe(true);
    const p = tableProgress([passed(), passed()]);
    expect(p.showedUp).toBe(0);
    expect(p.passed).toBe(2);
  });

  it("lets taking a side outrank a pass, if somebody does both", () => {
    // Waving a card off and then finding the market anyway is a real path.
    // Taking a side is the larger fact and the one worth remembering.
    expect(recipientState({ respondedAtMs: 2, passedAtMs: 1 })).toBe("showed_up");
  });
});

describe("progress a creator can actually be told", () => {
  it("counts against a frozen denominator", () => {
    const p = tableProgress([showed(), showed(), showed(), passed(), ...many(4, open)]);
    expect(p).toMatchObject({ reached: 8, showedUp: 3, passed: 1, waiting: 4 });
    expect(progressLine(p)).toBe("3 of 8 showed up · 1 passed");
  });

  it("says nothing about a pass that did not happen", () => {
    const p = tableProgress([showed(), open(), open()]);
    expect(progressLine(p)).toBe("1 of 3 showed up");
  });

  it("claims nothing at all when it reached nobody", () => {
    expect(progressLine(tableProgress([]))).toBeNull();
  });

  /**
   * The card printed "0 of 7 showed up" and then, underneath, "7 of your people
   * can weigh in. No smoke yet." — one fact, three tellings, led by a nought.
   * Before anybody answers there is one sentence to say.
   */
  it("says it is early once, in one line, without a nought", () => {
    const line = progressLine(tableProgress(many(7, open)));
    expect(line).toBe("Waiting on 7");
    expect(line).not.toMatch(/^0 of/);
  });

  it("switches to the count the moment anybody answers", () => {
    expect(progressLine(tableProgress([passed(), open(), open()]))).toBe(
      "0 of 3 showed up · 1 passed",
    );
  });

  it("never claims a view, a believer or a dollar", () => {
    // The only view signal this product has is client-reported and unverifiable,
    // and capital/believer totals are market facts rather than Challenge effects.
    // Printing either implies something the data cannot support.
    const p = tableProgress([showed(), passed(), open()]);
    const line = progressLine(p) ?? "";
    for (const w of ["viewed", "looked", "believer", "$", "backed", "since"])
      expect(line.toLowerCase(), `"${line}" claims "${w}"`).not.toContain(w);
  });
});

describe("a Challenge ends when there is nothing left for it to do", () => {
  it("closes once every recipient has answered one way or the other", () => {
    expect(shouldAutoClose([showed(), showed(), passed()])).toBe(true);
    expect(shouldAutoClose(many(3, showed))).toBe(true);
    expect(shouldAutoClose(many(3, passed))).toBe(true);
  });

  it("stays open while anyone is still deciding", () => {
    expect(shouldAutoClose([showed(), passed(), open()])).toBe(false);
    expect(shouldAutoClose(many(3, open))).toBe(false);
  });

  it("does not close a Challenge that reached nobody", () => {
    // Vacuously "all responded" would free the slot for a reason the creator
    // would not recognise. It never started; it has not run its course.
    expect(shouldAutoClose([])).toBe(false);
    expect(tableProgress([]).allResponded).toBe(false);
  });
});

describe("the vocabulary", () => {
  it("never uses the words that would make a pass feel like a verdict", () => {
    // The banned LIST necessarily contains the banned words, so it is excised
    // before the source is searched — otherwise this assertion could only ever
    // fail, which is a test that proves nothing.
    const src = readFileSync(join(process.cwd(), "src/domain/table.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")
      .replace(/export const TABLE_BANNED[\s\S]*?\];/, "");
    // Rendered strings only — the banned list itself names these words.
    for (const s of [tableLine(2), tableLine(3), progressLine(tableProgress([showed(), passed()]))])
      for (const w of TABLE_BANNED)
        expect((s ?? "").toLowerCase(), `"${s}" contains "${w}"`).not.toContain(w);
    // And nothing in the module reaches for acceptance language internally either.
    expect(src).not.toMatch(/\baccepted\b|\bdeclined\b|\brejected\b/);
  });

  it("bans the mechanics this product decided not to have", () => {
    for (const w of ["credits", "tokens", "allowance", "streak", "invited"])
      expect(TABLE_BANNED).toContain(w);
  });
});

/**
 * THE CAP IS THE DATABASE'S JOB, not a component's. Counting rows before inserting
 * is a race two browser tabs win, so the guarantee lives in a partial unique index
 * and this test pins the migration that provides it.
 */
describe("the cap survives two browser tabs", () => {
  const sql = () =>
    readFileSync(
      join(process.cwd(), "supabase/migrations/20260904000000_challenges_on_the_table.sql"),
      "utf8",
    );

  it("makes a fourth active Challenge impossible in the schema", () => {
    const s = sql();
    expect(s).toMatch(/slot_no\s+smallint\s+NOT NULL CHECK \(slot_no BETWEEN 1 AND 3\)/);
    expect(s).toMatch(
      /CREATE UNIQUE INDEX[\s\S]*?challenges \(challenger_wallet, slot_no\)\s*\n\s*WHERE closed_at IS NULL/,
    );
  });

  it("makes one market consume at most one slot", () => {
    expect(sql()).toMatch(
      /CREATE UNIQUE INDEX[\s\S]*?challenges \(challenger_wallet, market_id\)\s*\n\s*WHERE closed_at IS NULL/,
    );
  });

  it("keeps the recipient ledger a separate table", () => {
    // One table answering two questions badly is the thing this avoids:
    // `challenges` is market-level and closable, `market_calls` stays the
    // relationship ledger and merely learns which Challenge produced a row.
    const s = sql();
    expect(s).toMatch(
      /ALTER TABLE public\.market_calls\s*\n\s*ADD COLUMN IF NOT EXISTS challenge_id/,
    );
    expect(s).toMatch(/ADD COLUMN IF NOT EXISTS passed_at/);
    expect(s).not.toMatch(/DROP TABLE|ALTER TABLE public\.market_calls\s+DROP/);
  });
});

/**
 * WHAT BECAME OF IT — and why a finished Challenge is not a deleted one.
 *
 * The bug these guard: `tableFor` read only open rows AND auto-closed anything
 * everybody had answered, in the same pass. So the sequence was — put a question
 * up, everyone answers, open Yours, and the row is gone. The single most valuable
 * event this product can produce was the one most likely to be deleted before its
 * own author ever saw it.
 */
describe("the ending, told to the person who asked", () => {
  const p = (showedUp: number, passedCount: number, waiting = 0) =>
    tableProgress([
      ...many(showedUp, showed),
      ...many(passedCount, passed),
      ...many(waiting, open),
    ]);

  it("celebrates a full house without gushing at one person", () => {
    expect(finishedLine(p(3, 0), "all_responded")).toBe("Everyone showed up.");
    // "Everyone" needs a crowd to mean anything. At one it is a flourish about a
    // single human being, which reads as the system trying too hard.
    expect(finishedLine(p(1, 0), "all_responded")).toBe("They showed up.");
  });

  it("states a partial turnout without accounting for the rest", () => {
    expect(finishedLine(p(3, 5), "all_responded")).toBe("3 of 8 showed up.");
  });

  it("blames nobody when nobody showed up", () => {
    const line = finishedLine(p(0, 4), "all_responded");
    expect(line).toBe("Quiet one. Not every question finds its people.");
    // A pass is a choice about a QUESTION, so the sentence lands on the question.
    // And no tally of passes: a count of who would not is a ledger of rejection
    // with a friendlier label on it.
    expect(line).not.toMatch(/\b4\b/);
    for (const w of TABLE_BANNED) expect(line.toLowerCase()).not.toContain(w);
  });

  it("owns a manual close as something you did", () => {
    expect(finishedLine(p(2, 0, 3), "creator")).toBe(
      "You took it off the table. 2 of 5 showed up.",
    );
    expect(finishedLine(p(0, 0, 5), "creator")).toBe("You took it off the table.");
  });

  it("never uses a banned word in any branch", () => {
    for (const reason of ["creator", "all_responded"] as const)
      for (const [s, ps, w] of [
        [0, 0, 3],
        [1, 0, 0],
        [3, 0, 0],
        [3, 5, 0],
        [0, 4, 0],
      ] as const) {
        const line = finishedLine(p(s, ps, w), reason).toLowerCase();
        for (const banned of TABLE_BANNED) expect(line, line).not.toContain(banned);
      }
  });

  it("keeps a finished Challenge for a week, then lets it go", () => {
    const now = 10 * FINISHED_WINDOW_MS;
    expect(finishedVisible(now - 1000, now)).toBe(true);
    expect(finishedVisible(now - FINISHED_WINDOW_MS + 1, now)).toBe(true);
    expect(finishedVisible(now - FINISHED_WINDOW_MS, now)).toBe(false);
    // Still live — there is nothing finished to show.
    expect(finishedVisible(null, now)).toBe(false);
  });

  it("frees the slot the moment it closes, however good the outcome was", () => {
    // The other half of the fix. A week of successful Challenges reading as a full
    // table would be the exact opposite of what closing means.
    expect(canPutOnTable(0)).toBe(true);
    expect(tableLine(0)).toBeNull();
  });
});

/**
 * THE CHAIN'S VOCABULARY.
 *
 * A Challenge does not end when somebody answers — the answer is the reward for
 * the asker and the trigger for the next branch. Everything below is a way that
 * loop could start lying about people.
 */
describe("somebody showed up, named on the card", () => {
  const p = (name: string, side: "YES" | "NO" | null = null) => ({ name, side });

  it("names one or two, and counts beyond that", () => {
    expect(showedUpHeadline([p("Casey")])).toBe("Casey showed up");
    expect(showedUpHeadline([p("Maya"), p("John")])).toBe("Maya and John showed up");
    expect(showedUpHeadline([p("a"), p("b"), p("c")])).toBe("3 of your people showed up");
  });

  it("says nothing rather than 'somebody showed up'", () => {
    expect(showedUpHeadline([])).toBeNull();
    expect(showedUpHeadline([p("  ")])).toBeNull();
  });

  it("celebrates agreement and disagreement in the SAME headline", () => {
    // The invariant the whole feature rests on: a Rival who turns up turned up.
    expect(showedUpHeadline([p("Casey", "NO")])).toBe(showedUpHeadline([p("Casey", "YES")]));
  });

  it("puts the side in a separate clause, never in the celebration", () => {
    expect(showedUpSide([p("Casey", "NO")])).toBe("Casey backed NO.");
    expect(showedUpSide([p("Casey", "YES")])).toBe("Casey backed YES.");
    // "with you" is only allowed when the caller can actually prove they agreed.
    expect(showedUpSide([p("Casey", "YES")], "YES")).toBe("Casey backed YES with you.");
    expect(showedUpSide([p("Casey", "NO")], "YES")).toBe("Casey backed NO.");
  });

  it("prints no side for a row written before the side was kept", () => {
    // Not backfillable, and a guess would claim somebody went a way they may not
    // have. Silence is the honest degradation.
    expect(showedUpSide([p("Casey", null)])).toBeNull();
  });

  it("refuses a side clause for a crowd", () => {
    // Three people did three different things; one sentence cannot say so.
    expect(showedUpSide([p("a", "YES"), p("b", "NO")])).toBeNull();
  });
});

describe("keeping the chain moving", () => {
  it("never says 'pass it on', because Pass already means not for me", () => {
    const all = [
      keepMovingLine(9),
      branchLiveLine(13),
      keptItMovingLine(["John"], 8),
      showedUpHeadline([{ name: "Casey", side: "NO" }]),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    expect(all).not.toContain("pass");
  });

  it("reports reach as tables, never as people who have answered", () => {
    // A relay puts the question in front of a network; how many answer is not
    // known yet, and saying "8 more people showed up" would invent behaviour.
    expect(keptItMovingLine(["John"], 8)).toBe(
      "John kept it moving. The question is now on 8 more tables.",
    );
    expect(branchLiveLine(13)).toBe("The question is now on 13 more tables.");
    expect(branchLiveLine(1)).toBe("The question is now on 1 more table.");
  });

  it("offers nothing when there is nobody left to ask", () => {
    expect(keepMovingLine(0)).toBeNull();
    expect(branchLiveLine(0)).toBeNull();
    expect(keptItMovingLine([], 8)).toBeNull();
  });

  it("states the relay without a reach it cannot prove", () => {
    expect(keptItMovingLine(["John"], 0)).toBe("John kept it moving.");
  });

  it("uses no banned word in any branch", () => {
    const lines = [
      keepMovingLine(9),
      branchLiveLine(13),
      keptItMovingLine(["John"], 8),
      keptItMovingLine(["a", "b", "c"], 4),
      showedUpHeadline([{ name: "Casey", side: "NO" }]),
      showedUpSide([{ name: "Casey", side: "NO" }]),
    ].filter(Boolean) as string[];
    for (const line of lines)
      for (const w of TABLE_BANNED) expect(line.toLowerCase(), line).not.toContain(w);
  });
});
