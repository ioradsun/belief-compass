/**
 * Login prefetch — make the first hop AFTER connecting a wallet feel local.
 *
 * The public app paints without any of this, and a first-time signed-out visitor
 * never runs it (there is no wallet). The moment a wallet connects, though, the
 * reader's likely next moves are their own people and the Challenges waiting on
 * them — each of which is a code chunk plus a query away. Warm them on idle so
 * the tap that opens one finds it already there, never in front of the first
 * paint and never competing with the active navigation render.
 *
 * Bounded and idempotent by construction: it fires once per connected wallet,
 * warms a fixed set, and every `prefetchQuery` no-ops when the answer is already
 * fresh. Companion to `usePredictivePrefetch`, which warms the NEXT market; this
 * warms the next DESTINATION.
 */
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { networkQO } from "@/lib/network-query";
import { getChallenges } from "@/lib/challenge.functions";

/**
 * The surfaces only a connected viewer reaches, each code-split out of the first
 * bundle (see routes/index.tsx). Warming them here means opening one is a render,
 * not a wait for its JavaScript. Imports are matched to the route's own lazy
 * imports so Vite folds them into the same chunks rather than minting new ones.
 */
function warmPrivateChunks(): void {
  void import("@/components/PersonProfile");
  void import("@/components/ConvictionDashboard");
  void import("@/components/MyWorld");
  void import("@/components/CreateMarket");
}

export function useLoginPrefetch(wallet: string | undefined): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!wallet || typeof window === "undefined") return;
    let cancelled = false;

    const run = () => {
      if (cancelled) return;
      warmPrivateChunks();
      // The first data page of the two private feeds a connected viewer reads
      // first: their people, and the Challenges waiting on them. prefetchQuery
      // no-ops when the surface has already fetched, so this never double-loads.
      void qc.prefetchQuery(networkQO(wallet));
      void qc.prefetchQuery({
        // The REAL ledger — the default a connected viewer is in unless they have
        // entered Simulation, and a warm cache for the wrong mode simply goes
        // unread. Matches the key useOpenCalls reads (["challenges", wallet, mode]).
        queryKey: ["challenges", wallet, "REAL"],
        queryFn: () => getChallenges({ data: { wallet, mode: "REAL" } }),
        staleTime: 60_000,
      });
    };

    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => number })
      .requestIdleCallback;
    // Idle so it never competes with first paint; a timeout where idle is absent.
    if (idle) idle(run);
    else window.setTimeout(run, 800);

    return () => {
      cancelled = true;
    };
  }, [wallet, qc]);
}
