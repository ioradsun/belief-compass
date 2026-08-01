/**
 * useHouseIdea — the funnel side of "The House has an idea".
 *
 * It no longer decides ANYTHING about placement: the unified opportunity feed
 * on the server decides whether an idea belongs in the sequence and where. This
 * hook takes the suggestion the server already placed and owns the funnel calls
 * (shown / create / edit / dismiss / published) plus the local dismissal so the
 * card disappears immediately.
 */
import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { readSessionToken } from "@/lib/wallet-session";
import { noteCardViewed as noteFeedCard, noteIdeaShown } from "@/lib/feed-session";
import {
  completeSuggestion,
  markSuggestion,
  trackSuggestion,
  type ReadySuggestion,
} from "@/lib/market-suggestion.functions";

export interface HouseIdea {
  /** The card to render, or null (the normal case). */
  suggestion: ReadySuggestion | null;
  /** Count one normal market card as viewed (reported to the server feed). */
  noteCardViewed: (marketId: number) => void;
  onShown: () => void;
  onCreate: () => void;
  onEdit: () => void;
  onDismiss: () => void;
  onPublished: (marketId: number | null, finalQuestion: string) => void;
  onPublishFailed: () => void;
}

export function useHouseIdea(serverSuggestion: ReadySuggestion | null): HouseIdea {
  const { address } = useAccount();
  // The connected address, not the effective/linked viewer wallet: the session
  // token proves ownership of *this* address, and the server checks that.
  const wallet = address ?? null;
  const token = wallet ? readSessionToken(wallet) : null;

  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const ready =
    serverSuggestion && serverSuggestion.id !== dismissedId ? serverSuggestion : null;

  const fire = useCallback((fn: () => Promise<unknown>) => {
    void fn().catch(() => undefined); // analytics must never surface to the viewer
  }, []);

  const noteCardViewed = useCallback((marketId: number) => {
    noteFeedCard(marketId);
  }, []);

  const onShown = useCallback(() => {
    if (!ready || !wallet || !token) return;
    noteIdeaShown();
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
    setDismissedId(ready.id);
    fire(() =>
      markSuggestion({ data: { wallet, session: token, id: ready.id, step: "dismissed" } }),
    );
  }, [ready, wallet, token, fire]);

  const onPublished = useCallback(
    (marketId: number | null, finalQuestion: string) => {
      if (!ready || !wallet || !token) return;
      setDismissedId(ready.id);
      fire(() =>
        completeSuggestion({
          data: { wallet, session: token, id: ready.id, marketId, finalQuestion },
        }),
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
    if (!wallet) setDismissedId(null);
  }, [wallet]);

  return {
    suggestion: ready,
    noteCardViewed,
    onShown,
    onCreate,
    onEdit,
    onDismiss,
    onPublished,
    onPublishFailed,
  };
}
