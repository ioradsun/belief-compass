/**
 * "The House has an idea" — public server functions.
 *
 * Thin wrappers only. Every call proves wallet ownership with the same signed
 * session the rest of the app uses, so one person can never read or steer
 * another person's idea. The feed NEVER waits on generation here — this reads a
 * suggestion that a background job stored earlier, or returns null.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { SUGGESTION_EVENTS } from "@/domain/market-suggestion";
import type { ReadySuggestion } from "@/lib/market-suggestion.server";

export type { ReadySuggestion };

const wallet = z.string().min(3);
const session = z.string().min(16).max(2000);
const suggestionId = z.string().uuid();

/** The ready idea for this viewer, if there is one. Null is the normal case. */
export const getSuggestion = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) => z.object({ wallet, session }).parse(raw))
  .handler(async ({ data }): Promise<ReadySuggestion | null> => {
    const { assertWalletOwnership } = await import("@/lib/wallet-session.server");
    const w = await assertWalletOwnership(data.wallet, data.session);
    const { readySuggestionFor } = await import("@/lib/market-suggestion.server");
    try {
      return await readySuggestionFor(w);
    } catch {
      return null; // generation/plumbing failures must never break the feed
    }
  });

/** Funnel transitions: the card appeared, was opened for edit, or dismissed. */
export const markSuggestion = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z
      .object({
        wallet,
        session,
        id: suggestionId,
        step: z.enum(["shown", "editing", "dismissed"]),
      })
      .parse(raw),
  )
  .handler(async ({ data }) => {
    const { assertWalletOwnership } = await import("@/lib/wallet-session.server");
    const w = await assertWalletOwnership(data.wallet, data.session);
    const { transitionSuggestion } = await import("@/lib/market-suggestion.server");
    const event =
      data.step === "shown"
        ? "suggestion_shown"
        : data.step === "editing"
          ? "suggestion_edit_clicked"
          : "suggestion_dismissed";
    await transitionSuggestion(data.id, w, data.step, event);
    return { ok: true };
  });

/** A published market, attributed back to the idea that started it. */
export const completeSuggestion = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z
      .object({
        wallet,
        session,
        id: suggestionId,
        marketId: z.number().int().nonnegative().nullable().optional(),
        finalQuestion: z.string().min(1).max(400),
      })
      .parse(raw),
  )
  .handler(async ({ data }) => {
    const { assertWalletOwnership } = await import("@/lib/wallet-session.server");
    const w = await assertWalletOwnership(data.wallet, data.session);
    const { attachCreatedMarket } = await import("@/lib/market-suggestion.server");
    await attachCreatedMarket(data.id, w, data.marketId ?? null, data.finalQuestion);
    return { ok: true };
  });

/** Analytics for the steps that do not change the suggestion's state. */
export const trackSuggestion = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z
      .object({
        wallet,
        session,
        id: suggestionId,
        type: z.enum(SUGGESTION_EVENTS),
      })
      .parse(raw),
  )
  .handler(async ({ data }) => {
    const { assertWalletOwnership } = await import("@/lib/wallet-session.server");
    const w = await assertWalletOwnership(data.wallet, data.session);
    const { logSuggestionEvent } = await import("@/lib/market-suggestion.server");
    const { serviceClient } = await import("@/lib/supabase-clients");
    await logSuggestionEvent(serviceClient(), data.type, data.id, w);
    return { ok: true };
  });
