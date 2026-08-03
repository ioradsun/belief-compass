/**
 * Share attribution — server functions.
 *
 * The foundation for "See your impact". These record who arrived via whose link
 * and, at read time, join those arrivals against the canonical wallet_beliefs to
 * report honest impact (believers + capital). ATTRIBUTION ONLY — no rewards, no
 * fees, no on-chain effects. See supabase/migrations/*_share_attribution.sql.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { serviceClient } from "@/lib/supabase-clients";
import { composeShareImpact, type ShareImpact } from "@/domain/share-impact";

const WALLET = /^0x[a-fA-F0-9]{40}$/;

/** A short, unambiguous, human-readable code (no vowels, no look-alikes). */
const ALPHABET = "0123456789abcdefghjkmnpqrstuvwxyz"; // Crockford-ish, minus vowels
function randomCode(len = 7): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let s = "";
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return s;
}

/**
 * The stable ?r= code for a wallet — created on first share, reused forever.
 * Not ownership-gated: a code is just a public handle for attribution (it grants
 * nothing), and the share control needs it for whichever wallet is connected.
 */
export const getShareCode = createServerFn({ method: "GET" })
  .inputValidator((d: { wallet: string }) =>
    z.object({ wallet: z.string().regex(WALLET) }).parse(d),
  )
  .handler(async ({ data }): Promise<{ code: string }> => {
    const wallet = data.wallet.toLowerCase();
    const sb = serviceClient();

    const { data: existing } = await sb
      .from("share_codes")
      .select("code")
      .eq("wallet", wallet)
      .maybeSingle();
    if (existing?.code) return { code: existing.code as string };

    // Create one, retrying on the (astronomically unlikely) code collision.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomCode();
      const { error } = await sb.from("share_codes").insert({ code, wallet });
      if (!error) return { code };
      // A concurrent request may have created this wallet's code first — reread.
      const { data: race } = await sb
        .from("share_codes")
        .select("code")
        .eq("wallet", wallet)
        .maybeSingle();
      if (race?.code) return { code: race.code as string };
    }
    // Attribution is a nice-to-have: never let a minting failure break a page.
    return { code: "" };
  });

/**
 * Record a link OPEN: one row per (link, market, visitor). Public and
 * idempotent — a re-open updates the same row rather than piling up. The
 * visitorId is an anonymous per-browser id; no wallet, no account.
 */
export const recordShareVisit = createServerFn({ method: "POST" })
  .inputValidator((d: { refCode: string; marketId: number; visitorId: string }) =>
    z
      .object({
        refCode: z.string().min(3).max(40),
        marketId: z.number().int().nonnegative(),
        visitorId: z.string().min(6).max(80),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const sb = serviceClient();
    // Don't attribute a visit to a code that doesn't exist (bad/forged ?r=).
    const { data: code } = await sb
      .from("share_codes")
      .select("wallet")
      .eq("code", data.refCode)
      .maybeSingle();
    if (!code) return { ok: false };

    await sb.from("share_visits").upsert(
      {
        ref_code: data.refCode,
        market_id: data.marketId,
        visitor_id: data.visitorId,
        opened_at: new Date().toISOString(),
      },
      { onConflict: "ref_code,market_id,visitor_id", ignoreDuplicates: true },
    );
    return { ok: true };
  });

/**
 * Bind this visitor's opens to the wallet they just connected — the moment an
 * anonymous arrival becomes an attributable person. Ownership-gated: you can
 * only bind visits to a wallet you've proven you control, and never to the
 * sharer's own wallet (you don't get to convert yourself).
 */
export const bindShareVisit = createServerFn({ method: "POST" })
  .inputValidator((d: { visitorId: string; wallet: string; sessionToken: string }) =>
    z
      .object({
        visitorId: z.string().min(6).max(80),
        wallet: z.string().regex(WALLET),
        sessionToken: z.string().min(8),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<{ bound: number }> => {
    const { assertWalletOwnership } = await import("@/lib/wallet-session.server");
    const wallet = await assertWalletOwnership(data.wallet, data.sessionToken);
    const sb = serviceClient();

    // Only bind opens that are still unattributed and NOT this wallet's own links.
    const { data: rows } = await sb
      .from("share_visits")
      .select("id, ref_code")
      .eq("visitor_id", data.visitorId)
      .is("wallet", null);
    const list = (rows ?? []) as { id: number; ref_code: string }[];
    if (list.length === 0) return { bound: 0 };

    // Which of those codes belong to THIS wallet — self-referrals to skip.
    const codes = [...new Set(list.map((r) => r.ref_code))];
    const { data: mine } = await sb
      .from("share_codes")
      .select("code")
      .eq("wallet", wallet)
      .in("code", codes);
    const own = new Set((mine ?? []).map((r) => (r as { code: string }).code));
    const bindIds = list.filter((r) => !own.has(r.ref_code)).map((r) => r.id);
    if (bindIds.length === 0) return { bound: 0 };

    await sb
      .from("share_visits")
      .update({ wallet, connected_at: new Date().toISOString() })
      .in("id", bindIds);
    return { bound: bindIds.length };
  });

/** The latest ETH→USD rate from the cron-refreshed snapshot (0 when unknown). */
async function rate(sb: ReturnType<typeof serviceClient>): Promise<number> {
  const { data } = await sb.from("calc_cache").select("value").eq("key", "eth_usd").maybeSingle();
  return Number((data as { value?: number } | null)?.value ?? 0) || 0;
}

export interface ShareImpactResult {
  /** Distinct visitors who opened the sharer's links. */
  opens: number;
  /** Attributed wallets that took a directional position (real believers). */
  believers: number;
  /** Capital those believers committed, in USD (cost basis, best-effort). */
  capitalUsd: number;
  /** The composed, honest impact line. */
  impact: ShareImpact;
}

/**
 * What one wallet's sharing has actually brought in. Impact is COMPUTED here by
 * joining attributed arrivals against canonical wallet_beliefs — believers and
 * capital always agree with the market itself. Scoped to one market when a
 * marketId is given, otherwise the sharer's whole footprint.
 */
export const getShareImpact = createServerFn({ method: "GET" })
  .inputValidator((d: { wallet: string; sessionToken: string; marketId?: number | null }) =>
    z
      .object({
        wallet: z.string().regex(WALLET),
        sessionToken: z.string().min(8),
        marketId: z.number().int().nonnegative().nullish(),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<ShareImpactResult> => {
    const { walletFromToken } = await import("@/lib/wallet-session.server");
    const signer = await walletFromToken(data.sessionToken);
    const wallet = data.wallet.toLowerCase();
    // Impact is personal — only the wallet itself (or a linked one) may read it.
    if (!signer || (signer !== wallet && !(await isLinked(signer, wallet)))) {
      const empty = composeShareImpact({ opens: 0, believers: 0, capitalUsd: 0 });
      return { opens: 0, believers: 0, capitalUsd: 0, impact: empty };
    }

    const sb = serviceClient();
    const { data: codeRows } = await sb.from("share_codes").select("code").eq("wallet", wallet);
    const codes = (codeRows ?? []).map((r) => (r as { code: string }).code);
    const scope: "market" | "all" = data.marketId != null ? "market" : "all";
    if (codes.length === 0) {
      return {
        opens: 0,
        believers: 0,
        capitalUsd: 0,
        impact: composeShareImpact({ opens: 0, believers: 0, capitalUsd: 0, scope }),
      };
    }

    let visitsQ = sb
      .from("share_visits")
      .select("visitor_id, wallet, market_id")
      .in("ref_code", codes);
    if (data.marketId != null) visitsQ = visitsQ.eq("market_id", data.marketId);
    const { data: visitRows } = await visitsQ;
    const visits = (visitRows ?? []) as {
      visitor_id: string;
      wallet: string | null;
      market_id: number | null;
    }[];

    const opens = new Set(visits.map((v) => v.visitor_id)).size;
    // Attributed wallets (connected arrivals), never the sharer themselves.
    const converted = visits.filter((v) => v.wallet && v.wallet.toLowerCase() !== wallet);
    const walletsByMarket = new Map<number, Set<string>>();
    for (const v of converted) {
      if (v.market_id == null) continue;
      const set = walletsByMarket.get(v.market_id) ?? new Set<string>();
      set.add(v.wallet!.toLowerCase());
      walletsByMarket.set(v.market_id, set);
    }

    // Join arrivals → canonical beliefs: a believer is a directional position,
    // capital is that position's cost basis. Query per market (small N).
    let believers = 0;
    let ethCost = 0;
    for (const [marketId, wallets] of walletsByMarket) {
      const { data: beliefs } = await sb
        .from("wallet_beliefs")
        .select("wallet, stance_side, yes_cost, no_cost")
        .eq("onchain_id", marketId)
        .in("wallet", [...wallets]);
      for (const b of (beliefs ?? []) as {
        stance_side: string | null;
        yes_cost: number | null;
        no_cost: number | null;
      }[]) {
        if (b.stance_side !== "YES" && b.stance_side !== "NO") continue; // directional only
        believers += 1;
        ethCost += (Number(b.yes_cost) || 0) + (Number(b.no_cost) || 0);
      }
    }

    const ethUsd = await rate(sb);
    const capitalUsd = ethUsd > 0 ? ethCost * ethUsd : 0;
    const impact = composeShareImpact({ opens, believers, capitalUsd, scope });
    return { opens, believers, capitalUsd, impact };
  });

/** Whether `signer` has verifiably linked itself to `target` (POV wallet link). */
async function isLinked(signer: string, target: string): Promise<boolean> {
  const sb = serviceClient();
  const { data } = await sb
    .from("wallet_links")
    .select("connected_wallet")
    .eq("connected_wallet", signer)
    .eq("linked_wallet", target)
    .not("verified_at", "is", null)
    .limit(1);
  return !!data?.length;
}
