import { Pill } from "./Pill";
import { Avatar } from "./Avatar";
import { Sparkline } from "./Sparkline";
import type { Side, SideKey } from "@/lib/contract";
import { cn } from "@/lib/utils";

/**
 * SideColumn — one independent perpetual instrument. Every value comes from the
 * contract; nothing here is derived, sorted or thresholded.
 */
export function SideColumn({
  side,
  data,
  selected,
  onSelect,
  qualified,
}: {
  side: SideKey;
  data: Side;
  selected: boolean;
  onSelect: () => void;
  qualified: boolean;
}) {
  const isYes = side === "y";
  return (
    <section
      className={cn(
        "rounded-md border bg-surface px-4 py-4 transition-colors duration-200",
        selected ? (isYes ? "border-yes/50" : "border-no/50") : "border-border",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <Pill tone={isYes ? "yes" : "no"}>{isYes ? "YES" : "NO"}</Pill>
        <Sparkline points={data.series} tone={isYes ? "yes" : "no"} />
      </div>

      <p className="mt-3 font-num text-display leading-none text-text">
        ${data.price.toFixed(4)}
      </p>
      <p
        className={cn(
          "mt-2 font-num text-sm leading-none",
          data.changePct > 0 ? "text-yes" : data.changePct < 0 ? "text-no" : "text-text-secondary",
        )}
      >
        {data.changePct > 0 ? "+" : ""}
        {data.changePct.toFixed(1)}% today
      </p>

      <p className="mt-4 font-num text-sm text-text-secondary">
        {data.believers} believers · {data.capital}
      </p>

      <div className="mt-4 min-h-[92px]">
        {!qualified ? (
          <p className="text-fine text-text-secondary">
            Who is standing here becomes visible once your own convictions are on record.
          </p>
        ) : data.people.length === 0 ? (
          <p className="text-fine text-text-secondary">Nobody you match with is here yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.people.map((p) => (
              <li key={p.avatarSeed} className="flex items-center gap-2">
                <Avatar
                  name={p.alias}
                  src={p.avatarUrl}
                  size={24}
                  tone={p.matchPct != null ? "rel" : "neutral"}
                />
                <span className="min-w-0 flex-1 truncate text-sm text-text">{p.alias}</span>
                <span className="font-num text-fine text-text-secondary">{p.positionLabel}</span>
                {/* matchPct null → no ring, no number. Never an estimate. */}
                {p.matchPct != null ? (
                  <span className="font-num text-fine text-rel">{p.matchPct}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {data.moreFromTribe > 0 ? (
          <p className="mt-2 text-fine text-text-secondary">
            {data.moreFromTribe} more you match with
          </p>
        ) : null}
      </div>

      {data.perspective ? (
        <blockquote className="mt-4 border-l border-border-strong pl-3 text-sm text-text-secondary">
          {data.perspective.text}
          <footer className="mt-1 text-fine text-text-secondary">
            {data.perspective.authorAlias} · {data.perspective.heldDays} days
            {data.perspective.isTopVoice ? " · Top Voice" : ""}
          </footer>
        </blockquote>
      ) : null}

      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "mt-4 w-full rounded-sm border px-4 py-2 text-sm transition-colors duration-200",
          selected
            ? isYes
              ? "border-yes/50 bg-yes-soft text-yes"
              : "border-no/50 bg-no-soft text-no"
            : "border-border text-text-secondary hover:text-text",
        )}
      >
        {selected ? "Standing here" : `Stand on ${isYes ? "YES" : "NO"}`}
      </button>
    </section>
  );
}
