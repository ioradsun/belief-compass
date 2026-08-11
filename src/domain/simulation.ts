/**
 * SIMULATION — the temporary onboarding mode, as rules rather than screens.
 *
 * Simulation is not a second product. It is the SAME Conviction experience with
 * a separate ledger and a different execution adapter, and it exists for exactly
 * as long as it takes somebody to build the first ten convictions the matching
 * engine needs. At ten it ends and never returns.
 *
 * Everything in this file is pure: the lifecycle rules, the eligibility test, the
 * CC formatter, and the order arithmetic. Zero IO, so the one place that decides
 * "may this person still simulate" is testable and cannot be re-derived
 * differently by a component.
 *
 * WHY CC IS NOT IN `domain/money`. `DisplayUnit` is USD | ETH — two units of the
 * same thing, convertible through one live rate. CC is not a third unit of that
 * thing: it has no rate, no conversion, and no monetary value at all, and adding
 * it to that type would put it in the viewer's currency toggle and imply that a
 * conversion exists. It gets its own formatter, deliberately.
 *
 * COUNTING is not here either. "How many convictions does this person have" is a
 * question about the belief layer, which already answers it for calibration, so
 * `ProfileProgress` lives in `domain/beliefs` beside `Readiness` and this module
 * reads it. Two counters would be two answers to one question.
 */
import type { ProfileProgress } from "@/domain/beliefs";

export type { ProfileProgress };

/** Conviction Company Units. Not money — see `CC_DEFINITION`. */
export const CC = "CC";

/**
 * THE ONE SENTENCE that must be available wherever CC is explained. Written once
 * so no surface can paraphrase it into a claim about value.
 */
export const CC_DEFINITION =
  "CC means Conviction Company Units. These units have no monetary value and cannot be withdrawn, transferred, redeemed, or exchanged for money or crypto.";

/** Granted once, on first activation. Never re-granted. */
export const SIMULATION_START_CC = 1000;

/** The smallest Simulation order. Mirrors the real form's contract minimum. */
export const MIN_ORDER_CC = 1;

/** What the Simulation buy form opens at. Real Mode keeps its own default. */
export const DEFAULT_ORDER_CC = 100;

/**
 * WHICH MODE A SURFACE IS IN.
 *
 * `GRADUATING` is the moment between the tenth conviction settling and the
 * viewer pressing "Continue to Conviction": Simulation data is still on screen
 * (the receipt they are reading is a Simulation receipt) but no new Simulation
 * order may be opened. Collapsing it into REAL would yank the confirmation they
 * are mid-way through reading; collapsing it into SIMULATION would let them
 * start an eleventh.
 *
 * `UNKNOWN` IS THE ONE THAT MATTERS MOST, and it exists because its absence was
 * a real defect. With three states, "we have not established which ledger owns
 * execution" had to be reported as one of them — and it was reported as REAL,
 * which is the answer that hands somebody the real-money executor. A fresh tab,
 * a slow query, a page that has not settled: each of those is a moment when the
 * honest answer is "we do not know yet", and the only safe behaviour is to offer
 * NEITHER executor.
 *
 * "Could not establish the mode" and "confirmed Real Mode" are different facts.
 * A type with three states could not tell them apart.
 */
export type SimulationMode = "UNKNOWN" | "REAL" | "SIMULATION" | "GRADUATING";

/** Execution may be routed. False while the owning ledger is still unknown. */
export const modeResolved = (mode: SimulationMode): boolean => mode !== "UNKNOWN";

/** The mode stamped on a social record. Simulation never reaches Real audiences. */
export type RecordMode = "REAL" | "SIMULATION";

/** A Simulation order's direction, matching the real order vocabulary. */
export type SimulationAction = "BUY" | "SELL";

/** True while Simulation owns the order and position surfaces. */
export const isSimulating = (mode: SimulationMode): boolean =>
  mode === "SIMULATION" || mode === "GRADUATING";

/** True while a NEW Simulation order may be opened. Graduation closes this. */
export const canOrder = (mode: SimulationMode): boolean => mode === "SIMULATION";

/* ── CC formatting ───────────────────────────────────────────────────────── */

/**
 * A CC amount, as a SUFFIX and never a symbol.
 *
 * `$` and `Ξ` are currency marks; putting one in front of a CC figure would say
 * the thing this whole feature must not say. The magnitude rule is deliberately
 * the same as USD's (`domain/money#usdBody`) so a reader moving between Real and
 * Simulation reads numbers of the same shape — that is a typographic
 * consistency, not an exchange rate.
 *
 *   formatCC(1000)         → "1,000 CC"
 *   formatCC(24.15)        → "24.15 CC"
 *   formatCC(24.15, true)  → "+24.15 CC"
 *   formatCC(-3.2, true)   → "−3.20 CC"
 *
 * A non-finite amount renders "—", never "NaN CC" and never a confident zero.
 */
export function formatCC(value: number, signed = false): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const body =
    abs >= 1000
      ? abs.toLocaleString("en-US", { maximumFractionDigits: 0 })
      : abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sign = value < 0 ? "−" : signed ? "+" : "";
  return `${sign}${body} ${CC}`;
}

/** The balance line's available figure — "Available 900 CC". */
export const availableCC = (balance: number): string => `Available ${formatCC(balance)}`;

/* ── Lifecycle ───────────────────────────────────────────────────────────── */

/**
 * WHERE A WALLET IS IN THE LIFECYCLE — persisted, not derived.
 *
 * `GRADUATING` was originally computed on the client from "account active AND
 * progress complete". That worked for rendering and failed for everything the
 * SERVER has to decide: the Simulation audience query cannot see a client
 * derivation, so somebody who had finished their tenth conviction was still
 * selectable as the recipient of a new Simulation Challenge they were already
 * forbidden from answering. The state is written in the same transaction as the
 * conviction that causes it, so there is no window between the two.
 */
export type SimulationLifecycle = "ACTIVE" | "GRADUATING" | "EXITED" | "GRADUATED";

/** The stored account, as every surface reads it. */
export interface SimulationAccount {
  wallet: string;
  startingBalanceCc: number;
  balanceCc: number;
  state: SimulationLifecycle;
  activatedAt: string | null;
  exitedAt: string | null;
  graduatedAt: string | null;
}

/**
 * MAY THIS PERSON START (or continue) SIMULATING?
 *
 * Two independent no's, and they are not the same no. Below ten but graduated
 * cannot happen through the product — graduation is written at ten — but it can
 * happen in data (a real position closed and stopped counting after the fact),
 * and a graduated account must never reactivate. Ten or more is the ordinary
 * end. Either way the answer is a plain boolean, so no surface has to reconstruct
 * the rule from two fields.
 */
export function simulationEligible(input: {
  progress: Pick<ProfileProgress, "complete">;
  state: SimulationLifecycle | null;
}): boolean {
  return !input.progress.complete && input.state !== "GRADUATED";
}

/**
 * WHICH LEDGER OWNS EXECUTION FOR THIS WALLET — the routing fact, and nothing
 * else.
 *
 * Deliberately NOT the account. It carries no balance, no positions, no
 * timestamps — only the lifecycle state, or `null` for a wallet that has never
 * simulated. That is what lets it be read WITHOUT a wallet session, which it
 * has to be: an application that cannot learn which ledger owns execution until
 * somebody signs cannot route anything, and would have to guess. Guessing is
 * what produced the defect this type exists to close.
 *
 * `state: null` is a POSITIVE ANSWER — the server looked and there is no
 * account. It is not the same as never having asked, which is `undefined` and
 * resolves to UNKNOWN below.
 */
export interface SimulationRouting {
  state: SimulationLifecycle | null;
}

/**
 * WHAT THE MODE IS, given the routing fact and the progress.
 *
 * The tenth conviction does not switch the screen to REAL. It switches to
 * GRADUATING, which keeps the Simulation receipt on screen and the Simulation
 * position readable while refusing to open an eleventh order. REAL arrives when
 * the viewer presses Continue (which writes GRADUATED) or exits.
 *
 * THE PROGRESS CHECK IS A BACKSTOP, NOT THE MECHANISM. The order transaction
 * writes GRADUATING itself, so the state alone is normally sufficient. But the
 * tenth conviction can also arrive from outside Simulation — a real position
 * indexed while somebody is simulating — and no Simulation transaction runs for
 * that. The screen must not offer an eleventh Simulation order in the seconds
 * before anything notices.
 *
 * AN UNRESOLVED ROUTING FACT IS `UNKNOWN`, NEVER `REAL`. This is the whole
 * reason the argument is nullable rather than a plain account: absence of an
 * answer must not become an answer, least of all the one that unlocks real
 * money.
 */
export function modeFor(
  routing: SimulationRouting | null | undefined,
  progress: ProfileProgress,
): SimulationMode {
  if (routing == null) return "UNKNOWN";
  const state = routing.state;
  if (state == null) return "REAL";
  if (state === "EXITED" || state === "GRADUATED") return "REAL";
  if (state === "GRADUATING") return "GRADUATING";
  return progress.complete ? "GRADUATING" : "SIMULATION";
}

/* ── Order arithmetic ────────────────────────────────────────────────────── */

/**
 * CAN THIS ORDER BE PLACED, and if not, in the reader's words.
 *
 * Fails closed: an unknown balance is not permission to spend. The insufficient
 * message names the actual number, because "not enough" without it is the sentence
 * that makes somebody type the same amount again.
 */
export type OrderCheck = { ok: true } | { ok: false; reason: string };

export function checkSimulationBuy(input: {
  amountCc: number;
  balanceCc: number | null;
}): OrderCheck {
  const { amountCc, balanceCc } = input;
  if (!Number.isFinite(amountCc) || amountCc <= 0) return { ok: false, reason: "Enter an amount" };
  if (amountCc < MIN_ORDER_CC) return { ok: false, reason: `Min ${formatCC(MIN_ORDER_CC)}` };
  if (balanceCc == null || !Number.isFinite(balanceCc))
    return { ok: false, reason: "Balance unavailable" };
  if (amountCc > balanceCc) return { ok: false, reason: insufficientCc(balanceCc) };
  return { ok: true };
}

/** "Not enough CC. Available: 42 CC." — the number is the whole point. */
export const insufficientCc = (balanceCc: number): string =>
  `Not enough CC. Available: ${formatCC(Math.max(0, balanceCc))}.`;

/** Shown when the live quote can't be read. Never fabricate shares or a price. */
export const QUOTE_UNAVAILABLE = "We couldn't price this Simulation order. Try again.";

/** Shown when a settled Simulation order fails. No CC moved, and it says so. */
export const ORDER_FAILED = "That Simulation order did not go through. No CC was used.";

/**
 * A Simulation position, shaped like the real one so the same domain logic reads
 * it. Shares are stored; VALUE IS NOT — it is derived from the live real-market
 * price at read time, because a stored Simulation price would be a second market.
 */
export interface SimulationPosition {
  onchainId: number;
  yesShares: number;
  noShares: number;
  yesCostCc: number;
  noCostCc: number;
  lastDirectionalSide: "YES" | "NO" | null;
}

/**
 * WHAT A SIMULATION POSITION IS WORTH RIGHT NOW, from the live market price.
 *
 * Null when there is no price to mark against — the same discipline
 * `domain/money#convertMoney` applies. A position with no readable price shows
 * its shares, never a value of zero.
 */
export function positionValueCc(
  shares: number,
  priceUsd: number | null | undefined,
): number | null {
  if (!(shares > 0)) return 0;
  if (priceUsd == null || !Number.isFinite(priceUsd) || priceUsd <= 0) return null;
  return shares * priceUsd;
}

/**
 * A DECIMAL SHARE COUNT → THE CONTRACT'S 18-DECIMAL INTEGER.
 *
 * Simulation stores shares as a plain number (there is no chain to store them
 * for), but every quote and every ownership component in this codebase speaks
 * wei. Rather than teach those a second numeric shape, a Simulation holding is
 * converted at this one boundary — which is also why the conversion lives here
 * and not inline in a component.
 *
 * Routed through gwei for the same reason `usdToWei` is: a direct ×1e18 loses
 * precision above ~0.009, and a share count that silently rounds is a position
 * that silently disagrees with its own ledger.
 */
export function sharesToWei(shares: number): bigint {
  if (!Number.isFinite(shares) || shares <= 0) return 0n;
  return BigInt(Math.round(shares * 1e9)) * 1_000_000_000n;
}

/**
 * THE DIRECTIONAL SIDE A SIMULATION POSITION EXPRESSES, for matching.
 *
 * A perfectly balanced position expresses NOTHING, and returning a side for it
 * would be inventing a belief out of an absence of one. Otherwise the larger
 * side is the belief; a tie falls back to the last unambiguous direction.
 */
export function directionalSide(p: SimulationPosition): "YES" | "NO" | null {
  const yes = Math.max(0, p.yesShares);
  const no = Math.max(0, p.noShares);
  if (yes === 0 && no === 0) return null;
  if (yes > no) return "YES";
  if (no > yes) return "NO";
  return p.lastDirectionalSide;
}

/* ── Copy ────────────────────────────────────────────────────────────────── */

/**
 * THE PRODUCT LINE AND ITS SUPPORTS, in one place.
 *
 * Written here rather than inline in three components because Simulation's whole
 * risk is a sentence drifting into a claim about money. One owner, one wording.
 */
export const SIMULATION_COPY = {
  line: "Real beliefs. Simulated positions. No real money at risk.",
  purpose: "Build your Conviction profile without using real money.",
  bannerSupport: "Build your profile without using real money.",
  graduatedSupport: "Conviction has enough signal to start finding your people.",
  exitConfirmation: "Simulation off. Your progress is saved.",
  verifyWallet: "Verify your wallet to save your progress. No transaction will be sent.",
  entrySupport: `Start with ${formatCC(SIMULATION_START_CC)}. No real money at risk.`,
  entryBody: "Reach 10 so Conviction can start finding your people.",
} as const;

/** The neutral reason a Challenge is closed by leaving Simulation. Not a pass. */
export const SIMULATION_EXIT_REASON = "simulation_exit";
