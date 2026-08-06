/**
 * TUNE FEED — one control that builds the reader's own feed.
 *
 * THE BRIEF ASKED FOR A SECOND SURFACE — a "Tune Feed" icon beside Now, opening
 * a bottom sheet — and the review declined it. This menu already sits at the top
 * of the playlist, already summarises its own state in its title, and already
 * exists to answer "what do I want in my feed". A second control an inch away,
 * answering the same question in a different shape, is two things to find and
 * two mental models to hold. Sensitivity became its FIRST section instead.
 *
 * The sections are ordered by how often the answer changes: how much matters
 * (rarely, and it is the strongest lever), then who, then what is moving, then
 * what it is about.
 *
 * It replaces a three-tab perspective strip. A strip can only ever say "one of
 * these"; a reader who wants "AI, from my tribe" has to be able to say both.
 * The grammar lives in @/domain/feed/filters — this file is only the surface:
 * a title that summarises the selection, a checklist, and a reset.
 *
 * ALL IS A ROW, NOT A STATE. Tapping "All" clears everything, which is the same
 * thing All means. There is no separate "clear" concept to get out of sync.
 */
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import {
  ALL,
  NETWORK_OPTIONS,
  TOPIC_OPTIONS,
  filterTitle,
  isAll,
  toggleNetwork,
  toggleTopic,
  toggleMomentum,
  MOMENTUM_OPTIONS,
  type FeedFilters,
  type FeedNetwork,
} from "@/domain/feed/filters";
import { SENSITIVITY_ORDER, type Sensitivity } from "@/domain/market-change";

/**
 * What each floor means, in the reader's terms rather than the engine's.
 *
 * NO NUMBERS, deliberately. A row in the bar table sets three thresholds at
 * once — percent, dollars and people — and each is scaled again by the window.
 * Printing "5%" would be true of one of those three and misleading about the
 * others, and it would teach a reader a model of the feed they should never
 * need to hold.
 */
const SENSITIVITY_COPY: Record<Sensitivity, { label: string; hint: string }> = {
  everything: { label: "Everything", hint: "Every move, however small" },
  notable: { label: "Notable", hint: "Skip the small stuff" },
  major: { label: "Major only", hint: "Just the big moves" },
};

function Row({
  label,
  hint,
  checked,
  onClick,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-[var(--surface)]"
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        {checked && <Check size={13} className="text-[var(--text)]" aria-hidden />}
      </span>
      <span className="min-w-0">
        <span
          className={`block ${checked ? "text-[var(--text)]" : "text-[var(--text-secondary)]"}`}
        >
          {label}
        </span>
        {hint && (
          <span className="block text-[11px] leading-snug text-[var(--text-muted)]">{hint}</span>
        )}
      </span>
    </button>
  );
}

export function FeedFilterMenu({
  filters,
  onChange,
  /** Network options the viewer's evidence can actually fill. */
  availableNetworks,
  sensitivity,
  onSensitivity,
}: {
  filters: FeedFilters;
  onChange: (f: FeedFilters) => void;
  availableNetworks: FeedNetwork[];
  /** The reader's floor. See @/lib/feed-sensitivity. */
  sensitivity?: Sensitivity;
  onSensitivity?: (s: Sensitivity) => void;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const networks = NETWORK_OPTIONS.filter((n) => availableNetworks.includes(n.key));

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-[10px] px-2.5 py-1.5 text-left transition-colors hover:bg-[var(--surface)]"
      >
        <span className="truncate text-[14px] font-semibold text-[var(--text)]">
          {filterTitle(filters)}
        </span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-[var(--text-muted)] transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 right-0 z-50 mt-1 max-h-[70vh] overflow-y-auto rounded-[12px] p-1.5 shadow-xl"
          style={{ background: "var(--bg)", border: "1px solid var(--border-strong)" }}
        >
          <Row label="All" checked={isAll(filters)} onClick={() => onChange(ALL)} />

          {/* HOW MUCH MATTERS — the reader's floor. Named steps, not numbers:
              the honest number differs per metric AND per window, so "$5" would
              be true of one of three things and teach a model nobody needs. */}
          <p className="mt-2 px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
            How much matters
          </p>
          {SENSITIVITY_ORDER.map((s) => (
            <Row
              key={s}
              label={SENSITIVITY_COPY[s].label}
              hint={SENSITIVITY_COPY[s].hint}
              checked={sensitivity === s}
              onClick={() => onSensitivity?.(s)}
            />
          ))}

          {networks.length > 0 && (
            <>
              <p className="mt-2 px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                Network
              </p>
              {networks.map((n) => (
                <Row
                  key={n.key}
                  label={n.label}
                  checked={filters.networks.includes(n.key)}
                  onClick={() => onChange(toggleNetwork(filters, n.key))}
                />
              ))}
            </>
          )}

          {/* MOMENTUM — "what is changing", the question the grammar could not
              be asked before. Above Topics because it is the more perishable
              answer: a topic is true forever, a move is true today. */}
          <p className="mt-2 px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
            Momentum
          </p>
          {MOMENTUM_OPTIONS.map((m) => (
            <Row
              key={m.key}
              label={m.label}
              checked={(filters.momentum ?? []).includes(m.key)}
              onClick={() => onChange(toggleMomentum(filters, m.key))}
            />
          ))}

          <p className="mt-2 px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
            Topics
          </p>
          {TOPIC_OPTIONS.map((t) => (
            <Row
              key={t.key}
              label={t.label}
              checked={filters.topics.includes(t.key)}
              onClick={() => onChange(toggleTopic(filters, t.key))}
            />
          ))}

          {!isAll(filters) && (
            <button
              type="button"
              onClick={() => onChange(ALL)}
              className="mt-2 w-full rounded-[8px] px-2 py-1.5 text-left text-[12px] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text)]"
            >
              Reset filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}
