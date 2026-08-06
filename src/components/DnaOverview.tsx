/**
 * CENTER — full Conviction DNA overview. Who am I most like, who is in my Tribe,
 * who is most opposite, where do I belong, where am I different. Server-owned via
 * getDnaOverview; clicking a person opens their profile in the center.
 */
import { useQuery } from "@tanstack/react-query";
import { getDnaOverview } from "@/lib/dna.functions";
import { dnaPollInterval } from "@/domain/dna-freshness";
import { RELATIONSHIP_TEXT, relationshipTone } from "@/lib/dna-labels";
import { hueFor, initialsFor } from "@/lib/wallet-identity";

export function DnaOverview({
  wallet,
  onSelectPerson,
}: {
  wallet?: string;
  onSelectPerson: (wallet: string) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["dna-overview", wallet ?? null],
    queryFn: () => getDnaOverview({ data: { wallet } }),
    enabled: !!wallet,
    // A bounded wait on the worker, not a standing poll. This read asks for the
    // DNA to be computed when the cache is missing, so there IS something to
    // wait for on a first visit — and nothing at all once it is fresh, which is
    // when the old 60s interval kept going anyway. See @/domain/dna-freshness.
    refetchInterval: (q) => dnaPollInterval(q.state.data?.freshness, q.state.dataUpdateCount),
  });

  if (!wallet)
    return (
      <p className="text-[13px] text-[var(--text-muted)]">
        Connect your wallet to see your Conviction DNA.
      </p>
    );
  if (isLoading || !data)
    return <div className="h-40 animate-pulse rounded-xl bg-[var(--border)]/40" />;

  if (data.expressedBeliefs < 5) {
    return (
      <div className="rounded-xl bg-[var(--surface)] p-6">
        <h2 className="text-lg font-semibold text-[var(--text)]">Your DNA is still forming</h2>
        <p className="mt-2 text-[13px] text-[var(--text-secondary)]">
          Express at least 5 beliefs to begin finding people who see the world like you.
        </p>
        <p className="num mt-3 text-[12px] text-[var(--text-muted)]">
          {data.expressedBeliefs} of 5 beliefs expressed
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-7">
      <header>
        <h2 className="text-xl font-semibold text-[var(--text)]">Your Conviction DNA</h2>
        <p className="mt-1 text-[12px] text-[var(--text-muted)]">
          Built from {data.expressedBeliefs} expressed beliefs
        </p>
      </header>

      <p className="max-w-prose text-[15px] leading-relaxed text-[var(--text-secondary)]">
        {data.identity}
      </p>

      {/* Relationship counts */}
      <div className="flex flex-wrap gap-4 text-[13px]">
        <Count n={data.counts.twin} label="Twins" />
        <Count n={data.counts.tribe} label="Tribe" />
        <Count n={data.counts.opp} label="Rivals" />
        <Count n={data.counts.inverse} label="Opps" />
      </div>

      {/* Closest people */}
      {data.closest.length > 0 && (
        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Closest people
          </h3>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {data.closest.map((p) => {
              const tone = relationshipTone(p.relationship);
              return (
                <li key={p.wallet}>
                  <button
                    type="button"
                    onClick={() => onSelectPerson(p.wallet)}
                    className="flex w-full items-center gap-2 rounded-[12px] bg-[var(--surface)] p-2 text-left transition-colors hover:bg-[var(--surface-2)]"
                  >
                    {p.avatarUrl ? (
                      <img src={p.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
                    ) : (
                      <span
                        className="grid h-8 w-8 place-items-center rounded-full text-[10px] font-semibold text-white"
                        style={{ background: `hsl(${hueFor(p.wallet)} 45% 45%)` }}
                        aria-hidden
                      >
                        {initialsFor(p.displayName)}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text)]">
                      {p.displayName}
                    </span>
                    <span className="num text-[12px] text-[var(--text-secondary)]">
                      {p.agreement}%
                    </span>
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                      style={{ color: tone.fg, background: tone.bg }}
                    >
                      {RELATIONSHIP_TEXT[p.relationship]}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        {data.circles.length > 0 && (
          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Strongest Circles
            </h3>
            <ul className="space-y-1">
              {data.circles.map((c) => (
                <li key={c.domain} className="flex items-center justify-between text-[13px]">
                  <span className="text-[var(--text)]">{c.domain}</span>
                  <span className="text-[var(--text-muted)]">{c.people} strongly aligned</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {data.divisions.length > 0 && (
          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Strongest divisions
            </h3>
            <ul className="space-y-1">
              {data.divisions.map((c) => (
                <li key={c.domain} className="flex items-center justify-between text-[13px]">
                  <span className="text-[var(--text)]">{c.domain}</span>
                  <span className="text-[var(--text-muted)]">{c.people} divided</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function Count({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <span className="num text-[18px] font-semibold text-[var(--text)]">{n}</span>{" "}
      <span className="text-[var(--text-muted)]">{label}</span>
    </div>
  );
}
