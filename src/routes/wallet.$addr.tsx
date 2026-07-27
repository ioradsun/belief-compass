import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { getWallet } from "@/lib/markets.functions";
import { getMatchesForWallet } from "@/lib/match.functions";
import { getCirclesForWallet, type CircleSummary } from "@/lib/circles.functions";
import { Fingerprint } from "@/components/Fingerprint";
import { LinkWalletCard } from "@/components/LinkWalletCard";
import { WalletIdentity } from "@/components/WalletIdentity";

const walletQO = (w: string) => queryOptions({
  queryKey: ["wallet", w],
  queryFn: () => getWallet({ data: { wallet: w } }),
});
const matchesQO = (w: string) => queryOptions({
  queryKey: ["matches", w],
  queryFn: () => getMatchesForWallet({ data: { wallet: w } }),
});
const circlesQO = (w: string) => queryOptions({
  queryKey: ["circles", w],
  queryFn: () => getCirclesForWallet({ data: { wallet: w } }),
});

export const Route = createFileRoute("/wallet/$addr")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.addr.slice(0, 8)}… · Conviction DNA` },
      { name: "description", content: "Directional beliefs and per-domain Circles for this wallet." },
      { property: "og:title", content: `Wallet ${params.addr.slice(0, 8)}… · Conviction` },
      { property: "og:description", content: "Per-domain Circles: your Money ally may be your Politics rival." },
      { property: "og:type", content: "profile" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: async ({ params, context }) => {
    await context.queryClient.ensureQueryData(walletQO(params.addr.toLowerCase()));
    return null;
  },
  component: WalletPage,
  errorComponent: ({ error }) => <div className="p-8 text-destructive">{String(error)}</div>,
  notFoundComponent: () => <div className="p-8">Wallet not found.</div>,
});

function short(w: string) { return `${w.slice(0, 6)}…${w.slice(-4)}`; }

function WalletPage() {
  const { addr } = Route.useParams();
  const w = addr.toLowerCase();
  const { data: wd } = useSuspenseQuery(walletQO(w));
  const { data: md } = useSuspenseQuery(matchesQO(w));
  const { data: cd } = useSuspenseQuery(circlesQO(w));

  const activeCircles = cd.circles.filter((c) => !c.insufficient);
  const blurryCircles = cd.circles.filter((c) => c.insufficient);
  const empty = wd.positions.length === 0;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-6 py-8">
        <a href="/" className="text-sm text-muted-foreground hover:underline">← Back</a>
        <h1 className="mt-4 font-mono text-lg">{short(w)}</h1>

        <WalletIdentity viewing={w} />

        {empty && <LinkWalletCard />}


        {/* Fingerprint + Tribe summary */}
        <section className="mt-8 grid gap-6 sm:grid-cols-[auto,1fr] sm:items-center">
          <div className="flex justify-center"><Fingerprint circles={cd.circles} /></div>
          <div>
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Conviction fingerprint</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              A person isn't one number. Circles decompose belief match by domain — your Money ally
              may be your Politics rival.
            </p>
            <div className="mt-4 space-y-1 text-sm">
              <div><span className="text-muted-foreground">Active Circles:</span> {activeCircles.length} / {cd.circles.length}</div>
              {blurryCircles.length > 0 && (
                <div className="text-muted-foreground">
                  Blurry: {blurryCircles.map((c) => c.domain).join(", ")}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Circles list */}
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">Circles</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {cd.circles.map((c) => (
              <CircleCard key={c.domain} c={c} />
            ))}
          </div>
        </section>

        <section className="mt-10">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">Positions</h2>
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <tbody>
                {wd.positions.length === 0 && (
                  <tr><td className="p-4 text-muted-foreground">No positions.</td></tr>
                )}
                {wd.positions.map((p) => {
                  const m = (p as { markets?: { title?: string } | null }).markets;
                  return (
                    <tr key={p.onchain_id} className="border-t border-border">
                      <td className="p-3">
                        <a href={`/market/${p.onchain_id}`} className="hover:underline">
                          {m?.title ?? `Market #${p.onchain_id}`}
                        </a>
                      </td>
                      <td className="p-3">
                        <span className={p.stance_side === "YES" ? "text-emerald-600" : p.stance_side === "NO" ? "text-rose-600" : "text-muted-foreground"}>
                          {p.stance_side ?? "—"}
                        </span>
                      </td>
                      <td className="p-3 tabular-nums">conv {Number(p.conviction ?? 0).toFixed(2)}</td>
                      <td className="p-3 tabular-nums text-muted-foreground">
                        {Math.floor(Number(p.days_held ?? 0))}d
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-10">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Tribe {md.insufficient ? "" : `— overall match`}
          </h2>
          {md.insufficient ? (
            <div className="rounded border border-dashed border-border p-6 text-sm text-muted-foreground">
              Not enough shared beliefs yet to read this wallet's overall Tribe.
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <tbody>
                  {md.matches.map((m) => (
                    <tr key={m.matched_wallet} className="border-t border-border">
                      <td className="p-3 font-mono text-xs">
                        <a href={`/wallet/${m.matched_wallet}`} className="hover:underline">
                          {short(m.matched_wallet)}
                        </a>
                      </td>
                      <td className="p-3 tabular-nums">{Number(m.match_score).toFixed(0)}</td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {m.shared_markets} shared · {m.agreements} agree · {m.disagreements} disagree
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function CircleCard({ c }: { c: CircleSummary }) {
  if (c.insufficient) {
    const enoughOwn = c.shared_markets >= 5;
    return (
      <div className="rounded-lg border border-dashed border-border p-4">
        <div className="flex items-baseline justify-between">
          <div className="text-sm font-medium">{c.domain}</div>
          {enoughOwn && <div className="text-xs text-muted-foreground">{c.shared_markets} markets</div>}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {enoughOwn
            ? "No one else overlaps enough here yet — waiting on more believers."
            : `Your ${c.domain} fingerprint is still blurry — ${c.shared_markets}/5 markets.`}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-baseline justify-between">
        <div className="text-sm font-medium">{c.domain}</div>
        <div className="text-xs text-muted-foreground">{c.shared_markets} markets</div>
      </div>
      {c.top_ally && (
        <div className="mt-2 flex items-center justify-between text-sm">
          <a href={`/wallet/${c.top_ally.wallet}`} className="font-mono text-xs hover:underline">
            ally · {short(c.top_ally.wallet)}
          </a>
          <span className="tabular-nums text-emerald-600">{c.top_ally.match_score.toFixed(0)}</span>
        </div>
      )}
      {c.top_rival && (
        <div className="mt-1 flex items-center justify-between text-sm">
          <a href={`/wallet/${c.top_rival.wallet}`} className="font-mono text-xs hover:underline">
            rival · {short(c.top_rival.wallet)}
          </a>
          <span className="tabular-nums text-rose-600">{c.top_rival.match_score.toFixed(0)}</span>
        </div>
      )}
    </div>
  );
}
