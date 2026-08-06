import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const COORDINATOR = read("src/lib/realtime/coordinator.ts");
const ROUTER = read("src/router.tsx");
const NETWORK_QO = read("src/lib/network-query.ts");

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
    expect(ROUTER).toMatch(/refetchOnWindowFocus:\s*true/);
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

  it("and that definition sets no interval of its own", () => {
    // Comments stripped first: this file EXPLAINS the interval it removed, and
    // an assertion that cannot tell prose from code fails on its own rationale.
    const code = NETWORK_QO.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/refetchInterval/);
  });
});
