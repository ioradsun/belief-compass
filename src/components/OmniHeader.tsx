/**
 * OmniHeader — one line, one job. A search field for markets and people.
 *
 * The search is global (it queries the whole catalog and all people), so it now
 * lives in the app's top bar rather than inside the center column. The lens
 * picker — which only re-ranks the deck below — is exported separately so it can
 * stay next to the thing it filters.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { getNetwork } from "@/lib/dna.functions";
import { searchMarkets } from "@/lib/markets.functions";

export type Lens = "all" | "hot" | "early" | "hidden" | "contested" | "conviction" | "new";

export type LensOption = { key: Lens; emoji: string; label: string; question: string };

/**
 * The deck's filter, expressed as a tag rather than a select.
 *
 * "All" is not a label anyone should have to read — it's just the absence of a
 * filter. So the chip always states the market's own momentum (a fact about
 * what you're looking at). Tapping it opens the lenses; picking one turns the
 * chip solid and adds an ✕ to clear. Unfiltered = outline tag, filtered = solid
 * tag. Two states, no "All" to select.
 */
export function LensPicker({
  lens,
  lenses,
  onLens,
  tone,
  label,
  title,
  align = "left",
}: {
  lens: Lens;
  lenses: LensOption[];
  onLens: (l: Lens) => void;
  /** Accent color of the chip (momentum hue). Defaults to the neutral border look. */
  tone?: string;
  /** The chip's text — the market's momentum label when no lens is applied. */
  label?: string;
  title?: string;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = lenses.find((l) => l.key === lens)!;
  const filtering = lens !== "all";

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const hue = tone ?? "var(--text-secondary)";
  const chipStyle = filtering
    ? { color: "var(--bg)", background: hue, border: `1px solid ${hue}` }
    : tone
      ? {
          color: hue,
          background: `color-mix(in oklab, ${hue} 13%, transparent)`,
          border: `1px solid color-mix(in oklab, ${hue} 32%, transparent)`,
        }
      : undefined;

  return (
    <div className="relative" ref={ref}>
      <div
        style={chipStyle}
        className={`flex shrink-0 items-center rounded-full text-[11px] font-semibold uppercase tracking-[0.08em] ${
          chipStyle
            ? ""
            : "border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text)]"
        }`}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={filtering ? `Filtering by ${active.label}` : "Filter markets"}
          title={filtering ? `Showing ${active.label} markets` : title}
          className="flex items-center gap-1.5 rounded-full px-2.5 py-1"
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: filtering ? "currentColor" : hue }}
            aria-hidden
          />
          <span>{filtering ? active.label : (label ?? "Filter")}</span>
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className="h-3 w-3 opacity-70"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="m6 9 6 6 6-6" strokeLinecap="round" />
          </svg>
        </button>

        {filtering && (
          <button
            type="button"
            onClick={() => onLens("all")}
            aria-label="Clear filter"
            title="Clear filter"
            className="-ml-0.5 rounded-full pr-2.5 pl-0.5 opacity-80 hover:opacity-100"
          >
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>


      {open && (
        <div
          role="listbox"
          className={`absolute ${align === "right" ? "right-0" : "left-0"} top-9 z-40 w-72 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] p-1 shadow-xl`}
        >
          {/* "All" isn't an option you pick — it's the state you return to. */}
          {lenses
            .filter((l) => l.key !== "all")
            .map((l) => (
              <button
                key={l.key}
                type="button"
                role="option"
                aria-selected={l.key === lens}
                onClick={() => {
                  onLens(l.key === lens ? "all" : l.key);
                  setOpen(false);
                }}
                className={`flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left transition-colors ${
                  l.key === lens ? "bg-[var(--surface)]" : "hover:bg-[var(--surface)]"
                }`}
              >
                <span aria-hidden className="mt-0.5 text-sm">
                  {l.emoji}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-[var(--text)]">{l.label}</span>
                  <span className="block truncate text-[11px] text-[var(--text-muted)]">
                    {l.question}
                  </span>
                </span>
                {l.key === lens && (
                  <span className="mt-0.5 text-[11px] text-[var(--text-muted)]">✓</span>
                )}
              </button>
            ))}
          {lens !== "all" && (
            <button
              type="button"
              onClick={() => {
                onLens("all");
                setOpen(false);
              }}
              className="mt-1 w-full rounded-lg border-t border-[var(--border)] px-3 py-2 text-left text-[12px] text-[var(--text-muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]"
            >
              Clear filter — show everything
            </button>
          )}

        </div>
      )}
    </div>
  );
}

export function OmniHeader({
  wallet,
  onSelectMarket,
  onSelectPerson,
  onOpenMenu,
  right,
}: {
  wallet?: string;
  onSelectMarket: (id: number) => void;
  onSelectPerson: (w: string) => void;
  onOpenMenu: () => void;
  /** Top-right slot — the account affordance. */
  right?: ReactNode;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active_i, setActiveI] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  // Debounce the query into the searches so we don't fire on every keystroke.
  const [term, setTerm] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 140);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // Markets: full-catalog, intent-ranked search (server), not just the loaded feed.
  const { data: marketHits = [] } = useQuery({
    queryKey: ["omni-markets", term],
    queryFn: async () => await searchMarkets({ data: { query: term, limit: 8 } }),
    enabled: term.length >= 2,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const { data: net } = useQuery({
    queryKey: ["omni-people", wallet ?? null, term],
    queryFn: async () => await getNetwork({ data: { wallet, query: term, limit: 6 } }),
    enabled: Boolean(wallet) && term.length >= 2,
    staleTime: 30_000,
  });
  const peopleHits = net?.people ?? [];

  const showResults = open && term.length >= 2;

  // One flat, keyboard-navigable list: markets first (primary intent), then people.
  const flat: Array<{ kind: "market"; id: number } | { kind: "person"; wallet: string }> = [
    ...marketHits.map((m) => ({ kind: "market" as const, id: m.onchain_id })),
    ...peopleHits.map((p) => ({ kind: "person" as const, wallet: p.wallet })),
  ];
  useEffect(() => setActiveI(0), [term]);

  const choose = (item: (typeof flat)[number]) => {
    if (item.kind === "market") onSelectMarket(item.id);
    else onSelectPerson(item.wallet);
    setOpen(false);
    setQ("");
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!showResults || flat.length === 0) {
      if (e.key === "Escape") setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveI((i) => (i + 1) % flat.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveI((i) => (i - 1 + flat.length) % flat.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(flat[Math.min(active_i, flat.length - 1)]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="relative min-w-0 flex-1" ref={boxRef}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenMenu();
          }}
          aria-label="Open menu"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[var(--border)] lg:hidden"
        >
          <span className="space-y-1">
            <span className="block h-px w-4 bg-current" />
            <span className="block h-px w-4 bg-current" />
            <span className="block h-px w-4 bg-current" />
          </span>
        </button>

        <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4">
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className="h-4 w-4 shrink-0 text-[var(--text-muted)]"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" strokeLinecap="round" />
          </svg>
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder="Search markets and people"
            aria-label="Search markets and people"
            className="min-w-0 flex-1 bg-transparent text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
          />
        </div>

        {right}
      </div>

      {/* Results */}
      {showResults && (
        <div className="absolute inset-x-0 top-11 z-50 max-h-[60vh] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--panel)] p-1 shadow-xl">
          {marketHits.length === 0 && peopleHits.length === 0 ? (
            <p className="px-3 py-3 text-[13px] text-[var(--text-muted)]">No matches.</p>
          ) : null}

          {marketHits.length > 0 && (
            <>
              <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Markets
              </p>
              {marketHits.map((m, i) => (
                <button
                  key={m.onchain_id}
                  type="button"
                  onMouseEnter={() => setActiveI(i)}
                  onClick={() => choose({ kind: "market", id: m.onchain_id })}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left"
                  style={active_i === i ? { background: "var(--surface)" } : undefined}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-[var(--text)]">{m.title}</span>
                    {m.category && (
                      <span className="block truncate text-[11px] text-[var(--text-muted)]">
                        {m.category}
                      </span>
                    )}
                  </span>
                  {m.believers > 0 && (
                    <span className="num shrink-0 text-[11px] text-[var(--text-muted)]">
                      {m.believers} in
                    </span>
                  )}
                </button>
              ))}
            </>
          )}

          {peopleHits.length > 0 && (
            <>
              <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                People
              </p>
              {peopleHits.map((p, i) => {
                const idx = marketHits.length + i;
                return (
                  <button
                    key={p.wallet}
                    type="button"
                    onMouseEnter={() => setActiveI(idx)}
                    onClick={() => choose({ kind: "person", wallet: p.wallet })}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left"
                    style={active_i === idx ? { background: "var(--surface)" } : undefined}
                  >
                    {p.avatarUrl ? (
                      <img
                        src={p.avatarUrl}
                        alt=""
                        className="h-6 w-6 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <span className="h-6 w-6 shrink-0 rounded-full bg-[var(--surface)]" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text)]">
                      {p.displayName}
                    </span>
                    <span className="num shrink-0 text-[11px] text-[var(--text-muted)]">
                      {p.agreement}%
                    </span>
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
