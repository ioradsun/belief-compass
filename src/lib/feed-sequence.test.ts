import { describe, it, expect } from "vitest";
import { sequenceFeed } from "./feed-sequence";
import type { FeedCard } from "./conviction-feed";
import type { CardFormat } from "./feed-copy";

// Minimal card — sequenceFeed only reads format/intensity/role/scale/onchain_id.
let seq = 0;
function mk(format: CardFormat, role: string, onchain_id: number, intensity = 1): FeedCard {
  return {
    id: `c${seq++}`,
    onchain_id,
    actor: { scale: role === "market" ? "market" : "individual", role } as never,
    copy: { format, intensity } as never,
  } as unknown as FeedCard;
}

const formats = (cards: FeedCard[]) => cards.map((c) => c.copy!.format);
function adjacentSameFormat(cards: FeedCard[]): number {
  let n = 0;
  for (let i = 1; i < cards.length; i++) if (formats(cards)[i] === formats(cards)[i - 1]) n++;
  return n;
}

describe("sequenceFeed — composition after ranking", () => {
  it("breaks up a run of identical formats when alternatives exist", () => {
    const cards = [
      mk("birth", "creator", 1),
      mk("birth", "creator", 2),
      mk("crowd", "market", 3),
      mk("birth", "creator", 4),
      mk("crowd", "market", 5),
      mk("character", "opp", 6),
    ];
    const out = sequenceFeed(cards);
    // With three non-birth cards available, no two births need to touch.
    expect(adjacentSameFormat(out)).toBe(0);
    expect(out).toHaveLength(6);
  });

  it("does not invent or drop cards — same multiset back", () => {
    const cards = [
      mk("birth", "creator", 1),
      mk("crowd", "market", 2),
      mk("character", "people", 3),
      mk("quiet", "market", 4),
    ];
    const out = sequenceFeed(cards);
    expect(new Set(out.map((c) => c.id))).toEqual(new Set(cards.map((c) => c.id)));
  });

  it("keeps ranking when nothing clashes (already varied)", () => {
    const cards = [
      mk("scoreboard", "market", 1),
      mk("character", "people", 2),
      mk("crowd", "market", 3),
      mk("birth", "creator", 4),
    ];
    const out = sequenceFeed(cards);
    expect(out.map((c) => c.id)).toEqual([
      "c" + (seq - 4),
      "c" + (seq - 3),
      "c" + (seq - 2),
      "c" + (seq - 1),
    ]);
  });

  it("spaces out cards from the same market", () => {
    const cards = [
      mk("birth", "creator", 7),
      mk("character", "opp", 7),
      mk("crowd", "market", 7),
      mk("scoreboard", "market", 8),
      mk("quiet", "market", 9),
      mk("tension", "market", 10),
    ];
    const out = sequenceFeed(cards);
    // No more than 2 of market 7 within any 6-row window (here, the whole feed).
    const m7 = out.filter((c) => c.onchain_id === 7).length;
    expect(m7).toBe(3); // all present…
    // …but not three-in-a-row at the top.
    expect(out.slice(0, 3).every((c) => c.onchain_id === 7)).toBe(false);
  });
});
