/**
 * useHouseIdea — decides whether "The House has an idea" belongs in the feed
 * right now, and owns the funnel calls.
 *
 * The gate is deliberately conservative and lives in the domain module; this
 * hook only supplies the live session counters (how many normal markets this
 * person has actually seen, and how long since the last idea) and the ready
 * suggestion a background job stored earlier. It NEVER generates on demand, so
 * a slow or failed model can never stall a market card.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { readSessionToken } from "@/lib/wallet-session";
import {
  completeSuggestion,
  getSuggestion,
  markSuggestion,
  trackSuggestion,
  type ReadySuggestion,
} from "@/lib/market-suggestion.functions";
import { SUGGESTION, shouldInsertSuggestion } from "@/domain/market-suggestion";

/** Per-tab session counters — a suggestion is a session-scoped surprise. */
const session = { cardsViewed: 0, cardsSinceSuggestion: Number.POSITIVE_INFINITY, shown: 0 };

export interface HouseIdea {
  /** The card to render in place of a market, or null (the normal case). */
  suggestion: ReadySuggestion | null;
  /** Count one normal market card as viewed. */
  noteCardViewed: (marketId: number) => void;
  onShown: () => void;
  onCreate: () => void;
  onEdit: () => void;
  onDismiss: () => void;
  onPublished: (marketId: number | null, finalQuestion: string) => void;
  onPublishFailed: () => void;
}

export function useHouseIdea(): HouseIdea {
  const { address } = useAccount();
  // The connected address, not the effective/linked viewer wallet: the session
  // token proves ownership of *this* address, and the server checks that.
  const wallet = address ?? null;
  // Only a session the viewer already signed for — asking for a signature to
  // *offer* an idea would be a worse trade than never offering it.
  const token = wallet ? readSessionToken(wallet) : null;


  const [, bump] = useState(0);
  const seen = useRef(new Set<number>());
  const [dismissedLocally, setDismissedLocally] = useState(false);

  const { data } = useQuery({
    queryKey: ["house-idea", wallet],
    queryFn: async () =>
      (await getSuggestion({ data: { wallet: wallet as string, session: token as string } })) ??
      null,
    enabled: !!wallet && !!token && session.shown < SUGGESTION.MAX_PER_SESSION,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const ready = dismissedLocally ? null : (data ?? null);

  const noteCardViewed = useCallback((marketId: number) => {
    if (seen.current.has(marketId)) return;
    seen.current.add(marketId);
    session.cardsViewed += 1;
    if (Number.isFinite(session.cardsSinceSuggestion)) session.cardsSinceSuggestion += 1;
    bump((n) => n + 1);
  }, []);

  const eligible =
    !!ready &&
    shouldInsertSuggestion({
      cardsViewed: session.cardsViewed,
      cardsSinceSuggestion: session.cardsSinceSuggestion,
      suggestionsThisSession: session.shown,
      dismissedAt: null, // server-side cooldowns already gate the read
      createdAt: null,
      hasReadySuggestion: true,
    });

  const suggestion = eligible ? ready : null;

  const fire = useCallback(
    (fn: () => Promise<unknown>) => {
      void fn().catch(() => undefined); // analytics must never surface to the viewer
    },
    [],
  );

  const onShown = useCallback(() => {
    if (!ready || !wallet || !token) return;
    session.shown += 1;
    session.cardsSinceSuggestion = 0;
    fire(() => markSuggestion({ data: { wallet, session: token, id: ready.id, step: "shown" } }));
  }, [ready, wallet, token, fire]);

  const onCreate = useCallback(() => {
    if (!ready || !wallet || !token) return;
    fire(() =>
      trackSuggestion({
        data: { wallet, session: token, id: ready.id, type: "suggestion_create_clicked" },
      }),
    );
  }, [ready, wallet, token, fire]);

  const onEdit = useCallback(() => {
    if (!ready || !wallet || !token) return;
    fire(() => markSuggestion({ data: { wallet, session: token, id: ready.id, step: "editing" } }));
  }, [ready, wallet, token, fire]);

  const onDismiss = useCallback(() => {
    if (!ready || !wallet || !token) return;
    setDismissedLocally(true);
    fire(() =>
      markSuggestion({ data: { wallet, session: token, id: ready.id, step: "dismissed" } }),
    );
  }, [ready, wallet, token, fire]);

  const onPublished = useCallback(
    (marketId: number | null, finalQuestion: string) => {
      if (!ready || !wallet || !token) return;
      setDismissedLocally(true);
      fire(() =>
        completeSuggestion({ data: { wallet, session: token, id: ready.id, marketId, finalQuestion } }),
      );
    },
    [ready, wallet, token, fire],
  );

  const onPublishFailed = useCallback(() => {
    if (!ready || !wallet || !token) return;
    fire(() =>
      trackSuggestion({
        data: { wallet, session: token, id: ready.id, type: "suggestion_publish_failed" },
      }),
    );
  }, [ready, wallet, token, fire]);

  // Signing out mid-session should not leave a stale card on screen.
  useEffect(() => {
    if (!wallet) setDismissedLocally(false);
  }, [wallet]);

  return {
    suggestion,
    noteCardViewed,
    onShown,
    onCreate,
    onEdit,
    onDismiss,
    onPublished,
    onPublishFailed,
  };
}
