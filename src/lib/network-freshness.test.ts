import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const COORDINATOR = read("src/lib/realtime/coordinator.ts");
const ROUTER = read("src/router.tsx");
const NETWORK_QO = read("src/lib/network-query.ts");
const MARKET_QO = read("src/lib/market-queries.ts");
const POSITIONS_QO = read("src/lib/positions-query.ts");

/**
 * WHAT KEEPS THE VIEWER'S NETWORK FRESH — the event matrix, as executable notes.
 *
 * A 60-second poll was removed from `["network", …]` on the stated assumption
 * that the realtime coordinator already invalidated it. IT DID NOT. Nothing
 * did: not the coordinator, not follow/unfollow, not the trade path. That poll
 * was the only thing refreshing the list, and removing it would have left the
 * network frozen for the length of a session.
 *
 * The assumption was wrong in an instructive way. `getNetwork` reads
 * `viewer_dna_cache`, which a BACKGROUND WORKER recomputes when positions
 * change — so there is no socket event that means "this viewer's network
 * changed", and the poll was never buying freshness. It was re-reading a
 * worker-maintained cache on a timer and hoping the worker had run.
 *
 * So the coverage is deliberately three bounded triggers rather than one poll:
 *
 *   EVENT                          COVERED BY
 *   tab regains focus              refetchOnWindowFocus (global default)
 *   browser comes back online      refetchOnReconnect (global default)
 *   socket drop / tab un-hidden    coordinator reconcileSoon → ["network"]
 *   the rail mounts                the query's own first fetch
 *   follow / unfollow              NOT covered, and correctly so — follows feed
 *                                  feed ranking, not DNA relationships, so the
 *                                  network list does not change
 *
 * WHAT IS STILL NOT COVERED, stated plainly: a session that stays focused and
 * connected while the worker recomputes the viewer's DNA in the background.
 * That reader sees the previous network until they switch tabs and come back.
 * Acceptable — DNA relationships move over hours, not seconds — but it is a
 * choice, not an oversight, and this file is where to change it.
 */
describe("the viewer's network cannot silently go stale", () => {
  it("is re-read after a socket drop or a hidden tab returning", () => {
    const reconcile = COORDINATOR.slice(
      COORDINATOR.indexOf("const reconcileSoon"),
      COORDINATOR.indexOf("RECONCILE_DEBOUNCE_MS);", COORDINATOR.indexOf("const reconcileSoon")),
    );
    expect(reconcile).toMatch(/queryKey: \["network"\]/);
  });

  it("relies on focus and reconnect refetching, which must stay on", () => {
    // Focus refetching is gated (not disabled): a genuine absence revalidates,
    // a quick glance away does not. See src/lib/focus-policy.ts.
    expect(ROUTER).toMatch(/refetchOnWindowFocus:\s*\(\)\s*=>\s*shouldRevalidateOnReturn\(\)/);
    expect(ROUTER).toMatch(/refetchOnReconnect:\s*true/);
  });


  /**
   * Those two defaults only fire for a query the observer considers STALE, so a
   * staleTime of Infinity — or of an hour — would quietly disable the whole
   * matrix above while looking like a performance improvement.
   */
  it("keeps a stale time short enough for focus refetching to mean something", () => {
    const m = NETWORK_QO.match(/NETWORK_STALE_MS = ([0-9_]+)/);
    expect(m, "NETWORK_STALE_MS must exist").toBeTruthy();
    const ms = Number(m![1].replace(/_/g, ""));
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(5 * 60_000);
  });

  /**
   * The regression this whole file exists for: one observer re-declaring the
   * shared key with its own polling or freshness rules. Six copies drifted once
   * already, invisibly.
   */
  it("has exactly one definition of the network query", () => {
    const declarations = [
      "src/components/CaseFile.tsx",
      "src/components/SharedConviction.tsx",
      "src/components/MobileGame.tsx",
      "src/components/DnaFirstReveal.tsx",
      "src/components/MyWorld.tsx",
      "src/components/MarketDeck.tsx",
      "src/components/NetworkPanel.tsx",
    ].filter((f) => /queryKey:\s*\["network"/.test(read(f)));
    expect(declarations).toEqual([]);
  });

  it("and that definition sets no STANDING interval of its own", () => {
    // Comments stripped first: this file EXPLAINS the interval it removed, and
    // an assertion that cannot tell prose from code fails on its own rationale.
    const code = NETWORK_QO.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    // A literal delay is the regression — a timer that runs whatever the data
    // says. The bounded wait added later is a function of the server's reported
    // freshness and stops on its own; see the DNA-backed describe below.
    expect(code).not.toMatch(/refetchInterval:\s*[0-9]/);
  });
});

/**
 * THE SAME REGRESSION, ON THE TWO KEYS THAT COST THE MOST.
 *
 * `["market-change", id]` (a replay of up to 1,000 trade events on the service
 * client) was declared at five call sites with three different intervals;
 * `["evidence", id]` (four service-client queries including a 200-row
 * `wallet_beliefs` read and a 60-day price-series RPC) at six. React Query
 * dedupes the key, never the options, so the phone's 20s was only the phone's
 * until the deck mounted and re-timed the shared query to 15s.
 *
 * Both are functions of ONE thing — has this market traded — and the coordinator
 * receives that exact event. See src/lib/market-queries.ts for the production
 * numbers that settled it.
 */
describe("a market's expensive reads are driven by the trade, not a timer", () => {
  it("refetches the traded market's change and evidence from the events stream", () => {
    const drain = COORDINATOR.slice(
      COORDINATOR.indexOf("const drainActivity"),
      COORDINATOR.indexOf("const noteActivity"),
    );
    expect(drain).toMatch(/affectedMarketKeys/);
  });

  it("has exactly one definition of each query", () => {
    const declarations = [
      "src/components/MarketDeck.tsx",
      "src/components/CaseFile.tsx",
      "src/components/MobileGame.tsx",
      "src/components/SharedConviction.tsx",
      "src/routes/index.tsx",
      "src/lib/realtime/use-predictive-prefetch.ts",
    ].filter((f) => /queryKey:\s*\["(market-change|evidence)"/.test(read(f)));
    expect(declarations).toEqual([]);
  });

  it("and those definitions set no interval of their own", () => {
    const code = MARKET_QO.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/refetchInterval/);
  });

  /**
   * The stream is the freshness path, but only for a tab that is receiving it.
   * A staleTime long enough to outlive a session would put a reader who missed
   * the socket back where the poll had them — so focus/reconnect refetching has
   * to still be able to fire.
   */
  it("keeps stale times short enough for focus refetching to still mean something", () => {
    for (const name of ["MARKET_CHANGE_STALE_MS", "EVIDENCE_STALE_MS"]) {
      const m = MARKET_QO.match(new RegExp(`${name} = ([0-9_]+)`));
      expect(m, `${name} must exist`).toBeTruthy();
      const ms = Number(m![1].replace(/_/g, ""));
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThanOrEqual(5 * 60_000);
    }
  });
});

/**
 * THE VIEWER'S MONEY. `getWallet` calls out to pov.co on every request to price
 * the wallet's tokens live; two components polling it at 30s ran that external
 * call twice a minute for the length of a session. What it was watching for —
 * someone else trading a market the viewer holds — is now matched against their
 * actual holdings from the trade stream.
 */
describe("the viewer's portfolio is revalued by the trade, not a timer", () => {
  it("revalues the holdings of anyone holding a market that just traded", () => {
    const drain = COORDINATOR.slice(
      COORDINATOR.indexOf("const drainActivity"),
      COORDINATOR.indexOf("const noteActivity"),
    );
    expect(drain).toMatch(/affectedViewerValuationKeys/);
  });

  it("still refetches when the viewer themselves trades", () => {
    // The other half of the same number, and a different socket: this one is
    // filtered to the viewer's own wallet_beliefs.
    const stream = read("src/lib/realtime/use-position-stream.ts");
    expect(stream).toMatch(/viewerPositionKeys/);
    expect(read("src/lib/realtime/reduce.ts")).toMatch(/"my-convictions", w/);
  });

  it("has exactly one definition of each position query", () => {
    const declarations = [
      "src/components/MyConvictions.tsx",
      "src/components/MyWorld.tsx",
      "src/components/order/OwnedDock.tsx",
      "src/components/MarketDeck.tsx",
    ].filter((f) => /queryKey:\s*\["(my-convictions|position-summary)"/.test(read(f)));
    expect(declarations).toEqual([]);
  });

  it("and those definitions set no interval of their own", () => {
    const code = POSITIONS_QO.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/refetchInterval/);
  });
});

/**
 * A CACHE FILLED BY A WORKER NEEDS A BOUNDED WAIT, NOT A STANDING POLL.
 *
 * Two opposite mistakes were live at once. `["dna-overview"]` polled every 60s
 * forever — long past the point the answer went fresh and nothing could change
 * it. `["network"]` polled never, which is right for a settled cache and wrong
 * for a first-time reader: that read TRIGGERS the computation, then nobody asked
 * again, so their network stayed empty until they switched tabs. Both servers
 * report which state the computation is in; the rule now reads it.
 */
describe("DNA-backed queries wait for the worker and then stop", () => {
  it("polls the network only while the server says it is computing", () => {
    expect(NETWORK_QO).toMatch(/dnaPollInterval/);
  });

  it("polls the overview on the same rule, instead of forever", () => {
    const overview = read("src/components/DnaOverview.tsx");
    expect(overview).toMatch(/dnaPollInterval/);
    expect(overview).not.toMatch(/refetchInterval:\s*[0-9]/);
  });

  it("does not poll a profile that has no computation to wait for", () => {
    // getPersonProfile is computed on read, not served from viewer_dna_cache —
    // there is no "still computing" state, so a timer buys nothing.
    const profile = read("src/components/PersonProfile.tsx");
    expect(profile).not.toMatch(/refetchInterval/);
    expect(profile).toMatch(/staleTime/);
  });
});
