/**
 * TAKE A SIDE — the first-run brief.
 *
 * A new reader's problem is not "what is happening in this market", it is "what
 * am I supposed to DO here". So for the first ten convictions this card takes
 * the top of the Explore rail — the spot Market Insider holds later — and says
 * the one thing that matters: take sides, ten times, on your own reasons.
 *
 * It retires itself. At ten convictions the brief disappears and whatever the
 * rail normally pins (`children`) takes the slot back, permanently.
 *
 * Signed out there is nothing to count, so the brief still shows: it is exactly
 * the reader who has not started.
 */
import { useQuery } from "@tanstack/react-query";
import { myConvictionsQO } from "@/lib/positions-query";
import type { VolumeWindow } from "@/lib/markets.functions";
import type { ReactNode } from "react";

export const CONVICTION_GOAL = 10;

export function TakeASide({
  wallet,
  window: win = "24h",
  children,
}: {
  wallet?: string;
  window?: VolumeWindow;
  /** What the rail pins once the brief is done. */
  children?: ReactNode;
}) {
  const { data } = useQuery(myConvictionsQO(wallet, win));

  const count = (data?.positions ?? []).filter((p) => {
    const side = p.stance_side === "YES" || p.stance_side === "NO" ? p.stance_side : null;
    if (!side) return false;
    return Number((side === "YES" ? p.yes_shares : p.no_shares) ?? 0) > 0;
  }).length;

  if (wallet && count >= CONVICTION_GOAL) return <>{children}</>;

  const pct = Math.min(100, (count / CONVICTION_GOAL) * 100);

  return (
    <div
      className="mb-3 rounded-[10px] p-3"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
    >
      <div className="text-[11px] font-semibold tracking-[0.08em] text-[var(--text)] uppercase">
        Take a side
      </div>

      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="text-[20px] leading-none font-semibold tabular-nums text-[var(--text)]">
          {count}
        </span>
        <span className="text-[12px] tabular-nums text-[var(--text-muted)]">
          / {CONVICTION_GOAL} convictions
        </span>
      </div>

      <div
        className="mt-2 h-[3px] w-full overflow-hidden rounded-full"
        style={{ background: "var(--border)" }}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={CONVICTION_GOAL}
        aria-valuenow={count}
        aria-label="Convictions taken"
      >
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, background: "var(--yes, var(--text))" }}
        />
      </div>

      <p className="mt-2.5 text-[12px] leading-relaxed text-[var(--text-muted)]">
        Start with 10.
        <br />
        Don&rsquo;t chase people or money.
        <br />
        Give them a reason to chase you.
      </p>
    </div>
  );
}
