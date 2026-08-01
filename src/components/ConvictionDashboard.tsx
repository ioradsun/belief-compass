/**
 * Conviction Dashboard — the financial STORY of a wallet's journey, not an
 * accounting page. It answers one question: "Is my conviction making me money?"
 *
 * Beginning → what do I have today (hero). Middle → where it came from (the three
 * ways value is created: holding, trading, creating) + creator earnings + best
 * markets. End → today + what to do next (insights). No fees/revenue/P&L/realized/
 * cost-basis language anywhere in the UI — see the copy rules in the build spec.
 *
 * Every number is real: story data is an indexed read (getConvictionDashboard),
 * creator earnings are contract truth read on-chain here, and the claim uses the
 * same signed sweep as the account menu. Nothing is invented.
 */
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, useReadContracts } from "wagmi";
import { formatEther } from "viem";
import { getConvictionDashboard } from "@/lib/conviction-dashboard.functions";
import { FEES_ABI, useFeeBalances, useClaimFees } from "@/lib/creator-fees";
import { PROXY_ADDRESS, CHAIN_ID } from "@/chain/decoder";
import { gainBreakdown } from "@/domain/conviction-dashboard";

// --- formatting: simple words, simple numbers ------------------------------
const fmtUsd = (n: number, sign = false): string => {
  const v = Math.abs(n);
  const body =
    v >= 1000
      ? v.toLocaleString(undefined, { maximumFractionDigits: 0 })
      : v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const s = n < 0 ? "−" : sign ? "+" : "";
  return `${s}$${body}`;
};
const fmtEth = (wei: bigint | null | undefined): string => {
  if (wei == null) return "Ξ0.000";
  const n = Number(formatEther(wei));
  return `Ξ${n < 0.0001 && n > 0 ? "<0.001" : n.toFixed(3)}`;
};
const weiToUsd = (wei: bigint | null | undefined, ethUsd: number): number =>
  wei == null || !(ethUsd > 0) ? 0 : Number(formatEther(wei)) * ethUsd;

export function ConvictionDashboard({
  wallet,
  onSelectMarket,
  onCreate,
  onExplore,
}: {
  /** The effective (POV/trading) wallet whose story this is. */
  wallet?: string;
  onSelectMarket: (id: number) => void;
  onCreate?: () => void;
  onExplore?: () => void;
}) {
  const { address } = useAccount();

  const { data, isLoading } = useQuery({
    queryKey: ["conviction-dashboard", wallet ?? null],
    queryFn: async () => await getConvictionDashboard({ data: { wallet: wallet as string } }),
    enabled: !!wallet,
    // The realtime coordinator moves the numbers underneath; this is a slow
    // reconcile, never the primary freshness path.
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });

  const ethUsd = data?.ethUsd ?? 0;

  // Available (unclaimed) creator earnings — contract truth, only for the wallet
  // that is actually connected (the claim pays msg.sender).
  const { creator: availableWei, refetch: refetchFees } = useFeeBalances(
    address as `0x${string}` | undefined,
  );

  // Lifetime + per-market creator earnings: one multicall over the created set.
  const createdIds = useMemo(
    () => (data?.createdMarkets ?? []).map((m) => m.onchainId),
    [data?.createdMarkets],
  );
  const feeReads = useReadContracts({
    contracts: createdIds.map((id) => ({
      address: PROXY_ADDRESS as `0x${string}`,
      abi: FEES_ABI,
      functionName: "creatorFeesPerMarket" as const,
      args: [BigInt(id)] as const,
      chainId: CHAIN_ID,
    })),
    query: { enabled: createdIds.length > 0 },
  });
  const feeByMarket = useMemo(() => {
    const m = new Map<number, bigint>();
    const reads = (feeReads.data ?? []) as ReadonlyArray<{ status: string; result?: unknown }>;
    reads.forEach((r, i) => {
      if (r.status === "success" && typeof r.result === "bigint") m.set(createdIds[i], r.result);
    });
    return m;
  }, [feeReads.data, createdIds]);
  const lifetimeWei = useMemo(
    () => Array.from(feeByMarket.values()).reduce((s, w) => s + w, 0n),
    [feeByMarket],
  );

  const claim = useClaimFees();

  // --- the story numbers (all real) -----------------------------------------
  const holdingGain = data?.holdings.gainUsd ?? 0;
  const tradingGain = data?.trading.realizedUsd ?? 0;
  const creatingGain = weiToUsd(lifetimeWei, ethUsd);
  const availableUsd = weiToUsd(availableWei, ethUsd);

  const worth = data?.holdings.worthUsd ?? 0;
  const totalValue = worth + availableUsd;
  const totalValueEth = ethUsd > 0 ? totalValue / ethUsd : 0;
  const sinceStart = holdingGain + tradingGain + creatingGain;

  const sources = gainBreakdown([
    { key: "holding", label: "Holding Markets", usd: holdingGain },
    { key: "trading", label: "Trading", usd: tradingGain },
    { key: "creating", label: "Creating Markets", usd: creatingGain },
  ]);

  const bestMarkets = useMemo(() => {
    return (data?.createdMarkets ?? [])
      .map((m) => ({ ...m, earnedUsd: weiToUsd(feeByMarket.get(m.onchainId) ?? 0n, ethUsd) }))
      .sort((a, b) => b.earnedUsd - a.earnedUsd)
      .slice(0, 6);
  }, [data?.createdMarkets, feeByMarket, ethUsd]);

  const insights = useMemo(
    () =>
      buildInsights({
        sources,
        bestMarkets,
        creatingGain,
        tradingGain,
        thisWeekUsd: data?.creatorWindows.thisWeekUsd ?? 0,
        lastWeekUsd: data?.creatorWindows.lastWeekUsd ?? 0,
      }),
    [sources, bestMarkets, creatingGain, tradingGain, data?.creatorWindows],
  );

  // Today — the tiles that actually have something to say (Markets → Trading →
  // Portfolio), so an idle day never shows a row of $0.00.
  const todayTiles = (
    [
      data && data.today.creatorEarnedUsd !== 0
        ? { label: "Markets", usd: data.today.creatorEarnedUsd }
        : null,
      data && data.trading.realizedTodayUsd !== 0
        ? { label: "Trading", usd: data.trading.realizedTodayUsd }
        : null,
      data && data.today.portfolioUsd !== 0
        ? { label: "Portfolio", usd: data.today.portfolioUsd }
        : null,
    ] as Array<{ label: string; usd: number } | null>
  ).filter((t): t is { label: string; usd: number } => t !== null);

  if (!wallet) {
    return <Centered>Connect a wallet to see your Conviction.</Centered>;
  }
  if (isLoading && !data) {
    return <Centered>Loading your Conviction…</Centered>;
  }

  const hasHoldings = (data?.holdings.count ?? 0) > 0;
  const hasCreated = createdIds.length > 0;
  const hasTrades = tradingGain !== 0 || hasHoldings;
  const brandNew = !hasHoldings && !hasCreated && !hasTrades && sinceStart === 0;

  return (
    <div className="mx-auto w-full max-w-[560px] pb-16">
      {/* SECTION 1 — Your Conviction (hero) */}
      <section className="pt-2 text-center">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
          Your Conviction
        </div>
        <div className="mt-3 text-[13px] text-[var(--text-muted)]">Total Value</div>
        <div className="mt-1 text-[52px] font-semibold leading-none tracking-[-0.03em] text-[var(--text)] tabular-nums">
          Ξ{totalValueEth.toFixed(2)}
        </div>
        <div className="mt-2 text-[16px] text-[var(--text-secondary)] tabular-nums">
          ≈ {fmtUsd(totalValue)}
        </div>
        {sinceStart !== 0 && (
          <div className="mt-4 inline-flex items-baseline gap-1.5 text-[13px]">
            <span className="text-[var(--text-muted)]">Since you started</span>
            <span
              className="font-semibold tabular-nums"
              style={{ color: sinceStart >= 0 ? "var(--yes)" : "var(--no)" }}
            >
              {fmtUsd(sinceStart, true)}
            </span>
          </div>
        )}
      </section>

      {brandNew ? (
        <Empty
          className="mt-10"
          title="Your story starts now."
          body="Back markets you believe in and create markets others trade — your Conviction will grow here."
          cta={onExplore ? { label: "Explore markets", onClick: onExplore } : undefined}
        />
      ) : (
        <>
          {/* SECTION 2 — Where your gains came from */}
          {sinceStart !== 0 && (
            <section className="mt-10">
              <SectionTitle>Where your gains came from</SectionTitle>
              <div className="mt-3 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
                {sources.map((s, i) => (
                  <div
                    key={s.key}
                    className={`flex items-center gap-3 px-4 py-3.5 ${i > 0 ? "border-t border-[var(--border)]" : ""}`}
                  >
                    <SourceIcon kind={s.key} />
                    <span className="text-[14px] text-[var(--text)]">{s.label}</span>
                    <span className="ml-auto flex items-baseline gap-2">
                      <span
                        className="text-[15px] font-semibold tabular-nums"
                        style={{ color: s.usd >= 0 ? "var(--yes)" : "var(--no)" }}
                      >
                        {fmtUsd(s.usd, true)}
                      </span>
                      {s.pct != null && (
                        <span className="w-8 text-right text-[12px] text-[var(--text-muted)] tabular-nums">
                          {s.pct}%
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* SECTION 3 — Creator Earnings */}
          <section className="mt-10">
            <SectionTitle>Creator Earnings</SectionTitle>
            {!address ? (
              <Empty
                className="mt-3"
                title="Connect your creator wallet"
                body="Connect the wallet you created markets with to see and collect your earnings."
              />
            ) : !hasCreated ? (
              <Empty
                className="mt-3"
                title="Create a market that people love."
                body="When others trade your markets, you'll earn a share of every trade."
                cta={onCreate ? { label: "Create a market", onClick: onCreate } : undefined}
              />
            ) : (
              <div className="mt-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
                <p className="text-[12px] leading-relaxed text-[var(--text-muted)]">
                  Your markets keep earning while people trade them.
                </p>
                <div className="mt-4 flex items-end justify-between">
                  <div>
                    <div className="text-[12px] text-[var(--text-muted)]">Lifetime</div>
                    <div className="mt-0.5 text-[24px] font-semibold tabular-nums text-[var(--text)]">
                      {fmtEth(lifetimeWei)}
                    </div>
                    <div className="text-[12px] text-[var(--text-muted)] tabular-nums">
                      ≈ {fmtUsd(creatingGain)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[12px] text-[var(--text-muted)]">Available</div>
                    <div className="mt-0.5 text-[24px] font-semibold tabular-nums text-[var(--text)]">
                      {fmtEth(availableWei)}
                    </div>
                    <div className="text-[12px] text-[var(--text-muted)] tabular-nums">
                      ≈ {fmtUsd(availableUsd)}
                    </div>
                  </div>
                </div>

                <ClaimButton
                  available={availableWei}
                  claim={claim}
                  onClaimed={() => void refetchFees()}
                />
              </div>
            )}
          </section>

          {/* SECTION 4 — Your Best Markets */}
          {hasCreated && bestMarkets.some((m) => m.earnedUsd > 0 || m.volumeUsd > 0) && (
            <section className="mt-10">
              <SectionTitle>Your Best Markets</SectionTitle>
              <div className="mt-3 space-y-2.5">
                {bestMarkets.map((m) => (
                  <button
                    key={m.onchainId}
                    type="button"
                    onClick={() => onSelectMarket(m.onchainId)}
                    className="block w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-left transition-colors hover:border-[var(--text-muted)]/40"
                  >
                    <div className="text-[14px] font-semibold leading-snug text-[var(--text)]">
                      {m.title}
                    </div>
                    <div className="mt-2.5 flex items-center gap-5">
                      <Stat label="Earned" value={fmtUsd(m.earnedUsd, m.earnedUsd > 0)} accent />
                      <Stat label="Volume" value={fmtUsd(m.volumeUsd)} />
                      <Stat label="Trades" value={m.trades.toLocaleString("en-US")} />
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* SECTION 5 — Today */}
          {data && todayTiles.length > 0 && (
            <section className="mt-10">
              <SectionTitle>Today</SectionTitle>
              <div className="mt-3 flex gap-2.5">
                {todayTiles.map((t) => (
                  <TodayTile key={t.label} label={t.label} usd={t.usd} />
                ))}
              </div>
            </section>
          )}

          {/* SECTION 6 — Insights */}
          {insights.length > 0 && (
            <section className="mt-10">
              <SectionTitle>Insights</SectionTitle>
              <div className="mt-3 space-y-2">
                {insights.map((t, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[13px] leading-snug text-[var(--text-secondary)]"
                  >
                    {t}
                  </div>
                ))}
              </div>
            </section>
          )}

          {!hasHoldings && (
            <Empty
              className="mt-10"
              title="Back markets you believe in."
              body="Your investments will appear here."
              cta={onExplore ? { label: "Explore markets", onClick: onExplore } : undefined}
            />
          )}
        </>
      )}
    </div>
  );
}

// --- insight generation (only real, teaching lines — no filler) -------------
function buildInsights({
  sources,
  bestMarkets,
  creatingGain,
  tradingGain,
  thisWeekUsd,
  lastWeekUsd,
}: {
  sources: ReturnType<typeof gainBreakdown>;
  bestMarkets: Array<{ category: string | null; earnedUsd: number }>;
  creatingGain: number;
  tradingGain: number;
  thisWeekUsd: number;
  lastWeekUsd: number;
}): string[] {
  const out: string[] = [];

  // Week-over-week creator momentum — exact (same on-chain facts as lifetime).
  if (lastWeekUsd > 0 && thisWeekUsd > lastWeekUsd * 1.5) {
    const x = thisWeekUsd / lastWeekUsd;
    out.push(`Your markets earned ${x >= 2 ? `${Math.round(x)}×` : `${Math.round((x - 1) * 100)}%`} more this week.`);
  } else if (lastWeekUsd === 0 && thisWeekUsd > 0) {
    out.push("Your markets started earning this week.");
  }

  const strongest = [...sources].filter((s) => s.usd > 0).sort((a, b) => b.usd - a.usd)[0];
  if (strongest) out.push(`${strongest.label} is your strongest source of value.`);

  // Top category by creator earnings.
  const byCat = new Map<string, number>();
  for (const m of bestMarkets) {
    if (!m.category || m.earnedUsd <= 0) continue;
    byCat.set(m.category, (byCat.get(m.category) ?? 0) + m.earnedUsd);
  }
  const topCat = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topCat) out.push(`${cap(topCat[0])} generates your highest creator earnings.`);

  // Creator earnings covering trading losses is a genuinely useful, real fact.
  if (creatingGain > 0 && tradingGain < 0 && creatingGain >= Math.abs(tradingGain)) {
    out.push("Your creator earnings have more than covered your trading losses.");
  }

  return out.slice(0, 3);
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// --- small presentational pieces -------------------------------------------
function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
      {children}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)]">{label}</div>
      <div
        className="text-[14px] font-semibold tabular-nums"
        style={{ color: accent ? "var(--yes)" : "var(--text)" }}
      >
        {value}
      </div>
    </div>
  );
}

function TodayTile({ label, usd }: { label: string; usd: number }) {
  return (
    <div className="flex-1 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">{label}</div>
      <div
        className="mt-1 text-[18px] font-semibold tabular-nums"
        style={{ color: usd >= 0 ? "var(--yes)" : "var(--no)" }}
      >
        {fmtUsd(usd, true)}
      </div>
    </div>
  );
}

function SourceIcon({ kind }: { kind: "holding" | "trading" | "creating" }) {
  const glyph = kind === "holding" ? "◆" : kind === "trading" ? "⇄" : "✦";
  return (
    <span
      className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px]"
      style={{ background: "var(--surface-2,var(--border))", color: "var(--text-secondary)" }}
      aria-hidden
    >
      {glyph}
    </span>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center px-6 text-center text-[13px] text-[var(--text-muted)]">
      {children}
    </div>
  );
}

function Empty({
  title,
  body,
  cta,
  className = "",
}: {
  title: string;
  body: string;
  cta?: { label: string; onClick: () => void };
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-dashed border-[var(--border)] p-6 text-center ${className}`}
    >
      <div className="text-[14px] font-semibold text-[var(--text)]">{title}</div>
      <p className="mx-auto mt-1.5 max-w-[38ch] text-[13px] leading-relaxed text-[var(--text-muted)]">
        {body}
      </p>
      {cta && (
        <button
          type="button"
          onClick={cta.onClick}
          className="mt-4 rounded-full px-5 py-2.5 text-[13px] font-semibold text-[var(--bg)] transition-opacity hover:opacity-90"
          style={{ background: "var(--text)" }}
        >
          {cta.label}
        </button>
      )}
    </div>
  );
}

function ClaimButton({
  available,
  claim,
  onClaimed,
}: {
  available: bigint | null;
  claim: ReturnType<typeof useClaimFees>;
  onClaimed: () => void;
}) {
  const hasBalance = (available ?? 0n) > 0n;
  const busy = claim.pending === "creator" || (claim.isMining && claim.pending === null);

  // Refresh the on-chain balance once the sweep confirms (Available → 0).
  const onClaimedRef = useRef(onClaimed);
  onClaimedRef.current = onClaimed;
  useEffect(() => {
    if (claim.isSuccess) onClaimedRef.current();
  }, [claim.isSuccess]);

  return (
    <div className="mt-5">
      <button
        type="button"
        disabled={!hasBalance || busy}
        onClick={() => void claim.claim("creator")}
        className="w-full rounded-full py-3 text-[14px] font-semibold text-[var(--bg)] transition-opacity enabled:hover:opacity-90 disabled:opacity-40"
        style={{ background: "var(--text)" }}
      >
        {busy ? "Collecting…" : claim.isSuccess ? "Collected ✓" : "Claim Earnings"}
      </button>
      {claim.error && (
        <p className="mt-2 text-center text-[12px] text-[var(--no)]">{claim.error.message}</p>
      )}
    </div>
  );
}
