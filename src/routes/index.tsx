import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { queryOptions, useSuspenseQuery, useQuery } from "@tanstack/react-query";
import {
  listFeed,
  listMarketPulses,
  getIngestStatus,
  type VolumeWindow,
} from "@/lib/markets.functions";
import { MarketCard, type MarketRow } from "@/components/MarketCard";
import { ConvictionFeed } from "@/components/ConvictionFeed";
import { WalletConnectButton } from "@/components/WalletConnect";


const WINDOW_OPTIONS: { key: VolumeWindow; label: string }[] = [
  { key: "1h", label: "1H" },
  { key: "24h", label: "24H" },
  { key: "7d", label: "1W" },
  { key: "30d", label: "1M" },
  { key: "all", label: "All" },
];

const feedQO = (wallet?: string, window: VolumeWindow = "all") =>
  queryOptions({
    queryKey: ["feed", wallet ?? null, window],
    queryFn: async () => await listFeed({ data: { wallet, window } }),
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
  const [win, setWin] = useState<VolumeWindow>("all");
  const { data } = useSuspenseQuery(feedQO(wallet, win));
  const rows = data.data ?? [];
  const winLabel = WINDOW_OPTIONS.find((w) => w.key === win)?.label ?? "All";

  const ids = rows.map((r) => Number(r.onchain_id));
  const { data: pulseData } = useQuery(pulsesQO(ids));
  const pulses = pulseData?.pulses ?? {};





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
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-4 py-3">
                <div className="text-xs text-muted-foreground">
                  Volume = on-chain ETH traded on that side in the window, priced in USD. Each card
                  runs its own live feed — tap one to see every event.
                </div>
                <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
                  {WINDOW_OPTIONS.map((w) => (
                    <button
                      key={w.key}
                      type="button"
                      onClick={() => setWin(w.key)}
                      className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                        win === w.key
                          ? "bg-foreground text-background"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {w.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-2">
                {rows.map((r, idx) => (
                  <MarketCard
                    key={r.onchain_id}
                    row={r as unknown as MarketRow}
                    pulses={pulses[String(r.onchain_id)] ?? []}
                    ethUsd={data.ethUsd ?? 0}
                    winLabel={winLabel}
                    stagger={(idx % 8) * 600}
                  />
                ))}
              </div>
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
