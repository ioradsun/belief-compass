/**
 * LEFT PANEL — "Network", reimagined as People Discovery.
 *
 * People are the product; controls are not. The screen leads with people: a
 * single compact DNA progress row, a collapsed search and ONE filter dropdown,
 * then the person list immediately — the first person is visible within the first
 * screenful. Every person reads as a story (a discovery stage + one human
 * sentence), never a row of statistics, and the list is ordered by curiosity so
 * the most interesting person is always first. Presentation only: getNetwork owns
 * the relationships and evidence; the pure src/domain/person-story engine turns
 * them into stages, sentences and rank; clicking opens the profile in the center.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getNetwork, type NetworkPersonRow } from "@/lib/dna.functions";
import { ago } from "@/lib/dna-labels";
import { hueFor, initialsFor } from "@/lib/wallet-identity";
import { WalletConnectButton } from "@/components/WalletConnect";
import { personStory, type PersonStory } from "@/domain/person-story";
import {
  DNA_STAGE_LABEL,
  DNA_STAGE_ORDER,
  decisionsToNextStage,
  dnaReveal,
  dnaStage,
  matchCountLine,
  stageAtLeast,
} from "@/domain/conviction-dna";

type RelFilter = "all" | "twin" | "tribe" | "opp" | "inverse";
type Sort = "relevant" | "closest" | "active" | "newest";

/** One dropdown replaces five chips + a sort control. Each lens maps to a server
 *  filter/sort; curiosity views re-rank by story, activity views keep server order. */
type Lens = {
  key: string;
  label: string;
  filter: RelFilter;
  sort: Sort;
  /** Re-order client-side by curiosity (story rank); else trust the server sort. */
  curiosity: boolean;
};
const LENSES: Lens[] = [
  { key: "everyone", label: "Everyone", filter: "all", sort: "relevant", curiosity: true },
  { key: "twin", label: "Potential Twin", filter: "twin", sort: "relevant", curiosity: true },
  { key: "tribe", label: "Tribe", filter: "tribe", sort: "relevant", curiosity: true },
  { key: "opp", label: "Opps", filter: "opp", sort: "relevant", curiosity: true },
  { key: "active", label: "Recently Active", filter: "all", sort: "active", curiosity: false },
  { key: "newest", label: "Newest", filter: "all", sort: "newest", curiosity: false },
  { key: "closest", label: "Highest Match", filter: "all", sort: "closest", curiosity: false },
  { key: "different", label: "Different", filter: "inverse", sort: "relevant", curiosity: true },
];

const toneFg = (t: PersonStory["tone"]): string =>
  t === "aligned" ? "var(--yes)" : t === "opposed" ? "var(--no)" : "var(--text-muted)";
const toneBg = (t: PersonStory["tone"]): string =>
  t === "aligned"
    ? "color-mix(in oklab, var(--yes) 14%, transparent)"
    : t === "opposed"
      ? "color-mix(in oklab, var(--no) 14%, transparent)"
      : "color-mix(in oklab, var(--text-muted) 12%, transparent)";

const storyOf = (p: NetworkPersonRow): PersonStory =>
  personStory({
    relationship: p.relationship,
    evidence: p.evidenceLevel,
    agreement: p.agreement,
    sharedBeliefs: p.sharedBeliefs,
    alignedDomain: p.strongestAlignedDomain?.name ?? null,
    opposedDomain: p.strongestOpposedDomain?.name ?? null,
  });

export function NetworkPanel({
  wallet,
  selectedPerson,
  onSelectPerson,
  onOpenDna,
  onExplore,
}: {
  wallet?: string;
  selectedPerson?: string;
  onSelectPerson: (wallet: string) => void;
  onOpenDna: () => void;
  /** Empty-state CTA — take me to the markets. */
  onExplore?: () => void;
}) {
  const [lensKey, setLensKey] = useState<string>("everyone");
  const lens = LENSES.find((l) => l.key === lensKey) ?? LENSES[0];
  const [searchOpen, setSearchOpen] = useState(false);
  const [rawQuery, setRawQuery] = useState("");
  const [query, setQuery] = useState("");

  // Debounce the search into the server query (server stays authoritative).
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => setQuery(rawQuery.trim()), 200);
    return () => {
      if (t.current) clearTimeout(t.current);
    };
  }, [rawQuery]);

  const { data, isLoading } = useQuery({
    queryKey: ["network", wallet ?? null, lens.filter, lens.sort, query],
    queryFn: () =>
      getNetwork({
        data: { wallet, relationship: lens.filter, sort: lens.sort, query, limit: 40 },
      }),
    enabled: !!wallet,
    placeholderData: (prev) => prev,
    refetchInterval: 60_000,
  });

  const summary = data?.summary;
  const rawPeople = useMemo(() => data?.people ?? [], [data]);

  // Curiosity order: the most interesting person first. Activity views keep the
  // server's order so "Recently Active" / "Newest" mean what they say.
  const people = useMemo(() => {
    if (!lens.curiosity || query) return rawPeople;
    return [...rawPeople].sort((a, b) => {
      const ra = storyOf(a).rank;
      const rb = storyOf(b).rank;
      if (rb !== ra) return rb - ra;
      const ta = a.latestActivity ? Date.parse(a.latestActivity.occurredAt) : 0;
      const tb = b.latestActivity ? Date.parse(b.latestActivity.occurredAt) : 0;
      return tb - ta || b.sharedBeliefs - a.sharedBeliefs;
    });
  }, [rawPeople, lens.curiosity, query]);

  // The compact DNA progress — one row, tap for the full overview.
  const counts = {
    twin: summary?.twinCount ?? 0,
    tribe: summary?.tribeCount ?? 0,
    opp: summary?.oppCount ?? 0,
  };
  const decisions = summary?.expressedBeliefs ?? 0;
  const stage = dnaStage({ decisions, hasTwinCandidate: counts.twin > 0 });
  const reveal = dnaReveal(stage, counts);
  const next = decisionsToNextStage(decisions);
  const progress = DNA_STAGE_ORDER.indexOf(stage) / (DNA_STAGE_ORDER.length - 1);
  const dnaLine = useMemo(() => {
    if (!stageAtLeast(stage, "recognizable")) {
      return next
        ? `${next.need} decision${next.need === 1 ? "" : "s"} until your first Tribe.`
        : "Your people are beginning to surface.";
    }
    const parts: string[] = [];
    if (reveal.canNameTwin) parts.push(matchCountLine(counts.twin, "Twin"));
    if (reveal.canNameTribe) parts.push(matchCountLine(counts.tribe, "Tribe member"));
    if (reveal.canNameOpp) parts.push(matchCountLine(counts.opp, "Opp"));
    return parts.length ? parts.join(" · ") : "Keep deciding — your people are surfacing.";
  }, [stage, next, reveal, counts.twin, counts.tribe, counts.opp]);

  if (!wallet) {
    return (
      <div className="pt-4">
        <div className="pb-3 text-[13px] text-[var(--text-muted)]">
          Connect your wallet to find people who see the world like you.
        </div>
        <WalletConnectButton />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Compact DNA progress — never a quarter of the screen. */}
      <button
        type="button"
        onClick={onOpenDna}
        className="mb-2.5 w-full rounded-[10px] px-2.5 py-2 text-left transition-colors hover:bg-[var(--border)]/30"
        style={{ border: "1px solid var(--border)" }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">
            🧬 Conviction DNA
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            {DNA_STAGE_LABEL[stage]}
          </span>
        </div>
        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-[var(--border)]">
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.round(progress * 100)}%`,
              background: "var(--yes)",
              transition: "width .3s ease",
            }}
          />
        </div>
        <div className="num mt-1 text-[11px] text-[var(--text-muted)]">{dnaLine}</div>
      </button>

      {/* One toolbar row: collapsed search + one filter dropdown. */}
      <div className="mb-2.5 flex items-center gap-2">
        {searchOpen ? (
          <div className="flex flex-1 items-center gap-1">
            <input
              autoFocus
              value={rawQuery}
              onChange={(e) => setRawQuery(e.target.value)}
              placeholder="Search people…"
              aria-label="Search people"
              className="w-full rounded-md bg-[var(--surface)] px-2.5 py-1.5 text-[13px] outline-none"
              style={{ border: "1px solid var(--border)" }}
            />
            <button
              type="button"
              onClick={() => {
                setSearchOpen(false);
                setRawQuery("");
              }}
              aria-label="Close search"
              className="shrink-0 px-1 text-[13px] text-[var(--text-muted)] hover:text-[var(--text)]"
            >
              ✕
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label="Search people"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-[14px] text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
            style={{ border: "1px solid var(--border)" }}
          >
            ⌕
          </button>
        )}
        {!searchOpen && (
          <select
            value={lensKey}
            onChange={(e) => setLensKey(e.target.value)}
            aria-label="Filter people"
            className="ml-auto rounded-md bg-[var(--surface)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--text-secondary)]"
            style={{ border: "1px solid var(--border)" }}
          >
            {LENSES.map((l) => (
              <option key={l.key} value={l.key}>
                {l.label}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* People — the product. First person visible immediately. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && people.length === 0 ? (
          <ul className="space-y-2" aria-hidden>
            {Array.from({ length: 8 }).map((_, i) => (
              <li key={i} className="h-16 animate-pulse rounded-[12px] bg-[var(--border)]/40" />
            ))}
          </ul>
        ) : people.length === 0 ? (
          query ? (
            <p className="pt-3 text-[12.5px] text-[var(--text-muted)]">
              No one in your network matches this search.
            </p>
          ) : (
            <EmptyState onExplore={onExplore} />
          )
        ) : (
          <ul className="flex flex-col gap-1.5">
            {people.map((p, i) => (
              <PersonCard
                key={p.wallet}
                p={p}
                spotlight={i === 0 && lens.curiosity && !query}
                selected={selectedPerson?.toLowerCase() === p.wallet.toLowerCase()}
                onSelect={() => onSelectPerson(p.wallet)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * One person, as a story. The most curious person (spotlight) also shows their
 * most recent move, so the top of the list always invites a tap.
 */
function PersonCard({
  p,
  spotlight,
  selected,
  onSelect,
}: {
  p: NetworkPersonRow;
  spotlight: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const s = storyOf(p);
  const act = p.latestActivity;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        aria-label={`${p.displayName}, ${s.stageLabel}. ${s.sentence}`}
        className="block w-full rounded-[12px] p-2.5 text-left transition-colors"
        style={{
          background: spotlight ? toneBg(s.tone) : selected ? "var(--surface)" : "transparent",
          border: `1px solid ${spotlight ? toneFg(s.tone) + "55" : selected ? "var(--border)" : "transparent"}`,
        }}
      >
        <div className="flex items-center gap-2.5">
          {p.avatarUrl ? (
            <img
              src={p.avatarUrl}
              alt=""
              className={`${spotlight ? "h-9 w-9" : "h-8 w-8"} shrink-0 rounded-full object-cover`}
            />
          ) : (
            <span
              className={`${spotlight ? "h-9 w-9 text-[12px]" : "h-8 w-8 text-[11px]"} grid shrink-0 place-items-center rounded-full font-semibold text-white`}
              style={{ background: `hsl(${hueFor(p.wallet)} 45% 45%)` }}
              aria-hidden
            >
              {initialsFor(p.displayName)}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-[var(--text)]">
            {p.displayName}
          </span>
          <span
            className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide"
            style={{ color: toneFg(s.tone), background: toneBg(s.tone) }}
          >
            {s.stageLabel}
          </span>
        </div>

        {/* The one meaningful sentence. */}
        <div className="mt-1.5 pl-[42px] text-[12px] leading-snug text-[var(--text-secondary)]">
          {s.sentence}
        </div>

        {/* Spotlight only: their most recent move, so the top card invites a tap. */}
        {spotlight && act && (
          <div className="mt-1 truncate pl-[42px] text-[11px] text-[var(--text-muted)]">
            Recently {act.action.toLowerCase()} {act.side} · “{act.marketTitle}” ·{" "}
            {ago(act.occurredAt)}
          </div>
        )}
      </button>
    </li>
  );
}

/** No people yet — an invitation, not a dead end. */
function EmptyState({ onExplore }: { onExplore?: () => void }) {
  return (
    <div className="pt-2">
      <div className="text-[15px] font-semibold text-[var(--text)]">Nobody knows you yet.</div>
      <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--text-muted)]">
        Every market you back helps The House find your people.
      </p>
      {onExplore && (
        <button
          type="button"
          onClick={onExplore}
          className="mt-4 rounded-[10px] px-3.5 py-2 text-[12px] font-semibold text-[var(--bg)] transition-transform active:scale-[0.98] motion-reduce:active:scale-100"
          style={{ background: "var(--text)" }}
        >
          Explore Markets
        </button>
      )}
    </div>
  );
}
