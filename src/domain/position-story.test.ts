import { describe, it, expect } from "vitest";
import {
  positionStory,
  isLineFresh,
  type PositionStoryInput,
  type CanonicalLine,
} from "./position-story";

const base: PositionStoryInput = { side: "YES", believers: 40 };
const at = (ms: number) => new Date(ms).toISOString();
const NOW = Date.parse("2025-01-10T12:00:00Z");

const line = (l: Partial<CanonicalLine>): CanonicalLine => ({
  line: "x",
  kind: null,
  window: "24h",
  occurredAt: at(NOW),
  payload: {},
  ...l,
});

const story = (i: Partial<PositionStoryInput>) =>
  positionStory({ ...base, nowMs: NOW, ...i });

describe("positionStory — the canonical line, told from the owner's seat", () => {
  it("new believers on your side reads as your side filling up", () => {
    const s = story({
      live: line({ kind: "new_believers", payload: { wallets: 6, side: "YES" } }),
      believerDelta: 6,
    });
    expect(s?.kind).toBe("believers_your_side");
    expect(s?.headline).toBe("YES gained 6 people today.");
    expect(s?.tone).toBe("up");
  });

  it("leads with a reconciled loss when gross arrivals hide larger exits", () => {
    const s = story({
      live: line({ kind: "new_believers", payload: { wallets: 6, side: "YES" } }),
      believerDelta: -2,
    });
    expect(s?.headline).toBe("YES lost 2 people today.");
    expect(s?.body).toContain("but even more left or flipped");
    expect(s?.tone).toBe("down");
  });

  it("does not turn gross arrivals into a side story without a net delta", () => {
    expect(
      story({ live: line({ kind: "new_believers", payload: { wallets: 6, side: "YES" } }) }),
    ).toBeNull();
  });

  it("new believers on the OTHER side is different news for an owner", () => {
    const s = story({
      live: line({ kind: "new_believers", payload: { wallets: 4, side: "NO" } }),
    });
    expect(s?.kind).toBe("believers_other_side");
    expect(s?.headline).toBe("4 people backed NO today.");
  });

  it("uses the window the read model recorded, never a different one", () => {
    const s = story({
      live: line({ kind: "new_believers", window: "1h", payload: { wallets: 3, side: "NO" } }),
    });
    expect(s?.headline).toBe("3 people backed NO in the last hour.");
  });

  it("an overtake toward your side is good news, away from it is bad", () => {
    const mine = story({
      live: line({ kind: "side_overtake", payload: { crossed: "YES_over_NO" } }),
    });
    const theirs = story({
      live: line({ kind: "side_overtake", payload: { crossed: "NO_over_YES" } }),
    });
    expect(mine?.headline).toBe("YES just became the majority.");
    expect(mine?.tone).toBe("up");
    expect(theirs?.headline).toBe("NO just overtook YES.");
    expect(theirs?.tone).toBe("down");
  });

  it("passes a milestone through from the canonical line", () => {
    const s = story({
      live: line({ kind: "believer_milestone", window: "all", payload: { milestone: 100 } }),
    });
    expect(s?.kind).toBe("milestone");
    expect(s?.headline).toContain("100");
  });

  it("never claims money favoured a side — the read model does not know that", () => {
    const s = story({ live: line({ kind: "capital_flow", line: "$420 traded today." }) });
    expect(s?.kind).toBe("capital");
    expect(s?.headline).toBe("Money moved here — $420 traded today.");
    expect(s?.headline).not.toMatch(/into (YES|NO)/);
  });

  it("reports selling pressure as the read model measured it", () => {
    const s = story({ live: line({ kind: "sell_pressure", payload: { sell_rate: 0.62 } }) });
    expect(s?.headline).toBe("Selling rose to 62% of trades today.");
  });
});

// §15 G/I — silence is a valid card state, and Positions cannot upgrade a fact.
describe("silence — no eligible shared intelligence, no line", () => {
  it("says nothing when the market has no canonical line at all", () => {
    expect(story({ live: null })).toBeNull();
    expect(story({})).toBeNull();
  });

  it("stays silent on a 7d continuity line (the producer's own fallback rung)", () => {
    expect(
      story({
        live: line({ kind: "new_believers", window: "7d", payload: { wallets: 1, side: "NO" } }),
      }),
    ).toBeNull();
  });

  it("stays silent on 7d capital flow", () => {
    expect(story({ live: line({ kind: "capital_flow", window: "7d" }) })).toBeNull();
  });

  it("invents no standing-state filler for a barely formed side", () => {
    expect(story({ believers: 2, live: null })).toBeNull();
  });

  it("cannot alter the factual content of the persisted line", () => {
    const s = story({ live: line({ kind: "sell_pressure", payload: { sell_rate: 0.62 } }) });
    // 62% in, 62% out — no rounding up, no re-scoring, no added claim.
    expect(s?.headline).toContain("62%");
  });
});

// §15 A/E/F — Positions builds no network intelligence and asks no questions.
describe("no second intelligence system", () => {
  it("has no Twin / Tribe / Opp story kinds left", () => {
    const kinds = ["side_overtake", "believer_milestone", "new_believers", "sell_pressure"];
    for (const k of kinds) {
      const s = story({ live: line({ kind: k, payload: { wallets: 2, side: "NO", crossed: "NO_over_YES", sell_rate: 0.5 } }) });
      expect(["twin", "tribe", "opp"]).not.toContain(s?.kind);
    }
  });

  it("never emits a question", () => {
    const s = story({ live: line({ kind: "sell_pressure", payload: { sell_rate: 0.6 } }) });
    expect(s?.headline.endsWith("?")).toBe(false);
    expect(s?.body ?? "").not.toContain("?");
  });

  it("never uses portfolio words", () => {
    const s = story({
      live: line({ kind: "new_believers", payload: { wallets: 3, side: "YES" } }),
      believerDelta: 3,
    });
    for (const w of ["portfolio", "P&L", "ROI", "position size"]) {
      expect(`${s?.headline} ${s?.body ?? ""}`).not.toContain(w);
    }
  });
});

describe("staleness — a line is only told while it is still true", () => {
  it("tells a fresh 24h line", () => {
    const s = story({
      live: line({
        kind: "new_believers",
        occurredAt: at(NOW - 3600_000),
        payload: { wallets: 2, side: "NO" },
      }),
    });
    expect(s?.kind).toBe("believers_other_side");
  });

  it("falls silent when the line has aged out", () => {
    expect(
      story({
        live: line({
          kind: "new_believers",
          occurredAt: at(NOW - 72 * 3600_000),
          payload: { wallets: 2, side: "NO" },
        }),
      }),
    ).toBeNull();
  });

  it("holds a 1h line to a much tighter clock than a 24h line", () => {
    const old1h = line({ kind: "new_believers", window: "1h", occurredAt: at(NOW - 8 * 3600_000) });
    expect(isLineFresh(old1h, NOW)).toBe(false);
    expect(isLineFresh({ ...old1h, window: "24h" }, NOW)).toBe(true);
  });

  it("keeps telling a line whose timestamp is unknown", () => {
    expect(isLineFresh(line({ occurredAt: null }), NOW)).toBe(true);
  });
});
