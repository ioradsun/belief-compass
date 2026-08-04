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
import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSwitchChain } from "wagmi";

import type { MarketRow } from "@/components/MarketCard";
import { pulseLine } from "@/components/MarketCard";
import { MarketMomentum } from "@/components/MarketVitality";
import { WindowFilter } from "@/components/WindowFilter";
import { useDeckWindow, setDeckWindow } from "@/lib/deck-window";
import { CurrentMarketActivity } from "@/components/CurrentMarketActivity";
import { useHouseFinalize } from "@/lib/house-round";
import { getMarketChange, listMarketPulses } from "@/lib/markets.functions";
import { getMarketEvidence } from "@/lib/evidence.functions";
import { getNetwork } from "@/lib/dna.functions";
import { getConvictionMarket } from "@/lib/market-create.functions";
import { marketAgeCopy } from "@/domain/market-freshness";
import { MediaStage, stageMediaFrom } from "@/components/MediaStage";
import { StandOnIt } from "@/components/StandOnIt";
import { ShareImpact } from "@/components/ShareImpact";
import { MovementLine } from "@/components/MovementLine";
import { getHouseRead } from "@/lib/house.functions";
import { houseKey } from "@/lib/house-round";
import { expressBelief } from "@/lib/beliefs.functions";
import { bestEffort, useWalletSession } from "@/hooks/useWalletSession";
import { requestConnect } from "@/lib/connect-bridge";
import { CHAIN_ID } from "@/chain/decoder";
import { useBuyQuote, useTrade, useTradeReady } from "@/lib/chain-trade";
import { usdToWei, type OrderSide } from "@/domain/order";
import { useMoney } from "@/lib/display-unit";
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
  const { format } = useMoney();

  const [phase, setPhase] = useState<Phase>("question");
  const [side, setSide] = useState<OrderSide | null>(null);
  const [backing, setBacking] = useState(false);
  const [amount, setAmount] = useState(1);

  // A brand new question always starts from a blank slate.
  useEffect(() => {
    setPhase("question");
    setSide(null);
    setBacking(false);
    setAmount(1);
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
  const ethWei = usdToWei(amount, ethUsd);
  const { quote } = useBuyQuote(marketId, side === "YES", side && backing ? ethWei : 0n);
  const [revealed, setRevealed] = useState(false);
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
  if (trade.isSuccess && side) {
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
        <div className="flex flex-wrap items-baseline gap-x-2 text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
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
        <h1 className="min-w-0 flex-1 text-[21px] font-semibold leading-[1.18] tracking-[-0.02em] text-[var(--text)]">
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
      {/* Momentum — believers + capital side by side, in the one on-screen
        timeframe. Same numbers the desktop deck shows, phone-tight. */}
      <div className="flex items-center justify-end">
        <WindowFilter win={deckWin} onWin={setDeckWindow} />
      </div>

      <MarketMomentum dense tape={change?.tape} ethUsd={ethUsd} win={deckWin} />

      {/* The story — House + this market's activity. Takes whatever height is
        left; it is the only thing that may scroll, never the screen. */}
      <div className="min-h-0 flex-1 overflow-y-auto [-webkit-overflow-scrolling:touch]">
        <CurrentMarketActivity
          marketId={marketId}
          wallet={viewerWallet}
          onSelect={() => undefined}
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
        <div className="overflow-hidden rounded-[16px]" style={{ background: "var(--surface)" }}>
          <ExamineCta
            compact
            open={false}
            onToggle={() => setPhase("sides")}
            teaser={teaser}
            openLabel="See both sides · YES vs NO"
          />
          <div className="border-t border-[var(--hairline)]" aria-hidden />
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
            onDone={onNext}
          />
        </div>
        {/* Once a side is chosen, the movement it belongs to (believers only). */}
        {side && (
          <div className="mt-2">
            <MovementLine
              believers={Number(side === "YES" ? row.believers_yes : row.believers_no) || 0}
              side={side}
            />
          </div>
        )}
        {/* What your link has brought into this market — only once it's real. */}
        <div className="mt-2">
          <ShareImpact marketId={marketId} wallet={viewerWallet} />
        </div>
      </Dock>

    </Screen>
  );
}

/** How much conviction? Asked only after a side is chosen — never before. */
function AmountPanel({
  amount,
  setAmount,
  side,
  busy,
  success,
  error,
  label,
  onCancel,
  onConfirm,
  onNext,
}: {
  amount: number;
  setAmount: (n: number) => void;
  side: OrderSide;
  busy: boolean;
  success: boolean;
  error: string | null;
  label: string;
  onCancel: () => void;
  onConfirm: () => void;
  onNext: () => void;
}) {
  const { format } = useMoney();
  if (success)
    return (
      <div className="space-y-3">
        <p className="text-center text-[16px] text-[var(--text-secondary)]">
          You backed {side} with {format(amount, "USD")}.
        </p>
        <BigButton label="Next question" tone="neutral" onClick={onNext} />
      </div>
    );

  // Desktop's order-bar economy on a phone: amount and the single primary
  // action share one row; "Not now" is a quiet link, not a second big button.
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span
          className="flex h-[52px] w-[112px] shrink-0 items-center gap-1 rounded-[14px] px-3"
          style={{ border: "1px solid var(--border)" }}
        >
          <span className="num text-[18px] text-[var(--text-muted)]">$</span>
          <input
            autoFocus
            inputMode="decimal"
            value={amount ? String(amount) : ""}
            onChange={(e) => {
              const raw = e.target.value.replace(/[^0-9.]/g, "");
              const n = parseFloat(raw);
              setAmount(Number.isNaN(n) ? 0 : Math.min(n, 1_000_000));
            }}
            aria-label="Amount in dollars"
            className="num w-full bg-transparent text-[18px] font-semibold text-[var(--text)] outline-none"
            placeholder="0"
          />
        </span>
        <BigButton
          label={busy ? "Confirming…" : label}
          tone={side === "YES" ? "yes" : "no"}
          onClick={onConfirm}
          disabled={busy || amount <= 0}
        />
      </div>
      {error && <div className="text-[12px] text-[var(--no)]">{error}</div>}
      <button
        type="button"
        onClick={onCancel}
        className="block w-full text-center text-[12px] text-[var(--text-muted)]"
      >
        Not now
      </button>
    </div>
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
                className="text-[20px] font-semibold"
                style={{ color: s === "YES" ? "var(--yes)" : "var(--no)" }}
              >
                {s}
              </div>
              <div className="num mt-2 text-[16px] text-[var(--text)]">
                {count(s)} believer{count(s) === 1 ? "" : "s"}
              </div>
              <div className="num mt-1 text-[16px] text-[var(--text-secondary)]">
                {format(capital(s), "USD")} committed
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

function Screen({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full min-h-0 flex-col">{children}</div>;
}

function Dock({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="shrink-0 pt-2"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom), 8px)" }}
    >
      {children}
    </div>
  );
}

function Rule() {
  return <div className="border-t border-[var(--border)]" aria-hidden />;
}

function BigButton({
  label,
  tone,
  onClick,
  disabled,
}: {
  label: string;
  tone: "yes" | "no" | "neutral";
  onClick: () => void;
  disabled?: boolean;
}) {
  const style =
    tone === "yes"
      ? { border: "1px solid var(--yes)", color: "var(--yes)" }
      : tone === "no"
        ? { border: "1px solid var(--no)", color: "var(--no)" }
        : { border: "1px solid var(--border)", color: "var(--text-secondary)" };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-[60px] flex-1 rounded-[16px] text-[18px] font-semibold transition-opacity disabled:opacity-40"
      style={style}
    >
      {label}
    </button>
  );
}
