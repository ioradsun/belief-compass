/**
 * PARTICIPANT SHEET — the mobile answer to "who is in this market?".
 *
 * The card itself only shows faces (recognition beats reading on a phone). The
 * explanation lives here: one list, grouped Tribe → Rivals → Everyone else, with
 * the room the card does not have for side, amount and time held.
 *
 * Portalled to <body> so it floats above the deck, the dock and any sticky rail.
 */
import { createPortal } from "react-dom";
import { useEffect } from "react";
import { PersonAvatar } from "@/components/PersonAvatar";
import { useMoney } from "@/lib/display-unit";
import type { ParticipantRelation } from "@/domain/participant-social";

export interface SheetParticipant {
  wallet: string;
  name?: string | null;
  avatarUrl?: string | null;
  relation?: ParticipantRelation;
  /** Which way they are committed, when we know it. */
  side?: "YES" | "NO" | null;
  /** What their position is worth right now, in USD. */
  valueUsd?: number | null;
  /** How long they have stayed in — the one thing money cannot fake. */
  daysHeld?: number | null;
}

/** Ring colour that says "you know this person" without a word of text. */
export const RELATION_RING: Record<ParticipantRelation, string | null> = {
  tribe: "var(--yes)",
  rival: "var(--no)",
  other: null,
};

const heldLabel = (d?: number | null): string | null => {
  if (d == null || !Number.isFinite(d) || d <= 0) return null;
  if (d < 1) return `${Math.max(1, Math.round(d * 24))}h`;
  return `${Math.round(d)}d`;
};

/** A face with a relationship ring — the ring is the whole vocabulary. */
export function RingedAvatar({
  wallet,
  name,
  avatarUrl,
  size,
  ring,
}: {
  wallet: string;
  name?: string | null;
  avatarUrl?: string | null;
  size: number;
  ring: string | null;
}) {
  return (
    <span
      className="inline-grid shrink-0 place-items-center rounded-full"
      style={{
        padding: ring ? 2 : 0,
        background: ring ?? "transparent",
        boxShadow: "0 0 0 1.5px var(--surface)",
      }}
    >
      <PersonAvatar wallet={wallet} name={name} avatarUrl={avatarUrl} size={size} />
    </span>
  );
}

const GROUPS: { key: ParticipantRelation; title: string }[] = [
  { key: "tribe", title: "Tribe" },
  { key: "rival", title: "Rivals" },
  { key: "other", title: "Everyone else" },
];

export function ParticipantSheet({
  people,
  total,
  onClose,
}: {
  people: SheetParticipant[];
  total: number;
  onClose: () => void;
}) {
  const { format } = useMoney();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const row = (p: SheetParticipant) => {
    const ring = RELATION_RING[p.relation ?? "other"];
    const held = heldLabel(p.daysHeld);
    const amount =
      p.valueUsd != null && p.valueUsd > 0
        ? p.valueUsd >= 1
          ? format(p.valueUsd, "USD")
          : "<$1"
        : null;
    return (
      <li key={p.wallet} className="flex items-center gap-3 px-4 py-2">
        <RingedAvatar
          wallet={p.wallet}
          name={p.name}
          avatarUrl={p.avatarUrl}
          size={34}
          ring={ring}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-[var(--text)]">
            {p.name || `${p.wallet.slice(0, 6)}…${p.wallet.slice(-4)}`}
          </span>
          {held && (
            <span className="num block text-[11px] text-[var(--text-muted)]">held {held}</span>
          )}
        </span>
        {p.side && (
          <span
            className="shrink-0 rounded-full px-2 py-[2px] text-[10px] font-semibold"
            style={{
              color: p.side === "YES" ? "var(--yes)" : "var(--no)",
              background: `color-mix(in oklab, ${p.side === "YES" ? "var(--yes)" : "var(--no)"} 14%, transparent)`,
            }}
          >
            {p.side}
          </span>
        )}
        <span className="num w-[56px] shrink-0 text-right text-[13px] font-semibold text-[var(--text)]">
          {amount ?? "—"}
        </span>
      </li>
    );
  };

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-end" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close participants"
        onClick={onClose}
        className="absolute inset-0 bg-black/60"
      />
      <div
        className="relative max-h-[80vh] w-full overflow-y-auto rounded-t-[18px] pb-[env(safe-area-inset-bottom)] [-webkit-overflow-scrolling:touch]"
        style={{ background: "var(--surface)", borderTop: "1px solid var(--hairline)" }}
      >
        <div
          className="sticky top-0 z-10 flex items-center justify-between px-4 pb-2 pt-3"
          style={{ background: "var(--surface)" }}
        >
          <span className="text-[13px] font-semibold text-[var(--text)]">
            Participants ({total.toLocaleString("en-US")})
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-[12px] text-[var(--text-muted)]"
          >
            Close
          </button>
        </div>
        {GROUPS.map(({ key, title }) => {
          const list = people.filter((p) => (p.relation ?? "other") === key);
          if (list.length === 0) return null;
          return (
            <div key={key} className="pb-2">
              <div className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                {title} ({list.length})
              </div>
              <ul>{list.map(row)}</ul>
            </div>
          );
        })}
        {people.length === 0 && (
          <div className="px-4 pb-6 pt-2 text-[13px] text-[var(--text-muted)]">
            No participants yet.
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
