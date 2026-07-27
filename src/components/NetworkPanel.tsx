/**
 * LEFT PANEL — "Network" tab. The viewer's relationships with people.
 *
 * Pinned DNA summary → opens the full overview in the center. Below: contextual
 * search, a relationship filter, a sort control, and a full-height person list.
 * Presentation only — getNetwork owns the labels, agreement, sort inputs, and
 * activity; clicking a person opens their profile in the center.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getNetwork, type NetworkPersonRow } from "@/lib/dna.functions";
import { RELATIONSHIP_TEXT, relationshipTone, relationshipAria, ago } from "@/lib/dna-labels";
import { hueFor, initialsFor } from "@/lib/wallet-identity";
import { WalletConnectButton } from "@/components/WalletConnect";

type RelFilter = "all" | "twin" | "tribe" | "opp" | "inverse";
type Sort = "relevant" | "closest" | "active" | "newest";

const FILTERS: { key: RelFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "twin", label: "Twin" },
  { key: "tribe", label: "Tribe" },
  { key: "opp", label: "Opp" },
  { key: "inverse", label: "Inverse" },
];
const SORTS: { key: Sort; label: string }[] = [
  { key: "relevant", label: "Relevant" },
  { key: "closest", label: "Closest" },
  { key: "active", label: "Most active" },
  { key: "newest", label: "Newest" },
];

export function NetworkPanel({
  wallet,
  selectedPerson,
  onSelectPerson,
  onOpenDna,
}: {
  wallet?: string;
  selectedPerson?: string;
  onSelectPerson: (wallet: string) => void;
  onOpenDna: () => void;
}) {
  const [rawQuery, setRawQuery] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RelFilter>("all");
  const [sort, setSort] = useState<Sort>("relevant");

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
    queryKey: ["network", wallet ?? null, filter, sort, query],
    queryFn: () => getNetwork({ data: { wallet, relationship: filter, sort, query, limit: 40 } }),
    enabled: !!wallet,
    // Keep the previous page visible while refetching — never blank the list.
    placeholderData: (prev) => prev,
    refetchInterval: 60_000,
  });

  const summary = data?.summary;
  const people = data?.people ?? [];
  const updating = data?.freshness.status === "updating";

  const summaryLine = useMemo(() => {
    if (!summary) return "";
    const parts = [`${summary.expressedBeliefs} beliefs`];
    if (summary.twinCount) parts.push(`${summary.twinCount} Twin`);
    if (summary.tribeCount) parts.push(`${summary.tribeCount} Tribe`);
    if (summary.oppCount) parts.push(`${summary.oppCount} Opp${summary.oppCount === 1 ? "" : "s"}`);
    return parts.join(" · ");
  }, [summary]);

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
      {/* Pinned DNA summary → opens the overview in the center. */}
      <button
        type="button"
        onClick={onOpenDna}
        className="mb-3 w-full rounded-[12px] px-3 py-2.5 text-left transition-colors hover:bg-[var(--border)]/30"
        style={{ border: "1px solid var(--border)" }}
      >
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
          Your Conviction DNA
        </div>
        <div className="num mt-1 text-[12px] text-[var(--text-secondary)]">
          {summary ? summaryLine : "Building your network…"}
        </div>
        {summary?.strongestAlignedDomain && (
          <div className="mt-1 truncate text-[11px] text-[var(--text-muted)]">
            Closest on {summary.strongestAlignedDomain}
            {summary.strongestOpposedDomain
              ? ` · Most divided on ${summary.strongestOpposedDomain}`
              : ""}
          </div>
        )}
      </button>

      {/* Search */}
      <input
        value={rawQuery}
        onChange={(e) => setRawQuery(e.target.value)}
        placeholder="Search your network"
        aria-label="Search your network"
        className="mb-2 w-full rounded-md bg-[var(--surface)] px-3 py-1.5 text-[13px] outline-none"
        style={{ border: "1px solid var(--border)" }}
      />

      {/* Filter + sort */}
      <div className="mb-2 flex flex-wrap items-center gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
              filter === f.key
                ? "bg-[var(--text)] text-[var(--bg)]"
                : "text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
            style={filter === f.key ? undefined : { border: "1px solid var(--border)" }}
          >
            {f.label}
          </button>
        ))}
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          aria-label="Sort network"
          className="ml-auto rounded-md bg-[var(--surface)] px-2 py-1 text-[11px] text-[var(--text-secondary)]"
          style={{ border: "1px solid var(--border)" }}
        >
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {updating && (
        <div
          className="pb-1 text-[10px] uppercase tracking-wide text-[var(--text-muted)]"
          role="status"
        >
          Updating your network…
        </div>
      )}

      {/* Person list */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && people.length === 0 ? (
          <ul className="space-y-2" aria-hidden>
            {Array.from({ length: 8 }).map((_, i) => (
              <li key={i} className="h-14 animate-pulse rounded-[12px] bg-[var(--border)]/40" />
            ))}
          </ul>
        ) : people.length === 0 ? (
          <p className="pt-3 text-[12px] text-[var(--text-muted)]">
            {query
              ? "No one in your network matches this search."
              : (summary?.expressedBeliefs ?? 0) < 5
                ? "Your DNA is still forming. Express at least 5 beliefs to begin finding people."
                : "Your DNA is active. No strong relationship yet — more beliefs will improve your matches."}
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {people.map((p) => (
              <PersonRow
                key={p.wallet}
                p={p}
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

function PersonRow({
  p,
  selected,
  onSelect,
}: {
  p: NetworkPersonRow;
  selected: boolean;
  onSelect: () => void;
}) {
  const tone = relationshipTone(p.relationship);
  const badge = RELATIONSHIP_TEXT[p.relationship];
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        aria-label={relationshipAria(p.displayName, p.relationship, p.agreement, p.sharedBeliefs)}
        className="block w-full rounded-[12px] p-2.5 text-left transition-colors"
        style={{
          background: selected ? "var(--surface)" : "transparent",
          border: `1px solid ${selected ? "var(--border)" : "transparent"}`,
        }}
      >
        <div className="flex items-center gap-2">
          {p.avatarUrl ? (
            <img src={p.avatarUrl} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
          ) : (
            <span
              className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-white"
              style={{ background: `hsl(${hueFor(p.wallet)} 45% 45%)` }}
              aria-hidden
            >
              {initialsFor(p.displayName)}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text)]">
            {p.displayName}
          </span>
          <span
            className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
            style={{ color: tone.fg, background: tone.bg }}
          >
            {badge}
          </span>
        </div>
        <div className="num mt-1 pl-9 text-[11px] text-[var(--text-secondary)]">
          {p.agreement}% · {p.sharedBeliefs} shared
        </div>
        {(p.strongestAlignedDomain || p.strongestOpposedDomain) && (
          <div className="mt-0.5 truncate pl-9 text-[10px] text-[var(--text-muted)]">
            {p.relationship === "opp" || p.relationship === "inverse"
              ? p.strongestOpposedDomain
                ? `Most divided: ${p.strongestOpposedDomain.name}`
                : ""
              : p.strongestAlignedDomain
                ? `${p.strongestAlignedDomain.name} · ${p.strongestAlignedDomain.agreement}%`
                : ""}
          </div>
        )}
        {p.latestActivity && (
          <div className="mt-0.5 truncate pl-9 text-[10px] text-[var(--text-muted)]">
            {p.latestActivity.action} {p.latestActivity.side} · {ago(p.latestActivity.occurredAt)}
          </div>
        )}
      </button>
    </li>
  );
}
