/**
 * Signed — one rule for every positive/negative figure in the product.
 *
 * The NUMBER is always neutral: a value is a fact, not a verdict. Only the
 * SIGN carries colour — "+" green, "−" (or "-") red, everything else muted.
 * Arrows (▲ ▼ ↑ ↓) count as signs too, so arrow-led figures read the same way.
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
  /** Colour of the numeric part. Neutral by default — never green or red. */
  numberColor?: string;
  /** Trailing content (arrow, unit chip) rendered after the number. */
  children?: ReactNode;
}) {
  const first = value.charAt(0);
  const hasSign = SIGNS.has(first);
  const sign = hasSign ? first : null;
  let rest = hasSign ? value.slice(1) : value;
  // "▲ 12%" — keep the space with the number, not the sign.
  if (hasSign && rest.startsWith(" ")) rest = rest.slice(1);

  return (
    <span className={className} style={{ color: numberColor, ...style }}>
      {sign && (
        <span style={{ color: signTone(sign) }} aria-hidden="false">
          {sign}
        </span>
      )}
      {sign && <span>{"\u2009"}</span>}
      {rest}
      {children}
    </span>
  );
}
