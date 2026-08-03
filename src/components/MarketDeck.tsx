/**
 * CENTER — single-market decision deck.
 *
 * One market at a time: Pulse (why now) → Battlefield (both sides) → the House
 * Read → a persistent dock (shared amount, NO / PASS / YES). A gesture/button/key
 * only SELECTS a side; buying requires an explicit Confirm after an on-chain
 * quote. Prices/quotes come from the contract (src/lib/chain-trade) — never the
 * client. The House pick unlocks ONLY on a confirmed bet; a pass seals it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getMarketChange, getPositionSummary } from "@/lib/markets.functions";
import { getMarketEvidence } from "@/lib/evidence.functions";
import { getNetwork } from "@/lib/dna.functions";
import { getHouseRead } from "@/lib/house.functions";
import { requestConnect } from "@/lib/connect-bridge";
import { walletIntent } from "@/lib/wagmi";
import { useSwitchChain } from "wagmi";
import type { MarketRow } from "@/components/MarketCard";
import { useHouseFinalize, houseKey } from "@/lib/house-round";
import { ConvictionReveal } from "@/components/ConvictionReveal";
import { getConvictionReveal } from "@/domain/conviction-reveal";
import { assembleRevealInput } from "@/lib/reveal-input";
import { DnaFirstReveal } from "@/components/DnaFirstReveal";
import { MobileCaseView } from "@/components/MobileCase";
import { CaseStory } from "@/components/CaseStory";
import { useEffectiveWallet } from "@/hooks/useEffectiveWallet";
import { expressBelief } from "@/lib/beliefs.functions";
import { bestEffort, useWalletSession } from "@/hooks/useWalletSession";
import { MarketMomentum } from "@/components/MarketVitality";
import { SharedConviction } from "@/components/SharedConviction";
import { marketAgeCopy } from "@/domain/market-freshness";
import { RELATIONSHIP_TEXT, relationshipTone } from "@/lib/dna-labels";
import { hueFor, initialsFor } from "@/lib/wallet-identity";
import type { TapeTrade } from "@/domain/conviction-series";

import { CHAIN_ID } from "@/chain/decoder";
import {
  useBuyQuote,
  useSellQuote,
  useTrade,
  useTradeReady,
  useUserBalance,
} from "@/lib/chain-trade";
import {
  pulseFor,
  usdToWei,
  fmtShares,
  selectSide,
  sharesForPct,
  type OrderSide,
} from "@/domain/order";
import { marketBook } from "@/domain/market-book";
import { marketPulse } from "@/domain/market-pulse";
import { emitMarketTransition, type TransitionType, type Side } from "@/domain/market-transition";
import { WindowFilter } from "@/components/WindowFilter";
import { useDeckWindow, setDeckWindow } from "@/lib/deck-window";
import { OrderTicket } from "@/components/order/OrderTicket";
import { StandOnIt } from "@/components/StandOnIt";
import { ShareImpact } from "@/components/ShareImpact";
import { MovementLine } from "@/components/MovementLine";

import { LensPicker, type Lens, type LensOption } from "@/components/OmniHeader";
import { getConvictionMarket } from "@/lib/market-create.functions";
import { MediaStage, stageMediaFrom } from "@/components/MediaStage";

/**
 * Momentum tags — the six canonical opportunity classifications from the
 * server-side engine. Color is a second signal only; the word carries meaning.
 */
const signedPct = (n: number | null) =>
  n == null || !Number.isFinite(n)
    ? "—"
    : `${n < 0 ? "−" : "+"}${Math.abs(n).toFixed(Math.abs(n) > 0 && Math.abs(n) < 10 ? 1 : 0)}%`;

const MOMENTUM: Record<string, { label: string; hue: string; hint: string }> = {
  hot: { label: "Hot", hue: "#f97316", hint: "Activity is accelerating right now" },
  early: { label: "Early", hue: "#22d3ee", hint: "Real growth, still small and immature" },
  hidden: { label: "Hidden", hue: "#a78bfa", hint: "Heavy turnover for its visible size" },
  contested: { label: "Contested", hue: "#f43f5e", hint: "Both sides balanced and active" },
  conviction: { label: "Conviction", hue: "#34d399", hint: "Holders persisting under challenge" },
  new: { label: "New", hue: "#94a3b8", hint: "Opened in the last 72 hours" },
};

export function MarketDeck({
  row,
  ethUsd,
  onSkip,
  viewerWallet,
  lens,
  lenses,
  onLens,
  caseOpen = false,
  mobileCaseOpen = false,
  onToggleCase,
  storySide = null,
  onCloseStory,
  onSelectPerson,
}: {
  row: MarketRow;
  ethUsd: number;
  onSkip: () => void;
  viewerWallet?: string;
  /** When provided, the momentum chip doubles as the deck's lens filter. */
  lens?: Lens;
  lenses?: LensOption[];
  onLens?: (l: Lens) => void;
  /** Case File mode (desktop): the YES/NO evidence moves to the side columns. */
  caseOpen?: boolean;
  /** Case File mode (mobile): the center becomes a NO ← MARKET → YES carousel. */
  mobileCaseOpen?: boolean;
  onToggleCase?: () => void;
  /** Investigation mode: one side's story takes the center. */
  storySide?: OrderSide | null;
  onCloseStory?: () => void;
  /** Open a person's profile (used by the clickable creator byline). */
  onSelectPerson?: (wallet: string) => void;
}) {
  const rr = row as Record<string, unknown>;
  const marketId = Number(row.onchain_id);
  const title = row.markets?.title ?? `Market #${marketId}`;
  const category = row.markets?.category ?? null;
  // POV hosts the same market; the slug comes from their API via the poller.
  const povSlug = row.markets?.pov_slug ?? null;
  const povUrl = povSlug ? `https://pov.co/markets/${povSlug}` : "https://pov.co/";

  const pulse = pulseFor(
    (rr.opportunity_type as string | null) ?? null,
    (rr.opportunity_reason as string | null) ?? null,
  );

  const [amount, setAmount] = useState(1);
  const [side, setSide] = useState<OrderSide | null>(null);
  // Sell is a separate, deliberate mode — a percentage of the held side. Null
  // means "not selling"; the buy dock owns the surface. Buying the opposite side
  // never sells (they're separate token balances), so a flip can't silently exit.
  const [sellPct, setSellPct] = useState<number | null>(null);
  // State 2 (owned): the viewer chose "Buy more" from the position summary and is
  // now in the shared buy OrderTicket. false → resting on the summary + Sell /
  // Buy More. (Sell is driven by sellPct, below.)
  const [buyMore, setBuyMore] = useState(false);

  const { switchChain } = useSwitchChain();
  const ready = useTradeReady();
  const trade = useTrade();
  const bal = useUserBalance(marketId);
  const house = useHouseFinalize(marketId, viewerWallet);

  // A belief tap records a FREE expressed belief (no money) that feeds DNA /
  // Network / House. Refreshes the viewer's readiness so calibration progresses.
  const qc = useQueryClient();
  const { ensureSession } = useWalletSession();
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

  const { data: change } = useQuery({
    queryKey: ["market-change", marketId],
    queryFn: () => getMarketChange({ data: { id: marketId } }),
    staleTime: 10_000,
    refetchInterval: 15_000,
    // Hold the last tape while the next poll (or a market switch) is in flight.
    placeholderData: (prev) => prev,
  });

  // The one on-screen timeframe — the center owns it, both cases follow it.
  const deckWin = useDeckWindow();

  const prevTransition = useRef<{ type: TransitionType; side?: Side } | null>(null);

  // Escape closes the Case File — a disclosure, so it dismisses like one.
  useEffect(() => {
    if (!caseOpen || !onToggleCase) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onToggleCase();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [caseOpen, onToggleCase]);

  // Creator/age for the identity row's freshness token (deduped with the byline).
  const { data: cm } = useQuery({
    queryKey: ["conviction-market", marketId],
    queryFn: () => getConvictionMarket({ data: { onchainId: marketId } }),
    staleTime: 5 * 60_000,
    placeholderData: (prev) => prev,
  });
  // Evidence, when the creator attached any. Null keeps the layout untouched.
  const stageMedia = useMemo(() => stageMediaFrom(cm), [cm]);
  const createdAt = cm?.createdAt ?? cm?.creator?.createdAt ?? null;

  const freshToken = createdAt
    ? marketAgeCopy(Date.now() - new Date(createdAt).getTime()).toUpperCase()
    : null;

  const connected = useEffectiveWallet();
  const viewer = viewerWallet ?? connected;
  const { data: evidence } = useQuery({
    queryKey: ["evidence", marketId],
    queryFn: () => getMarketEvidence({ data: { marketId } }),
    refetchInterval: 60_000,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
  const holders = evidence?.believers ?? [];

  // The reveal needs the viewer's network (for Tribe / Opps / Twin faces) and the
  // House read (its pick + surprise streak). Both cached, both used elsewhere.
  const { data: net } = useQuery({
    queryKey: ["network", viewer ?? null, "all", "relevant", ""],
    queryFn: () => getNetwork({ data: { wallet: viewer, limit: 60 } }),
    enabled: !!viewer,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
  const { data: houseRead } = useQuery({
    queryKey: houseKey(viewer, marketId),
    queryFn: () => getHouseRead({ data: { wallet: viewer ?? null, marketId } }),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  // The center's ONE interpretation. The state-transition emitter reads YES and NO
  // together and names the strongest market-wide meaning — a contradiction, a
  // dividing market, a Tribe forming, a side accelerating — falling back to the
  // momentum label when nothing rises above noise. It's fed three canonical
  // inputs: the per-side windows from marketBook, the ranker's acceleration
  // baseline (server-computed, never re-derived here), and per-side Tribe counts
  // from the viewer's own network. `prevTransition` carries state across polls so
  // the emitter's hysteresis keeps the read calm instead of flipping per trade.
  const social = useMemo(() => {
    const relOf = new Map(
      (net?.people ?? []).map((p) => [p.wallet.toLowerCase(), p.relationship] as const),
    );
    let tribeJoinedYes = 0;
    let tribeJoinedNo = 0;
    for (const b of evidence?.believers ?? []) {
      const r = relOf.get(b.wallet.toLowerCase());
      if (r === "tribe" || r === "twin") {
        if (b.side === "YES") tribeJoinedYes += 1;
        else if (b.side === "NO") tribeJoinedNo += 1;
      }
    }
    return { tribeJoinedYes, tribeJoinedNo };
  }, [net, evidence]);
  const caseTeaser = useMemo(() => {
    const t = change?.tape ?? [];
    if (!t.length) return null;
    const book = marketBook(t, Date.now(), deckWin);
    const toWin = (bel: { delta: number; base: number }, cap: { delta: number; base: number }) => ({
      believerDelta: bel.delta,
      believerBase: bel.base,
      capitalDeltaUsd: cap.delta * ethUsd,
      capitalBaseUsd: cap.base * ethUsd,
      pricePct: null,
    });
    const transition = emitMarketTransition({
      timeframeShort: book.window.short,
      yes: toWin(book.believers.yes, book.capitalEth.yes),
      no: toWin(book.believers.no, book.capitalEth.no),
      baseline: change?.acceleration != null ? { accelerationMultiple: change.acceleration } : null,
      social,
      prev: prevTransition.current,
    });
    prevTransition.current = transition ? { type: transition.type, side: transition.side } : null;
    return transition?.headline ?? marketPulse(book).headline;
  }, [change, deckWin, ethUsd, social]);

  const ethWei = usdToWei(amount, ethUsd);
  const { quote, isLoading: quoting } = useBuyQuote(marketId, side === "YES", side ? ethWei : 0n);

  // Selecting a side opens the order AND records a free expressed belief (which
  // feeds DNA / Network / calibration). It never reveals the House pick and never
  // buys — only a confirmed on-chain bet unlocks the read.
  const chooseSide = useCallback(
    (s: OrderSide) => {
      if (viewerWallet) express.mutate(s);
      setSide((cur) => selectSide(cur, s));
    },
    // express is stable enough; excluding it avoids re-binding keyboard handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewerWallet],
  );

  // Pass finalizes the round silently and moves straight to the next market —
  // no interstitial. The House pick stays sealed (you never paid to see it).
  const choosePass = useCallback(() => {
    setSide(null);
    house.pass();
    onSkip();
  }, [house, onSkip]);

  // Reveal the House pick exactly once, when a bet confirms on-chain.
  const betRevealed = useRef(false);

  // Reset every flow when the market changes.
  useEffect(() => {
    setSide(null);
    setSellPct(null);
    setBuyMore(false);
    betRevealed.current = false;
    trade.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketId]);

  // On a confirmed buy, finalize the bet → the House read unlocks above.
  useEffect(() => {
    if (trade.isSuccess && trade.hash && side && !betRevealed.current) {
      betRevealed.current = true;
      house.betReveal(side, trade.hash);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trade.isSuccess, trade.hash, side]);

  // Keyboard: ←/→ select a side, ↑ pass. None of them buy or reveal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && ["INPUT", "TEXTAREA"].includes(el.tagName)) return;
      if (el?.getAttribute("role") === "tab") return;
      if (e.key === "ArrowLeft") chooseSide("NO");
      else if (e.key === "ArrowRight") chooseSide("YES");
      else if (e.key === "ArrowUp") {
        e.preventDefault();
        choosePass();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chooseSide, choosePass]);

  const relationshipBeat = row.story?.beats.find((b) => b.kind === "relationship")?.text ?? null;
  const eventBeat = row.story?.beats.find((b) => b.kind === "event")?.text ?? null;
  const held =
    bal.yes > 0n
      ? { side: "YES" as const, tokens: bal.yes }
      : bal.no > 0n
        ? { side: "NO" as const, tokens: bal.no }
        : null;

  // The viewer's honest ownership numbers on THIS market (cost basis + worth).
  // Off the reducer/POV read model — never inferred from a price percentage.
  const { data: posSummary } = useQuery({
    queryKey: ["position-summary", viewerWallet ?? null, marketId],
    queryFn: () => getPositionSummary({ data: { wallet: viewerWallet as string, marketId } }),
    enabled: !!viewerWallet,
    staleTime: 15_000,
    refetchInterval: 20_000,
    placeholderData: (prev) => prev,
  });
  const heldSideData = held ? posSummary?.[held.side === "YES" ? "yes" : "no"] : null;

  // Sell quote (only while the sell panel is open on a held side).
  const sellShares = held && sellPct != null ? sharesForPct(held.tokens, sellPct) : 0n;
  const { proceeds, isLoading: sellQuoting } = useSellQuote(
    marketId,
    held?.side === "YES",
    sellShares,
  );

  const openSell = () => {
    setSide(null);
    setBuyMore(false);
    trade.reset();
    setSellPct(100);
  };
  const closeSell = () => {
    setSellPct(null);
    trade.reset();
  };
  const onSellConfirm = async () => {
    if (!ready.connected) return requestConnect();
    if (!ready.onBase) return switchChain({ chainId: CHAIN_ID });
    if (held && proceeds != null && sellShares > 0n && !(trade.isSubmitting || trade.isMining)) {
      try {
        await trade.sell(marketId, held.side === "YES", sellShares, proceeds);
      } catch {
        /* surfaced via trade.error */
      }
    }
  };

  // A completed BUY takes over the whole center: the Conviction Reveal — the same
  // story engine + component the mobile game uses. The trade was only the unlock.
  if (trade.isSuccess && side != null && sellPct == null) {
    const reveal = getConvictionReveal(
      assembleRevealInput({
        side,
        marketId,
        believersYes: evidence?.believersYes ?? row.believers_yes ?? 0,
        believersNo: evidence?.believersNo ?? row.believers_no ?? 0,
        believers: holders,
        people: net?.people ?? [],
        housePredicted: houseRead?.predicted ?? houseRead?.preview ?? null,
        surpriseStreak: houseRead?.record?.surpriseStreak ?? 0,
        momentum: (rr.opportunity_type as string | null) === "hot" ? "accelerating" : null,
        creatorName: cm?.creator?.name ?? null,
      }),
    );
    return (
      <ConvictionReveal
        story={reveal}
        side={side}
        onNext={() => {
          void bal.refetch();
          onSkip();
        }}
        onMeetTribe={(() => {
          const t = net?.people?.find((p) => ["twin", "tribe"].includes(p.relationship));
          return t ? () => onSelectPerson?.(t.wallet) : undefined;
        })()}
      />
    );
  }

  const momentum = MOMENTUM[(rr.opportunity_type as string | null) ?? ""] ?? null;
  // One chip: the market's momentum tag when no lens is applied, the active lens
  // once you pick one. Same vocabulary, same place — no duplicated row above.
  const lensMomentum = lens && lens !== "all" ? MOMENTUM[lens] : null;
  const chipTone = lensMomentum?.hue ?? momentum?.hue;
  const chipLabel = lensMomentum?.label ?? momentum?.label;
  const chipHint = lensMomentum?.hint ?? momentum?.hint;

  // The neutral market content — the middle of the mobile case carousel, and the
  // whole scroll area otherwise. Kept in one place so both paths render the same.
  // The Judge — the neutral balance sheet, identical whether the Case is open or
  // closed. Totals → Pulse → Live Now → The House. Opening the Case only changes
  // the side panels; the center never becomes analytics or takes a side.
  const marketInner = (
    <>
      {/* THE ONE TIMEFRAME — a single control in the center. Every number below
      and in both Case columns (totals' deltas, percentages, sparklines, copy)
      is measured over exactly this period. */}
      <div className="max-w-[300px]">
        <WindowFilter win={deckWin} onWin={setDeckWindow} />
      </div>

      {/* MARKET MOMENTUM — the one block that answers "why should I care about
      this market now?": believers + capital (value · sparkline · %), a status
      pill for the shape. Believers + capital + the momentum label, from the
      canonical marketBook so the totals reconcile with the side panels. The
      narrative, the House voice and the activity all live in the right feed. */}
      <MarketMomentum
        tape={change?.tape}
        ethUsd={ethUsd}
        win={deckWin}
        footer={
          onToggleCase && !storySide && !mobileCaseOpen ? (
            <ExamineCta open={caseOpen} onToggle={onToggleCase} teaser={caseTeaser} />
          ) : null
        }
      />

      {/* SHARED CONVICTION — side-blind belonging: your Tribe/Twin/Opp are here. */}
      <SharedConviction
        marketId={marketId}
        viewerWallet={viewerWallet}
        onSelectPerson={onSelectPerson}
      />

      {/* One-time nudge: the first real match, surfaced to explore. */}
      <DnaFirstReveal viewerWallet={viewerWallet} onSelectPerson={onSelectPerson} />
    </>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Identity — pinned to the top of the column. In mobile Case mode the
        question moves into the carousel header, so this collapses. */}
      <div className={`shrink-0 ${mobileCaseOpen ? "hidden" : ""}`}>
        <div className="mb-1 flex items-center gap-2">
          {(category || freshToken) && (
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
              {[category, freshToken].filter(Boolean).join(" · ")}
            </span>
          )}
          {cm?.market && (
            <span
              title="Markets created here don't appear on pov.co yet."
              className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)]"
            >
              · Company exclusive
            </span>
          )}
          {lens && lenses && onLens ? (
            <span className="ml-auto">
              <LensPicker
                lens={lens}
                lenses={lenses}
                onLens={onLens}
                tone={chipTone}
                label={chipLabel}
                title={chipHint}
                align="right"
              />
            </span>
          ) : (
            momentum && (
              <span
                title={momentum.hint}
                className="ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]"
                style={{
                  color: momentum.hue,
                  background: `color-mix(in oklab, ${momentum.hue} 13%, transparent)`,
                  border: `1px solid color-mix(in oklab, ${momentum.hue} 32%, transparent)`,
                }}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: momentum.hue }}
                  aria-hidden
                />
                {momentum.label}
              </span>
            )
          )}
        </div>

        <div className="flex items-start gap-1.5">
          <h1 className="min-w-0 flex-1 text-[clamp(20px,2.4vw,30px)] font-semibold leading-tight tracking-tight text-[var(--text)]">
            {title}
          </h1>
          <StandOnIt
            variant="title"
            className="-mr-1.5 mt-0.5"
            marketId={marketId}
            title={title}
            side={held?.side ?? side ?? null}
            hasMedia={!!stageMedia}
          />
        </div>
        <MarketByline
          onchainId={Number(row.onchain_id)}
          viewerWallet={viewer}
          onSelectPerson={onSelectPerson}
        />
      </div>

      {/* Investigation Mode: one side's story replaces the comparison, while the
        side columns stay put as anchors and the decision dock stays reachable. */}
      {storySide ? (
        <CaseStory
          side={storySide}
          marketId={marketId}
          ethUsd={ethUsd}
          viewerWallet={viewerWallet}
          onClose={() => onCloseStory?.()}
        />
      ) : mobileCaseOpen ? (
        <MobileCaseView
          title={title}
          marketId={marketId}
          row={row}
          viewerWallet={viewerWallet}
          ethUsd={ethUsd}
          onClose={() => onToggleCase?.()}
          onBackSide={(s) => chooseSide(s)}
        >
          {marketInner}
        </MobileCaseView>
      ) : stageMedia ? (
        /* Markets WITH evidence: same panel, now one of two stage states. */
        <MediaStage media={stageMedia} className="flex min-h-0 flex-1 touch-pan-y flex-col">
          {marketInner}
        </MediaStage>
      ) : (
        <div className="flex min-h-0 flex-1 touch-pan-y flex-col gap-3 overflow-y-scroll overscroll-contain pr-0.5 [-webkit-overflow-scrolling:touch]">
          {marketInner}
        </div>
      )}

      {/* Decision dock — buy by default; sell takes over when opened on a holding.
        Reaching the dock is the strongest signal a wallet is about to be needed,
        so hover/touch/focus here starts the wallet chunks before the click. */}
      <div className="shrink-0 space-y-3 pb-[env(safe-area-inset-bottom)]" {...walletIntent}>
        {/* The controls. The analysis rail now lives inside the Total Market
          instrument above, so the dock is only the order surface. */}
        <div className="overflow-hidden rounded-[16px]" style={{ background: "var(--surface)" }}>
          {held && sellPct != null ? (
            <OrderTicket
              mode="sell"
              held={held}
              pct={sellPct}
              setPct={setSellPct}
              proceeds={proceeds}
              quoting={sellQuoting}
              ethUsd={ethUsd}
              worthUsd={heldSideData?.worth ?? null}
              ready={ready}
              trade={trade}
              onConfirm={onSellConfirm}
              onCancel={closeSell}
              onDone={() => {
                void bal.refetch();
                closeSell();
              }}
            />
          ) : held && !buyMore ? (
            /* State 2 — you own this market: manage the position. The first choice
            is only Sell or Buy More; each hands off to the same OrderTicket. */
            <PositionActions
              side={held.side}
              onSell={openSell}
              onBuyMore={() => {
                trade.reset();
                setBuyMore(true);
                setSide(held.side); // preselect the side you already own
              }}
            />
          ) : (
            /* State 1 — discovery buy (NO / PASS / YES), OR Buy More with your side
            preselected. Same OrderTicket either way; only the initial state differs. */
            <OrderTicket
              mode="buy"
              side={side}
              amount={amount}
              setAmount={setAmount}
              onSelect={(s) => {
                trade.reset();
                chooseSide(s);
              }}
              onCancel={() => {
                setSide(null);
                if (held) setBuyMore(false); // back to the position summary
              }}
              onPass={() => choosePass()}
              quote={quote}
              quoting={quoting}
              ethWei={ethWei}
              ethUsd={ethUsd}
              ready={ready}
              trade={trade}
              onConfirm={async () => {
                if (!ready.connected) return requestConnect();
                if (!ready.onBase) return switchChain({ chainId: CHAIN_ID });
                if (side && quote && ethWei > 0n && !(trade.isSubmitting || trade.isMining)) {
                  try {
                    await trade.buy(marketId, side === "YES", ethWei, quote.tokens);
                  } catch {
                    /* surfaced via trade.error */
                  }
                }
              }}
              onDone={() => {
                void bal.refetch();
                onSkip();
              }}
            />
          )}
        </div>

        {/* Once you've backed a side, the movement it belongs to — and how close
          it is to its next stage. Believers only; a whale can't fake a crowd. */}
        {held && (
          <MovementLine
            believers={Number(held.side === "YES" ? rr.believers_yes : rr.believers_no) || 0}
            side={held.side}
            className="mt-2"
          />
        )}

        {/* The payoff for standing on it: what your link has brought in. Only
          renders once it's real (a believer, not just an open). */}
        <ShareImpact marketId={marketId} wallet={viewerWallet} />
      </div>
    </div>
  );
}

/**
 * Who opened the question — a real identity, not a raw address. Avatar + name
 * (resolved server-side in one request), plus how old the market reads in plain
 * words. Hovering the face reveals the viewer's shared Conviction DNA with the
 * creator (relationship, agreement, shared beliefs) when one exists. Clicking
 * opens the creator's profile, never a block explorer.
 */
function MarketByline({
  onchainId,
  viewerWallet,
  onSelectPerson,
}: {
  onchainId: number;
  viewerWallet?: string;
  onSelectPerson?: (wallet: string) => void;
}) {
  const { data } = useQuery({
    queryKey: ["conviction-market", onchainId],
    queryFn: () => getConvictionMarket({ data: { onchainId } }),
    staleTime: 5 * 60_000,
  });
  // Reuses the deck's existing network query — no extra request.
  const { data: net } = useQuery({
    queryKey: ["network", viewerWallet ?? null, "all", "relevant", ""],
    queryFn: () => getNetwork({ data: { wallet: viewerWallet, limit: 60 } }),
    enabled: !!viewerWallet,
    staleTime: 60_000,
  });

  const c = data?.creator ?? null;
  const createdAt = data?.createdAt ?? c?.createdAt ?? null;
  if (!c) return null;

  const when = createdAt
    ? marketAgeCopy(Date.now() - new Date(createdAt).getTime()).toLowerCase()
    : "opened this market";
  const clickable = !!onSelectPerson;

  const match =
    viewerWallet && viewerWallet.toLowerCase() !== c.wallet.toLowerCase()
      ? (net?.people ?? []).find((p) => p.wallet.toLowerCase() === c.wallet.toLowerCase())
      : undefined;
  const dna =
    match && match.relationship !== "insufficient"
      ? `${RELATIONSHIP_TEXT[match.relationship]} · ${match.agreement}% agreement across ${match.sharedBeliefs} shared beliefs`
      : null;
  const tone = match ? relationshipTone(match.relationship) : null;

  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={() => onSelectPerson?.(c.wallet)}
      title={dna ? `Your Conviction DNA with ${c.name}: ${dna}` : undefined}
      className="group relative mt-2 flex items-center gap-2 text-left disabled:cursor-default"
    >
      {c.avatarUrl ? (
        <img src={c.avatarUrl} alt="" className="h-6 w-6 shrink-0 rounded-full object-cover" />
      ) : (
        <span
          className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[9px] font-semibold text-white"
          style={{ background: `hsl(${hueFor(c.wallet)} 45% 45%)` }}
          aria-hidden
        >
          {initialsFor(c.name)}
        </span>
      )}
      <span className="min-w-0 truncate text-[12px] text-[var(--text-secondary)]">
        <span className={`font-semibold text-[var(--text)] ${clickable ? "hover:underline" : ""}`}>
          {c.name}
        </span>
        <span className="text-[var(--text-muted)]"> · {when}</span>
      </span>
      {dna && tone && (
        <span
          role="tooltip"
          className="pointer-events-none absolute left-0 top-full z-20 mt-1 hidden whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[11px] font-medium shadow-lg group-hover:block"
          style={{
            color: tone.fg,
            background: "var(--surface)",
            border: `1px solid color-mix(in oklab, ${tone.fg} 35%, transparent)`,
          }}
        >
          {dna}
        </span>
      )}
    </button>
  );
}

/**
 * The split-panel mark: two halves that part to reveal what sits behind them.
 * Open state draws them closer together — the same gesture, reversed.
 */
function SplitPanelIcon({ open }: { open: boolean }) {
  const gap = open ? 1.1 : 2.4;
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden
      className="shrink-0 transition-[transform] duration-200 motion-reduce:transition-none"
    >
      <rect
        x={2.5 - gap / 2}
        y="3.5"
        width="5.5"
        height="11"
        rx="1.2"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <rect
        x={10 + gap / 2}
        y="3.5"
        width="5.5"
        height="11"
        rx="1.2"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  );
}

/** The analytical spark — an amber four-point mark, decorative. */
function SignalSpark({ hot }: { hot: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 12 12"
      aria-hidden
      className="shrink-0 transition-opacity duration-500 motion-reduce:transition-none"
      style={{ color: "var(--signal,#d99a2b)", opacity: hot ? 1 : 0.82 }}
    >
      <path
        d="M6 0.6 L7.05 4.95 L11.4 6 L7.05 7.05 L6 11.4 L4.95 7.05 L0.6 6 L4.95 4.95 Z"
        fill="currentColor"
      />
    </svg>
  );
}

/**
 * The analysis rail — the market signal on the left, the Case File disclosure on
 * the right, as ONE full-width control attached to the top of the action
 * surface. No card, no tab: a divider does the separating, and the whole strip
 * opens both Case File panels.
 */
function ExamineCta({
  open,
  onToggle,
  teaser,
}: {
  open: boolean;
  onToggle: () => void;
  /** The momentum/pulse read, shown as the market signal. */
  teaser?: string | null;
}) {
  const signal = teaser ?? "Market signal forming.";
  // A single, brief attention beat when the READ itself changes — never on
  // mount, never on a rerender that says the same thing.
  const seen = useRef<string | null>(null);
  const [hot, setHot] = useState(false);
  useEffect(() => {
    if (seen.current === null) {
      seen.current = signal;
      return;
    }
    if (seen.current === signal) return;
    seen.current = signal;
    setHot(true);
    const t = setTimeout(() => setHot(false), 450);
    return () => clearTimeout(t);
  }, [signal]);

  return (
    <div>
      {/* The concise market insight — a row of the instrument, not a card. */}
      <div
        className="flex min-w-0 items-center gap-2 px-4 py-3 text-[13px] leading-snug text-[var(--text)] transition-[background-color] duration-200 sm:px-5"
        style={{
          background: hot ? "color-mix(in oklab,#d99a2b 9%,transparent)" : "transparent",
        }}
      >
        <SignalSpark hot={hot} />
        <span className="min-w-0">{signal}</span>
      </div>
      <div className="border-t border-[var(--hairline)]" aria-hidden />
      {/* Case File disclosure — says plainly what opening it reveals. */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={open ? "Close YES and NO Case File." : "Open YES and NO Case File."}
        className="group flex min-h-[48px] w-full cursor-pointer items-center justify-center gap-[9px] px-4 py-3 text-center transition-[background-color,transform] duration-200 active:scale-[0.995] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--text)] motion-reduce:transition-none motion-reduce:active:scale-100 sm:px-5"
      >
        <SplitPanelIcon open={open} />
        <span className="min-w-0 text-[12px] font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)] transition-colors group-hover:text-[var(--text)]">
          {open ? "Close Case File" : "Case File · How the Market Divides (YES vs NO)"}
        </span>
      </button>
    </div>
  );
}

/** A quiet hairline between the center's sections — the reading path, not a card. */
function Hairline() {
  return <div className="border-t border-[var(--hairline)]" aria-hidden />;
}

/**
 * Owned-market resting state (State 2): a compact position summary and the two
 * decisions — Sell or Buy More — that hand off to the SAME <OrderTicket>. No new
 * order surface; the first question is only "what do you want to do?".
 */
function PositionActions({
  side,
  onSell,
  onBuyMore,
}: {
  side: OrderSide;
  onSell: () => void;
  onBuyMore: () => void;
}) {
  // No summary card — "Buy more YES" already says what you hold; the worth/P&L
  // lives in Positions. The market page's job here is only the two choices.
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onSell}
        className="h-[52px] flex-1 rounded-[12px] text-[14px] font-semibold text-[var(--text-secondary)]"
        style={{ border: "1px solid var(--border)" }}
      >
        Sell
      </button>
      <button
        type="button"
        onClick={onBuyMore}
        className="h-[52px] flex-[1.4] rounded-[12px] text-[15px] font-semibold"
        style={{ background: "var(--text)", color: "var(--bg)" }}
      >
        Buy more {side}
      </button>
    </div>
  );
}
