import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { queryOptions, useSuspenseQuery, useQuery } from "@tanstack/react-query";
import { listFeed, listMarketPulses, type VolumeWindow } from "@/lib/markets.functions";
import { MarketCard, type MarketRow } from "@/components/MarketCard";
import { LiveTape } from "@/components/LiveTape";
import { MarketDeck } from "@/components/MarketDeck";
import { PersonProfile } from "@/components/PersonProfile";
import { DnaOverview } from "@/components/DnaOverview";
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

import { MyWorld } from "@/components/MyWorld";
import { useEffectiveWallet } from "@/hooks/useEffectiveWallet";

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
  });

const pulsesQO = (ids: number[]) =>
  queryOptions({
    queryKey: ["market-pulses", ids.join(",")],
    queryFn: async () => await listMarketPulses({ data: { ids: ids.slice(0, 120) } }),
    enabled: ids.length > 0,
    refetchInterval: 8_000,
  });

export const Route = createFileRoute("/")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { wallet?: string; m?: number; p?: string; dna?: boolean } => ({
    wallet:
      typeof search.wallet === "string" && search.wallet.length > 3 ? search.wallet : undefined,
    // Universal center selection, shared by every surface so deep links + browser
    // back/forward resolve the same object: ?m market, ?p person, ?dna overview.
    m: search.m != null && Number.isFinite(Number(search.m)) ? Number(search.m) : undefined,
    p: typeof search.p === "string" && search.p.length > 3 ? search.p : undefined,
    dna: search.dna === true || search.dna === "1" ? true : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Conviction — see who actually believes" },
      {
        name: "description",
        content:
          "Prediction markets ranked by directional wallet conviction. Money weight vs people weight, side by side.",
      },
      { property: "og:title", content: "Conviction — see who actually believes" },
      {
        property: "og:description",
        content: "Prediction markets ranked by directional wallet conviction.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(feedQO()),
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
  } = Route.useSearch();
  const navigate = Route.useNavigate();
  const wallet = useEffectiveWallet(searchWallet);
  // One selection flow for the whole app. Clicking a position/Live row sets ?m; a
  // person sets ?p; the DNA summary sets ?dna. Each clears the others and focuses
  // the center (mobile: the Belief column). Browser back/forward walks history.
  const selectMarket = (marketId: number) => {
    navigate({
      search: (prev: { wallet?: string; m?: number; p?: string; dna?: boolean }) => ({
        ...prev,
        m: marketId,
        p: undefined,
        dna: undefined,
      }),
    });
    setTab("belief");
  };
  const selectPerson = (personWallet: string) => {
    navigate({
      search: (prev: { wallet?: string; m?: number; p?: string; dna?: boolean }) => ({
        ...prev,
        p: personWallet,
        m: undefined,
        dna: undefined,
      }),
    });
    setTab("belief");
  };
  const openDna = () => {
    navigate({
      search: (prev: { wallet?: string; m?: number; p?: string; dna?: boolean }) => ({
        ...prev,
        dna: true,
        p: undefined,
        m: undefined,
      }),
    });
    setTab("belief");
  };
  const [win, setWin] = useState<VolumeWindow>("24h");
  const [tab, setTab] = useState<MobileTab>("belief");
  const [menuOpen, setMenuOpen] = useState(false);

  const { data } = useSuspenseQuery(feedQO(wallet, win));
  const rawRows = data.data ?? [];
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
  const pulses = pulseData?.pulses ?? {};

  // Single-market deck: the center shows exactly one market. ?m (set by a
  // position, a Live row, search, or Next) picks it; otherwise the top of the
  // queue. SKIP/Next advance through the current filtered order.
  const marketRows = rows as unknown as MarketRow[];
  const currentIdx = Math.max(
    0,
    marketRows.findIndex((r) => Number(r.onchain_id) === selectedMarket),
  );
  const currentRow = marketRows[currentIdx] ?? marketRows[0];
  const nextMarket = () => {
    if (marketRows.length)
      selectMarket(Number(marketRows[(currentIdx + 1) % marketRows.length].onchain_id));
  };

  // On mobile only the active tab's column is mounted-visible; from lg up all
  // three columns are always shown side by side.
  const show = (t: MobileTab) => (tab === t ? "flex" : "hidden");

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
    <div className="grid h-[100dvh] w-full grid-cols-1 grid-rows-1 overflow-hidden bg-[var(--bg)] text-[var(--text)] lg:[grid-template-columns:minmax(210px,236px)_minmax(560px,1fr)_minmax(290px,326px)]">
      {/* LEFT — You (Positions | Network) */}
      <aside
        className={`${show("mine")} row-start-1 min-h-0 flex-col overflow-hidden bg-[var(--bg)] px-4 py-5 lg:col-start-1 lg:flex lg:py-6`}
        style={{ borderRight: "1px solid var(--border)" }}
      >
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
      </aside>

      {/* CENTER — Belief */}
      <main
        className={`${show("belief")} row-start-1 min-h-0 flex-col overflow-y-auto bg-[var(--bg)] px-4 py-5 lg:col-start-2 lg:flex lg:px-6 lg:py-6`}
      >
        <header className="mb-5 lg:mb-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label="Open menu"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-[var(--border)] lg:hidden"
            >
              <span className="space-y-1">
                <span className="block h-px w-4 bg-current" />
                <span className="block h-px w-4 bg-current" />
                <span className="block h-px w-4 bg-current" />
              </span>
            </button>
            <h1 className="min-w-0 truncate text-2xl font-semibold tracking-tight lg:text-3xl">
              conviction
            </h1>
          </div>
          <p className="mt-2 text-[13px] text-[var(--text-secondary)] lg:text-sm">
            Markets tell you what moved. Conviction tells you why. Wealth tells you why people
            cared.
          </p>
        </header>

        <div className="space-y-5 lg:space-y-6">
          {/* Center focus: person profile, DNA overview, or the Discover deck. */}
          {selectedPerson ? (
            <PersonProfile wallet={selectedPerson} viewer={wallet} onSelectMarket={selectMarket} />
          ) : dnaOpen ? (
            <DnaOverview wallet={wallet} onSelectPerson={selectPerson} />
          ) : rows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
              No markets yet. The POV poller runs on a schedule — data will appear once the first
              cycle completes.
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-col gap-3">
              {/* Discovery: filter + queue progress. */}
              <div className="rounded-lg border border-border px-3 py-3 lg:px-4">{lensPicker}</div>
              <div className="flex items-center justify-between px-1">
                <span className="num text-[11px] text-[var(--text-muted)]">
                  {currentIdx + 1} / {marketRows.length}
                </span>
                <button
                  type="button"
                  onClick={nextMarket}
                  className="rounded-md border border-border px-3 py-1 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text)]"
                >
                  Next →
                </button>
              </div>

              {currentRow && (
                <MarketDeck row={currentRow} ethUsd={data.ethUsd ?? 0} onSkip={nextMarket} />
              )}
            </div>
          )}
        </div>
      </main>

      {/* RIGHT — The Room */}
      <aside
        className={`${show("room")} row-start-1 min-h-0 flex-col overflow-y-auto bg-[var(--bg)] px-4 py-5 lg:col-start-3 lg:flex lg:py-6`}
        style={{ borderLeft: "1px solid var(--border)" }}
      >
        <div className="mb-4 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Live
        </div>
        <LiveTape wallet={wallet} onSelect={selectMarket} />
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
  );
}
