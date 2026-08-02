/**
 * conviction.company/value — a live public report card proving the measurable
 * value Conviction Company creates for the POV ecosystem. Not analytics: every
 * number answers one question — "why is Conviction valuable to POV?"
 *
 * Scope is trades conviction.company actually SENT — recorded at submit time and
 * joined to the canonical events log by transaction hash. Nothing is inferred from
 * wallets, so a figure here is a trade we can prove we routed. Fee +
 * creator-earnings money is DERIVED from the contract's own fee rate (feeBps /
 * FEE_DENOMINATOR / CREATOR_FEE_SHARE) applied to that real volume — no invented
 * number. Headline figures count up and the page re-polls, so it stays alive.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useReadContracts } from "wagmi";
import { parseAbi } from "viem";
import { PROXY_ADDRESS, CHAIN_ID } from "@/chain/decoder";
import { getEcosystemValue, type EcosystemValue } from "@/lib/ecosystem-value.functions";

export const Route = createFileRoute("/value")({
  head: () => ({
    meta: [
      { title: "Conviction Company · Value to the POV ecosystem" },
      {
        name: "description",
        content:
          "A live report card of the trading volume, markets, creator earnings and fees Conviction Company generates for the POV ecosystem.",
      },
      { property: "og:title", content: "Conviction Company · Ecosystem Value" },
    ],
  }),
  loader: async () => {
    try {
      return { seed: await getEcosystemValue() };
    } catch {
      return { seed: null as EcosystemValue | null };
    }
  },
  component: ValuePage,
});

// The contract's own fee model — read once, applied to real volume.
const FEE_ABI = parseAbi([
  "function feeBps() view returns (uint256)",
  "function FEE_DENOMINATOR() view returns (uint256)",
  "function CREATOR_FEE_SHARE() view returns (uint256)",
]);

const fmtUsd = (n: number): string => {
  const v = Math.abs(n);
  if (v >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (v >= 10_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
};
const fmtNum = (n: number): string => Math.round(n).toLocaleString("en-US");
const short = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`;

/** Count toward a target whenever it changes — the "alive" feel, cheaply. */
function useCountUp(target: number, ms = 700): number {
  const [val, setVal] = useState(target);
  const fromRef = useRef(target);
  const startRef = useRef<number | null>(null);
  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;
    startRef.current = null;
    let raf = 0;
    const tick = (t: number) => {
      if (startRef.current == null) startRef.current = t;
      const p = Math.min(1, (t - startRef.current) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(from + (target - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return val;
}

function ValuePage() {
  const { seed } = Route.useLoaderData();
  const query = useQuery({
    queryKey: ["ecosystem-value"],
    queryFn: () => getEcosystemValue(),
    initialData: seed ?? undefined,
    refetchInterval: 10_000, // stays alive
    placeholderData: (p) => p,
  });
  const data = query.data as EcosystemValue | undefined;

  // On-chain fee rate → real fees + creator earnings from real volume.
  const fees = useReadContracts({
    contracts: (["feeBps", "FEE_DENOMINATOR", "CREATOR_FEE_SHARE"] as const).map((functionName) => ({
      address: PROXY_ADDRESS as `0x${string}`,
      abi: FEE_ABI,
      functionName,
      chainId: CHAIN_ID,
    })),
  });
  const readN = (i: number): number | null => {
    const r = (fees.data ?? [])[i];
    return r && r.status === "success" && typeof r.result === "bigint" ? Number(r.result) : null;
  };
  const feeBps = readN(0);
  const denom = readN(1);
  const creatorShareRaw = readN(2);
  const feeRate = feeBps != null && denom ? feeBps / denom : null;
  const creatorShare = creatorShareRaw != null && denom ? creatorShareRaw / denom : null;

  if (!data) {
    return <Centered>Loading the ecosystem report…</Centered>;
  }

  const t = data.totals;
  const feesUsd = feeRate != null ? t.volumeUsd * feeRate : null;
  const creatorEarningsUsd = feesUsd != null && creatorShare != null ? feesUsd * creatorShare : null;

  // Per-market derived earnings → creator economy + leaderboards (consistent with
  // the headline: same real-volume × real-rate formula, sums back to the total).
  const marketEarn = data.markets.map((m) => ({
    ...m,
    feesUsd: feeRate != null ? m.volumeUsd * feeRate : 0,
    earningsUsd: feeRate != null && creatorShare != null ? m.volumeUsd * feeRate * creatorShare : 0,
  }));
  const topMarketsByVolume = [...data.markets].sort((a, b) => b.volumeUsd - a.volumeUsd).slice(0, 8);
  const topEarningMarkets = [...marketEarn].sort((a, b) => b.earningsUsd - a.earningsUsd).slice(0, 6);

  const creatorMap = new Map<string, { wallet: string; name: string | null; markets: number; volumeUsd: number; earningsUsd: number }>();
  for (const m of marketEarn) {
    if (!m.authorWallet) continue;
    const w = m.authorWallet.toLowerCase();
    const e = creatorMap.get(w) ?? { wallet: w, name: m.authorName, markets: 0, volumeUsd: 0, earningsUsd: 0 };
    e.markets++;
    e.volumeUsd += m.volumeUsd;
    e.earningsUsd += m.earningsUsd;
    if (!e.name && m.authorName) e.name = m.authorName;
    creatorMap.set(w, e);
  }
  const topCreators = [...creatorMap.values()].sort((a, b) => b.earningsUsd - a.earningsUsd).slice(0, 6);
  const avgEarningsPerMarket = data.markets.length ? (creatorEarningsUsd ?? 0) / data.markets.length : 0;
  const avgVolPerMarket = data.markets.length ? t.volumeUsd / data.markets.length : 0;
  const avgTradesPerMarket = data.markets.length ? t.tradesExecuted / data.markets.length : 0;

  return (
    // The app shell locks html/body to overflow:hidden (it's a fixed-viewport
    // experience), so this long report needs to own its own vertical scroll.
    <div className="h-[100svh] overflow-y-auto bg-[var(--bg)] text-[var(--text)]">
      <div className="mx-auto w-full max-w-[1080px] px-5 py-10 sm:px-8 sm:py-14">
        {/* HERO */}
        <header className="mb-12">
          <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
            Conviction Company Value
          </div>
          <h1 className="mt-3 max-w-[24ch] text-[32px] font-semibold leading-[1.1] tracking-[-0.02em] text-[var(--text)] sm:text-[42px]">
            The trading Conviction brings to POV — every trade we routed.
          </h1>
          {data.since && (
            <div className="mt-3 text-[12.5px] text-[var(--text-muted)]">
              Measured from {new Date(data.since).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })},
              when trade attribution began.
            </div>
          )}
          <div className="mt-9 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--border)] sm:grid-cols-3">
            <Hero label="Buy Volume" value={t.volumeUsd} format={fmtUsd} />
            <Hero label="Trading Fees Generated" value={feesUsd} format={fmtUsd} />
            <Hero label="Creator Earnings Paid" value={creatorEarningsUsd} format={fmtUsd} />
            <Hero label="Markets Created" value={t.marketsCreated} format={fmtNum} />
            <Hero label="Trades Executed" value={t.tradesExecuted} format={fmtNum} />
            <Hero label="Connected Traders" value={t.activeTraders} format={fmtNum} />
          </div>
        </header>

        {t.tradesExecuted === 0 && (
          <div className="mb-12 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <div className="text-[14px] font-semibold text-[var(--text)]">No trades attributed yet</div>
            <p className="mt-2 max-w-[70ch] text-[12.5px] leading-relaxed text-[var(--text-muted)]">
              A trade counts here only once Conviction has provably routed it. The contract records
              no referrer, so trades sent before attribution shipped can&rsquo;t be recovered — and
              we don&rsquo;t estimate them. These figures start at zero and build from real activity.
            </p>
          </div>
        )}

        <div className={`grid gap-12 lg:grid-cols-[1fr_360px] ${t.tradesExecuted === 0 ? "hidden" : ""}`}>
          <div className="min-w-0 space-y-12">
            {/* GROWTH */}
            <Section title="Growth" note="Cumulative, last 30 days">
              <GrowthChart growth={data.growth} />
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Mini label="Volume / market" value={fmtUsd(avgVolPerMarket)} />
                <Mini label="Trades / market" value={fmtNum(avgTradesPerMarket)} />
                <Mini label="Earnings / market" value={fmtUsd(avgEarningsPerMarket)} />
              </div>
            </Section>

            {/* CREATOR ECONOMY */}
            <Section title="Creator Economy" note="What connected traders' volume earns the markets they back">
              <div className="grid gap-3 sm:grid-cols-2">
                <Panel>
                  <Kpi label="Total Creator Earnings" value={creatorEarningsUsd == null ? "—" : fmtUsd(creatorEarningsUsd)} />
                  <Kpi label="Avg Earnings / Market" value={fmtUsd(avgEarningsPerMarket)} />
                </Panel>
                <Panel title="Highest-Earning Markets">
                  {topEarningMarkets.map((m) => (
                    <LeaderRow key={m.onchainId} title={m.title} sub={m.category ?? "—"} value={fmtUsd(m.earningsUsd)} />
                  ))}
                </Panel>
              </div>
              <Panel className="mt-3" title="Top Creators">
                {topCreators.length === 0 ? (
                  <Empty>No creators yet.</Empty>
                ) : (
                  topCreators.map((c) => (
                    <LeaderRow
                      key={c.wallet}
                      title={c.name ?? short(c.wallet)}
                      sub={`${c.markets} market${c.markets === 1 ? "" : "s"} · ${fmtUsd(c.volumeUsd)} volume`}
                      value={fmtUsd(c.earningsUsd)}
                    />
                  ))
                )}
              </Panel>
            </Section>

            {/* LEADERBOARDS */}
            <Section title="Leaderboards">
              <div className="grid gap-3 sm:grid-cols-2">
                <Panel title="Highest-Volume Markets">
                  {topMarketsByVolume.map((m) => (
                    <LeaderRow key={m.onchainId} title={m.title} sub={`${fmtNum(m.trades)} trades`} value={fmtUsd(m.volumeUsd)} />
                  ))}
                </Panel>
                <Panel title="Most Active Categories">
                  {data.categories.slice(0, 8).map((c) => (
                    <LeaderRow key={c.category} title={c.category} sub={`${c.markets} markets · ${c.creators} creators`} value={fmtUsd(c.volumeUsd)} />
                  ))}
                </Panel>
              </div>
            </Section>

            {/* CATEGORIES */}
            <Section title="Categories" note="Connected-wallet activity by theme">
              <div className="overflow-hidden rounded-2xl border border-[var(--border)]">
                <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                  <span>Category</span>
                  <span className="text-right">Markets</span>
                  <span className="text-right">Trades</span>
                  <span className="text-right">Volume</span>
                </div>
                {data.categories.map((c, i) => (
                  <div key={c.category} className={`grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-2 px-4 py-3 text-[13px] tabular-nums ${i > 0 ? "border-t border-[var(--border)]" : ""}`}>
                    <span className="truncate font-medium text-[var(--text)]">{c.category}</span>
                    <span className="text-right text-[var(--text-secondary)]">{fmtNum(c.markets)}</span>
                    <span className="text-right text-[var(--text-secondary)]">{fmtNum(c.trades)}</span>
                    <span className="text-right font-semibold text-[var(--text)]">{fmtUsd(c.volumeUsd)}</span>
                  </div>
                ))}
              </div>
            </Section>
          </div>

          {/* LIVE ACTIVITY — sticky rail */}
          <aside className="lg:sticky lg:top-6 lg:h-max">
            <Section title="Live Activity" note="Newest first">
              <div className="space-y-2.5">
                {data.recentActivity.map((a) => (
                  <ActivityRow key={a.key} a={a} />
                ))}
              </div>
            </Section>
          </aside>
        </div>

        <footer className="mt-16 border-t border-[var(--border)] pt-6 text-[12px] leading-relaxed text-[var(--text-muted)]">
          Buy volume, trades and traders count only transactions Conviction routed, recorded when
          we send them and matched to on-chain events by transaction hash — across any market, pov-
          or conviction-born. Trades made elsewhere are never counted, and trades predating
          attribution are not estimated. Markets Created counts markets born on conviction.company.
          Fees and creator earnings are computed from the protocol&rsquo;s own fee rate applied to
          that real buy volume. Updated continuously.
        </footer>
      </div>
    </div>
  );
}

// --- growth chart (one clean cumulative area, no chrome) --------------------
function GrowthChart({ growth }: { growth: EcosystemValue["growth"] }) {
  const w = 640;
  const h = 160;
  const pts = growth.length ? growth : [{ day: "", volumeUsd: 0, trades: 0 }];
  const max = Math.max(1, ...pts.map((p) => p.volumeUsd));
  const stepX = pts.length > 1 ? w / (pts.length - 1) : w;
  const xy = pts.map((p, i) => [i * stepX, h - (p.volumeUsd / max) * (h - 8) - 4] as const);
  const line = xy.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-1 text-[12px] text-[var(--text-muted)]">Cumulative buy volume</div>
      <div className="text-[22px] font-semibold tabular-nums text-[var(--text)]">
        {fmtUsd(pts[pts.length - 1].volumeUsd)}
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="mt-2 h-[160px] w-full" preserveAspectRatio="none">
        <path d={area} fill="var(--yes)" opacity="0.12" />
        <path d={line} fill="none" stroke="var(--yes)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

function ActivityRow({ a }: { a: EcosystemValue["recentActivity"][number] }) {
  const usd = a.amountEth * a.ethUsd;
  const text =
    a.kind === "market_created"
      ? "New market created"
      : `${a.action === "SELL" ? "Sold" : "Backed"} ${a.side ?? ""}${usd > 0 ? ` · ${fmtUsd(usd)}` : ""}`;
  const dot = a.kind === "market_created" ? "var(--text-secondary)" : a.side === "NO" ? "var(--no)" : "var(--yes)";
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: dot }} />
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium text-[var(--text)]">{a.title}</div>
        <div className="text-[12px] text-[var(--text-muted)]">{text}</div>
      </div>
      <span className="ml-auto shrink-0 text-[11px] tabular-nums text-[var(--text-muted)]">{ago(a.at)}</span>
    </div>
  );
}

function ago(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const hr = Math.floor(m / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

// --- small presentational pieces -------------------------------------------
function Hero({
  label,
  value,
  format,
}: {
  label: string;
  value: number | null;
  format: (n: number) => string;
}) {
  const shown = useCountUp(value ?? 0);
  const live = value != null;
  return (
    <div className="bg-[var(--bg)] px-4 py-5">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
        {live && <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--yes)" }} />}
        {label}
      </div>
      <div className="mt-1.5 text-[26px] font-semibold tabular-nums tracking-[-0.02em] text-[var(--text)] sm:text-[30px]">
        {value == null ? "—" : format(shown)}
      </div>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-baseline gap-3">
        <h2 className="text-[15px] font-semibold text-[var(--text)]">{title}</h2>
        {note && <span className="text-[12px] text-[var(--text-muted)]">{note}</span>}
      </div>
      {children}
    </section>
  );
}

function Panel({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 ${className}`}>
      {title && <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{title}</div>}
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-1.5">
      <div className="text-[12px] text-[var(--text-muted)]">{label}</div>
      <div className="text-[22px] font-semibold tabular-nums text-[var(--text)]">{value}</div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
      <div className="text-[11px] text-[var(--text-muted)]">{label}</div>
      <div className="text-[16px] font-semibold tabular-nums text-[var(--text)]">{value}</div>
    </div>
  );
}

function LeaderRow({ title, sub, value }: { title: string; sub: string; value: string }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-[var(--text)]">{title}</div>
        <div className="truncate text-[11px] text-[var(--text-muted)]">{sub}</div>
      </div>
      <span className="shrink-0 text-[13px] font-semibold tabular-nums text-[var(--text)]">{value}</span>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="py-2 text-[12px] text-[var(--text-muted)]">{children}</div>;
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center bg-[var(--bg)] text-[13px] text-[var(--text-muted)]">
      {children}
    </div>
  );
}
