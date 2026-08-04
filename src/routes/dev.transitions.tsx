/**
 * TRANSITION HARNESS — a repeatable test bed for market-to-market motion.
 *
 * DEV ONLY. This route renders the REAL `MarketDeck` inside the REAL centre
 * column geometry, and cycles it through a fixed set of synthetic markets
 * chosen to break layout stability:
 *
 *   • a one-line title next to a three-line one   (does the dock move?)
 *   • four-figure believer counts next to single digits (do numbers jog?)
 *   • a market with every optional field next to one with none
 *     (category, age, creator, media, position) — do absent fields collapse
 *     the rows above the question?
 *
 * The deck's own network calls resolve to nothing here, which is deliberate:
 * "market with missing data" is one of the cases that must not shift, and this
 * harness holds the layout to that standard with no database at all. That also
 * makes it runnable in CI, where there is no Supabase.
 *
 * `window.__scene` is the control surface the probe drives
 * (scripts/measure-transitions.mjs). Nothing here is reachable in production:
 * the route renders a plain 404 notice unless `import.meta.env.DEV`.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { MarketDeck } from "@/components/MarketDeck";
import { DeckSkeleton } from "@/components/DeckSkeleton";
import { MarketScene } from "@/components/MarketScene";
import type { MarketRow } from "@/components/MarketCard";

export const Route = createFileRoute("/dev/transitions")({
  component: TransitionHarness,
});

/** One synthetic market. `kind` names what about it is meant to be difficult. */
interface Fixture {
  kind: string;
  row: MarketRow;
}

const TITLES: { kind: string; title: string }[] = [
  { kind: "short-title", title: "Will it rain?" },
  {
    kind: "two-line-title",
    title: "Will the market cap of at least one opinion market reach $1,000 this week?",
  },
  {
    kind: "very-long-title",
    title:
      "Given everything that has happened over the past eighteen months across the whole of this industry, and accounting for every regulatory intervention announced so far, will the total value locked across all prediction markets exceed one billion dollars before the end of the next calendar year?",
  },
  { kind: "medium-title", title: "Is Michael Saylor a hypocrite?" },
  { kind: "no-category", title: "Did you guys forget about POV Market?" },
  {
    kind: "unicode-title",
    title: "Should “conviction” 🧠 mean money, people, or both — and who decides?",
  },
];

/** Numbers chosen to span the width extremes a proportional font would jog on. */
const SHAPES = [
  { believersYes: 4218, believersNo: 3907, yes: 0.61, no: 0.39 },
  { believersYes: 1, believersNo: 0, yes: 0.5, no: 0.5 },
  { believersYes: 88, believersNo: 111, yes: 0.44, no: 0.56 },
  { believersYes: 0, believersNo: 0, yes: 0.5, no: 0.5 },
  { believersYes: 12_004, believersNo: 9, yes: 0.97, no: 0.03 },
  { believersYes: 37, believersNo: 36, yes: 0.5, no: 0.5 },
];

const FIXTURES: Fixture[] = TITLES.map((t, i) => {
  const s = SHAPES[i % SHAPES.length];
  // Every OTHER market drops its optional fields, so consecutive transitions
  // always cross the "has metadata" / "has none" boundary in both directions.
  const sparse = i % 2 === 1;
  return {
    kind: `${t.kind}${sparse ? " · sparse" : " · full"}`,
    row: {
      onchain_id: 9000 + i,
      markets: {
        title: t.title,
        category: sparse ? null : ["Crypto", "Politics", "Science", "Sport"][i % 4],
        pov_slug: null,
      },
      believers_yes: s.believersYes,
      believers_no: s.believersNo,
      yes_price_usd: s.yes,
      no_price_usd: s.no,
      opportunity_type: sparse ? null : ["hot", "early", "contested", "new"][i % 4],
      opportunity_reason: sparse ? null : "Accelerating against its own normal",
    } as unknown as MarketRow,
  };
});

declare global {
  interface Window {
    __scene?: {
      count: number;
      index: () => number;
      goto: (i: number) => void;
      next: () => void;
      prev: () => void;
      kind: () => string;
      /** Swap the deck for the loading skeleton, to measure the handover. */
      setSkeleton: (on: boolean) => void;
    };
  }
}

function TransitionHarness() {
  const [i, setI] = useState(0);
  // The skeleton and the loaded deck must occupy identical geometry, so the
  // harness can show either one in the same slot and the probe can measure the
  // handover between them the same way it measures a market change.
  const [skeleton, setSkeleton] = useState(false);
  const n = FIXTURES.length;

  const goto = useCallback((next: number) => setI(((next % n) + n) % n), [n]);

  useEffect(() => {
    window.__scene = {
      count: n,
      index: () => i,
      goto,
      next: () => goto(i + 1),
      prev: () => goto(i - 1),
      kind: () => FIXTURES[i].kind,
      setSkeleton,
    };
  }, [i, n, goto]);

  // The same keyboard contract the deck offers, so the probe can exercise the
  // arrow-key path as well as clicks.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") goto(i + 1);
      if (e.key === "ArrowLeft") goto(i - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [i, goto]);

  if (!import.meta.env.DEV) {
    return <div className="p-8 text-sm text-[var(--text-muted)]">Not found.</div>;
  }

  const f = FIXTURES[i];
  return (
    // The SAME shell geometry the real route uses, so measurements taken here
    // describe the real centre column and not a test-only layout.
    <div className="flex h-[100svh] w-full flex-col overflow-hidden bg-[var(--bg)] text-[var(--text)]">
      {/* The harness's own toolbar is FIXED HEIGHT and never wraps. At 390px a
        wrapping toolbar reflows when the label text changes length, and that
        shift lands in the measurement as if the app had moved. The test rig
        must not be the thing being measured. */}
      <div
        className="flex h-9 shrink-0 items-center gap-3 overflow-hidden whitespace-nowrap px-4 text-[11px] text-[var(--text-muted)]"
        style={{ borderBottom: "1px solid var(--hairline)" }}
      >
        <button
          type="button"
          data-probe="prev"
          onClick={() => goto(i - 1)}
          className="rounded px-2 py-1"
          style={{ border: "1px solid var(--border)" }}
        >
          Prev
        </button>
        <button
          type="button"
          data-probe="next"
          onClick={() => goto(i + 1)}
          className="rounded px-2 py-1"
          style={{ border: "1px solid var(--border)" }}
        >
          Next
        </button>
        <button
          type="button"
          data-probe="skeleton"
          onClick={() => setSkeleton((v) => !v)}
          className="rounded px-2 py-1"
          style={{ border: "1px solid var(--border)" }}
        >
          {skeleton ? "Show deck" : "Show skeleton"}
        </button>
        <span data-probe="kind">
          {i + 1}/{n} · {f.kind}
          {skeleton ? " · skeleton" : ""}
        </span>
      </div>
      <main className="flex h-full min-h-0 flex-1 flex-col overflow-hidden px-4 py-5 lg:px-8 lg:py-6">
        <div className="mx-auto flex min-h-0 w-full max-w-[920px] flex-1 flex-col">
          <MarketScene marketId={Number(f.row.onchain_id)}>
            {skeleton ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <DeckSkeleton />
              </div>
            ) : (
              <MarketDeck
                row={f.row}
                ethUsd={3000}
                onSkip={() => goto(i + 1)}
                // Passed so the deck renders its docked read, which is part of
                // the instrument the skeleton has to match.
                onToggleCase={() => undefined}
              />
            )}
          </MarketScene>
        </div>
      </main>
    </div>
  );
}
