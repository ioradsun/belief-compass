/**
 * Client-side contract hooks. These fetch the shapes in contract.ts and do
 * nothing else — no derivation, no ranking, no thresholds.
 *
 * Realtime is delivery, not truth: a change notification triggers a throttled
 * refetch, never a local replay of missed events.
 */
import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  getBeliefFn,
  getOnboardingBeliefsFn,
  getPositionsFn,
  getRoomFeedFn,
  getViewerFn,
} from "@/lib/conviction-contract.functions";
import { ingestConvictionFn } from "@/lib/conviction-ingest.functions";
import type { Belief, OnboardingBelief, Position, RoomStory, Viewer } from "@/lib/contract";

/** Motion budget: 220–280ms. Price updates are coalesced into this window. */
const REALTIME_THROTTLE_MS = 250;

export function useViewer(address: string | null) {
  return useQuery<Viewer>({
    queryKey: ["viewer", address],
    queryFn: () => getViewerFn({ data: { address } }),
    staleTime: 30_000,
  });
}

export function usePositions(address: string | null) {
  return useQuery<Position[]>({
    queryKey: ["positions", address],
    queryFn: () => getPositionsFn({ data: { address } }),
    enabled: address != null,
    staleTime: 20_000,
  });
}

export function useBelief(beliefId: string | null, address: string | null) {
  return useQuery<Belief | null>({
    queryKey: ["belief", beliefId, address],
    queryFn: () => getBeliefFn({ data: { beliefId: beliefId!, address } }),
    enabled: beliefId != null,
    staleTime: 10_000,
  });
}

export function useRoomFeed(address: string | null) {
  return useQuery<RoomStory[]>({
    queryKey: ["room-feed", address],
    queryFn: () => getRoomFeedFn({ data: { address, limit: 24 } }),
    staleTime: 15_000,
  });
}

export function useOnboardingBeliefs() {
  return useQuery<OnboardingBelief[]>({
    queryKey: ["onboarding-beliefs"],
    queryFn: () => getOnboardingBeliefsFn(),
    staleTime: 5 * 60_000,
  });
}

/**
 * On connect, seed the viewer's beliefs from POV positions (conviction for every
 * user, immediately — no wait for the chain backfill), then refresh the viewer +
 * positions so the UI reflects it. Runs once per address; matches (Tribe) fill
 * in from the batch DNA matcher on its next cycle.
 */
export function useIngestOnConnect(address: string | null) {
  const qc = useQueryClient();
  const done = useRef<string | null>(null);

  useEffect(() => {
    if (!address || done.current === address) return;
    done.current = address;
    let cancelled = false;
    void ingestConvictionFn({ data: { address } })
      .then((res) => {
        if (cancelled || !res || res.marketCount === 0) return;
        qc.invalidateQueries({ queryKey: ["viewer", address] });
        qc.invalidateQueries({ queryKey: ["positions", address] });
      })
      .catch(() => {
        /* ingest is best-effort; the chain path still populates beliefs */
      });
    return () => {
      cancelled = true;
    };
  }, [address, qc]);
}

/**
 * Subscribe to the active belief and the viewer's positions. On any change —
 * including reconnect — we refetch and reconcile.
 */
export function useConvictionRealtime(beliefId: string | null, address: string | null) {
  const qc = useQueryClient();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const invalidate = () => {
      if (timer.current) return; // coalesce into the motion budget
      timer.current = setTimeout(() => {
        timer.current = null;
        if (beliefId) qc.invalidateQueries({ queryKey: ["belief", beliefId, address] });
        if (address) qc.invalidateQueries({ queryKey: ["positions", address] });
        qc.invalidateQueries({ queryKey: ["room-feed", address] });
      }, REALTIME_THROTTLE_MS);
    };

    const channel = supabase.channel(`conviction:${beliefId ?? "none"}:${address ?? "anon"}`);
    if (beliefId) {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "market_state",
          filter: `onchain_id=eq.${beliefId}`,
        },
        invalidate,
      );
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "feed_events", filter: `onchain_id=eq.${beliefId}` },
        invalidate,
      );
    }
    if (address) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "wallet_beliefs", filter: `wallet=eq.${address}` },
        invalidate,
      );
    }
    channel.subscribe((status) => {
      // Reconnect refetches rather than replaying anything we missed.
      if (status === "SUBSCRIBED") invalidate();
    });

    return () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      supabase.removeChannel(channel);
    };
  }, [beliefId, address, qc]);
}
