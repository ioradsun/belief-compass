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
import { getBaseClient } from "@/chain/client";
import { decodeTradeLog, PROXY_ADDRESS } from "@/chain/decoder";
import {
  predictHouse,
  scoreHouse,
  foldRecord,
  revealHeadline,
  confidenceBand,
  HOUSE_ENGINE_VERSION,
  type BeliefAction,
  type HouseConfidenceBand,
  type HouseRead,
  type HouseSignals,
  type HouseRecord,
} from "@/domain/house";

export interface HouseReadView {
  marketId: number;
  connected: boolean;
  /** Locked prediction — only ever populated AFTER a real bet reveals it. */
  predicted: BeliefAction | null;
  confidence: number | null;
  reasons: string[];
  /** Present when the House refused to name a side. Safe to show before reveal. */
  noRead: HouseRead["noRead"];
  /**
   * Coarse confidence band — safe to show BEFORE a reveal (it leaks intensity,
   * never the side). Null when there's no directional read. Drives the FOMO copy.
   */
  band: HouseConfidenceBand | null;
  /** True only once a verified BET has unlocked the pick (full reveal). */
  revealed: boolean;
  /** True once the round is finalized by a bet OR a skip. */
  closed: boolean;
  finalizedVia: "bet" | "skip" | null;
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
      band: null,
      revealed: false,
      closed: false,
      finalizedVia: null,
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
    finalized_via: "bet" | "skip" | null;
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
        finalized_via: null,
      };
    }
  }

  // The pick unlocks ONLY on a verified bet. A skip closes the round but keeps
  // the House's directional pick sealed — the FOMO is the point.
  const closed = !!row.actual_action;
  const betRevealed = row.finalized_via === "bet" && !!row.actual_action;
  // Recreate the honest no-read copy from the locked kind, without re-predicting.
  const noRead = row.predicted_action
    ? null
    : predictHouse(await buildSignals(sb, wallet, marketId, category)).noRead;

  // Coarse band is safe to leak pre-reveal (intensity only, never the side).
  const band = row.predicted_action ? confidenceBand(Number(row.confidence ?? 0)) : null;

  const headline: { title: string; line: string } | null = betRevealed
    ? revealHeadline(row.predicted_action, row.actual_action!)
    : closed
      ? {
          title: "You walked away",
          line: "The House already made its call — but you never paid to see it.",
        }
      : null;

  return {
    marketId,
    connected: true,
    predicted: betRevealed ? row.predicted_action : null,
    confidence: betRevealed ? Number(row.confidence ?? 0) : null,
    reasons: betRevealed ? ((row.reasons ?? []) as string[]) : [],
    noRead,
    band,
    revealed: betRevealed,
    closed,
    finalizedVia: row.finalized_via,
    actual: row.actual_action,
    outcome: row.outcome,
    headline,
    record: recordFor(history),
    category,
  };
}

/**
 * Independently verify a buy on Base: the tx must be a confirmed success sent by
 * `wallet`, touching the belief-market contract, with a TokensBought log for
 * THIS market on THIS side. Returns the on-chain shares + ETH, or throws — the
 * client's claimed side/amount is never trusted, only the chain is.
 */
async function verifyBuyOnChain(
  wallet: string,
  marketId: number,
  side: BeliefAction,
  txHash: string,
): Promise<{ shares: string; ethWei: string }> {
  if (side !== "YES" && side !== "NO") throw new Error("A bet must be YES or NO.");
  const hash = txHash as `0x${string}`;
  const receipt = await getBaseClient().getTransactionReceipt({ hash });
  if (!receipt || receipt.status !== "success")
    throw new Error("Transaction is not a confirmed success.");
  if (receipt.from.toLowerCase() !== wallet.toLowerCase())
    throw new Error("Transaction was not sent by this wallet.");

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== PROXY_ADDRESS) continue;
    const t = decodeTradeLog(log);
    if (
      t &&
      t.direction === "BUY" &&
      t.onchain_id === String(marketId) &&
      t.side === side &&
      t.wallet === wallet.toLowerCase()
    ) {
      return { shares: t.token_amount, ethWei: t.eth_amount };
    }
  }
  throw new Error("No matching buy for this market and side in the transaction.");
}

/**
 * Finalize the round with a REAL bet and reveal the House's pick. Verifies the
 * tx on-chain before recording anything. Idempotent: one finalize per prediction
 * and one per tx (a unique index guards the hash). This is the only path that
 * unlocks the predicted side.
 */
export async function finalizeHouseBet(
  walletRaw: string,
  marketId: number,
  side: BeliefAction,
  txHash: string,
): Promise<HouseReadView> {
  const sb = serviceClient();
  const wallet = walletRaw.toLowerCase();
  // Lock the prediction first (created before the bet is recorded).
  await loadHouseRead(wallet, marketId);

  const verified = await verifyBuyOnChain(wallet, marketId, side, txHash);

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
        actual_action: side,
        actual_side: side,
        actual_tx_hash: txHash,
        actual_shares: verified.shares,
        actual_amount_wei: verified.ethWei,
        outcome: scoreHouse(row.predicted_action, side),
        revealed_at: new Date().toISOString(),
        finalized_via: "bet",
      })
      .eq("wallet", wallet)
      .eq("onchain_id", marketId)
      .is("actual_action", null);
  }

  return loadHouseRead(wallet, marketId);
}

/**
 * Finalize the round with a SKIP. Scores the locked prediction but keeps the
 * directional pick SEALED — the viewer never paid to see it. Idempotent.
 */
export async function finalizeHouseSkip(
  walletRaw: string,
  marketId: number,
): Promise<HouseReadView> {
  const sb = serviceClient();
  const wallet = walletRaw.toLowerCase();
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
        actual_action: "SKIP",
        outcome: scoreHouse(row.predicted_action, "SKIP"),
        revealed_at: new Date().toISOString(),
        finalized_via: "skip",
      })
      .eq("wallet", wallet)
      .eq("onchain_id", marketId)
      .is("actual_action", null);
  }

  return loadHouseRead(wallet, marketId);
}
