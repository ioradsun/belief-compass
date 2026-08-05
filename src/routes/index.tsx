import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useEffect, useRef, useState } from "react";
import { lazyRetry } from "@/lib/lazy-retry";

import { queryOptions, useSuspenseQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSticky, useStickyRows } from "@/hooks/useSticky";
import {
  listMarketPulses,
  getMarketRow,
  getMarketChange,
  type VolumeWindow,
} from "@/lib/markets.functions";
import { getOpportunityFeed } from "@/lib/opportunity-feed.functions";
import { feedSession, resetFeedSession } from "@/lib/feed-session";
import { readSessionToken } from "@/lib/wallet-session";

import { MarketCard, type MarketRow } from "@/components/MarketCard";
import { FeedListPanel, type FeedListEntry } from "@/components/FeedListPanel";
import type { FeedMode } from "@/domain/feed/mode";
import {
  emptyQueue,
  receiveOrder,
  jumpTo,
  advance,
  commit,
  arrivalCount,
  type FeedQueue,
} from "@/domain/feed-queue";
import { LiveTape } from "@/components/LiveTape";
import { CurrentMarketActivity } from "@/components/CurrentMarketActivity";
import { DuplicateSuggestions } from "@/components/DuplicateSuggestions";
import { WelcomePrompt, WelcomeReceived } from "@/components/Welcome";
import { MarketDeck } from "@/components/MarketDeck";
import { MobileGame } from "@/components/MobileGame";
import { MarketScene } from "@/components/MarketScene";

import { DeckSkeleton } from "@/components/DeckSkeleton";
import { PanelBoundary } from "@/components/PanelBoundary";

import { SuggestedMarketCard } from "@/components/SuggestedMarketCard";

const CaseColumn = lazyRetry(() =>
  import("@/components/CaseFile").then((m) => ({ default: m.CaseColumn })),
);
const TermsContent = lazyRetry(() =>
  import("@/components/TermsContent").then((m) => ({ default: m.TermsContent })),
);

import { useHouseIdea } from "@/hooks/useHouseIdea";
import type { ReadySuggestion } from "@/lib/market-suggestion.functions";
import { startDraftFromSuggestion } from "@/lib/create-draft";
import { WalletConnectButton } from "@/components/WalletConnect";

// Deferred surfaces: none of these render for a first-time, signed-out visitor.
// PersonProfile/DnaOverview need a ?p/?dna selection; MyWorld/AccountRail need a
// connected wallet. Code-splitting them keeps the first-load JS to just the deck.
const PersonProfile = lazyRetry(() =>
  import("@/components/PersonProfile").then((m) => ({ default: m.PersonProfile })),
);
const DnaOverview = lazyRetry(() =>
  import("@/components/DnaOverview").then((m) => ({ default: m.DnaOverview })),
);
const ConvictionDashboard = lazyRetry(() =>
  import("@/components/ConvictionDashboard").then((m) => ({ default: m.ConvictionDashboard })),
);
const CreateMarket = lazyRetry(() =>
  import("@/components/CreateMarket").then((m) => ({ default: m.CreateMarket })),
);
const MyWorld = lazyRetry(() =>
  import("@/components/MyWorld").then((m) => ({ default: m.MyWorld })),
);
import { OmniHeader } from "@/components/OmniHeader";
import { ProfileMenu } from "@/components/ProfileMenu";

import { useEffectiveWallet } from "@/hooks/useEffectiveWallet";
import { useAccount } from "wagmi";
import { usePositionStream } from "@/lib/realtime/use-position-stream";
import { usePredictivePrefetch } from "@/lib/realtime/use-predictive-prefetch";
import { useIsDesktop } from "@/hooks/use-mobile";
import { registerPersonFocus } from "@/lib/person-focus";

import { LandingPanel } from "@/components/LandingPanel";
import { useLandingPanelState } from "@/hooks/useLandingPanelState";
import { useDeckWindow } from "@/lib/deck-window";
import { useCaptureShareVisit } from "@/lib/use-share-attribution";

/**
 * How long the scene will hold the previous market waiting for the next one's
 * core payload before showing it anyway. Long enough that a normal (warm or
 * cold) fetch wins the race; short enough that a stalled request is never
 * mistaken for a frozen interface.
 */
const PROMOTE_TIMEOUT_MS = 1_200;

const WINDOW_OPTIONS: { key: VolumeWindow; label: string }[] = [
  { key: "1h", label: "1H" },
  { key: "24h", label: "24H" },
  { key: "7d", label: "1W" },
  { key: "30d", label: "1M" },
  { key: "all", label: "All" },
];

// ONE authoritative feed call. The server sequences markets and market ideas
// into a single ordered list; the client renders that order and never
// re-scores, re-sorts or re-filters it. The MODE is a server concept too — it
// changes the ranking and, for Tribe/Rivals, what is admitted at all.
const feedQO = (
  wallet: string | undefined,
  window: VolumeWindow = "24h",
  mode: FeedMode = "for_you",
  originMarketId: number | null = null,
) =>
  queryOptions({
    queryKey: ["opp-feed", wallet ?? null, window, mode, originMarketId],
    queryFn: async () => {
      const request = getOpportunityFeed({
        data: {
          wallet: wallet ?? null,
          sessionToken: wallet ? readSessionToken(wallet) : null,
          window,
          mode,
          originMarketId,
          ...feedSession(),
        },
      });
      try {
        // Personalization is an enhancement, never a gate to seeing markets. If
        // a wallet-specific overlay stalls, fall back to the same chain-backed
        // anonymous feed the server renders instead of holding a skeleton.
        return await Promise.race([
          request,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("personalized feed timed out")), 4_000),
          ),
        ]);
      } catch {
        return await getOpportunityFeed({ data: { window, mode, originMarketId } });
      }
    },
    // The realtime coordinator (startRealtime) now moves each card's canonical
    // market_state fields in place over one socket, so this poll no longer owns
    // "the cards move." It is a slow STRUCTURAL reconcile: it catches what the
    // stream can't patch — feed ordering, a newly created market entering, the
    // house idea, and tribe faces — and re-syncs after a dropped socket.
    // Contract data is streamed separately; this request only reconciles the
    // optional ranking/personalisation layer. Slow polling prevents a flaky
    // enrichment service from repeatedly disturbing the primary market view.
    refetchInterval: 60_000,
    // The SSR loader hands this query a real, server-fetched payload. Without a
    // staleTime that data is stale the instant it lands, so hydration fires an
    // immediate duplicate request for bytes we already shipped in the HTML.
    // 15s (< the 20s reconcile) means: adopt the server snapshot, then keep the
    // normal poll cadence.
    staleTime: 15_000,
    // Never blank the feed while a poll (or a window switch) is in flight.
    placeholderData: (prev) => prev,
  });

const pulsesQO = (ids: number[]) =>
  queryOptions({
    queryKey: ["market-pulses", ids.join(",")],
    queryFn: async () => await listMarketPulses({ data: { ids: ids.slice(0, 120) } }),
    enabled: ids.length > 0,
    // The events stream refetches this the moment one of these markets trades;
    // the interval is now just a slow safety reconcile.
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });

/** The universal center-selection search params, shared across every surface. */
type Search = {
  wallet?: string;
  m?: number;
  p?: string;
  dna?: boolean;
  create?: boolean;
  terms?: boolean;
  case?: boolean;
  dash?: boolean;
  /** Share attribution code — who this visitor arrived via (?r=). */
  r?: string;
};

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    wallet:
      typeof search.wallet === "string" && search.wallet.length > 3 ? search.wallet : undefined,
    // Universal center selection, shared by every surface so deep links + browser
    // back/forward resolve the same object: ?m market, ?p person, ?dna overview.
    m: search.m != null && Number.isFinite(Number(search.m)) ? Number(search.m) : undefined,
    p: typeof search.p === "string" && search.p.length > 3 ? search.p : undefined,
    dna: search.dna === true || search.dna === "1" ? true : undefined,
    create:
      search.create === true || search.create === "1" || search.create === 1 ? true : undefined,
    terms: search.terms === true || search.terms === "1" ? true : undefined,
    // Case File mode — preserved in the URL so it survives market switches + back/forward.
    case: search.case === true || search.case === "1" ? true : undefined,
    // Conviction Dashboard — the financial story, a center-panel destination.
    dash: search.dash === true || search.dash === "1" ? true : undefined,
    // Attribution code carried from a shared link; kept in the URL so it
    // survives hydration and the arrival is recorded once.
    r: typeof search.r === "string" && search.r.length >= 3 ? search.r : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Conviction — see who actually believes" },
      {
        name: "description",
        content:
          "Prediction markets ranked by directional believer conviction. Money weight vs people weight, side by side.",
      },
      { property: "og:title", content: "Conviction — see who actually believes" },
      {
        property: "og:description",
        content: "Prediction markets ranked by directional believer conviction.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  // SSR the anonymous feed so a first-time visitor's FIRST HTML paint is a real
  // market, not a skeleton — no client round-trip, no waiting on the JS bundle.
  // It's cheap because listFeed serves the anon feed from a warm in-process
  // stale-while-revalidate cache, so this loader is a snapshot read, not the
  // multi-query round trip that once made SSR's TTFB the whole page budget.
  // Personalized (wallet) feeds still fetch on the client after connect.
  loader: async () => {
    try {
      // Bound the SSR cost: when the cache is warm this resolves in ~0ms with real
      // content; on a cold/slow instance the timeout wins so the shell still ships
      // fast (client fills it in), and the in-flight compute primes the cache for
      // the next visitor. Either way the loader never owns the TTFB budget.
      const feed = await Promise.race([
        getOpportunityFeed({ data: { window: "24h" } }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 200)),
      ]);
      // fetchedAt travels with the payload so the client can age the snapshot
      // correctly instead of treating it as "fetched at hydration time".
      return { feed, fetchedAt: Date.now() };
    } catch {
      return { feed: null, fetchedAt: Date.now() };
    }
  },
  staleTime: 10_000,
  component: Feed,
  errorComponent: ({ error }) => (
    <div className="p-8 text-sm text-destructive">Feed failed: {String(error)}</div>
  ),
  notFoundComponent: () => <div className="p-8">Not found.</div>,
});

/**
 * The way out of a centre takeover. Every panel that covers the market owns one,
 * which is what let the global header Feed button go: a single control that
 * dropped every search param at once was the only exit two of these panels had,
 * and it took unrelated state (an open Case File) with it.
 */
function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-4 flex items-center gap-1.5 text-[13px] text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
    >
      <span aria-hidden>←</span> Back
    </button>
  );
}

type MobileTab = "mine" | "belief" | "room";

const TABS: { key: MobileTab; label: string }[] = [
  { key: "mine", label: "Mine" },
  { key: "belief", label: "Belief" },
  { key: "room", label: "The Room" },
];

function Feed() {
  const {
    wallet: searchWallet,
    m: selectedMarket,
    p: selectedPerson,
    dna: dnaOpen,
    create: createOpen,
    terms: termsOpen,
    case: caseOpen,
    dash: dashOpen,
    r: refCode,
  } = Route.useSearch();

  const navigate = Route.useNavigate();
  const wallet = useEffectiveWallet(searchWallet);
  // Share attribution: record the open for an arriving ?r= link, and bind this
  // browser's opens to the wallet once one connects. Fails silently.
  useCaptureShareVisit(refCode, selectedMarket, wallet);
  // On a return visit wagmi silently reconnects the wallet AFTER hydration. Until
  // that settles, treat the viewer as "resolving" — not "signed out" — so the left
  // rail holds neutral space instead of flashing the Connect CTA, then swapping to
  // positions the moment the wallet appears. A first-time visitor with no stored
  // connection is 'disconnected' immediately, so their CTA is not delayed.
  const { status: walletStatus } = useAccount();
  // The first client render must match the SSR HTML exactly, so any wallet
  // restored from storage is only allowed to change the rail after hydration.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const walletResolving =
    !hydrated || (!wallet && (walletStatus === "reconnecting" || walletStatus === "connecting"));
  // One viewer-scoped socket keeps the connected wallet's positions live; a
  // belief change refetches only the mounted position slices (server-valued).
  usePositionStream(wallet);
  // Case File is DESKTOP-ONLY: a research surface for side-by-side comparison. A
  // phone is for action, so it never exposes Case File (button, columns, or the
  // ?case flag). Desktop is >= lg, where the three columns actually sit together.
  const isDesktop = useIsDesktop();
  // Desktop only needs the Case File once the user opens a case, so warm that
  // split chunk when the browser is idle. MobileGame is kept in the route bundle:
  // it is the primary phone surface and must never be stranded behind a chunk.
  useEffect(() => {
    if (!isDesktop) return;
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => number })
      .requestIdleCallback;
    const warm = () => void import("@/components/CaseFile");
    if (idle) idle(warm);
    else setTimeout(warm, 1500);
  }, [isDesktop]);

  // Case File is a pure presentation toggle — it only changes where existing
  // intelligence is shown, so it just flips the URL flag (preserved across switches).
  const toggleCase = () => {
    navigate({ search: (prev: Search) => ({ ...prev, case: prev.case ? undefined : true }) });
  };
  // Brand introduction layer. Intentional product interactions (opening a
  // market, a person, DNA) collapse it; nothing else does.
  const landing = useLandingPanelState();
  const enterProduct = landing.collapse;
  const qc = useQueryClient();
  // Discovery end-state: the viewer has decided on every eligible market. Set when
  // "Next" runs off the end of the sequence; cleared by selecting a market or
  // refreshing. Only meaningful for a connected viewer (anonymous never decides).
  const [caughtUp, setCaughtUp] = useState(false);

  // One selection flow for the whole app. Clicking a position/Live row sets ?m; a
  // person sets ?p; the DNA summary sets ?dna. Each clears the others and focuses
  // the center (mobile: the Belief column). Browser back/forward walks history.
  const selectMarket = (marketId: number) => {
    setCaughtUp(false);
    navigate({
      search: (prev: Search) => ({
        ...prev,
        m: marketId,
        p: undefined,
        dna: undefined,
        create: undefined,
        terms: undefined,
      }),
    });
    setTab("belief");
    enterProduct();
  };
  const selectPerson = (personWallet: string) => {
    navigate({
      search: (prev: Search) => ({
        ...prev,
        p: personWallet,
        m: undefined,
        dna: undefined,
        create: undefined,
        terms: undefined,
      }),
    });
    setTab("belief");
    enterProduct();
  };
  // Universal behaviour: any avatar anywhere opens that profile in the center.
  useEffect(() => registerPersonFocus(selectPerson));
  const openDna = () => {
    navigate({
      search: (prev: Search) => ({
        ...prev,
        dna: true,
        p: undefined,
        m: undefined,
        create: undefined,
        terms: undefined,
      }),
    });
    setTab("belief");
    enterProduct();
  };
  // The Conviction Dashboard is a center-panel destination (never a modal): it
  // deep-links, survives refresh, and back returns you to the deck.
  const openDashboard = () => {
    navigate({
      search: (prev: Search) => ({
        ...prev,
        dash: true,
        dna: undefined,
        p: undefined,
        m: undefined,
        create: undefined,
        terms: undefined,
      }),
    });
    setTab("belief");
    enterProduct();
  };
  // Creating a market is a first-class center-column destination, not a modal:
  // it deep-links, survives refresh, and back returns you to the deck.
  const openCreate = () => {
    navigate({
      search: (prev: {
        wallet?: string;
        m?: number;
        p?: string;
        dna?: boolean;
        create?: boolean;
        terms?: boolean;
      }) => ({
        ...prev,
        create: true,
        terms: undefined,
        dna: undefined,
        p: undefined,
        m: undefined,
      }),
    });
    setTab("belief");
    enterProduct();
  };
  const closeCreate = () => {
    navigate({
      search: (prev: {
        wallet?: string;
        m?: number;
        p?: string;
        dna?: boolean;
        create?: boolean;
        terms?: boolean;
      }) => ({
        ...prev,
        create: undefined,
        terms: undefined,
      }),
    });
  };
  // Terms read in the center column, so leaving the create form is never
  // required to read what you're agreeing to. Back returns to the form.
  const openTerms = () => {
    navigate({
      search: (prev: {
        wallet?: string;
        m?: number;
        p?: string;
        dna?: boolean;
        create?: boolean;
        terms?: boolean;
      }) => ({
        ...prev,
        terms: true,
      }),
    });
    setTab("belief");
    enterProduct();
  };
  const closeTerms = () => {
    navigate({
      search: (prev: {
        wallet?: string;
        m?: number;
        p?: string;
        dna?: boolean;
        create?: boolean;
        terms?: boolean;
      }) => ({
        ...prev,
        terms: undefined,
      }),
    });
  };
  // The way home. Every center destination (market, person, DNA, create, terms,
  // dashboard, case) is a search param, so returning to the feed is simply
  // dropping them — one predictable exit from anywhere in the app.
  /**
   * The way back to a market from a centre takeover.
   *
   * This used to be one global header button that dropped EVERY search param,
   * and it was the only exit two of those takeovers had. Each panel now clears
   * its own — so leaving a person profile no longer also closes the Case File
   * you had open, and the exit sits where the thing being exited is.
   */
  const closePerson = () => {
    navigate({ search: (prev: Search) => ({ ...prev, p: undefined }) });
    enterProduct();
  };
  const closeDna = () => {
    navigate({ search: (prev: Search) => ({ ...prev, dna: undefined }) });
    enterProduct();
  };
  /** The Case File spans BOTH rails, so the running order displaces it. */
  const closeCase = () => {
    if (caseOpen) navigate({ search: (prev: Search) => ({ ...prev, case: undefined }) });
  };

  // ONE timeframe for the whole app. The center's WindowFilter publishes to the
  // deck-window store; the feed, the left rail and every metric read it here, so
  // selecting 1W can never leave a "24H" label or a 24h delta on screen.
  const win = useDeckWindow() as VolumeWindow;
  const [tab, setTab] = useState<MobileTab>("belief");
  const [menuOpen, setMenuOpen] = useState(false);

  // The active perspective. A SERVER concept, sent with the request, so the
  // server still owns the whole sequence — the client never re-sorts a feed.
  const [mode, setMode] = useState<FeedMode>("for_you");

  /**
   * The market the reader arrived at from OUTSIDE the running order — opened
   * from search, a Live row or one of their positions. Its people become a weak
   * signal for what the feed offers next, which is what makes a search an entry
   * point into the network instead of a lookup that ends when the result opens.
   *
   * Only an off-queue arrival sets it. Walking the queue must not, or every
   * "Next" would re-request the feed and the running order would never settle.
   */
  const [originMarket, setOriginMarket] = useState<number | null>(null);

  // The SSR loader prefetched the anonymous 24h feed; adopt it as initialData so
  // the very first render (server AND client) paints the real deck with no
  // round-trip. Only the anon 24h "all" query matches what the loader fetched —
  // a wallet, window or mode falls through to a normal client fetch.
  const loaderData = Route.useLoaderData();
  const initialFeed =
    win === "24h" && mode === "for_you" && originMarket == null
      ? (loaderData?.feed ?? undefined)
      : undefined;
  const { data } = useQuery({
    ...feedQO(wallet, win, mode, originMarket),
    // initialDataUpdatedAt dates the snapshot to when the SERVER fetched it, so
    // React Query ages it against staleTime instead of refetching on hydration.
    ...(initialFeed
      ? wallet
        ? { placeholderData: initialFeed }
        : { initialData: initialFeed, initialDataUpdatedAt: loaderData?.fetchedAt ?? Date.now() }
      : {}),
  });

  // First principle: once a valid contract-backed market snapshot reaches the
  // browser, it is durable for this page lifetime. Query retries, wallet
  // reconnection, POV outages and empty enrichment responses may update it, but
  // can never replace it with undefined/empty and put the user back on a loader.
  const stableFeedRef = useRef<typeof data>(initialFeed);
  if (data && Object.keys(data.rows ?? {}).length > 0 && data.items?.length > 0) {
    stableFeedRef.current = data;
  }
  const stableFeed = stableFeedRef.current ?? data;

  // The server returned a finished sequence: market / market_idea items in
  // order, plus the read-model row behind each market item. The client's only
  // job is to project that order into rows — no scoring, sorting or filtering.
  const items = stableFeed?.items ?? [];
  const rowsById = stableFeed?.rows ?? {};
  const orderedRows = items.flatMap((it) =>
    it.kind === "market" && rowsById[it.onchainId] ? [rowsById[it.onchainId]!] : [],
  );
  // Sticky: hold the last good feed until the next refresh lands.
  const rows = useStickyRows(orderedRows);
  const winLabel = WINDOW_OPTIONS.find((w) => w.key === win)?.label ?? "24H";

  // Every card carries the reason the SERVER surfaced it (personal fact first,
  // global classification otherwise). The Feed List shows it under the question:
  // this map was built and read by nothing for as long as it has existed.
  const reasonByMarket: Record<number, string> = {};
  for (const it of items) {
    if (it.kind === "market" && it.primaryReason) reasonByMarket[it.onchainId] = it.primaryReason;
  }

  // ── The running order ──────────────────────────────────────────────────────
  // The queue owns what the reader SEES, which is not the same as the latest
  // server order: a re-rank arrives every 8s and is held until the reader
  // accepts it (see @/domain/feed-queue). The active market stays owned by the
  // URL — one source of truth for "what is in the centre" — and the queue is
  // told about it, never the reverse.
  const [queue, setQueue] = useState<FeedQueue>(emptyQueue);
  const serverOrder = items.flatMap((it) => (it.kind === "market" ? [it.onchainId] : []));
  const serverOrderKey = serverOrder.join(",");
  useEffect(() => {
    if (serverOrder.length === 0) return;
    setQueue((q) => receiveOrder(q, serverOrder));
    // serverOrderKey identifies the order by value: a poll that returns the same
    // sequence must not re-enter this, or every 8s tick becomes a render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverOrderKey]);

  // A market that has left the feed keeps its row in the queue, so its facts
  // must outlive the response that last carried them. Rows accumulate here and
  // are never removed — the map is bounded by the session's own browsing.
  const knownRowsRef = useRef<Record<number, MarketRow>>({});
  for (const [id, row] of Object.entries(rowsById)) {
    if (row) knownRowsRef.current[Number(id)] = row as unknown as MarketRow;
  }
  const waiting = arrivalCount(queue);
  const feedEntries: FeedListEntry[] = queue.order.map((id) => ({
    onchainId: id,
    reason: reasonByMarket[id] ?? null,
  }));

  const ids = rows.map((r) => Number(r.onchain_id));
  const { data: pulseData } = useQuery(pulsesQO(ids));
  const stickyPulses = useSticky(pulseData?.pulses, (p) => !p || Object.keys(p).length === 0);
  const pulses = stickyPulses ?? {};

  // Single-market deck: the center shows exactly ONE market, and it stays put.
  const marketRows = rows as unknown as MarketRow[];
  const firstId = marketRows.length ? Number(marketRows[0].onchain_id) : null;

  // Pin the deck to a stable market id. Without this the deck follows
  // marketRows[0], which the 8s feed poll re-ranks (a just-viewed market drops on
  // the seen-penalty), so the keyed card would remount on a *different* market —
  // the "it jumps to another market on YES/NO" bug. ?m (search / a position / a
  // Live row / Next) wins; otherwise we pin the top of the feed ONCE. Only Next
  // or Refresh moves it.
  const [pinnedId, setPinnedId] = useState<number | null>(null);
  useEffect(() => {
    if (pinnedId == null && selectedMarket == null && firstId != null) setPinnedId(firstId);
  }, [pinnedId, selectedMarket, firstId]);
  const activeMarket = selectedMarket ?? pinnedId ?? firstId;

  const foundIdx =
    activeMarket == null ? -1 : marketRows.findIndex((r) => Number(r.onchain_id) === activeMarket);
  const currentIdx = Math.max(0, foundIdx);
  // Warm the immediate neighbors' deck-core so "Next" (and back) feels local.
  usePredictivePrefetch(ids, currentIdx);

  // Tell the queue where the reader is. The URL decides; this keeps the list's
  // highlight in step and splices in a market the running order has never seen
  // (opened from search, a Live row, a position) right after the current one, so
  // the session continues from there rather than restarting.
  useEffect(() => {
    if (activeMarket == null) return;
    setQueue((q) => {
      if (q.activeId === activeMarket) return q;
      // Not in the order yet = they came from somewhere else. That is the whole
      // definition of an origin, and `jumpTo` is about to splice it in.
      if (q.order.length > 0 && !q.order.includes(activeMarket)) setOriginMarket(activeMarket);
      return jumpTo(q, activeMarket);
    });
  }, [activeMarket]);

  // Forward only — never a carousel. The queue decides what "next" means,
  // including the one case that used to end the session early: running off the
  // end now adopts whatever arrived while the reader was working through the
  // list, so "caught up" means genuinely nothing new rather than nothing shown.
  const nextMarket = () => {
    const moved = advance(queue);
    if (moved.activeId != null && moved.activeId !== queue.activeId) {
      setQueue(moved);
      selectMarket(moved.activeId);
      return;
    }
    if (moved !== queue) setQueue(moved);
    setCaughtUp(true);
  };

  /** The reader accepted the markets that arrived while they were reading. */
  const commitArrivals = () => setQueue((q) => commit(q));

  /**
   * Switching perspective is a new running order, not a re-sort of this one, so
   * the queue starts clean rather than carrying the old mode's markets forward
   * behind an arrivals notice that would claim they are "new".
   */
  const selectMode = (m: FeedMode) => {
    if (m === mode) return;
    setMode(m);
    setQueue(emptyQueue);
    setCaughtUp(false);
  };
  /**
   * Which perspectives to offer. The server decides — it is the only place that
   * has read the viewer's DNA — and the answer is remembered across the poll
   * that lands while a request is in flight, so the strip cannot flicker.
   */
  const availableModes = stableFeed?.modes ?? ["for_you"];

  // Refresh the discovery feed: re-fetch (newly created markets may appear) and
  // leave the caught-up state. The held order is adopted here too — asking for a
  // refresh is the clearest possible statement that a rearrangement is welcome.
  const refreshFeed = () => {
    setCaughtUp(false);
    resetFeedSession();
    // Starting over drops the thread. Everything else keeps it: walking the
    // queue and switching perspective are both "keep exploring from here",
    // which is exactly what an origin is for.
    setOriginMarket(null);
    setQueue((q) => commit(q));
    void qc.invalidateQueries({ queryKey: ["opp-feed"] });
  };

  // The active market may be outside the loaded slice (opened from search) OR may
  // have just left the feed after a decision — fetch its row on demand so ANY
  // market can hold the center.
  const missing = activeMarket != null && foundIdx === -1;
  const { data: soloRow } = useQuery({
    queryKey: ["market-row", activeMarket],
    queryFn: () => getMarketRow({ data: { id: activeMarket as number } }),
    enabled: missing,
    staleTime: 15_000,
    // No placeholderData: this key CHANGES per market, so carrying the previous
    // result forward would hand back a different market's row. The scene keeps
    // the last complete market on screen instead (see shownRow below) — the same
    // protection, without ever mislabelling one market's data as another's.
  });

  // The core payload every figure in the deck is derived from. Mounted here with
  // the EXACT key the deck uses, so React Query serves both from one request —
  // this is a readiness probe, not a second fetch.
  const { data: nextCore } = useQuery({
    queryKey: ["market-change", activeMarket],
    queryFn: () => getMarketChange({ data: { id: activeMarket as number } }),
    enabled: activeMarket != null,
    staleTime: 10_000,
  });
  const liveRow: MarketRow | null =
    foundIdx >= 0
      ? marketRows[currentIdx]
      : ((soloRow?.row as unknown as MarketRow | null) ?? null);

  // THE SCENE NEVER BLANKS.
  //
  // The center displays exactly one market, and it is only ever replaced by
  // another COMPLETE market. Until the newly selected id's row is actually in
  // hand, the previous market stays fully on screen — same title, same numbers,
  // same controls, same everything. It used to fall through to null here, which
  // is why selecting a market that wasn't in the loaded feed (a search result, a
  // Live row, a position, a shared link) emptied the center until the row
  // arrived. Holding the WHOLE previous row also guarantees the scene is always
  // internally consistent: there is no frame with the new title above the old
  // market's figures, because every panel reads the same row object.
  //
  // AND IT SWAPS IN ONE COMMIT. The row alone is not enough to draw a market —
  // believers, capital and price all come from the trade tape — so promoting on
  // the row would paint the new title above the previous market's figures for
  // however long that tape took. The new market is promoted only once BOTH are
  // in hand, so every panel changes on the same frame.
  //
  // Two exemptions keep that rule from ever becoming a worse experience:
  //   • first paint — there is no old market to protect, so a real market beats
  //     holding a skeleton;
  //   • a stalled fetch — after PROMOTE_TIMEOUT_MS the row is promoted anyway,
  //     so a slow tape can't strand the viewer on the market they just left.
  const [promoteAnyway, setPromoteAnyway] = useState<number | null>(null);
  useEffect(() => {
    if (activeMarket == null) return;
    setPromoteAnyway(null);
    const t = setTimeout(() => setPromoteAnyway(activeMarket), PROMOTE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [activeMarket]);

  const shownRow = useRef<MarketRow | null>(null);
  const coreReady = nextCore != null || promoteAnyway === activeMarket;
  if (
    liveRow &&
    Number(liveRow.onchain_id) === activeMarket &&
    (shownRow.current == null || coreReady)
  ) {
    shownRow.current = liveRow;
  }
  const currentRow: MarketRow | null = shownRow.current;
  const shownId = currentRow ? Number(currentRow.onchain_id) : null;

  // "The House has an idea" — the SERVER decided whether an idea belongs in
  // this sequence and at which slot. The hook only owns the funnel calls.
  const ideaItem = items.find((it) => it.kind === "market_idea") ?? null;
  const houseIdea = useHouseIdea(
    ideaItem ? ((stableFeed?.idea as ReadySuggestion | null) ?? null) : null,
  );
  // The idea takes its own slot: it shows once the viewer has advanced to it.
  const ideaDue = !!ideaItem && currentIdx >= ideaItem.position;

  const viewedId = currentRow ? Number(currentRow.onchain_id) : null;
  useEffect(() => {
    if (viewedId != null) houseIdea.noteCardViewed(viewedId);
  }, [viewedId, houseIdea]);

  /** Accept the idea: seed the create form with it, then open the review screen. */
  const acceptIdea = (edit: boolean) => {
    const s = houseIdea.suggestion;
    if (!s) return;
    startDraftFromSuggestion(s.question, { suggestionId: s.id, originalQuestion: s.question });
    if (edit) houseIdea.onEdit();
    else houseIdea.onCreate();
    openCreate();
  };

  // On mobile only the active tab's column is mounted-visible; from lg up all
  // three columns are always shown side by side.
  const show = (t: MobileTab) => (tab === t ? "flex" : "hidden");

  // Case File mode only applies to the single-market view. When on, the side
  // columns become the YES/NO case for the current market (existing intelligence,
  // reorganized). On mobile the Mine/Room tabs relabel to YES Case / NO Case.
  const caseEligible =
    !!caseOpen && !selectedPerson && !dnaOpen && !createOpen && !termsOpen && !!currentRow;
  const caseActive = isDesktop && caseEligible;
  // Mobile uses the same ?case flag, but as a NO ← MARKET → YES swipe carousel in
  // the center rather than the desktop three-column split.
  const mobileCaseActive = !isDesktop && caseEligible;

  return (
    <div className="relative flex h-[100svh] w-full flex-col overflow-hidden bg-[var(--bg)] text-[var(--text)] supports-[height:100dvh]:h-[100dvh]">
      <LandingPanel
        state={landing.state}
        onEnter={enterProduct}
        onCollapse={landing.collapse}
        onExpand={landing.expand}
        onCreate={openCreate}
        search={
          <OmniHeader
            wallet={wallet}
            onSelectMarket={selectMarket}
            onSelectPerson={selectPerson}
            onOpenMenu={() => setMenuOpen(true)}
            center={
              <button
                type="button"
                onClick={openCreate}
                className="inline-flex h-9 max-w-full items-center gap-1 truncate rounded-full bg-[var(--text)] px-4 text-[13px] font-semibold text-[var(--bg)]"
              >
                <span aria-hidden="true">+</span> Conviction
              </button>
            }
          />
        }
        profile={
          <div className="flex items-center gap-2">
            {/* Always-on help: the guided "How it works" story, one tap from anywhere. */}
            <a
              href="/how"
              aria-label="How Conviction Company works"
              title="How Conviction Company works"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[var(--border)] text-[var(--text-secondary)] transition-colors hover:text-[var(--text)]"
            >
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
              >
                <circle cx="12" cy="12" r="9" />
                <path
                  d="M9.6 9.2a2.4 2.4 0 1 1 3.3 2.2c-.7.3-1.1.9-1.1 1.6v.4"
                  strokeLinecap="round"
                />
                <circle cx="11.8" cy="16.6" r="0.05" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </a>
            {wallet ? (
              <ProfileMenu
                wallet={wallet}
                onViewProfile={selectPerson}
                onOpenTerms={openTerms}
                onOpenDashboard={openDashboard}
                ethUsd={stableFeed?.ethUsd ?? 0}
              />
            ) : null}
          </div>
        }
      />

      {/* Scrim — while the landing panel is open the live app behind it is context,
        not a target. Dimming it keeps the panel as the single focal surface. */}
      <div
        aria-hidden={landing.state !== "expanded"}
        onClick={landing.collapse}
        className={`absolute inset-0 z-20 bg-[var(--bg)]/75 backdrop-blur-[2px] transition-opacity duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
          landing.state === "expanded" ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      {/* One rail width for both sides in every mode — a single source of truth
        (no 264 vs 344 asymmetry). It also means the Case File's YES/NO columns get
        equal visual authority automatically, with no mode-specific grid. */}
      <div className="grid h-full min-h-0 w-full flex-1 grid-cols-1 grid-rows-1 overflow-hidden lg:[grid-template-columns:320px_minmax(0,1fr)_320px]">
        {/* LEFT — Feed | Convictions | Tribe | Rivals — fixed 320px rail */}
        <aside
          className={`${show("mine")} row-start-1 h-full min-h-0 max-h-full flex-col overflow-hidden bg-[var(--bg)] px-5 py-6 lg:col-start-1 lg:flex`}
          style={{ borderRight: "1px solid var(--hairline)" }}
        >
          {caseActive && currentRow ? (
            // YES Case — the existing YES-supporting intelligence, reorganized.
            // Keyed on the market so switching resets the column scroll to top.
            <Suspense fallback={<DeckSkeleton />}>
              {/* No key: the column resets its own scroll on a market change
                (see CaseFile), so switching markets updates it in place instead
                of tearing down both rails and every query observer on them. */}
              <CaseColumn
                side="YES"
                marketId={Number(currentRow.onchain_id)}
                row={currentRow}
                viewerWallet={wallet}
                ethUsd={stableFeed?.ethUsd ?? 0}
              />
            </Suspense>
          ) : (
            <>
              {/* Recipient side of belonging — one aggregated line, dismissible. */}
              {wallet && <WelcomeReceived wallet={wallet} />}
              {/* Rendered whether or not a wallet is connected: the Feed tab is
                  the one that works signed out, and the rail used to hide it
                  behind a connect prompt that replaced the whole column. */}
              <MyWorld
                wallet={wallet}
                rows={rows as unknown as MarketRow[]}
                window={win}
                winLabel={winLabel}
                ethUsd={stableFeed?.ethUsd ?? 0}
                onSelectMarket={selectMarket}
                selectedPerson={selectedPerson}
                onSelectPerson={selectPerson}
                onOpenDna={openDna}
                onOpenDashboard={openDashboard}
                initialNetwork={Boolean(selectedPerson || dnaOpen)}
                feedCount={queue.order.length}
                onOpenFeedTab={closeCase}
                feedList={
                  <FeedListPanel
                    entries={feedEntries}
                    rows={knownRowsRef.current}
                    activeId={activeMarket}
                    arrivalCount={waiting}
                    onSelect={selectMarket}
                    onCommitArrivals={commitArrivals}
                    mode={mode}
                    modes={availableModes}
                    onMode={selectMode}
                  />
                }
                connectPrompt={
                  walletResolving ? (
                    /* Still reconnecting — hold neutral space rather than flash
                       a Connect prompt in front of positions that are arriving. */
                    <div className="min-h-0 flex-1" aria-hidden />
                  ) : (
                    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-center">
                      <p className="text-[12px] leading-relaxed text-[var(--text-muted)]">
                        Connect a wallet to see your convictions.
                      </p>
                      <WalletConnectButton />
                    </div>
                  )
                }
              />
            </>
          )}
        </aside>

        {/* CENTER — Belief. Fluid column, but the reading measure is capped at
          920px and centered so the deck never stretches on wide monitors. */}
        <main
          className={`${show("belief")} row-start-1 h-full min-h-0 max-h-full flex-col overflow-hidden bg-[var(--bg)] px-4 py-5 lg:col-start-2 lg:flex lg:px-8 lg:py-6`}
        >
          <div className="mx-auto flex min-h-0 w-full max-w-[920px] flex-1 flex-col">
            {/* Center focus: person profile, DNA overview, or the single-market deck.
              The deck owns its own internal scroll so its dock stays pinned. */}
            {termsOpen ? (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <BackLink onClick={closeTerms} />
                <h1 className="mb-3 text-[24px] font-semibold tracking-[-0.02em] text-[var(--text)]">
                  Terms &amp; risk
                </h1>
                <Suspense fallback={<DeckSkeleton />}>
                  <TermsContent />
                </Suspense>
              </div>
            ) : dashOpen ? (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <Suspense fallback={<DeckSkeleton />}>
                  <ConvictionDashboard
                    wallet={wallet}
                    onSelectMarket={selectMarket}
                    onCreate={openCreate}
                    onExplore={() =>
                      navigate({ search: (prev: Search) => ({ ...prev, dash: undefined }) })
                    }
                  />
                </Suspense>
              </div>
            ) : createOpen ? (
              <PanelBoundary label="Create market" onDismiss={closeCreate}>
                <Suspense fallback={<DeckSkeleton />}>
                  <CreateMarket
                    ethUsd={stableFeed?.ethUsd ?? 0}
                    onCreated={(marketId) => selectMarket(marketId)}
                    onCancel={closeCreate}
                    onOpenTerms={openTerms}
                  />
                </Suspense>
              </PanelBoundary>
            ) : selectedPerson ? (
              /* The exit lives here rather than inside the panel: both of these
                 components have several early returns (loading, no wallet, not
                 enough evidence), and a back link owned by the component would
                 have to appear in every one of them. */
              <div className="min-h-0 flex-1 overflow-y-auto">
                <BackLink onClick={closePerson} />
                <Suspense fallback={<DeckSkeleton />}>
                  <PersonProfile
                    wallet={selectedPerson}
                    viewer={wallet}
                    onSelectMarket={selectMarket}
                    /* Person → conviction → market → another person: the loop
                       only closes if a profile can open another profile. */
                    onSelectPerson={selectPerson}
                  />
                </Suspense>
              </div>
            ) : dnaOpen ? (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <BackLink onClick={closeDna} />
                <Suspense fallback={<DeckSkeleton />}>
                  <DnaOverview wallet={wallet} onSelectPerson={selectPerson} />
                </Suspense>
              </div>
            ) : caughtUp && wallet ? (
              // Ran off the end of the sequence — every eligible market decided.
              <CaughtUp
                onRefresh={refreshFeed}
                onConvictions={() => setTab("mine")}
                onCreate={openCreate}
              />
            ) : ideaDue && houseIdea.suggestion ? (
              /* A first-class feed card, in the exact slot a market would take. */
              <div className="flex min-h-0 flex-1 flex-col">
                <SuggestedMarketCard
                  suggestion={houseIdea.suggestion}
                  onShown={houseIdea.onShown}
                  onCreate={() => acceptIdea(false)}
                  onEdit={() => acceptIdea(true)}
                  onDismiss={() => {
                    houseIdea.onDismiss();
                    nextMarket();
                  }}
                />
              </div>
            ) : currentRow ? (
              /* A MARKET ON SCREEN OUTRANKS EVERY EMPTY STATE.
                This branch used to sit BELOW the `rows.length === 0` check, so
                selecting a market while the feed happened to be empty rendered
                "No markets yet" over a perfectly loadable market — the deck
                never mounted at all. A row in hand is a market to show. */
              <MarketScene marketId={shownId}>
                {!isDesktop ? (
                  /* MOBILE — The Conviction Game. Its own experience: the
                    question first, the crowd only after the decision.
                    Deliberately NOT keyed on the market id: a key here remounts
                    the entire phone scene on every change (new DOM, refetch from
                    scratch, a blank frame). It resets its own per-market state
                    internally instead. */
                  <MobileGame
                    row={currentRow}
                    ethUsd={stableFeed?.ethUsd ?? 0}
                    viewerWallet={wallet}
                    onNext={nextMarket}
                    onSelectPerson={selectPerson}
                  />
                ) : (
                  <MarketDeck
                    row={currentRow}
                    ethUsd={stableFeed?.ethUsd ?? 0}
                    onSkip={nextMarket}
                    viewerWallet={wallet}
                    caseOpen={caseActive}
                    mobileCaseOpen={mobileCaseActive}
                    onToggleCase={toggleCase}
                    onSelectPerson={selectPerson}
                  />
                )}
              </MarketScene>
            ) : activeMarket != null || stableFeed === undefined ? (
              // A market is selected (or the feed is still arriving) but nothing
              // has ever been rendered here — the ONLY time a skeleton is right.
              // Once a market has been shown, the branch above holds it instead.
              <div className="flex min-h-0 flex-1 flex-col">
                <DeckSkeleton />
              </div>
            ) : wallet ? (
              // Connected + the filtered feed is empty = decided on everything.
              <CaughtUp
                onRefresh={refreshFeed}
                onConvictions={() => setTab("mine")}
                onCreate={openCreate}
              />
            ) : (
              <div className="rounded-lg border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
                No markets yet. The POV poller runs on a schedule — data will appear once the first
                cycle completes.
              </div>
            )}
          </div>
        </main>

        {/* RIGHT — The Room — fixed 320px rail */}
        <aside
          className={`${show("room")} row-start-1 h-full min-h-0 max-h-full flex-col overflow-hidden bg-[var(--bg)] px-5 py-6 lg:col-start-3 lg:flex`}
          style={{ borderLeft: "1px solid var(--hairline)" }}
        >
          {caseActive && currentRow ? (
            // NO Case replaces the Live feed while investigating. Closing Case File
            // restores the Live feed (LiveTape remounts, polling resumes).
            <Suspense fallback={<DeckSkeleton />}>
              {/* No key: the column resets its own scroll on a market change
                (see CaseFile), so switching markets updates it in place instead
                of tearing down both rails and every query observer on them. */}
              <CaseColumn
                side="NO"
                marketId={Number(currentRow.onchain_id)}
                row={currentRow}
                viewerWallet={wallet}
                ethUsd={stableFeed?.ethUsd ?? 0}
              />
            </Suspense>
          ) : (
            <>
              {/* Welcome the newest believers on a side you back — one tap. */}
              <WelcomePrompt wallet={wallet} onSelectPerson={selectPerson} />
              {/* Duplicate suggestions sit above the feed while creating; the feed
                below keeps running and is never replaced. */}
              <DuplicateSuggestions onSelect={selectMarket} />
              {/* THIS MARKET — the pinned scope of the feed: the current market's
                story (House + activity), collapsible. Excluded from the global feed
                below so nothing is shown twice. Same LiveTape, two scopes. */}
              {shownId != null && (
                <CurrentMarketActivity marketId={shownId} wallet={wallet} onSelect={selectMarket} />
              )}
              <div className="mb-4 shrink-0 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Live
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                <LiveTape
                  wallet={wallet}
                  onSelect={selectMarket}
                  excludeMarketId={shownId ?? undefined}
                />
              </div>
            </>
          )}
        </aside>

        {/* Mobile slide-in menu (replaces the bottom tab bar) */}
        {menuOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setMenuOpen(false)}
              className="absolute inset-0 bg-black/60"
            />
            <div
              className="absolute inset-y-0 left-0 w-64 bg-[var(--panel)] p-4"
              style={{ borderRight: "1px solid var(--hairline)" }}
            >
              <div className="mb-4 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Menu
              </div>
              <div className="space-y-1">
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => {
                      setTab(t.key);
                      setMenuOpen(false);
                    }}
                    aria-current={tab === t.key ? "page" : undefined}
                    className={`block w-full rounded-md px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                      tab === t.key
                        ? "bg-[var(--surface)] text-[var(--text)]"
                        : "text-[var(--text-muted)]"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Discovery end-state. The center feed is a journey through unanswered
 * convictions, not a carousel — when a viewer has decided on every eligible
 * market, we say so plainly rather than looping back to the first one.
 */
function CaughtUp({
  onRefresh,
  onConvictions,
  onCreate,
}: {
  onRefresh: () => void;
  onConvictions: () => void;
  /** Mobile's forward path when the game runs out of questions. */
  onCreate?: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
        You&rsquo;re caught up
      </div>
      <p className="mt-3 max-w-[34ch] text-[15px] leading-relaxed text-[var(--text)]">
        You&rsquo;ve made a call on every market currently in your feed.
      </p>
      <p className="mt-1.5 max-w-[34ch] text-[13px] leading-relaxed text-[var(--text-muted)]">
        New questions will appear as Conviction grows.
      </p>
      <div className="mt-6 flex flex-col items-center gap-2.5 sm:flex-row">
        <button
          type="button"
          onClick={onRefresh}
          className="rounded-full px-5 py-2.5 text-[13px] font-semibold text-[var(--bg)] transition-opacity hover:opacity-90"
          style={{ background: "var(--text)" }}
        >
          Refresh Feed
        </button>
        <button
          type="button"
          onClick={onConvictions}
          className="rounded-full px-5 py-2.5 text-[13px] font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text)]"
          style={{ border: "1px solid var(--border)" }}
        >
          View Your Convictions
        </button>
        {onCreate && (
          <button
            type="button"
            onClick={onCreate}
            className="rounded-full px-5 py-2.5 text-[13px] font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text)]"
            style={{ border: "1px solid var(--border)" }}
          >
            Create a Market
          </button>
        )}
      </div>
    </div>
  );
}
