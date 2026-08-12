/**
 * LEFT COLUMN — three flat tabs, one interaction hierarchy:
 *   Explore   = discover markets                 (click → market in center)
 *   Positions = what I have backed               (click → market in center)
 *   People    = who I connect with               (click → person in center)
 *
 * IT WAS FOUR, and Tribe and Rivals were two of them. That split asked the
 * reader to choose a CAMP before they could see anyone, and it put people twelve
 * points apart on opposite sides of a navigation control while people forty
 * points apart shared one. Relationship is a spectrum, so it is now one list
 * sorted end to end — see NetworkPanel and src/domain/relationship-spectrum.
 * Removing the tab removed the classification from the navigation entirely.
 *
 * The active tab persists for the session; panels never stack in one scroll area.
 *
 * FEED JOINED THEM, and the header's Feed button went away with it. That button
 * had two jobs fused together — "show me what's next" and "get me out of here" —
 * and the first is a rail concern the moment the rail can show it. The second
 * belongs to the panels doing the taking-over, which is where Terms and Create
 * already put it. One control removed, and the rail becomes the single place the
 * feed is steered from.
 *
 * THE FEED TAB IS THE ONLY ONE THAT WORKS SIGNED OUT, so this column no longer
 * waits for a wallet: the three personal panels carry their own connect prompt
 * rather than the whole rail collapsing into one. It is also the default tab on
 * a fresh session — the running order is the product's main loop, and the other
 * three have nothing to say until you have used it.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { networkQO } from "@/lib/network-query";
import { MyConvictions } from "@/components/MyConvictions";
import { MARKETS_TAB } from "@/domain/markets";
import { NetworkPanel } from "@/components/NetworkPanel";
import { presentRelationship } from "@/domain/relationship";
import { type MarketRow } from "@/components/MarketCard";
import { type VolumeWindow } from "@/lib/markets.functions";
import { myConvictionsQO } from "@/lib/positions-query";

type Tab = "feed" | "positions" | "people";
const TABS: Tab[] = ["feed", "positions", "people"];
const KEY = "conviction:you-tab";

function initialTab(): Tab {
  try {
    const v = window.sessionStorage.getItem(KEY);
    if (v === "positions") return v;
    // Sessions stored before the two people tabs became one land on the list
    // that replaced them rather than silently on the feed.
    if (v === "people" || v === "tribe" || v === "rivals") return "people";
    return "feed";
  } catch {
    return "feed";
  }
}

export function MyWorld({
  wallet,
  rows,
  window: win,
  winLabel,
  ethUsd = 0,
  onSelectMarket,
  selectedPerson,
  onSelectPerson,
  onOpenDashboard,
  initialNetwork,
  feedList,
  onOpenFeedTab,
  connectPrompt,
  launchPanel,
}: {
  wallet?: string;
  rows: MarketRow[];
  window?: VolumeWindow;
  winLabel?: string;
  /** Live ETH/USD rate, forwarded so positions render in the chosen unit. */
  ethUsd?: number;
  onSelectMarket: (id: number) => void;
  selectedPerson?: string;
  onSelectPerson: (wallet: string) => void;
  /** Open the full Conviction Dashboard (P&L) in the center. */
  onOpenDashboard?: () => void;
  /** Force a people tab when a person/DNA view is active in the center. */
  initialNetwork?: boolean;
  /**
   * The running order, rendered by the route. Passed as a node rather than as
   * five more props: this column is about YOU, and threading the queue's state
   * through it would make it the owner of something it does not decide.
   */
  feedList?: ReactNode;
  /** How many markets are in the running order — the tab's count. */
  /** What the route does when the Feed tab is chosen (closing the Case File). */
  onOpenFeedTab?: () => void;
  /**
   * LAUNCH MODE — "should I join an existing conversation?", pinned above the
   * tabs while a market is being written.
   *
   * A node rather than a tab, for two reasons. It is not a place you navigate
   * to: it appears because you are drafting and vanishes when you stop, so a
   * fourth destination would sit empty almost always. And it must not steal the
   * tab a reader chose — Explore keeps running underneath, which is what makes
   * this advice instead of an interruption. The panel self-hides when nothing
   * is similar, so an absent match costs no space at all.
   */
  launchPanel?: ReactNode;
  /** Shown inside the three personal tabs when there is no wallet. */
  connectPrompt?: ReactNode;
}) {
  // SSR knows nothing about sessionStorage, so the first paint must match the
  // server's ("feed", or "people" when the route already opened a person) and
  // the remembered tab is applied after hydration. Reading storage in the
  // initializer rendered a different selected tab on the client and tore the
  // whole rail's hydration.
  const [tab, setTab] = useState<Tab>(() => (initialNetwork ? "people" : "feed"));
  useEffect(() => {
    if (!initialNetwork) setTab(initialTab());
    // Once, on mount: later changes come from `select`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [convictionCount, setConvictionCount] = useState<number | null>(null);
  const [peopleCount, setPeopleCount] = useState<number | null>(null);
  const select = (t: Tab) => {
    setTab(t);
    if (t === "feed") onOpenFeedTab?.();
    try {
      window.sessionStorage.setItem(KEY, t);
    } catch {
      /* storage unavailable */
    }
  };

  // Counts must be on the tab strip whether or not that tab has ever been opened,
  // so the strip reads the same cached queries the panels use (React Query dedupes)
  // and only defers to a mounted panel's own, richer count when it has reported one.
  const { data: netData } = useQuery(networkQO(wallet));
  // Everyone with any shared history — the same population the panel lists, so
  // the strip and the list can never disagree about how many people you have.
  // The old strip counted only tribe and rival, which silently omitted the
  // middle of the spectrum from a number labelled "people".
  const netCount = useMemo(
    () =>
      (netData?.people ?? []).filter(
        (p) =>
          presentRelationship({
            agreement: p.agreement,
            sharedConvictions: p.sharedBeliefs,
            together: p.together,
            apart: p.apart,
            topicCount: p.topicCount,
            strongestAlignedTopic: p.strongestAlignedDomain?.name ?? null,
            strongestOpposedTopic: p.strongestOpposedDomain?.name ?? null,
          }).group !== "insufficient",
      ).length,
    [netData],
  );

  const { data: walletData } = useQuery(myConvictionsQO(wallet, win ?? "24h"));
  const positionCount = useMemo(
    () =>
      (walletData?.positions ?? []).filter((p) => {
        const side = p.stance_side === "YES" || p.stance_side === "NO" ? p.stance_side : null;
        if (!side) return false;
        const shares = Number((side === "YES" ? p.yes_shares : p.no_shares) ?? 0);
        return shares > 0;
      }).length,
    [walletData],
  );

  /**
   * THREE DESTINATIONS, THREE JOBS.
   *
   *   EXPLORE    discover markets
   *   POSITIONS  the questions I own and the ones I hold a side in
   *   PEOPLE     who I connect with, through shared and opposing convictions
   *
   * "For You" named ONE of Explore's five lenses, which made the tab and the
   * lens row inside it contradict each other the moment a reader picked Moving.
   * The internal tab key stays `positions` so no bookmarked URL breaks.
   */

  const tabName = (t: Tab): string =>
    t === "feed" ? "Explore" : t === "positions" ? MARKETS_TAB : "People";

  // The playlist tab carries no count: how many markets are queued is an
  // implementation detail, and no reader decides anything differently for it.
  // Signed out there is no "your" anything to count, so the strip shows nothing
  // rather than a stale zero (or a leftover count from the last connection).
  const tabCount = (t: Tab): number | null =>
    t === "feed" || !wallet
      ? null
      : t === "positions"
        ? (convictionCount ?? positionCount)
        : (peopleCount ?? netCount);

  const exploreMarkets = () => {
    const first = rows[0];
    if (first) onSelectMarket(Number(first.onchain_id));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Launch Mode sits ABOVE the tabs, not inside one. While a market is
          being written this column's first question is "does this already
          exist" — and the answer has to be visible whichever tab is open,
          because a reader who wandered into Positions has not stopped
          drafting. */}
      {launchPanel}

      {/* Quiet segmented control. Four tabs no longer divide 320px evenly —
          `flex-1` would clip "Convictions" — so each takes its natural width and
          the strip scrolls if a future label outgrows the rail. */}
      <div
        className="mb-4 flex overflow-x-auto rounded-[10px] p-0.5"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        role="tablist"
        aria-label="Explore, Positions, or People"
      >
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            type="button"
            onClick={() => select(t)}
            className={`flex shrink-0 grow basis-0 flex-col items-center rounded-[8px] px-1.5 py-1 leading-tight transition-colors ${
              tab === t ? "bg-[var(--bg)] text-[var(--text)]" : "text-[var(--text-muted)]"
            }`}
          >
            <span className="text-[12px] font-medium whitespace-nowrap">{tabName(t)}</span>
            {tabCount(t) != null && (
              <span className="text-[11px] tabular-nums opacity-70">{tabCount(t)}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "feed" ? (
        feedList
      ) : !wallet && connectPrompt ? (
        /* The three personal tabs carry the connect prompt themselves. The rail
           used to be replaced by it wholesale, which also hid the one tab that
           works signed out. */
        connectPrompt
      ) : tab === "positions" ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* ONE MARKET, ONE CARD. The Market Maker / Believer sections that
              used to sit above this list re-stated the same questions the
              position cards below already carried — the same market rendered
              twice, in two vocabularies. The role is a property of a market, so
              it now rides on that market's single card as an eyebrow label. */}

          <MyConvictions
            wallet={wallet}
            rows={rows}
            window={win}
            winLabel={winLabel}
            ethUsd={ethUsd}
            onSelect={onSelectMarket}
            onCount={setConvictionCount}
            onExplore={exploreMarkets}
            onOpenDashboard={onOpenDashboard}
          />
        </div>
      ) : (
        <NetworkPanel
          wallet={wallet}
          selectedPerson={selectedPerson}
          onSelectPerson={onSelectPerson}
          onCount={setPeopleCount}
          onExplore={exploreMarkets}
        />
      )}
    </div>
  );
}
