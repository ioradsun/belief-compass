import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery, useQuery } from "@tanstack/react-query";
import { listFeed, getIngestStatus } from "@/lib/markets.functions";
import { ConvictionFeed } from "@/components/ConvictionFeed";

const feedQO = queryOptions({
  queryKey: ["feed"],
  queryFn: async () => await listFeed(),
});

const statusQO = queryOptions({
  queryKey: ["ingest-status"],
  queryFn: async () => await getIngestStatus(),
  refetchInterval: 15_000,
});

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { wallet?: string } => ({
    wallet:
      typeof search.wallet === "string" && search.wallet.length > 3 ? search.wallet : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Conviction — see who actually believes" },
      {
        name: "description",
        content:
          "Prediction markets ranked by directional wallet conviction. Money weight vs people weight, side by side.",
      },
      { property: "og:title", content: "Conviction — see who actually believes" },
      {
        property: "og:description",
        content: "Prediction markets ranked by directional wallet conviction.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(feedQO),
  component: Feed,
  errorComponent: ({ error }) => (
    <div className="p-8 text-sm text-destructive">Feed failed: {String(error)}</div>
  ),
  notFoundComponent: () => <div className="p-8">Not found.</div>,
});

function pct(n: number | null | undefined) {
  if (n == null) return "—";
  return `${Number(n).toFixed(0)}%`;
}
function fmtUsd(n: number | null | undefined) {
  if (n == null) return "—";
  const v = Number(n);
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}k`;
  return `$${v.toFixed(0)}`;
}

type JobState = "done" | "in-progress" | "pending";
function Dot({ state }: { state: JobState }) {
  const color =
    state === "done"
      ? "bg-emerald-500"
      : state === "in-progress"
        ? "bg-amber-500 animate-pulse"
        : "bg-muted-foreground/40";
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

function StatusPanel() {
  const { data, isLoading } = useQuery(statusQO);
  if (isLoading || !data) {
    return (
      <div className="rounded-lg border border-border p-4 text-xs text-muted-foreground">
        Loading ingest status…
      </div>
    );
  }

  const chainPct = data.chain.progressPct ?? 0;
  const chainState: JobState =
    data.chain.blocksBehind == null
      ? "in-progress"
      : data.chain.phase === "live"
        ? "done"
        : "in-progress";
  const povState: JobState = data.markets > 0 ? "done" : "pending";
  const beliefState: JobState = data.marketsWithBelievers > 0 ? "in-progress" : "pending";
  const matchState: JobState = data.matches > 0 ? "done" : "pending";

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Ingest status
        </h2>
        <span className="text-[10px] text-muted-foreground">auto-refresh 15s</span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Job
          state={povState}
          title="POV markets"
          detail={`${data.markets.toLocaleString()} markets imported`}
        />
        <Job
          state={chainState}
          title={data.chain.phase === "live" ? "Chain indexer (live)" : "Chain indexer (backfill)"}
          detail={
            data.chain.head
              ? `${data.chain.leaseActive ? "scanning now" : "ready for next tick"} · block ${data.chain.lastBlock.toLocaleString()} / ${data.chain.head.toLocaleString()} · ${data.chain.blocksBehind?.toLocaleString()} behind`
              : `block ${data.chain.lastBlock.toLocaleString()}`
          }
          progress={chainPct}
        />
        <Job
          state={beliefState}
          title="Belief rollup"
          detail={`${data.beliefs.toLocaleString()} beliefs across ${data.marketsWithBelievers} markets · ${data.trades.toLocaleString()} trades`}
        />
        <Job
          state={matchState}
          title="DNA matcher"
          detail={
            data.matches > 0
              ? `${data.matches.toLocaleString()} match rows cached`
              : "runs on demand when you open a wallet"
          }
        />
      </div>
    </div>
  );
}

function Job({
  state,
  title,
  detail,
  progress,
}: {
  state: JobState;
  title: string;
  detail: string;
  progress?: number;
}) {
  return (
    <div className="rounded-md border border-border bg-background/60 p-3">
      <div className="flex items-center gap-2">
        <Dot state={state} />
        <span className="text-sm font-medium">{title}</span>
        <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">
          {state === "done" ? "complete" : state === "in-progress" ? "running" : "pending"}
        </span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
      {progress != null && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-emerald-500 transition-all"
            style={{ width: `${Math.max(2, progress).toFixed(1)}%` }}
          />
        </div>
      )}
    </div>
  );
}

function Feed() {
  const { data } = useSuspenseQuery(feedQO);
  const { wallet } = Route.useSearch();
  const rows = data.data ?? [];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto max-w-7xl px-6 py-8">
          <h1 className="text-3xl font-semibold tracking-tight">conviction</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Markets tell you what moved. Conviction tells you why. Wealth tells you why people
            cared.
          </p>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-4 py-6 sm:px-6 sm:py-8 lg:grid-cols-[1fr_minmax(320px,380px)]">
        <div className="space-y-6">
          <StatusPanel />

          {rows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
              No markets yet. The POV poller runs on a schedule — data will appear once the first
              cycle completes.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="p-3">Market</th>
                    <th className="p-3 text-right">Money%</th>
                    <th className="p-3 text-right">People%</th>
                    <th className="p-3 text-right">Divergence</th>
                    <th className="p-3 text-right">Wallets</th>
                    <th className="p-3 text-right">Volume</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const m = (r as { markets?: { title?: string; category?: string } | null })
                      .markets;
                    return (
                      <tr key={r.onchain_id} className="border-t border-border hover:bg-muted/30">
                        <td className="p-3">
                          <a
                            href={`/market/${r.onchain_id}`}
                            className="font-medium hover:underline"
                          >
                            {m?.title ?? `Market #${r.onchain_id}`}
                          </a>
                          {m?.category && (
                            <div className="text-xs text-muted-foreground">{m.category}</div>
                          )}
                        </td>
                        <td className="p-3 text-right tabular-nums">{pct(r.money_yes_pct)}</td>
                        <td className="p-3 text-right tabular-nums">{pct(r.people_yes_pct)}</td>
                        <td className="p-3 text-right tabular-nums">
                          {r.divergence != null ? `${Number(r.divergence).toFixed(0)}` : "—"}
                        </td>
                        <td className="p-3 text-right tabular-nums">
                          <span className="text-emerald-600">{r.believers_yes}</span>
                          {" / "}
                          <span className="text-rose-600">{r.believers_no}</span>
                          {r.believers_mixed > 0 && (
                            <span className="text-muted-foreground">
                              {" "}
                              · {r.believers_mixed} mixed
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-right tabular-nums">
                          {fmtUsd(r.volume_total_usd)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Positions are trade-derived estimates; token transfers are not yet indexed. "Wallets"
            counts directional believers, not people.
          </p>
        </div>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <ConvictionFeed wallet={wallet} />
        </aside>
      </main>
    </div>
  );
}
