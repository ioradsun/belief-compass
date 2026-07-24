import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { listFeed } from "@/lib/markets.functions";

const feedQO = queryOptions({
  queryKey: ["feed"],
  queryFn: async () => (await listFeed()),
});

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Conviction — see who actually believes" },
      { name: "description", content: "Prediction markets ranked by directional wallet conviction. Money weight vs people weight, side by side." },
      { property: "og:title", content: "Conviction — see who actually believes" },
      { property: "og:description", content: "Prediction markets ranked by directional wallet conviction." },
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

function Feed() {
  const { data } = useSuspenseQuery(feedQO);
  const rows = data.data ?? [];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <h1 className="text-3xl font-semibold tracking-tight">conviction</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Money% is what capital says. People% is what directional wallets actually believe. When they disagree, someone is wrong.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
            No markets yet. The POV poller runs on a schedule — data will appear once the first cycle completes.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
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
                  const m = (r as { markets?: { title?: string; category?: string } | null }).markets;
                  return (
                    <tr key={r.onchain_id} className="border-t border-border hover:bg-muted/30">
                      <td className="p-3">
                        <a href={`/market/${r.onchain_id}`} className="font-medium hover:underline">
                          {m?.title ?? `Market #${r.onchain_id}`}
                        </a>
                        {m?.category && <div className="text-xs text-muted-foreground">{m.category}</div>}
                      </td>
                      <td className="p-3 text-right tabular-nums">{pct(r.money_yes_pct)}</td>
                      <td className="p-3 text-right tabular-nums">{pct(r.people_yes_pct)}</td>
                      <td className="p-3 text-right tabular-nums">{r.divergence != null ? `${Number(r.divergence).toFixed(0)}` : "—"}</td>
                      <td className="p-3 text-right tabular-nums">
                        <span className="text-emerald-600">{r.believers_yes}</span>
                        {" / "}
                        <span className="text-rose-600">{r.believers_no}</span>
                        {r.believers_mixed > 0 && (
                          <span className="text-muted-foreground"> · {r.believers_mixed} mixed</span>
                        )}
                      </td>
                      <td className="p-3 text-right tabular-nums">{fmtUsd(r.volume_total_usd)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-6 text-xs text-muted-foreground">
          Positions are trade-derived estimates; token transfers are not yet indexed. "Wallets" counts directional believers, not people.
        </p>
      </main>
    </div>
  );
}
