import { describe, expect, it } from "vitest";
import { classifyLiveRow } from "@/domain/live-taxonomy";

describe("classifyLiveRow", () => {
  it("elevates any network actor to personal, regardless of the event", () => {
    const twin = classifyLiveRow({
      kind: "trade_burst",
      walletCount: 1,
      face: { relationship: "twin" },
      payload: { action: "BUY" },
    });
    expect(twin.klass).toBe("personal");
    expect(twin.icon).toBe("🧬");

    const network = classifyLiveRow({
      kind: "large_trade",
      walletCount: 1,
      face: { relationship: "opp" },
      payload: { action: "SELL" },
    });
    expect(network.klass).toBe("personal");
    expect(network.icon).toBe("🤝");
  });

  it("treats a new market and a crowd of new believers as community", () => {
    expect(classifyLiveRow({ kind: "market_created", walletCount: null }).klass).toBe("community");
    const crowd = classifyLiveRow({
      kind: "trade_burst",
      walletCount: 18,
      payload: { action: "BUY" },
    });
    expect(crowd.klass).toBe("community");
    expect(crowd.icon).toBe("👥");
  });

  it("keeps solo trades, sells, flips, and round-trips as neutral market activity", () => {
    expect(
      classifyLiveRow({ kind: "trade_burst", walletCount: 1, payload: { action: "BUY" } }),
    ).toEqual({ klass: "market", icon: "💰" });
    expect(
      classifyLiveRow({ kind: "trade_burst", walletCount: 5, payload: { action: "SELL" } }).icon,
    ).toBe("📉");
    expect(classifyLiveRow({ kind: "side_shift", walletCount: 1 }).icon).toBe("🔀");
    expect(classifyLiveRow({ kind: "round_trip", walletCount: 1 }).icon).toBe("🔁");
  });

  it("does not treat a multi-wallet SELL burst as the tribe growing", () => {
    const sells = classifyLiveRow({
      kind: "trade_burst",
      walletCount: 9,
      payload: { action: "SELL" },
    });
    expect(sells.klass).toBe("market");
  });
});
