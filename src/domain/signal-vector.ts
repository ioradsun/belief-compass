/**
 * signal-vector — viewer-blind market anomaly measurement.
 *
 * Pure. Deterministic. Nothing here knows who is reading. Two viewers looking at
 * the same market facts get the identical vector; only the *angle* on top of it
 * may differ, and that lives elsewhere.
 *
 * The one rule that shaped every constant in this file: the corpus is sparse.
 * A market's median hourly trade rate is 0.012, so "5× normal" against an hourly
 * denominator is arithmetic, not information. Every ratio here is measured
 * against a *proven* baseline (24h vs a qualified 7d daily rate) or it is zero.
 *
 * Not wired into ranking, cadence, or copy. Diagnostic first, influential later.
 */

// ---------------------------------------------------------------------------
// Constants — each one traceable to a measured property of the corpus.
// ---------------------------------------------------------------------------

/** A 7d window with fewer trades than this cannot establish a daily normal. */
export const BASELINE_MIN_7D_TRADES = 7;
/** Below this ratio, 24h activity is indistinguishable from the market's normal. */
export const UNUSUAL_MIN_RATIO = 2;
/** At this ratio unusualness saturates. */
export const UNUSUAL_FULL_RATIO = 6;

/** Relative move (|Δprice| / price) below which price is "still basically where it was". */
export const QUIET_REL_MOVE = 0.03;
/** Relative move at or above which price has visibly moved. Median 24h move is ~8.6%. */
export const LOUD_REL_MOVE = 0.06;

/** Dollars below this are bookkeeping noise, not capital movement. */
export const CAPITAL_DUST = 1;
/** Capital at or above this counts as a material input. */
export const MATERIAL_CAPITAL = 25;

/** Nonresponse needs a real input... */
export const NONRESPONSE_MIN_USD = 50;
/** ...and enough elapsed time that "no response yet" is an observation, not impatience. */
export const NONRESPONSE_MIN_HOURS = 4;
/** Beyond this the input is stale and its silence is no longer news. */
export const NONRESPONSE_MAX_HOURS = 36;

/** A holder set smaller than this cannot prove a hierarchy was replaced. */
export const REPLACEMENT_MIN_HOLDERS = 5;
/** How many newcomers it takes to call it a replacement. */
export const REPLACEMENT_MIN_NEWCOMERS = 3;
/** Fraction of a holder's pre-event position that counts as leaving. */
export const EXIT_FRACTION = 0.8;
/** One holder is not a hierarchy — concentration needs someone to be larger *than*. */
export const CONCENTRATION_MIN_HOLDERS = 2;
/** A "whale" whose whole position is a few dollars is not a whale. */
export const CONCENTRATION_MIN_POSITION = 10;

/**
 * A 24h relative move above this is a thin-book artifact, not a price signal.
 * Measured: markets with one $2 trade report moves of 140%–2000%, which said
 * far more about an empty order book than about anyone's conviction.
 */
export const MAX_CREDIBLE_REL_MOVE = 0.5;


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SignalKey =
  | "tension"
  | "beforePrice"
  | "unusual"
  | "concentration"
  | "reversing"
  | "building"
  | "nonresponse"
  | "none";

export type TensionKind =
  | "people_up_capital_down"
  | "capital_up_price_flat"
  | "price_up_believers_flat"
  | "believers_left_price_rose"
  | "whales_out_newcomers_in";

export type ConcentrationKind =
  | "concentrating"
  | "distributing"
  | "largest_holder_left"
  | "newcomers_replaced_a_whale";

export type Holder = { wallet: string; netUsd: number };

export type SignalActor = {
  wallet: string;
  direction: "buy" | "sell";
  amountUsd: number;
};

/**
 * Everything the vector is allowed to see. Null means "not computed" — never
 * "zero". The distinction is the whole reason sparse markets stay quiet.
 */
export type SignalFacts = {
  /** Social/personal rows carry no market signal; they get an all-zero vector. */
  isSocial?: boolean;

  yesPrice?: number | null;
  yesPriceChange1h?: number | null;
  yesPriceChange24h?: number | null;
  yesPriceChange7d?: number | null;

  yesCapitalDelta24h?: number | null;
  noCapitalDelta24h?: number | null;
  capitalHeldYes?: number | null;
  capitalHeldNo?: number | null;

  tradeCount24h?: number | null;
  tradeCount7d?: number | null;

  believersYes?: number | null;
  believersNo?: number | null;
  newBelievers24h?: number | null;
  peopleYesChange24h?: number | null;
  sideFlips24h?: number | null;
  newcomers24h?: number | null;

  /** The trade this row is about, if it is about one. */
  actor?: SignalActor | null;
  /** Holder hierarchy immediately BEFORE the actor's trade, reconstructed from events. */
  preEventHolders?: Holder[] | null;

  /** A specific meaningful input whose response we can time. */
  input?: { amountUsd: number; atMs: number } | null;

  nowMs: number;
};

export type Signals = {
  tension: number;
  beforePrice: number;
  unusual: number;
  concentration: number;
  reversing: number;
  building: number;
  nonresponse: number;
  confirmation: number;
};

export type SignalVector = {
  signals: Signals;
  tensionKind?: TensionKind;
  concentrationKind?: ConcentrationKind;
  /**
   * The anomaly of the MARKET, identical for every row about it. This is the
   * number the signals actually measure.
   */
  marketGain: number;
  /**
   * How much of the market's anomaly THIS row is entitled to (0..1). A market's
   * story is told once; a row that adds no evidence of its own inherits only a
   * discounted share of it, so a busy market cannot hand the feed twenty copies
   * of the same observation.
   */
  carrier: number;
  /** `marketGain × carrier` — the ranking number. */
  informationGain: number;
  primary: SignalKey;
  reasons: string[];
};

// ---------------------------------------------------------------------------
// Canonical baseline math — one definition of "normal", used by everything.
// ---------------------------------------------------------------------------

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
const num = (n: number | null | undefined): number | null =>
  typeof n === "number" && Number.isFinite(n) ? n : null;

/**
 * The market's own daily trade rate, or null when the 7d window is too thin to
 * prove one. There is deliberately no fallback: an unproven baseline yields no
 * anomaly rather than a fabricated one.
 */
export function dailyBaseline(tradeCount7d: number | null | undefined): number | null {
  const c7 = num(tradeCount7d);
  if (c7 === null || c7 < BASELINE_MIN_7D_TRADES) return null;
  return c7 / 7;
}

export type Unusualness = { value: number; ratio: number | null; qualified: boolean };

/** 24h activity against the qualified daily baseline. Unqualified ⇒ exactly zero. */
export function unusualness(
  tradeCount24h: number | null | undefined,
  tradeCount7d: number | null | undefined,
): Unusualness {
  const base = dailyBaseline(tradeCount7d);
  const c24 = num(tradeCount24h);
  if (base === null || base <= 0 || c24 === null) {
    return { value: 0, ratio: null, qualified: false };
  }
  const ratio = c24 / base;
  const value = clamp01(
    (ratio - UNUSUAL_MIN_RATIO) / (UNUSUAL_FULL_RATIO - UNUSUAL_MIN_RATIO),
  );
  return { value, ratio, qualified: true };
}

/**
 * Price movement as a fraction of price. A $0.10 move means something different
 * on a $0.50 market than on a $5 one, so nothing downstream sees USD deltas.
 */
export function relativeMove(
  priceChange: number | null | undefined,
  price: number | null | undefined,
): number | null {
  const d = num(priceChange);
  const p = num(price);
  if (d === null || p === null || p <= 0) return null;
  return Math.abs(d) / p;
}

export type PriceBand = "quiet" | "moving" | "loud" | "artifact" | "unknown";

export function priceBand(rel: number | null): PriceBand {
  if (rel === null) return "unknown";
  // An implausible move on a thin book is a measurement, not an event. It must
  // not become evidence in either direction.
  if (rel > MAX_CREDIBLE_REL_MOVE) return "artifact";
  if (rel < QUIET_REL_MOVE) return "quiet";
  if (rel < LOUD_REL_MOVE) return "moving";
  return "loud";
}


// ---------------------------------------------------------------------------
// Concentration — only ever from a proven pre-event hierarchy.
// ---------------------------------------------------------------------------

export type ConcentrationRead = {
  value: number;
  kind?: ConcentrationKind;
  reason?: string;
};

export function readConcentration(facts: SignalFacts): ConcentrationRead {
  const holders = facts.preEventHolders;
  const actor = facts.actor;
  // No hierarchy, no concentration. A large amount alone proves nothing.
  if (!holders || holders.length === 0 || !actor) return { value: 0 };

  const ranked = [...holders]
    .filter((h) => h.netUsd > CAPITAL_DUST)
    .sort((a, b) => b.netUsd - a.netUsd);
  // One holder is not a hierarchy, and a $2 position is not a whale. Both
  // guards come straight from the corpus, where single-holder dust markets
  // otherwise produced the highest-scoring "largest holder left" rows in the book.
  if (
    ranked.length < CONCENTRATION_MIN_HOLDERS ||
    (ranked[0]?.netUsd ?? 0) < CONCENTRATION_MIN_POSITION
  ) {
    return { value: 0 };
  }


  const largest = ranked[0]!;
  const total = ranked.reduce((s, h) => s + h.netUsd, 0);
  const share = total > 0 ? largest.netUsd / total : 0;
  const isLargest = largest.wallet.toLowerCase() === actor.wallet.toLowerCase();

  if (actor.direction === "sell" && isLargest) {
    const left = actor.amountUsd >= largest.netUsd * EXIT_FRACTION;
    if (left) {
      const newcomers = num(facts.newcomers24h) ?? 0;
      if (
        ranked.length >= REPLACEMENT_MIN_HOLDERS &&
        newcomers >= REPLACEMENT_MIN_NEWCOMERS
      ) {
        return {
          value: 1,
          kind: "newcomers_replaced_a_whale",
          reason: `largest holder ($${largest.netUsd.toFixed(0)}, ${(share * 100).toFixed(0)}% of side) exited while ${newcomers} newcomers arrived`,
        };
      }
      return {
        value: clamp01(0.55 + share * 0.45),
        kind: "largest_holder_left",
        reason: `largest pre-event holder ($${largest.netUsd.toFixed(0)}, ${(share * 100).toFixed(0)}% of side) exited`,
      };
    }
    if (actor.amountUsd >= CONCENTRATION_MIN_POSITION) {
      return {
        value: clamp01(share * 0.5),
        kind: "distributing",
        reason: `largest holder trimmed ${((actor.amountUsd / largest.netUsd) * 100).toFixed(0)}% of its position`,
      };
    }
    return { value: 0 };
  }

  if (
    actor.direction === "buy" &&
    total > 0 &&
    actor.amountUsd >= CONCENTRATION_MIN_POSITION
  ) {
    const after = isLargest ? largest.netUsd + actor.amountUsd : actor.amountUsd;
    const afterShare = after / (total + actor.amountUsd);
    if (afterShare > share && afterShare >= 0.5) {
      return {
        value: clamp01((afterShare - 0.5) * 2),
        kind: "concentrating",
        reason: `one wallet now holds ${(afterShare * 100).toFixed(0)}% of the side's capital`,
      };
    }
  }

  // A one-cent sale is not "the money redistributing". The shape of the book
  // only changed if the trade was large enough to change it.
  if (
    actor.direction === "sell" &&
    !isLargest &&
    share >= 0.5 &&
    actor.amountUsd >= CONCENTRATION_MIN_POSITION
  ) {
    return {
      value: clamp01(share * 0.3),
      kind: "distributing",
      reason: `a non-lead holder sold $${actor.amountUsd.toFixed(0)} out of a side led by one wallet (${(share * 100).toFixed(0)}%)`,
    };
  }



  return { value: 0 };
}

// ---------------------------------------------------------------------------
// The vector
// ---------------------------------------------------------------------------

const ZERO: Signals = {
  tension: 0,
  beforePrice: 0,
  unusual: 0,
  concentration: 0,
  reversing: 0,
  building: 0,
  nonresponse: 0,
  confirmation: 0,
};

/** Weights express the §5 hierarchy: contradiction first, magnitude last. */
const WEIGHT: Record<Exclude<SignalKey, "none">, number> = {
  tension: 0.34,
  nonresponse: 0.26,
  beforePrice: 0.26,
  concentration: 0.22,
  unusual: 0.18,
  reversing: 0.16,
  building: 0.08,
};

export function emptyVector(): SignalVector {
  return {
    signals: { ...ZERO },
    marketGain: 0,
    carrier: 0,
    informationGain: 0,
    primary: "none",
    reasons: [],
  };
}

export function signalVector(facts: SignalFacts): SignalVector {
  if (facts.isSocial) return emptyVector();

  const reasons: string[] = [];
  const signals: Signals = { ...ZERO };

  const price = num(facts.yesPrice);
  const rel24 = relativeMove(facts.yesPriceChange24h, price);
  const band = priceBand(rel24);
  const change24 = num(facts.yesPriceChange24h);

  const yesIn = num(facts.yesCapitalDelta24h) ?? 0;
  const noIn = num(facts.noCapitalDelta24h) ?? 0;
  const grossIn = Math.abs(yesIn) + Math.abs(noIn);
  const netIn = yesIn + noIn;
  const newBelievers = num(facts.newBelievers24h) ?? 0;
  const peopleDelta = num(facts.peopleYesChange24h) ?? 0;
  const flips = num(facts.sideFlips24h) ?? 0;

  // --- unusual (canonical baseline only) ------------------------------------
  const u = unusualness(facts.tradeCount24h, facts.tradeCount7d);
  signals.unusual = u.value;
  if (u.value > 0 && u.ratio !== null) {
    reasons.push(
      `24h activity is ${u.ratio.toFixed(1)}× this market's proven daily baseline (${facts.tradeCount7d} trades in 7d)`,
    );
  } else if (!u.qualified) {
    reasons.push("no qualified baseline (7d trades below evidence gate) — unusual = 0");
  }

  // --- concentration (proven hierarchy only) --------------------------------
  const conc = readConcentration(facts);
  signals.concentration = conc.value;
  if (conc.kind) {
    reasons.push(conc.reason!);
  }

  // --- beforePrice ----------------------------------------------------------
  const materialInput = netIn >= MATERIAL_CAPITAL || newBelievers >= 3;
  if (materialInput && band === "quiet") {
    const strength = clamp01(
      Math.max(netIn / (MATERIAL_CAPITAL * 8), newBelievers / 6, 0.35),
    );
    signals.beforePrice = strength;
    reasons.push(
      `material input (${netIn >= MATERIAL_CAPITAL ? `$${netIn.toFixed(0)} net` : `${newBelievers} new believers`}) with price still inside the quiet band (${((rel24 ?? 0) * 100).toFixed(1)}%)`,
    );
  }

  // --- tension --------------------------------------------------------------
  const tensions: Array<{ kind: TensionKind; value: number; why: string }> = [];
  if (peopleDelta > 0 && yesIn < -CAPITAL_DUST) {
    tensions.push({
      kind: "people_up_capital_down",
      value: clamp01(0.5 + Math.min(Math.abs(yesIn) / 200, 0.5)),
      why: `believers rose (+${peopleDelta}) while YES capital fell ($${Math.abs(yesIn).toFixed(0)} out)`,
    });
  }
  if (signals.beforePrice > 0 && netIn >= MATERIAL_CAPITAL) {
    tensions.push({
      kind: "capital_up_price_flat",
      value: clamp01(0.45 + Math.min(netIn / 400, 0.5)),
      why: `$${netIn.toFixed(0)} entered and price stayed inside the quiet band`,
    });
  }
  // A price move with nobody arriving is only a contradiction when the move is
  // credible AND real money was behind it. Without the capital floor this fired
  // on 70% of the corpus — one dust trade repricing an empty book.
  if (band === "loud" && newBelievers === 0 && grossIn >= MATERIAL_CAPITAL) {
    tensions.push({
      kind: "price_up_believers_flat",
      value: clamp01(0.4 + Math.min((rel24 ?? 0) * 3, 0.5)),
      why: `price moved ${((rel24 ?? 0) * 100).toFixed(1)}% on $${grossIn.toFixed(0)} with no new believers`,
    });
  }
  if (
    peopleDelta < 0 &&
    (change24 ?? 0) > 0 &&
    (band === "moving" || band === "loud")
  ) {
    tensions.push({
      kind: "believers_left_price_rose",
      value: clamp01(0.5 + Math.min(Math.abs(peopleDelta) / 8, 0.4)),
      why: `${Math.abs(peopleDelta)} believers left while price rose ${((rel24 ?? 0) * 100).toFixed(1)}%`,
    });
  }

  if (conc.kind === "newcomers_replaced_a_whale") {
    tensions.push({
      kind: "whales_out_newcomers_in",
      value: 1,
      why: conc.reason!,
    });
  }
  const lead = tensions.sort((a, b) => b.value - a.value)[0];
  if (lead) {
    signals.tension = lead.value;
    reasons.push(lead.why);
  }

  // --- reversing ------------------------------------------------------------
  if (flips > 0) {
    signals.reversing = clamp01(0.4 + Math.min(flips / 5, 0.6));
    reasons.push(`${flips} wallet${flips === 1 ? "" : "s"} changed side in 24h`);
  } else if (netIn < -MATERIAL_CAPITAL) {
    signals.reversing = clamp01(0.3 + Math.min(Math.abs(netIn) / 500, 0.5));
    reasons.push(`net $${Math.abs(netIn).toFixed(0)} left the market in 24h`);
  }

  // --- nonresponse ----------------------------------------------------------
  const input = facts.input;
  if (input && input.amountUsd >= NONRESPONSE_MIN_USD) {
    const hours = (facts.nowMs - input.atMs) / 3_600_000;
    if (hours >= NONRESPONSE_MIN_HOURS && hours <= NONRESPONSE_MAX_HOURS && band === "quiet") {
      signals.nonresponse = clamp01(
        0.45 + Math.min(hours / (NONRESPONSE_MAX_HOURS * 2), 0.3) +
          Math.min(input.amountUsd / 2000, 0.25),
      );
      reasons.push(
        `$${input.amountUsd.toFixed(0)} entered ${hours.toFixed(0)}h ago and price is still inside the quiet band`,
      );
    }
  }

  // --- confirmation (computed, never emitted as a story on its own) ---------
  if ((band === "moving" || band === "loud") && netIn > CAPITAL_DUST && (change24 ?? 0) > 0) {
    signals.confirmation = clamp01(Math.min((rel24 ?? 0) / LOUD_REL_MOVE, 1) * 0.8);
  }

  // --- building: residual only ---------------------------------------------
  const higherKeys: Array<Exclude<SignalKey, "none" | "building">> = [
    "tension",
    "nonresponse",
    "beforePrice",
    "concentration",
    "unusual",
    "reversing",
  ];
  const strongestOther = Math.max(...higherKeys.map((k) => signals[k]));
  const rawBuilding =
    grossIn > MATERIAL_CAPITAL ? clamp01(Math.min(grossIn / 600, 1)) : 0;
  // Evidence already explained above is not counted twice: building only keeps
  // the share of itself that nothing stronger has claimed.
  signals.building = clamp01(rawBuilding * (1 - strongestOther));
  if (signals.building > 0) {
    reasons.push(`$${grossIn.toFixed(0)} moved in 24h with no stronger signal to explain it`);
  }

  // --- informationGain: bounded, anomaly-first ------------------------------
  const parts: Array<[Exclude<SignalKey, "none">, number]> = [
    ["tension", signals.tension],
    ["nonresponse", signals.nonresponse],
    ["beforePrice", signals.beforePrice],
    ["concentration", signals.concentration],
    ["unusual", signals.unusual],
    ["reversing", signals.reversing],
    ["building", signals.building],
  ];
  let survive = 1;
  for (const [key, value] of parts) survive *= 1 - WEIGHT[key] * value;
  const informationGain = clamp01(1 - survive);

  let primary: SignalKey = "none";
  let best = 0;
  for (const [key, value] of parts) {
    const contribution = WEIGHT[key] * value;
    if (contribution > best) {
      best = contribution;
      primary = key;
    }
  }

  return {
    signals,
    tensionKind: lead?.kind,
    concentrationKind: conc.kind,
    informationGain,
    primary,
    reasons,
  };
}

// ---------------------------------------------------------------------------
// Pre-event hierarchy reconstruction (proved viable in the step-2a audit).
// ---------------------------------------------------------------------------

export type CanonicalTrade = {
  wallet: string;
  /** Signed USD: positive for buys, negative for sells. */
  netUsd: number;
  atMs: number;
};

/** Cumulative net per wallet from the canonical event stream, strictly before `beforeMs`. */
export function holdersBefore(trades: CanonicalTrade[], beforeMs: number): Holder[] {
  const byWallet = new Map<string, number>();
  for (const t of trades) {
    if (t.atMs >= beforeMs) continue;
    const key = t.wallet.toLowerCase();
    byWallet.set(key, (byWallet.get(key) ?? 0) + t.netUsd);
  }
  return [...byWallet.entries()]
    .map(([wallet, netUsd]) => ({ wallet, netUsd }))
    .filter((h) => h.netUsd > CAPITAL_DUST)
    .sort((a, b) => b.netUsd - a.netUsd);
}
