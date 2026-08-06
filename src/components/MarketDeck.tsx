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
import { networkQO } from "@/lib/network-query";
import { getMarketChange, getPositionSummary } from "@/lib/markets.functions";
import { getMarketEvidence } from "@/lib/evidence.functions";
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
import { houseReadState } from "@/domain/house-read";
import { WindowFilter } from "@/components/WindowFilter";
import { useDeckWindow, setDeckWindow } from "@/lib/deck-window";
import { OrderTicket } from "@/components/order/OrderTicket";
import { useOwnedDock, OwnedDock, ownedDockShown } from "@/components/order/OwnedDock";
import { ExamineCta } from "@/components/order/ExamineRail";
import { StandOnIt } from "@/components/StandOnIt";
import { ShareImpact } from "@/components/ShareImpact";

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
  caseOpen = false,
  mobileCaseOpen = false,
  onToggleCase,
  onSelectPerson,
}: {
  row: MarketRow;
  ethUsd: number;
  onSkip: () => void;
  viewerWallet?: string;
  /** Case File mode (desktop): the YES/NO evidence moves to the side columns. */
  caseOpen?: boolean;
  /** Case File mode (mobile): the center becomes a NO ← MARKET → YES carousel. */
  mobileCaseOpen?: boolean;
  onToggleCase?: () => void;
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

  const { switchChain } = useSwitchChain();
  const ready = useTradeReady();
  const trade = useTrade();
  const bal = useUserBalance(marketId);
  const house = useHouseFinalize(marketId, viewerWallet);
  // The owned-position flow — the SAME hook the phone game mounts, so the
  // ownership model, the sell path and the selector can never drift apart.
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
    // Per-market key: carrying the previous result across a market change would
    // paint another market's data under this one's title. The scene holds the
    // whole previous market instead, so there is nothing to bridge here.
  });

  // The one on-screen timeframe — the center owns it, both cases follow it.
  const deckWin = useDeckWindow();

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
    // Per-market key — see above: never bridge across markets.
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
    // Per-market key — see above: never bridge across markets.
  });
  const holders = evidence?.believers ?? [];

  // The reveal needs the viewer's network (for Tribe / Opps / Twin faces) and the
  // House read (its pick + surprise streak). Both cached, both used elsewhere.
  const { data: net } = useQuery(networkQO(viewer));
  const { data: houseRead } = useQuery({
    queryKey: houseKey(viewer, marketId),
    queryFn: () => getHouseRead({ data: { wallet: viewer ?? null, marketId } }),
    staleTime: 30_000,
    // Per-market key — see above: the House's read on the LAST market is not a
    // placeholder for this one, it is a wrong answer.
  });

  // The center's believer total must be the SAME source the YES and NO rails
  // headline (market_state per-side counts), or the two sides will not add up to
  // the total. Null when the row has no counts → the tape tally stands in.
  const authBelieversTotal = useMemo(() => {
    const r = row as Record<string, unknown>;
    const y = Number(r["believers_yes"]);
    const n = Number(r["believers_no"]);
    if (!Number.isFinite(y) && !Number.isFinite(n)) return null;
    return (Number.isFinite(y) ? y : 0) + (Number.isFinite(n) ? n : 0);
  }, [row]);

  // Capital must come from the SAME holders row the sides quote — the tape replay
  // leaves float residue after full exits, which showed money on an empty market.
  const authCapitalUsd = useMemo(() => {
    const r = row as Record<string, unknown>;
    const y = Number(r["yes_capital_usd"]);
    const n = Number(r["no_capital_usd"]);
    if (!Number.isFinite(y) && !Number.isFinite(n)) return null;
    return (Number.isFinite(y) ? y : 0) + (Number.isFinite(n) ? n : 0);
  }, [row]);

  // THE HOUSE READ — derived by the shared pure engine, so desktop and mobile
  // show the same state from the same data. Only a connected viewer has tells to
  // read; anonymous browsing shows no row at all.
  const houseReadState_ = useMemo(
    () => (viewerWallet ? houseReadState(houseRead ?? null) : null),
    [viewerWallet, houseRead],
  );

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
    dock.reset();
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
      if (e.key === "ArrowLeft") chooseSide("YES");
      else if (e.key === "ArrowRight") chooseSide("NO");
      else if (e.key === "ArrowUp") {
        e.preventDefault();
        choosePass();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chooseSide, choosePass]);

  // The shared owned-position surface: ownership + the stable Buy · Sell · Pass
  // selector, or the sell ticket. `ownedDockShown` decides which surface has the
  // dock — ownership never hijacks a buy the viewer has already started.
  const dockOwns = ownedDockShown(dock, side);
  const dockNode = (
    <OwnedDock
      api={dock}
      buySide={side}
      ethUsd={ethUsd}
      ready={ready}
      trade={trade}
      onBuySide={(s) => chooseSide(s)}
      onPass={() => choosePass()}
      onSold={() => {
        void bal.refetch();
        dock.closeSell();
      }}
    />
  );

  const relationshipBeat = row.story?.beats.find((b) => b.kind === "relationship")?.text ?? null;
  const eventBeat = row.story?.beats.find((b) => b.kind === "event")?.text ?? null;
  // A completed BUY takes over the whole center: the Conviction Reveal — the same
  // story engine + component the mobile game uses. The trade was only the unlock.
  if (trade.isSuccess && side != null && !dock.isSelling) {
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
  // ONE chip, and it now says only one thing: this market's own momentum.
  // It used to be polymorphic — same position, same colours, same shape for
  // "this market is HOT" and "you are filtering by HOT" — two unrelated
  // meanings in one control. The filter moved to the rail's Feed tab; the slot
  // went back to being a fact about what you are looking at.
  const chipTone = momentum?.hue;
  const chipLabel = momentum?.label;
  const chipHint = momentum?.hint;

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
        believersTotal={authBelieversTotal}
        capitalTotalUsd={authCapitalUsd}
        footer={
          onToggleCase && !mobileCaseOpen ? (
            <ExamineCta open={caseOpen} onToggle={onToggleCase} houseRead={houseReadState_} />
          ) : null
        }
      />

      {/* SHARED CONVICTION — belonging: your Tribe/Twin/Opp are here, and which
          way they went. */}
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
        {/* Meta row — its height is RESERVED. Category, age, the exclusivity
          note and the lens chip all arrive asynchronously and are individually
          optional; without a floor here a market that has none of them sits the
          title (and therefore the whole body and the dock) 26px higher than a
          market that has all of them. */}
        <div className="mb-1 flex min-h-[26px] items-center gap-2">
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
          {momentum && (
            <span
              title={chipHint}
              className="ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]"
              style={{
                color: chipTone,
                background: `color-mix(in oklab, ${chipTone} 13%, transparent)`,
                border: `1px solid color-mix(in oklab, ${chipTone} 32%, transparent)`,
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: chipTone }}
                aria-hidden
              />
              {chipLabel}
            </span>
          )}
        </div>

        <div className="flex items-start gap-1.5">
          {/* A DELIBERATE TITLE RULE: exactly two lines of space, always.
            One-line and three-line questions occupy the same box, so nothing
            below the question — the market body, the dock, the controls — ever
            moves because one market asks a longer question than the last.
            `2.4em` is two lines at this element's own 1.2 line-height, in `em`
            so it tracks the clamped font size across viewports. */}
          <h1
            className="line-clamp-2 min-h-[2.4em] min-w-0 flex-1 text-[clamp(20px,2.4vw,30px)] font-semibold leading-[1.2] tracking-tight text-[var(--text)]"
            title={title}
          >
            {title}
          </h1>
          <StandOnIt
            variant="title"
            className="-mr-1.5 mt-0.5"
            marketId={marketId}
            title={title}
            side={side ?? dock.sellSide ?? dock.owned.only}
            hasMedia={!!stageMedia}
          />
        </div>
        {/* The byline renders nothing until the creator lookup lands, and
          nothing at all for a market with no creator on record. Reserving its
          row means the market body below starts at the same y either way,
          instead of jumping up 32px and back down as the lookup resolves. */}
        <div className="min-h-[32px]">
          <MarketByline
            onchainId={Number(row.onchain_id)}
            viewerWallet={viewer}
            onSelectPerson={onSelectPerson}
          />
        </div>
      </div>

      {mobileCaseOpen ? (
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
      ) : (
        /* ONE stage for every market, with or without evidence. This used to be
          two different elements chosen by `stageMedia`, which meant moving
          between a market that has media and one that doesn't unmounted and
          rebuilt the entire market body — visible as the panel blinking on
          exactly those transitions, and a wasted round of mounts. MediaStage
          now takes `null` and renders a plain single-page scroller. */
        <MediaStage media={stageMedia} className="flex min-h-0 flex-1 touch-pan-y flex-col">
          {marketInner}
        </MediaStage>
      )}

      {/* Decision dock — buy by default; sell takes over when opened on a holding.
        Reaching the dock is the strongest signal a wallet is about to be needed,
        so hover/touch/focus here starts the wallet chunks before the click. */}
      <div
        data-probe="dock"
        className="shrink-0 space-y-3 pb-[env(safe-area-inset-bottom)]"
        {...walletIntent}
      >
        {/* The controls. The analysis rail now lives inside the Total Market
          instrument above, so the dock is only the order surface. */}
        <div className="overflow-hidden rounded-[16px]" style={{ background: "var(--surface)" }}>
          {/* Owned and undecided? The SHARED dock renders ownership + the stable
            selector (or the sell ticket). Otherwise the buy ticket takes over —
            discovery (Back YES · Back NO · Pass), or the amount + confirm form
            once a side is chosen. The SAME ticket in both cases. */}
          {dockOwns ? (
            dockNode
          ) : (
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
                dock.setAction(null); // back to the stable selector when you own something
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
  const { data: net } = useQuery(networkQO(viewerWallet));

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

/* The analysis rail (market signal + Case File disclosure) now lives in
   src/components/order/ExamineRail.tsx — shared with the phone dock. */

/** A quiet hairline between the center's sections — the reading path, not a card. */
function Hairline() {
  return <div className="border-t border-[var(--hairline)]" aria-hidden />;
}
