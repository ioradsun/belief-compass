import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { queryOptions, useSuspenseQuery, useQuery } from "@tanstack/react-query";
import { listFeed, getIngestStatus } from "@/lib/markets.functions";
import { ConvictionFeed } from "@/components/ConvictionFeed";
import { WalletConnectButton } from "@/components/WalletConnect";


const feedQO = (wallet?: string) =>
  queryOptions({
    queryKey: ["feed", wallet ?? null],
    queryFn: async () => await listFeed({ data: { wallet } }),
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
  loader: ({ context }) => context.queryClient.ensureQueryData(feedQO()),
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
  const [expanded, setExpanded] = useState(false);
  if (isLoading || !data) {
    return (
      <div className="rounded-lg border border-border p-4 text-xs text-muted-foreground">
        Loading ingest status…
      </div>
    );
  }

  const chainPct = data.chain.progressPct ?? 0;
  const chainLive = data.chain.phase === "live";
  const chainState: JobState =
    data.chain.blocksBehind == null ? "in-progress" : chainLive ? "done" : "in-progress";
  const povState: JobState = data.markets > 0 ? "done" : "pending";
  // Belief rollup is "done" once the chain is live AND beliefs have been folded.
  const beliefState: JobState =
    data.beliefs > 0 && chainLive ? "done" : data.beliefs > 0 ? "in-progress" : "pending";
  // DNA matcher is on-demand — ready once the pipeline is live.
  const matchState: JobState =
    data.matches > 0 || (chainLive && data.beliefs > 0) ? "done" : "pending";

  const allDone =
    povState === "done" && chainState === "done" && beliefState === "done" && matchState === "done";

  if (allDone && !expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="flex w-full items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-2.5 text-left transition-colors hover:bg-emerald-500/10"
      >
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
          <span className="text-sm font-medium">All systems live</span>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {data.markets.toLocaleString()} markets · {data.trades.toLocaleString()} trades ·{" "}
            {data.beliefs.toLocaleString()} beliefs
          </span>
        </div>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">details</span>
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Ingest status
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-muted-foreground">auto-refresh 15s</span>
          {allDone && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground"
            >
              collapse
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Job
          state={povState}
          title="POV markets"
          detail={`${data.markets.toLocaleString()} markets imported`}
        />
        <Job
          state={chainState}
          title={chainLive ? "Chain indexer (live)" : "Chain indexer (backfill)"}
          detail={
            data.chain.head
              ? `${data.chain.leaseActive ? "scanning now" : "ready for next tick"} · block ${data.chain.lastBlock.toLocaleString()} / ${data.chain.head.toLocaleString()} · ${data.chain.blocksBehind?.toLocaleString()} behind`
              : `block ${data.chain.lastBlock.toLocaleString()}`
          }
          progress={chainLive ? undefined : chainPct}
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
              : "ready — computes on demand when you open a wallet"
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
  const { wallet } = Route.useSearch();
  const { data } = useSuspenseQuery(feedQO(wallet));
  const rows = data.data ?? [];


  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-7xl items-start justify-between gap-4 px-6 py-8">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">conviction</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Markets tell you what moved. Conviction tells you why. Wealth tells you why people
              cared.
            </p>
          </div>
          <div className="pt-1">
            <WalletConnectButton />
          </div>
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
              <table className="w-full min-w-[1040px] text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Market</th>
                    <th className="px-4 py-3 text-right">YES</th>
                    <th className="px-4 py-3 text-right">NO</th>
                    <th className="px-4 py-3 text-right">24h</th>
                    <th className="px-4 py-3 text-right">Backers</th>
                    <th className="px-4 py-3">Your graph</th>
                    <th className="px-4 py-3 text-right">Money%</th>
                    <th className="px-4 py-3 text-right">People%</th>
                    <th className="px-4 py-3 text-right">Volume</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const m = (r as { markets?: { title?: string; category?: string } | null })
                      .markets;
                    const chg = r.chg_24h;
                    const chgUp = chg != null && Number(chg) >= 0;
                    const fmtShare = (n: number | null) =>
                      n == null ? "—" : n >= 1 ? `$${Number(n).toFixed(2)}` : `${Math.round(Number(n) * 100)}¢`;
                    const yesB = Number(r.believers_yes ?? 0);
                    const noB = Number(r.believers_no ?? 0);
                    const totalB = yesB + noB;
                    const yesShare = totalB > 0 ? (yesB / totalB) * 100 : 0;
                    const tribe = (r as { tribe_side?: "YES" | "NO" | null }).tribe_side ?? null;
                    const opp = (r as { opp_side?: "YES" | "NO" | null }).opp_side ?? null;
                    return (
                      <tr
                        key={r.onchain_id}
                        className="border-t border-border align-top hover:bg-muted/30"
                      >
                        <td className="px-4 py-5">
                          <a
                            href={`/market/${r.onchain_id}`}
                            className="font-medium leading-snug hover:underline"
                          >
                            {m?.title ?? `Market #${r.onchain_id}`}
                          </a>
                          {m?.category && (
                            <div className="mt-1 text-xs text-muted-foreground">{m.category}</div>
                          )}
                        </td>
                        <td className="px-4 py-5 text-right tabular-nums">
                          <span className="inline-flex items-center rounded-md bg-emerald-500/10 px-2 py-1 font-semibold text-emerald-600">
                            {fmtShare(r.yes_price_usd)}
                          </span>
                        </td>
                        <td className="px-4 py-5 text-right tabular-nums">
                          <span className="inline-flex items-center rounded-md bg-rose-500/10 px-2 py-1 font-semibold text-rose-600">
                            {fmtShare(r.no_price_usd)}
                          </span>
                        </td>
                        <td
                          className="px-4 py-5 text-right tabular-nums font-medium"
                          style={{ color: chg == null ? undefined : chgUp ? "#059669" : "#dc2626" }}
                        >
                          {chg == null
                            ? "—"
                            : `${chgUp ? "▲ +" : "▼ −"}${Math.abs(Math.round(Number(chg)))}%`}
                          <div className="text-[11px] font-normal text-muted-foreground">24h</div>
                        </td>
                        <td className="px-4 py-5 text-right tabular-nums">
                          <div>
                            <span className="font-medium text-emerald-600">{yesB}</span>
                            <span className="text-muted-foreground"> yes · </span>
                            <span className="font-medium text-rose-600">{noB}</span>
                            <span className="text-muted-foreground"> no</span>
                          </div>
                          <div className="mt-2 flex h-1.5 w-28 overflow-hidden rounded-full bg-rose-500/30 ml-auto">
                            <div
                              className="h-full bg-emerald-500"
                              style={{ width: `${yesShare}%` }}
                            />
                          </div>
                          {Number(r.believers_mixed ?? 0) > 0 && (
                            <div className="mt-1 text-[11px] text-muted-foreground">
                              {r.believers_mixed} mixed
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-5">
                          {tribe == null && opp == null ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            <div className="flex flex-col gap-1">
                              {tribe && (
                                <span className="inline-flex w-fit items-center gap-1 rounded-full bg-violet-500/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-violet-600">
                                  Tribe · {tribe}
                                </span>
                              )}
                              {opp && (
                                <span className="inline-flex w-fit items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-red-600">
                                  Opp · {opp}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-5 text-right tabular-nums">{pct(r.money_yes_pct)}</td>
                        <td className="px-4 py-5 text-right tabular-nums">
                          {pct(r.people_yes_pct)}
                        </td>
                        <td className="px-4 py-5 text-right tabular-nums">
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
