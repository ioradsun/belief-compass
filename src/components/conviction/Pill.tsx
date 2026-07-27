import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Pill — only for YES, NO, Tribe, Top Voice and small status labels.
 * Never for ordinary metrics.
 */
export type PillTone = "yes" | "no" | "tribe" | "top-voice" | "attention" | "neutral";

const TONES: Record<PillTone, string> = {
  yes: "bg-yes-soft text-yes border-yes/25",
  no: "bg-no-soft text-no border-no/25",
  tribe: "bg-rel-soft text-rel border-rel/25",
  "top-voice": "bg-top-voice-soft text-top-voice border-top-voice/25",
  attention: "bg-attention/10 text-attention border-attention/25",
  neutral: "bg-surface text-text-secondary border-border",
};

export function Pill({
  tone = "neutral",
  children,
  icon,
  className,
}: {
  tone?: PillTone;
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
        "text-fine leading-none font-medium",
        TONES[tone],
        className,
      )}
    >
      {icon ? <span className="shrink-0">{icon}</span> : null}
      {children}
    </span>
  );
}
