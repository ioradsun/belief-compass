/**
 * MOBILE — The Conviction Game.
 *
 * A phone is not a courtroom. Desktop asks "help me understand the market";
 * mobile asks "what do YOU believe?". So this surface deliberately hides every
 * crowd signal that could bias the answer — no YES/NO split, no charts, no
 * sparklines, no side comparison — until the viewer has committed.
 *
 * The sequence is always the same:
 *   Question → community exists → Pulse → The House → Decision → Reveal → Next.
 *
 * Presentation only: every number comes from the same server/domain modules the
 * desktop deck uses (marketBook / marketPulse / evidence / house read), so the
 * two experiences can never disagree.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSwitchChain } from "wagmi";

import type { MarketRow } from "@/components/MarketCard";
import { pulseLine } from "@/components/MarketCard";
import { MarketMomentum } from "@/components/MarketVitality";
import { WindowFilter } from "@/components/WindowFilter";
import { useDeckWindow, setDeckWindow } from "@/lib/deck-window";
import { CurrentMarketActivity } from "@/components/CurrentMarketActivity";
import { useHouseFinalize } from "@/lib/house-round";
import { getMarketChange, listMarketPulses, getMarketBaselines } from "@/lib/markets.functions";
import { windowChange } from "@/domain/window-change";
import { getMarketEvidence } from "@/lib/evidence.functions";
import { getNetwork } from "@/lib/dna.functions";
import { getConvictionMarket } from "@/lib/market-create.functions";
import { marketAgeCopy } from "@/domain/market-freshness";
import { MediaStage, stageMediaFrom } from "@/components/MediaStage";
import { StandOnIt } from "@/components/StandOnIt";
import { ShareImpact } from "@/components/ShareImpact";
import { getHouseRead } from "@/lib/house.functions";
import { houseKey } from "@/lib/house-round";
import { expressBelief } from "@/lib/beliefs.functions";
import { bestEffort, useWalletSession } from "@/hooks/useWalletSession";
import { requestConnect } from "@/lib/connect-bridge";
import { CHAIN_ID } from "@/chain/decoder";
import { useBuyQuote, useTrade, useTradeReady, useUserBalance } from "@/lib/chain-trade";
import { usdToWei, type OrderSide } from "@/domain/order";
import { useMoney } from "@/lib/display-unit";
import { OrderTicket } from "@/components/order/OrderTicket";
import { useOwnedDock, OwnedDock, ownedDockShown } from "@/components/order/OwnedDock";
import { ExamineCta } from "@/components/order/ExamineRail";
import { marketBook } from "@/domain/market-book";
import { marketPulse } from "@/domain/market-pulse";
import { houseReadState } from "@/domain/house-read";
import { ConvictionReveal } from "@/components/ConvictionReveal";
import { getConvictionReveal } from "@/domain/conviction-reveal";
import { assembleRevealInput } from "@/lib/reveal-input";

type Phase = "question" | "sides";

export function MobileGame({
  row,
  ethUsd,
  viewerWallet,
  onNext,
  onSelectPerson,
}: {
  row: MarketRow;
  ethUsd: number;
  viewerWallet?: string;
  onNext: () => void;
  onSelectPerson?: (wallet: string) => void;
}) {
  const marketId = Number(row.onchain_id);
  const title = row.markets?.title ?? `Market #${marketId}`;
  const category = row.markets?.category ?? null;

  const [phase, setPhase] = useState<Phase>("question");
  const [side, setSide] = useState<OrderSide | null>(null);
  const [backing, setBacking] = useState(false);
  const [amount, setAmount] = useState(1);
  /** The House pick has been revealed for THIS market's settled bet. */
  const [revealed, setRevealed] = useState(false);

  // A brand new question always starts from a blank slate.
  //
  // This is what makes the phone scene safe to keep MOUNTED across markets. The
  // route used to force a fresh one with `key={onchain_id}`, which threw away
  // the whole subtree — every DOM node, every query observer, every wallet hook
  // — and rebuilt it, so a phone user saw the game blink on every question.
  // Resetting the four pieces of per-market state here achieves the same clean
  // slate for free, with no unmount.
  useEffect(() => {
    setPhase("question");
    setSide(null);
    setBacking(false);
    setAmount(1);
    setRevealed(false);
    dock.reset();
    trade.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketId]);

  const qc = useQueryClient();
  const { ensureSession } = useWalletSession();
  const house = useHouseFinalize(marketId, viewerWallet);
  const express = useMutation({
    // Free belief: recorded only if the wallet already signed in for a paid
    // action — expressing an opinion never opens the wallet.
    mutationFn: async (s: OrderSide) =>
      bestEffort(async () =>
        expressBelief({
          data: {
            wallet: viewerWallet as string,
            marketId,
            side: s,
            session: await ensureSession({ interactive: false }),
          },
        }),
      ),
    onSuccess: (r) => {
      if (r && viewerWallet) qc.setQueryData(["readiness", viewerWallet.toLowerCase()], r);
    },
  });

  // The one on-screen timeframe, shared with the desktop deck and both cases.
  const deckWin = useDeckWindow();

  const { data: change } = useQuery({
    queryKey: ["market-change", marketId],
    queryFn: () => getMarketChange({ data: { id: marketId } }),
    staleTime: 10_000,
    refetchInterval: 20_000,
  });
  const { data: cm } = useQuery({
    queryKey: ["conviction-market", marketId],
    queryFn: () => getConvictionMarket({ data: { onchainId: marketId } }),
    staleTime: 5 * 60_000,
  });
  const { data: houseRead } = useQuery({
    queryKey: houseKey(viewerWallet, marketId),
    queryFn: () => getHouseRead({ data: { wallet: viewerWallet ?? null, marketId } }),
    staleTime: 30_000,
  });
  // For the Conviction Reveal after a completed buy (same keys the Reveal screen
  // uses, so React Query dedupes — no extra fetch).
  const { data: revealEvidence } = useQuery({
    queryKey: ["evidence", marketId],
    queryFn: () => getMarketEvidence({ data: { marketId } }),
    staleTime: 30_000,
  });
  const { data: revealNet } = useQuery({
    queryKey: ["network", viewerWallet ?? null, "all", "relevant", ""],
    queryFn: () => getNetwork({ data: { wallet: viewerWallet, limit: 60 } }),
    enabled: !!viewerWallet,
    staleTime: 60_000,
  });

  const choose = useCallback(
    (s: OrderSide) => {
      // Free belief, recorded silently — it NEVER reveals the House pick and never
      // swaps the screen (matches desktop). The question stays put; only the dock
      // transforms into the order controls. The House pick + celebration wait for
      // a placed order.
      if (viewerWallet) express.mutate(s);
      setSide(s);
      setBacking(true);
    },
    [viewerWallet], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const pass = () => {
    setSide(null);
    house.pass();
    onNext();
  };

  // ---- money: only ever asked for AFTER a side is chosen ----
  const { switchChain } = useSwitchChain();
  const ready = useTradeReady();
  const trade = useTrade();
  const bal = useUserBalance(marketId);
  // The SAME owned-position hook the desktop deck mounts — the phone previously
  // had no sell path at all, so owning shares here was a one-way door.
  const dock = useOwnedDock({
    marketId,
    viewerWallet,
    yesTokens: bal.yes,
    noTokens: bal.no,
    ethUsd,
    ready,
    trade,
    onRequestConnect: requestConnect,
    onRequestChain: () => switchChain({ chainId: CHAIN_ID }),
  });
  const ethWei = usdToWei(amount, ethUsd);
  const { quote, isLoading: quoting } = useBuyQuote(
    marketId,
    side === "YES",
    side && backing ? ethWei : 0n,
  );
  // The market signal shown on the rail above the order form — same read the
  // desktop bar carries, from the same book/pulse domain modules.
  const teaser = useMemo(() => {
    const t = change?.tape ?? [];
    if (!t.length) return null;
    return marketPulse(marketBook(t, Date.now(), deckWin)).headline;
  }, [change, deckWin]);
  // THE HOUSE READ — the SAME shared engine and state the desktop deck uses, so
  // the phone shows the identical feature, data and copy. Never hidden, never a
  // mobile-only variant.
  const houseReadState_ = useMemo(
    () => (viewerWallet ? houseReadState(houseRead ?? null) : null),
    [viewerWallet, houseRead],
  );
  useEffect(() => {
    if (trade.isSuccess && trade.hash && side && !revealed) {
      setRevealed(true);
      house.betReveal(side, trade.hash);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trade.isSuccess, trade.hash, side]);

  const stageMedia = stageMediaFrom(cm);
  const createdAt = cm?.createdAt ?? cm?.creator?.createdAt ?? null;
  const byline = [
    cm?.creator?.name ? `by ${cm.creator.name}` : null,
    createdAt ? marketAgeCopy(Date.now() - new Date(createdAt).getTime()).toLowerCase() : null,
  ]
    .filter(Boolean)
    .join(" • ");

  // A completed buy takes over the screen with the Conviction Reveal — the same
  // engine + component desktop uses. The trade was only the unlock.
  if (trade.isSuccess && side && !dock.isSelling) {
    const reveal = getConvictionReveal(
      assembleRevealInput({
        side,
        marketId,
        believersYes: revealEvidence?.believersYes ?? row.believers_yes ?? 0,
        believersNo: revealEvidence?.believersNo ?? row.believers_no ?? 0,
        believers: revealEvidence?.believers ?? [],
        people: revealNet?.people ?? [],
        housePredicted: houseRead?.predicted ?? houseRead?.preview ?? null,
        surpriseStreak: houseRead?.record?.surpriseStreak ?? 0,
        momentum:
          ((row as Record<string, unknown>).opportunity_type as string | null) === "hot"
            ? "accelerating"
            : null,
        creatorName: cm?.creator?.name ?? null,
      }),
    );
    const tribeTarget = revealNet?.people?.find((p) => ["twin", "tribe"].includes(p.relationship));
    return (
      <Screen>
        <ConvictionReveal
          story={reveal}
          side={side}
          onNext={onNext}
          onMeetTribe={
            tribeTarget && onSelectPerson ? () => onSelectPerson(tribeTarget.wallet) : undefined
          }
        />
      </Screen>
    );
  }

  if (phase === "sides")
    return (
      <BothSides
        marketId={marketId}
        title={title}
        ethUsd={ethUsd}
        row={row}
        onBack={() => setPhase("question")}
      />
    );

  // ---- The Question — ONE screen. The dock transforms decision → order in place;
  // the House pick + celebration only arrive after the order is placed (above). ----
  // The question block — fixed above the stage when there's evidence, part of
  // the single scroll column when there isn't (that layout is unchanged).
  const questionBlock = (
    <div>
      {(category || createdAt || cm?.market || byline) && (
        <div className="flex min-h-[16px] flex-wrap items-baseline gap-x-2 text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
          <span>
            {[
              category,
              createdAt ? marketAgeCopy(Date.now() - new Date(createdAt).getTime()) : null,
              cm?.market ? "Company exclusive" : null,
            ]
              .filter(Boolean)
              .join(" • ")}
          </span>
          {cm?.creator?.name && (
            <button
              type="button"
              onClick={() => cm?.creator && onSelectPerson?.(cm.creator.wallet)}
              className="normal-case tracking-normal text-[12px] text-[var(--text-muted)]"
            >
              by {cm.creator.name}
            </button>
          )}
        </div>
      )}
      <div className="mt-1.5 flex items-start gap-1.5">
        {/* Two lines of reserved space, the same rule the desktop deck uses, so
          a longer question never pushes the stage or the dock down the screen —
          which on a phone is the difference between the controls being under
          your thumb and not. */}
        <h1
          className="line-clamp-2 min-h-[2.36em] min-w-0 flex-1 text-[21px] font-semibold leading-[1.18] tracking-[-0.02em] text-[var(--text)]"
          title={title}
        >
          {title}
        </h1>
        <StandOnIt
          variant="title"
          className="-mr-1.5"
          marketId={marketId}
          title={title}
          side={side}
          hasMedia={!!stageMedia}
        />
      </div>
    </div>
  );

  const marketBody = (
    <>
      {/* Timeframe control for every figure below. */}
      <div className="flex items-center justify-end">
        <WindowFilter win={deckWin} onWin={setDeckWindow} />
      </div>

      {/* ONE market instrument: believers row, capital row, then this market's
        insight (House + activity) inside the same container — no second card. */}
      <div className="min-h-0 flex-1 overflow-y-auto [-webkit-overflow-scrolling:touch]">
        <MarketMomentum
          dense
          tape={change?.tape}
          ethUsd={ethUsd}
          win={deckWin}
          footer={
            <CurrentMarketActivity
              embedded
              marketId={marketId}
              wallet={viewerWallet}
              onSelect={() => undefined}
            />
          }
        />
      </div>
    </>
  );

  return (
    <Screen>
      {stageMedia ? (
        <>
          <div className="shrink-0 pt-1">{questionBlock}</div>
          <MediaStage media={stageMedia} className="mt-2 flex min-h-0 flex-1 flex-col gap-3 pb-1">
            {marketBody}
          </MediaStage>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden pb-1 pt-1">
          {questionBlock}
          {marketBody}
        </div>
      )}

      {/* One dock, transforming in place — the SAME order surface the desktop
        deck uses, with the analysis rail (market signal + see both sides)
        attached to its top. */}
      <Dock>
        <div
          data-probe="dock"
          className="overflow-hidden rounded-[16px]"
          style={{ background: "var(--surface)" }}
        >
          <ExamineCta
            compact
            open={false}
            onToggle={() => setPhase("sides")}
            teaser={teaser}
            houseRead={houseReadState_}
            openLabel="See both sides"
          />
          <div className="border-t border-[var(--hairline)]" aria-hidden />
          {/* Owned and undecided? The SHARED dock — the identical ownership line,
            selector and sell ticket the desktop deck renders. Otherwise the buy
            ticket takes over, exactly as before. */}
          {ownedDockShown(dock, side) ? (
            <OwnedDock
              api={dock}
              buySide={side}
              ethUsd={ethUsd}
              ready={ready}
              trade={trade}
              onBuySide={(s) => {
                trade.reset();
                choose(s);
              }}
              onPass={pass}
              onSold={() => {
                void bal.refetch();
                dock.closeSell();
              }}
            />
          ) : (
            <OrderTicket
              mode="buy"
              side={side}
              amount={amount}
              setAmount={setAmount}
              onSelect={(s) => {
                trade.reset();
                choose(s);
              }}
              onCancel={() => {
                setBacking(false);
                setSide(null);
                dock.setAction(null); // back to the stable selector when you own something
              }}
              onPass={pass}
              quote={quote ?? null}
              quoting={quoting}
              ethWei={ethWei}
              ethUsd={ethUsd}
              ready={ready}
              trade={trade}
              onConfirm={async () => {
                if (!ready.connected) return requestConnect();
                if (!ready.onBase) return switchChain({ chainId: CHAIN_ID });
                if (quote && ethWei > 0n && !(trade.isSubmitting || trade.isMining)) {
                  try {
                    await trade.buy(marketId, side === "YES", ethWei, quote.tokens);
                  } catch {
                    /* surfaced via trade.error */
                  }
                }
              }}
              onDone={() => {
                void bal.refetch();
                onNext();
              }}
            />
          )}
        </div>
        {/* What your link has brought into this market — only once it's real. */}
        <div className="mt-2">
          <ShareImpact marketId={marketId} wallet={viewerWallet} />
        </div>
      </Dock>
    </Screen>
  );
}

/** Screen 3 — See Both Sides. Totals first; one tap opens a side's case. */
function BothSides({
  marketId,
  title,
  ethUsd,
  row,
  onBack,
}: {
  marketId: number;
  title: string;
  ethUsd: number;
  row: MarketRow;
  onBack: () => void;
}) {
  const [open, setOpen] = useState<OrderSide | null>(null);
  const { unit, format } = useMoney();
  const { data: evidence } = useQuery({
    queryKey: ["evidence", marketId],
    queryFn: () => getMarketEvidence({ data: { marketId } }),
    staleTime: 30_000,
  });
  const { data: pulses } = useQuery({
    queryKey: ["market-pulses", String(marketId)],
    queryFn: () => listMarketPulses({ data: { ids: [marketId] } }),
    staleTime: 15_000,
  });
  // Authoritative window-open baselines — the same source the desktop case file
  // uses, so mobile momentum can never disagree with it.
  const { data: baselines } = useQuery({
    queryKey: ["market-baselines", marketId],
    queryFn: () => getMarketBaselines({ data: { id: marketId } }),
    staleTime: 30_000,
  });

  const believers = evidence?.believers ?? [];
  // Prefer the read-model's authoritative per-side capital; fall back to the
  // sum of priced holdings only when the row hasn't been valued yet.
  const capital = (s: OrderSide) => {
    const rowUsd = s === "YES" ? row.yes_capital_usd : row.no_capital_usd;
    if (rowUsd != null && rowUsd > 0) return Number(rowUsd);
    return believers.filter((b) => b.side === s).reduce((t, b) => t + (b.valueUsd ?? 0), 0);
  };
  const count = (s: OrderSide) => {
    const seen = believers.filter((b) => b.side === s).length;
    const rowCount = s === "YES" ? evidence?.believersYes : evidence?.believersNo;
    return Math.max(seen, rowCount ?? 0);
  };
  const events = pulses?.pulses?.[String(marketId)] ?? [];

  const bl = baselines?.["24h"];
  /** Believers / capital / price momentum for one side, read the Total Market way. */
  const rows = (s: OrderSide) => {
    const bel = count(s);
    const cap = capital(s);
    const belBase = s === "YES" ? bl?.believersYes : bl?.believersNo;
    const capBase = s === "YES" ? bl?.yesCapitalUsd : bl?.noCapitalUsd;
    const belChg = belBase != null ? windowChange(bel, belBase) : null;
    const capChg = capBase != null ? windowChange(cap, capBase) : null;
    const belDelta = belChg?.delta ?? null;
    const capDelta = capChg?.delta ?? null;
    const priceUsd = Number(s === "YES" ? row.yes_price_usd : row.no_price_usd) || null;
    const rawPct = Number(s === "YES" ? row.chg_24h_yes : row.chg_24h_no);
    const pricePct = Number.isFinite(rawPct) ? rawPct : null;
    const priceDelta =
      priceUsd != null && pricePct != null ? priceUsd - priceUsd / (1 + pricePct / 100) : null;
    return [
      {
        label: "Believers",
        value: bel.toLocaleString("en-US"),
        pct: belChg?.pct ?? null,
        absolute:
          belDelta == null
            ? null
            : belDelta === 0
              ? "No change today"
              : `${belDelta > 0 ? "+" : "−"}${Math.abs(belDelta)} believer${Math.abs(belDelta) === 1 ? "" : "s"} today`,
      },
      {
        label: "Committed",
        value: format(cap, "USD"),
        pct: capChg?.pct ?? null,
        absolute:
          capDelta == null
            ? null
            : Math.abs(capDelta) < 0.005
              ? "No change today"
              : `${format(capDelta, "USD", { signed: true })} ${capDelta > 0 ? "committed" : "withdrawn"} today`,
      },
      {
        label: "Per share",
        value: priceUsd == null ? "—" : format(priceUsd, "USD"),
        pct: pricePct,
        absolute:
          priceDelta == null
            ? null
            : Math.abs(priceDelta) < 0.005
              ? "Flat today"
              : `${format(priceDelta, "USD", { signed: true })} per share today`,
      },
    ];
  };

  return (
    <Screen>
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pb-4 pt-1 [-webkit-overflow-scrolling:touch]">
        <button
          type="button"
          onClick={onBack}
          className="text-left text-[13px] text-[var(--text-muted)]"
        >
          ← Back
        </button>
        <h2 className="text-[18px] font-semibold leading-snug text-[var(--text)]">{title}</h2>

        {(["YES", "NO"] as OrderSide[]).map((s) => (
          <div key={s}>
            <Rule />
            <button
              type="button"
              onClick={() => setOpen((cur) => (cur === s ? null : s))}
              className="w-full pt-5 text-left"
            >
              <div
                className="flex items-baseline justify-between text-[20px] font-semibold"
                style={{ color: s === "YES" ? "var(--yes)" : "var(--no)" }}
              >
                {s}
                <span className="text-[12px] font-medium text-[var(--text-muted)]">
                  {open === s ? "Hide" : "Details"}
                </span>
              </div>
              <div className="mt-2 space-y-1.5">
                {rows(s).map((m) => (
                  <SideMetric
                    key={m.label}
                    label={m.label}
                    value={m.value}
                    pct={m.pct}
                    absolute={m.absolute}
                    color={s === "YES" ? "var(--yes)" : "var(--no)"}
                  />
                ))}
              </div>
            </button>


            {open === s && (
              <div className="mt-5 space-y-5">
                {(evidence?.defense ?? []).filter((d) => d.vote === s).length > 0 && (
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                      Why people believe
                    </div>
                    <ul className="mt-2 space-y-2">
                      {(evidence?.defense ?? [])
                        .filter((d) => d.vote === s)
                        .slice(0, 3)
                        .map((d, i) => (
                          <li
                            key={i}
                            className="text-[14px] leading-relaxed text-[var(--text-secondary)]"
                          >
                            • {d.opinion}
                          </li>
                        ))}
                    </ul>
                  </div>
                )}
                {events.filter((e) => e.side === s).length > 0 && (
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                      Recent activity
                    </div>
                    <ul className="mt-2 space-y-2">
                      {events
                        .filter((e) => e.side === s)
                        .slice(0, 5)
                        .map((e, i) => (
                          <li key={i} className="text-[14px] text-[var(--text-secondary)]">
                            {pulseLine(e, ethUsd, unit)}
                          </li>
                        ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </Screen>
  );
}

/* ---------- primitives ---------- */

/**
 * One side metric, read exactly like the Total Market instrument: the current
 * total leads on the left, the window's % change is the big figure on the right
 * with a trailing arrow, and the EXACT move states what actually happened.
 */
function SideMetric({
  label,
  value,
  pct,
  absolute,
  color,
}: {
  label: string;
  value: string;
  pct: number | null;
  absolute?: string | null;
  color: string;
}) {
  const flat = pct == null || Math.abs(pct) < 0.05;
  const tone = flat ? "var(--text-muted)" : pct! > 0 ? "var(--gain)" : "var(--loss)";
  const arrow = flat ? "" : pct! > 0 ? "▲" : "▼";
  const pctText =
    pct == null ? "" : `${Math.abs(pct).toFixed(!flat && Math.abs(pct) < 10 ? 1 : 0)}%`;
  return (
    <div
      className="rounded-[10px] py-2 pl-2 pr-2.5"
      style={{
        borderLeft: `2px solid ${color}`,
        background: `color-mix(in oklab, ${color} 7%, transparent)`,
      }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="num min-w-0 truncate text-[20px] font-semibold leading-none tracking-[-0.02em] text-[var(--text)]">
          {value}
        </span>
        <span
          className="num shrink-0 text-[18px] font-semibold leading-none tabular-nums"
          style={{ color: tone }}
        >
          {pctText}
          {arrow && pctText ? <span className="ml-1 align-middle text-[0.6em]">{arrow}</span> : null}
        </span>
      </div>
      <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">
        {label}
      </div>
      {absolute && (
        <div className="num mt-0.5 text-[11px]" style={{ color: tone }}>
          {absolute}
        </div>
      )}
    </div>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full min-h-0 flex-col">{children}</div>;
}

function Dock({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="sticky bottom-0 z-20 mt-auto shrink-0 pt-2"
      style={{
        paddingBottom: "max(env(safe-area-inset-bottom), 8px)",
        background: "var(--bg)",
      }}
    >
      {children}
    </div>
  );
}

function Rule() {
  return <div className="border-t border-[var(--border)]" aria-hidden />;
}
