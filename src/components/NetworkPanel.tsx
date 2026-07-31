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
import {
  DNA_STAGE_HEADLINE,
  DNA_STAGE_LABEL,
  decisionsToNextStage,
  dnaReveal,
  dnaStage,
  firstMeaningfulIndex,
  matchCountLine,
  stageAtLeast,
} from "@/domain/conviction-dna";

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

  // The one continuous game: real decisions earn a STAGE, and the stage decides
  // what may honestly be named. No calibration gate, no percentage.
  const counts = {
    twin: summary?.twinCount ?? 0,
    tribe: summary?.tribeCount ?? 0,
    opp: summary?.oppCount ?? 0,
  };
  const stage = dnaStage({
    decisions: summary?.expressedBeliefs ?? 0,
    hasTwinCandidate: counts.twin > 0,
  });
  const reveal = dnaReveal(stage, counts);
  const nameable = stageAtLeast(stage, "recognizable");
  const next = decisionsToNextStage(summary?.expressedBeliefs ?? 0);

  // Named counts only — never surface a relationship the evidence can't back.
  const countLine = useMemo(() => {
    if (!nameable) return "Keep deciding — your people will surface as your pattern sharpens.";
    const parts: string[] = [];
    if (reveal.canNameTwin) parts.push(matchCountLine(counts.twin, "Twin"));
    if (reveal.canNameTribe) parts.push(matchCountLine(counts.tribe, "Tribe member"));
    if (reveal.canNameOpp) parts.push(matchCountLine(counts.opp, "Opp"));
    return parts.length ? parts.join(" · ") : "No strong matches named yet — keep deciding.";
  }, [nameable, reveal, counts.twin, counts.tribe, counts.opp]);

  // The single most meaningful person to meet first (only in the unfiltered view).
  const revealIdx = filter === "all" && !query ? firstMeaningfulIndex(people, stage) : -1;
  const firstPerson = revealIdx >= 0 ? people[revealIdx] : null;

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
      {/* Persistent DNA progress → the stage you've earned, and what it lets us
        honestly name. Opens the full overview in the center. */}
      <button
        type="button"
        onClick={onOpenDna}
        className="mb-3 w-full rounded-[12px] px-3 py-2.5 text-left transition-colors hover:bg-[var(--border)]/30"
        style={{ border: "1px solid var(--border)" }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
            Your Conviction DNA
          </span>
          <span
            className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
            style={{
              color: "var(--yes)",
              background: "color-mix(in oklab, var(--yes) 14%, transparent)",
            }}
          >
            {DNA_STAGE_LABEL[stage]}
          </span>
        </div>
        <p className="mt-1.5 text-[12.5px] leading-snug text-[var(--text-secondary)]">
          {summary ? DNA_STAGE_HEADLINE[stage] : "Reading your convictions…"}
        </p>
        <div className="num mt-1 text-[11px] text-[var(--text-muted)]">{countLine}</div>
        {next && (
          <div className="mt-1 text-[11px] text-[var(--text-muted)]">
            {next.need} more {next.need === 1 ? "decision" : "decisions"} to{" "}
            {DNA_STAGE_LABEL[next.next]}
          </div>
        )}
      </button>

      {/* Meet the first meaningful person the moment the evidence is there. */}
      {firstPerson && (
        <FirstMatchCard p={firstPerson} onSelect={() => onSelectPerson(firstPerson.wallet)} />
      )}

      {!nameable ? (
        // Honest forming state — no premature people, no fake matches.
        <p className="pt-3 text-[12.5px] leading-relaxed text-[var(--text-muted)]">
          Your first matches appear once your pattern is recognizable. Keep making calls in the feed
          — every YES, NO, or PASS sharpens who you are.
        </p>
      ) : (
        <>
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
                  : "No strong relationship yet — more calls in the feed will surface your people."}
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
        </>
      )}
    </div>
  );
}

/**
 * The first meaningful person, spotlighted — the moment there's enough evidence
 * to mean it. A warm invitation to start exploring people, not a data row.
 */
function FirstMatchCard({ p, onSelect }: { p: NetworkPersonRow; onSelect: () => void }) {
  const tone = relationshipTone(p.relationship);
  const badge = RELATIONSHIP_TEXT[p.relationship];
  const lead =
    p.relationship === "twin"
      ? "Your closest match is here"
      : p.relationship === "opp" || p.relationship === "inverse"
        ? "Someone who sees it the other way"
        : "Someone who thinks like you";
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`${lead}: ${p.displayName}`}
      className="mb-3 w-full rounded-[14px] p-3 text-left transition-transform hover:-translate-y-px"
      style={{
        border: "1px solid color-mix(in oklab, var(--yes) 30%, var(--border))",
        background: "color-mix(in oklab, var(--yes) 8%, transparent)",
      }}
    >
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
        {lead}
      </div>
      <div className="mt-1.5 flex items-center gap-2.5">
        {p.avatarUrl ? (
          <img src={p.avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
        ) : (
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[12px] font-semibold text-white"
            style={{ background: `hsl(${hueFor(p.wallet)} 45% 45%)` }}
            aria-hidden
          >
            {initialsFor(p.displayName)}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-[var(--text)]">
          {p.displayName}
        </span>
        <span
          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
          style={{ color: tone.fg, background: tone.bg }}
        >
          {badge}
        </span>
      </div>
      <div className="num mt-1.5 text-[11px] text-[var(--text-secondary)]">
        {p.agreement}% aligned · {p.sharedBeliefs} shared · Tap to explore
      </div>
    </button>
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
            className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
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
