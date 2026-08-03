/**
 * Share impact — the sharer's honest reward: seeing what their link brought in.
 *
 * The loop closes here: Take a side → Stand on it → Bring your tribe → See your
 * impact. This module turns the attributed counts (opens, believers, capital)
 * into one confident line. It never inflates: an open is not a believer, and we
 * say so plainly when people arrived but haven't taken a side yet. No forecasts,
 * no rewards language — just what actually happened.
 *
 * ZERO IO, deterministic, fully testable.
 */

export interface ShareImpactInput {
  /** Distinct visitors who opened the sharer's link. */
  opens: number | null | undefined;
  /** Attributed wallets that took a directional position (real believers). */
  believers: number | null | undefined;
  /** Capital those believers committed, in USD. */
  capitalUsd: number | null | undefined;
  /** "market" → "into this market"; "all" → "onto Conviction". */
  scope?: "market" | "all";
}

export interface ShareImpact {
  /** The one confident line to show the sharer. */
  headline: string;
  /** A quieter second line, or null when the headline stands alone. */
  sub: string | null;
  /** True once the link has produced at least one believer — worth featuring. */
  hasImpact: boolean;
}

function n(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

function fmtUsd(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (v >= 10_000) return `$${Math.round(v / 1_000)}k`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return `$${Math.round(v)}`;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

export function composeShareImpact(i: ShareImpactInput): ShareImpact {
  const opens = n(i.opens);
  const believers = n(i.believers);
  const capital = n(i.capitalUsd);
  const where = i.scope === "all" ? "onto Conviction" : "into this market";

  // Real conversions — lead with them, and fold in capital only when there is any.
  if (believers > 0) {
    const who = `${believers} ${plural(believers, "believer", "believers")}`;
    const headline =
      capital > 0
        ? `Your link brought ${who} and ${fmtUsd(capital)} ${where}.`
        : `Your link brought ${who} ${where}.`;
    const sub =
      opens > believers ? `${opens} ${plural(opens, "person", "people")} opened it in all.` : null;
    return { headline, sub, hasImpact: true };
  }

  // People arrived but nobody has committed yet — say it honestly, don't dress
  // an open up as a believer.
  if (opens > 0) {
    return {
      headline: `${opens} ${plural(opens, "person has", "people have")} opened your link.`,
      sub: "No side taken yet — the invitation is still open.",
      hasImpact: false,
    };
  }

  // Nothing yet: an invitation, not a zero.
  return {
    headline: "Stand on it and watch your tribe arrive.",
    sub: null,
    hasImpact: false,
  };
}
