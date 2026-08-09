/**
 * /dev/voice — the PI voice, read as a feed instead of as a diff.
 *
 * NOT A MOCKUP. The rows below are built by the REAL story pipeline
 * (`liveRowStory` → `tellPiStory`, src/domain/pi-voice) and rendered by the REAL
 * `LiveTape`. Change a sentence in the voice layer and this page changes with
 * it, which is the only property that makes a copy lab worth keeping: a page of
 * hand-written examples keeps looking right after the product stops agreeing.
 *
 * WHY IT EXISTS. Voice is the one thing unit tests can only half-judge. A
 * corpus can be individually correct and collectively insufferable — the same
 * cadence twelve times, every row reaching for a question, three "just landed"
 * in a column. That is visible in seconds here and invisible in an assertion.
 *
 * The fixtures span the states the voice treats differently: going first, a side
 * filling, ordinary arrivals, scale, commitment, the turn, the quiet departures,
 * the emptied side, and a sweep. DEV ONLY.
 */
import { createFileRoute } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMemo } from "react";
import { LiveTape } from "@/components/LiveTape";
import { liveRowStory, flattenStory, type LiveRow } from "@/lib/live-tape";

export const Route = createFileRoute("/dev/voice")({
  component: VoiceLab,
});

interface Fixture {
  /** What about this row the voice is meant to treat differently. */
  note: string;
  row: Omit<LiveRow, "text" | "story">;
}

const t = (minsAgo: number): string => new Date(Date.now() - minsAgo * 60_000).toISOString();

const base = (i: number, o: Partial<Omit<LiveRow, "text" | "story">>) => ({
  id: `voice-${i}`,
  kind: "trade_burst",
  marketId: String(9000 + i),
  marketTitle: [
    "Will Base do more daily transactions than Solana this year?",
    "Is Michael Saylor a hypocrite?",
    "Will any opinion market clear $1,000 this month?",
    "Does the Fed cut before June?",
  ][i % 4]!,
  occurredAt: t(i * 7 + 2),
  startedAt: t(i * 7 + 3),
  side: "YES" as "YES" | "NO" | null,
  walletCount: 1,
  tradeCount: 1,
  amountEth: null,
  amountUsd: 12,
  wallet: null,
  payload: {} as Record<string, unknown>,
  ...o,
});

const FIXTURES: Fixture[] = [
  { note: "went first", row: base(0, { amountUsd: 30, walletCount: 1 }) },
  { note: "side opened · a crowd at once", row: base(1, { walletCount: 3, amountUsd: 18, side: "NO" }) },
  { note: "ordinary arrival", row: base(2, { amountUsd: 4 }) },
  { note: "scale · the size is the news", row: base(3, { amountUsd: 420 }) },
  { note: "commitment · already held", row: base(4, { amountUsd: 65, payload: { action: "BUY" } }) },
  {
    note: "the turn",
    row: base(5, { kind: "side_shift", side: "NO", payload: { action: "BUY" } }),
  },
  { note: "quiet exit", row: base(6, { amountUsd: 9, payload: { action: "SELL" } }) },
  {
    note: "big exit",
    row: base(7, { amountUsd: 260, side: "NO", payload: { action: "SELL" } }),
  },
  {
    note: "round trip",
    row: base(8, { kind: "round_trip", amountUsd: 15, payload: { action: "SELL" } }),
  },
  {
    note: "sweep out · one person, many markets",
    row: base(9, {
      kind: "wallet_sweep",
      side: null,
      amountUsd: 140,
      payload: { action: "SELL", markets: 6 },
    }),
  },
  {
    note: "sweep in",
    row: base(10, {
      kind: "wallet_sweep",
      side: null,
      amountUsd: 90,
      payload: { action: "BUY", markets: 4 },
    }),
  },
  {
    note: "milestone",
    row: base(11, { kind: "believer_milestone", payload: { threshold: 25 } }),
  },
];

function VoiceLab() {
  // A private cache whose fetcher refuses: the tape can only ever show what this
  // page hands it, and any surface reaching for the network fails loudly.
  const qc = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            staleTime: Infinity,
            queryFn: () => {
              throw new Error("voice lab: offline by design");
            },
          },
        },
      }),
    [],
  );

  const rows: LiveRow[] = useMemo(
    () =>
      FIXTURES.map((f) => {
        const story = liveRowStory(f.row);
        return { ...f.row, story, text: flattenStory(story) };
      }),
    [],
  );

  if (!import.meta.env.DEV) return <div className="p-8 text-sm">Not found.</div>;

  return (
    <QueryClientProvider client={qc}>
      <main className="mx-auto max-w-[560px] p-6">
        <h1 className="text-lg font-semibold text-[var(--text)]">Voice lab</h1>
        <p className="mb-4 text-sm text-[var(--text-muted)]">
          Real rows, real tape, real copy. Read the column, not the rows: the question is whether
          twelve in a row sound like one person noticing things.
        </p>
        <ol className="mb-6 grid gap-1 text-xs text-[var(--text-muted)]">
          {rows.map((r, i) => (
            <li key={r.id}>
              <span className="opacity-60">{FIXTURES[i]!.note}</span> — {r.text}
            </li>
          ))}
        </ol>
        <LiveTape initial={{ rows, error: null }} scroll={false} holdUpdates />
      </main>
    </QueryClientProvider>
  );
}
