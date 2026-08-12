/**
 * The House — server side (IO only; all judgement lives in src/domain/house.ts).
 *
 * Responsibilities:
 *   • gather the viewer's real signals (their own answer history by category,
 *     their pass behaviour, and how their closest DNA matches sit on THIS market)
 *   • lock exactly one prediction per (wallet, market) before the viewer answers
 *   • record the answer once, score the locked prediction once, and never
 *     recompute a prediction after the fact.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { decodeFunctionData, parseAbi } from "viem";
import { serviceClient } from "@/lib/supabase-clients";
import { rowsOf } from "@/lib/supabase-read";
import { readViewerDnaCache } from "@/lib/dna/viewer-dna-cache.server";
import { recordViewerDecision } from "@/lib/viewer-decisions.server";
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

/**
 * WHICH LEDGER'S ROUND. The real one is consumed by a mined transaction; the
 * Simulation one by a settled Simulation order. They are stored apart so neither
 * can close, reveal or score the other.
 */
export type HouseMode = "REAL" | "SIMULATION";

/** The Simulation round for one wallet and market, or nothing yet. */
interface SimulationRound {
  actual_action: BeliefAction | null;
  finalized_via: "bet" | "pass" | null;
  revealed_at: string | null;
}

async function simulationRound(
  sb: SupabaseClient,
  wallet: string,
  marketId: number,
): Promise<SimulationRound | null> {
  const { data } = await sb
    .from("simulation_house_rounds")
    .select("actual_action, finalized_via, revealed_at")
    .eq("wallet", wallet)
    .eq("onchain_id", marketId)
    .maybeSingle();
  return (data ?? null) as SimulationRound | null;
}

export interface HouseReadView {
  marketId: number;
  connected: boolean;
  /** Locked prediction — only ever populated AFTER a real bet reveals it. */
  predicted: BeliefAction | null;
  /**
   * The side the House will CALL, exposed before the decision ONLY when the read
   * is strong enough (STRONG_READ) and the round is still open. This is the
   * high-confidence reveal — every other read keeps the side sealed until a bet.
   */
  preview: BeliefAction | null;
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
  /** True once the round is finalized by a bet OR a pass. */
  closed: boolean;
  finalizedVia: "bet" | "pass" | null;
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

// Read-tolerance for the SKIP→PASS rename: legacy rows may still hold the old
// tokens until the backfill migration runs, so normalize everything on the way
// in. The code always WRITES the new tokens.
function normAction(a: string | null): BeliefAction | null {
  if (a == null) return null;
  return a === "SKIP" ? "PASS" : (a as BeliefAction);
}
function normVia(v: string | null): "bet" | "pass" | null {
  if (v == null) return null;
  return v === "skip" ? "pass" : (v as "bet" | "pass");
}

async function marketCategory(sb: SupabaseClient, marketId: number): Promise<string | null> {
  const { data } = await sb
    .from("markets")
    .select("category")
    .eq("onchain_id", marketId)
    .maybeSingle();
  return ((data as { category?: string | null } | null)?.category ?? null) as string | null;
}

async function answerHistory(
  sb: SupabaseClient,
  wallet: string,
  excludeMarketId?: number,
): Promise<AnswerRow[]> {
  /**
   * THIS IS THE HOUSE'S EVIDENCE ABOUT YOU. Every read of it becomes a claim —
   * how well it knows you, what it has seen you do, whether it has earned the
   * right to guess. An empty list from a blocked read says "we have never seen
   * you decide anything", which is the most confident thing this module can say
   * and the easiest one to say by accident.
   */
  const rows = rowsOf(
    await sb
      .from("house_predictions")
      .select("category, actual_action, predicted_action")
      .eq("wallet", wallet)
      .not("actual_action", "is", null)
      .not("onchain_id", "eq", excludeMarketId ?? -1)
      .order("revealed_at", { ascending: false })
      .limit(400),
    "this wallet's answer history",
  ) as AnswerRow[];
  // Normalize legacy SKIP → PASS so every downstream consumer sees new tokens.
  return rows.map((r) => ({
    category: r.category,
    actual_action: normAction(r.actual_action),
    predicted_action: normAction(r.predicted_action),
  }));
}

/** Foundation POV keys this wallet has already answered. */
async function foundationKeys(sb: SupabaseClient, wallet: string): Promise<string[]> {
  // A blocked read here would re-ask questions this person has already answered,
  // which reads as the product having forgotten them.
  return (
    rowsOf(
      await sb.from("house_foundation_answers").select("foundation_key").eq("wallet", wallet),
      "the foundation questions this wallet has answered",
    ) as { foundation_key: string }[]
  ).map((r) => r.foundation_key);
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
      overall: { yes: 0, no: 0, pass: 0 },
      inCategory: { yes: 0, no: 0, pass: 0 },
    };
  }
  const [history, rel, beliefs] = await Promise.all([
    answerHistory(sb, wallet, marketId),
    relationshipLean(sb, wallet, marketId),
    beliefHistory(sb, wallet, marketId),
  ]);
  const overall = { yes: 0, no: 0, pass: 0 };
  const inCategory = { yes: 0, no: 0, pass: 0 };
  for (const row of history) {
    const a = row.actual_action;
    if (!a) continue;
    const key = a === "YES" ? "yes" : a === "NO" ? "no" : "pass";
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
    totalAnswers: overall.yes + overall.no + overall.pass + foundationCount,
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
  /**
   * WHICH ROUND THIS IS.
   *
   * The PREDICTION is shared: the House's read of a person is the same read
   * whichever ledger they are trading in, and merely looking at it consumes
   * nothing. The ROUND is not — a reveal is a one-time unlock per wallet and
   * market, and a simulated position must never spend the real one. In
   * SIMULATION the round is overlaid from `simulation_house_rounds` and
   * `house_predictions.actual_action` is neither read as closed nor written.
   */
  mode: HouseMode = "REAL",
): Promise<HouseReadView> {
  const sb = serviceClient();
  const wallet = walletRaw ? walletRaw.toLowerCase() : null;
  const category = await marketCategory(sb, marketId);

  if (!wallet) {
    const read = predictHouse({
      connected: false,
      category,
      totalAnswers: 0,
      overall: { yes: 0, no: 0, pass: 0 },
      inCategory: { yes: 0, no: 0, pass: 0 },
    });
    return {
      marketId,
      connected: false,
      predicted: null,
      preview: null,
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
    finalized_via: "bet" | "pass" | "skip" | null;
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
  } else if (!row.predicted_action) {
    /**
     * A NO-READ IS NOT A LOCK.
     *
     * Locking exists so the House can't quietly rewrite a call it already made.
     * A row where the House DECLINED to call (predicted_action null) made no
     * call to protect — and the reason it declined (cold start, new category,
     * thin sample) is exactly the thing that stops being true as the viewer
     * builds history. Left as-is, that first empty read followed the market
     * forever and the reader stayed "still learning" no matter how much they
     * played. So while the round is still OPEN and unpicked, re-read it with
     * everything we know today and persist the upgrade. Once a side is named,
     * or the round closes, it is locked for good.
     *
     * A CLOSED ROW THAT NEVER HELD A CALL is the same defect one step later: it
     * shows the reader a question with no read at all. There is nothing to
     * protect, so it is filled in too — the history that feeds it excludes this
     * market, so the fill is not hindsight.
     */
    const read = predictHouse(await buildSignals(sb, wallet, marketId, category, foundationCount));
    if (read.action) {
      await sb
        .from("house_predictions")
        .update({
          predicted_action: read.action,
          confidence: read.confidence,
          reasons: read.reasons,
          no_read_kind: null,
          engine_version: HOUSE_ENGINE_VERSION,
        })
        .eq("wallet", wallet)
        .eq("onchain_id", marketId)
        .is("predicted_action", null);
      row = {
        ...row,
        predicted_action: read.action,
        confidence: read.confidence,
        reasons: read.reasons,
        no_read_kind: null,
      };
    }
  }


  /**
   * THE ROUND, FROM WHICHEVER LEDGER OWNS IT.
   *
   * In SIMULATION the real round is deliberately ignored — not merged, not
   * consulted as a fallback. A wallet with an unopened real round on this market
   * still has one after simulating it, and a wallet that already revealed the
   * real one does not get told, in Simulation, that it is already closed.
   */
  const simRound = mode === "SIMULATION" ? await simulationRound(sb, wallet, marketId) : null;

  // Normalize any legacy SKIP/skip tokens on the locked row (pre-backfill).
  const predictedAction = normAction(row.predicted_action);
  const actualAction = normAction(
    mode === "SIMULATION" ? (simRound?.actual_action ?? null) : row.actual_action,
  );
  const finalizedVia = normVia(
    mode === "SIMULATION" ? (simRound?.finalized_via ?? null) : row.finalized_via,
  );

  // The pick unlocks ONLY on a verified bet. A pass closes the round but keeps
  // the House's directional pick sealed — the FOMO is the point.
  const closed = !!actualAction;
  const betRevealed = finalizedVia === "bet" && !!actualAction;
  // Recreate the honest no-read copy from the locked kind, without re-predicting.
  const noRead = predictedAction
    ? null
    : predictHouse(await buildSignals(sb, wallet, marketId, category, foundationCount)).noRead;

  // Coarse band is safe to leak pre-reveal (intensity only, never the side).
  const band = predictedAction ? confidenceBand(Number(row.confidence ?? 0)) : null;

  // The pre-decision call: once the read is at least a HUNCH we name the side
  // before the choice. Anything weaker stays sealed — but holding the call back
  // until near-certainty is what made a well-known player see "learning you" on
  // market after market.
  const callable = band === "HUNCH" || band === "READ" || band === "STRONG_READ";
  const preview = !closed && callable ? predictedAction : null;


  // A completed round proves itself, however it completed. Only an OPEN round
  // keeps the pick sealed — a pass is still an answer and earns the verdict.
  const settled = closed && !!predictedAction;
  const headline: { title: string; line: string } | null = betRevealed
    ? revealHeadline(predictedAction, actualAction!)
    : closed
      ? {
          title: "You walked away",
          line: "The House already made its call — but you never paid to see it.",
        }
      : null;

  return {
    marketId,
    connected: true,
    predicted: settled ? predictedAction : null,
    preview,
    confidence: settled ? Number(row.confidence ?? 0) : null,
    reasons: settled ? ((row.reasons ?? []) as string[]) : [],
    noRead,
    foundation: null,
    band,
    revealed: betRevealed,
    closed,
    finalizedVia,
    actual: actualAction,
    // Scored live in Simulation rather than read off the real row: the stored
    // outcome belongs to the real round and would be somebody else's answer.
    outcome: actualAction ? scoreHouse(predictedAction, actualAction) : (mode === "SIMULATION" ? null : row.outcome),
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
  /**
   * THE TRANSACTION IS THE SIGNATURE.
   *
   * A mined buy sent FROM this address is stronger proof of ownership than any
   * off-chain message could be — so the reveal never asks the wallet to sign a
   * second time after the purchase it just paid for.
   */
  wallet: string,
): Promise<void> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error("That transaction isn't valid.");
  const [{ getBaseClient }, { PROXY_ADDRESS }] = await Promise.all([
    import("@/chain/client"),
    import("@/chain/decoder"),
  ]);
  const BUY_ABI = parseAbi(["function buy(uint256 marketId, bool yes, uint256 minTokens) payable"]);
  const client = getBaseClient();
  const hash = txHash as `0x${string}`;

  const receipt = await client.getTransactionReceipt({ hash }).catch(() => null);
  if (!receipt || receipt.status !== "success")
    throw new Error("That transaction hasn't confirmed on Base yet.");

  const tx = await client.getTransaction({ hash }).catch(() => null);
  if (!tx?.to || tx.to.toLowerCase() !== PROXY_ADDRESS.toLowerCase())
    throw new Error("That transaction isn't a belief-market trade.");
  if (!tx.from || tx.from.toLowerCase() !== wallet.toLowerCase())
    throw new Error("That buy was sent from a different wallet.");

  let decoded: { functionName: string; args?: readonly unknown[] };
  try {
    decoded = decodeFunctionData({ abi: BUY_ABI, data: tx.input });
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
  await verifyBetTransaction(marketId, side, txHash, wallet);
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
        outcome: scoreHouse(normAction(row.predicted_action), side),
        revealed_at: new Date().toISOString(),
        finalized_via: "bet",
      })
      .eq("wallet", wallet)
      .eq("onchain_id", marketId)
      .is("actual_action", null);
  }

  // A confirmed purchase removes this market from discovery (V1). Best-effort:
  // the on-chain buy is authoritative and must never fail because an off-chain
  // write did — the record is idempotent and retried on the next finalize.
  try {
    await recordViewerDecision(wallet, marketId, side);
  } catch {
    /* purchase stands; the decision row will be re-written on retry */
  }

  return loadHouseRead(wallet, marketId);
}

/**
 * FINALIZE A SIMULATION ROUND WITH A SETTLED ORDER — the mirror of the real path.
 *
 * The proof is different in kind but not in strength: a real reveal requires a
 * mined transaction sent from this wallet, and this requires a settled Simulation
 * order belonging to this wallet, on this market, on this side, that is a buy.
 * Both are verified server-side; neither is taken on the client's word.
 *
 * What it emphatically does NOT do is touch `house_predictions.actual_action`.
 * The real round for this wallet and market is left exactly as it was — unopened
 * if it was unopened — because a simulated position must not spend a real
 * reveal.
 */
export async function finalizeSimulationBet(
  walletRaw: string,
  marketId: number,
  side: BeliefAction,
  simulationOrderId: number,
): Promise<HouseReadView> {
  if (side !== "YES" && side !== "NO") throw new Error("A bet must be YES or NO.");
  const sb = serviceClient();
  const wallet = walletRaw.toLowerCase();
  // Lock the prediction first, exactly as the real path does — the read must
  // exist before it can be revealed, or the reveal would create it after the fact.
  await loadHouseRead(wallet, marketId, "SIMULATION");

  const { verifySimulationOrder } = await import("@/lib/simulation.server");
  const proven = await verifySimulationOrder({
    wallet,
    marketId,
    side,
    orderId: simulationOrderId,
  });
  if (!proven) throw new Error("That Simulation position didn't settle on this market.");

  // Idempotent: the first settled order opens the round, and a second one on the
  // same market changes nothing already recorded.
  await sb.from("simulation_house_rounds").upsert(
    {
      wallet,
      onchain_id: marketId,
      actual_action: side,
      finalized_via: "bet",
      simulation_order_id: simulationOrderId,
      revealed_at: new Date().toISOString(),
    },
    { onConflict: "wallet,onchain_id", ignoreDuplicates: true },
  );

  return loadHouseRead(wallet, marketId, "SIMULATION");
}

/**
 * A SIMULATION PASS. Free, exactly as the real one is — it uses no CC, and there
 * is nothing to spend on walking away. It closes the SIMULATION round only; the
 * real round for this market stays open for the day this person backs it with
 * money.
 */
export async function finalizeSimulationPass(
  walletRaw: string,
  marketId: number,
): Promise<HouseReadView> {
  const sb = serviceClient();
  const wallet = walletRaw.toLowerCase();
  await loadHouseRead(wallet, marketId, "SIMULATION");
  await sb.from("simulation_house_rounds").upsert(
    {
      wallet,
      onchain_id: marketId,
      actual_action: "PASS",
      finalized_via: "pass",
      revealed_at: new Date().toISOString(),
    },
    { onConflict: "wallet,onchain_id", ignoreDuplicates: true },
  );
  // A decided market leaves discovery in either mode: the reader has answered
  // this question and should not be shown it again this session.
  await recordViewerDecision(wallet, marketId, "PASS");
  return loadHouseRead(wallet, marketId, "SIMULATION");
}

/**
 * Finalize the round with a PASS. Scores the locked prediction but keeps the
 * directional pick SEALED — the viewer never paid to see it. Idempotent.
 */
export async function finalizeHousePass(
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
        actual_action: "PASS",
        outcome: scoreHouse(normAction(row.predicted_action), "PASS"),
        revealed_at: new Date().toISOString(),
        finalized_via: "pass",
      })
      .eq("wallet", wallet)
      .eq("onchain_id", marketId)
      .is("actual_action", null);
  }

  // A PASS removes this market from discovery (V1). Unlike a purchase there is no
  // on-chain fallback, so this write must succeed — let a failure propagate so the
  // client can show a retry instead of silently advancing.
  await recordViewerDecision(wallet, marketId, "PASS");

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
