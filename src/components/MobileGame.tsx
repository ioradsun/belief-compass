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

type Phase = "question" | "passed" | "sides";

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
    setPhase("passed");
    house.pass();
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

  if (phase === "passed")
    return (
      <Screen>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-center">
          <p className="text-[16px] text-[var(--text-secondary)]">You walked away.</p>
          <p className="text-[16px] text-[var(--text-secondary)]">
            <span aria-hidden>🏠</span> I kept my read. You never paid to see it.
          </p>
        </div>
        <Dock>
          <BigButton label="Next question" tone="neutral" onClick={onNext} />
        </Dock>
      </Screen>
    );

  // ---- The Question — ONE screen. The dock transforms decision → order in place;
  // the House pick + celebration only arrive after the order is placed (above). ----
  // The question block — fixed above the stage when there's evidence, part of
  // the single scroll column when there isn't (that layout is unchanged).
  const questionBlock = (
    <div>
      {(category || createdAt || cm?.market) && (
        <div className="text-[12px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
          {[
            category,
            createdAt ? marketAgeCopy(Date.now() - new Date(createdAt).getTime()) : null,
            cm?.market ? "Company exclusive" : null,
          ]
            .filter(Boolean)
            .join(" • ")}
        </div>
      )}
      <h1 className="mt-3 text-[26px] font-semibold leading-[1.2] tracking-[-0.02em] text-[var(--text)]">
        {title}
      </h1>
      {byline && (
        <button
          type="button"
          onClick={() => cm?.creator && onSelectPerson?.(cm.creator.wallet)}
          className="mt-3 text-left text-[13px] text-[var(--text-muted)]"
        >
          {byline}
        </button>
      )}
    </div>
  );

  const marketBody = (
    <>
      <Rule />

      {/* Momentum — believers, capital, the trend. The same <MarketMomentum>
        the desktop deck renders, in its mobile layout. */}
      <WindowFilter win={deckWin} onWin={setDeckWindow} />

      <MarketMomentum tape={change?.tape} ethUsd={ethUsd} win={deckWin} />

      <Rule />

      {/* The story — House + this market's activity — as the pinned scope of the
        Live feed, expandable in place. Same component desktop pins to its feed. */}
      <CurrentMarketActivity marketId={marketId} wallet={viewerWallet} onSelect={() => undefined} />

      {/* Compare the two cases — an explicit exploration, never part of the
        order flow, so the decision → order path is never interrupted. */}
      <button
        type="button"
        onClick={() => setPhase("sides")}
        className="text-left text-[15px] font-semibold text-[var(--text-secondary)]"
      >
        See both sides →
      </button>
    </>
  );

  return (
    <Screen>
      {stageMedia ? (
        <>
          <div className="shrink-0 pt-1">{questionBlock}</div>
          <MediaStage media={stageMedia} className="mt-4 flex min-h-0 flex-1 flex-col gap-7 pb-4">
            {marketBody}
          </MediaStage>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto pb-4 pt-1 [-webkit-overflow-scrolling:touch]">
          {questionBlock}
          {marketBody}
        </div>
      )}

      {/* One dock, transforming in place: the decision, then the order controls —
        never a screen swap. The House pick + celebration wait for a placed order. */}
      <Dock>
        {side == null ? (
          <div className="flex gap-2.5">
            <BigButton label="NO" tone="no" onClick={() => choose("NO")} />
            <BigButton label="PASS" tone="neutral" onClick={pass} />
            <BigButton label="YES" tone="yes" onClick={() => choose("YES")} />
          </div>
        ) : (
          <AmountPanel
            amount={amount}
            setAmount={setAmount}
            side={side}
            busy={trade.isSubmitting || trade.isMining}
            success={trade.isSuccess}
            error={trade.isError ? (trade.error?.message?.slice(0, 90) ?? "Failed") : null}
            label={
              !ready.connected
                ? "Connect wallet"
                : !ready.onBase
                  ? "Switch to Base"
                  : `Confirm ${format(amount, "USD")}`
            }
            onCancel={() => {
              setBacking(false);
              setSide(null);
            }}
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
            onNext={onNext}
          />
        )}
        {/* Always-on: bring your tribe in. On phones this opens the native share
          sheet; the message leads with the side you're standing on. */}
        <div className="mt-2">
          <StandOnIt marketId={marketId} title={title} side={side} hasMedia={!!stageMedia} />
        </div>
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

  return (
    <div className="space-y-3">
      <div className="text-[13px] text-[var(--text-muted)]">How much conviction?</div>
      <span
        className="flex h-[52px] items-center gap-1 rounded-[14px] px-3"
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
      {error && <div className="text-[13px] text-[var(--no)]">{error}</div>}
      <div className="flex gap-2.5">
        <BigButton label="Not now" tone="neutral" onClick={onCancel} />
        <BigButton
          label={busy ? "Confirming…" : label}
          tone={side === "YES" ? "yes" : "no"}
          onClick={onConfirm}
          disabled={busy || amount <= 0}
        />
      </div>
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
      className="shrink-0 pt-3"
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
