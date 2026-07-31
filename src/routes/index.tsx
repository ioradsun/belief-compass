import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";
import { TermsContent } from "@/components/TermsContent";

import { queryOptions, useSuspenseQuery, useQuery } from "@tanstack/react-query";
import { useSticky, useStickyRows } from "@/hooks/useSticky";
import {
  listFeed,
  listMarketPulses,
  getMarketRow,
  type VolumeWindow,
} from "@/lib/markets.functions";
import { MarketCard, type MarketRow } from "@/components/MarketCard";
import { LiveTape } from "@/components/LiveTape";
import { DuplicateSuggestions } from "@/components/DuplicateSuggestions";
import { WelcomePrompt, WelcomeReceived } from "@/components/Welcome";
import { MarketDeck } from "@/components/MarketDeck";
import { CaseColumn, type CaseSection } from "@/components/CaseFile";
import { DeckSkeleton } from "@/components/DeckSkeleton";
import { CalibrationReveal, useReadiness } from "@/components/Calibration";
import { getCalibrationQueue } from "@/lib/beliefs.functions";
import { WalletConnectButton } from "@/components/WalletConnect";

// Deferred surfaces: none of these render for a first-time, signed-out visitor.
// PersonProfile/DnaOverview need a ?p/?dna selection; MyWorld/AccountRail need a
// connected wallet. Code-splitting them keeps the first-load JS to just the deck.
const PersonProfile = lazy(() =>
  import("@/components/PersonProfile").then((m) => ({ default: m.PersonProfile })),
);
const DnaOverview = lazy(() =>
  import("@/components/DnaOverview").then((m) => ({ default: m.DnaOverview })),
);
const AccountRail = lazy(() =>
  import("@/components/AccountMenu").then((m) => ({ default: m.AccountRail })),
);
// Phase 5: the SERVER owns opportunity classification + score. The client only
// filters by the canonical type and reads the precomputed order — no scoreFeed().
type OppFilter = "all" | "hot" | "early" | "hidden" | "contested" | "conviction" | "new";
const OPP_FILTERS: { key: OppFilter; emoji: string; label: string; question: string }[] = [
  {
    key: "all",
    emoji: "✨",
    label: "All",
    question: "What's objectively worth attention right now?",
  },
  { key: "hot", emoji: "🔥", label: "Hot", question: "What is accelerating right now?" },
  { key: "early", emoji: "🌱", label: "Early", question: "What's growing while still small?" },
  {
    key: "hidden",
    emoji: "💎",
    label: "Hidden",
    question: "What's active beyond its visible size?",
  },
  {
    key: "contested",
    emoji: "⚖️",
    label: "Contested",
    question: "Where are both sides still active?",
  },
  {
    key: "conviction",
    emoji: "🧠",
    label: "Conviction",
    question: "Who has held through real challenge?",
  },
  { key: "new", emoji: "🆕", label: "New", question: "What is genuinely recent?" },
];

const CreateMarket = lazy(() =>
  import("@/components/CreateMarket").then((m) => ({ default: m.CreateMarket })),
);
const MyWorld = lazy(() => import("@/components/MyWorld").then((m) => ({ default: m.MyWorld })));
import { OmniHeader } from "@/components/OmniHeader";

import { useEffectiveWallet } from "@/hooks/useEffectiveWallet";
import { useIsDesktop } from "@/hooks/use-mobile";
import { LandingPanel } from "@/components/LandingPanel";
import { useLandingPanelState } from "@/hooks/useLandingPanelState";

const WINDOW_OPTIONS: { key: VolumeWindow; label: string }[] = [
  { key: "1h", label: "1H" },
  { key: "24h", label: "24H" },
  { key: "7d", label: "1W" },
  { key: "30d", label: "1M" },
  { key: "all", label: "All" },
];

const feedQO = (wallet?: string, window: VolumeWindow = "24h") =>
  queryOptions({
    queryKey: ["feed", wallet ?? null, window],
    queryFn: async () => await listFeed({ data: { wallet, window } }),
    // Prices, capital and volume re-poll so the cards move on their own.
    refetchInterval: 8_000,
    // Never blank the feed while a poll (or a window switch) is in flight.
    placeholderData: (prev) => prev,
  });

const pulsesQO = (ids: number[]) =>
  queryOptions({
    queryKey: ["market-pulses", ids.join(",")],
    queryFn: async () => await listMarketPulses({ data: { ids: ids.slice(0, 120) } }),
    enabled: ids.length > 0,
    refetchInterval: 8_000,
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
        listFeed({ data: { window: "24h" } }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 200)),
      ]);
      return { feed };
    } catch {
      return { feed: null };
    }
  },
  staleTime: 10_000,
  component: Feed,
  errorComponent: ({ error }) => (
    <div className="p-8 text-sm text-destructive">Feed failed: {String(error)}</div>
  ),
  notFoundComponent: () => <div className="p-8">Not found.</div>,
});

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
  } = Route.useSearch();

  const navigate = Route.useNavigate();
  const wallet = useEffectiveWallet(searchWallet);
  // Case File is DESKTOP-ONLY: a research surface for side-by-side comparison. A
  // phone is for action, so it never exposes Case File (button, columns, or the
  // ?case flag). Desktop is >= lg, where the three columns actually sit together.
  const isDesktop = useIsDesktop();
  // Case File is a pure presentation toggle — it only changes where existing
  // intelligence is shown, so it just flips the URL flag (preserved across switches).
  const toggleCase = () => {
    navigate({ search: (prev: Search) => ({ ...prev, case: prev.case ? undefined : true }) });
    // Each Case File session opens with everything collapsed (summary-first) and
    // in Discovery Mode — comparison before investigation.
    setCaseSection(null);
    setStorySide(null);
  };
  // Brand introduction layer. Intentional product interactions (opening a
  // market, a person, DNA) collapse it; nothing else does.
  const landing = useLandingPanelState();
  const enterProduct = landing.collapse;
  // One selection flow for the whole app. Clicking a position/Live row sets ?m; a
  // person sets ?p; the DNA summary sets ?dna. Each clears the others and focuses
  // the center (mobile: the Belief column). Browser back/forward walks history.
  const selectMarket = (marketId: number) => {
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
    setStorySide(null);
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

  const [win, setWin] = useState<VolumeWindow>("24h");
  const [tab, setTab] = useState<MobileTab>("belief");
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  // The one Case File section open on BOTH columns (null = all collapsed). Lifting
  // it here is what keeps YES and NO synchronized — you only ever compare like with
  // like. Toggling the open one closes it; opening another closes the previous.
  const [caseSection, setCaseSection] = useState<CaseSection | null>(null);
  const toggleCaseSection = (s: CaseSection) => setCaseSection((prev) => (prev === s ? null : s));
  // Investigation Mode: which side's story has taken the center (null = Discovery,
  // where both sides are compared side by side). Clicking a side card opens it;
  // clicking the same card, Escape, or "Compare" returns to Discovery.
  const [storySide, setStorySide] = useState<"YES" | "NO" | null>(null);
  const toggleStory = (s: "YES" | "NO") => setStorySide((prev) => (prev === s ? null : s));

  // The SSR loader prefetched the anonymous 24h feed; adopt it as initialData so
  // the very first render (server AND client) paints the real deck with no
  // round-trip. Only the anon 24h query matches what the loader fetched — a
  // wallet or a different window falls through to a normal client fetch.
  const loaderData = Route.useLoaderData();
  const initialFeed = !wallet && win === "24h" ? (loaderData?.feed ?? undefined) : undefined;
  const { data } = useQuery({
    ...feedQO(wallet, win),
    ...(initialFeed ? { initialData: initialFeed } : {}),
  });
  // Sticky: hold the last good feed until the next refresh lands.
  const rawRows = useStickyRows(data?.data ?? []);
  const winLabel = WINDOW_OPTIONS.find((w) => w.key === win)?.label ?? "24H";

  // Intent engine: the active lens re-ranks the whole feed by its OWN question,
  // not just the sort order. Each lens answers a different human question, and
  // every card carries the human reason it surfaced for this lens.
  const [lens, setLens] = useState<OppFilter>("all");
  // The dropdown FILTERS the one global classification; it never re-scores. Rows
  // arrive already ordered by the server's opportunity_score (getMarkets).
  const rows =
    lens === "all"
      ? rawRows
      : rawRows.filter((r) => (r as Record<string, unknown>).opportunity_type === lens);
  const reasonByMarket: Record<number, string> = {};
  for (const r of rawRows) {
    const reason = (r as Record<string, unknown>).opportunity_reason;
    if (reason) reasonByMarket[Number(r.onchain_id)] = String(reason);
  }

  const ids = rows.map((r) => Number(r.onchain_id));
  const { data: pulseData } = useQuery(pulsesQO(ids));
  const stickyPulses = useSticky(pulseData?.pulses, (p) => !p || Object.keys(p).length === 0);
  const pulses = stickyPulses ?? {};

  // Single-market deck: the center shows exactly one market. ?m (set by a
  // position, a Live row, search, or Next) picks it; otherwise the top of the
  // queue. SKIP/Next advance through the current filtered order.
  const feedRows = rows as unknown as MarketRow[];

  // While calibrating, walk a curated, domain-diverse queue of un-answered
  // markets first, so the viewer's early beliefs spread across the map.
  const { data: readiness } = useReadiness(wallet);
  const calibrating = !!wallet && !!readiness && !readiness.calibrated;
  const { data: calQueue } = useQuery({
    queryKey: ["cal-queue", wallet ?? null],
    queryFn: () => getCalibrationQueue({ data: { wallet: wallet ?? null } }),
    enabled: calibrating,
    staleTime: 60_000,
  });
  const marketRows =
    calibrating && calQueue?.length
      ? (() => {
          const rank = new Map(calQueue.map((q, i) => [q.marketId, i]));
          const inQueue = feedRows
            .filter((r) => rank.has(Number(r.onchain_id)))
            .sort((a, b) => rank.get(Number(a.onchain_id))! - rank.get(Number(b.onchain_id))!);
          const rest = feedRows.filter((r) => !rank.has(Number(r.onchain_id)));
          return [...inQueue, ...rest];
        })()
      : feedRows;

  const foundIdx = marketRows.findIndex((r) => Number(r.onchain_id) === selectedMarket);
  const currentIdx = Math.max(0, foundIdx);
  const nextMarket = () => {
    if (marketRows.length)
      selectMarket(Number(marketRows[(currentIdx + 1) % marketRows.length].onchain_id));
  };

  // The selected market may be outside the loaded top-of-feed slice (e.g. opened
  // from search) — fetch its row on demand so ANY market can open in the center.
  const missing = selectedMarket != null && foundIdx === -1;
  const { data: soloRow } = useQuery({
    queryKey: ["market-row", selectedMarket],
    queryFn: () => getMarketRow({ data: { id: selectedMarket as number } }),
    enabled: missing,
    staleTime: 15_000,
  });
  const currentRow =
    foundIdx >= 0
      ? marketRows[currentIdx]
      : ((soloRow?.row as unknown as MarketRow | null) ?? marketRows[0]);

  // On mobile only the active tab's column is mounted-visible; from lg up all
  // three columns are always shown side by side.
  const show = (t: MobileTab) => (tab === t ? "flex" : "hidden");

  // Case File mode only applies to the single-market view. When on, the side
  // columns become the YES/NO case for the current market (existing intelligence,
  // reorganized). On mobile the Mine/Room tabs relabel to YES Case / NO Case.
  const caseActive =
    isDesktop &&
    !!caseOpen &&
    !selectedPerson &&
    !dnaOpen &&
    !createOpen &&
    !termsOpen &&
    !!currentRow;

  const windowPicker = (
    <div className="flex items-center gap-1 overflow-x-auto rounded-md border border-border p-0.5">
      {WINDOW_OPTIONS.map((w) => (
        <button
          key={w.key}
          type="button"
          onClick={() => setWin(w.key)}
          className={`shrink-0 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
            win === w.key
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {w.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="flex h-[100svh] w-full flex-col overflow-hidden bg-[var(--bg)] text-[var(--text)] supports-[height:100dvh]:h-[100dvh]">
      <CalibrationReveal wallet={wallet} />
      <LandingPanel
        state={landing.hydrated ? landing.state : "collapsed"}
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
          />
        }
      />

      {/* One rail width for both sides in every mode — a single source of truth
        (no 264 vs 344 asymmetry). It also means the Case File's YES/NO columns get
        equal visual authority automatically, with no mode-specific grid. */}
      <div className="grid h-full min-h-0 w-full flex-1 grid-cols-1 grid-rows-1 overflow-hidden lg:[grid-template-columns:320px_minmax(0,1fr)_320px]">
        {/* LEFT — You (Positions | Network) — fixed 320px rail */}
        <aside
          className={`${show("mine")} row-start-1 h-full min-h-0 max-h-full flex-col overflow-hidden bg-[var(--bg)] px-5 py-6 lg:col-start-1 lg:flex`}
          style={{ borderRight: "1px solid var(--border)" }}
        >
          {caseActive && currentRow ? (
            // YES Case — the existing YES-supporting intelligence, reorganized.
            // Keyed on the market so switching resets the column scroll to top.
            <CaseColumn
              key={Number(currentRow.onchain_id)}
              side="YES"
              marketId={Number(currentRow.onchain_id)}
              row={currentRow}
              viewerWallet={wallet}
              ethUsd={data?.ethUsd ?? 0}
              openSection={caseSection}
              onToggleSection={toggleCaseSection}
              investigating={storySide === "YES"}
              onInvestigate={toggleStory}
            />
          ) : !wallet ? (
            /* Signed out: nothing to show but the one thing to do. */
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-center">
              <p className="text-[12px] leading-relaxed text-[var(--text-muted)]">
                Connect a wallet to see your convictions.
              </p>
              <WalletConnectButton />
            </div>
          ) : (
            <Suspense fallback={null}>
              <AccountRail
                wallet={wallet}
                onOpenProfile={selectPerson}
                open={accountOpen}
                onOpenChange={setAccountOpen}
              />
              {!accountOpen && (
                <>
                  {/* Recipient side of belonging — one aggregated line, dismissible. */}
                  <WelcomeReceived wallet={wallet} />
                  <MyWorld
                    wallet={wallet}
                    rows={rows as unknown as MarketRow[]}
                    window={win}
                    winLabel={winLabel}
                    onSelectMarket={selectMarket}
                    selectedPerson={selectedPerson}
                    onSelectPerson={selectPerson}
                    onOpenDna={openDna}
                    initialNetwork={Boolean(selectedPerson || dnaOpen)}
                  />
                </>
              )}
            </Suspense>
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
                <button
                  type="button"
                  onClick={closeTerms}
                  className="mb-4 flex items-center gap-1.5 text-[13px] text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
                >
                  <span aria-hidden>←</span> Back
                </button>
                <h1 className="mb-3 text-[24px] font-semibold tracking-[-0.02em] text-[var(--text)]">
                  Terms &amp; risk
                </h1>
                <TermsContent />
              </div>
            ) : createOpen ? (
              <Suspense fallback={<DeckSkeleton />}>
                <CreateMarket
                  ethUsd={data?.ethUsd ?? 0}
                  onCreated={(marketId) => selectMarket(marketId)}
                  onCancel={closeCreate}
                  onOpenTerms={openTerms}
                />
              </Suspense>
            ) : selectedPerson ? (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <Suspense fallback={<DeckSkeleton />}>
                  <PersonProfile
                    wallet={selectedPerson}
                    viewer={wallet}
                    onSelectMarket={selectMarket}
                  />
                </Suspense>
              </div>
            ) : dnaOpen ? (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <Suspense fallback={<DeckSkeleton />}>
                  <DnaOverview wallet={wallet} onSelectPerson={selectPerson} />
                </Suspense>
              </div>
            ) : rows.length === 0 ? (
              // While the feed is still loading (first paint), show a live-market
              // skeleton, not a "nothing here" card. Only show the real empty
              // message once data has actually arrived empty.
              data === undefined ? (
                <div className="flex min-h-0 flex-1 flex-col">
                  <DeckSkeleton />
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
                  No markets yet. The POV poller runs on a schedule — data will appear once the
                  first cycle completes.
                </div>
              )
            ) : (
              currentRow && (
                <div className="flex min-h-0 flex-1 flex-col">
                  <MarketDeck
                    row={currentRow}
                    ethUsd={data?.ethUsd ?? 0}
                    onSkip={nextMarket}
                    viewerWallet={wallet}
                    lens={lens}
                    lenses={OPP_FILTERS}
                    onLens={setLens}
                    caseOpen={caseActive}
                    onToggleCase={isDesktop ? toggleCase : undefined}
                    storySide={caseActive ? storySide : null}
                    onCloseStory={() => setStorySide(null)}
                    onSelectPerson={selectPerson}
                  />
                </div>
              )
            )}
          </div>
        </main>

        {/* RIGHT — The Room — fixed 320px rail */}
        <aside
          className={`${show("room")} row-start-1 h-full min-h-0 max-h-full flex-col overflow-hidden bg-[var(--bg)] px-5 py-6 lg:col-start-3 lg:flex`}
          style={{ borderLeft: "1px solid var(--border)" }}
        >
          {caseActive && currentRow ? (
            // NO Case replaces the Live feed while investigating. Closing Case File
            // restores the Live feed (LiveTape remounts, polling resumes).
            <CaseColumn
              key={Number(currentRow.onchain_id)}
              side="NO"
              marketId={Number(currentRow.onchain_id)}
              row={currentRow}
              viewerWallet={wallet}
              ethUsd={data?.ethUsd ?? 0}
              openSection={caseSection}
              onToggleSection={toggleCaseSection}
              investigating={storySide === "NO"}
              onInvestigate={toggleStory}
            />
          ) : (
            <>
              {/* Welcome the newest believers on a side you back — one tap. */}
              <WelcomePrompt wallet={wallet} />
              {/* Duplicate suggestions sit above the feed while creating; the feed
                below keeps running and is never replaced. */}
              <DuplicateSuggestions onSelect={selectMarket} />
              <div className="mb-4 shrink-0 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Live
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                <LiveTape wallet={wallet} onSelect={selectMarket} />
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
              style={{ borderRight: "1px solid var(--border)" }}
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
