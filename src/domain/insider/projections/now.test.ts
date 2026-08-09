import { describe, it, expect } from "vitest";
import { arrangeFeed, tailState } from "../../live-display";
import { mixFeed, type MixCandidate } from "../../feed-cadence";
import { now, nowRanking, type NowRow } from "./now";

const at = (h: number) => new Date(Date.UTC(2026, 0, 1, h)).toISOString();

const cand = (id: string, over: Partial<MixCandidate> = {}): MixCandidate =>
  ({
    id,
    kind: "trade",
    marketId: "1",
    occurredAt: at(1),
    significance: 0.5,
    ...over,
  }) as unknown as MixCandidate;

const row = (id: string, hour: number, over: Partial<NowRow> = {}): NowRow => ({
  id,
  occurredAt: at(hour),
  mix: cand(id, { occurredAt: at(hour) }),
  ...over,
});

const rows: NowRow[] = [
  row("a", 1),
  row("b", 3, { mix: cand("b", { occurredAt: at(3), significance: 0.9 }) }),
  row("c", 2),
  { id: "standing", occurredAt: at(0), timeless: true },
];

describe("insider now — the editorial pass the tape used to run inline", () => {
  it("reproduces rank → window → time order exactly", () => {
    const rank = new Map<string, number>();
    mixFeed(rows.map((r) => r.mix).filter((m): m is MixCandidate => m != null)).forEach((m, i) =>
      rank.set(m.id, i),
    );
    const expected = arrangeFeed(rows, { rankOf: (id) => rank.get(id), limit: 2 });
    const got = now(rows, { limit: 2 });
    expect(got.shown.map((r) => r.id)).toEqual(expected.shown.map((r) => r.id));
    expect(got.hidden).toBe(expected.hidden);
  });

  it("names the same tail state as the tape's own call", () => {
    const got = now(rows, { limit: 2, pending: 0, loading: false });
    expect(got.tail).toBe(
      tailState({ shown: got.shown.length, hidden: got.hidden, pending: 0, loading: false }),
    );
    expect(now([], { limit: 10 }).tail).toBe("empty");
    expect(now(rows, { limit: 99, pending: 3 }).tail).toBe("streaming");
  });

  it("an unlimited (embedded) tape keeps the caller's order untouched", () => {
    expect(now(rows, { limit: null }).shown.map((r) => r.id)).toEqual([
      "a",
      "b",
      "c",
      "standing",
    ]);
  });

  it("ranks against the whole pool, not only the released rows", () => {
    const released = [rows[0]];
    const got = now(released, { limit: 1, rankOver: rows });
    expect(got.shown.map((r) => r.id)).toEqual(["a"]);
  });

  it("pinned rows lead the column", () => {
    const got = now(rows, { limit: 2, pinned: new Set(["a"]) });
    expect(got.shown[0].id).toBe("a");
  });

  it("no mix anywhere ⇒ no ranking, recency decides", () => {
    const plain = rows.map(({ id, occurredAt }) => ({ id, occurredAt }));
    expect(nowRanking(plain)).toBeNull();
    expect(now(plain, { limit: 2 }).shown.map((r) => r.id)).toEqual(["b", "c"]);
  });
});
