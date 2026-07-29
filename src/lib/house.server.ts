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
import { decodeFunctionData } from "viem";
import { serviceClient } from "@/lib/supabase-clients";
import { readViewerDnaCache } from "@/lib/dna/viewer-dna-cache.server";
import {
  predictHouse,
  scoreHouse,
  foldRecord,
  revealHeadline,
  confidenceBand,
  applyFoundationAnswer,
  FOUNDATION_MAPPINGS,
  FOUNDATION_MAPPING_VERSION,
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
   * Present while the viewer is still training the House (no / thin history). The
   * card shows this POV to answer for free; once complete the House starts reading.
   */
  foundation: {
    key: string;
    prompt: string;
    answered: number;
    required: number;
    progressLine: string;
  } | null;
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

/** Foundation POV keys this wallet has already answered. */
async function foundationKeys(sb: SupabaseClient, wallet: string): Promise<string[]> {
  const { data } = await sb
    .from("house_foundation_answers")
    .select("foundation_key")
    .eq("wallet", wallet);
  return ((data ?? []) as { foundation_key: string }[]).map((r) => r.foundation_key);
}

/**
 * The viewer's directional belief history — on-chain positions ∪ free expressed
 * beliefs, deduped (on-chain wins), excluding the current market, tagged with
 * category. This is what lets the House read someone after they calibrate:
 * calibration records beliefs, and those beliefs ARE the House's signal.
 */
async function beliefHistory(
  sb: SupabaseClient,
  wallet: string,
  currentMarketId: number,
): Promise<{ category: string | null; side: "YES" | "NO" }[]> {
  const [onchain, expressed] = await Promise.all([
    sb
      .from("wallet_beliefs")
      .select("onchain_id, stance_side")
      .eq("wallet", wallet)
      .in("stance_side", ["YES", "NO"]),
    sb.from("expressed_beliefs").select("onchain_id, side").eq("wallet", wallet),
  ]);
  const side = new Map<number, "YES" | "NO">();
  for (const r of (expressed.data ?? []) as { onchain_id: number; side: string }[])
    side.set(Number(r.onchain_id), r.side === "NO" ? "NO" : "YES");
  for (const r of (onchain.data ?? []) as { onchain_id: number; stance_side: string }[])
    side.set(Number(r.onchain_id), r.stance_side === "NO" ? "NO" : "YES"); // on-chain overrides
  side.delete(currentMarketId);
  const ids = [...side.keys()];
  if (ids.length === 0) return [];

  const catOf = new Map<number, string | null>();
  for (let i = 0; i < ids.length; i += 500) {
    const { data } = await sb
      .from("markets")
      .select("onchain_id, category")
      .in("onchain_id", ids.slice(i, i + 500));
    for (const m of (data ?? []) as { onchain_id: number; category: string | null }[])
      catOf.set(Number(m.onchain_id), m.category);
  }
  return ids.map((id) => ({ category: catOf.get(id) ?? null, side: side.get(id)! }));
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
  foundationCount = 0,
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
  const [history, rel, beliefs] = await Promise.all([
    answerHistory(sb, wallet),
    relationshipLean(sb, wallet, marketId),
    beliefHistory(sb, wallet, marketId),
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
  // The viewer's beliefs (calibration + on-chain) are directional signal too.
  for (const b of beliefs) {
    const key = b.side === "NO" ? "no" : "yes";
    overall[key]++;
    if (category && b.category === category) inCategory[key]++;
  }
  return {
    connected: true,
    category,
    // Beliefs + completed foundation answers count toward the unlock gate, so once
    // the viewer has calibrated the engine reads markets instead of cold-starting.
    totalAnswers: overall.yes + overall.no + overall.skip + foundationCount,
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
      foundation: null,
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

  // Cold start is owned by the shared calibration flow (the House Read section
  // shows the belief quiz until the viewer is calibrated), so the House no longer
  // gates on its own foundation here. Foundation answers still count as signal.
  const foundationCount = (await foundationKeys(sb, wallet)).length;

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
    const signals = await buildSignals(sb, wallet, marketId, category, foundationCount);
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
    : predictHouse(await buildSignals(sb, wallet, marketId, category, foundationCount)).noRead;

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
    foundation: null,
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
 * Prove the reveal was paid for: the tx must exist on Base, have succeeded, be
 * addressed to the pinned belief-market proxy, and decode to `buy(marketId, yes, …)`
 * for exactly this market and side. Anything else refuses the reveal.
 */
async function verifyBetTransaction(
  marketId: number,
  side: BeliefAction,
  txHash: string,
): Promise<void> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error("That transaction isn't valid.");
  const [{ getBaseClient }, { PROXY_ADDRESS }, { TRADE_ABI }] = await Promise.all([
    import("@/chain/client"),
    import("@/chain/decoder"),
    import("@/lib/chain-trade"),
  ]);
  const client = getBaseClient();
  const hash = txHash as `0x${string}`;

  const receipt = await client.getTransactionReceipt({ hash }).catch(() => null);
  if (!receipt || receipt.status !== "success")
    throw new Error("That transaction hasn't confirmed on Base yet.");

  const tx = await client.getTransaction({ hash }).catch(() => null);
  if (!tx?.to || tx.to.toLowerCase() !== PROXY_ADDRESS.toLowerCase())
    throw new Error("That transaction isn't a belief-market trade.");

  let decoded: { functionName: string; args?: readonly unknown[] };
  try {
    decoded = decodeFunctionData({ abi: TRADE_ABI, data: tx.input });
  } catch {
    throw new Error("That transaction isn't a belief-market buy.");
  }
  if (decoded.functionName !== "buy") throw new Error("Only a buy reveals the House pick.");
  const args = (decoded.args ?? []) as [bigint, boolean, bigint];
  if (Number(args[0]) !== marketId) throw new Error("That buy was on a different market.");
  if ((args[1] ? "YES" : "NO") !== side) throw new Error("That buy was on the other side.");
}

/**
 * Finalize the round with a bet and reveal the House's pick — the only path that
 * unlocks the predicted side. Idempotent: one finalize per prediction and one per
 * tx (a unique index guards the hash).
 */
export async function finalizeHouseBet(
  walletRaw: string,
  marketId: number,
  side: BeliefAction,
  txHash: string,
): Promise<HouseReadView> {
  if (side !== "YES" && side !== "NO") throw new Error("A bet must be YES or NO.");
  const sb = serviceClient();
  const wallet = walletRaw.toLowerCase();
  // Lock the prediction first (created before the bet is recorded).
  await loadHouseRead(wallet, marketId);

  // The pick only unlocks against a REAL, mined buy on this market. We verify the
  // transaction on Base server-side (receipt succeeded, it touched the pinned
  // belief-market proxy, and it decodes to a buy of this market on this side)
  // before revealing anything. The hash is uniquely indexed so one tx reveals once.
  await verifyBetTransaction(marketId, side, txHash);
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

/**
 * Record one FREE foundation belief (no money). Stores the raw answer, mapping
 * version, and per-dimension contributions; one answer per (wallet, POV). Returns
 * the refreshed read for `marketId` so the card advances to the next POV or the
 * House unlocks. Ignores unknown keys.
 */
export async function recordFoundationAnswer(
  walletRaw: string,
  marketId: number,
  key: string,
  action: BeliefAction,
): Promise<HouseReadView> {
  const sb = serviceClient();
  const wallet = walletRaw.toLowerCase();
  const mapping = FOUNDATION_MAPPINGS.find((m) => m.key === key);
  if (mapping) {
    await sb.from("house_foundation_answers").upsert(
      {
        wallet,
        foundation_key: mapping.key,
        action,
        mapping_version: FOUNDATION_MAPPING_VERSION,
        dimension_contributions: applyFoundationAnswer(mapping, action),
      },
      { onConflict: "wallet,foundation_key", ignoreDuplicates: true },
    );
  }
  return loadHouseRead(wallet, marketId);
}
