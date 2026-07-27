/**
 * OmniHeader — one line, one job. A search field for markets and people, with a
 * quiet lens dropdown docked inside it. No hero copy, no chip row: the header
 * asks a single question ("what are you looking for?") and gets out of the way.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getNetwork } from "@/lib/dna.functions";

export type Lens = "all" | "hot" | "early" | "hidden" | "contested" | "conviction" | "new";

export type LensOption = { key: Lens; emoji: string; label: string; question: string };

type MarketLite = { onchain_id: number | string; title?: string | null };

export function OmniHeader({
  lens,
  lenses,
  onLens,
  markets,
  wallet,
  onSelectMarket,
  onSelectPerson,
  onOpenMenu,
}: {
  lens: Lens;
  lenses: LensOption[];
  onLens: (l: Lens) => void;
  markets: MarketLite[];
  wallet?: string;
  onSelectMarket: (id: number) => void;
  onSelectPerson: (w: string) => void;
  onOpenMenu: () => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [lensOpen, setLensOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const active = lenses.find((l) => l.key === lens)!;

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setLensOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const term = q.trim().toLowerCase();
  const marketHits = useMemo(() => {
    if (term.length < 2) return [];
    return markets
      .filter((m) => (m.title ?? "").toLowerCase().includes(term))
      .slice(0, 6)
      .map((m) => ({ id: Number(m.onchain_id), title: m.title ?? `Market #${m.onchain_id}` }));
  }, [markets, term]);

  const { data: net } = useQuery({
    queryKey: ["omni-people", wallet ?? null, term],
    queryFn: async () => await getNetwork({ data: { wallet, query: term, limit: 6 } }),
    enabled: Boolean(wallet) && term.length >= 2,
    staleTime: 30_000,
  });
  const peopleHits = net?.people ?? [];

  const showResults = open && term.length >= 2;

  return (
    <header className="relative mb-5 lg:mb-6" ref={boxRef}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Open menu"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[var(--border)] lg:hidden"
        >
          <span className="space-y-1">
            <span className="block h-px w-4 bg-current" />
            <span className="block h-px w-4 bg-current" />
            <span className="block h-px w-4 bg-current" />
          </span>
        </button>

        {/* Search + lens live in one continuous pill. */}
        <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] pl-4 pr-1.5">
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
            placeholder="Search markets and people"
            aria-label="Search markets and people"
            className="min-w-0 flex-1 bg-transparent text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
          />
          <button
            type="button"
            onClick={() => {
              setLensOpen((v) => !v);
              setOpen(false);
            }}
            aria-haspopup="listbox"
            aria-expanded={lensOpen}
            className="flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--panel)] hover:text-[var(--text)]"
          >
            <span aria-hidden>{active.emoji}</span>
            <span className="hidden sm:inline">{active.label}</span>
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="m6 9 6 6 6-6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* Lens menu — the filter, stated as a question. */}
      {lensOpen && (
        <div
          role="listbox"
          className="absolute right-0 top-12 z-40 w-72 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] p-1 shadow-xl"
        >
          {lenses.map((l) => (
            <button
              key={l.key}
              type="button"
              role="option"
              aria-selected={l.key === lens}
              onClick={() => {
                onLens(l.key);
                setLensOpen(false);
              }}
              className={`flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left transition-colors ${
                l.key === lens ? "bg-[var(--surface)]" : "hover:bg-[var(--surface)]"
              }`}
            >
              <span aria-hidden className="mt-0.5 text-sm">
                {l.emoji}
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-[var(--text)]">{l.label}</span>
                <span className="block truncate text-[11px] text-[var(--text-muted)]">
                  {l.question}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Results */}
      {showResults && (
        <div className="absolute inset-x-0 top-12 z-40 max-h-[60vh] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--panel)] p-1 shadow-xl">
          {marketHits.length === 0 && peopleHits.length === 0 ? (
            <p className="px-3 py-3 text-[13px] text-[var(--text-muted)]">No matches.</p>
          ) : null}

          {marketHits.length > 0 && (
            <>
              <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Markets
              </p>
              {marketHits.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    onSelectMarket(m.id);
                    setOpen(false);
                    setQ("");
                  }}
                  className="block w-full truncate rounded-lg px-3 py-2 text-left text-[13px] text-[var(--text)] hover:bg-[var(--surface)]"
                >
                  {m.title}
                </button>
              ))}
            </>
          )}

          {peopleHits.length > 0 && (
            <>
              <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                People
              </p>
              {peopleHits.map((p) => (
                <button
                  key={p.wallet}
                  type="button"
                  onClick={() => {
                    onSelectPerson(p.wallet);
                    setOpen(false);
                    setQ("");
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left hover:bg-[var(--surface)]"
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
              ))}
            </>
          )}
        </div>
      )}
    </header>
  );
}
