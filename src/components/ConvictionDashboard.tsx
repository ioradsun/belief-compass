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
import { useMoney } from "@/lib/display-unit";
import { Signed } from "@/components/Signed";

import { FEES_ABI, useFeeBalances, useClaimFees } from "@/lib/creator-fees";
import { PROXY_ADDRESS, CHAIN_ID } from "@/chain/decoder";
import {
  gainBreakdown,
  journeyMath,
  buildMilestones,
  milestonePct,
  type Milestone,
} from "@/domain/conviction-dashboard";

const fmtPct = (n: number): string =>
  `${n < 0 ? "−" : "+"}${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
/**
 * Creator fees are read from the contract in wei, so they are priced here rather
 * than on the server. Reached only after the `ethUsd == null` guard above, which
 * is what makes the zero unreachable rather than merely unlikely.
 */
const weiToUsd = (wei: bigint | null | undefined, ethUsd: number): number =>
  wei == null || !(ethUsd > 0) ? 0 : Number(formatEther(wei)) * ethUsd;

type SectionId = "overview" | "journey" | "edge" | "wins" | "milestones" | "today";
const SECTIONS: { id: SectionId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "journey", label: "Your Journey" },
  { id: "edge", label: "Your Edge" },
  { id: "wins", label: "Biggest Wins" },
  { id: "milestones", label: "Milestones" },
  { id: "today", label: "Today" },
];

/** One-line coaching copy that turns an Edge number into identity. */
function edgeCopy(key: string, usd: number): string {
  if (key === "holding")
    return usd >= 0
      ? "You're strongest when you stay patient."
      : "Your held convictions are still maturing — patience tends to pay.";
  if (key === "trading")
    return usd >= 0
      ? "Quick decisions have added steady gains."
      : "Trading has cost a little — your other edges are carrying you.";
  return usd > 0
    ? "Your questions keep generating activity."
    : "Create a market and start earning while others trade.";
}

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
    // Same as the person profile: computed on read, no worker to wait for, and
    // a dashboard the reader is looking at. Focus and reconnect refetching
    // cover the return; the timer only re-ran the build.
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const ethUsd = data?.ethUsd ?? 0;
  // Every figure below is USD-native; the shared formatter renders it in the
  // viewer's chosen unit (USD/ETH) via the one global rate. Calculations that feed
  // the domain (weiToUsd → journeyMath) stay in USD, unchanged.
  const { format } = useMoney();
  const fmtUsd = (n: number, sign = false): string => format(n, "USD", { signed: sign });
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

  // The reconciling journey identity (see domain/conviction-dashboard).
  const tradingFees = data?.progress.tradingFeesUsd ?? 0;
  const journey = journeyMath({
    investedUsd: putIn,
    currentValueUsd: worthToday,
    withdrawnUsd: cashedOut,
    creatorUsd: creatingGain,
    feesUsd: tradingFees,
  });
  const winningMarkets = (data?.heldBest ?? []).filter((h) => h.gainUsd > 0).length;

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

  // Today's Story — stories are remembered, lists aren't.
  const todaySentences: string[] = (() => {
    const s: string[] = [];
    const traders = data?.activity.uniqueTradersTodayCount ?? 0;
    const trades = data?.activity.tradesTodayCount ?? 0;
    const earned = data?.today.creatorEarnedUsd ?? 0;
    if (hasCreated && traders > 0)
      s.push(`${traders} ${traders === 1 ? "person" : "people"} traded your markets.`);
    if (trades > 0) s.push(`You made ${trades} ${trades === 1 ? "trade" : "trades"} today.`);
    if (netToday !== 0)
      s.push(
        netToday > 0
          ? `Your conviction grew by ${fmtUsd(netToday)}.`
          : `Your conviction dipped by ${fmtUsd(Math.abs(netToday))}.`,
      );
    if (hasCreated && earned > 0)
      s.push(`You earned another ${fmtUsd(earned)} while you were away.`);
    return s;
  })();

  // One lifetime sentence under the hero — identity, not accounting.
  const lifetimeLine: string | null = (() => {
    const reached = data?.peopleReached ?? 0;
    const trades = data?.facts.tradeCount ?? 0;
    const ideas = data?.facts.ideasBacked ?? 0;
    if (reached > 0)
      return `Since joining Conviction, ${reached.toLocaleString("en-US")} ${reached === 1 ? "person has" : "people have"} traded alongside your ideas.`;
    if (trades > 0)
      return `Since joining Conviction, you've backed ${ideas} idea${ideas === 1 ? "" : "s"} across ${trades.toLocaleString("en-US")} trade${trades === 1 ? "" : "s"}.`;
    return null;
  })();

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

  const strongestEdge = [...sources].filter((s) => s.usd > 0).sort((a, b) => b.usd - a.usd)[0];
  const navSummary: Record<SectionId, string> = {
    // The nav label for a section IS that section's headline. This showed
    // `sinceStart` (holding + trading + creating, before fees) while the
    // Overview hero showed `journey.netProfitUsd` (the same story, after fees
    // and reconciled against capital in) — two different totals under one word.
    overview: fmtUsd(journey.netProfitUsd, journey.netProfitUsd !== 0),
    journey: fmtUsd(worthToday),
    edge: strongestEdge ? fmtUsd(strongestEdge.usd, true) : "",
    wins: bestMarkets.length ? `${bestMarkets.length}` : "",
    milestones: `${milestones.unlocked} Unlocked`,
    today: `${data?.activity.tradesTodayCount ?? 0} Today`,
  };

  if (!wallet) return <Centered>Connect a wallet to see your Conviction.</Centered>;
  if (isLoading && !data) return <Centered>Loading your Conviction…</Centered>;
  /**
   * NO RATE, NO DOLLARS.
   *
   * Every figure on this page is one ETH/USD rate times an ETH figure, so when
   * that rate is missing they are not fourteen unknown numbers — they are one
   * unknown, fourteen times. The server sends `ethUsd: null` to say so.
   *
   * Rendering anyway would fill the page with $0.00: "you put in nothing, you
   * are worth nothing, you earned nothing." That is not a degraded view of
   * someone's money, it is a false one, and this table has already been
   * unreadable in production for months (see lib/eth-usd.server).
   */
  if (data && data.ethUsd == null)
    return (
      <Centered>
        We can&rsquo;t price your Conviction right now — the ETH/USD rate is unavailable. Your
        positions are safe; this is our side. Try again in a moment.
      </Centered>
    );

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
          {/* SECTION 1 — Net Profit. The one number that answers "am I ahead?",
              and the number the Journey card below reconciles to exactly. */}
          <section id="overview" className="scroll-mt-4 pt-2">
            <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
              Net Profit
            </div>
            <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <Signed
                value={fmtUsd(journey.netProfitUsd, journey.netProfitUsd !== 0)}
                className="text-[56px] font-semibold leading-none tracking-[-0.035em] tabular-nums"
              />
              {journey.roiPct != null && (
                <span className="text-[18px] font-semibold tabular-nums text-[var(--text)]">
                  (<Signed value={fmtPct(journey.roiPct)} />)
                </span>
              )}
            </div>
            <p className="mt-3 max-w-[46ch] text-[13px] leading-relaxed text-[var(--text-secondary)]">
              Everything you’ve built by investing, trading, and creating markets.
            </p>
            {/* The living pulse — did my conviction grow today? */}
            {netToday !== 0 && (
              <div className="mt-3 text-[13px] font-medium tabular-nums text-[var(--text)]">
                <span style={{ color: netToday >= 0 ? "var(--gain)" : "var(--loss)" }}>
                  {netToday >= 0 ? "↑" : "↓"}
                </span>{" "}
                Today <Signed value={fmtUsd(netToday, true)} />
              </div>
            )}

          </section>

          {/* Ready to Claim — the one thing you can DO. Premium placement, right
              under the hero, only when there's something to collect. */}
          {availableUsd > 0.01 && (
            <Section id="claim" title="Ready to Claim" anchorless>
              <div className="rounded-2xl bg-[var(--surface)] p-5">
                <div className="text-[34px] font-semibold leading-none tabular-nums text-[var(--text)]">
                  {fmtUsd(availableUsd)}
                </div>
                <p className="mt-2 text-[13px] text-[var(--text-muted)]">
                  Generated while people traded your markets.
                </p>
                <div className="mt-4">
                  <ClaimButton
                    available={availableWei}
                    claim={claim}
                    onClaimed={refetchFees}
                    full
                  />
                </div>
              </div>
            </Section>
          )}

          {/* SECTION 2 — Your Journey. Four rows that reconcile exactly:
              Current Value + Withdrawn + Creator Earnings = Total Return,
              Total Return − Total Invested = Net Profit (the hero). */}
          <Section id="journey" title="Your Journey">
            {journey.empty ? (
              <div className="rounded-2xl bg-[var(--surface)] p-6 text-center">
                <div className="text-[15px] font-semibold text-[var(--text)]">
                  Start building your investing journey.
                </div>
                <p className="mx-auto mt-2 max-w-[42ch] text-[13px] leading-relaxed text-[var(--text-muted)]">
                  Back your first market or create one and earn fees every time people trade it.
                </p>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                  {onExplore && (
                    <button
                      type="button"
                      onClick={onExplore}
                      className="rounded-full px-5 py-2.5 text-[13px] font-semibold text-[var(--bg)] transition-opacity hover:opacity-90"
                      style={{ background: "var(--text)" }}
                    >
                      Browse Markets
                    </button>
                  )}
                  {onCreate && (
                    <button
                      type="button"
                      onClick={onCreate}
                      className="rounded-full border border-[var(--border)] px-5 py-2.5 text-[13px] font-semibold text-[var(--text)] transition-colors hover:border-[var(--text-muted)]"
                    >
                      Create Market
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <>
                <GroupLabel>Capital</GroupLabel>
                <div className="overflow-hidden rounded-2xl bg-[var(--surface)]">
                  <FlowRow
                    label="Total Invested"
                    hint="Total dollars you’ve committed to markets over your lifetime."
                    value={fmtUsd(journey.investedUsd)}
                  />
                </div>

                <GroupLabel>Costs</GroupLabel>
                <div className="overflow-hidden rounded-2xl bg-[var(--surface)]">
                  <FlowRow
                    label="Trading Fees Paid"
                    hint="Total buy fees you’ve paid to enter markets — what it cost you to participate, not a trading loss."
                    value={fmtUsd(journey.feesUsd)}
                  />
                </div>

                <GroupLabel>Portfolio</GroupLabel>
                <div className="overflow-hidden rounded-2xl bg-[var(--surface)]">
                  <FlowRow
                    label="Current Value"
                    hint="What your open positions are worth right now."
                    value={fmtUsd(journey.currentValueUsd)}
                  />
                  <FlowRow
                    label="Total Withdrawn"
                    hint="Money you’ve already taken back from selling positions."
                    value={fmtUsd(journey.withdrawnUsd)}
                  />
                  <FlowRow
                    label="Creator Earnings"
                    hint="Fees you’ve earned when other people trade markets you created."
                    value={fmtUsd(journey.creatorUsd)}
                  />
                </div>

                <GroupLabel>Overall Performance</GroupLabel>
                <div className="overflow-hidden rounded-2xl bg-[var(--surface)]">
                  <FlowRow
                    label="Total Return"
                    hint="Current Value + Total Withdrawn + Creator Earnings."
                    value={fmtUsd(journey.totalReturnUsd)}
                  />
                  <div className="flex items-center justify-between border-t border-[var(--hairline)] bg-[var(--bg)]/40 px-4 py-3.5">
                    <span className="text-[13px] font-medium text-[var(--text)]">Net Profit</span>
                    <span
                      className="text-[18px] font-semibold tabular-nums"
                      style={{ color: journey.netProfitUsd >= 0 ? "var(--gain)" : "var(--loss)" }}
                    >
                      {fmtUsd(journey.netProfitUsd, journey.netProfitUsd !== 0)}
                    </span>
                  </div>
                </div>
                <p className="mt-2.5 px-1 text-[11.5px] leading-relaxed tabular-nums text-[var(--text-muted)]">
                  {fmtUsd(journey.totalReturnUsd)} total return, minus {fmtUsd(journey.investedUsd)}{" "}
                  invested and {fmtUsd(journey.feesUsd)} in trading fees.
                </p>

                <details className="group mt-3">
                  <summary className="cursor-pointer list-none px-1 text-[12px] font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text)]">
                    <span className="group-open:hidden">Show details</span>
                    <span className="hidden group-open:inline">Hide details</span>
                  </summary>
                  <div className="mt-2 overflow-hidden rounded-2xl bg-[var(--surface)]">
                    <FlowRow
                      label="Total Spent"
                      hint="Total Invested plus Trading Fees Paid."
                      value={fmtUsd(journey.investedUsd + journey.feesUsd)}
                    />

                    <FlowRow
                      label="Lifetime ROI"
                      value={journey.roiPct == null ? "—" : fmtPct(journey.roiPct)}
                    />
                    <FlowRow label="Markets Created" value={`${createdIds.length}`} />
                    <FlowRow
                      label="Trades Made"
                      value={`${(data?.facts.tradeCount ?? 0).toLocaleString("en-US")}`}
                    />
                    <FlowRow label="Winning Markets" value={`${winningMarkets}`} />
                    <FlowRow
                      label="Longest Held Position"
                      value={
                        (data?.facts.longestHeldDays ?? 0) >= 1
                          ? `${Math.floor(data?.facts.longestHeldDays ?? 0)}d`
                          : "—"
                      }
                    />
                  </div>
                </details>
              </>
            )}
          </Section>

          {/* SECTION 3 — Your Edge (numbers become identity) */}
          {sinceStart !== 0 && (
            <Section id="edge" title="Your Edge">
              <div className="overflow-hidden rounded-2xl bg-[var(--surface)]">
                {sources.map((s, i) => (
                  <div
                    key={s.key}
                    className={`px-4 py-3.5 ${i > 0 ? "border-t border-[var(--hairline)]" : ""}`}
                  >
                    <div className="flex items-center">
                      <span className="text-[14px] font-medium text-[var(--text)]">{s.label}</span>
                      <span
                        className="ml-auto text-[15px] font-semibold tabular-nums"
                        style={{ color: s.usd >= 0 ? "var(--gain)" : "var(--loss)" }}
                      >
                        {fmtUsd(s.usd, true)}
                      </span>
                    </div>
                    <p className="mt-1 text-[12px] leading-snug text-[var(--text-muted)]">
                      {edgeCopy(s.key, s.usd)}
                    </p>
                  </div>
                ))}
                {/*
                 * RECONCILE TO THE HEADLINE. The three sources sum to gains
                 * BEFORE fees, so the section quietly ended on a number that
                 * was not the Net Profit at the top of the page. Fees are a
                 * real cost of the same story; showing them here closes the
                 * gap instead of leaving the reader to find it.
                 */}
                {tradingFees > 0 && (
                  <div className="border-t border-[var(--hairline)] px-4 py-3.5">
                    <div className="flex items-center">
                      <span className="text-[14px] font-medium text-[var(--text)]">
                        Trading Fees
                      </span>
                      <span
                        className="ml-auto text-[15px] font-semibold tabular-nums"
                        style={{ color: "var(--loss)" }}
                      >
                        {fmtUsd(-tradingFees, true)}
                      </span>
                    </div>
                    <p className="mt-1 text-[12px] leading-snug text-[var(--text-muted)]">
                      Paid to the protocol on every buy. Already counted in your Net Profit.
                    </p>
                  </div>
                )}
                <div className="border-t border-[var(--hairline)] px-4 py-3.5">
                  <div className="flex items-center">
                    <span className="text-[14px] font-semibold text-[var(--text)]">Net Profit</span>
                    <span
                      className="ml-auto text-[15px] font-semibold tabular-nums"
                      style={{
                        color: journey.netProfitUsd >= 0 ? "var(--gain)" : "var(--loss)",
                      }}
                    >
                      {fmtUsd(journey.netProfitUsd, journey.netProfitUsd !== 0)}
                    </span>
                  </div>
                </div>
              </div>

            </Section>
          )}

          {/* SECTION 4 — Biggest Wins (held + created victories) */}
          <Section id="wins" title="Biggest Wins">
            {bestMarkets.length === 0 ? (
              <Empty
                title="Your wins will show here."
                body="Back markets you believe in and create markets others trade — your best results appear here."
                cta={onExplore ? { label: "Explore markets", onClick: onExplore } : undefined}
              />
            ) : (
              <div className="space-y-2">
                {bestMarkets.map((m) => (
                  <button
                    key={`${m.kind}-${m.onchainId}`}
                    type="button"
                    onClick={() => onSelectMarket(m.onchainId)}
                    className="flex w-full items-center gap-3 rounded-xl bg-[var(--surface)] px-4 py-3 text-left transition-colors hover:border-[var(--text-muted)]/40"
                  >
                    <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-[var(--text)]">
                      {m.title}
                    </span>
                    <span
                      className="shrink-0 text-[14px] font-semibold tabular-nums"
                      style={{ color: "var(--gain)" }}
                    >
                      {fmtUsd(m.amountUsd, true)}
                    </span>
                    <Badge kind={m.kind} />
                  </button>
                ))}
              </div>
            )}
          </Section>

          {/* SECTION 5 — Milestones, with one active goal up top */}
          <Section id="milestones" title="Milestones">
            {milestones.next && <ActiveGoal goal={milestones.next} />}
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
                  className="flex items-center gap-2.5 px-1 py-1.5"
                  style={{ opacity: m.done ? 1 : 0.45 }}
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
          </Section>

          {/* SECTION 6 — Today's Story (sentences, not a list) */}
          <Section id="today" title="Today's Story">
            <div className="rounded-2xl bg-[var(--surface)] p-5 text-[15px] leading-relaxed text-[var(--text)]">
              {todaySentences.length > 0 ? (
                <div className="space-y-1.5">
                  {todaySentences.map((line, i) => (
                    <p key={i}>{line}</p>
                  ))}
                </div>
              ) : (
                <p className="text-[var(--text-muted)]">
                  A quiet day. Your conviction is still working while you&rsquo;re away.
                </p>
              )}
            </div>
          </Section>

          {/* SECTION 7 — One Insight */}
          {insight && (
            <Section id="insight" title="Insight" anchorless>
              <div className="rounded-2xl bg-[var(--surface)] px-5 py-4 text-[15px] leading-relaxed text-[var(--text)]">
                {insight}
              </div>
            </Section>
          )}

          {!hasCreated && (
            <Empty
              className="mt-12"
              title="Create a market that people love."
              body="When others trade your markets, you'll earn a share of every trade — and start reaching people."
              cta={onCreate ? { label: "Create a market", onClick: onCreate } : undefined}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** The one active goal — always answers "what am I working toward?" */
function ActiveGoal({ goal }: { goal: Milestone }) {
  const { format } = useMoney();
  const pct = milestonePct(goal);
  const usd = !goal.key.includes("trades") && goal.key !== "held-30";
  const fmt = (n: number) =>
    usd ? format(n, "USD") : goal.key === "held-30" ? `${Math.floor(n)}d` : `${Math.floor(n)}`;
  return (
    <div className="mb-4 rounded-2xl bg-[var(--surface)] p-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
        Next
      </div>
      <div className="mt-1 text-[15px] font-semibold text-[var(--text)]">{goal.label}</div>
      {pct != null && goal.current != null && goal.target != null && (
        <>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--border)]">
            <div
              className="h-full rounded-full"
              style={{ width: `${pct}%`, background: "var(--yes)" }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[12px] tabular-nums text-[var(--text-muted)]">
            <span>
              {fmt(goal.current)} / {fmt(goal.target)}
            </span>
            <span className="font-semibold text-[var(--text-secondary)]">{pct}%</span>
          </div>
        </>
      )}
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

  // Conversational, two-part: an observation, then the number that proves it.
  if (lastWeekUsd > 0 && thisWeekUsd > lastWeekUsd * 1.5) {
    const x = thisWeekUsd / lastWeekUsd;
    const amt = x >= 2 ? `${Math.round(x)}×` : `${Math.round((x - 1) * 100)}%`;
    out.push(`Your markets are heating up. They earned ${amt} more this week than last.`);
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
    out.push(
      `Some topics resonate more than others. ${cap(cats[0][0])} has earned you ${Math.round(x)}× more than ${cap(cats[1][0])}.`,
    );
  } else if (cats.length === 1) {
    out.push(
      `${cap(cats[0][0])} is your home turf — it generates all of your creator earnings so far.`,
    );
  }

  const trading = sources.find((s) => s.key === "trading")?.usd ?? 0;
  const creating = sources.find((s) => s.key === "creating")?.usd ?? 0;
  if (creating > 0 && trading < 0 && creating >= Math.abs(trading)) {
    out.push(
      "Here's the beautiful part: your creator earnings now cover all of your trading costs.",
    );
  }
  const strongest = [...sources].filter((s) => s.usd > 0).sort((a, b) => b.usd - a.usd)[0];
  if (strongest)
    out.push(`${strongest.label} is where you shine — it's your strongest source of value.`);

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

/** A small heading that separates the Journey into Capital / Costs / Portfolio. */
function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 mt-4 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)] first:mt-0">
      {children}
    </div>
  );
}

function FlowRow({
  label,
  value,
  strong,
  hint,
}: {
  label: string;
  value: string;
  strong?: boolean;
  /** Plain-language explanation, shown as a native tooltip on the label. */
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[var(--hairline)] px-4 py-3.5 last:border-b-0">
      <span className="text-[13px] text-[var(--text-secondary)]" title={hint}>
        {label}
      </span>
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
  full,
}: {
  available: bigint | null;
  claim: ReturnType<typeof useClaimFees>;
  onClaimed: () => void;
  full?: boolean;
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
      className={`rounded-full font-semibold text-[var(--bg)] transition-opacity enabled:hover:opacity-90 disabled:opacity-40 ${
        full ? "w-full py-3 text-[14px]" : "shrink-0 px-5 py-2.5 text-[13px]"
      }`}
      style={{ background: "var(--text)" }}
    >
      {busy ? "Collecting…" : claim.isSuccess ? "Collected ✓" : "Claim Earnings"}
    </button>
  );
}
