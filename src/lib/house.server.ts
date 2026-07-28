/**
 * The House — server side (IO only; all judgement lives in src/domain/house.ts).
 *
 * Responsibilities:
 *   • gather the viewer's real signals (their own answer history by category,
 *     their skip behaviour, and how their closest DNA matches sit on THIS market)
 *   • lock exactly one prediction per (wallet, market) before the viewer answers
 *   • record the answer once, score the locked prediction once, and never
 *     recompute a prediction after the fact.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/supabase-clients";
import { readViewerDnaCache } from "@/lib/dna/viewer-dna-cache.server";
import {
  predictHouse,
  scoreHouse,
  foldRecord,
  revealHeadline,
  HOUSE_ENGINE_VERSION,
  type BeliefAction,
  type HouseRead,
  type HouseSignals,
  type HouseRecord,
} from "@/domain/house";

export interface HouseReadView {
  marketId: number;
  connected: boolean;
  /** Locked prediction — only ever populated AFTER the viewer has answered. */
  predicted: BeliefAction | null;
  confidence: number | null;
  reasons: string[];
  /** Present when the House refused to name a side. Safe to show before reveal. */
  noRead: HouseRead["noRead"];
  revealed: boolean;
  actual: BeliefAction | null;
  outcome: "correct" | "miss" | "unscored" | null;
  headline: { title: string; line: string } | null;
  record: HouseRecord;
  category: string | null;
}

type AnswerRow = {
  category: string | null;
  actual_action: BeliefAction | null;
  predicted_action: BeliefAction | null;
};

async function marketCategory(sb: SupabaseClient, marketId: number): Promise<string | null> {
  const { data } = await sb
    .from("markets")
    .select("category")
    .eq("onchain_id", marketId)
    .maybeSingle();
  return ((data as { category?: string | null } | null)?.category ?? null) as string | null;
}

async function answerHistory(sb: SupabaseClient, wallet: string): Promise<AnswerRow[]> {
  const { data } = await sb
    .from("house_predictions")
    .select("category, actual_action, predicted_action")
    .eq("wallet", wallet)
    .not("actual_action", "is", null)
    .order("revealed_at", { ascending: false })
    .limit(400);
  return (data ?? []) as AnswerRow[];
}

/** How the viewer's closest matches (twin + tribe) sit on this exact market. */
async function relationshipLean(sb: SupabaseClient, wallet: string, marketId: number) {
  const cache = await readViewerDnaCache(sb, wallet);
  if (!cache) return null;
  const close = [...cache.twin, ...cache.tribe].slice(0, 40);
  if (close.length === 0) return null;
  const { data } = await sb
    .from("wallet_beliefs")
    .select("wallet, stance_side")
    .eq("onchain_id", marketId)
    .in(
      "wallet",
      close.map((c) => c.wallet),
    )
    .in("stance_side", ["YES", "NO"]);
  const rows = (data ?? []) as { wallet: string; stance_side: "YES" | "NO" }[];
  if (rows.length === 0) return null;
  const byWallet = new Map(close.map((c) => [c.wallet.toLowerCase(), c]));
  let yes = 0;
  let no = 0;
  let conf = 0;
  for (const r of rows) {
    const rel = byWallet.get(r.wallet.toLowerCase());
    if (!rel) continue;
    if (r.stance_side === "YES") yes++;
    else no++;
    conf += rel.confidence ?? 0;
  }
  const n = yes + no;
  if (n === 0) return null;
  const domain = close[0]?.strongestAlignedDomain?.name ?? null;
  return { yes, no, confidence: Math.min(1, conf / n), domain };
}

async function buildSignals(
  sb: SupabaseClient,
  wallet: string | null,
  marketId: number,
  category: string | null,
): Promise<HouseSignals> {
  if (!wallet) {
    return {
      connected: false,
      category,
      totalAnswers: 0,
      overall: { yes: 0, no: 0, skip: 0 },
      inCategory: { yes: 0, no: 0, skip: 0 },
    };
  }
  const [history, rel] = await Promise.all([
    answerHistory(sb, wallet),
    relationshipLean(sb, wallet, marketId),
  ]);
  const overall = { yes: 0, no: 0, skip: 0 };
  const inCategory = { yes: 0, no: 0, skip: 0 };
  for (const row of history) {
    const a = row.actual_action;
    if (!a) continue;
    const key = a === "YES" ? "yes" : a === "NO" ? "no" : "skip";
    overall[key]++;
    if (category && row.category === category) inCategory[key]++;
  }
  return {
    connected: true,
    category,
    totalAnswers: overall.yes + overall.no + overall.skip,
    overall,
    inCategory,
    relationship: rel,
  };
}

function recordFor(history: AnswerRow[]): HouseRecord {
  return foldRecord(
    history.map((h) => ({ predicted: h.predicted_action, actual: h.actual_action })),
  );
}

/**
 * Read (and, on first sight, LOCK) the House's prediction for this market.
 * The predicted side is withheld from the payload until the viewer has answered.
 */
export async function loadHouseRead(
  walletRaw: string | null,
  marketId: number,
): Promise<HouseReadView> {
  const sb = serviceClient();
  const wallet = walletRaw ? walletRaw.toLowerCase() : null;
  const category = await marketCategory(sb, marketId);

  if (!wallet) {
    const read = predictHouse({
      connected: false,
      category,
      totalAnswers: 0,
      overall: { yes: 0, no: 0, skip: 0 },
      inCategory: { yes: 0, no: 0, skip: 0 },
    });
    return {
      marketId,
      connected: false,
      predicted: null,
      confidence: null,
      reasons: [],
      noRead: read.noRead,
      revealed: false,
      actual: null,
      outcome: null,
      headline: null,
      record: foldRecord([]),
      category,
    };
  }

  const [{ data: existing }, history] = await Promise.all([
    sb
      .from("house_predictions")
      .select("*")
      .eq("wallet", wallet)
      .eq("onchain_id", marketId)
      .maybeSingle(),
    answerHistory(sb, wallet),
  ]);

  type Row = {
    predicted_action: BeliefAction | null;
    confidence: number | null;
    reasons: string[] | null;
    no_read_kind: string | null;
    actual_action: BeliefAction | null;
    outcome: "correct" | "miss" | "unscored" | null;
    revealed_at: string | null;
  };
  let row = (existing ?? null) as Row | null;

  if (!row) {
    const signals = await buildSignals(sb, wallet, marketId, category);
    const read = predictHouse(signals);
    await sb.from("house_predictions").upsert(
      {
        wallet,
        onchain_id: marketId,
        category,
        predicted_action: read.action,
        confidence: read.confidence,
        reasons: read.reasons,
        no_read_kind: read.noRead?.kind ?? null,
        engine_version: HOUSE_ENGINE_VERSION,
      },
      { onConflict: "wallet,onchain_id", ignoreDuplicates: true },
    );
    const { data: after } = await sb
      .from("house_predictions")
      .select("*")
      .eq("wallet", wallet)
      .eq("onchain_id", marketId)
      .maybeSingle();
    row = (after ?? null) as Row | null;
    if (!row) {
      row = {
        predicted_action: read.action,
        confidence: read.confidence,
        reasons: read.reasons,
        no_read_kind: read.noRead?.kind ?? null,
        actual_action: null,
        outcome: null,
        revealed_at: null,
      };
    }
  }

  const revealed = !!row.actual_action;
  // Recreate the honest no-read copy from the locked kind, without re-predicting.
  const noRead = row.predicted_action
    ? null
    : predictHouse(await buildSignals(sb, wallet, marketId, category)).noRead;

  return {
    marketId,
    connected: true,
    predicted: revealed ? row.predicted_action : null,
    confidence: revealed ? Number(row.confidence ?? 0) : null,
    reasons: revealed ? ((row.reasons ?? []) as string[]) : [],
    noRead,
    revealed,
    actual: row.actual_action,
    outcome: row.outcome,
    headline: revealed ? revealHeadline(row.predicted_action, row.actual_action!) : null,
    record: recordFor(history),
    category,
  };
}

/**
 * Record the viewer's belief action once and score the LOCKED prediction.
 * Idempotent: answering twice never re-scores and never rewrites the prediction.
 * This is a belief action only — it moves no money.
 */
export async function recordBeliefAnswer(
  walletRaw: string,
  marketId: number,
  action: BeliefAction,
  source: string,
): Promise<HouseReadView> {
  const sb = serviceClient();
  const wallet = walletRaw.toLowerCase();
  // Make sure a locked prediction exists first (created before the answer).
  await loadHouseRead(wallet, marketId);

  const { data: existing } = await sb
    .from("house_predictions")
    .select("predicted_action, actual_action")
    .eq("wallet", wallet)
    .eq("onchain_id", marketId)
    .maybeSingle();
  const row = existing as {
    predicted_action: BeliefAction | null;
    actual_action: BeliefAction | null;
  } | null;

  if (row && !row.actual_action) {
    await sb
      .from("house_predictions")
      .update({
        actual_action: action,
        outcome: scoreHouse(row.predicted_action, action),
        revealed_at: new Date().toISOString(),
        answer_source: source,
      })
      .eq("wallet", wallet)
      .eq("onchain_id", marketId)
      .is("actual_action", null);
  }

  return loadHouseRead(wallet, marketId);
}
