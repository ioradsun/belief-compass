/**
 * OWNED DOCK — the one owned-position surface, shared by desktop and mobile.
 *
 * Ownership is CONTEXT, never the controls (see src/domain/order-actions): the
 * dock shows every side you actually hold above ONE stable selector, and the
 * side is chosen explicitly in the SAME three-button footprint.
 *
 *     YOU OWN  YES $24.10   NO $9.30
 *     [ Buy ]      [ Sell ]      [ Pass ]
 *
 *     Buy  → Back YES · Back NO · Cancel
 *     Sell → one side owned: straight to it
 *            both owned:     Sell NO · Sell YES · Cancel
 *
 * The desktop deck and the phone game used to diverge here — the phone had no
 * sell path at all, so owning shares on a phone was a one-way door. Both now
 * mount this exact hook + component, so the trading logic can never drift again;
 * only the surrounding composition differs (the phone stays decision-first).
 */
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { positionSummaryQO } from "@/lib/positions-query";
import { simulationPositionQO } from "@/lib/simulation-query";
import { useSellQuote, type useTradeReady } from "@/lib/chain-trade";
import { fmtShares, sharesForPct, type OrderSide } from "@/domain/order";
import {
  ownedPositions,
  sellStep,
  heldSide,
  dockSurface,
  type Owned,
} from "@/domain/order-actions";
import { useMoney } from "@/lib/display-unit";
import { OrderTicket, OwnedLine, SideButton } from "@/components/order/OrderTicket";
import { weiToEth } from "@/domain/money";
import { formatCC, sharesToWei } from "@/domain/simulation";
import type { SimulationTicket, TradeLike } from "@/lib/market-execution";

type TradeApi = TradeLike;
type ReadyApi = ReturnType<typeof useTradeReady>;

export interface OwnedDockApi {
  owned: Owned;
  /** The side being sold, once chosen. Null while not selling. */
  sellSide: OrderSide | null;
  sellPct: number | null;
  /** True while the sell ticket is open — parents guard the buy Reveal on this. */
  isSelling: boolean;
  action: "buy" | "sell" | null;
  setAction: (a: "buy" | "sell" | null) => void;
  setSellPct: (n: number | null) => void;
  openSell: () => void;
  chooseSellSide: (s: OrderSide) => void;
  closeSell: () => void;
  onSellConfirm: () => Promise<void>;
  /** Clear every owned-flow bit — call when the market changes. */
  reset: () => void;
  proceeds: bigint | null;
  sellQuoting: boolean;
  worthUsd: number | null;
  sellTokens: bigint;
}

export function useOwnedDock({
  marketId,
  viewerWallet,
  yesTokens,
  noTokens,
  ethUsd,
  ready,
  trade,
  sim,
  onRequestConnect,
  onRequestChain,
}: {
  marketId: number;
  viewerWallet?: string;
  /** The REAL on-chain balances. Ignored entirely while Simulation is active. */
  yesTokens: bigint;
  noTokens: bigint;
  /** The live rate — turns on-chain proceeds into a value the field can size. */
  ethUsd: number;
  ready: ReadyApi;
  trade: TradeApi;
  /** Simulation ledger descriptor, or null in Real Mode. */
  sim?: SimulationTicket | null;
  onRequestConnect: () => void;
  onRequestChain: () => void;
}): OwnedDockApi {
  const [sellSide, setSellSide] = useState<OrderSide | null>(null);
  const [sellPct, setSellPct] = useState<number | null>(null);
  const [action, setAction] = useState<"buy" | "sell" | null>(null);

  // The viewer's honest ownership numbers on THIS market (cost basis + worth).
  const { data: posSummary } = useQuery(positionSummaryQO(viewerWallet, marketId));
  /**
   * THE OTHER LEDGER'S HOLDING. Queried under its own key, so a real position
   * and a simulated one on the same market can never occupy the same cache entry
   * — and only one of them is ever read into the dock.
   */
  const { data: simPos } = useQuery({
    ...simulationPositionQO(viewerWallet, marketId),
    enabled: !!viewerWallet && !!sim,
  });

  /**
   * ONE LEDGER AT A TIME, NEVER A MERGE. Holding a real YES and a simulated NO on
   * the same market is legal and normal, and showing them added together would
   * be a portfolio that exists nowhere. While Simulation is active the real
   * balances are not consulted at all.
   */
  const simulated = !!sim;
  const simYes = sharesToWei(simPos?.yesShares ?? 0);
  const simNo = sharesToWei(simPos?.noShares ?? 0);
  const activeYes = simulated ? simYes : yesTokens;
  const activeNo = simulated ? simNo : noTokens;

  // What each whole side would actually fetch right now, straight from the
  // contract. This is the LAST RESORT for a side's value — the read model's
  // marked value is preferred so the dock agrees with Positions everywhere else
  // — but it means an owned side always has a real number instead of the word
  // "held", and the sell field always has a basis to size a partial against.
  //
  // The quote is the SAME live market read in both modes: a simulated position
  // is marked against the real market, because there is no other market.
  const { proceeds: yesFullWei } = useSellQuote(marketId, true, activeYes);
  const { proceeds: noFullWei } = useSellQuote(marketId, false, activeNo);
  const liveUsd = (wei: bigint | null): number | null =>
    wei != null && wei > 0n && ethUsd > 0 ? weiToEth(wei) * ethUsd : null;
  /** A marked value only counts when it is a real, positive number. */
  const marked = (v: number | null | undefined): number | null => (v != null && v > 0 ? v : null);

  const owned = ownedPositions({
    yesTokens: activeYes,
    noTokens: activeNo,
    // In Simulation the "worth" carried through this hook is already CC: the
    // server marked it against the live price, and the live quote is the
    // fallback through the same 1:1 convention the order was sized with.
    yesWorthUsd: simulated
      ? (marked(simPos?.yesValueCc) ?? liveUsd(yesFullWei))
      : (marked(posSummary?.yes?.worth) ?? liveUsd(yesFullWei)),
    noWorthUsd: simulated
      ? (marked(simPos?.noValueCc) ?? liveUsd(noFullWei))
      : (marked(posSummary?.no?.worth) ?? liveUsd(noFullWei)),
  });

  const sellHeld = sellSide ? heldSide(owned, sellSide) : null;
  const worthUsd = sellHeld?.worthUsd ?? null;
  const sellTokens = sellHeld?.tokens ?? 0n;
  const sellShares = sellHeld && sellPct != null ? sharesForPct(sellHeld.tokens, sellPct) : 0n;
  const { proceeds, isLoading: sellQuoting } = useSellQuote(
    marketId,
    sellSide === "YES",
    sellShares,
  );

  /** Tapping SELL: one side owned goes straight there; both asks which. */
  const openSell = () => {
    trade.reset();
    const step = sellStep(owned);
    if (step.kind === "direct") {
      setSellSide(step.side);
      setSellPct(100);
      setAction(null);
    } else if (step.kind === "choose") {
      setAction("sell");
    }
  };
  const chooseSellSide = (s: OrderSide) => {
    setSellSide(s);
    setSellPct(100);
    setAction(null);
  };
  const closeSell = () => {
    setSellPct(null);
    setSellSide(null);
    setAction(null);
    trade.reset();
  };
  const reset = () => {
    setSellPct(null);
    setSellSide(null);
    setAction(null);
  };
  const onSellConfirm = async () => {
    if (!ready.connected) return onRequestConnect();
    // Simulation never needs a network: `ready.onBase` is true by construction in
    // that adapter, and asking for a chain switch here would be a prompt for a
    // transaction that is never sent.
    if (!simulated && !ready.onBase) return onRequestChain();
    if (
      sellSide &&
      proceeds != null &&
      sellShares > 0n &&
      !(trade.isSubmitting || trade.isMining)
    ) {
      try {
        await trade.sell(marketId, sellSide === "YES", sellShares, proceeds);
      } catch {
        /* surfaced via trade.error */
      }
    }
  };

  return {
    owned,
    sellSide,
    sellPct,
    isSelling: sellHeld != null && sellPct != null,
    action,
    setAction,
    setSellPct,
    openSell,
    chooseSellSide,
    closeSell,
    onSellConfirm,
    reset,
    proceeds,
    sellQuoting,
    worthUsd,
    sellTokens,
  };
}

/**
 * Does the owned dock own the surface right now, or should the parent render
 * its ordinary buy ticket? Parents must ask BEFORE rendering — a JSX element is
 * never nullish, so `<OwnedDock/> ?? <OrderTicket/>` would silently swallow the
 * fallback and leave an empty dock on every market you don't hold.
 */
export function ownedDockShown(api: OwnedDockApi, buySide: OrderSide | null): boolean {
  return dockSurface({ owned: api.owned, selling: api.isSelling, buySide }) !== "buy";
}

/**
 * Renders the owned surface, or null when there is nothing owned to manage (the
 * parent then renders its normal buy ticket). Returning null keeps the decision
 * about ordering with each surface while the logic stays shared.
 */
export function OwnedDock({
  api,
  buySide,
  ethUsd,
  ready,
  trade,
  sim,
  onBuySide,
  onPass,
  onSold,
}: {
  api: OwnedDockApi;
  /** The side the parent already has the viewer backing, if any. */
  buySide: OrderSide | null;
  ethUsd: number;
  ready: ReadyApi;
  trade: TradeApi;
  /** Simulation ledger descriptor, or null in Real Mode. */
  sim?: SimulationTicket | null;
  /** Chose a side to BUY — the parent records the belief and opens its ticket. */
  onBuySide: (s: OrderSide) => void;
  onPass: () => void;
  /** A sell settled and the viewer dismissed the receipt. */
  onSold: () => void;
}): ReactNode {
  const { format } = useMoney();
  const { owned } = api;
  const surface = dockSurface({ owned, selling: api.isSelling, buySide });

  // What a held side is worth, in the ACTIVE ledger's unit. Shares are the
  // fallback only while the value is still being read — never the word "held",
  // which told the viewer nothing they didn't already know.
  const ownedText = (s: OrderSide): string | null => {
    const h = heldSide(owned, s);
    if (!h) return null;
    if (!(h.worthUsd != null && h.worthUsd > 0)) return `${fmtShares(h.tokens)} shares`;
    return sim ? formatCC(h.worthUsd) : format(h.worthUsd, "USD");
  };

  if (surface === "sell" && api.sellSide && api.sellPct != null) {
    return (
      <OrderTicket
        mode="sell"
        held={{ side: api.sellSide, tokens: api.sellTokens }}
        pct={api.sellPct}
        setPct={(n) => api.setSellPct(n)}
        proceeds={api.proceeds}
        quoting={api.sellQuoting}
        ethUsd={ethUsd}
        worthUsd={api.worthUsd}
        ready={ready}
        trade={trade}
        sim={sim}
        onConfirm={api.onSellConfirm}
        onCancel={api.closeSell}
        onDone={onSold}
      />
    );
  }

  if (surface !== "owned") return null;

  return (
    <div className="p-3.5">
      <OwnedLine yes={ownedText("YES")} no={ownedText("NO")} />
      {api.action === "buy" ? (
        <div className="flex gap-2">
          <SideButton
            label="Back YES"
            tone="yes"
            onClick={() => {
              trade.reset();
              api.setAction(null);
              onBuySide("YES");
            }}
            className="h-[52px] flex-1"
          />
          <SideButton
            label="Back NO"
            tone="no"
            onClick={() => {
              trade.reset();
              api.setAction(null);
              onBuySide("NO");
            }}
            className="h-[52px] flex-1"
          />
          <SideButton
            label="Cancel"
            tone="pass"
            onClick={() => api.setAction(null)}
            className="h-[52px] flex-1"
          />
        </div>
      ) : api.action === "sell" ? (
        /* Both sides held — the one case that genuinely needs a choice. */
        <div className="flex gap-2">
          <SideButton
            label="Sell NO"
            sub={ownedText("NO") ? `${ownedText("NO")} owned` : null}
            tone="no"
            onClick={() => api.chooseSellSide("NO")}
            className="h-[52px] flex-1"
          />
          <SideButton
            label="Sell YES"
            sub={ownedText("YES") ? `${ownedText("YES")} owned` : null}
            tone="yes"
            onClick={() => api.chooseSellSide("YES")}
            className="h-[52px] flex-1"
          />
          <SideButton
            label="Cancel"
            tone="pass"
            onClick={() => api.setAction(null)}
            className="h-[52px] flex-1"
          />
        </div>
      ) : (
        /* The stable default — identical whether you hold one side or both. */
        <div className="flex gap-2">
          <SideButton
            label="Buy"
            tone="yes"
            onClick={() => {
              trade.reset();
              api.setAction("buy");
            }}
            className="h-[52px] flex-1"
          />
          <SideButton label="Sell" tone="no" onClick={api.openSell} className="h-[52px] flex-1" />
          <SideButton label="Pass" tone="pass" onClick={onPass} className="h-[52px] flex-1" />
        </div>
      )}
    </div>
  );
}
