/**
 * YOUR PEOPLE — the belonging surface.
 *
 * Two questions, answered simply: who stands with me (Tribe), and who takes the
 * other side (Rivals). No category dropdown, no "still forming" on every row —
 * uncertainty lives ONCE, at the page. Every card gives an insight even early:
 * honest counts ("3 together · 1 apart") until there's enough evidence for a
 * percentage, and Twin/Opp only when truly earned.
 *
 * Presentation only: getNetwork owns the relationships + evidence; the pure
 * src/domain/relationship engine turns them into one consistent social story.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getNetwork, type NetworkPersonRow } from "@/lib/dna.functions";
import { ago } from "@/lib/dna-labels";
import { hueFor, initialsFor } from "@/lib/wallet-identity";
import { WalletConnectButton } from "@/components/WalletConnect";
import {
  presentRelationship,
  relationshipInsight,
  relationshipSupport,
  relationshipBreakdown,
  relationshipTopicLine,
  relationshipLabel,
  sortTribe,
  sortRivals,
  dnaMaturity,
  type RelationshipPresentation,
} from "@/domain/relationship";

type Tab = "tribe" | "rivals";

/** Present one person, keeping the row for the UI. */
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

const toneColor = (tone: "aligned" | "opposed" | "neutral"): string =>
  tone === "aligned" ? "var(--yes)" : tone === "opposed" ? "var(--no)" : "var(--text-secondary)";

export function NetworkPanel({
  wallet,
  selectedPerson,
  onSelectPerson,
  onOpenDna,
  onExplore,
  onCount,
}: {
  wallet?: string;
  selectedPerson?: string;
  onSelectPerson: (wallet: string) => void;
  /** Opens the aggregate Conviction DNA overview (topics, circles) in the center. */
  onOpenDna?: () => void;
  /** Empty-state CTA — take me to the markets. */
  onExplore?: () => void;
  /** Reports the number of placed relationships to the tab strip. */
  onCount?: (n: number) => void;
}) {
  const [tab, setTab] = useState<Tab>("tribe");
  const [rawQuery, setRawQuery] = useState("");
  const [query, setQuery] = useState("");

  // Debounce search into the server query (server stays authoritative for search).
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => setQuery(rawQuery.trim()), 200);
    return () => {
      if (t.current) clearTimeout(t.current);
    };
  }, [rawQuery]);

  // One call returns everyone with meaningful overlap; the client splits Tribe
  // vs Rivals so switching tabs never refetches.
  const { data, isLoading } = useQuery({
    queryKey: ["network", wallet ?? null, "all", "relevant", query],
    queryFn: () =>
      getNetwork({ data: { wallet, relationship: "all", sort: "relevant", query, limit: 60 } }),
    enabled: !!wallet,
    placeholderData: (prev) => prev,
    refetchInterval: 60_000,
  });

  const views = useMemo(() => (data?.people ?? []).map(present), [data]);
  const tribe = useMemo(
    () => views.filter((v) => v.rel.group === "tribe").sort((a, b) => sortTribe(a.rel, b.rel)),
    [views],
  );
  const rivals = useMemo(
    () => views.filter((v) => v.rel.group === "rival").sort((a, b) => sortRivals(a.rel, b.rel)),
    [views],
  );

  // When searching, show ALL matches (any group) in the active tab so a search
  // is never trapped by placement — but keep the tabs live.
  const searching = query.length > 0;
  const active = tab === "tribe" ? tribe : rivals;
  const list = searching ? views : active;

  const placed = tribe.length + rivals.length;
  useEffect(() => {
    onCount?.(placed);
  }, [placed, onCount]);

  // Page-level DNA maturity — the ONE uncertainty message, never per row.
  const mapped = data?.summary?.expressedBeliefs ?? 0;
  const topicSet = useMemo(() => {
    const s = new Set<string>();
    for (const v of views) {
      if (v.row.strongestAlignedDomain?.name) s.add(v.row.strongestAlignedDomain.name);
      if (v.row.strongestOpposedDomain?.name) s.add(v.row.strongestOpposedDomain.name);
    }
    return s;
  }, [views]);
  const maturity = dnaMaturity(mapped, topicSet.size);

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
      {/* Header — belonging, not analytics. Tap to open the full DNA overview. */}
      <button
        type="button"
        onClick={onOpenDna}
        disabled={!onOpenDna}
        className="mb-2.5 block w-full rounded-[10px] px-1 text-left transition-colors enabled:hover:bg-[var(--surface)]"
      >
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
            Your People
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            {maturity.stage}
          </span>
        </div>
        <p className="mt-1 text-[12px] leading-snug text-[var(--text-secondary)]">
          <span className="num text-[var(--text)]">{maturity.convictionsMapped}</span> convictions
          mapped
          <span className="block text-[var(--text-muted)]">{maturity.note}</span>
        </p>
      </button>

      {/* Tribe / Rivals — a visible segmented control, never a dropdown. */}
      <div
        role="tablist"
        aria-label="Your people"
        className="mb-2.5 flex rounded-full p-0.5"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
      >
        <TabButton
          label="Tribe"
          count={tribe.length}
          active={tab === "tribe"}
          tone="var(--yes)"
          onSelect={() => setTab("tribe")}
        />
        <TabButton
          label="Rivals"
          count={rivals.length}
          active={tab === "rivals"}
          tone="var(--no)"
          onSelect={() => setTab("rivals")}
        />
      </div>

      {/* Tab intro — concise, contextual (not repeated on every card). */}
      {!searching && (
        <p className="mb-2 text-[12px] leading-snug text-[var(--text-secondary)]">
          {tab === "tribe" ? (
            <>
              <span className="font-semibold text-[var(--text)]">You&rsquo;re not alone.</span>{" "}
              People who most consistently stand with you.
            </>
          ) : (
            <>
              <span className="font-semibold text-[var(--text)]">Meet your other side.</span> People
              who consistently take the other side.
            </>
          )}
        </p>
      )}

      {/* Search — keeps the tabs live. */}
      <input
        value={rawQuery}
        onChange={(e) => setRawQuery(e.target.value)}
        placeholder="Search people…"
        aria-label="Search people"
        className="mb-2.5 w-full rounded-md bg-[var(--surface)] px-2.5 py-1.5 text-[13px] outline-none"
        style={{ border: "1px solid var(--border)" }}
      />

      {/* The people. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && list.length === 0 ? (
          <ul className="space-y-2" aria-hidden>
            {Array.from({ length: 8 }).map((_, i) => (
              <li key={i} className="h-16 animate-pulse rounded-[12px] bg-[var(--border)]/40" />
            ))}
          </ul>
        ) : list.length === 0 ? (
          searching ? (
            <p className="pt-3 text-[12.5px] text-[var(--text-muted)]">
              No people match this search.
            </p>
          ) : (
            <EmptyTab tab={tab} onExplore={onExplore} />
          )
        ) : (
          <ul role="tabpanel" className="flex flex-col gap-1">
            {list.map((v, i) => (
              <PersonRow
                key={v.row.wallet}
                v={v}
                isTop={i === 0 && !searching}
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

function TabButton({
  label,
  count,
  active,
  tone,
  onSelect,
}: {
  label: string;
  count: number;
  active: boolean;
  tone: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onSelect}
      className="flex flex-1 items-center justify-center gap-1.5 rounded-full py-1.5 text-[13px] font-semibold transition-colors"
      style={
        active
          ? {
              background: "var(--bg)",
              color: "var(--text)",
              boxShadow: "0 1px 2px rgba(0,0,0,0.15)",
            }
          : { color: "var(--text-muted)" }
      }
    >
      <span>{label}</span>
      {count > 0 && (
        <span
          className="num text-[11px] font-semibold"
          style={{ color: active ? tone : "var(--text-muted)" }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/**
 * One person — every card answers: who, with or against me, on what evidence,
 * and where we connect or divide. Typography over chrome; the whole row opens
 * the Compare DNA profile.
 */
function PersonRow({
  v,
  isTop,
  selected,
  onSelect,
}: {
  v: PersonView;
  isTop: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const { row, rel } = v;
  const label = relationshipLabel(rel, isTop);
  const insight = relationshipInsight(rel);
  const support = relationshipSupport(rel);
  const topic = relationshipTopicLine(rel);
  const isTwin = rel.earnedLabel === "twin";
  const insightColor = rel.group === "rival" ? "var(--no)" : "var(--yes)";

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        aria-label={`${row.displayName}${label ? `, ${label.text}` : ""}. ${insight}, ${support}. Compare DNA.`}
        className="block w-full rounded-[12px] p-2.5 text-left transition-colors hover:bg-[var(--surface)]"
        style={{
          background: selected
            ? "var(--surface)"
            : isTwin
              ? "color-mix(in oklab, var(--yes) 6%, transparent)"
              : "transparent",
          border: `1px solid ${selected ? "var(--border)" : isTwin ? "color-mix(in oklab, var(--yes) 28%, transparent)" : "transparent"}`,
        }}
      >
        <div className="flex items-center gap-2.5">
          {row.avatarUrl ? (
            <img
              src={row.avatarUrl}
              alt=""
              className="h-8 w-8 shrink-0 rounded-full object-cover"
            />
          ) : (
            <span
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white"
              style={{ background: `hsl(${hueFor(row.wallet)} 45% 45%)` }}
              aria-hidden
            >
              {initialsFor(row.displayName)}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-[var(--text)]">
            {row.displayName}
          </span>
          {label && (
            <span
              className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]"
              style={{
                color: toneColor(label.tone),
                background:
                  label.kind === "provisional"
                    ? "transparent"
                    : `color-mix(in oklab, ${toneColor(label.tone)} 14%, transparent)`,
                border:
                  label.kind === "provisional"
                    ? "1px solid var(--border)"
                    : "1px solid transparent",
              }}
            >
              {label.text}
            </span>
          )}
        </div>

        {/* Primary insight + evidence — honest at every stage. */}
        <div className="mt-1.5 flex items-baseline gap-1.5 pl-[42px]">
          <span className="num text-[13px] font-semibold" style={{ color: insightColor }}>
            {insight}
          </span>
          <span className="text-[11px] text-[var(--text-muted)]">· {support}</span>
        </div>

        {/* Mature breakdown, then the topic line. */}
        {rel.tier === "mature" && (
          <div className="num mt-0.5 pl-[42px] text-[11px] text-[var(--text-muted)]">
            {relationshipBreakdown(rel)}
          </div>
        )}
        {topic && (
          <div className="mt-0.5 truncate pl-[42px] text-[11px] text-[var(--text-secondary)]">
            {topic}
          </div>
        )}

        {/* Top card only: their most recent move, so the list invites a tap. */}
        {isTop && row.latestActivity && (
          <div className="mt-1 truncate pl-[42px] text-[11px] text-[var(--text-muted)]">
            Recently {row.latestActivity.action.toLowerCase()} {row.latestActivity.side} ·{" "}
            {ago(row.latestActivity.occurredAt)}
          </div>
        )}
      </button>
    </li>
  );
}

/** Empty Tribe / Rivals — an invitation, never an apology. */
function EmptyTab({ tab, onExplore }: { tab: Tab; onExplore?: () => void }) {
  return (
    <div className="pt-2">
      <div className="text-[14px] font-semibold text-[var(--text)]">
        {tab === "tribe" ? "No clear Tribe yet." : "No clear Rivals yet."}
      </div>
      <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--text-muted)]">
        {tab === "tribe"
          ? "Keep taking sides. We’ll show you who consistently stands with you."
          : "You haven’t shared enough opposing convictions with anyone yet."}
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
