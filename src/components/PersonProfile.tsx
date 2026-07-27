/**
 * CENTER — person profile. Explains "me ↔ person", mirroring market detail's
 * hierarchy: relationship summary → strongest domains → shared beliefs → opposing
 * beliefs → recent activity. Server-owned via getPersonProfile; market rows open
 * the market in the center.
 */
import { useQuery } from "@tanstack/react-query";
import { getPersonProfile } from "@/lib/dna.functions";
import { RELATIONSHIP_TEXT, EVIDENCE_TEXT, relationshipTone, ago } from "@/lib/dna-labels";
import { hueFor, initialsFor } from "@/lib/wallet-identity";

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
    return <div className="h-40 animate-pulse rounded-xl bg-[var(--border)]/40" />;
  }

  const tone = relationshipTone(data.relationship);
  const rel = RELATIONSHIP_TEXT[data.relationship];

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex items-center gap-3">
        {data.avatarUrl ? (
          <img src={data.avatarUrl} alt="" className="h-12 w-12 rounded-full object-cover" />
        ) : (
          <span
            className="grid h-12 w-12 place-items-center rounded-full text-sm font-semibold text-white"
            style={{ background: `hsl(${hueFor(data.wallet)} 45% 45%)` }}
            aria-hidden
          >
            {initialsFor(data.displayName)}
          </span>
        )}
        <div className="min-w-0">
          <div className="truncate text-lg font-semibold text-[var(--text)]">
            {data.displayName}
          </div>
          {data.hasViewer ? (
            <div className="num mt-0.5 flex items-center gap-2 text-[13px] text-[var(--text-secondary)]">
              <span
                className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                style={{ color: tone.fg, background: tone.bg }}
              >
                {rel}
              </span>
              <span>{data.agreement}%</span>
              <span className="text-[var(--text-muted)]">
                {data.sharedBeliefs} shared · {EVIDENCE_TEXT[data.evidenceLevel]}
              </span>
            </div>
          ) : (
            <div className="mt-0.5 text-[12px] text-[var(--text-muted)]">{data.summary}</div>
          )}
        </div>
      </header>

      {data.hasViewer && (
        <>
          <p className="max-w-prose text-[14px] leading-relaxed text-[var(--text-secondary)]">
            {data.summary}
          </p>

          {(data.alignedDomains.length > 0 || data.opposedDomains.length > 0) && (
            <div className="grid gap-6 sm:grid-cols-2">
              {data.alignedDomains.length > 0 && (
                <DomainList title="Where you align" items={data.alignedDomains} tone="var(--yes)" />
              )}
              {data.opposedDomains.length > 0 && (
                <DomainList title="Where you differ" items={data.opposedDomains} tone="var(--no)" />
              )}
            </div>
          )}

          <BeliefSection
            title="Shared beliefs"
            markets={data.sharedBoth}
            onSelectMarket={onSelectMarket}
            render={(m) => (
              <>
                You both back <SideTag side={m.viewerSide} />
              </>
            )}
          />
          <BeliefSection
            title="Opposing beliefs"
            markets={data.opposing}
            onSelectMarket={onSelectMarket}
            render={(m) => (
              <>
                You <SideTag side={m.viewerSide} /> · they <SideTag side={m.personSide} />
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
              className="block w-full rounded-lg px-2 py-2 text-left text-[13px] transition-colors hover:bg-[var(--border)]/30"
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

function SideTag({ side }: { side: "YES" | "NO" }) {
  return (
    <span style={{ color: side === "YES" ? "var(--yes)" : "var(--no)" }} className="font-semibold">
      {side}
    </span>
  );
}

function DomainList({
  title,
  items,
  tone,
}: {
  title: string;
  items: { domain: string; agreement: number }[];
  tone: string;
}) {
  return (
    <div>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        {title}
      </h3>
      <ul className="space-y-1">
        {items.map((d) => (
          <li key={d.domain} className="flex items-center justify-between text-[13px]">
            <span className="text-[var(--text)]">{d.domain}</span>
            <span className="num tabular-nums" style={{ color: tone }}>
              {d.agreement}%
            </span>
          </li>
        ))}
      </ul>
    </div>
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
              className="block w-full rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--border)]/30"
            >
              <span className="text-[13px] text-[var(--text)]">{m.title}</span>
              <span className="ml-2 text-[11px] text-[var(--text-muted)]">{render(m)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
