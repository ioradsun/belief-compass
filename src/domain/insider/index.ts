/**
 * THE INSIDER — one intelligence system, four projections.
 *
 *   WHAT HAPPENED                    (canonical facts, not this layer)
 *   events + wallet_beliefs + market_state
 *             │
 *             ▼
 *   ╔══════════════════════════════════╗
 *   ║           THE INSIDER            ║
 *   ║  observe → calculate → detect    ║
 *   ║  score → explain → personalize   ║
 *   ╚══════════════════════════════════╝
 *             │
 *             ▼
 *        INSIDER SIGNALS
 *             │
 *      ┌──────┼────────┬───────────┐
 *      ▼      ▼        ▼           ▼
 *   Activity Insight  Now         Read
 *
 * Insider Activity — what just happened.
 * Insider Insight  — what it means.
 * Insider Now      — what deserves your attention.
 * Insider Read     — what we think it means for you.
 *
 * See ./README.md for the full architecture and docs/insider-architecture.md for
 * the surface inventory + migration plan.
 */
export * from "./types";
export * from "./signals";
export { insiderPulse, type PulseFacts } from "./pulse";
export {
  pulseFactsFromMarket,
  marketStateFacts,
  type MarketStateFacts,
} from "./market-facts";

export { insiderRead, fromHouseReadState, type InsiderReadContext } from "./read";
export { evidenceFromPulse, freshnessOf, FRESH_HALF_LIFE_MS } from "./features";
export { score, scoreSignal, IMPORTANCE_WEIGHTS } from "./scoring";
export { activity } from "./projections/activity";
export { insight } from "./projections/insight";

/**
 * The constitutional rule, as a single importable source of truth so docs, tests,
 * and future architecture checks all cite the same words.
 */
export const INSIDER_CONSTITUTION: string =
  "No product surface calculates market intelligence. Facts are produced by " +
  "canonical data systems (events, wallet_beliefs, market_state). The Insider " +
  "interprets those facts. Product surfaces only filter, aggregate, personalize, " +
  "and render Insider output.";
