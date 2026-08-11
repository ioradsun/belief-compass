import { describe, it, expect } from "vitest";
import {
  COPY_BANNED,
  HEADLINE_MAX_WORDS,
  SUPPORT_MAX_WORDS,
  allHooks,
  categoryRank,
  pickCategory,
  pickHook,
  words,
} from "./copy";
import { challengeLabel, type CopyCategory } from "./post-action";

const CATEGORIES: CopyCategory[] = [
  "reciprocity",
  "market_maker",
  "first_or_early",
  "chain",
  "tribe_rivals",
  "still_forming",
  "general",
  "exit",
];

const said = (h: { headline: string; support: string | null }) =>
  [h.headline, h.support].filter(Boolean).join(" ");

/* ── Priority ──────────────────────────────────────────────────────────────── */

describe("exactly one emotional argument, and the brief decides which", () => {
  it("ranks the brief's order", () => {
    const order: CopyCategory[] = [
      "reciprocity",
      "market_maker",
      "first_or_early",
      "chain",
      "tribe_rivals",
      "still_forming",
      "general",
    ];
    for (let i = 1; i < order.length; i++)
      expect(categoryRank(order[i - 1])).toBeGreaterThan(categoryRank(order[i]));
  });

  /**
   * AN EXIT IS NOT AN EMOTIONAL ARGUMENT. Somebody who just closed a position is
   * the one reader a rousing headline insults, so `exit` sits below `general`
   * and can only win when it is the only thing on offer.
   */
  it("puts exit below everything, including general", () => {
    for (const c of CATEGORIES) if (c !== "exit") expect(categoryRank(c)).toBeGreaterThan(0);
    expect(pickCategory(["exit", "general"])).toBe("general");
    expect(pickCategory(["exit"])).toBe("exit");
  });

  it("returns the single strongest candidate, whatever order they arrive in", () => {
    expect(pickCategory(["general", "still_forming", "reciprocity", "chain"])).toBe("reciprocity");
    expect(pickCategory(["chain", "reciprocity", "general"])).toBe("reciprocity");
    expect(pickCategory(["still_forming", "chain"])).toBe("chain");
  });

  /**
   * THREE ARGUMENTS ON ONE SCREEN IS THE FAILURE THIS PREVENTS. A reader told
   * they were early AND that their Tribe is watching AND that a chain reached
   * them believes none of it, so the function returns one category, never a set.
   */
  it("never returns more than one category", () => {
    const picked = pickCategory(CATEGORIES);
    expect(CATEGORIES).toContain(picked);
    expect(typeof picked).toBe("string");
  });

  it("falls back to general rather than throwing on an empty context", () => {
    expect(pickCategory([])).toBe("general");
  });
});

/* ── Determinism ───────────────────────────────────────────────────────────── */

describe("the premise does not mutate while somebody is looking at it", () => {
  it("returns the same hook for the same category and seed, every time", () => {
    for (const category of CATEGORIES)
      for (const seed of ["", "2815", "market:2815|challenge:7", "0xabc"]) {
        const first = pickHook({ category, seed });
        for (let i = 0; i < 20; i++) expect(pickHook({ category, seed })).toEqual(first);
      }
  });

  it("has no clock in it — two calls a simulated week apart agree", () => {
    const before = pickHook({ category: "chain", seed: "2815" });
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 7 * 24 * 60 * 60 * 1000;
      expect(pickHook({ category: "chain", seed: "2815" })).toEqual(before);
    } finally {
      Date.now = realNow;
    }
  });

  it("gives different moments different variants rather than one hook forever", () => {
    const seen = new Set(
      Array.from(
        { length: 200 },
        (_, i) => pickHook({ category: "chain", seed: `m${i}` }).headline,
      ),
    );
    expect(seen.size).toBeGreaterThan(1);
  });

  it("only ever returns a variant that belongs to the category asked for", () => {
    for (const category of CATEGORIES) {
      const family = allHooks()
        .filter((h) => h.category === category)
        .map((h) => h.hook.headline);
      for (let i = 0; i < 50; i++)
        expect(family).toContain(pickHook({ category, seed: `s${i}` }).headline);
    }
  });
});

/* ── History, when there is any ────────────────────────────────────────────── */

describe("history is used when it exists and never invented when it does not", () => {
  it("avoids the last three hooks", () => {
    const chosen = pickHook({ category: "chain", seed: "2815" });
    const next = pickHook({ category: "chain", seed: "2815", recent: [chosen.headline] });
    expect(next.headline).not.toBe(chosen.headline);
  });

  it("is still deterministic given the same history", () => {
    const recent = ["It travelled to get here"];
    const first = pickHook({ category: "chain", seed: "x", recent });
    for (let i = 0; i < 10; i++)
      expect(pickHook({ category: "chain", seed: "x", recent })).toEqual(first);
  });

  it("treats an empty history exactly like no history", () => {
    expect(pickHook({ category: "chain", seed: "x", recent: [] })).toEqual(
      pickHook({ category: "chain", seed: "x" }),
    );
  });

  it("looks no further back than three", () => {
    const family = allHooks()
      .filter((h) => h.category === "tribe_rivals")
      .map((h) => h.hook.headline);
    // All four blocked would leave nothing; only the newest three are honoured,
    // so the fourth is available again.
    const next = pickHook({ category: "tribe_rivals", seed: "x", recent: family });
    expect(family).toContain(next.headline);
  });

  /**
   * A BLANK HEADLINE IS WORSE THAN A FAMILIAR ONE. Repeating a hook costs a
   * little novelty; returning nothing costs the reader the sentence that tells
   * them what this moment is.
   */
  it("still returns a hook when every variant is recent", () => {
    for (const category of CATEGORIES) {
      const family = allHooks()
        .filter((h) => h.category === category)
        .map((h) => h.hook.headline);
      const hook = pickHook({ category, seed: "x", recent: family.slice(0, 3) });
      expect(hook.headline.length).toBeGreaterThan(0);
      expect(family).toContain(hook.headline);
    }
  });
});

/* ── What every variant must satisfy ───────────────────────────────────────── */

describe("every variant, held to the same constraints", () => {
  it("covers every category the resolver can produce", () => {
    const covered = new Set(allHooks().map((h) => h.category));
    for (const c of CATEGORIES) expect(covered).toContain(c);
  });

  it("respects the length limits", () => {
    for (const { category, hook } of allHooks()) {
      expect(words(hook.headline), `${category}: ${hook.headline}`).toBeLessThanOrEqual(
        HEADLINE_MAX_WORDS,
      );
      if (hook.support)
        expect(words(hook.support), `${category}: ${hook.support}`).toBeLessThanOrEqual(
          SUPPORT_MAX_WORDS,
        );
    }
  });

  it("never stacks two rhetorical questions", () => {
    for (const { category, hook } of allHooks()) {
      const questions = (said(hook).match(/\?/g) ?? []).length;
      expect(questions, `${category}: ${said(hook)}`).toBeLessThanOrEqual(1);
    }
  });

  it("says no banned word", () => {
    for (const { hook } of allHooks()) {
      const text = said(hook).toLowerCase();
      for (const banned of COPY_BANNED) expect(text, `${banned} :: ${text}`).not.toContain(banned);
    }
  });

  /**
   * NO UNSUPPORTED SOCIAL CLAIM. A hook is chosen from a category, not from a
   * count, so it can never see how many people are involved — which means any
   * number, any crowd and any claim that somebody agreed would be invented on a
   * screen that has no way to check it.
   */
  it("names no number, no crowd and nobody in particular", () => {
    for (const { category, hook } of allHooks()) {
      const text = said(hook);
      expect(text, category).not.toMatch(/\d/);
      expect(text, category).not.toMatch(/\b(everyone|everybody|thousands|millions)\b/i);
      expect(text, category).not.toMatch(/\bagree(s|d)?\b/i);
      expect(text, category).not.toMatch(/\b\d+\s+(people|believers|tables)\b/i);
    }
  });

  /**
   * A CALL ROW IS NOT A PERSON WHO SHOWED UP.
   *
   * "You showed up for them" is allowed and is the brief's own baseline, because
   * it is a claim about the READER'S confirmed act — reciprocity is only ever a
   * candidate where the canonical `answered` facts exist. What no hook may say
   * is that somebody ELSE showed up: the copy layer is handed a category, never
   * a response, so a third-party show-up claim would be read off a call row.
   * "See who shows up for you" is a question about the future, not a claim.
   */
  it("only ever says the reader showed up, never anybody else", () => {
    for (const { category, hook } of allHooks())
      for (const [, subject] of said(hook)
        .toLowerCase()
        .matchAll(/(\S+)\s+showed up/g))
        expect(subject, `${category}: ${said(hook)}`).toBe("you");
  });

  /**
   * STILL FORMING MEANS THE MAP IS UNCLEAR. It must never become "somebody
   * interesting is out there", which is the sentence that would turn the most
   * carefully bounded provenance rule in the product into random discovery.
   */
  it("keeps Still Forming about the map, not about discovery", () => {
    for (const { hook } of allHooks().filter((h) => h.category === "still_forming")) {
      const text = said(hook).toLowerCase();
      expect(text).not.toMatch(/discover|stranger|new people|somebody out there|find people/);
      expect(text).toMatch(/map|pattern|answer|clear/);
    }
  });

  it("never frames a Rival as being against the reader", () => {
    for (const { hook } of allHooks().filter((h) => h.category === "tribe_rivals"))
      expect(said(hook).toLowerCase()).not.toMatch(/against|attack|beat them|prove them wrong/);
    for (const { category, hook } of allHooks())
      expect(said(hook).toLowerCase(), category).not.toContain("against you");
  });

  it("uses no casino language anywhere", () => {
    for (const { category, hook } of allHooks())
      expect(said(hook).toLowerCase(), category).not.toMatch(
        /jackpot|bet\b|wager|odds|payout|spin|prize|lucky|win big/,
      );
  });

  it("uses no feature language in a headline", () => {
    for (const { category, hook } of allHooks())
      expect(hook.headline.toLowerCase(), category).not.toMatch(
        /feature|dashboard|profile|settings|tap here|click|swipe|now available/,
      );
  });

  it("gives an exit one flat variant and nothing rousing", () => {
    const exits = allHooks().filter((h) => h.category === "exit");
    expect(exits).toHaveLength(1);
    expect(exits[0].hook.support).toBeNull();
    expect(said(exits[0].hook)).not.toMatch(/!/);
  });

  it("writes every variant as a distinct sentence", () => {
    const headlines = allHooks().map((h) => h.hook.headline.trim().toLowerCase());
    expect(new Set(headlines).size).toBe(headlines.length);
  });
});

/* ── The boundary ──────────────────────────────────────────────────────────── */

describe("copy is decoration, never a second state machine", () => {
  /**
   * THE CTA HELPER STAYS THE CTA SOURCE. A rotating button label is a rotating
   * promise: "Challenge Maya" and "Challenge all 6" are different offers, and a
   * copy module that could produce either would be deciding who gets reached.
   */
  it("produces no CTA text, and leaves challengeLabel the only source of one", () => {
    for (const { category, hook } of allHooks())
      expect(said(hook), category).not.toMatch(/^Challenge |Next Question|Make room|View Market/);

    expect(
      challengeLabel({
        status: "available",
        total: 6,
        singleRecipientName: null,
        formingOnly: false,
      }),
    ).toBe("Challenge all 6");
  });

  it("has no way to state a count, a state or a destination", () => {
    const hook = pickHook({ category: "reciprocity", seed: "2815" });
    expect(Object.keys(hook).sort()).toEqual(["headline", "support"]);
  });

  it("counts words the way the limits are written", () => {
    expect(words("")).toBe(0);
    expect(words("   ")).toBe(0);
    expect(words("one")).toBe(1);
    expect(words("  two  words  ")).toBe(2);
  });
});
