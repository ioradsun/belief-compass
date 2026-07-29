/**
 * Live feed taxonomy — pure, no IO.
 *
 * The right column is the living story of conviction, not a transaction log. One
 * chronological stream; the EVENT tells you what it is through iconography and a
 * subtle class treatment — the user never picks a view. This maps an existing
 * grouped LiveRow (its kind + whether the actor is in the viewer's network) to
 * one of three classes and an icon. It invents nothing: every input already
 * exists on the row the server produced.
 *
 *   personal  — viewer-relative (a Twin / someone in your network). Highest
 *               priority: gets a subtle "this is about you" highlight. Never loud.
 *   community — belonging & growth (new believers arriving, a new market opening).
 *   market    — the neutral heartbeat (a position bought, reduced, flipped).
 *
 * Priority is VISUAL emphasis only — it never reorders the timeline. The feed
 * stays strictly chronological so users trust they're seeing what just happened.
 */

export type LiveClass = "personal" | "community" | "market";

export interface LiveKindView {
  klass: LiveClass;
  /** The single glyph that carries the category at a glance. */
  icon: string;
}

/** The row fields the taxonomy reads — a structural subset of LiveRow. */
export interface LiveRowLike {
  kind: string;
  walletCount: number | null;
  face?: { relationship: "twin" | "tribe" | "opp" | "inverse" | null } | null;
  payload?: Record<string, unknown> | null;
}

export function classifyLiveRow(r: LiveRowLike): LiveKindView {
  const rel = r.face?.relationship ?? null;
  const action = (r.payload?.action as string | undefined) ?? null;

  // Personal — a real person from your network acted. This is what "matters to
  // me," so it wins the emphasis regardless of the underlying event.
  if (rel) return { klass: "personal", icon: rel === "twin" ? "🧬" : "🤝" };

  // Community — belonging & growth.
  if (r.kind === "believer_milestone") return { klass: "community", icon: "🏆" };
  if (r.kind === "tribe_doubled") return { klass: "community", icon: "🎉" };
  if (r.kind === "market_created") return { klass: "community", icon: "🚀" };
  if (r.kind === "trade_burst" && action !== "SELL" && (r.walletCount ?? 1) > 1) {
    // Several believers arriving together reads as the tribe growing.
    return { klass: "community", icon: "👥" };
  }

  // Market activity — the neutral heartbeat.
  if (r.kind === "round_trip") return { klass: "market", icon: "🔁" };
  if (r.kind === "side_shift") return { klass: "market", icon: "🔀" };
  if (action === "SELL") return { klass: "market", icon: "📉" };
  return { klass: "market", icon: "💰" };
}
