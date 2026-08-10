/**
 * Signed — one rule for every positive/negative figure in the product.
 *
 * There are exactly two kinds of figure, and they are read differently:
 *
 *   PERCENTAGES are a verdict. A rate has no unit to anchor it, so its whole
 *   job is direction and size. The entire figure carries the colour — green up,
 *   red down — and takes a TRAILING arrow (12% ▲) instead of a redundant +/−.
 *   The number is what's being read; the arrow confirms it afterwards.
 *
 *   EVERYTHING ELSE is a fact. A count or an amount is a quantity first, so it
 *   stays fully neutral: "+$1.07" and "−3 believers" keep their sign for
 *   direction but never take colour, sign included.
 *
 * Flat is flat: no arrow, no colour, muted.
 *
 * Pure presentation: it never parses, rounds, or reformats — it splits an
 * already-formatted string into its leading sign and the rest.
 */
import type { CSSProperties, ReactNode } from "react";

const SIGNS = new Set(["+", "-", "−", "▲", "▼", "↑", "↓"]);
const NEGATIVE = new Set(["-", "−", "▼", "↓"]);

export function signTone(sign: string | null): string {
  if (!sign) return "var(--text-muted)";
  return NEGATIVE.has(sign) ? "var(--loss)" : "var(--gain)";
}

export function Signed({
  value,
  className,
  style,
  numberColor = "var(--text)",
  children,
}: {
  /** An already-formatted figure, e.g. "+$1.07", "−3.4%", "▲ 12%". */
  value: string;
  className?: string;
  style?: CSSProperties;
  /** Colour of the numeric part. Neutral by default — percentages override it. */
  numberColor?: string;
  /** Trailing content (unit chip, suffix) rendered after the number. */
  children?: ReactNode;
}) {
  const first = value.charAt(0);
  const hasSign = SIGNS.has(first);
  const sign = hasSign ? first : null;
  let rest = hasSign ? value.slice(1) : value;
  // "▲ 12%" — keep the space with the number, not the sign.
  if (hasSign && rest.startsWith(" ")) rest = rest.slice(1);

  const isPct = value.includes("%");

  if (isPct) {
    const tone = signTone(sign);
    // "0%" with no sign is genuinely flat: muted, no arrow.
    const arrow = !sign ? "" : NEGATIVE.has(sign) ? "▼" : "▲";
    return (
      <span className={className} style={{ color: tone, ...style }}>
        {rest}
        {arrow && (
          <>
            <span>{"\u2009"}</span>
            <span className="text-[0.7em]" aria-hidden="true">
              {arrow}
            </span>
          </>
        )}
        {children}
      </span>
    );
  }

  return (
    <span className={className} style={{ color: numberColor, ...style }}>
      {sign}
      {sign && <span>{"\u2009"}</span>}
      {rest}
      {children}
    </span>
  );
}
