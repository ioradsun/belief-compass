import { describe, it, expect } from "vitest";
import {
  isLineFresh,
  positionStory,
  positionSignal,
  STORY_RANK,
  type PositionStoryInput,
} from "./position-story";

const base = (o: Partial<PositionStoryInput> = {}): PositionStoryInput => ({
  side: "YES",
  believers: 35,
  ...o,
});

/** A canonical line exactly as the read model stores it. */
const live = (
  kind: string,
  payload: Record<string, unknown> = {},
  window: string | null = "24h",
  line = "canonical.",
) => ({ kind, payload, window, line });

describe("positionStory — one story, owner-first priority", () => {
  it("your Twin outranks everything", () => {
    const s = positionStory(
      base({ net: { twin: true, tribe: true }, milestone: 50, live: live("new_believers") }),
    );
    expect(s.kind).toBe("twin");
  });

  it("says which way they went when it knows", () => {
    const withYou = positionStory(base({ side: "YES", net: { twin: "YES" } }));
    const againstYou = positionStory(base({ side: "YES", net: { twin: "NO" } }));
    expect(withYou.headline).toBe("Your Conviction Twin just backed YES.");
    expect(againstYou.headline).toBe("Your Conviction Twin just backed NO.");
    expect(withYou.body).toBeUndefined();
    expect(againstYou.body).toBe("Your closest match is on the other side of you.");
  });

  it("still speaks when only the movement is known", () => {
    expect(positionStory(base({ net: { twin: true } })).headline).toBe(
      "Your Conviction Twin just entered this market.",
    );
  });
  it("Tribe outranks Opp and a milestone", () => {
    expect(positionStory(base({ net: { tribe: true, opp: true }, milestone: 50 })).kind).toBe(
      "tribe",
    );
  });
  it("Opp outranks a milestone", () => {
    expect(positionStory(base({ net: { opp: true }, milestone: 50 })).kind).toBe("opp");
  });
});

describe("positionStory — the CANONICAL line, told from the owner's seat", () => {
  it("new believers on your side reads as your side filling up", () => {
    const s = positionStory(
      base({ side: "YES", believers: 35, live: live("new_believers", { wallets: 6, side: "YES" }) }),
    );
    expect(s.kind).toBe("believers_your_side");
    expect(s.headline).toBe("6 people joined YES today.");
    expect(s.body).toBe("35 now back YES.");
  });

  it("new believers on the OTHER side is different news for an owner", () => {
    const s = positionStory(
      base({ side: "YES", live: live("new_believers", { wallets: 2, side: "NO" }, "1h") }),
    );
    expect(s.kind).toBe("believers_other_side");
    expect(s.headline).toBe("2 people backed NO in the last hour.");
    expect(s.tone).toBe("down");
  });

  it("uses the window the read model recorded, never a different one", () => {
    const s = positionStory(
      base({ live: live("new_believers", { wallets: 1, side: "YES" }, "7d") }),
    );
    expect(s.headline).toBe("1 person joined YES in the last 7 days.");
  });

  it("an overtake toward your side is good news, away from it is bad", () => {
    const mine = positionStory(base({ side: "YES", live: live("side_overtake", { crossed: "YES_over_NO" }) }));
    const theirs = positionStory(base({ side: "YES", live: live("side_overtake", { crossed: "NO_over_YES" }) }));
    expect(mine.kind).toBe("side_overtake");
    expect(mine.headline).toBe("YES just became the majority.");
    expect(mine.tone).toBe("up");
    expect(theirs.headline).toBe("NO just overtook YES.");
    expect(theirs.tone).toBe("down");
  });

  it("passes a milestone through from the canonical line", () => {
    const s = positionStory(base({ live: live("believer_milestone", { milestone: 50 }, "all") }));
    expect(s.kind).toBe("milestone");
    expect(s.headline).toBe("This market just reached 50 believers.");
  });

  it("never claims money favoured a side — the read model does not know that", () => {
    const s = positionStory(
      base({
        side: "YES",
        live: live("capital_flow", { volume_usd: 1.91 }, "1h", "$1.91 traded in the last hour."),
      }),
    );
    expect(s.kind).toBe("capital");
    expect(s.headline).toBe("Money moved here — $1.91 traded in the last hour.");
    expect(s.headline).not.toMatch(/without new believers/i);
    expect(s.headline).not.toMatch(/into (YES|NO)/);
  });

  it("reports selling pressure as the read model measured it", () => {
    const s = positionStory(base({ live: live("sell_pressure", { sell_rate: 0.5 }) }));
    expect(s.kind).toBe("selling");
    expect(s.headline).toBe("Selling rose to 50% of trades today.");
  });
});

describe("positionStory — no canonical evidence, no invented story", () => {
  it("is still early when a side is barely formed", () => {
    const s = positionStory(base({ believers: 8 }));
    expect(s.kind).toBe("early");
    expect(s.headline).toBe("Only 8 people back YES so far.");
  });
  it("is quiet as the last resort", () => {
    const s = positionStory(base({ believers: 200 }));
    expect(s.kind).toBe("quiet");
    expect(s.headline).toBe("Nothing changed today — 200 still back YES.");
  });
  /** The bug this rewrite exists for: a drifting price % used to print a
   *  capital story on nearly every card. There is no price input any more. */
  it("tells no capital story without a canonical capital line", () => {
    expect(positionStory(base({ believers: 200, live: null })).kind).toBe("quiet");
  });
});

describe("positionSignal — urgency ranks the list", () => {
  it("a Twin card ranks above a quiet card", () => {
    const twin = positionSignal(base({ net: { twin: true } }));
    const quiet = positionSignal(base({ believers: 200 }));
    expect(twin.urgency).toBeGreaterThan(quiet.urgency);
    expect(twin.urgency).toBe(STORY_RANK.twin);
  });
  it("your side ranks above the other side, which ranks above capital", () => {
    expect(STORY_RANK.believers_your_side).toBeGreaterThan(STORY_RANK.believers_other_side);
    expect(STORY_RANK.believers_other_side).toBeGreaterThan(STORY_RANK.capital);
  });
});

describe("copy discipline", () => {
  it("never uses portfolio words", () => {
    const banned = /\bshares?\b|\bunits?\b|\bwallet\b|\bholder\b|\bvolume\b|\btoken\b/i;
    const inputs: PositionStoryInput[] = [
      base({ net: { twin: true } }),
      base({ net: { tribe: true } }),
      base({ net: { opp: true } }),
      base({ milestone: 100 }),
      base({ live: live("new_believers", { wallets: 9, side: "YES" }) }),
      base({ live: live("new_believers", { wallets: 9, side: "NO" }) }),
      base({ live: live("sell_pressure", { sell_rate: 0.6 }) }),
      base({ believers: 5 }),
      base({ believers: 300 }),
    ];
    for (const i of inputs) {
      const s = positionStory(i);
      expect(`${s.headline} ${s.body ?? ""}`).not.toMatch(banned);
    }
  });
});

describe("staleness — a line is only told while it is still true", () => {
  const NOW = Date.parse("2026-08-06T12:00:00Z");
  const at = (hoursAgo: number) => new Date(NOW - hoursAgo * 3_600_000).toISOString();

  it("tells a fresh 24h line", () => {
    const s = positionStory({
      ...base(),
      nowMs: NOW,
      live: { ...live("new_believers", { wallets: 6, side: "YES" }), occurredAt: at(5) },
    });
    expect(s.kind).toBe("believers_your_side");
  });

  /** "6 people joined YES today" stops being true once today has passed. */
  it("falls back to the standing state when the line has aged out", () => {
    const s = positionStory({
      ...base({ believers: 200 }),
      nowMs: NOW,
      live: { ...live("new_believers", { wallets: 6, side: "YES" }), occurredAt: at(72) },
    });
    expect(s.kind).toBe("quiet");
  });

  it("holds a 1h line to a much tighter clock than a 7d line", () => {
    const oneHour = { ...live("capital_flow", {}, "1h"), occurredAt: at(12) };
    const sevenDay = { ...live("capital_flow", {}, "7d"), occurredAt: at(12) };
    expect(isLineFresh(oneHour, NOW)).toBe(false);
    expect(isLineFresh(sevenDay, NOW)).toBe(true);
  });

  it("keeps telling a line whose timestamp is unknown", () => {
    expect(isLineFresh(live("new_believers", { wallets: 2, side: "YES" }), NOW)).toBe(true);
  });
});
