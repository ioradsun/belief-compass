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
    expect(code("src/lib/open-calls.ts")).toMatch(
      /challenges \?\? \[\]\)\.filter\(\(c\) => !dismissed\.has/,
    );
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
    expect(rail()).toMatch(/MATURE_MIN_SHARED/);
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
  it("distinguishes 'could not load' from 'nobody is waiting'", () => {
    // `buildChallenges` opens with an unguarded serviceClient(), and createClient
    // throws SYNCHRONOUSLY without a key — so a deployment missing the service
    // role key threw on every call while this panel rendered the calm empty
    // sentence, indefinitely. Nobody was told and no row was written.
    const c = rail();
    expect(c).toMatch(/failed \?/);
    expect(c).toMatch(/Could not load who is waiting on you/);
    // The empty state must sit BEHIND the failure check, never in front of it.
    expect(c.indexOf("failed ?")).toBeLessThan(c.indexOf("Nobody is waiting on you"));
  });

  it("surfaces the error from the shared hook rather than swallowing it", () => {
    const c = code("src/lib/open-calls.ts");
    expect(c).toMatch(/isError/);
    expect(c).toMatch(/failed: isError/);
  });
});
