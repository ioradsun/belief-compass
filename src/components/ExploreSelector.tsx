/**
 * ONE CONTROL — "what do you want to discover?"
 *
 * WHAT IT REPLACES, and the count is the argument. Explore had a five-chip lens
 * row AND a dropdown holding: an All row, three sensitivity levels, up to five
 * network groups, seven momentum lenses, seven topics and a Reset — about
 * twenty-four controls, in two competing surfaces, above a playlist that is the
 * actual product. It exposed the recommendation engine and asked the reader to
 * operate it.
 *
 * A reader in Explore has one question, and at most one follow-up:
 *
 *   HOW should markets be discovered?   → four choices, always visible when open
 *   WITHIN WHAT?                        → topic, people — folded away until asked
 *
 * Those are different kinds of decision and the menu keeps them apart. The lens
 * RANKS; narrowing sets the universe it ranks inside. "Most Capital + Crypto" is
 * one feed, not a special one: the same server request carries both, exactly as
 * it did when they were two menus.
 *
 * WHAT IS NOT HERE ANY MORE:
 *
 *   MOMENTUM SUB-LENSES  Moving now / Biggest gains / Biggest drops / Capital
 *                        flow / New believers / Contested / Waking up. Seven
 *                        decisions that require understanding the ranker to
 *                        make. The classifier still runs — it feeds the score,
 *                        the card's reason and the live tape — it just is not
 *                        something to configure.
 *   SENSITIVITY          moved to Settings, where preferences live, and it is
 *                        the SAME store (see @/lib/feed-sensitivity). One value,
 *                        one place to change it.
 *
 * PROGRESSIVE DISCLOSURE, NOT A DASHBOARD. The closed control says what feed you
 * are looking at in as few words as possible; narrowing that is on shows as a
 * quiet second line rather than a row of dismissible chips, which is the same
 * complexity wearing a different shape.
 */
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import {
  DISCOVER_LENSES,
  EXPLORE_LABEL,
  LENS_LABELS,
  LENS_QUESTIONS,
  type Lens,
} from "@/domain/feed/lens";

import {
  NETWORK_OPTIONS,
  TOPIC_OPTIONS,
  isAll,
  toggleNetwork,
  toggleTopic,
  type FeedFilters,
  type FeedNetwork,
} from "@/domain/feed/filters";

/** Which pane the menu is showing. One level down, never two. */
type Pane = "root" | "topic" | "people";

/**
 * What the narrowing rows say about themselves. A count past one, because
 * "Crypto + AI + DeFi" in a 320px rail is a sentence, not a label.
 */
function summarise(
  chosen: readonly string[],
  labelOf: (k: string) => string,
  none: string,
): string {
  if (chosen.length === 0) return none;
  if (chosen.length === 1) return labelOf(chosen[0]!);
  return `${chosen.length} selected`;
}

export function ExploreSelector({
  lens,
  onLens,
  filters,
  onFilters,
  availableNetworks,
}: {
  lens: Lens;
  onLens: (l: Lens) => void;
  filters: FeedFilters;
  onFilters: (f: FeedFilters) => void;
  /** Network groups this viewer's evidence can fill. Always includes everyone. */
  availableNetworks: FeedNetwork[];
}) {
  const [open, setOpen] = useState(false);
  const [pane, setPane] = useState<Pane>("root");
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      // Escape backs out one level before closing — the submenu is a place, and
      // leaving it should not also throw away the menu.
      if (e.key !== "Escape") return;
      if (pane !== "root") setPane("root");
      else setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open, pane]);

  // Always reopen at the top. A menu that remembers it was left inside "Topic"
  // greets the reader with a list of categories when they asked a broader question.
  useEffect(() => {
    if (!open) setPane("root");
  }, [open]);

  const networks = NETWORK_OPTIONS.filter((n) => availableNetworks.includes(n.key));
  const topicLabel = summarise(
    filters.topics,
    (k) => TOPIC_OPTIONS.find((t) => t.key === k)?.label ?? k,
    "All",
  );
  const peopleLabel = summarise(
    filters.networks,
    (k) => NETWORK_OPTIONS.find((n) => n.key === k)?.label ?? k,
    "Everyone",
  );
  /** The quiet second line — only when the reader has actually narrowed. */
  const narrowed = isAll(filters)
    ? null
    : [
        filters.topics.length > 0 ? topicLabel : null,
        filters.networks.length > 0 ? peopleLabel : null,
      ]
        .filter(Boolean)
        .join(" · ");

  return (
    <div ref={box} className="relative mb-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-full items-start gap-1.5 rounded-[10px] py-1 text-left transition-colors hover:opacity-80"
      >
        <span className="min-w-0">
          {/* THE HEADING IS THE SELECTION. The closed control names the lens
            currently ordering the list, so the reader can see what they chose
            without opening the menu. */}
          <span className="block truncate text-[15px] font-semibold leading-[20px] tracking-[-0.01em] text-[var(--text)]">
            {LENS_LABELS[lens]}
          </span>

          {/* Narrowing is secondary information and reads as such — one quiet
            line, never a row of chips with their own dismiss targets.
            ALWAYS RENDERED, never conditionally: choosing a topic would
            otherwise grow this control by a line and push the whole playlist
            down, which is a jump caused by the act of narrowing it. The row
            holds its 15px whether or not it has anything to say. */}
          <span
            className="block h-[15px] truncate text-[11px] leading-[15px] text-[var(--text-muted)]"
            aria-hidden={!narrowed}
          >
            {narrowed ?? ""}
          </span>
        </span>
        {/* Sits on the label's own 20px line, not the centre of the two-line
          stack — the arrow belongs to the word it opens. */}
        <ChevronDown
          size={14}
          className={`mt-[3px] shrink-0 text-[var(--text-muted)] transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 right-0 z-50 mt-1 max-h-[70vh] overflow-y-auto rounded-[12px] p-1.5 shadow-xl"
          style={{ background: "var(--bg)", border: "1px solid var(--border-strong)" }}
        >
          {pane === "root" ? (
            <>
              <Heading>Discover</Heading>
              {DISCOVER_LENSES.map((l) => (
                <Row
                  key={l}
                  label={LENS_LABELS[l]}
                  hint={LENS_QUESTIONS[l]}
                  checked={l === lens}
                  onClick={() => {
                    onLens(l);
                    setOpen(false);
                  }}
                />
              ))}

              <Heading className="mt-2">Narrow by</Heading>
              <Drill label="Topic" value={topicLabel} onClick={() => setPane("topic")} />
              {networks.length > 0 && (
                <Drill label="People" value={peopleLabel} onClick={() => setPane("people")} />
              )}
            </>
          ) : pane === "topic" ? (
            <>
              <Back label="Topic" onClick={() => setPane("root")} />
              <Row
                label="All"
                checked={filters.topics.length === 0}
                onClick={() => onFilters({ ...filters, topics: [] })}
              />
              {TOPIC_OPTIONS.map((t) => (
                <Row
                  key={t.key}
                  label={t.label}
                  checked={filters.topics.includes(t.key)}
                  onClick={() => onFilters(toggleTopic(filters, t.key))}
                />
              ))}
            </>
          ) : (
            <>
              <Back label="People" onClick={() => setPane("root")} />
              <Row
                label="Everyone"
                checked={filters.networks.length === 0}
                onClick={() => onFilters({ ...filters, networks: [] })}
              />
              {networks
                .filter((n) => n.key !== "everyone")
                .map((n) => (
                  <Row
                    key={n.key}
                    label={n.label}
                    checked={filters.networks.includes(n.key)}
                    onClick={() => onFilters(toggleNetwork(filters, n.key))}
                  />
                ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Heading({ children, className = "" }: { children: string; className?: string }) {
  return (
    <p
      className={`px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)] ${className}`}
    >
      {children}
    </p>
  );
}

/**
 * One choice. The checkmark column is reserved whether or not it is filled, so
 * selecting something moves nothing — the label must not shift under the finger
 * that just chose it.
 */
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
      role="menuitemradio"
      aria-checked={checked}
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left transition-colors hover:bg-[var(--surface)]"
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        {checked && <Check size={13} className="text-[var(--text)]" aria-hidden />}
      </span>
      <span className="min-w-0">
        <span
          className={`block truncate text-[13px] ${checked ? "text-[var(--text)]" : "text-[var(--text-secondary)]"}`}
        >
          {label}
        </span>
        {hint && (
          <span className="block truncate text-[11px] leading-snug text-[var(--text-muted)]">
            {hint}
          </span>
        )}
      </span>
    </button>
  );
}

/** A row that opens a pane. The current value sits where the answer will be. */
function Drill({ label, value, onClick }: { label: string; value: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="menu"
      className="flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left transition-colors hover:bg-[var(--surface)]"
    >
      <span className="w-4 shrink-0" aria-hidden />
      <span className="truncate text-[13px] text-[var(--text-secondary)]">{label}</span>
      <span className="ml-auto truncate text-[13px] text-[var(--text-muted)]">{value}</span>
      <span aria-hidden className="shrink-0 text-[11px] text-[var(--text-muted)]">
        &rsaquo;
      </span>
    </button>
  );
}

function Back({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left transition-colors hover:bg-[var(--surface)]"
    >
      <span aria-hidden className="w-4 shrink-0 text-[11px] text-[var(--text-muted)]">
        &lsaquo;
      </span>
      <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
        {label}
      </span>
    </button>
  );
}
