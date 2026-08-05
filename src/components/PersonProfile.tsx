/**
 * COMPARE DNA — you ↔ this person, told as a social story, not a stat sheet.
 *
 * The magic isn't the percentage; it's seeing exactly WHICH beliefs connect two
 * people. So the header states the relationship honestly (earned Twin/Opp, a
 * mature % with its evidence, or early counts), then the page shows your
 * strongest common ground and divide, the markets you both backed, the ones you
 * split on, and — where it exists — a per-topic breakdown.
 *
 * Presentation only: getPersonProfile owns the comparison; the pure
 * src/domain/relationship engine turns it into one consistent story.
 */
import { useQuery } from "@tanstack/react-query";
import { getPersonProfile } from "@/lib/dna.functions";
import { ago } from "@/lib/dna-labels";
import { hueFor, initialsFor } from "@/lib/wallet-identity";
import { FollowButton } from "@/components/FollowButton";
import {
  presentRelationship,
  relationshipBreakdown,
  relationshipTopicLine,
  sharedDna,
} from "@/domain/relationship";

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

  const rel = presentRelationship({
    agreement: data.agreement,
    sharedConvictions: data.sharedBeliefs,
    together: data.together,
    apart: data.apart,
    topicCount: data.topicCount,
    strongestAlignedTopic: data.alignedDomains[0]?.domain ?? null,
    strongestOpposedTopic: data.opposedDomains[0]?.domain ?? null,
  });
  // THE RELATIONSHIP IS THE HEADLINE. The percentage supports it; the shared
  // convictions validate it. A number about a person is a statistic; a person
  // with a number behind them is a relationship.
  const dna = data.hasViewer ? sharedDna(rel) : null;
  const dnaColor =
    dna?.tone === "opposed" ? "var(--no)" : dna?.tone === "aligned" ? "var(--yes)" : "var(--text)";

  return (
    <div className="space-y-6">
      {/* Header — YOU + PERSON, and the relationship in one honest line. */}
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
          <div className="truncate text-lg font-semibold text-[var(--text)]">
            {data.displayName}
          </div>
          {dna ? (
            <>
              {/* LEAD — the relationship, in the largest type on the header. */}
              <div
                className="mt-0.5 text-[15px] font-semibold leading-tight"
                style={{ color: dnaColor }}
              >
                {dna.lead}
              </div>
              {/* SCORE — supports the relationship; absent when unearned. */}
              {dna.score && (
                <div className="num mt-0.5 text-[13px] text-[var(--text-secondary)]">
                  {dna.score}
                </div>
              )}
              {/* EVIDENCE — what the claim rests on. Never omitted. */}
              <div className="mt-0.5 text-[12px] text-[var(--text-muted)]">{dna.evidence}</div>
            </>
          ) : (
            <div className="mt-0.5 text-[12px] text-[var(--text-muted)]">{data.summary}</div>
          )}
        </div>
        {/* Follow sits beside the inferred relationship, not instead of it: the
            DNA line says what the data concluded, this says what you decided. */}
        <FollowButton person={wallet} viewer={viewer} />
      </header>

      {data.hasViewer && (
        <>
          {/* Together / Apart — the shape of the relationship at a glance. */}
          <div className="grid grid-cols-2 gap-3">
            <Stat
              label="Together"
              value={data.together}
              tone="var(--yes)"
              sub={
                rel.strongestAlignedTopic ? `Strongest: ${rel.strongestAlignedTopic}` : undefined
              }
            />
            <Stat
              label="Apart"
              value={data.apart}
              tone="var(--no)"
              sub={
                rel.strongestOpposedTopic ? `Strongest: ${rel.strongestOpposedTopic}` : undefined
              }
            />
          </div>
          {rel.tier === "mature" && relationshipTopicLine(rel) && (
            <p className="text-[12px] text-[var(--text-muted)]">
              {relationshipBreakdown(rel)} · {relationshipTopicLine(rel)}
            </p>
          )}

          {/* Per-topic breakdown, where the evidence exists. */}
          {(data.alignedDomains.length > 0 || data.opposedDomains.length > 0) && (
            <section>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                By topic
              </h3>
              <ul className="space-y-1.5">
                {[...data.alignedDomains, ...data.opposedDomains]
                  .sort((a, b) => b.agreement - a.agreement)
                  .map((d) => (
                    <TopicRow key={d.domain} domain={d.domain} agreement={d.agreement} />
                  ))}
              </ul>
            </section>
          )}

          {/* The 23andMe moment: the actual beliefs that connect or divide you. */}
          <BeliefSection
            title="You both backed"
            markets={data.sharedBoth}
            onSelectMarket={onSelectMarket}
            render={(m) => (
              <>
                Both <SideTag side={m.viewerSide} />
              </>
            )}
          />
          <BeliefSection
            title="You split on"
            markets={data.opposing}
            onSelectMarket={onSelectMarket}
            render={(m) => (
              <>
                You <SideTag side={m.viewerSide} /> · them <SideTag side={m.personSide} />
              </>
            )}
          />
        </>
      )}

      {data.recentActivity.length > 0 && (
        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Recent activity
          </h3>
          {data.recentActivity.map((a) => (
            <button
              key={a.marketId}
              type="button"
              onClick={() => onSelectMarket(Number(a.marketId))}
              className="block w-full rounded-lg px-2 py-2 text-left text-[13px] transition-colors hover:bg-[var(--surface-2)]"
            >
              <span className="text-[var(--text)]">{data.displayName}</span> {a.action}{" "}
              <SideTag side={a.side} /> ·{" "}
              <span className="text-[var(--text-muted)]">{a.marketTitle}</span>{" "}
              <span className="text-[var(--text-muted)]">{ago(a.occurredAt)}</span>
            </button>
          ))}
        </section>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: number;
  tone: string;
  sub?: string;
}) {
  return (
    <div
      className="rounded-[12px] px-3.5 py-2.5"
      style={{ border: "1px solid var(--border)", background: "var(--surface)" }}
    >
      <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
        {label}
      </div>
      <div className="num text-[22px] font-semibold leading-tight" style={{ color: tone }}>
        {value}
      </div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">{sub}</div>}
    </div>
  );
}

/** One topic as a mini alignment bar — green toward aligned, red toward opposite. */
function TopicRow({ domain, agreement }: { domain: string; agreement: number }) {
  const aligned = agreement >= 50;
  const tone = aligned ? "var(--yes)" : "var(--no)";
  const label = aligned ? `${agreement}% aligned` : `${100 - agreement}% opposite`;
  return (
    <li className="flex items-center gap-3">
      <span className="w-24 shrink-0 truncate text-[13px] text-[var(--text)]">{domain}</span>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--bg)]">
        <span
          className="block h-full rounded-full"
          style={{ width: `${Math.max(4, agreement)}%`, background: tone }}
        />
      </span>
      <span
        className="num w-20 shrink-0 text-right text-[12px] font-semibold"
        style={{ color: tone }}
      >
        {label}
      </span>
    </li>
  );
}

function SideTag({ side }: { side: "YES" | "NO" }) {
  return (
    <span style={{ color: side === "YES" ? "var(--yes)" : "var(--no)" }} className="font-semibold">
      {side}
    </span>
  );
}

function BeliefSection({
  title,
  markets,
  onSelectMarket,
  render,
}: {
  title: string;
  markets: {
    marketId: string;
    title: string;
    viewerSide: "YES" | "NO";
    personSide: "YES" | "NO";
  }[];
  onSelectMarket: (id: number) => void;
  render: (m: { viewerSide: "YES" | "NO"; personSide: "YES" | "NO" }) => React.ReactNode;
}) {
  if (markets.length === 0) return null;
  return (
    <section>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        {title} · {markets.length}
      </h3>
      <ul className="space-y-0.5">
        {markets.map((m) => (
          <li key={m.marketId}>
            <button
              type="button"
              onClick={() => onSelectMarket(Number(m.marketId))}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--surface-2)]"
            >
              <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text)]">
                {m.title}
              </span>
              <span className="shrink-0 text-[11px] text-[var(--text-muted)]">{render(m)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
