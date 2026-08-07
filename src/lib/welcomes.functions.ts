/**
 * Welcomes — public server functions.
 *
 * The sender side (getWelcomable / sendWelcomes) and the recipient side
 * (getWelcomesReceived) of "conviction needs company". All viewer-relative and
 * built on facts that already exist: the viewer's directional positions
 * (wallet_beliefs) and the canonical `position_became_directional` events that
 * mark a NEW BELIEVER. Writes are proven by the same wallet-session token the
 * belief tap uses. Pure selection/aggregation lives in @/domain/welcome.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { serviceClient } from "@/lib/supabase-clients";
import { aliasFor } from "@/lib/wallet-identity";
import {
  groupRoom,
  roomHeadline,
  selectWelcomable,
  summarizeReceived,
  welcomeKey,
  type ReceivedWelcome,
  type RoomPerson,
  type RoomSection,
  type Side,
} from "@/domain/welcome";
import { marketTitle, marketTitleFallback } from "@/domain/market-title";

/** How far back a "new believer" still counts as welcomable / a welcome still shows. */
const WELCOMABLE_WINDOW_DAYS = 7;
const RECEIVED_WINDOW_DAYS = 14;

export interface WelcomablePerson extends RoomPerson {}

export interface WelcomeRoom {
  people: WelcomablePerson[];
  count: number;
  sections: RoomSection[];
  headline: string;
  /** ISO of the viewer's previous visit, null on a first visit. */
  lastSeenAt: string | null;
  /** Arrived since that visit. */
  freshCount: number;
}

/**
 * Every relationship the DNA engine knows about the viewer, flattened to
 * wallet → label/agreement/shared. Reading the cache is cheap and never
 * triggers a recompute — an unmapped person simply lands in "New faces".
 */
async function relationshipIndex(
  sb: ReturnType<typeof serviceClient>,
  viewer: string,
): Promise<Map<string, { relationship: string; agreement: number; shared: number }>> {
  const index = new Map<string, { relationship: string; agreement: number; shared: number }>();
  try {
    const { readViewerDnaCache } = await import("@/lib/dna/viewer-dna-cache.server");
    const cache = await readViewerDnaCache(sb, viewer);
    if (!cache) return index;
    const buckets = [
      ...cache.twin,
      ...cache.tribe,
      ...cache.opp,
      ...cache.inverse,
      ...cache.neutral,
      ...cache.closest,
    ];
    for (const r of buckets) {
      const w = r.wallet.toLowerCase();
      if (index.has(w)) continue; // strongest bucket wins (twin → … → closest)
      index.set(w, {
        relationship: r.relationship,
        agreement: Math.round(r.agreement),
        shared: r.sharedBeliefs,
      });
    }
  } catch {
    /* DNA is an enrichment, never a dependency — the room still renders. */
  }
  return index;
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/** The viewer's directional positions → Map<market, side>. */
async function viewerPositions(
  sb: ReturnType<typeof serviceClient>,
  wallet: string,
): Promise<Map<number, Side>> {
  const { data } = await sb
    .from("wallet_beliefs")
    .select("onchain_id, stance_side")
    .eq("wallet", wallet)
    .in("stance_side", ["YES", "NO"]);
  const map = new Map<number, Side>();
  for (const r of (data ?? []) as { onchain_id: number; stance_side: Side }[])
    map.set(Number(r.onchain_id), r.stance_side);
  return map;
}

const EMPTY_ROOM: WelcomeRoom = {
  people: [],
  count: 0,
  sections: [],
  headline: "Nobody new in the room",
  lastSeenAt: null,
  freshCount: 0,
};

/** The viewer's last room visit (null = first time). */
async function lastRoomVisit(
  sb: ReturnType<typeof serviceClient>,
  viewer: string,
): Promise<string | null> {
  const { data } = await sb
    .from("welcome_room_visits")
    .select("last_seen_at")
    .eq("wallet", viewer)
    .maybeSingle();
  return (data as { last_seen_at?: string } | null)?.last_seen_at ?? null;
}

/**
 * The Daily Room: everyone who joined a side you hold in the last 7 days,
 * grouped by who they are to you (Twin / Tribe / crossed-over Opp / new face)
 * and marked fresh when they arrived since your last visit.
 */
export const getWelcomable = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) =>
    z.object({ wallet: z.string().min(3).nullable().optional() }).parse(raw),
  )
  .handler(async ({ data }): Promise<WelcomeRoom> => {
    if (!data.wallet) return EMPTY_ROOM;
    const sb = serviceClient();
    const viewer = data.wallet.toLowerCase();

    const [positions, lastSeenAt] = await Promise.all([
      viewerPositions(sb, viewer),
      lastRoomVisit(sb, viewer),
    ]);
    if (positions.size === 0) return { ...EMPTY_ROOM, lastSeenAt };
    const marketIds = [...positions.keys()];

    // Recent new-believer transitions on the markets the viewer holds, newest
    // first (so the pure dedup keeps the latest), plus the viewer's prior welcomes.
    const [evRes, wRes] = await Promise.all([
      sb
        .from("events")
        .select("wallet, market_id, occurred_at, side:payload->>new_side")
        .eq("source", "system")
        .eq("kind", "position_became_directional")
        .eq("is_canonical", true)
        .in(
          "market_id",
          marketIds.map((m) => String(m)),
        )
        .gte("occurred_at", daysAgoIso(WELCOMABLE_WINDOW_DAYS))
        .order("occurred_at", { ascending: false })
        .limit(400),
      sb.from("welcomes").select("recipient_wallet, market_id, side").eq("welcomer_wallet", viewer),
    ]);

    const alreadyWelcomed = new Set<string>();
    for (const w of (wRes.data ?? []) as {
      recipient_wallet: string;
      market_id: string;
      side: Side;
    }[])
      alreadyWelcomed.add(welcomeKey(w.recipient_wallet, Number(w.market_id), w.side));

    const events = ((evRes.data ?? []) as Record<string, unknown>[])
      .filter((r) => r.wallet && (r.side === "YES" || r.side === "NO"))
      .map((r) => ({
        wallet: String(r.wallet),
        marketId: Number(r.market_id),
        newSide: r.side as Side,
        occurredAt: String(r.occurred_at),
      }));

    const picks = selectWelcomable({ viewer, positions, events, alreadyWelcomed });
    if (picks.length === 0) return { ...EMPTY_ROOM, lastSeenAt };

    // Resolve identities, titles and relationships for the picks (bounded batches).
    const { resolveProfiles } = await import("@/lib/profiles.server");
    const [profiles, titlesRes, dna] = await Promise.all([
      resolveProfiles(picks.map((p) => p.wallet)),
      sb
        .from("markets")
        .select("onchain_id, title")
        .in("onchain_id", [...new Set(picks.map((p) => p.marketId))]),
      relationshipIndex(sb, viewer),
    ]);
    const titleById = new Map<number, string>();
    for (const m of (titlesRes.data ?? []) as { onchain_id: number; title: string | null }[])
      titleById.set(Number(m.onchain_id), marketTitle(m.title, m.onchain_id));

    const seenMs = lastSeenAt ? new Date(lastSeenAt).getTime() : 0;
    const people: WelcomablePerson[] = picks.map((p) => {
      const prof = profiles.get(p.wallet);
      const rel = dna.get(p.wallet);
      return {
        wallet: p.wallet,
        name: prof?.displayName ?? aliasFor(p.wallet),
        avatarUrl: prof?.pfpUrl ?? null,
        marketId: p.marketId,
        marketTitle: titleById.get(p.marketId) ?? marketTitleFallback(p.marketId),
        side: p.side,
        occurredAt: p.occurredAt,
        relationship: rel?.relationship ?? null,
        agreement: rel?.agreement ?? null,
        sharedBeliefs: rel?.shared ?? null,
        isNew: seenMs > 0 && new Date(p.occurredAt).getTime() > seenMs,
      };
    });

    const sections = groupRoom(people);
    return {
      people,
      count: people.length,
      sections,
      headline: roomHeadline(sections, Boolean(lastSeenAt)),
      lastSeenAt,
      freshCount: sections.reduce((n, s) => n + s.fresh, 0),
    };
  });

/**
 * Mark the room as seen. Turns the panel from a static list into a daily
 * ritual: what's here now becomes the baseline, tomorrow shows the delta.
 */
export const markRoomSeen = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z
      .object({
        wallet: z.string().min(3),
        session: z.string().min(16).max(2000).nullable().optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const viewer = await verifiedActor(data.wallet, data.session);
    const sb = serviceClient();
    const now = new Date().toISOString();
    const { data: prev } = await sb
      .from("welcome_room_visits")
      .select("visit_count")
      .eq("wallet", viewer)
      .maybeSingle();
    const visits = Number((prev as { visit_count?: number } | null)?.visit_count ?? 0) + 1;
    const { error } = await sb
      .from("welcome_room_visits")
      .upsert(
        { wallet: viewer, last_seen_at: now, visit_count: visits, updated_at: now },
        { onConflict: "wallet" },
      );
    return { ok: !error };
  });


/**
 * WHO IS ACTUALLY DOING THIS. Throws unless the session proves the wallet.
 *
 * WHAT THIS REPLACES, and it was a forgery hole rather than a leniency. The old
 * `resolveActor` treated a missing or stale session as a reason to trust the
 * CLAIMED wallet:
 *
 *     } catch {
 *       // stale token — the gesture is free, fall through to the claimed wallet
 *     }
 *     return wallet.toLowerCase();
 *
 * The reasoning was that saying hi moves no money and reads nothing back, which
 * is true and beside the point. A welcome is not a private gesture: it puts your
 * name in someone ELSE's interface. With no verification, any caller could post
 * "your Twin said hi" to any wallet, from any wallet — and the server functions
 * are public, so "any caller" means anyone with the URL.
 *
 * Cheapness is a reason not to demand a signature per gesture. It is not a
 * reason to skip authorship. The session is minted once and cached, so the cost
 * of this is one signature per device, not one per hello.
 *
 * The migration comment for `welcomes` already claimed this was how it worked —
 * "AFTER it verifies the caller controls the welcomer wallet". Now it does.
 */
async function verifiedActor(wallet: string, session?: string | null): Promise<string> {
  if (!session) throw new Error("Verify your wallet first.");
  const { assertWalletOwnership } = await import("@/lib/wallet-session.server");
  return assertWalletOwnership(wallet, session);
}

/** Record welcomes (idempotent). */
export const sendWelcomes = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z
      .object({
        wallet: z.string().min(3),
        session: z.string().min(16).max(2000).nullable().optional(),
        recipients: z
          .array(
            z.object({
              recipientWallet: z.string().min(3),
              marketId: z.number().int().nonnegative(),
              side: z.enum(["YES", "NO"]),
            }),
          )
          .min(1)
          .max(100),
      })
      .parse(raw),
  )
  .handler(async ({ data }): Promise<{ welcomed: number }> => {
    const welcomer = await verifiedActor(data.wallet, data.session);
    const sb = serviceClient();

    const rows = data.recipients
      .filter((r) => r.recipientWallet.toLowerCase() !== welcomer) // never welcome yourself
      .map((r) => ({
        welcomer_wallet: welcomer,
        recipient_wallet: r.recipientWallet.toLowerCase(),
        market_id: String(r.marketId),
        side: r.side,
      }));
    if (rows.length === 0) return { welcomed: 0 };

    const { error } = await sb.from("welcomes").upsert(rows, {
      onConflict: "welcomer_wallet,recipient_wallet,market_id,side",
      ignoreDuplicates: true,
    });
    if (error) return { welcomed: 0 };
    return { welcomed: rows.length };
  });

export interface WelcomeReceived {
  count: number;
  welcomers: {
    wallet: string;
    name: string;
    avatarUrl: string | null;
    relationship: string | null;
    agreement: number | null;
  }[];
  /** The most recent welcome's timestamp — the client uses it to not re-nag. */
  latestAt: string | null;
  side: Side | null;
}

/** The recipient side: "N believers welcomed you", aggregated (never N pings). */
export const getWelcomesReceived = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) =>
    z.object({ wallet: z.string().min(3).nullable().optional() }).parse(raw),
  )
  .handler(async ({ data }): Promise<WelcomeReceived> => {
    const empty: WelcomeReceived = { count: 0, welcomers: [], latestAt: null, side: null };
    if (!data.wallet) return empty;
    const sb = serviceClient();
    const viewer = data.wallet.toLowerCase();

    const { data: rows } = await sb
      .from("welcomes")
      .select("welcomer_wallet, market_id, side, created_at")
      .eq("recipient_wallet", viewer)
      .gte("created_at", daysAgoIso(RECEIVED_WINDOW_DAYS))
      .order("created_at", { ascending: false })
      .limit(200);
    const list = (rows ?? []) as {
      welcomer_wallet: string;
      market_id: string;
      side: Side;
      created_at: string;
    }[];
    if (list.length === 0) return empty;

    const received: ReceivedWelcome[] = list.map((r) => ({
      welcomer: r.welcomer_wallet,
      marketId: Number(r.market_id),
      side: r.side,
    }));
    const summary = summarizeReceived(received);

    const { resolveProfiles } = await import("@/lib/profiles.server");
    const [profiles, dna] = await Promise.all([
      resolveProfiles(summary.welcomers),
      relationshipIndex(sb, viewer),
    ]);
    const welcomers = summary.welcomers.slice(0, 12).map((w) => {
      const prof = profiles.get(w);
      const rel = dna.get(w);
      return {
        wallet: w,
        name: prof?.displayName ?? aliasFor(w),
        avatarUrl: prof?.pfpUrl ?? null,
        relationship: rel?.relationship ?? null,
        agreement: rel?.agreement ?? null,
      };
    });

    return {
      count: summary.count,
      welcomers,
      latestAt: list[0].created_at,
      side: summary.tribe?.side ?? null,
    };
  });
