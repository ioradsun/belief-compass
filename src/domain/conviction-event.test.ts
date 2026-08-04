import { describe, it, expect } from "vitest";
import {
  classifyConvictionEvent,
  tellConvictionStory,
  heldFor,
  CONVICTION_EVENT,
  type ConvictionEvent,
} from "./conviction-event";

const ev = (o: Partial<ConvictionEvent> = {}): ConvictionEvent => ({
  action: "enter",
  side: "YES",
  actor: { name: "duckfacts.eth", relationship: null },
  ...o,
});

describe("the same action becomes a different story", () => {
  it("an exit is 'left' with no context", () => {
    expect(classifyConvictionEvent(ev({ action: "exit" }))).toBe("left");
  });

  it("...'lost conviction' when they had held it a long time", () => {
    const e = ev({ action: "exit", context: { daysHeld: 43 } });
    expect(classifyConvictionEvent(e)).toBe("long_held_exit");
    const s = tellConvictionStory(e);
    expect(s.headline).toBe("LOST CONVICTION");
    expect(s.body).toBe("duckfacts.eth gave up on YES after 43 days.");
  });

  it("...'biggest believer left' when they were the largest", () => {
    const e = ev({ action: "exit", context: { rank: 1, amountUsd: 2800, daysHeld: 43 } });
    expect(classifyConvictionEvent(e)).toBe("biggest_believer_left");
    expect(tellConvictionStory(e).body).toBe("The biggest believer in YES walked with $2,800.");
  });

  it("...'last believer left' when the side just emptied — the strongest of all", () => {
    const e = ev({ action: "exit", context: { rank: 1, daysHeld: 90, sideBelieversAfter: 0 } });
    expect(classifyConvictionEvent(e)).toBe("last_believer_left");
    const s = tellConvictionStory(e);
    expect(s.headline).toBe("LAST BELIEVER LEFT");
    expect(s.body).toBe("duckfacts.eth was the last one backing YES.");
  });
});

describe("commitment reads as commitment", () => {
  it("a buy on top of an existing position is doubling down, not another buy", () => {
    const e = ev({ action: "add", context: { amountUsd: 640 } });
    expect(classifyConvictionEvent(e)).toBe("doubled_down");
    expect(tellConvictionStory(e).headline).toBe("DOUBLED DOWN");
    expect(tellConvictionStory(e).body).toBe("duckfacts.eth added to YES with $640.");
  });

  it("the very first believer on a side is named as such", () => {
    const e = ev({ context: { sideBelieversAfter: 1 } });
    expect(classifyConvictionEvent(e)).toBe("first_believer");
    expect(tellConvictionStory(e).body).toBe("duckfacts.eth is the first to back YES.");
  });

  it("size alone earns its own event", () => {
    expect(classifyConvictionEvent(ev({ context: { amountUsd: 8400 } }))).toBe("big_backing");
  });
});

describe("reversal", () => {
  it("a flip names the change of mind and how long the old belief lasted", () => {
    const e = ev({ action: "flip", side: "NO", context: { daysHeld: 41 } });
    const s = tellConvictionStory(e);
    expect(s.headline).toBe("CHANGED THEIR MIND");
    expect(s.body).toBe("duckfacts.eth flipped to NO after 41 days.");
  });

  it("without tenure it still reads, just quieter", () => {
    const s = tellConvictionStory(ev({ action: "flip", side: "NO" }));
    expect(s.body).toBe("duckfacts.eth flipped to NO.");
  });
});

describe("weak data, weak claim", () => {
  it("every event produces a sentence with no context at all", () => {
    const actions = ["enter", "add", "reduce", "exit", "flip", "round_trip"] as const;
    for (const action of actions) {
      const s = tellConvictionStory(ev({ action }));
      expect(s.body.length).toBeGreaterThan(0);
      expect(s.body.endsWith(".")).toBe(true);
      // Nothing invented: no number appears that wasn't given.
      expect(s.body).not.toMatch(/\$|\d+ days/);
    }
  });

  it("never states a tenure it wasn't told", () => {
    const s = tellConvictionStory(ev({ action: "exit", context: { daysHeld: null } }));
    expect(s.body).not.toMatch(/after/);
  });

  it("carries at most ONE supporting clause", () => {
    const s = tellConvictionStory(
      ev({ action: "exit", context: { amountUsd: 5000, daysHeld: 90, rank: 1 } }),
    );
    // "with $5,000 after 90 days" would be a record, not a sentence.
    expect(s.body.match(/ with | after /g)?.length ?? 0).toBeLessThanOrEqual(1);
  });
});

describe("the network stays side-blind", () => {
  it("never reveals which way someone in your network moved", () => {
    for (const relationship of ["twin", "tribe", "opp", "inverse"] as const) {
      for (const action of ["enter", "add", "reduce", "exit", "flip"] as const) {
        const s = tellConvictionStory(
          ev({ action, actor: { name: "Maya", relationship }, context: { daysHeld: 60 } }),
        );
        expect(`${s.headline} ${s.body} ${s.attribution ?? ""}`).not.toMatch(/\bYES\b|\bNO\b/);
        expect(s.personal).toBe(true);
        expect(s.tone).toBe("neutral");
      }
    }
  });

  it("belonging outranks the mechanics of what they did", () => {
    const s = tellConvictionStory(
      ev({ action: "exit", actor: { name: "Maya", relationship: "twin" }, context: { rank: 1 } }),
    );
    expect(s.headline).toBe("YOUR TWIN");
  });

  it("tenure is safe to state — it shows commitment, not direction", () => {
    const s = tellConvictionStory(
      ev({
        action: "exit",
        actor: { name: "Maya", relationship: "tribe" },
        context: { daysHeld: 90 },
      }),
    );
    expect(s.body).toBe("Maya stepped back after 3 months.");
  });
});

describe("copy discipline", () => {
  const all: ConvictionEvent[] = [
    ev(),
    ev({ action: "add", context: { amountUsd: 640 } }),
    ev({ action: "reduce", context: { amountUsd: 200 } }),
    ev({ action: "exit", context: { daysHeld: 43 } }),
    ev({ action: "exit", context: { sideBelieversAfter: 0 } }),
    ev({ action: "exit", context: { rank: 1, amountUsd: 2800 } }),
    ev({ action: "flip", side: "NO", context: { daysHeld: 41 } }),
    ev({ action: "round_trip" }),
    ev({ action: "open_market", side: null, context: { question: "Will it rain?" } }),
    ev({ action: "milestone", context: { threshold: 500 } }),
    ev({ action: "surge" }),
    ev({ actor: { name: "Maya", relationship: "twin" } }),
  ];

  it("the kicker is never a sentence", () => {
    for (const e of all) {
      const h = tellConvictionStory(e).headline;
      expect(h).not.toMatch(/\.$/);
      expect(h.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(3);
    }
  });

  it("money is never the subject of a sentence", () => {
    for (const e of all) expect(tellConvictionStory(e).body.startsWith("$")).toBe(false);
  });

  it("the attribution never restates the body", () => {
    for (const e of all) {
      const s = tellConvictionStory(e);
      if (!s.attribution) continue;
      expect(s.body.includes(s.attribution.replace(/\.$/, ""))).toBe(false);
    }
  });

  it("never uses hype or plumbing words", () => {
    const banned =
      /whale|smart money|moon|degen|pouring|exploding|wallet|address|transaction|holder/i;
    for (const e of all) {
      const s = tellConvictionStory(e);
      expect(`${s.headline} ${s.body} ${s.attribution ?? ""}`).not.toMatch(banned);
    }
  });

  it("says nothing rather than something empty", () => {
    // "0 believers now." is not a fact worth a line.
    const s = tellConvictionStory(ev({ action: "exit", context: { sideBelieversAfter: 0 } }));
    expect(s.attribution).toBeNull();
  });
});

describe("heldFor", () => {
  it("reads in the unit a person would use", () => {
    expect(heldFor(0)).toBe("a day");
    expect(heldFor(1)).toBe("a day");
    expect(heldFor(43)).toBe("43 days");
    expect(heldFor(90)).toBe("3 months");
    expect(heldFor(400)).toBe("over a year");
  });

  /**
   * A belief that was already there when the index opened has no knowable
   * start (src/domain/tenure). Stating "43 days" for it is the actual lie —
   * the honest claim is smaller, and smaller is what we say.
   */
  it("states a floor when the tenure predates what we can see", () => {
    expect(heldFor(43, true)).toBe("43+ days");
    expect(heldFor(90, true)).toBe("3+ months");
    expect(heldFor(1, true)).toBe("at least a day");
    expect(heldFor(400, true)).toBe("at least a year");
  });
});

describe("an unknowable tenure never reads as a precise one", () => {
  it("marks the clause on an exit that carries its tenure", () => {
    const exact = tellConvictionStory({
      action: "exit",
      side: "YES",
      context: { daysHeld: 43 },
    });
    const floored = tellConvictionStory({
      action: "exit",
      side: "YES",
      context: { daysHeld: 43, tenureIsFloor: true },
    });
    expect(exact.body).toContain("43 days");
    expect(floored.body).toContain("43+ days");
  });

  it("marks it for a network member leaving, where tenure is the whole point", () => {
    const floored = tellConvictionStory({
      action: "exit",
      side: "YES",
      actor: { name: "Kate", relationship: "tribe" },
      context: { daysHeld: 60, tenureIsFloor: true },
    });
    expect(floored.body).toContain("2+ months");
  });

  it("says nothing different when the tenure IS knowable", () => {
    const a = tellConvictionStory({ action: "exit", side: "NO", context: { daysHeld: 43 } });
    const b = tellConvictionStory({
      action: "exit",
      side: "NO",
      context: { daysHeld: 43, tenureIsFloor: false },
    });
    expect(b.body).toBe(a.body);
  });
});

describe("thresholds are centralized", () => {
  it("long-held and big mean one thing everywhere", () => {
    expect(CONVICTION_EVENT.longHeldDays).toBe(30);
    expect(CONVICTION_EVENT.bigUsd).toBe(1_000);
    // Just under the line stays an ordinary move.
    expect(classifyConvictionEvent(ev({ action: "exit", context: { daysHeld: 29 } }))).toBe("left");
    expect(classifyConvictionEvent(ev({ context: { amountUsd: 999 } }))).toBe("joined");
  });
});
