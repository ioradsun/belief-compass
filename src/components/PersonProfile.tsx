/**
 * PROFILE — a person, told through their convictions, and a way onward.
 *
 * The page answers "why should this person matter to me", in the order a
 * curious visitor actually asks it:
 *
 *   NOTICE    who they appear to be, from what they have actually backed
 *   EXPLORE   the convictions that most reveal them
 *   REFLECT   what connects the two of you, and where you differ
 *   DISCOVER  markets worth opening because of them, and people around them
 *
 * WHAT THIS REPLACED, and why none of it is missed:
 *
 *   A relationship PERCENTAGE in the largest type on the page. It told a
 *   visitor they were 68% compatible with a stranger without telling them one
 *   thing they would disagree about.
 *
 *   A Together / Apart stat pair. Two numbers where one sentence — "you agree
 *   on technology and differ on economics" — carries more and reads faster.
 *
 *   A per-topic BAR CHART. A visualisation of a comparison, when the comparison
 *   itself fits in a line.
 *
 *   TWO FLAT LISTS of up to forty shared markets each. Everything at equal
 *   weight is the same as nothing being important. The markets that survive
 *   are the ones that earned a reason.
 *
 * All of it was true. None of it was an introduction. The judgement about what
 * reveals a person lives in @/domain/person-profile — including its refusals,
 * which are most of it; this file only arranges what that module allows.
 */
import { useQuery } from "@tanstack/react-query";
import { getPersonProfile } from "@/lib/dna.functions";
import { ago } from "@/lib/dna-labels";
import { hueFor, initialsFor } from "@/lib/wallet-identity";
import { FollowButton } from "@/components/FollowButton";
import {
  definingConvictions,
  introduction,
  connection,
  exploreThrough,
  type DefiningConviction,
  type DiscoverySuggestion,
} from "@/domain/person-profile";

export function PersonProfile({
  wallet,
  viewer,
  onSelectMarket,
}: {
  wallet: string;
  viewer?: string;
  onSelectMarket: (id: number) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["person", wallet.toLowerCase(), viewer ?? null],
    queryFn: () => getPersonProfile({ data: { wallet, viewer } }),
    refetchInterval: 60_000,
  });

  if (isLoading || !data) {
    return <div className="h-40 animate-pulse rounded-xl bg-[var(--surface-2)]" />;
  }

  const intro = introduction(data.positions, { marketsParticipated: data.positions.length });
  const defining = definingConvictions(data.positions, data.changes);
  const link = connection({
    sharedMarkets: data.sharedBeliefs,
    together: data.together,
    apart: data.apart,
    alignedTopics: data.alignedDomains.map((d) => d.domain),
    opposedTopics: data.opposedDomains.map((d) => d.domain),
    viewerMedianDays: data.viewerMedianDays,
    personMedianDays: data.personMedianDays,
  });
  const explore = exploreThrough(defining, {
    agreed: data.sharedBoth.map((m) => ({ marketId: Number(m.marketId), title: m.title })),
    opposed: data.opposing.map((m) => ({
      marketId: Number(m.marketId),
      title: m.title,
      personSide: m.personSide,
      viewerSide: m.viewerSide,
    })),
  });

  return (
    <div className="space-y-7">
      {/* ── NOTICE ─────────────────────────────────────────────────────────
          A name, a face, and two sentences about what they have backed. No
          score: a number here would be the first thing read and the least
          useful thing said. */}
      <header className="flex items-start gap-3">
        {data.avatarUrl ? (
          <img
            src={data.avatarUrl}
            alt=""
            className="h-12 w-12 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span
            className="grid h-12 w-12 shrink-0 place-items-center rounded-full text-sm font-semibold text-white"
            style={{ background: `hsl(${hueFor(data.wallet)} 45% 45%)` }}
            aria-hidden
          >
            {initialsFor(data.displayName)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold text-[var(--text)]">{data.displayName}</h1>
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-secondary)]">
            {intro.lines.join(" ")}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <FollowButton person={wallet} viewer={viewer} />
          {/* Say what following DOES, once, and only where it is not obvious. */}
          <span className="max-w-[9rem] text-right text-[10px] leading-tight text-[var(--text-muted)]">
            Surfaces markets connected to them
          </span>
        </div>
      </header>

      {/* ── EXPLORE ────────────────────────────────────────────────────────── */}
      {defining.length > 0 && (
        <section>
          <SectionTitle>Convictions that define them</SectionTitle>
          <ul className="space-y-2">
            {defining.map((d) => (
              <li key={`${d.kind}:${d.marketId}`}>
                <DefiningRow c={d} onSelect={onSelectMarket} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── REFLECT ─────────────────────────────────────────────────────────
          Only for a signed-in visitor: with no viewer there is no relationship
          to describe, and an empty "what connects you" is worse than none. */}
      {data.hasViewer && (
        <section>
          <SectionTitle>What connects you</SectionTitle>
          <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">
            {link.lines.join(" ")}
          </p>
        </section>
      )}

      {/* ── DISCOVER ───────────────────────────────────────────────────────
          The point of the page. Every row states why it is here, in terms of
          this person — never "recommended for you". */}
      {explore.length > 0 && (
        <section>
          <SectionTitle>Explore through them</SectionTitle>
          <ul className="space-y-0.5">
            {explore.map((s) => (
              <li key={s.marketId}>
                <SuggestionRow s={s} onSelect={onSelectMarket} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── SUPPORTING ──────────────────────────────────────────────────────
          Evidence, not identity, so it sits last and stays quiet. */}
      <section className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--text-muted)]">
        <span>
          <span className="num text-[var(--text-secondary)]">{data.positions.length}</span> active{" "}
          {data.positions.length === 1 ? "conviction" : "convictions"}
        </span>
        {data.personMedianDays != null && data.personMedianDays > 0 && (
          <span>
            typically held{" "}
            <span className="num text-[var(--text-secondary)]">
              {Math.round(data.personMedianDays)}
            </span>{" "}
            days
          </span>
        )}
        {data.recentActivity.map((a) => (
          <button
            key={a.marketId}
            type="button"
            onClick={() => onSelectMarket(Number(a.marketId))}
            className="underline decoration-dotted underline-offset-2 transition-colors hover:text-[var(--text)]"
          >
            last active {ago(a.occurredAt)}
          </button>
        ))}
      </section>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 text-[11px] font-semibold tracking-wide text-[var(--text-muted)] uppercase">
      {children}
    </h2>
  );
}

/**
 * One defining conviction — a heading, the question, the evidence.
 *
 * Deliberately a whole tappable block rather than a list row: these are the
 * invitations, and the question needs room to be read rather than truncated.
 */
function DefiningRow({ c, onSelect }: { c: DefiningConviction; onSelect: (id: number) => void }) {
  const tone =
    c.side === "YES" ? "var(--yes)" : c.side === "NO" ? "var(--no)" : "var(--text-muted)";
  return (
    <button
      type="button"
      onClick={() => onSelect(c.marketId)}
      className="block w-full rounded-[12px] px-3.5 py-3 text-left transition-colors hover:bg-[var(--surface-2)]"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
    >
      <span
        className="block text-[10px] font-semibold tracking-[0.1em] uppercase"
        style={{ color: tone }}
      >
        {c.label}
      </span>
      <span className="mt-1 block text-[14px] leading-snug font-medium text-[var(--text)]">
        {c.title}
      </span>
      <span className="num mt-1 block text-[12px] text-[var(--text-secondary)]">{c.detail}</span>
    </button>
  );
}

function SuggestionRow({
  s,
  onSelect,
}: {
  s: DiscoverySuggestion;
  onSelect: (id: number) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(s.marketId)}
      className="block w-full rounded-lg px-2 py-2 text-left transition-colors hover:bg-[var(--surface-2)]"
    >
      <span className="block text-[13px] leading-snug text-[var(--text)]">{s.title}</span>
      <span className="mt-0.5 block text-[11px] text-[var(--text-muted)]">{s.why}</span>
    </button>
  );
}
