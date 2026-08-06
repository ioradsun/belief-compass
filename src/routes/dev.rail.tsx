/**
 * RIGHT-RAIL LAYOUT FIXTURE — does anything jump?
 *
 * The right rail is a flex column: a welcome card, a market-activity card, a
 * "Now" heading, and a live tape that takes whatever height is left. Because the
 * tape is `flex-1`, ANY height change in the blocks above it moves the heading
 * and resizes the tape's viewport — so the rows a reader is looking at move.
 *
 * This harness reproduces that exact geometry with blocks whose heights match
 * the real cards, and exposes a control surface so the probe can drive each
 * change PROGRAMMATICALLY. That matters: the `layout-shift` API sets
 * `hadRecentInput` on anything within 500ms of a real click and CLS discards
 * those, so a click-driven test reports 0.000 no matter how badly the column
 * moves. Driving it through `window.__rail` produces the honest number.
 *
 * It measures the MECHANISM (how the column responds to a block appearing,
 * disappearing, reflowing or expanding), not the cards' internals. That the real
 * components actually use the mechanism is held by a separate guard test —
 * see src/components/rail-stability.test.ts.
 *
 * Run:  npx vite dev --host 127.0.0.1 --port 5199
 *       node scripts/measure-rail.mjs [label]
 */
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Collapsible } from "@/components/Collapsible";

export const Route = createFileRoute("/dev/rail")({ component: RailHarness });

declare global {
  interface Window {
    __rail?: {
      /** The room has people in it (the "Say hi" card). */
      setWelcome: (on: boolean) => void;
      /** This market has activity (the "In this market" card). */
      setActivity: (on: boolean) => void;
      /** The activity card is expanded. */
      setExpanded: (on: boolean) => void;
      /** The latest beat rewraps from one line to two, as new events land. */
      setLongBeat: (on: boolean) => void;
      /** Render the OLD behaviour — instant mount/unmount, unreserved text. */
      setLegacy: (on: boolean) => void;
      state: () => Record<string, boolean>;
    };
  }
}

const SHORT = "Wazir backed YES";
const LONG =
  "Wazir backed YES with $240, the third of your tribe to move on this market in the last hour";

function RailHarness() {
  const [welcome, setWelcome] = useState(true);
  const [activity, setActivity] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [longBeat, setLongBeat] = useState(false);
  // The pre-fix behaviour, so the probe can measure both and the difference is
  // a number rather than a claim.
  const [legacy, setLegacy] = useState(false);

  const state = useCallback(
    () => ({ welcome, activity, expanded, longBeat, legacy }),
    [welcome, activity, expanded, longBeat, legacy],
  );

  useEffect(() => {
    window.__rail = { setWelcome, setActivity, setExpanded, setLongBeat, setLegacy, state };
  }, [state]);

  if (!import.meta.env.DEV) {
    return <div className="p-8 text-sm text-[var(--text-muted)]">Not found.</div>;
  }

  const beat = longBeat ? LONG : SHORT;

  const welcomeCard = (
    <div
      className="rounded-[14px] px-3.5 py-3"
      style={{ background: "var(--surface)" }}
      data-probe="welcome-card"
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-[1px] text-[17px] leading-none">👋</span>
        <div
          className="min-w-0 flex-1 text-[13px] font-semibold text-[var(--text)]"
          style={legacy ? undefined : { minHeight: 36 }}
        >
          Three people just backed YES beside you
        </div>
      </div>
      <div className="mt-2 h-[32px] rounded-full" style={{ background: "var(--surface-2)" }} />
    </div>
  );

  const activityCard = (
    <div
      className="overflow-hidden rounded-[12px]"
      style={{
        borderLeft: "2px solid var(--rel,#9b87f5)",
        background: "color-mix(in oklab, var(--rel,#9b87f5) 7%, transparent)",
      }}
    >
      <div className="flex w-full items-center gap-2 px-3 pb-1 pt-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
          In this market
        </span>
      </div>
      <div className="px-3 pb-2 pt-0.5">
        <span
          className="line-clamp-2 break-words text-[13px] leading-snug text-[var(--text-secondary)]"
          // The fix: two lines are always reserved, so the beat changing under
          // the reader cannot resize the card.
          style={legacy ? undefined : { minHeight: 36 }}
        >
          {beat}
        </span>
      </div>
      {legacy ? null : (
        <Collapsible open={expanded} probe="activity-body">
          <div className="overflow-y-auto px-3 pb-2" style={{ maxHeight: "min(46vh, 340px)" }}>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="border-t border-[var(--hairline)] py-2 text-[12px]">
                Row {i + 1}
              </div>
            ))}
          </div>
        </Collapsible>
      )}
    </div>
  );

  return (
    // The SAME rail geometry the real route uses, so a measurement here
    // describes the real column.
    <div className="flex h-[100svh] w-full bg-[var(--bg)] text-[var(--text)]">
      <aside
        data-probe="rail"
        className="flex h-full min-h-0 w-[320px] max-h-full flex-col overflow-hidden px-5 py-6"
        style={{ borderLeft: "1px solid var(--hairline)" }}
      >
        {legacy ? (
          <>
            {welcome && <div className="mb-4">{welcomeCard}</div>}
            {activity && <div className="mb-3 shrink-0">{activityCard}</div>}
          </>
        ) : (
          <>
            <Collapsible open={welcome} probe="welcome" className="mb-4">
              {welcomeCard}
            </Collapsible>
            <Collapsible open={activity} probe="activity" className="mb-3">
              {activityCard}
            </Collapsible>
          </>
        )}

        {/* THE ANCHOR. This heading is what must not move: everything above it
          is optional and everything below it is the tape. */}
        <div
          data-probe="now"
          className="mb-4 shrink-0 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]"
        >
          Now
        </div>
        <div data-probe="tape" className="min-h-0 flex-1 overflow-hidden">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="border-t border-[var(--hairline)] py-3 text-[12px]">
              Tape row {i + 1}
            </div>
          ))}
        </div>
      </aside>

      <div className="flex-1 p-6 text-xs text-[var(--text-muted)]">
        Rail fixture. Drive it with <code>window.__rail</code>.
      </div>
    </div>
  );
}
