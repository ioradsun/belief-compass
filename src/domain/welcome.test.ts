import { describe, expect, it } from "vitest";
import {
  selectWelcomable,
  summarizeReceived,
  welcomeKey,
  type DirectionalEvent,
  type Side,
} from "@/domain/welcome";

const ev = (
  wallet: string,
  marketId: number,
  newSide: Side,
  occurredAt = "2026-01-01",
): DirectionalEvent => ({
  wallet,
  marketId,
  newSide,
  occurredAt,
});

describe("selectWelcomable", () => {
  const positions = new Map<number, Side>([
    [1, "YES"],
    [2, "NO"],
  ]);

  it("keeps only new believers on the side the viewer holds", () => {
    const out = selectWelcomable({
      viewer: "0xME",
      positions,
      events: [ev("0xA", 1, "YES"), ev("0xB", 1, "NO"), ev("0xC", 2, "NO"), ev("0xD", 2, "YES")],
      alreadyWelcomed: new Set(),
    });
    expect(out.map((w) => w.wallet)).toEqual(["0xa", "0xc"]);
  });

  it("excludes the viewer and markets the viewer does not hold", () => {
    const out = selectWelcomable({
      viewer: "0xME",
      positions,
      events: [ev("0xme", 1, "YES"), ev("0xA", 99, "YES")],
      alreadyWelcomed: new Set(),
    });
    expect(out).toEqual([]);
  });

  it("excludes anyone already welcomed and dedupes to one offer per tribe", () => {
    const out = selectWelcomable({
      viewer: "0xME",
      positions,
      events: [ev("0xA", 1, "YES"), ev("0xA", 1, "YES"), ev("0xB", 1, "YES")],
      alreadyWelcomed: new Set([welcomeKey("0xB", 1, "YES")]),
    });
    expect(out.map((w) => w.wallet)).toEqual(["0xa"]);
  });

  it("honors the cap", () => {
    const events = Array.from({ length: 10 }, (_, i) => ev(`0x${i}`, 1, "YES"));
    expect(
      selectWelcomable({ viewer: "0xME", positions, events, alreadyWelcomed: new Set(), cap: 3 }),
    ).toHaveLength(3);
  });
});

describe("summarizeReceived", () => {
  it("counts each welcomer once and names a single shared tribe", () => {
    const s = summarizeReceived([
      { welcomer: "0xA", marketId: 1, side: "YES" },
      { welcomer: "0xA", marketId: 1, side: "YES" },
      { welcomer: "0xB", marketId: 1, side: "YES" },
    ]);
    expect(s.count).toBe(2);
    expect(s.tribe).toEqual({ marketId: 1, side: "YES" });
  });

  it("returns no single tribe when welcomes span more than one", () => {
    const s = summarizeReceived([
      { welcomer: "0xA", marketId: 1, side: "YES" },
      { welcomer: "0xB", marketId: 2, side: "NO" },
    ]);
    expect(s.count).toBe(2);
    expect(s.tribe).toBeNull();
  });
});
