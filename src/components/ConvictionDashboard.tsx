/**
 * Conviction Dashboard — the complete STORY of a wallet's conviction, read top to
 * bottom. Not accounting, not a portfolio. It answers five things: how am I doing,
 * how did I get here, what's working, what have I accomplished, what's next.
 *
 * Desktop: a thin sticky scroll-spy nav + one long scrolling story. No tabs, no
 * modals. Copy rules: never fees / revenue / realized / cost basis / P&L / wallet
 * balance — see the build spec. Every number is real (indexed reads + on-chain
 * creator truth + the tested money math in domain/conviction-dashboard).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, useReadContracts } from "wagmi";
import { formatEther } from "viem";
import { getConvictionDashboard } from "@/lib/conviction-dashboard.functions";
import { FEES_ABI, useFeeBalances, useClaimFees } from "@/lib/creator-fees";
import { PROXY_ADDRESS, CHAIN_ID } from "@/chain/decoder";
import { gainBreakdown, buildMilestones } from "@/domain/conviction-dashboard";

const fmtUsd = (n: number, sign = false): string => {
  const v = Math.abs(n);
  const body =
    v >= 1000
      ? v.toLocaleString(undefined, { maximumFractionDigits: 0 })
      : v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? "−" : sign ? "+" : ""}$${body}`;
};
const weiToUsd = (wei: bigint | null | undefined, ethUsd: number): number =>
  wei == null || !(ethUsd > 0) ? 0 : Number(formatEther(wei)) * ethUsd;

type SectionId = "overview" | "progress" | "markets" | "milestones" | "activity" | "settings";
const SECTIONS: { id: SectionId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "progress", label: "Progress" },
  { id: "markets", label: "Markets" },
  { id: "milestones", label: "Milestones" },
  { id: "activity", label: "Activity" },
  { id: "settings", label: "Settings" },
];

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let p = el?.parentElement ?? null;
  while (p) {
    const oy = getComputedStyle(p).overflowY;
    if (oy === "auto" || oy === "scroll") return p;
    p = p.parentElement;
  }
  return null;
}

export function ConvictionDashboard({
  wallet,
  onSelectMarket,
  onCreate,
  onExplore,
}: {
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
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });

  const ethUsd = data?.ethUsd ?? 0;
  const { creator: availableWei, refetch: refetchFees } = useFeeBalances(
    address as `0x${string}` | undefined,
  );

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
  const worthToday = data?.holdings.worthUsd ?? 0;
  const putIn = data?.progress.putInUsd ?? 0;
  const cashedOut = data?.progress.cashedOutUsd ?? 0;
  const holdingGain = data?.holdings.gainUsd ?? 0;
  const tradingGain = data?.trading.realizedUsd ?? 0;
  const creatingGain = weiToUsd(lifetimeWei, ethUsd);
  const availableUsd = weiToUsd(availableWei, ethUsd);
  const sinceStart = holdingGain + tradingGain + creatingGain;

  const sources = gainBreakdown([
    { key: "holding", label: "Holding Markets", usd: holdingGain },
    { key: "trading", label: "Trading", usd: tradingGain },
    { key: "creating", label: "Creating Markets", usd: creatingGain },
  ]);

  const createdEarnings = useMemo(
    () =>
      (data?.createdMarkets ?? []).map((m) => ({
        ...m,
        earnedUsd: weiToUsd(feeByMarket.get(m.onchainId) ?? 0n, ethUsd),
      })),
    [data?.createdMarkets, feeByMarket, ethUsd],
  );

  // Best Markets — held positions and created markets in one ranked list.
  const bestMarkets = useMemo(() => {
    const held = (data?.heldBest ?? []).map((h) => ({
      onchainId: h.onchainId,
      title: h.title,
      amountUsd: h.gainUsd,
      kind: "Held" as const,
    }));
    const created = createdEarnings
      .filter((m) => m.earnedUsd > 0)
      .map((m) => ({
        onchainId: m.onchainId,
        title: m.title,
        amountUsd: m.earnedUsd,
        kind: "Created" as const,
      }));
    return [...held, ...created].sort((a, b) => b.amountUsd - a.amountUsd).slice(0, 6);
  }, [data?.heldBest, createdEarnings]);

  const maxMarketVolumeUsd = useMemo(
    () => createdEarnings.reduce((mx, m) => Math.max(mx, m.volumeUsd), 0),
    [createdEarnings],
  );

  const milestones = useMemo(
    () =>
      buildMilestones({
        createdCount: createdIds.length,
        tradeCount: data?.facts.tradeCount ?? 0,
        sinceStartUsd: sinceStart,
        hasProfit: data?.facts.hasProfit ?? false,
        creatorLifetimeUsd: creatingGain,
        hasClaimed: creatingGain > 0 && creatingGain - availableUsd > 0.01,
        maxMarketVolumeUsd,
        longestHeldDays: data?.facts.longestHeldDays ?? 0,
        totalValueUsd: worthToday,
      }),
    [
      createdIds.length,
      data?.facts,
      sinceStart,
      creatingGain,
      availableUsd,
      maxMarketVolumeUsd,
      worthToday,
    ],
  );

  const insight = useMemo(
    () =>
      pickInsight({
        sources,
        createdEarnings,
        thisWeekUsd: data?.creatorWindows.thisWeekUsd ?? 0,
        lastWeekUsd: data?.creatorWindows.lastWeekUsd ?? 0,
      }),
    [sources, createdEarnings, data?.creatorWindows],
  );

  const netToday =
    (data?.today.portfolioUsd ?? 0) +
    (data?.trading.realizedTodayUsd ?? 0) +
    (data?.today.creatorEarnedUsd ?? 0);

  const hasCreated = createdIds.length > 0;
  const activeMarkets = (data?.holdings.count ?? 0) + createdIds.length;

  // --- scroll-spy ------------------------------------------------------------
  const rootRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<SectionId>("overview");
  useEffect(() => {
    if (!data) return;
    const root = findScrollParent(rootRef.current);
    const obs = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id as SectionId);
      },
      { root, rootMargin: "-15% 0px -75% 0px", threshold: 0 },
    );
    for (const s of SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, [data]);
  const go = (id: SectionId) =>
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  const navSummary: Record<SectionId, string> = {
    overview: fmtUsd(worthToday),
    progress: fmtUsd(sinceStart, true),
    markets: `${activeMarkets} Active`,
    milestones: `${milestones.unlocked} Unlocked`,
    activity: `${data?.activity.tradesTodayCount ?? 0} Today`,
    settings: "",
  };

  if (!wallet) return <Centered>Connect a wallet to see your Conviction.</Centered>;
  if (isLoading && !data) return <Centered>Loading your Conviction…</Centered>;

  return (
    <div ref={rootRef} className="mx-auto w-full max-w-[860px] px-1">
      <div className="flex gap-8">
        {/* Left — thin sticky scroll-spy nav (desktop only) */}
        <nav className="sticky top-2 hidden h-max w-[150px] shrink-0 flex-col gap-0.5 self-start pt-2 lg:flex">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => go(s.id)}
              className="group rounded-lg px-3 py-2 text-left transition-colors"
              style={{
                background: active === s.id ? "var(--surface)" : "transparent",
              }}
            >
              <div
                className="text-[13px] font-medium"
                style={{ color: active === s.id ? "var(--text)" : "var(--text-secondary)" }}
              >
                {s.label}
              </div>
              {navSummary[s.id] && (
                <div className="text-[11px] tabular-nums text-[var(--text-muted)]">
                  {navSummary[s.id]}
                </div>
              )}
            </button>
          ))}
        </nav>

        {/* Right — one long scrolling story */}
        <div className="min-w-0 flex-1 pb-24">
          {/* SECTION 1 — Overview (the one hero) */}
          <section id="overview" className="scroll-mt-4 pt-2">
            <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
              Your Conviction
            </div>
            <div className="mt-4 text-[13px] text-[var(--text-muted)]">Worth Today</div>
            <div className="mt-1 text-[56px] font-semibold leading-none tracking-[-0.035em] text-[var(--text)] tabular-nums">
              {fmtUsd(worthToday)}
            </div>
            {sinceStart !== 0 && (
              <div className="mt-3 text-[15px] tabular-nums">
                <span
                  className="font-semibold"
                  style={{ color: sinceStart >= 0 ? "var(--yes)" : "var(--no)" }}
                >
                  {fmtUsd(sinceStart, true)}
                </span>
                <span className="text-[var(--text-muted)]"> since you started</span>
              </div>
            )}
            <p className="mt-4 max-w-[46ch] text-[13px] leading-relaxed text-[var(--text-muted)]">
              Everything you&rsquo;ve built through investing, trading and creating.
            </p>
          </section>

          {/* SECTION 2 — Progress (the money-flow story) */}
          <Section id="progress" title="Progress">
            <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
              <FlowRow label="You Put In" value={fmtUsd(putIn)} />
              <FlowRow label="Worth Today" value={fmtUsd(worthToday)} strong />
              <FlowRow label="You've Cashed Out" value={fmtUsd(cashedOut)} />
              <FlowRow label="Your Markets Earned" value={fmtUsd(creatingGain)} />
            </div>
            {hasCreated && (
              <div className="mt-3 flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5">
                <div>
                  <div className="text-[12px] text-[var(--text-muted)]">Available</div>
                  <div className="text-[18px] font-semibold tabular-nums text-[var(--text)]">
                    {fmtUsd(availableUsd)}
                  </div>
                </div>
                <ClaimButton available={availableWei} claim={claim} onClaimed={refetchFees} />
              </div>
            )}
          </Section>

          {/* SECTION 3 — What's Working */}
          {sinceStart !== 0 && (
            <Section id="whats-working" title="What's Working" anchorless>
              <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
                {sources.map((s, i) => (
                  <div
                    key={s.key}
                    className={`flex items-center px-4 py-3.5 ${i > 0 ? "border-t border-[var(--border)]" : ""}`}
                  >
                    <span className="text-[14px] text-[var(--text)]">{s.label}</span>
                    <span
                      className="ml-auto text-[15px] font-semibold tabular-nums"
                      style={{ color: s.usd >= 0 ? "var(--yes)" : "var(--no)" }}
                    >
                      {fmtUsd(s.usd, true)}
                    </span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* SECTION 4 — Your Best Markets (held + created) */}
          <Section id="markets" title="Your Best Markets">
            {bestMarkets.length === 0 ? (
              <Empty
                title="Back markets you believe in."
                body="Your best-performing convictions and created markets will appear here."
                cta={onExplore ? { label: "Explore markets", onClick: onExplore } : undefined}
              />
            ) : (
              <div className="space-y-2">
                {bestMarkets.map((m) => (
                  <button
                    key={`${m.kind}-${m.onchainId}`}
                    type="button"
                    onClick={() => onSelectMarket(m.onchainId)}
                    className="flex w-full items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-left transition-colors hover:border-[var(--text-muted)]/40"
                  >
                    <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-[var(--text)]">
                      {m.title}
                    </span>
                    <span
                      className="shrink-0 text-[14px] font-semibold tabular-nums"
                      style={{ color: "var(--yes)" }}
                    >
                      {fmtUsd(m.amountUsd, true)}
                    </span>
                    <Badge kind={m.kind} />
                  </button>
                ))}
              </div>
            )}
          </Section>

          {/* SECTION 5 — Milestones */}
          <Section id="milestones" title="Milestones">
            <div className="mb-3 flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--border)]">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${milestones.pct}%`, background: "var(--yes)" }}
                />
              </div>
              <span className="text-[12px] font-semibold tabular-nums text-[var(--text-secondary)]">
                {milestones.pct}%
              </span>
            </div>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {milestones.list.map((m) => (
                <div
                  key={m.key}
                  className="flex items-center gap-2.5 rounded-lg px-1 py-1.5"
                  style={{ opacity: m.done ? 1 : 0.5 }}
                >
                  <span
                    className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px]"
                    style={{
                      background: m.done ? "var(--yes)" : "transparent",
                      border: m.done ? "none" : "1.5px solid var(--border)",
                      color: m.done ? "var(--bg)" : "transparent",
                    }}
                    aria-hidden
                  >
                    ✓
                  </span>
                  <span
                    className="text-[13px]"
                    style={{ color: m.done ? "var(--text)" : "var(--text-muted)" }}
                  >
                    {m.label}
                  </span>
                </div>
              ))}
            </div>
            {milestones.next && (
              <p className="mt-3 text-[12px] text-[var(--text-muted)]">
                Next: <span className="text-[var(--text-secondary)]">{milestones.next.label}</span>
              </p>
            )}
          </Section>

          {/* SECTION 6 — Recent Activity */}
          <Section id="activity" title="Recent Activity">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
              <div className="text-[12px] text-[var(--text-muted)]">Today</div>
              <div
                className="mt-0.5 text-[28px] font-semibold tabular-nums"
                style={{ color: netToday >= 0 ? "var(--yes)" : "var(--no)" }}
              >
                {fmtUsd(netToday, true)}
              </div>
              <div className="mt-3 space-y-1 text-[13px] text-[var(--text-secondary)]">
                <ActivityLine
                  show={(data?.activity.tradesTodayCount ?? 0) > 0}
                  text={`${data?.activity.tradesTodayCount} trade${data?.activity.tradesTodayCount === 1 ? "" : "s"} completed`}
                />
                <ActivityLine
                  show={hasCreated && (data?.activity.uniqueTradersTodayCount ?? 0) > 0}
                  text={`${data?.activity.uniqueTradersTodayCount} ${data?.activity.uniqueTradersTodayCount === 1 ? "person" : "people"} traded your markets`}
                />
                <ActivityLine
                  show={hasCreated && (data?.today.creatorEarnedUsd ?? 0) > 0}
                  text={`${fmtUsd(data?.today.creatorEarnedUsd ?? 0, true)} creator earnings`}
                />
                {(data?.activity.tradesTodayCount ?? 0) === 0 &&
                  (data?.activity.uniqueTradersTodayCount ?? 0) === 0 && (
                    <p className="text-[var(--text-muted)]">A quiet day. Your Conviction is still working.</p>
                  )}
              </div>
            </div>
          </Section>

          {/* SECTION 7 — Insight (exactly one) */}
          {insight && (
            <Section id="insight" title="Insight" anchorless>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4 text-[15px] leading-snug text-[var(--text)]">
                {insight}
              </div>
            </Section>
          )}

          {/* Settings — minimal, read-only */}
          <Section id="settings" title="Settings">
            <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
              <FlowRow label="Wallet" value={wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : "—"} />
              <FlowRow label="Network" value="Base" />
            </div>
            {!hasCreated && (
              <Empty
                className="mt-3"
                title="Create a market that people love."
                body="When others trade your markets, you'll earn a share of every trade."
                cta={onCreate ? { label: "Create a market", onClick: onCreate } : undefined}
              />
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

// --- one rotating insight (real, computed — never filler) -------------------
function pickInsight({
  sources,
  createdEarnings,
  thisWeekUsd,
  lastWeekUsd,
}: {
  sources: ReturnType<typeof gainBreakdown>;
  createdEarnings: Array<{ category: string | null; earnedUsd: number }>;
  thisWeekUsd: number;
  lastWeekUsd: number;
}): string | null {
  const out: string[] = [];

  if (lastWeekUsd > 0 && thisWeekUsd > lastWeekUsd * 1.5) {
    const x = thisWeekUsd / lastWeekUsd;
    out.push(
      `Your markets earned ${x >= 2 ? `${Math.round(x)}×` : `${Math.round((x - 1) * 100)}%`} more this week.`,
    );
  }

  // Top category vs the next by creator earnings.
  const byCat = new Map<string, number>();
  for (const m of createdEarnings) {
    if (!m.category || m.earnedUsd <= 0) continue;
    byCat.set(m.category, (byCat.get(m.category) ?? 0) + m.earnedUsd);
  }
  const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  if (cats.length >= 2 && cats[1][1] > 0 && cats[0][1] >= cats[1][1] * 2) {
    const x = cats[0][1] / cats[1][1];
    out.push(`${cap(cats[0][0])} earns you ${Math.round(x)}× more than ${cap(cats[1][0])}.`);
  } else if (cats.length === 1) {
    out.push(`${cap(cats[0][0])} generates all of your creator earnings.`);
  }

  const trading = sources.find((s) => s.key === "trading")?.usd ?? 0;
  const creating = sources.find((s) => s.key === "creating")?.usd ?? 0;
  if (creating > 0 && trading < 0 && creating >= Math.abs(trading)) {
    out.push("Your creator earnings now cover all of your trading costs.");
  }
  const strongest = [...sources].filter((s) => s.usd > 0).sort((a, b) => b.usd - a.usd)[0];
  if (strongest) out.push(`${strongest.label} is your strongest source of value.`);

  if (out.length === 0) return null;
  // Rotate daily so the page feels alive without ever overwhelming.
  const day = Math.floor(Date.now() / 86_400_000);
  return out[day % out.length];
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// --- small presentational pieces -------------------------------------------
function Section({
  id,
  title,
  children,
  anchorless,
}: {
  id: string;
  title: string;
  children: ReactNode;
  /** When true the id is a scroll anchor but not a nav target. */
  anchorless?: boolean;
}) {
  return (
    <section id={anchorless ? undefined : id} className="mt-12 scroll-mt-4">
      <div className="mb-3 text-[13px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
        {title}
      </div>
      {children}
    </section>
  );
}

function FlowRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3.5 last:border-b-0">
      <span className="text-[13px] text-[var(--text-secondary)]">{label}</span>
      <span
        className={`tabular-nums ${strong ? "text-[18px] font-semibold" : "text-[15px] font-medium"} text-[var(--text)]`}
      >
        {value}
      </span>
    </div>
  );
}

function Badge({ kind }: { kind: "Held" | "Created" }) {
  return (
    <span
      className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{
        color: kind === "Created" ? "var(--yes)" : "var(--text-muted)",
        background: "var(--surface-2,var(--border))",
      }}
    >
      {kind}
    </span>
  );
}

function ActivityLine({ show, text }: { show: boolean; text: string }) {
  if (!show) return null;
  return <div>{text}</div>;
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
    <div className={`rounded-2xl border border-dashed border-[var(--border)] p-6 text-center ${className}`}>
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
  const onClaimedRef = useRef(onClaimed);
  onClaimedRef.current = onClaimed;
  useEffect(() => {
    if (claim.isSuccess) onClaimedRef.current();
  }, [claim.isSuccess]);

  return (
    <button
      type="button"
      disabled={!hasBalance || busy}
      onClick={() => void claim.claim("creator")}
      className="shrink-0 rounded-full px-5 py-2.5 text-[13px] font-semibold text-[var(--bg)] transition-opacity enabled:hover:opacity-90 disabled:opacity-40"
      style={{ background: "var(--text)" }}
    >
      {busy ? "Collecting…" : claim.isSuccess ? "Collected ✓" : "Claim Earnings"}
    </button>
  );
}
