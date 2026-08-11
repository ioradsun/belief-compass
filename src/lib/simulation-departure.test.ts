/**
 * LEAVING SIMULATION, WHILE THE SERVER HAS NOT ANSWERED YET.
 *
 * `simulation-boundary.test.ts` proves the code is SHAPED so this cannot happen.
 * These run the decision instead: given a wallet the server still has in
 * Simulation and an exit whose round trip is held open, which executor comes
 * back, and what does it do when a confirm reaches it?
 *
 * THE DEFECT THIS CLOSES. The optimistic exit wrote EXITED into the routing
 * cache on the way out. That correctly hid the banner — and incorrectly resolved
 * the mode to REAL, which put the real-money executor behind the Confirm button
 * of somebody the server had not yet released. The window was one round trip
 * wide on a good day and unbounded on a rejected signature.
 *
 * Both halves are tested against the real functions, not copies of them: the
 * mode comes from `liveMode`, which the provider calls, and the executor from
 * `executorFor`, which the facade calls.
 */
import { describe, it, expect, vi } from "vitest";
import { executorFor, UNRESOLVED_TRADE, type TradeLike } from "@/lib/market-execution";
import {
  liveMode,
  modeResolved,
  routingPermitsRealOrder,
  type SimulationLifecycle,
  type SimulationRouting,
} from "@/domain/simulation";
import { profileProgressFor } from "@/domain/beliefs";

const WALLET = "0xsimulator";
const incomplete = profileProgressFor(3);
const complete = profileProgressFor(10);
const routing = (state: SimulationLifecycle | null): SimulationRouting => ({ state });

/** A stand-in with counted calls, so "never invoked" is a fact and not a hope. */
function spyTrade(): TradeLike & { buys: number; sells: number } {
  const t = {
    buys: 0,
    sells: 0,
    buy: async () => {
      t.buys++;
    },
    sell: async () => {
      t.sells++;
    },
    isSubmitting: false,
    isMining: false,
    isSuccess: false,
    isError: false,
    error: null,
    reset: () => {},
  };
  return t;
}

describe("an exit in flight exposes neither ledger", () => {
  it("holds the mode at UNKNOWN from the press until the server answers", () => {
    // The routing cache still says ACTIVE, because nothing has confirmed
    // otherwise. That is the honest state and it is left alone.
    const before = liveMode({
      connected: true,
      departing: false,
      routing: routing("ACTIVE"),
      progress: incomplete,
    });
    expect(before).toBe("SIMULATION");

    const during = liveMode({
      connected: true,
      departing: true,
      routing: routing("ACTIVE"),
      progress: incomplete,
    });
    expect(during).toBe("UNKNOWN");
    expect(modeResolved(during)).toBe(false);
  });

  it("refuses both writes and never reaches the real executor", async () => {
    const real = spyTrade();
    const sim = spyTrade();
    const resolved = modeResolved(
      liveMode({
        connected: true,
        departing: true,
        routing: routing("ACTIVE"),
        progress: incomplete,
      }),
    );

    const trade = executorFor({ resolved, simulated: false, simulation: sim, real });
    expect(trade).toBe(UNRESOLVED_TRADE);

    await expect(trade.buy(1, true, 1n, 1n)).rejects.toThrow(/checking which account/i);
    await expect(trade.sell(1, true, 1n, 1n)).rejects.toThrow(/checking which account/i);
    expect(real.buys).toBe(0);
    expect(real.sells).toBe(0);
    // And it did not quietly settle in the other ledger either.
    expect(sim.buys).toBe(0);
    expect(sim.sells).toBe(0);
  });

  it("reports nothing in flight, so no surface renders a pending order", () => {
    expect(UNRESOLVED_TRADE.isSubmitting).toBe(false);
    expect(UNRESOLVED_TRADE.isMining).toBe(false);
    expect(UNRESOLVED_TRADE.isSuccess).toBe(false);
    expect(UNRESOLVED_TRADE.isError).toBe(false);
    // Frozen: a surface cannot patch a success onto the refusal.
    expect(Object.isFrozen(UNRESOLVED_TRADE)).toBe(true);
  });

  it("returns to REAL only on the confirmed answer, and to SIMULATION on failure", () => {
    // Success: the server wrote EXITED and the cache now carries it.
    expect(
      liveMode({
        connected: true,
        departing: false,
        routing: routing("EXITED"),
        progress: incomplete,
      }),
    ).toBe("REAL");

    // Failure: the rollback restored the captured ACTIVE. The reader is back in
    // Simulation, which is where the server had them the whole time.
    expect(
      liveMode({
        connected: true,
        departing: false,
        routing: routing("ACTIVE"),
        progress: incomplete,
      }),
    ).toBe("SIMULATION");
  });

  it("does not resolve a disconnected wallet through the departure path", () => {
    // No address, no account, nothing to route — and no executor to hand out
    // either way, so REAL is not a fall-through here, it is the whole truth.
    expect(
      liveMode({ connected: false, departing: false, routing: undefined, progress: incomplete }),
    ).toBe("REAL");
  });

  it("keeps an unanswered routing read at UNKNOWN with no departure at all", () => {
    // The cold-tab case, which is the same fact by a different route.
    expect(
      liveMode({ connected: true, departing: false, routing: undefined, progress: incomplete }),
    ).toBe("UNKNOWN");
    expect(
      executorFor({ resolved: false, simulated: false, simulation: spyTrade(), real: spyTrade() }),
    ).toBe(UNRESOLVED_TRADE);
  });
});

describe("the executor selection cannot leak the real one", () => {
  it("prefers the refusal over both, whatever `simulated` says", () => {
    const real = spyTrade();
    const sim = spyTrade();
    for (const simulated of [true, false]) {
      expect(executorFor({ resolved: false, simulated, simulation: sim, real })).toBe(
        UNRESOLVED_TRADE,
      );
    }
  });

  it("hands out each ledger's own adapter once the mode is known", () => {
    const real = spyTrade();
    const sim = spyTrade();
    expect(executorFor({ resolved: true, simulated: true, simulation: sim, real })).toBe(sim);
    expect(executorFor({ resolved: true, simulated: false, simulation: sim, real })).toBe(real);
  });

  it("routes a GRADUATING wallet to Simulation, not to real money", () => {
    // Ten convictions in, Continue not yet pressed. The Simulation receipt is
    // still on screen and the position is still readable; what closes is a NEW
    // order, which the ticket refuses — not the ledger, which has not moved.
    const mode = liveMode({
      connected: true,
      departing: false,
      routing: routing("GRADUATING"),
      progress: complete,
    });
    expect(mode).toBe("GRADUATING");
    expect(modeResolved(mode)).toBe(true);
  });
});

/**
 * THE CONFIRM-TIME PREFLIGHT.
 *
 * The cache is not the last authority for real money: Simulation is
 * WALLET-GLOBAL on the server, so a second tab or another device can activate it
 * while this one is inside its fresh window. A short staleTime narrows that
 * window; it cannot close it, and "narrow" is not a property to trust with
 * somebody's money.
 */
describe("a real order re-asks the server which ledger owns the wallet", () => {
  it("permits only a confirmed absence, exit or graduation", () => {
    expect(routingPermitsRealOrder(null)).toBe(true);
    expect(routingPermitsRealOrder("EXITED")).toBe(true);
    expect(routingPermitsRealOrder("GRADUATED")).toBe(true);
    expect(routingPermitsRealOrder("ACTIVE")).toBe(false);
    expect(routingPermitsRealOrder("GRADUATING")).toBe(false);
    // Never asked, or the ask failed. Not permission.
    expect(routingPermitsRealOrder(undefined)).toBe(false);
  });

  it("stops the delegation before the real adapter is called", async () => {
    // The guard's exact shape, run: preflight, then delegate. A rejection must
    // leave the wallet untouched rather than merely reporting afterwards.
    const real = spyTrade();
    const preflight = vi.fn(async () => {
      if (!routingPermitsRealOrder("ACTIVE")) throw new Error("in Simulation");
    });
    const guarded: TradeLike = {
      ...real,
      buy: async (...args: Parameters<TradeLike["buy"]>) => {
        await preflight();
        return real.buy(...args);
      },
      sell: async (...args: Parameters<TradeLike["sell"]>) => {
        await preflight();
        return real.sell(...args);
      },
    };

    await expect(guarded.buy(1, true, 1n, 1n)).rejects.toThrow(/in Simulation/);
    await expect(guarded.sell(1, true, 1n, 1n)).rejects.toThrow(/in Simulation/);
    expect(preflight).toHaveBeenCalledTimes(2);
    expect(real.buys).toBe(0);
    expect(real.sells).toBe(0);
  });

  it("lets a wallet the server has released through", async () => {
    const real = spyTrade();
    const guarded: TradeLike = {
      ...real,
      buy: async (...args: Parameters<TradeLike["buy"]>) => {
        if (!routingPermitsRealOrder(null)) throw new Error("in Simulation");
        return real.buy(...args);
      },
    };
    await guarded.buy(1, true, 1n, 1n);
    expect(real.buys).toBe(1);
  });
});
