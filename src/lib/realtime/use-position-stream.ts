/**
 * The viewer's position stream.
 *
 * The global coordinator (startRealtime) owns the viewer-INDEPENDENT streams
 * (market_state, events). Positions are different: a viewer only cares about
 * their OWN `wallet_beliefs` rows, so this is a single subscription FILTERED to
 * the connected wallet (`wallet=eq.<addr>`) with its own lifecycle — it tears
 * down and re-subscribes when the effective wallet changes. Still one stream for
 * the viewer, mounted once at the app's main surface; not a per-component socket.
 *
 * A `wallet_beliefs` change is a SIGNAL, not a delta to fold: positions are
 * server-valued (POV worth, ETH→USD cost basis, joined market meta), so the raw
 * row is not renderable truth. On a change we refetch only the mounted position
 * slices, coalesced + throttled. When the viewer's beliefs don't change, there
 * is no timer and no request.
 */
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { viewerPositionKeys } from "./reduce";

const THROTTLE_MS = 1_500;

export function usePositionStream(wallet?: string): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!wallet || typeof window === "undefined") return;
    const w = wallet.toLowerCase();

    let disposed = false;
    let cleanup: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastAt = 0;
    let dirty = false;

    const drain = () => {
      timer = null;
      lastAt = Date.now();
      if (disposed || !dirty) return;
      dirty = false;
      for (const key of viewerPositionKeys(w)) {
        void qc.invalidateQueries({ queryKey: key, refetchType: "active" });
      }
    };
    const note = () => {
      dirty = true;
      if (timer != null) return;
      timer = setTimeout(drain, Math.max(0, THROTTLE_MS - (Date.now() - lastAt)));
    };

    void import("@/integrations/supabase/client")
      .then(({ supabase }) => {
        if (disposed) return;
        const channel = supabase
          .channel(`positions:${w}`)
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "wallet_beliefs", filter: `wallet=eq.${w}` },
            () => note(),
          )
          .subscribe();
        cleanup = () => {
          if (timer != null) clearTimeout(timer);
          void supabase.removeChannel(channel);
        };
      })
      .catch(() => {
        // Realtime unavailable: the slow position reconcile polls still keep the
        // portfolio correct, just not instant.
      });

    return () => {
      disposed = true;
      if (timer != null) clearTimeout(timer);
      cleanup?.();
    };
  }, [wallet, qc]);
}
