/**
 * YOUR PEOPLE — one list at a time (Tribe or Rivals, chosen by the parent tabs).
 *
 * Every row answers, at a glance and without wrapping: who, how aligned (a
 * meter), and how much evidence (one count). No duplicated lines, no per-row
 * "still forming", no chip on rows the tab already names — Twin/Opp only when
 * earned. Uncertainty is one quiet line at the top.
 *
 * Presentation only: getNetwork owns the data; the pure src/domain/relationship
 * engine turns it into one honest story.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { networkQO } from "@/lib/network-query";
import { type NetworkPersonRow } from "@/lib/dna.functions";
import { hueFor, initialsFor } from "@/lib/wallet-identity";
import { WalletConnectButton } from "@/components/WalletConnect";
import {
  presentRelationship,
  relationshipLabel,
  sortTribe,
  sortRivals,
  dnaMaturity,
  DNA_STAGE,
  type RelationshipPresentation,
} from "@/domain/relationship";

type Group = "tribe" | "rivals";

interface PersonView {
  row: NetworkPersonRow;
  rel: RelationshipPresentation;
}

const present = (row: NetworkPersonRow): PersonView => ({
  row,
  rel: presentRelationship({
    agreement: row.agreement,
    sharedConvictions: row.sharedBeliefs,
    together: row.together,
    apart: row.apart,
    topicCount: row.topicCount,
    strongestAlignedTopic: row.strongestAlignedDomain?.name ?? null,
    strongestOpposedTopic: row.strongestOpposedDomain?.name ?? null,
  }),
});

export function NetworkPanel({
  wallet,
  group,
  selectedPerson,
  onSelectPerson,
  onCounts,
  onOpenDna,
  onExplore,
}: {
  wallet?: string;
  /** Which list this panel shows — chosen by the parent's top-level tabs. */
  group: Group;
  selectedPerson?: string;
  onSelectPerson: (wallet: string) => void;
  /** Reports both group sizes so the parent tabs can show counts. */
  onCounts?: (c: { tribe: number; rivals: number }) => void;
  /** Opens the full Conviction DNA view — reached from the maturity meter. */
  onOpenDna?: () => void;
  onExplore?: () => void;
}) {
  const [rawQuery, setRawQuery] = useState("");
  const [query, setQuery] = useState("");

  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => setQuery(rawQuery.trim()), 200);
    return () => {
      if (t.current) clearTimeout(t.current);
    };
  }, [rawQuery]);

  // One call returns everyone with overlap; split client-side so the parent's
  // tab switch never refetches.
  const { data, isLoading } = useQuery(networkQO(wallet, query));

  const views = useMemo(() => (data?.people ?? []).map(present), [data]);
  const tribe = useMemo(
    () => views.filter((v) => v.rel.group === "tribe").sort((a, b) => sortTribe(a.rel, b.rel)),
    [views],
  );
  const rivals = useMemo(
    () => views.filter((v) => v.rel.group === "rival").sort((a, b) => sortRivals(a.rel, b.rel)),
    [views],
  );

  useEffect(() => {
    onCounts?.({ tribe: tribe.length, rivals: rivals.length });
  }, [tribe.length, rivals.length, onCounts]);

  const searching = query.length > 0;
  const active = group === "tribe" ? tribe : rivals;
  const list = searching ? views : active;

  // The ONE uncertainty line — a thin progress meter toward a well-defined DNA.
  const mapped = data?.summary?.expressedBeliefs ?? 0;
  const topics = useMemo(() => {
    const s = new Set<string>();
    for (const v of views) {
      if (v.row.strongestAlignedDomain?.name) s.add(v.row.strongestAlignedDomain.name);
      if (v.row.strongestOpposedDomain?.name) s.add(v.row.strongestOpposedDomain.name);
    }
    return s.size;
  }, [views]);
  const maturity = dnaMaturity(mapped, topics);
  const progress = Math.min(1, mapped / DNA_STAGE.defined);

  if (!wallet) {
    return (
      <div className="pt-4">
        <div className="pb-3 text-[13px] text-[var(--text-muted)]">
          Connect your wallet to find the people who stand with you.
        </div>
        <WalletConnectButton />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Your DNA — one quiet meter, tappable into the full breakdown. No stage
          jargon: sharpening while it forms, "mapped" once it's defined. */}
      {mapped > 0 && (
        <button
          type="button"
          onClick={onOpenDna}
          disabled={!onOpenDna}
          className="mb-2.5 w-full rounded-[8px] px-1 py-1 text-left transition-colors enabled:hover:bg-[var(--surface)] disabled:cursor-default"
          aria-label="Open your Conviction DNA"
        >
          <div className="flex items-baseline justify-between text-[11px]">
            <span className="text-[var(--text-secondary)]">
              <span className="num text-[var(--text)]">{mapped}</span>{" "}
              {maturity.moreToSharpen > 0 ? "convictions mapped" : "in your DNA"}
            </span>
            <span className="text-[var(--text-muted)]">
              {maturity.moreToSharpen > 0 ? `${maturity.moreToSharpen} to sharpen` : "View DNA ›"}
            </span>
          </div>
          {maturity.moreToSharpen > 0 && (
            <div className="mt-1 h-0.5 w-full overflow-hidden rounded-full bg-[var(--border)]">
              <div
                className="h-full rounded-full bg-[var(--yes)]"
                style={{ width: `${Math.round(progress * 100)}%`, transition: "width .3s ease" }}
              />
            </div>
          )}
        </button>
      )}

      <input
        value={rawQuery}
        onChange={(e) => setRawQuery(e.target.value)}
        placeholder="Search people…"
        aria-label="Search people"
        className="mb-2.5 w-full rounded-md bg-[var(--surface)] px-2.5 py-1.5 text-[13px] outline-none"
        style={{ border: "1px solid var(--border)" }}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && list.length === 0 ? (
          <ul className="space-y-1.5" aria-hidden>
            {Array.from({ length: 8 }).map((_, i) => (
              <li key={i} className="h-12 animate-pulse rounded-[10px] bg-[var(--border)]/40" />
            ))}
          </ul>
        ) : list.length === 0 ? (
          searching ? (
            <p className="pt-3 text-[12.5px] text-[var(--text-muted)]">
              No people match this search.
            </p>
          ) : (
            <EmptyTab group={group} onExplore={onExplore} />
          )
        ) : (
          <ul className="flex flex-col">
            {list.map((v) => (
              <PersonRow
                key={v.row.wallet}
                v={v}
                selected={selectedPerson?.toLowerCase() === v.row.wallet.toLowerCase()}
                onSelect={() => onSelectPerson(v.row.wallet)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * One person in two lines: name (+ earned chip only), then a meter + one count.
 * The meter's fill is the alignment (green together / red apart); the number is
 * the evidence. Nothing wraps; nothing repeats.
 */
function PersonRow({
  v,
  selected,
  onSelect,
}: {
  v: PersonView;
  selected: boolean;
  onSelect: () => void;
}) {
  const { row, rel } = v;
  const label = relationshipLabel(rel);
  const earned = label?.kind === "earned" ? label : null;
  const rival = rel.group === "rival";
  const tone = rival ? "var(--no)" : "var(--yes)";


  // The value: mature leads with the %, low shows the shared count.
  const value = rel.tier === "mature" ? `${rival ? rel.oppositionPct : rel.alignmentPct}%` : null;

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        aria-label={`${row.displayName}${earned ? `, ${earned.text}` : ""}. ${
          rival ? rel.oppositionPct + "% opposite" : rel.alignmentPct + "% aligned"
        }, ${rel.sharedConvictions} shared.`}
        className="flex w-full items-center gap-2.5 rounded-[10px] px-2 py-2 text-left transition-colors hover:bg-[var(--surface)]"
        style={selected ? { background: "var(--surface)" } : undefined}
      >
        {row.avatarUrl ? (
          <img src={row.avatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
        ) : (
          <span
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white"
            style={{ background: `hsl(${hueFor(row.wallet)} 45% 45%)` }}
            aria-hidden
          >
            {initialsFor(row.displayName)}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-[var(--text)]">
              {row.displayName}
            </span>
            {earned && (
              <span
                className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em]"
                style={{ color: tone, background: `color-mix(in oklab, ${tone} 16%, transparent)` }}
              >
                {earned.text}
              </span>
            )}
          </span>
          <span className="mt-1 flex items-center gap-2">
            {value && (
              <span className="num text-[12px] font-semibold" style={{ color: tone }}>
                {value}
              </span>
            )}
            <span className="num truncate text-[11px] text-[var(--text-muted)]">
              {rel.sharedConvictions} Convictions Align
            </span>
          </span>

        </span>
      </button>
    </li>
  );
}

function EmptyTab({ group, onExplore }: { group: Group; onExplore?: () => void }) {
  return (
    <div className="pt-2">
      <div className="text-[14px] font-semibold text-[var(--text)]">
        {group === "tribe" ? "No Tribe yet." : "No Rivals yet."}
      </div>
      <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--text-muted)]">
        {group === "tribe"
          ? "Keep taking sides — we’ll show who stands with you."
          : "Take sides others oppose, and they’ll appear here."}
      </p>
      {onExplore && (
        <button
          type="button"
          onClick={onExplore}
          className="mt-4 rounded-[10px] px-3.5 py-2 text-[12px] font-semibold text-[var(--bg)] transition-transform active:scale-[0.98] motion-reduce:active:scale-100"
          style={{ background: "var(--text)" }}
        >
          Explore markets
        </button>
      )}
    </div>
  );
}
