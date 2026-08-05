/**
 * OmniHeader — one line, one job. A search field for markets and people.
 *
 * The search is global (it queries the whole catalog and all people), so it now
 * lives in the app's top bar rather than inside the center column.
 *
 * It used to export a `LensPicker` too — the Hot / Early / Hidden / Contested /
 * Conviction / New chip that sat in the centre panel. That taxonomy is gone
 * (see @/domain/feed/mode for why the measured version of it did not work), and
 * the perspective control now lives with the running order it reorders.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { getNetwork } from "@/lib/dna.functions";
import { searchMarkets, getMarketFaces, type MarketFace } from "@/lib/markets.functions";
import { composeDiscoveryRow } from "@/domain/market-discovery";
import {
  presentRelationship,
  relationshipInsight,
  relationshipSupport,
  relationshipLabel,
} from "@/domain/relationship";

export function OmniHeader({
  wallet,
  onSelectMarket,
  onSelectPerson,
  onOpenMenu,
  right,
  center,
}: {
  wallet?: string;
  onSelectMarket: (id: number) => void;
  onSelectPerson: (w: string) => void;
  onOpenMenu: () => void;
  /** Top-right slot — the account affordance. */
  right?: ReactNode;
  /** Mobile-only center slot — the primary action (+ Conviction). */
  center?: ReactNode;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  /** Mobile: the field is a tap target that expands over the row. */
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
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
      if (!boxRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setExpanded(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // Markets: full-catalog, intent-ranked search (server), not just the loaded feed.
  const { data: marketHits = [], isFetching: marketsFetching } = useQuery({
    queryKey: ["omni-markets", term],
    queryFn: async () => await searchMarkets({ data: { query: term, limit: 8 } }),
    enabled: term.length >= 2,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const { data: net, isFetching: peopleFetching } = useQuery({
    queryKey: ["omni-people", wallet ?? null, term],
    queryFn: async () => await getNetwork({ data: { wallet, query: term, limit: 6 } }),
    enabled: Boolean(wallet) && term.length >= 2,
    staleTime: 30_000,
  });
  const peopleHits = net?.people ?? [];

  // Social proof for the results on screen: who actually put money behind each
  // question, viewer's own network first. Fetched for the visible page only.
  const faceIds = marketHits.map((m) => m.onchain_id);
  const { data: facesById = {} } = useQuery({
    queryKey: ["omni-faces", wallet ?? null, faceIds.join(",")],
    queryFn: async () => await getMarketFaces({ data: { ids: faceIds, wallet } }),
    enabled: faceIds.length > 0,
    staleTime: 60_000,
  });

  const showResults = open && term.length >= 2;
  // Still typing (the debounced term trails the field) or still fetching: the
  // list is unresolved, not empty.
  const searching = q.trim() !== term || marketsFetching || (Boolean(wallet) && peopleFetching);

  // One universal field, quick filters beneath it: the scope narrows the current
  // results in place rather than opening a different search.
  const [scope, setScope] = useState<"all" | "markets" | "people">("all");
  const visibleMarkets = scope === "people" ? [] : marketHits;
  const visiblePeople = scope === "markets" ? [] : peopleHits;

  // One flat, keyboard-navigable list: markets first (primary intent), then people.
  const flat: Array<{ kind: "market"; id: number } | { kind: "person"; wallet: string }> = [
    ...visibleMarkets.map((m) => ({ kind: "market" as const, id: m.onchain_id })),
    ...visiblePeople.map((p) => ({ kind: "person" as const, wallet: p.wallet })),
  ];
  useEffect(() => setActiveI(0), [term, scope]);

  const choose = (item: (typeof flat)[number]) => {
    if (item.kind === "market") onSelectMarket(item.id);
    else onSelectPerson(item.wallet);
    // The panel closes; the QUERY stays. Clearing it meant that opening a result
    // and coming back to look at the next one required retyping the search —
    // the search context thrown away at the exact moment it was still wanted.
    // The explicit ✕ still clears it.
    setOpen(false);
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

        {/* The Feed button used to sit here with two jobs fused together: "show
            me what's next" and "get me out of here". The first became the left
            rail's Feed tab, which is where the running order actually lives; the
            second went to the panels doing the taking-over, each of which now
            clears its own search param. Neither job needed a global control. */}

        {/* Mobile: the primary action owns the middle of the bar. */}
        {center && (
          <div
            className={`${expanded ? "hidden" : "flex"} min-w-0 flex-1 items-center justify-center lg:hidden`}
          >
            {center}
          </div>
        )}

        {/* Mobile: search is a tap target until you need it. */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(true);
            setOpen(true);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
          aria-label="Search markets and people"
          className={`${expanded ? "hidden" : "grid"} h-9 w-9 shrink-0 place-items-center rounded-full border border-[var(--border)] text-[var(--text-secondary)] lg:hidden`}
        >
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" strokeLinecap="round" />
          </svg>
        </button>

        <div
          className={`${expanded ? "flex" : "hidden"} h-9 min-w-0 flex-1 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 lg:flex`}
        >
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
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setExpanded(false);
              onKeyDown(e);
            }}
            placeholder="Search markets and people"
            aria-label="Search markets and people"
            className="min-w-0 flex-1 bg-transparent text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
          />
          {expanded && (
            <button
              type="button"
              onClick={() => {
                setQ("");
                setOpen(false);
                setExpanded(false);
              }}
              aria-label="Close search"
              className="shrink-0 text-[var(--text-muted)] lg:hidden"
            >
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>

        {right}
      </div>

      {/* Results */}
      {showResults && (
        <div className="absolute inset-x-0 top-11 z-50 max-h-[60vh] lg:right-auto lg:w-[720px] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--panel)] p-1 shadow-xl">
          {/* Two filters, no "All": unselected is the everything state. */}
          <div className="flex items-center gap-1 px-2 pb-1 pt-1.5">
            {(["markets", "people"] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={scope === s}
                onClick={() => setScope(scope === s ? "all" : s)}
                className="rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize transition-colors"
                style={
                  scope === s
                    ? { background: "var(--text)", color: "var(--bg)" }
                    : { color: "var(--text-muted)" }
                }
              >
                {s}
              </button>
            ))}
          </div>

          {/* Typing is not failure: while a query is in flight we say we're
              looking. "No matches" is a verdict, and a verdict only lands once
              the search has actually finished. */}
          {visibleMarkets.length === 0 && visiblePeople.length === 0 ? (
            searching ? (
              <p className="flex items-center gap-2 px-3 py-3 text-[13px] text-[var(--text-muted)]">
                <span
                  aria-hidden
                  className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--text-muted)]"
                />
                Searching…
              </p>
            ) : (
              <p className="px-3 py-3 text-[13px] text-[var(--text-muted)]">
                No matches for “{term}”.
              </p>
            )
          ) : null}

          {visibleMarkets.length > 0 && (
            <>
              <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Markets
              </p>
              {visibleMarkets.map((m, i) => {
                // What a searcher actually wants: the question, then whether
                // anything is happening — a plain momentum sentence, supported by
                // lifetime reach and the capital standing behind it right now.
                const proof = facesById[m.onchain_id];
                const faces = proof?.faces ?? [];
                const social = socialLine(proof?.faces ?? [], proof?.knownCount ?? 0);
                const row = composeDiscoveryRow({
                  participants: m.participants,
                  believers: m.believers,
                  capitalUsd: m.capitalUsd,
                  firstActivityAt: m.firstActivityAt,
                  lastActivityAt: m.lastActivityAt,
                  joined24h: m.joined24h,
                  nowMs: Date.now(),
                });
                return (
                  <button
                    key={m.onchain_id}
                    type="button"
                    onMouseEnter={() => setActiveI(i)}
                    onClick={() => choose({ kind: "market", id: m.onchain_id })}
                    className="flex w-full items-stretch gap-2.5 rounded-lg py-2 pr-3 text-left"
                    style={active_i === i ? { background: "var(--surface)" } : undefined}
                  >
                    {/* A 2px rail, not a badge: enough to group by momentum while
                        scanning, never enough to compete with the question. */}
                    <span
                      aria-hidden
                      className="ml-1.5 w-[2px] shrink-0 rounded-full"
                      style={{
                        background:
                          row.accent === "growing"
                            ? "color-mix(in oklab, var(--yes) 55%, transparent)"
                            : row.accent === "active"
                              ? "color-mix(in oklab, var(--text-muted) 55%, transparent)"
                              : "transparent",
                      }}
                    />
                    <span className="min-w-0 flex-1">
                      {/* One question, one line: a wrapped title turns a scannable
                          list into paragraphs. It clips instead. */}
                      <span className="block truncate whitespace-nowrap text-[13px] font-medium text-[var(--text)]">
                        {m.title}
                      </span>
                      {/* Story and numbers read as one block — neutral, uncoloured.
                          When real people the viewer relates to are in here, their
                          names replace the interpretation: social proof beats mood. */}
                      <span className="mt-1 block truncate whitespace-nowrap text-[11px] text-[var(--text-muted)]">
                        {social ? social : row.story}
                      </span>
                      {row.metrics.length > 0 && (
                        <span className="num mt-0 flex items-center gap-1.5 truncate text-[11px]">
                          {faces.length > 0 && <FaceStack faces={faces} />}
                          {row.metrics.map((mt, k) => (
                            <span key={mt.label} className="flex items-center gap-1.5">
                              {k > 0 && (
                                <span aria-hidden className="text-[var(--text-muted)]">
                                  ·
                                </span>
                              )}
                              <span className="font-medium text-[var(--text)]">{mt.value}</span>
                              <span className="text-[var(--text-muted)]">{mt.label}</span>
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </>
          )}

          {visiblePeople.length > 0 && (
            <>
              <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                People
              </p>
              {visiblePeople.map((p, i) => {
                const idx = visibleMarkets.length + i;
                // What a searcher wants about a person: their relationship to YOU
                // — the same honest story the People page tells, not a bare "34%".
                const rel = presentRelationship({
                  agreement: p.agreement,
                  sharedConvictions: p.sharedBeliefs,
                  together: p.together,
                  apart: p.apart,
                  topicCount: p.topicCount,
                  strongestAlignedTopic: p.strongestAlignedDomain?.name ?? null,
                  strongestOpposedTopic: p.strongestOpposedDomain?.name ?? null,
                });
                const label = relationshipLabel(rel);
                const toneFg = rel.group === "rival" ? "var(--no)" : "var(--yes)";
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
                        className="h-7 w-7 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <span className="h-7 w-7 shrink-0 rounded-full bg-[var(--surface)]" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-[var(--text)]">
                        {p.displayName}
                      </span>
                      <span className="block truncate text-[11px] text-[var(--text-muted)]">
                        <span style={{ color: toneFg }}>{relationshipInsight(rel)}</span> ·{" "}
                        {relationshipSupport(rel)}
                      </span>
                    </span>
                    {label && (
                      <span
                        className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]"
                        style={{
                          color: toneFg,
                          background:
                            label.kind === "provisional"
                              ? "transparent"
                              : `color-mix(in oklab, ${toneFg} 14%, transparent)`,
                          border:
                            label.kind === "provisional" ? "1px solid var(--border)" : undefined,
                        }}
                      >
                        {label.text}
                      </span>
                    )}
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

/**
 * Overlapping faces, small and quiet. Only people with a real identity get
 * here (see getMarketFaces), so every circle carries information.
 */
function FaceStack({ faces }: { faces: MarketFace[] }) {
  return (
    <span className="mr-0.5 flex shrink-0 items-center">
      {faces.map((f, i) => (
        <span
          key={f.wallet}
          title={f.name}
          className="inline-flex h-4 w-4 items-center justify-center overflow-hidden rounded-full border border-[var(--panel)] bg-[var(--surface)] text-[8px] font-semibold uppercase text-[var(--text-muted)]"
          style={{ marginLeft: i === 0 ? 0 : -5, zIndex: faces.length - i }}
        >
          {f.avatarUrl ? (
            <img
              src={f.avatarUrl}
              alt=""
              width={16}
              height={16}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            f.name.slice(0, 1)
          )}
        </span>
      ))}
    </span>
  );
}

/**
 * "Sarah and Mike participated" beats "Believers are joining." — but only when
 * the names mean something to this viewer. Without a shared network we let the
 * momentum sentence stand.
 */
function socialLine(faces: MarketFace[], knownCount: number): string | null {
  if (knownCount === 0) return null;
  const names = faces.filter((f) => f.known).map((f) => f.name);
  if (names.length === 0) return null;
  if (names.length === 1) return `${names[0]} participated`;
  if (names.length === 2) return `${names[0]} and ${names[1]} participated`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more you know participated`;
}
