import { describe, it, expect } from "vitest";
import {
  signalVector,
  unusualness,
  dailyBaseline,
  relativeMove,
  priceBand,
  holdersBefore,
  emptyVector,
  type SignalFacts,
  BASELINE_MIN_7D_TRADES,
} from "./signal-vector";

const NOW = Date.UTC(2026, 7, 9, 12, 0, 0);

const base = (over: Partial<SignalFacts> = {}): SignalFacts => ({
  yesPrice: 2,
  yesPriceChange24h: 0,
  yesCapitalDelta24h: 0,
  noCapitalDelta24h: 0,
  tradeCount24h: 0,
  tradeCount7d: 0,
  newBelievers24h: 0,
  peopleYesChange24h: 0,
  sideFlips24h: 0,
  nowMs: NOW,
  ...over,
});

describe("canonical baseline", () => {
  it("refuses a baseline below the evidence gate", () => {
    expect(dailyBaseline(BASELINE_MIN_7D_TRADES - 1)).toBeNull();
    expect(dailyBaseline(null)).toBeNull();
    expect(dailyBaseline(14)).toBe(2);
  });

  it("one trade against a tiny denominator is not 80× unusual", () => {
    const u = unusualness(1, 1);
    expect(u.qualified).toBe(false);
    expect(u.value).toBe(0);
    expect(u.ratio).toBeNull();
  });

  it("sparse markets generate no anomaly at all", () => {
    const v = signalVector(base({ tradeCount24h: 1, tradeCount7d: 1 }));
    expect(v.signals.unusual).toBe(0);
    expect(v.informationGain).toBe(0);
    expect(v.primary).toBe("none");
  });

  it("24h activity materially above a qualified baseline does register", () => {
    // 14 trades in 7d ⇒ baseline 2/day. 12 in 24h ⇒ 6× ⇒ saturated.
    const u = unusualness(12, 14);
    expect(u.qualified).toBe(true);
    expect(u.value).toBe(1);
    const mild = unusualness(4, 14); // 2× ⇒ exactly at the floor
    expect(mild.value).toBe(0);
  });
});

describe("relative price", () => {
  it("classification is invariant to price scale", () => {
    // Same 2% relative move at two very different price levels.
    const cheap = signalVector(
      base({ yesPrice: 0.5, yesPriceChange24h: 0.01, yesCapitalDelta24h: 100 }),
    );
    const dear = signalVector(
      base({ yesPrice: 5, yesPriceChange24h: 0.1, yesCapitalDelta24h: 100 }),
    );
    expect(priceBand(relativeMove(0.01, 0.5))).toBe("quiet");
    expect(priceBand(relativeMove(0.1, 5))).toBe("quiet");
    expect(cheap.signals.beforePrice).toBe(dear.signals.beforePrice);
    expect(cheap.informationGain).toBeCloseTo(dear.informationGain, 10);
  });

  it("a $0.10 move is loud on a cheap market and quiet on a dear one", () => {
    expect(priceBand(relativeMove(0.1, 0.5))).toBe("loud");
    expect(priceBand(relativeMove(0.1, 5))).toBe("quiet");
  });

  it("never uses an absolute USD delta when price is unknown", () => {
    const v = signalVector(base({ yesPrice: null, yesPriceChange24h: 5, yesCapitalDelta24h: 100 }));
    expect(v.signals.beforePrice).toBe(0);
  });
});

describe("concentration", () => {
  const holders = [
    { wallet: "0xwhale", netUsd: 400 },
    { wallet: "0xb", netUsd: 50 },
    { wallet: "0xc", netUsd: 30 },
    { wallet: "0xd", netUsd: 20 },
    { wallet: "0xe", netUsd: 10 },
  ];

  it("identifies the largest holder before an exit", () => {
    const v = signalVector(
      base({
        preEventHolders: holders,
        actor: { wallet: "0xWHALE", direction: "sell", amountUsd: 400 },
      }),
    );
    expect(v.concentrationKind).toBe("largest_holder_left");
    expect(v.signals.concentration).toBeGreaterThan(0.5);
  });

  it("never emits from amount alone", () => {
    const v = signalVector(
      base({ actor: { wallet: "0xwhale", direction: "sell", amountUsd: 9000 } }),
    );
    expect(v.signals.concentration).toBe(0);
    expect(v.concentrationKind).toBeUndefined();
  });

  it("keeps newcomers_replaced_a_whale strict and rare", () => {
    const thin = signalVector(
      base({
        preEventHolders: holders.slice(0, 3),
        newcomers24h: 9,
        actor: { wallet: "0xwhale", direction: "sell", amountUsd: 400 },
      }),
    );
    expect(thin.concentrationKind).toBe("largest_holder_left");

    const fewNewcomers = signalVector(
      base({
        preEventHolders: holders,
        newcomers24h: 1,
        actor: { wallet: "0xwhale", direction: "sell", amountUsd: 400 },
      }),
    );
    expect(fewNewcomers.concentrationKind).toBe("largest_holder_left");

    const real = signalVector(
      base({
        preEventHolders: holders,
        newcomers24h: 3,
        actor: { wallet: "0xwhale", direction: "sell", amountUsd: 400 },
      }),
    );
    expect(real.concentrationKind).toBe("newcomers_replaced_a_whale");
    expect(real.tensionKind).toBe("whales_out_newcomers_in");
  });

  it("reconstructs the pre-event hierarchy from canonical trades", () => {
    const trades = [
      { wallet: "0xa", netUsd: 100, atMs: NOW - 5000 },
      { wallet: "0xb", netUsd: 300, atMs: NOW - 4000 },
      { wallet: "0xa", netUsd: 250, atMs: NOW - 3000 },
      { wallet: "0xb", netUsd: -280, atMs: NOW - 2000 },
      { wallet: "0xc", netUsd: 900, atMs: NOW - 500 }, // after the cut
    ];
    const before = holdersBefore(trades, NOW - 1000);
    expect(before.map((h) => h.wallet)).toEqual(["0xa", "0xb"]);
    expect(before[0]!.netUsd).toBe(350);
  });
});

describe("nonresponse", () => {
  const facts = (hoursAgo: number, over: Partial<SignalFacts> = {}) =>
    base({
      yesPrice: 2,
      yesPriceChange24h: 0.01,
      input: { amountUsd: 200, atMs: NOW - hoursAgo * 3_600_000 },
      ...over,
    });

  it("cannot fire before its time window", () => {
    expect(signalVector(facts(1)).signals.nonresponse).toBe(0);
    expect(signalVector(facts(3.9)).signals.nonresponse).toBe(0);
    expect(signalVector(facts(6)).signals.nonresponse).toBeGreaterThan(0);
  });

  it("needs a meaningful input and a quiet relative response", () => {
    expect(signalVector(facts(6, { input: { amountUsd: 10, atMs: NOW - 6 * 3_600_000 } })).signals.nonresponse).toBe(0);
    expect(signalVector(facts(6, { yesPriceChange24h: 0.4 })).signals.nonresponse).toBe(0);
  });

  it("goes stale rather than nagging forever", () => {
    expect(signalVector(facts(72)).signals.nonresponse).toBe(0);
  });
});

describe("viewer blindness and social rows", () => {
  it("the same facts produce the same vector for every viewer", () => {
    const f = base({
      tradeCount24h: 12,
      tradeCount7d: 14,
      yesCapitalDelta24h: 300,
      newBelievers24h: 4,
    });
    const a = signalVector({ ...f });
    const b = signalVector({ ...f });
    expect(a).toEqual(b);
  });

  it("social-only rows produce an all-zero vector", () => {
    const v = signalVector(base({ isSocial: true, yesCapitalDelta24h: 5000, tradeCount24h: 40, tradeCount7d: 40 }));
    expect(v).toEqual(emptyVector());
    expect(Object.values(v.signals).every((n) => n === 0)).toBe(true);
  });
});

describe("building is residual", () => {
  it("contributes only when stronger signals are absent", () => {
    const alone = signalVector(
      base({ yesPrice: 2, yesPriceChange24h: 0.2, yesCapitalDelta24h: 300, newBelievers24h: 2 }),
    );
    expect(alone.signals.building).toBeGreaterThan(0);

    const explained = signalVector(
      base({
        yesPrice: 2,
        yesPriceChange24h: 0.01, // quiet ⇒ beforePrice explains the same capital
        yesCapitalDelta24h: 300,
        newBelievers24h: 2,
      }),
    );
    expect(explained.signals.beforePrice).toBeGreaterThan(0);
    expect(explained.signals.building).toBeLessThan(alone.signals.building);
    expect(explained.primary).not.toBe("building");
  });

  it("never becomes the lead when a contradiction is present", () => {
    const v = signalVector(
      base({
        yesPrice: 2,
        yesPriceChange24h: 0.01,
        yesCapitalDelta24h: 400,
        peopleYesChange24h: 3,
      }),
    );
    expect(v.primary).toBe("tension");
  });

  it("a small contradiction can outrank a large ordinary move", () => {
    const ordinary = signalVector(
      base({ yesPrice: 2, yesPriceChange24h: 0.3, yesCapitalDelta24h: 900 }),
    );
    const contradiction = signalVector(
      base({
        yesPrice: 2,
        yesPriceChange24h: 0.2,
        yesCapitalDelta24h: -60,
        peopleYesChange24h: 4,
      }),
    );
    expect(contradiction.informationGain).toBeGreaterThan(ordinary.informationGain);
  });
});

describe("thin-book guards (added after the first corpus run)", () => {
  it("treats an implausible relative move as an artifact, not a signal", () => {
    expect(priceBand(relativeMove(2.7, 1.92))).toBe("artifact");
    const v = signalVector(
      base({ yesPrice: 1.92, yesPriceChange24h: -2.7, yesCapitalDelta24h: -1.94, tradeCount24h: 1, tradeCount7d: 1 }),
    );
    expect(v.signals.tension).toBe(0);
    expect(v.signals.confirmation).toBe(0);
    expect(v.informationGain).toBe(0);
  });

  it("a single dust holder is not a hierarchy and not a whale", () => {
    const solo = signalVector(
      base({
        preEventHolders: [{ wallet: "0xa", netUsd: 2 }],
        actor: { wallet: "0xa", direction: "sell", amountUsd: 2 },
      }),
    );
    expect(solo.signals.concentration).toBe(0);

    const dustPair = signalVector(
      base({
        preEventHolders: [
          { wallet: "0xa", netUsd: 4 },
          { wallet: "0xb", netUsd: 2 },
        ],
        actor: { wallet: "0xa", direction: "sell", amountUsd: 4 },
      }),
    );
    expect(dustPair.signals.concentration).toBe(0);
  });

  it("a price move with no arrivals needs real money behind it", () => {
    const dust = signalVector(
      base({ yesPrice: 2, yesPriceChange24h: 0.3, yesCapitalDelta24h: 2, newBelievers24h: 0 }),
    );
    expect(dust.tensionKind).toBeUndefined();
    const real = signalVector(
      base({ yesPrice: 2, yesPriceChange24h: 0.3, yesCapitalDelta24h: 200, newBelievers24h: 0 }),
    );
    expect(real.tensionKind).toBe("price_up_believers_flat");
  });
});

describe("concentration needs a trade big enough to change the shape", () => {
  const led = [
    { wallet: "0xlead", netUsd: 200 },
    { wallet: "0xb", netUsd: 20 },
  ];
  it("ignores a one-cent sale by a minor holder", () => {
    const v = signalVector(
      base({ preEventHolders: led, actor: { wallet: "0xb", direction: "sell", amountUsd: 0.01 } }),
    );
    expect(v.signals.concentration).toBe(0);
  });
  it("registers a material sale by a minor holder", () => {
    const v = signalVector(
      base({ preEventHolders: led, actor: { wallet: "0xb", direction: "sell", amountUsd: 20 } }),
    );
    expect(v.concentrationKind).toBe("distributing");
  });
});
