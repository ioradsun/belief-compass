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
 * desktop deck uses (marketBook / evidence / house read), so the
 * two experiences can never disagree.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { networkQO } from "@/lib/network-query";
import { useSwitchChain } from "wagmi";

import type { MarketRow } from "@/components/MarketCard";
import { pulseLine } from "@/components/MarketCard";
import { MarketMomentum } from "@/components/MarketVitality";
import { marketStateFacts } from "@/domain/insider";
import { relationFromGroup } from "@/domain/participant-social";
import { presentRelationship } from "@/domain/relationship";
import { WindowFilter } from "@/components/WindowFilter";
import { useDeckWindow, setDeckWindow } from "@/lib/deck-window";
import { CurrentMarketActivity } from "@/components/CurrentMarketActivity";
import { useHouseFinalize } from "@/lib/house-round";
import { useAnswerCalls } from "@/hooks/useAnswerCalls";
import { listMarketPulses, type VolumeWindow } from "@/lib/markets.functions";
import { marketChangeQO, evidenceQO } from "@/lib/market-queries";
import { useMarketChange } from "@/lib/market-change-query";
import { getConvictionMarket } from "@/lib/market-create.functions";
import { marketAgeCopy } from "@/domain/market-freshness";
import { MediaStage, stageMediaFrom } from "@/components/MediaStage";
import { StandOnIt } from "@/components/StandOnIt";
import { CaseRoster } from "@/components/CaseFile";
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
import { houseReadState } from "@/domain/house-read";
import { ConvictionReveal } from "@/components/ConvictionReveal";
import { getConvictionReveal } from "@/domain/conviction-reveal";
import { assembleRevealInput } from "@/lib/reveal-input";
import { marketTitle } from "@/domain/market-title";
import { compareSides, comparisonStrip, type StripSide } from "@/domain/side-compare";

import { hueFor, initialsFor } from "@/lib/wallet-identity";

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
  const title = marketTitle(row.markets?.title, marketId);

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

  // THE SYSTEM BACK GESTURE AGREES WITH THE × BUTTON. Both Sides is a view, so
  // swiping/pressing back closes it rather than leaving the market. Opening it
  // pushes one history entry; closing it by button consumes that entry again,
  // so the stack never grows.
  useEffect(() => {
    if (phase !== "sides") return;
    const marker = { convictionSides: marketId };
    window.history.pushState(marker, "");
    const onPop = () => setPhase("question");
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      const st = window.history.state as { convictionSides?: number } | null;
      if (st?.convictionSides === marketId) window.history.back();
    };
  }, [phase, marketId]);

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

  // WHAT MOVED — the one shared answer (src/domain/market-change), handed to the
  // Total Market instrument instead of letting it derive its own delta from the
  // trade replay. Same query key the Case File runs → a cache hit, no request.
  const marketChange = useMarketChange(marketId, row, deckWin as VolumeWindow);

  const { data: change } = useQuery(marketChangeQO(marketId));
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
  const { data: revealEvidence } = useQuery(evidenceQO(marketId));
  const { data: revealNet } = useQuery(networkQO(viewerWallet));

  // Participants with the viewer's relationship attached — the tile shows the
  // people you know first, in one shared list.
  const participantFaces = useMemo(() => {
    const rel = new Map<string, string>();
    for (const p of revealNet?.people ?? [])
      rel.set(
        p.wallet.toLowerCase(),
        presentRelationship({
          agreement: p.agreement,
          sharedConvictions: p.sharedBeliefs,
          together: p.together,
          apart: p.apart,
          topicCount: p.topicCount,
          strongestAlignedTopic: p.strongestAlignedDomain?.name ?? null,
          strongestOpposedTopic: p.strongestOpposedDomain?.name ?? null,
        }).group,
      );
    return (revealEvidence?.believers ?? []).map((h) => ({
      wallet: h.wallet,
      name: h.name,
      avatarUrl: h.avatarUrl,
      relation: relationFromGroup(rel.get(h.wallet.toLowerCase())),
      // The phone card shows faces only; these ride along for the sheet.
      side: h.side,
      valueUsd: h.valueUsd,
      daysHeld: h.daysHeld,
    }));
  }, [revealEvidence, revealNet]);

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

  // The SAME rule the desktop deck runs, from the same hook rather than a second
  // copy of it — a confirmed buy closes every open Challenge in this market.
  useAnswerCalls(viewerWallet, marketId, trade.isSuccess && !!trade.hash);

  const stageMedia = stageMediaFrom(cm);
  const createdAt = cm?.createdAt ?? cm?.creator?.createdAt ?? null;
  // The same byline the desktop deck prints: who opened the question and how
  // old it reads — under the title, never a category strip above it.
  const openedWhen = createdAt
    ? marketAgeCopy(Date.now() - new Date(createdAt).getTime()).toLowerCase()
    : null;

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

  // NOTE: "sides" is no longer an early return. Both Sides is a view of the
  // middle region (see the render below) so the question and the order bar stay
  // mounted and reachable while it is open.

  // ---- The Question — ONE screen. The dock transforms decision → order in place;
  // the House pick + celebration only arrive after the order is placed (above). ----
  // The question block — fixed above the stage when there's evidence, part of
  // the single scroll column when there isn't (that layout is unchanged).
  const questionBlock = (
    <div>
      <div className="flex items-start gap-1.5">
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
      {/* Creator + age under the question — and, for the POV-sourced markets
          with no author on record, the age alone rather than nothing. */}
      {cm?.creator ? (
        <button
          type="button"
          onClick={() => cm.creator && onSelectPerson?.(cm.creator.wallet)}
          className="mt-1.5 flex items-center gap-2 text-left"
        >
          {cm.creator.avatarUrl ? (
            <img
              src={cm.creator.avatarUrl}
              alt=""
              className="h-5 w-5 shrink-0 rounded-full object-cover"
            />
          ) : (
            <span
              className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[8px] font-semibold text-white"
              style={{ background: `hsl(${hueFor(cm.creator.wallet)} 45% 45%)` }}
              aria-hidden
            >
              {initialsFor(cm.creator.name)}
            </span>
          )}
          <span className="min-w-0 truncate text-[12px] text-[var(--text-secondary)]">
            <span className="font-semibold text-[var(--text)]">{cm.creator.name}</span>
            {openedWhen && <span className="text-[var(--text-muted)]"> · {openedWhen}</span>}
          </span>
        </button>
      ) : openedWhen ? (
        <p className="mt-1.5 text-[12px] text-[var(--text-muted)]">Opened · {openedWhen}</p>
      ) : null}
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
          change={marketChange}
          faces={participantFaces}
          state={marketStateFacts(rr)}
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

  const sidesOpen = phase === "sides";

  return (
    <Screen>
      {/* THE FRAME IS CONSTANT. Question above, dock below; only the middle
          swaps between the market view and Both Sides — so closing the case
          returns you to the market without a navigation, and the order bar is
          reachable the whole time you are reading it. */}
      {stageMedia && !sidesOpen ? (
        <>
          <div className="shrink-0 pt-1">{questionBlock}</div>
          <MediaStage media={stageMedia} className="mt-2 flex min-h-0 flex-1 flex-col gap-3 pb-1">
            {marketBody}
          </MediaStage>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden pb-1 pt-1">
          {questionBlock}
          {sidesOpen ? (
            <BothSides
              marketId={marketId}
              ethUsd={ethUsd}
              row={row}
              onClose={() => setPhase("question")}
            />
          ) : (
            marketBody
          )}
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
            open={sidesOpen}
            onToggle={() => setPhase(sidesOpen ? "question" : "sides")}
            houseRead={houseReadState_}
            openLabel="See both sides"
            closeLabel="Back to the market"
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

/**
 * BOTH SIDES — a VIEW of the market, not a destination.
 *
 * It used to be a whole screen: its own `<Screen>`, its own "← Back", and a
 * second copy of the question under it. Reading a side meant leaving the
 * market, and acting on what you read meant going back first. The question and
 * the order bar are constants; only the evidence between them changes. So this
 * now renders INSIDE the market's middle region, between the question above and
 * the dock below, and closes with an × on its own header rather than a back
 * link floating above someone else's title.
 *
 * The comparison sentence and the split come from the same pure
 * `@/domain/side-compare` the desktop Case File reads, so the phone cannot
 * phrase the market differently from the desk.
 */
function BothSides({
  marketId,
  ethUsd,
  row,
  onClose,
}: {
  marketId: number;
  ethUsd: number;
  row: MarketRow;
  onClose: () => void;
}) {
  const [open, setOpen] = useState<OrderSide | null>(null);
  const { unit, format } = useMoney();
  const { data: evidence } = useQuery(evidenceQO(marketId));
  const { data: pulses } = useQuery({
    queryKey: ["market-pulses", String(marketId)],
    queryFn: () => listMarketPulses({ data: { ids: [marketId] } }),
    staleTime: 15_000,
  });
  // WHAT MOVED — the one shared answer, so this phone panel, the desktop Case
  // File and the centre's total cannot disagree. Same query key as the panels
  // above, so it is a cache hit rather than a request.
  //
  // 24h rather than the deck window: this screen has no timeframe control, and
  // quoting a window the reader cannot see or change would be worse than
  // quoting the one the copy below names ("today").
  const marketChange = useMarketChange(marketId, row, "24h" as VolumeWindow);

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

  // The comparison, read the one shared way.
  const rr = row as unknown as Record<string, unknown>;
  const joined = (s: OrderSide) =>
    Number(rr[s === "YES" ? "new_believers_yes_24h" : "new_believers_no_24h"] ?? 0) || 0;
  const snap = (s: OrderSide) => ({
    believers: count(s),
    capitalUsd: capital(s) || null,
    joined: joined(s),
    capitalChangePct: (s === "YES" ? marketChange.yes : marketChange.no).capital.pct,
    priceChangePct: (s === "YES" ? marketChange.yes : marketChange.no).price.pct,
  });
  const { story } = compareSides(snap("YES"), snap("NO"));
  const strip = comparisonStrip(snap("YES"), snap("NO"));

  /** Believers / capital momentum for one side, read the Total Market way. */
  const rows = (s: OrderSide) => {
    const bel = count(s);
    const cap = capital(s);
    // This panel is where "$2.70 COMMITTED · 67298%▲" came from: the window
    // opened with $0.004 on the side — dust the app elsewhere refuses to call
    // capital — and the ratio reported how empty the market had been rather
    // than that $2.69 arrived. The judgement now lives in one module for every
    // surface (src/domain/market-change → gain), not in this function.
    const sideChg = s === "YES" ? marketChange.yes : marketChange.no;
    const belChg = sideChg.believers;
    const capChg = sideChg.capital;
    const belDelta = belChg.delta;
    const capDelta = capChg.delta;
    return [
      {
        label: "Believers",
        value: bel.toLocaleString("en-US"),
        pct: belChg.pct,
        quiet: belChg.rank === "quiet",
        absolute:
          belChg.rank === "origin"
            ? bel === 1
              ? "First believer"
              : `First ${Math.abs(Math.round(belDelta ?? 0))} believers today`
            : belDelta == null
              ? null
              : belDelta === 0
                ? "No change today"
                : `${belDelta > 0 ? "+" : "−"}${Math.abs(belDelta)} believer${Math.abs(belDelta) === 1 ? "" : "s"} today`,
      },
      {
        label: "Committed",
        value: format(cap, "USD"),
        pct: capChg.pct,
        quiet: capChg.rank === "quiet",
        absolute:
          capChg.rank === "origin"
            ? `First capital today · ${format(cap, "USD")}`
            : capDelta == null
              ? null
              : Math.abs(capDelta) < 0.005
                ? "No change today"
                : `${format(capDelta, "USD", { signed: true })} ${capDelta > 0 ? "committed" : "left"} today`,
      },
    ];
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 1 — WHICH SIDE IS GAINING, and the way out. The question above this is
          the market's only title; there is no second copy here. */}
      <div className="mb-2.5 flex shrink-0 items-start gap-2">
        <p className="min-w-0 flex-1 text-[14px] font-medium leading-snug text-[var(--text)]">
          {story}
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close both sides"
          className="-mr-1 -mt-1 shrink-0 rounded-full px-2 py-1 text-[15px] leading-none text-[var(--text-muted)] transition-colors active:text-[var(--text)]"
        >
          ×
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pb-3 [-webkit-overflow-scrolling:touch]">
        {/* 2 — THE BALANCE, before any number. */}
        <SplitBar strip={strip} />

        {/* 3 — BOTH SIDES AT ONCE. Neither is behind a tap; the tap only adds
            depth (who, why, what just happened) to the one you asked about. */}
        {(["YES", "NO"] as OrderSide[]).map((s) => {
          const color = s === "YES" ? "var(--yes)" : "var(--no)";
          const isOpen = open === s;
          return (
            <div
              key={s}
              className="rounded-[14px] px-3.5 py-3"
              style={{
                background: "var(--surface)",
                border: isOpen ? `1px solid ${color}` : "1px solid var(--border)",
              }}
            >
              <button
                type="button"
                onClick={() => setOpen((cur) => (cur === s ? null : s))}
                aria-expanded={isOpen}
                className="w-full text-left"
              >
                <div
                  className="flex items-baseline justify-between text-[16px] font-semibold"
                  style={{ color }}
                >
                  {s}
                  <span className="text-[11px] font-medium text-[var(--text-muted)]">
                    {isOpen ? "Hide" : "Details"}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {rows(s).map((m) => (
                    <SideMetric
                      key={m.label}
                      label={m.label}
                      value={m.value}
                      pct={m.pct}
                      quiet={m.quiet}
                      absolute={m.absolute}
                      color={color}
                    />
                  ))}
                </div>
              </button>

              {isOpen && (
                <SideDetailSheet side={s} color={color} onClose={() => setOpen(null)}>
                  {/* WHO BACKS THIS SIDE — inside the disclosure, so two closed
                      sides always fit the region together. */}
                  <CaseRoster
                    side={s}
                    believers={believers.filter((b) => b.side === s)}
                    priceUsd={Number(s === "YES" ? row.yes_price_usd : row.no_price_usd) || null}
                    variant="compact"
                  />
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
                        Insider Moves
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
                </SideDetailSheet>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * SIDE DETAIL — a full-screen sheet, above everything.
 *
 * On a phone the Both Sides region is a short middle band between the question
 * and the order dock. Expanding a side inside it left the roster and activity
 * clipped by that band. The detail is portalled to the body instead, so the
 * content the reader asked for owns the screen while it is open.
 */
function SideDetailSheet({
  side,
  color,
  onClose,
  children,
}: {
  side: OrderSide;
  color: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    // Stops at the top of the order dock (`--dock-h`, published by <Dock/>), so
    // backing a side stays one tap away while you are reading about it.
    <div
      className="fixed inset-x-0 top-0 z-[120] flex flex-col"
      style={{ bottom: "var(--dock-h, 0px)" }}
      role="dialog"
      aria-modal="false"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60"
      />

      <div
        className="relative mt-auto flex max-h-full min-h-0 w-full flex-col overflow-hidden rounded-t-[18px] border-t bg-[var(--bg)] pt-3"
        style={{ borderColor: color }}
      >
        <div className="mb-2 flex shrink-0 items-center justify-between px-4">
          <span className="text-[13px] font-semibold" style={{ color }}>
            {side} · the detail
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 rounded-full px-2 py-1 text-[16px] leading-none text-[var(--text-muted)]"
          >
            ×
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 pb-[max(20px,env(safe-area-inset-bottom))] [-webkit-overflow-scrolling:touch]">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * One bar, split by believers. The share arrives already computed beside the
 * numbers (see `comparisonStrip`) so the bar and the counts under it cannot
 * disagree.
 */
function SplitBar({ strip }: { strip: readonly [StripSide, StripSide] }) {
  const [yes, no] = strip;
  return (
    <div className="flex h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]" aria-hidden>
      <span style={{ width: `${yes.share * 100}%`, background: "var(--yes)" }} />
      <span style={{ width: `${no.share * 100}%`, background: "var(--no)" }} />
    </div>
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
  quiet = false,
  absolute,
  color,
}: {
  label: string;
  value: string;
  /** Already ranked by `gain` — null means no base worth dividing by. */
  pct: number | null;
  /** A real base, but a thin one: shown small, never as the figure. */
  quiet?: boolean;
  absolute?: string | null;
  color: string;
}) {
  const flat = pct == null || Math.abs(pct) < 0.05;
  const tone = flat ? "var(--text-muted)" : pct! > 0 ? "var(--gain)" : "var(--loss)";
  const arrow = flat ? "" : pct! > 0 ? "▲" : "▼";
  const pctText =
    pct == null ? "" : `${Math.abs(pct).toFixed(!flat && Math.abs(pct) < 10 ? 1 : 0)}%`;
  // No percentage → the absolute change is the movement figure, so it steps up.
  const leadAbsolute = pct == null;
  return (
    <div
      className="rounded-[10px] py-2 pl-2 pr-2.5"
      style={{
        borderLeft: `2px solid ${color}`,
        background: `color-mix(in oklab, ${color} 7%, transparent)`,
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="num min-w-0 truncate text-[18px] font-semibold leading-none tracking-[-0.02em] text-[var(--text)]">
          {value}
        </span>
        <span
          className={`num shrink-0 font-semibold leading-none tabular-nums ${quiet ? "text-[11px]" : "text-[14px]"}`}
          style={{ color: tone, opacity: quiet ? 0.55 : 1 }}
        >
          {pctText}
          {arrow && pctText ? (
            <span className="ml-1 align-middle text-[0.6em]">{arrow}</span>
          ) : null}
        </span>
      </div>
      <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">
        {label}
      </div>
      {absolute && (
        <div
          className={`num mt-0.5 ${leadAbsolute ? "text-[12.5px] font-medium" : "text-[11px]"}`}
          style={{ color: "var(--text-muted)" }}
        >
          <span style={{ color: tone }}>{absolute.split(" ")[0]}</span>
          {absolute.slice(absolute.split(" ")[0].length)}
        </div>
      )}
    </div>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full min-h-0 flex-col">{children}</div>;
}

function Dock({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  /**
   * THE ORDER BAR IS NEVER COVERED.
   *
   * Opening a side's detail put a full-screen sheet over everything, dock
   * included — so the one thing a reader wants after reading a side ("back it")
   * was under a backdrop and every tap died there. The dock publishes its own
   * height so any sheet can stop exactly above it instead of guessing.
   */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const publish = () =>
      document.documentElement.style.setProperty("--dock-h", `${Math.round(el.offsetHeight)}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty("--dock-h");
    };
  }, []);
  return (
    <div
      ref={ref}
      className="sticky bottom-0 z-[130] mt-auto shrink-0 pt-2"
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
