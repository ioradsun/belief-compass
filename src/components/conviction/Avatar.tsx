import { cn } from "@/lib/utils";

/**
 * Avatar — neutral or purple (relationship) only. Never green/red:
 * side colour must not leak onto people.
 */
export function Avatar({
  name,
  size = 28,
  tone = "neutral",
  src,
  className,
}: {
  name: string;
  size?: number;
  tone?: "neutral" | "rel" | "top-voice";
  src?: string | null;
  className?: string;
}) {
  const initials = name.startsWith("0x")
    ? name.slice(2, 4).toUpperCase()
    : name
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0])
        .join("")
        .toUpperCase();

  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden rounded-full border",
        tone === "rel" && "border-rel/50",
        tone === "top-voice" && "border-top-voice/50",
        tone === "neutral" && "border-border-strong",
        "bg-surface-raised text-text-secondary",
        className,
      )}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <span className="font-num text-micro leading-none">{initials}</span>
      )}
    </span>
  );
}
