import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { getMarket } from "@/lib/markets.functions";

const marketQO = (id: number) => queryOptions({
  queryKey: ["market", id],
  queryFn: () => getMarket({ data: { onchain_id: id } }),
});

export const Route = createFileRoute("/market/$id")({
  head: ({ loaderData }: { loaderData?: Awaited<ReturnType<typeof getMarket>> }) => {
    const title = loaderData?.market?.title ?? `Market #${loaderData?.state?.onchain_id ?? ""}`;
    return {
      meta: [
        { title: `${title} · Conviction` },
        { name: "description", content: `Belief breakdown and directional-wallet conviction for ${title}.` },
        { property: "og:title", content: `${title} · Conviction` },
        { property: "og:description", content: `Directional wallet believers for ${title}.` },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  loader: ({ params, context }) =>
    context.queryClient.ensureQueryData(marketQO(Number(params.id))),
  component: MarketPage,
  errorComponent: ({ error }) => <div className="p-8 text-destructive">{String(error)}</div>,
  notFoundComponent: () => <div className="p-8">Market not found.</div>,
});

function short(w: string) { return `${w.slice(0, 6)}…${w.slice(-4)}`; }

function MarketPage() {
  const { id } = Route.useParams();
  const { data } = useSuspenseQuery(marketQO(Number(id)));
  const { state, market, believers, events } = data;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-6 py-8">
        <a href="/" className="text-sm text-muted-foreground hover:underline">← Back</a>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">
          {market?.title ?? `Market #${id}`}
        </h1>
        {market?.category && <div className="mt-1 text-sm text-muted-foreground">{market.category}</div>}

        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Money%" value={state?.money_yes_pct != null ? `${Number(state.money_yes_pct).toFixed(0)}%` : "—"} />
          <Stat label="People%" value={state?.people_yes_pct != null ? `${Number(state.people_yes_pct).toFixed(0)}%` : "—"} />
          <Stat label="Divergence" value={state?.divergence != null ? `${Number(state.divergence).toFixed(0)}` : "—"} />
          <Stat label="Wallets" value={`${state?.believers_yes ?? 0} YES · ${state?.believers_no ?? 0} NO`} />
        </div>

        <section className="mt-10">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">Top believers</h2>
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <tbody>
                {believers.length === 0 && (
                  <tr><td className="p-4 text-muted-foreground">No directional wallets yet.</td></tr>
                )}
                {believers.map((b) => (
                  <tr key={b.wallet} className="border-t border-border">
                    <td className="p-3 font-mono text-xs">
                      <a href={`/wallet/${b.wallet}`} className="hover:underline">{short(b.wallet)}</a>
                    </td>
                    <td className="p-3">
                      <span className={b.stance_side === "YES" ? "text-emerald-600" : "text-rose-600"}>
                        {b.stance_side}
                      </span>
                    </td>
                    <td className="p-3 tabular-nums">conv {Number(b.conviction ?? 0).toFixed(2)}</td>
                    <td className="p-3 tabular-nums text-muted-foreground">
                      {Math.floor(Number(b.days_held ?? 0))}d held
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-10">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">Recent activity</h2>
          <ul className="space-y-2 text-sm">
            {events.length === 0 && <li className="text-muted-foreground">No events yet.</li>}
            {events.map((e) => (
              <li key={e.id} className="rounded border border-border p-3">
                <span className="font-mono text-xs">{short(e.wallet ?? "")}</span>
                {" "}<span className="text-muted-foreground">{e.type}</span>
                {" "}<span className={e.side === "YES" ? "text-emerald-600" : e.side === "NO" ? "text-rose-600" : ""}>
                  {e.side ?? ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
