import { createFileRoute } from "@tanstack/react-router";
import { insiderPulseKey } from "@/lib/insider/keys";
import { Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { lazyRetry } from "@/lib/lazy-retry";

import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSticky, useStickyRows } from "@/hooks/useSticky";
import {
  listMarketPulses,
  getMarketRow,
  getWarmDeckCore,
  type VolumeWindow,
} from "@/lib/markets.functions";
import { marketChangeQO } from "@/lib/market-queries";
import { getOpportunityFeed, getWarmFeed } from "@/lib/opportunity-feed.functions";
import {
  feedSession,
  feedSessionVersion,
  ideaGateOpen,
  resetFeedSession,
  subscribeFeedSession,
} from "@/lib/feed-session";
import { readSessionToken } from "@/lib/wallet-session";

import { MarketCard, type MarketRow } from "@/components/MarketCard";
import { FeedListPanel, IDEA_ROW_ID, type FeedListEntry } from "@/components/FeedListPanel";

/** Markets left ahead of the reader before the queue asks for more. */
const FEED_LOW_WATER = 4;
/** Floor between two refill requests, so a drained queue cannot loop. */
const FEED_REFILL_MS = 10_000;
import { toLens, type Lens } from "@/domain/feed/lens";
import { DEFAULT_SENSITIVITY, type Sensitivity } from "@/domain/market-change";
import { useFeedSensitivity } from "@/lib/feed-sensitivity";
import {
  ALL as ALL_FILTERS,
  filterKey,
  orderingMode,
  type FeedFilters,
  type FeedNetwork,
} from "@/domain/feed/filters";
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
import { getWarmTape } from "@/lib/live.functions";

import { TakeASide } from "@/components/TakeASide";

import { SimilarMarkets } from "@/components/SimilarMarkets";
import { ChallengeRail } from "@/components/ChallengeRail";
import { IdeasRail } from "@/components/IdeasRail";
import { AlternatesRail } from "@/components/AlternatesRail";
import { useOpenCalls } from "@/lib/open-calls";
import { LaunchRail } from "@/components/LaunchRail";
import { MarketDeck } from "@/components/MarketDeck";
import { MobileGame } from "@/components/MobileGame";
import { MarketScene } from "@/components/MarketScene";

import { DeckSkeleton } from "@/components/DeckSkeleton";
import { PanelBoundary } from "@/components/PanelBoundary";


const CaseColumn = lazyRetry(() =>
  import("@/components/CaseFile").then((m) => ({ default: m.CaseColumn })),
);
const TermsContent = lazyRetry(() =>
  import("@/components/TermsContent").then((m) => ({ default: m.TermsContent })),
);

import { useHouseIdea } from "@/hooks/useHouseIdea";
import type { ReadySuggestion } from "@/lib/market-suggestion.functions";
import { startDraftFromSuggestion } from "@/lib/create-draft";
import { requestConnect } from "@/lib/connect-bridge";
import { walletIntent } from "@/lib/wagmi";

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
import { Crosshair } from "lucide-react";
import { OmniHeader } from "@/components/OmniHeader";
import { ProfileMenu } from "@/components/ProfileMenu";

import { useEffectiveWallet } from "@/hooks/useEffectiveWallet";
import { useAccount } from "wagmi";
import { usePositionStream } from "@/lib/realtime/use-position-stream";
import { usePredictivePrefetch } from "@/lib/realtime/use-predictive-prefetch";
import { useIsDesktop } from "@/hooks/use-mobile";
import { registerPersonFocus } from "@/lib/person-focus";

import { AppMenu, type AppTab } from "@/components/AppMenu";
import { LandingPanel } from "@/components/LandingPanel";
import { useLandingPanelState } from "@/hooks/useLandingPanelState";
import { useDeckWindow } from "@/lib/deck-window";
import { useCaptureShareVisit } from "@/lib/use-share-attribution";
import { marketTitle } from "@/domain/market-title";

/**
 * How long the scene will hold the previous market waiting for the next one's
 * core payload before showing it anyway. Long enough that a normal (warm or
 * cold) fetch wins the race; short enough that a stalled request is never
 * mistaken for a frozen interface.
 */
const PROMOTE_TIMEOUT_MS = 1_200;

/**
 * How long a first feed may be silent before the reader is told.
 *
 * Twelve seconds is far past any healthy cold build — the shared snapshot is
 * single-flighted and the client's own fallback fires at four — so reaching this
 * means something is genuinely wrong rather than merely slow. It exists because
 * a promise that never settles is not an error, so nothing else would ever
 * replace the placeholder.
 */
const FEED_STALL_MS = 12_000;

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
  filters: FeedFilters = ALL_FILTERS,
  originMarketId: number | null = null,
  sensitivity: Sensitivity = DEFAULT_SENSITIVITY,
  lens: Lens = "for_you",
  /**
   * Is this session eligible for a ready House idea? Ready ideas are admitted
   * immediately; keeping eligibility in the key preserves correct cache
   * separation if product cadence changes later.
   */
  ideaGate = false,
) =>
  queryOptions({
    // The reader's floor is part of the key: it changes what the server admits,
    // so two floors are two different feeds and must not share a cache entry.
    // The LENS is in the key for the same reason and a stronger one: it changes
    // both which markets are admitted and their order, so two lenses are two
    // different playlists and must never share a cache entry.
    queryKey: [
      "opp-feed",
      wallet ?? null,
      window,
      filterKey(filters),
      originMarketId,
      sensitivity,
      lens,
      // Admission semantics changed from five centre-stage views to immediate
      // placement. Version the boundary so a cached pre-fix `true` response
      // cannot keep a ready idea hidden until its normal expiry.
      "idea-immediate-v2",
      ideaGate,
    ],
    queryFn: async () => {
      const request = getOpportunityFeed({
        data: {
          wallet: wallet ?? null,
          sessionToken: wallet ? readSessionToken(wallet) : null,
          window,
          mode: orderingMode(filters),
          networks: filters.networks,
          topics: filters.topics,
          momentum: filters.momentum ?? [],
          sensitivity,
          lens,
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
        return await getOpportunityFeed({
          data: {
            window,
            mode: orderingMode(filters),
            networks: filters.networks,
            topics: filters.topics,
            momentum: filters.momentum ?? [],
            sensitivity,
            lens,
            originMarketId,
          },
        });
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
    queryKey: insiderPulseKey(ids),
    queryFn: async () => await listMarketPulses({ data: { ids: ids.slice(0, 120) } }),
    enabled: ids.length > 0,
    // NO INTERVAL. The coordinator invalidates exactly the pulse keys that hold
    // a market which just traded (`affectedPulseKeys`), and re-syncs the whole
    // family on reconnect and on a hidden tab coming back. A pulse cannot change
    // without a trade, so a timer had nothing left to find.
    staleTime: 60_000,
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
  /**
   * LAUNCH MODE, after publish. Carries the market a creator has just made so
   * the right rail can ask "who should see it first?" before it becomes a
   * dashboard. In the URL rather than in state because publishing navigates
   * (?create clears, ?m arrives) and the moment has to survive that.
   */
  launch?: number;
  /** Share attribution code — who this visitor arrived via (?r=). */
  r?: string;
  /** Which phone column to open on, when arriving from the menu on another page. */
  tab?: MobileTab;
};

/** A URL boolean, however it arrives: `?x`, `?x=1`, `?x=true`, parsed or raw. */
const flag = (v: unknown): true | undefined =>
  v === true || v === 1 || v === "1" || v === "true" || v === "" ? true : undefined;

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    wallet:
      typeof search.wallet === "string" && search.wallet.length > 3 ? search.wallet : undefined,
    // Universal center selection, shared by every surface so deep links + browser
    // back/forward resolve the same object: ?m market, ?p person, ?dna overview.
    m: search.m != null && Number.isFinite(Number(search.m)) ? Number(search.m) : undefined,
    p: typeof search.p === "string" && search.p.length > 3 ? search.p : undefined,
    // ONE TRUTH TABLE FOR EVERY FLAG. `?dash=1` arrives PARSED — the router
    // JSON-decodes it, so the value is the NUMBER 1, not the string. Only
    // `create` happened to cover that, so every other deep link (`?dash=1`,
    // `?dna=1`, `?terms=1`) validated to undefined and the router bounced the
    // visitor to a bare `/` — a link that silently went nowhere.
    dna: flag(search.dna),
    create: flag(search.create),
    terms: flag(search.terms),
    // Case File mode — preserved in the URL so it survives market switches + back/forward.
    case: flag(search.case),
    // Conviction Dashboard — the financial story, a center-panel destination.
    dash: flag(search.dash),
    launch:
      search.launch != null && Number.isFinite(Number(search.launch))
        ? Number(search.launch)
        : undefined,
    // Attribution code carried from a shared link; kept in the URL so it
    // survives hydration and the arrival is recorded once.
    r: typeof search.r === "string" && search.r.length >= 3 ? search.r : undefined,
    tab:
      search.tab === "mine" || search.tab === "belief" || search.tab === "room"
        ? (search.tab as MobileTab)
        : undefined,
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
  //
  // THE LOADER AWAITS ITS OWN WORK. There used to be a 120ms race here that
  // shipped the shell and left the build running. On the serverless runtime the
  // app deploys to, work belonging to a request that has already responded is
  // cancelled — and the abandoned build, shared through the single-flight cache,
  // could then never settle, so every later request (SSR and browser alike)
  // joined a promise that never came back and the published site sat on the
  // skeleton forever. Never start server work you do not wait for.
  loader: async () => {
    try {
      // WARM-ONLY. The shell must not wait on the feed build: on a cold isolate
      // that read cost 10s of TTFB and the landing page could not paint at all.
      // A warm isolate still SSRs a real market; a cold one ships the shell now
      // and the client's own query fills the deck a moment later.
      //
      // THE TAPE RIDES ALONG, and on a phone it is the FIRST thing seen: mobile
      // opens on "Crowd", so the tape is above the fold before the deck is. Same
      // rule — warm read only, never a build, and in parallel so it can never
      // add to the shell's budget.
      const [feed, tape] = await Promise.all([getWarmFeed(), getWarmTape()]);
      // AND THE CENTRE PANEL'S NUMBERS. The seeded feed gives the shell a real
      // market TITLE; its deck core (the trade tape every number on the card is
      // rebuilt from) was still a client round trip, so the market appeared and
      // then filled in. Same rule as the tape: warm/seed read only, never a
      // build — on a miss it is simply null and the client fetches as before.
      const ids = (feed?.items ?? [])
        .filter((i) => i.kind === "market")
        .slice(0, 3)
        .map((i) => (i as { onchainId: number }).onchainId);
      const deck = ids.length ? await getWarmDeckCore({ data: { ids } }).catch(() => null) : null;
      return { feed, tape, deck, fetchedAt: Date.now() };
    } catch {
      return { feed: null, tape: null, deck: null, fetchedAt: Date.now() };
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

type MobileTab = AppTab;

/** The center-panel destination, as the URL expresses it. `case` is a display
 *  toggle rather than a destination, so it is deliberately not part of it. */
type CenterView = Pick<Search, "m" | "p" | "dna" | "create" | "terms" | "dash" | "launch">;

const CLEARED_CENTER: CenterView = {
  m: undefined,
  p: undefined,
  dna: undefined,
  create: undefined,
  terms: undefined,
  dash: undefined,
  // Carried with the center view so back/forward restores Launch Mode with the
  // market it belongs to, instead of leaving the flag dangling on another one.
  launch: undefined,
};

function Feed() {
  const {
    tab: tabParam,
    wallet: searchWallet,
    m: selectedMarket,
    p: selectedPerson,
    dna: dnaOpen,
    create: createOpen,
    terms: termsOpen,
    case: caseOpen,
    dash: dashOpen,
    launch: launchId,
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
  // FOCUS MODE — desktop only. The rails stay exactly where they are (same
  // widths, same content, still interactive); a translucent mask simply pulls
  // the eye back to the center column.
  const [focusMode, setFocusMode] = useState(false);
  useEffect(() => {
    if (!isDesktop) setFocusMode(false);
  }, [isDesktop]);
  const railMask = `pointer-events-none absolute inset-0 z-30 hidden bg-[var(--bg)]/80 backdrop-blur-[1px] transition-opacity duration-300 ease-out motion-reduce:transition-none lg:block ${
    focusMode ? "opacity-100" : "opacity-0"
  }`;
  // Desktop only needs the Case File once the user opens a case, so warm that
  // split chunk when the browser is idle. MobileGame is kept in the route bundle:
  // it is the primary phone surface and must never be stranded behind a chunk.
  useEffect(() => {
    if (!isDesktop) return;
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => number })
      .requestIdleCallback;
    // THE LEFT RAIL IS SPLIT OUT TOO, and unlike the Case File it renders
    // immediately — so its chunk is the one thing standing between the shell and
    // a populated left column. Warm it in the same idle window.
    const warm = () => {
      void import("@/components/MyWorld");
      void import("@/components/CaseFile");
    };

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

  /**
   * WHERE BACK GOES.
   *
   * Every center destination is a search param, so "close this panel" used to
   * mean "drop my own param" — which lands you wherever the remaining params
   * happen to point, not where you actually came from. Opening a person also
   * cleared ?m, so Back from a profile dumped you on the top of the feed rather
   * than the market you were reading.
   *
   * So the center keeps its own return stack: each open records the view being
   * left, each Back restores it exactly. First principle — Back returns you to
   * the view you left, always.
   */
  const centerNow: CenterView = {
    m: selectedMarket,
    p: selectedPerson,
    dna: dnaOpen,
    create: createOpen,
    terms: termsOpen,
    dash: dashOpen,
  };
  const centerRef = useRef<CenterView>(centerNow);
  centerRef.current = centerNow;
  const centerStack = useRef<CenterView[]>([]);
  const pushCenter = () => {
    centerStack.current.push(centerRef.current);
    if (centerStack.current.length > 30) centerStack.current.shift();
  };
  /** Restore the view we came from; `fallback` covers a cold deep link. */
  const backToPrevious = (fallback: CenterView = CLEARED_CENTER) => {
    const prev = centerStack.current.pop();
    navigate({ search: (s: Search) => ({ ...s, ...CLEARED_CENTER, ...(prev ?? fallback) }) });
    setTab("belief");
    enterProduct();
  };

  // One selection flow for the whole app. Clicking a position/Live row sets ?m; a
  // person sets ?p; the DNA summary sets ?dna. Each clears the others and focuses
  // the center (mobile: the Belief column). Browser back/forward walks history.
  const selectMarket = (marketId: number) => {
    setCaughtUp(false);
    pushCenter();
    navigate({
      search: (prev: Search) => ({
        ...prev,
        m: marketId,
        p: undefined,
        dna: undefined,
        create: undefined,
        terms: undefined,
        dash: undefined,
        // Leaving for another market ends Launch Mode. The recruitment panel is
        // about ONE market a creator just made; letting it trail along would
        // offer people an invitation to whatever they happened to click next.
        launch: undefined,
      }),
    });
    setTab("belief");
    enterProduct();
  };

  /**
   * Publishing lands on the new market AND opens Launch Mode.
   *
   * `?launch` rather than component state because publishing navigates —
   * `?create` clears and `?m` arrives — and the "who should see it first?"
   * moment has to survive that. It is also then a real place: refreshing or
   * sharing the URL puts a creator back in front of their own recruitment.
   */
  const marketCreated = (marketId: number) => {
    setCaughtUp(false);
    pushCenter();
    navigate({
      search: (prev: Search) => ({
        ...prev,
        m: marketId,
        launch: marketId,
        p: undefined,
        dna: undefined,
        create: undefined,
        terms: undefined,
        dash: undefined,
      }),
    });
    setTab("belief");
    enterProduct();
  };
  const closeLaunch = () =>
    navigate({ search: (prev: Search) => ({ ...prev, launch: undefined }) });

  /**
   * The market a buy just confirmed in — component state, NOT a search param.
   *
   * Publishing owns `?launch=` because a creator arrives at that URL and the
   * moment survives a reload. A buy is the opposite: it happened once, in this
   * session, and resurrecting "you took a side" on a refresh two days later
   * would be a lie the URL told on the app's behalf.
   */
  const [backedId, setBackedId] = useState<number | null>(null);

  const selectPerson = (personWallet: string) => {
    if (personWallet === selectedPerson) return;
    pushCenter();
    navigate({
      search: (prev: Search) => ({
        ...prev,
        p: personWallet,
        dna: undefined,
        create: undefined,
        terms: undefined,
        dash: undefined,
      }),
    });
    setTab("belief");
    enterProduct();
  };

  // Universal behaviour: any avatar anywhere opens that profile in the center.
  useEffect(() => registerPersonFocus(selectPerson));
  // The Conviction Dashboard is a center-panel destination (never a modal): it
  // deep-links, survives refresh, and back returns you to where you opened it.
  const openDashboard = () => {
    pushCenter();
    navigate({
      search: (prev: Search) => ({
        ...prev,
        dash: true,
        dna: undefined,
        p: undefined,
        create: undefined,
        terms: undefined,
      }),
    });
    setTab("belief");
    enterProduct();
  };
  // Creating a market is a first-class center-column destination, not a modal:
  // it deep-links, survives refresh, and back returns you to where you were.
  const openCreate = () => {
    pushCenter();
    navigate({
      search: (prev: Search) => ({
        ...prev,
        create: true,
        terms: undefined,
        dna: undefined,
        p: undefined,
        dash: undefined,
      }),
    });
    setTab("belief");
    enterProduct();
  };
  const closeCreate = () => backToPrevious();
  // Terms read in the center column, so leaving the create form is never
  // required to read what you're agreeing to. Back returns to the form.
  const openTerms = () => {
    pushCenter();
    navigate({ search: (prev: Search) => ({ ...prev, terms: true }) });
    setTab("belief");
    enterProduct();
  };
  // Terms are always entered from somewhere; the form is the honest fallback.
  const closeTerms = () => backToPrevious({ ...centerNow, terms: undefined });
  /**
   * Every centre takeover leaves the same way: back to the view it covered.
   *
   * These used to drop their own param and let whatever remained decide the
   * screen — which is why closing a profile could land you on the top of the
   * feed instead of the market you had been reading.
   */
  const closePerson = () => backToPrevious({ ...centerNow, p: undefined });
  const closeDna = () => backToPrevious({ ...centerNow, dna: undefined });
  const closeDash = () => backToPrevious({ ...centerNow, dash: undefined });
  /** The Case File spans BOTH rails, so the running order displaces it. */
  const closeCase = () => {
    if (caseOpen) navigate({ search: (prev: Search) => ({ ...prev, case: undefined }) });
  };

  // ONE timeframe for the whole app. The center's WindowFilter publishes to the
  // deck-window store; the feed, the left rail and every metric read it here, so
  // selecting 1W can never leave a "24H" label or a 24h delta on screen.
  const win = useDeckWindow() as VolumeWindow;
  /**
   * THE PHONE OPENS ON NOW. A visitor arriving on a phone lands on the Crowd
   * column — "what's moving, and who's behind it" — because it is the one view
   * that is true the second it paints and needs no choice from the reader.
   * Its rows are seeded by the SSR warm tape below, so it has something to say
   * on arrival rather than a skeleton. Desktop shows all three columns and is
   * unaffected by this.
   */
  const [tab, setTab] = useState<MobileTab>(
    tabParam ??
      (selectedMarket || selectedPerson || createOpen || dashOpen || dnaOpen ? "belief" : "room"),
  );
  // Arriving from the menu on a standing page carries the column with it — and
  // it is an explicit destination, so the intro panel gets out of the way. The
  // same is true of any deep link to a center destination: a link to a market, a
  // person, or the create form must also SELECT the column that renders it —
  // otherwise the phone sits on "Crowd" and the destination is invisible.
  const deepCenter =
    !!selectedMarket || !!selectedPerson || !!createOpen || !!dashOpen || !!dnaOpen;
  useEffect(() => {
    if (!tabParam && !deepCenter) return;
    setTab(tabParam ?? "belief");
    landing.collapse();
  }, [tabParam, deepCenter]); // eslint-disable-line react-hooks/exhaustive-deps

  const [menuOpen, setMenuOpen] = useState(false);

  /** How many people are waiting on this reader — badged on the menu's Room
   *  item, because on a phone the Challenge rail is two taps out of sight. Same
   *  hook the rail renders from, so the two can never disagree. */
  const openCalls = useOpenCalls(wallet).open.length;

  /**
   * The reader's own lens — network groups and topics, combined. A SERVER
   * concept, sent with the request, so the server still owns the whole
   * sequence: the client never re-sorts or re-filters a feed it was given.
   */
  const [filters, setFilters] = useState<FeedFilters>(ALL_FILTERS);

  /**
   * WHICH QUESTION THE READER ASKED — For You, Moving, Most Capital, Most
   * Believers, Fresh. A SERVER concept like the filters above: it changes both
   * what is admitted and the order, so the client never re-sorts what it is
   * given. See @/domain/feed/lens.
   */
  const [lens, setLens] = useState<Lens>("for_you");
  // Read inside the active-market effect, which deliberately keys on the market
  // alone — adding `lens` to its deps would re-splice on every lens change.
  const lensRef = useRef<Lens>(lens);
  lensRef.current = lens;

  /**
   * How much has to happen before a market is worth showing. A row in the one
   * bar table — see @/domain/market-change#BARS. Kept in a small external store
   * rather than route state because it is a PREFERENCE that outlives the
   * session, and because the server has to be told about it.
   */
  const sensitivity = useFeedSensitivity();

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
  // The loader fetched the anonymous 24h FOR YOU feed. A lens is a different
  // playlist, so adopting the snapshot under one would paint the wrong order.
  const initialFeed =
    win === "24h" &&
    filterKey(filters) === filterKey(ALL_FILTERS) &&
    originMarket == null &&
    lens === "for_you"
      ? (loaderData?.feed ?? undefined)
      : undefined;
  /**
   * Session idea eligibility as a rendered value. `useSyncExternalStore` keeps
   * the external cadence state hydration-safe and query-cache aware.
   */
  const ideaGate = useSyncExternalStore(
    subscribeFeedSession,
    () => ideaGateOpen(),
    () => false,
  );
  // Keep the version subscription honest for future readers of the store.
  void feedSessionVersion;
  const { data, isError: isFeedError } = useQuery({
    ...feedQO(wallet, win, filters, originMarket, sensitivity, lens, ideaGate),
    // initialDataUpdatedAt dates the snapshot to when the SERVER fetched it, so
    // React Query ages it against staleTime instead of refetching on hydration.
    //
    // A SEED IS NEVER initialData. `partial` means the server sent the first
    // few cards so the page could paint on a cold isolate; adopting it as
    // initial data would date it as fresh and the real feed would never be
    // fetched, leaving the reader on three cards. As placeholder it paints and
    // is replaced the moment the full feed lands.
    //
    // Once the gate is open the loader snapshot is, by construction, a feed
    // built when an idea was not allowed — adopt it only as a placeholder so
    // the gated request actually runs.
    ...(initialFeed
      ? wallet || initialFeed.partial || ideaGate
        ? { placeholderData: initialFeed }
        : { initialData: initialFeed, initialDataUpdatedAt: loaderData?.fetchedAt ?? Date.now() }
      : {}),
  });

  /**
   * THE DECK CORE THE SHELL ALREADY PAID FOR. The loader read the warm/seeded
   * trade tape for the markets it is about to paint; putting it in the cache
   * under the deck's own key means the first frame has numbers in it instead of
   * a card that appears and then fills in. Written in a render-time initializer
   * (once, and never over fresher data) so it is there for the FIRST paint, not
   * an effect later. React Query still refetches it on its own schedule.
   */
  useState(() => {
    const deck = loaderData?.deck;
    if (!deck) return null;
    for (const [id, core] of Object.entries(deck)) {
      const key = ["market-change", Number(id)] as const;
      if (qc.getQueryData(key) === undefined) {
        qc.setQueryData(key, core, { updatedAt: loaderData?.fetchedAt ?? Date.now() });
      }
    }
    return null;
  });

  // First principle: once a valid contract-backed market snapshot reaches the
  // browser, it is durable for this page lifetime. Query retries, wallet
  // reconnection, POV outages and empty enrichment responses may update it, but
  // can never replace it with undefined/empty and put the user back on a loader.
  /**
   * A lens change asks for a different playlist, so the centre must move to the
   * head of it. The old feed is still on screen when the filter is chosen, so
   * the re-pin WAITS for the response belonging to the new lens.
   */
  const repinRef = useRef(false);
  const stableFeedRef = useRef<typeof data>(initialFeed);
  if (data && Object.keys(data.rows ?? {}).length > 0 && data.items?.length > 0) {
    stableFeedRef.current = data;
  }
  /**
   * THE STICKY FEED MUST BELONG TO THE LENS ON SCREEN.
   *
   * Two mechanisms exist to stop the playlist blanking — this ref, which holds
   * the last non-empty response, and `placeholderData: (prev) => prev`, which
   * carries a result ACROSS a query-key change. Both predate the lens and
   * neither knew about it, so a lens that legitimately returns nothing (Moving
   * on a quiet day admits only markets that moved) fell through to the previous
   * lens's markets — the chip would read "Moving" over a list of Fresh ones,
   * with nothing on screen admitting it.
   *
   * A response carries the lens it was built for, so the fix is to require it.
   * The cost is a brief empty playlist while a new lens loads, which is the
   * honest thing to show: the centre still holds the market being read (see
   * `shownRow`), so nothing the reader is looking at goes anywhere.
   */
  const forThisLens = (f: typeof data): typeof data =>
    f && (f.lens ?? "for_you") === lens ? f : undefined;
  const stableFeed = forThisLens(stableFeedRef.current) ?? forThisLens(data);

  // The server returned a finished sequence: market / market_idea items in
  // order, plus the read-model row behind each market item. The client's only
  // job is to project that order into rows — no scoring, sorting or filtering.
  // A lens change is only honoured once the response for THAT lens lands: `data`
  // is undefined while the new query is in flight, so the freshly-filtered order
  // is read from it directly rather than from the sticky (still old) feed.
  const freshFirstId =
    data?.items?.flatMap((it) => (it.kind === "market" ? [it.onchainId] : []))[0] ?? null;
  useEffect(() => {
    if (!repinRef.current || freshFirstId == null) return;
    repinRef.current = false;
    setPinnedId(freshFirstId);
  }, [freshFirstId]);

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
  // Accumulated, like `knownRowsRef` below and for the same reason: a market
  // that has left the running order is still readable, and its reason has to
  // outlive the response that carried it or the centre panel loses the
  // explanation the moment a re-rank drops the market from the queue.
  const reasonsRef = useRef<Record<number, string>>({});
  for (const it of items) {
    if (it.kind === "market" && it.primaryReason) {
      reasonsRef.current[it.onchainId] = it.primaryReason;
    }
  }
  const reasonByMarket = reasonsRef.current;

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
    // A ranked lens admits nothing it has not ranked — see feed-queue#jumpTo.
    setQueue((q) => receiveOrder(q, serverOrder, { admit: lensRef.current === "for_you" }));
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
  /**
   * FRESHNESS WITHOUT A NOTICE. A re-rank is still never applied under the
   * reader's eyes — but instead of asking permission with a "1 new market"
   * button, the held order is adopted the moment the reader moves on to another
   * market. A playlist does not interrupt to announce that it grew.
   */
  const feedEntries: FeedListEntry[] = queue.order.map((id) => ({
    onchainId: id,
    reason: reasonByMarket[id] ?? null,
  }));

  /**
   * HAS THE CHOSEN LENS GENUINELY RUN OUT?
   *
   * Three things have to be true, and each rules out a way of being wrong:
   *
   *   the server SAID so     `exhausted` is a fact about the ranked pool. A
   *                          short batch is not — the feed pages implicitly,
   *                          since `seenIds` are excluded server-side and the
   *                          60s poll returns what the last response could not.
   *   about THIS lens        a response describes the lens it was built for.
   *                          `stableFeed` deliberately holds the previous feed
   *                          on screen while a new one is in flight, so without
   *                          this a switch from an exhausted Fresh to Moving
   *                          would carry Fresh's verdict onto Moving's playlist.
   *   nothing FAILED         a query that errored tells us nothing about how
   *                          much is left. Loading, error and exhaustion are
   *                          three states and only the third earns the notice.
   *
   * For You is excluded here because it is the continuation DESTINATION; its own
   * end-of-feed behaviour (CaughtUp) is untouched.
   */
  /**
   * No answer for the lens on screen yet. `stableFeed` is already gated to the
   * current lens, so this is exactly "the request for what the control says is
   * still in flight" — never a slow poll over a feed already rendered.
   */
  /**
   * A SKELETON IS A PROMISE THAT SOMETHING IS COMING.
   *
   * It must therefore never be the terminal state. `stableFeed === undefined`
   * alone does not mean "in flight" — it is also what a FAILED request looks
   * like, and rendering the placeholder for that leaves a reader watching a
   * shimmer that will never resolve, with nothing to press.
   *
   * The same discipline `lensExhausted` already applies: loading, error and
   * empty are three states, and only the first earns a placeholder.
   *
   * The timer covers the third way a skeleton becomes permanent — a request
   * that never settles at all. React Query cannot help there, because a promise
   * that hangs is not an error. After STALL_MS the reader is told plainly and
   * given the retry, rather than being left to guess.
   */
  const feedPending = stableFeed === undefined && !isFeedError;
  const [feedStalled, setFeedStalled] = useState(false);
  useEffect(() => {
    if (!feedPending) {
      setFeedStalled(false);
      return;
    }
    const t = setTimeout(() => setFeedStalled(true), FEED_STALL_MS);
    return () => clearTimeout(t);
  }, [feedPending, lens]);
  const feedLoading = feedPending && !feedStalled;
  /** Nothing to show and nothing on the way — say so, and offer the way back. */
  const feedFailed = stableFeed === undefined && (isFeedError || feedStalled);

  const lensExhausted =
    lens !== "for_you" &&
    !isFeedError &&
    stableFeed?.lens === lens &&
    stableFeed.exhausted === true;

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
      // Moving is the safe moment to adopt whatever arrived while they read.
      q = arrivalCount(q) > 0 ? commit(q) : q;
      // Not in the order yet = they came from somewhere else. That is the whole
      // definition of an origin — but only a BLEND has room for one. A ranked
      // lens orders by a single measure, so a market that arrived from outside
      // it has no rank, and neither splicing it in nor re-fetching around it
      // would make the list truer.
      const blend = lensRef.current === "for_you";
      if (blend && q.order.length > 0 && !q.order.includes(activeMarket)) {
        setOriginMarket(activeMarket);
      }
      return jumpTo(q, activeMarket, { admit: blend });
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
    /**
     * "Caught up" TAKES OVER THE CENTRE, and that is only right for For You,
     * where running out means every market the reader could be shown has been
     * decided on. Under a chosen lens it would say "you've made a call on every
     * market currently in your feed" — which is false, and it would throw away
     * the market they are reading to say it. The playlist's own continuation
     * row carries that news instead, and the market stays put.
     */
    if (lens === "for_you") setCaughtUp(true);
  };

  /**
   * Changing the lens is a NEW running order, not a re-sort of this one, so the
   * queue starts clean and the centre panel moves to the first market of the
   * new playlist — the two must never describe different feeds.
   */
  /**
   * Start a new playlist. The queue empties, the centre unpins, and the re-pin
   * WAITS for the response belonging to the new request — the old feed is still
   * on screen at the moment of the tap, so pinning its head would move the
   * centre to a market that is about to be replaced.
   */
  const restartPlaylist = () => {
    setQueue(emptyQueue);
    setPinnedId(null);
    repinRef.current = true;
    setOriginMarket(null);
    setCaughtUp(false);
    navigate({ search: (prev: Search) => ({ ...prev, m: undefined }) });
  };

  const selectFilters = (f: FeedFilters) => {
    if (filterKey(f) === filterKey(filters)) return;
    setFilters(f);
    restartPlaylist();
  };

  /** Changing the lens is a new playlist, by exactly the same rules. */
  const selectLens = (l: Lens) => {
    if (l === lens) return;
    setLens(toLens(l));
    restartPlaylist();
  };

  /**
   * Which network groups to offer. All four are always listed so the lens is
   * discoverable; a lens with no evidence yet simply returns nothing, which is
   * a clearer answer than an option that silently does not exist.
   */
  // "My Markets" needs a wallet to mean anything — an anonymous reader has no
  // markets to have created or to be holding, and offering the option would be
  // offering an empty feed.
  const availableNetworks: FeedNetwork[] = wallet
    ? ["everyone", "mine", "tribe", "rivals"]
    : ["everyone"];

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
    ...marketChangeQO(activeMarket as number),
    enabled: activeMarket != null,
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
  /**
   * THIRD EXEMPTION: ARRIVING FROM SOMEWHERE ELSE IS A FIRST PAINT.
   *
   * Holding the previous market is protection only while that market is the
   * thing on screen. Open a market from the Now tape on a phone and it is not:
   * the reader was looking at the tape, the column switches to Belief, and the
   * hold-and-swap rule then plays them a market they never asked for — the one
   * left behind from an earlier session — before replacing it a beat later with
   * the one they tapped. Two markets for one tap. That is the "jump", and no
   * amount of transition polish can make an unrequested market look intentional.
   *
   * So when the scene was NOT on screen on the previous frame, the stale market
   * is dropped and the new one is promoted the moment its row lands. Between
   * those two the reader sees the deck skeleton, which is honest: nothing has
   * been claimed yet. Warming on touch (see useWarmMarket in the tape) usually
   * closes that gap before the column has finished switching.
   */
  const sceneWasVisible = useRef(false);
  if (!sceneWasVisible.current && Number(shownRow.current?.onchain_id) !== activeMarket) {
    shownRow.current = null;
  }
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
  // Record, for the NEXT render, whether the market scene was actually on
  // screen: the centre can be a person, the dashboard, Terms, the create form
  // — and on a phone the whole column can be the tape or Mine. Read during
  // render above (see the third exemption), written after commit here, so it
  // always describes the frame the reader last saw rather than this one.
  const sceneShowing =
    (isDesktop || tab === "belief") &&
    currentRow != null &&
    !selectedPerson &&
    !dnaOpen &&
    !createOpen &&
    !termsOpen &&
    !dashOpen;
  useEffect(() => {
    sceneWasVisible.current = sceneShowing;
  });

  // A market opened from outside the loaded feed slice (search, a link, a market
  // just created) has no row in `rowsById`, so the playlist would label it
  // "Market #76". Its row IS on screen in the centre — register it here so
  // "Now reading" says the question the reader is looking at.
  if (currentRow && shownId != null) knownRowsRef.current[shownId] = currentRow;
  // Same for the freshly-fetched solo row: available a frame before it is
  // promoted into the scene, and already the truth about that market's title.
  if (liveRow) knownRowsRef.current[Number(liveRow.onchain_id)] = liveRow;

  // "The House has an idea" — the SERVER decided whether an idea belongs in
  // this sequence and at which slot. The hook only owns the funnel calls.
  //
  // LATCHED, because a feed poll is not a decision. The sequence is rebuilt
  // every 60s (and on every key change — a lens, a filter, an origin market
  // opened from search), and any of those rebuilds can legitimately come back
  // without an idea in it. Reading the idea straight off the latest response
  // meant the card vanished from under the reader mid-read. It is held until
  // the reader acts on it: create, edit or pass.
  const ideaItem = items.find((it) => it.kind === "market_idea") ?? null;
  const heldIdeaRef = useRef<{ suggestion: ReadySuggestion; position: number } | null>(null);
  if (ideaItem && stableFeed?.idea) {
    heldIdeaRef.current = {
      suggestion: stableFeed.idea as ReadySuggestion,
      position: ideaItem.position,
    };
  }
  const houseIdea = useHouseIdea(heldIdeaRef.current?.suggestion ?? null);
  // Dismissed / published: the hook drops it, so the latch must drop it too or
  // the playlist would keep a row for a card that can no longer open.
  if (heldIdeaRef.current && !houseIdea.suggestion) heldIdeaRef.current = null;
  const ideaPos = heldIdeaRef.current?.position ?? null;

  /**
   * WHERE THE IDEA IS, as a state rather than a derived comparison.
   *
   *   idle    not reached yet.
   *   open    on the centre stage.
   *   parked  the reader moved to a market instead. It keeps its row in the
   *           playlist and can be opened again — it just stops taking the
   *           centre, which is what made it feel like it "disappeared".
   */
  const [ideaView, setIdeaView] = useState<"idle" | "open" | "parked">("idle");
  useEffect(() => {
    if (!houseIdea.suggestion) {
      setIdeaView("idle");
      return;
    }
    if (ideaView === "idle" && ideaPos != null && currentIdx >= ideaPos) setIdeaView("open");
  }, [houseIdea.suggestion, ideaPos, currentIdx, ideaView]);
  // Choosing a market is choosing not to be on the idea right now.
  const ideaMarketRef = useRef<number | null>(activeMarket);
  useEffect(() => {
    if (ideaView !== "open") {
      ideaMarketRef.current = activeMarket;
      return;
    }
    if (ideaMarketRef.current !== activeMarket) {
      ideaMarketRef.current = activeMarket;
      setIdeaView("parked");
    }
  }, [activeMarket, ideaView]);
  const ideaDue = !!houseIdea.suggestion && ideaView === "open";

  /**
   * THE PLAYLIST THE READER SEES, including the idea. It holds the slot the
   * server gave it, so the queue and the centre agree about what comes next.
   */
  const playlistEntries: FeedListEntry[] = (() => {
    if (!houseIdea.suggestion) return feedEntries;
    const at = Math.min(Math.max(0, ideaPos ?? 0), feedEntries.length);
    const withIdea = [...feedEntries];
    withIdea.splice(at, 0, {
      onchainId: IDEA_ROW_ID,
      reason: null,
      idea: { question: houseIdea.suggestion.question },
    });
    return withIdea;
  })();

  /**
   * THE QUEUE REFILLS ITSELF BEFORE IT RUNS DRY.
   *
   * The feed pages implicitly — a request carries this session's seen ids, so
   * asking again returns what the last answer could not. Nothing was ever
   * asking, though: the only trigger was the 60s structural poll, so a reader
   * moving faster than that (or one who jumped in from search, which re-keys
   * the query) could walk off the end of a pool that still had plenty in it.
   *
   * So: when fewer than LOW_WATER markets remain ahead, adopt anything already
   * waiting and otherwise ask for more, throttled so a drained queue cannot
   * become a request loop. `exhausted` is the one honest stop.
   */
  const refillAtRef = useRef(0);
  const remainingAhead = (() => {
    const idx = activeMarket == null ? -1 : queue.order.indexOf(activeMarket);
    return idx >= 0 ? queue.order.length - idx - 1 : queue.order.length;
  })();
  useEffect(() => {
    if (stableFeed?.exhausted) return;
    if (remainingAhead > FEED_LOW_WATER) return;
    if (arrivalCount(queue) > 0) {
      setQueue((q) => commit(q));
      return;
    }
    const now = Date.now();
    if (now - refillAtRef.current < FEED_REFILL_MS) return;
    refillAtRef.current = now;
    void qc.invalidateQueries({ queryKey: ["opp-feed"] });
  }, [remainingAhead, queue, stableFeed?.exhausted, qc]);


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

  /**
   * A Market Idea reaching the stage IS the create screen, pre-filled. The
   * draft is seeded once per suggestion so re-renders never overwrite an edit
   * the reader has already made to the question.
   */
  const seededIdeaRef = useRef<string | null>(null);
  useEffect(() => {
    const s = houseIdea.suggestion;
    if (!ideaDue || !s) return;
    if (seededIdeaRef.current === s.id) return;
    seededIdeaRef.current = s.id;
    startDraftFromSuggestion(s.question, { suggestionId: s.id, originalQuestion: s.question });
    houseIdea.onShown();
  }, [ideaDue, houseIdea]);


  // On mobile only the active tab's column is mounted-visible; from lg up all
  // three columns are always shown side by side.
  const show = (t: MobileTab) => (tab === t ? "flex" : "hidden");

  // Stories the Insider tape is holding back, lifted only so the tab can repeat
  // the number while the reader is looking at Challenge.
  const [insiderPending, setInsiderPending] = useState(0);



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
        onCreate={wallet ? openCreate : () => requestConnect()}
        createLabel={wallet ? "Conviction Market" : "Connect wallet"}
        showCreatePlus={!!wallet}
        search={
          <OmniHeader
            wallet={wallet}
            onSelectMarket={selectMarket}
            onSelectPerson={selectPerson}
            onOpenMenu={() => setMenuOpen(true)}
            focus={
              <button
                type="button"
                onClick={() => setFocusMode((v) => !v)}
                aria-pressed={focusMode}
                aria-label="Focus mode"
                title="Focus mode"
                className={`hidden h-9 w-9 shrink-0 place-items-center rounded-full border transition-colors lg:grid ${
                  focusMode
                    ? "border-[var(--text)] text-[var(--text)]"
                    : "border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--text-secondary)] hover:text-[var(--text-secondary)]"
                }`}
              >
                <Crosshair className="h-4 w-4" aria-hidden />
              </button>
            }
            center={
              wallet ? (
                <button
                  type="button"
                  onClick={createOpen ? closeCreate : openCreate}
                  aria-expanded={createOpen}
                  className="inline-flex h-9 max-w-full items-center gap-1 truncate rounded-full border border-[var(--border-strong)] px-4 text-[13px] font-semibold text-[var(--text-secondary)] transition-colors hover:border-[var(--text)] hover:text-[var(--text)]"
                >
                  <span aria-hidden="true">{createOpen ? "✕" : "+"}</span>{" "}
                  {createOpen ? "Close" : "Conviction"}
                </button>
              ) : (
                <button
                  type="button"
                  {...walletIntent}
                  onClick={() => requestConnect()}
                  className="inline-flex h-9 max-w-full items-center gap-1 truncate rounded-full border border-[var(--border-strong)] px-4 text-[13px] font-semibold text-[var(--text-secondary)] transition-colors hover:border-[var(--text)] hover:text-[var(--text)]"
                >
                  Connect wallet
                </button>
              )
            }
          />
        }
        profile={
          <div className="flex items-center gap-2">
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
          className={`${show("mine")} relative row-start-1 h-full min-h-0 max-h-full flex-col overflow-hidden bg-[var(--bg)] px-5 py-6 lg:col-start-1 lg:flex`}
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
                onOpenDashboard={openDashboard}
                initialNetwork={Boolean(selectedPerson || dnaOpen)}
                onOpenFeedTab={closeCase}
                /* LAUNCH MODE — "should I join one of these instead?", asked in
                   the column that already answers "where should I go". It self-
                   hides unless a draft is being written and something is
                   actually similar. Join is `selectMarket`, which clears
                   `?create` on its way to `?m`, so accepting the advice exits
                   the composer and lands on the existing debate. */
                launchPanel={<SimilarMarkets wallet={wallet} onJoin={selectMarket} />}
                feedList={
                  <div className="flex min-h-0 flex-1 flex-col">
                    {/* FIRST TEN CONVICTIONS — the brief owns this slot until
                      the reader has taken ten sides, then the rail simply
                      leads with the feed. */}
                    <TakeASide wallet={wallet} window={win} />


                    <FeedListPanel
                      lens={lens}
                      onLens={selectLens}
                      lensExhausted={lensExhausted}
                      loading={feedLoading}
                      failed={feedFailed}
                      entries={playlistEntries}
                      rows={knownRowsRef.current}
                      activeId={ideaDue ? IDEA_ROW_ID : activeMarket}
                      onSelect={(id) =>
                        id === IDEA_ROW_ID ? setIdeaView("open") : selectMarket(id)
                      }
                      filters={filters}
                      onFilters={selectFilters}
                      availableNetworks={availableNetworks}
                    />
                  </div>
                }
                connectPrompt={
                  walletResolving ? (
                    /* Still reconnecting — hold neutral space rather than flash
                       a Connect prompt in front of positions that are arriving. */
                    <div className="min-h-0 flex-1" aria-hidden />
                  ) : (
                    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-center">
                      <p className="text-[12px] leading-relaxed text-[var(--text-muted)]">
                        Connect a wallet in the header to see your convictions.
                      </p>
                    </div>
                  )
                }
              />
            </>
          )}
          {/* Focus Mode dims the rail, but never the open case: the YES/NO
              columns are part of the investigation the user is focused on. */}
          {!(caseActive && currentRow) && <div aria-hidden className={railMask} />}
        </aside>

        {/* CENTER — Belief. Fluid column, but the reading measure is capped at
          920px and centered so the deck never stretches on wide monitors. The
          column's own top/bottom padding scales with the viewport height for the
          same reason the deck's internals do: on a short window those 24px are
          space the dock needs, and on a tall one they are too little. */}
        <main
          className={`${show("belief")} row-start-1 h-full min-h-0 max-h-full flex-col overflow-hidden bg-[var(--bg)] px-4 py-[clamp(10px,2svh,20px)] lg:col-start-2 lg:flex lg:px-8 lg:py-[clamp(12px,2.4svh,24px)]`}
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
                <BackLink onClick={closeDash} />
                <Suspense fallback={<DeckSkeleton />}>
                  <ConvictionDashboard
                    wallet={wallet}
                    onSelectMarket={selectMarket}
                    onCreate={openCreate}
                    onExplore={closeDash}
                  />
                </Suspense>
              </div>
            ) : createOpen ? (
              /* THE WAY OUT IS ALWAYS ON SCREEN. The form itself never rendered
                 its `onCancel`, so on mobile — where the header's create button
                 is the only other exit — this was a dead end. */
              <div className="flex min-h-0 flex-1 flex-col">
                <PanelBoundary label="Create market" onDismiss={closeCreate}>
                  <Suspense fallback={<DeckSkeleton />}>
                    <CreateMarket
                      ethUsd={stableFeed?.ethUsd ?? 0}
                      onCreated={(marketId) => marketCreated(marketId)}
                      onCancel={closeCreate}
                    />
                  </Suspense>
                </PanelBoundary>
              </div>
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
              /* ONE CREATE SURFACE. A Market Idea is the same screen as
                 "+ Conviction" — only the entry route differs — so the reader
                 can back it and move on without a second, near-identical card
                 to maintain. Cancel reads "Pass" here. */
              <div className="flex min-h-0 flex-1 flex-col">
                <Suspense fallback={<DeckSkeleton />}>
                  <CreateMarket
                    ethUsd={stableFeed?.ethUsd ?? 0}
                    onCreated={(marketId) => marketCreated(marketId)}
                    cancelLabel="Pass"
                    onCancel={() => {
                      // Passing returns the reader to the market whose slot the
                      // idea was borrowing — it does not spend a market.
                      houseIdea.onDismiss();
                      setIdeaView("idle");
                    }}
                  />
                </Suspense>
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
                    onBacked={setBackedId}
                    reason={reasonByMarket[Number(currentRow.onchain_id)] ?? null}
                  />
                )}
              </MarketScene>
            ) : feedFailed ? (
              // The request failed, or never settled. A skeleton here would be a
              // promise the app cannot keep.
              <FeedUnavailable onRetry={refreshFeed} />
            ) : activeMarket != null || feedLoading ? (
              // A market is selected (or the feed is genuinely still arriving)
              // but nothing has ever been rendered here — the ONLY time a
              // skeleton is right. Once a market has been shown, the branch
              // above holds it instead.
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
          className={`${show("room")} relative row-start-1 h-full min-h-0 max-h-full flex-col overflow-hidden bg-[var(--bg)] px-5 py-6 lg:col-start-3 lg:flex`}
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
              {/* CALL FEEDBACK, after publish. It sits ABOVE the rail rather
                than replacing it: "your people got the call" is a fact about
                what just happened, not a destination, and the rail underneath
                is still where anyone's calls to YOU arrive. */}
              {/* Publish wins when both are true for the same market: "your
                  market is live" is the larger fact, and a creator who backs
                  their own question should not have it downgraded. */}
              {launchId != null && launchId === shownId ? (
                <LaunchRail
                  wallet={wallet}
                  kind="created"
                  marketId={launchId}
                  onDone={closeLaunch}
                />
              ) : backedId != null && backedId === shownId ? (
                <LaunchRail
                  wallet={wallet}
                  kind="backed"
                  marketId={backedId}
                  onDone={() => setBackedId(null)}
                />
              ) : null}
              {/* THE RAILS CHANGE JOBS AS THE STORY MOVES.
                  While a market is being written the right column is a SPARK, not
                  a recruiting desk: asking "who should show up?" before the
                  question exists is premature, and the moment it publishes the
                  LaunchRail above answers exactly that. Left says "already out
                  there?", centre says "what do you believe?", right says "need an
                  angle?" — and then right becomes "your people". */}
              {/* CHALLENGE | INSIDER — the two social questions, kept apart.
                Challenge is "where are my people waiting for my take"; Insider is
                "what is happening across Conviction". Anything that cannot tell
                those apart belongs in the tape, which is why the tape is passed
                in rather than owned here. */}
              {createOpen || ideaDue ? (
                /* THE RIGHT RAIL WHILE WRITING — rewrites of your own question
                   first, then a House spark. Alternates take their natural height
                   on top; the spark fills what's left and self-hides when there is
                   nothing to suggest, so an untouched form shows an empty column
                   rather than a padded one. */
                <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
                  <AlternatesRail />
                  <IdeasRail
                    /* Never twice: while the idea itself is on stage the rail
                       has nothing left to offer. */
                    suggestion={ideaDue ? null : houseIdea.suggestion}
                    onUse={() => acceptIdea(false)}
                    onDismiss={houseIdea.onDismiss}
                  />
                </div>
              ) : (
                <ChallengeRail
                  wallet={wallet}
                  onSelect={selectMarket}
                  onSelectPerson={selectPerson}
                  insiderCount={insiderPending}

                  insider={
                    <div className="min-h-0 flex-1 overflow-hidden">
                      <LiveTape
                        wallet={wallet}
                        onSelect={selectMarket}
                        excludeMarketId={shownId ?? undefined}
                        holdUpdates
                        label={undefined}
                        initial={loaderData?.tape ?? null}
                        onPending={setInsiderPending}
                      />
                    </div>
                  }
                />

              )}
            </>
          )}
          {!(caseActive && currentRow) && <div aria-hidden className={railMask} />}
        </aside>

        {/* ONE MENU, EVERY PAGE — the same drawer the standing pages open. */}
        <AppMenu
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          tab={tab}
          onSelectTab={(t) => {
            setTab(t);
            setMenuOpen(false);
          }}
          onHome={() => {
            landing.expand();
            setMenuOpen(false);
          }}
          openCalls={openCalls}
        />
      </div>
    </div>
  );
}

/**
 * THE FEED DID NOT ARRIVE.
 *
 * Distinct from "caught up", which is a finished journey, and from a skeleton,
 * which is a promise that something is coming. This is the third outcome — the
 * request failed, or never settled — and before it existed the app rendered a
 * placeholder for it forever, so a reader saw a shimmer that would never resolve
 * and had nothing to press.
 *
 * One sentence and one action. No error code: a reader cannot use it, and the
 * only thing they can actually do is ask again.
 */
function FeedUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
      <p className="max-w-[34ch] text-[15px] leading-relaxed text-[var(--text)]">
        We couldn&rsquo;t load the markets just now.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-5 rounded-full px-5 py-2.5 text-[13px] font-semibold text-[var(--bg)] transition-opacity hover:opacity-90"
        style={{ background: "var(--text)" }}
      >
        Try again
      </button>
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
          View Your Positions
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
