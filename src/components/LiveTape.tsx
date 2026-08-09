/**
 * LiveTape — the right column: the living story of conviction.
 *
 * It renders the server-grouped LiveRow DTO and owns exactly ONE decision of its
 * own: WHICH rows fit in the window. Time decides the order — a live tape that
 * re-sorts itself reads as broken, not curated, and "what just happened, in
 * order" is the whole contract it has with a reader.
 *
 * The selection runs HERE rather than on the server because delta-sync merges a
 * fresh head into the cached tail (mergeLiveRows), so the full set only exists
 * at this point. The server sends the mixer's INPUTS on each row.
 *
 * New rows animate in. That is the difference between a list that updates and a
 * feed that feels alive.
 *
 * Each row is read at a glance: a headline, one sentence, and — for group
 * stories — a stack of clickable faces, because the people are the way in.
 * Personal rows (a Twin / someone in your network) get a faint "about you"
 * highlight. Clicking a row selects that market; clicking a face opens that
 * person.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWarmMarket } from "@/lib/realtime/warm-market";

import { PersonStack } from "@/components/PersonStack";
import { showsAmountFooter } from "@/domain/amount-footer";

import { listLiveEvents } from "@/lib/live.functions";
import { useStickyRows } from "@/hooks/useSticky";
import { useScheduledRows } from "@/hooks/useScheduledRows";
import { useStandingMemory } from "@/hooks/useStandingMemory";
import { hueFor, initialsFor } from "@/lib/wallet-identity";
import { PersonAvatar } from "@/components/PersonAvatar";
import { mergeLiveRows, LIVE_DELTA_OVERLAP_MS, type LiveRow } from "@/lib/live-tape";
import { useTapeGate } from "@/hooks/useTapeGate";
import { arrivalLabel } from "@/domain/tape-arrivals";
import { mixFeed, type MixCandidate } from "@/domain/feed-cadence";
import {
  arrangeFeed,
  tailState,
  dueForFullRebuild,
  HEARTBEAT_MS,
  INITIAL_REVEAL,
  REVEAL_PAGE,
} from "@/domain/live-display";
import type { BeatTone } from "@/domain/story";
import { ago } from "@/domain/relative-time";
import { COPY_VERSION, sameCopyVersion } from "@/domain/copy-version";

type LiveResult = {
  rows: LiveRow[];
  /** The build that COMPOSED these sentences — see src/domain/copy-version. */
  copyVersion?: string;
  error: string | null;
};

/** Beyond this gap since our newest cached event, a delta would be large — just
 *  do a full fetch (the persisted cache already gave the instant paint). */
const MAX_DELTA_SPAN_MS = 30 * 60_000;

/**
 * The money, at a glance. Two significant-ish figures is all a feed row can
 * carry — "$1.2k" reads instantly, "$1,238.44" makes the eye stop and parse.
 */
function usdShort(usd: number): string {
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}m`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(1)}k`;
  if (usd >= 10) return `$${Math.round(usd)}`;
  return `$${usd.toFixed(2)}`;
}

export function LiveTape({
  wallet,
  onSelect,
  marketIds,
  scroll = true,
  side,
  excludeMarketId,
  limit,
  showTitles = true,
  emptyText = "Nothing yet.",
  skeletonRows = 8,
  holdUpdates = false,
  label,
  initial,
}: {
  wallet?: string;
  /**
   * Select the market a row happened in. Omit inside a market's own panel —
   * a row that looks clickable and goes nowhere is worse than a plain one.
   */
  onSelect?: (marketId: number) => void;
  /** Scope the tape to one market (center deck) or a set (positions). */
  marketIds?: number[];
  /** Scope to one side of that market — the YES/NO rails. */
  side?: "YES" | "NO";
  /**
   * Own the scroll (the standalone column) or flow inline (embedded in a panel
   * that already scrolls). A scroller inside a scroller traps the gesture and
   * collapses the height, so an embedded tape must never bring its own.
   */
  scroll?: boolean;
  /** Drop this market's rows — the global feed hides what the pinned block shows. */
  excludeMarketId?: number;
  limit?: number;
  /** Hide the market title line when the tape already sits under that market. */
  showTitles?: boolean;
  emptyText?: string;
  skeletonRows?: number;
  /**
   * X-style: never insert new rows on their own. The mixer keeps running, the
   * arrivals queue, and the banner is the only thing that moves the list.
   */
  holdUpdates?: boolean;
  /**
   * The tape's own heading ("Insider"). Given here rather than rendered by the
   * parent so the UPDATE CONTROL can sit on the same line — see the header
   * below for why that placement is the whole point.
   */
  label?: string;
  /**
   * ROWS FROM THE SERVER, for paint only. The shared signed-out tape is built
   * once and cached server-side, so SSR can hand the first rows down and the
   * column has real content the instant it mounts. Adopted as PLACEHOLDER, never
   * as initial data: the query still runs immediately and replaces it, so a
   * seed can never become the tape.
   */
  initial?: LiveResult | null;
}) {
  const scopeKey = marketIds && marketIds.length > 0 ? [...marketIds].sort((a, b) => a - b) : null;
  const qc = useQueryClient();
  // A tap on a row opens that market — warm it the moment the finger lands.
  const warm = useWarmMarket();
  // When this hook last did a FULL rebuild (not a delta). The heartbeat forces
  // one on a slow cadence so the families that are full-fetch only — standing
  // facts, person milestones, market signals, "showed up" — keep replenishing
  // between trades instead of the feed running dry. See src/domain/live-display.
  const lastFullAt = useRef(0);
  const key = ["live-tape", wallet ?? null, scopeKey, side ?? null, limit ?? null];
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: async (): Promise<LiveResult> => {
      // Delta sync (global tape only): re-fetch just the overlap window since our
      // newest cached event and merge onto the immutable tail — moving a few rows
      // instead of the whole list every 6s. Falls back to a full fetch for the
      // scoped tapes, a cold cache, or a long absence.
      const cached = qc.getQueryData<LiveResult>(key);
      /* A TAIL COMPOSED BY AN OLDER BUILD IS NOT REUSABLE. The rows carry
         server-written copy, and the merge below keeps anything older than the
         overlap window indefinitely — so without this a shipped PI-copy fix
         could sit invisible behind sentences the repository no longer contains.
         A version change costs exactly one full rebuild. */
      const fresh = cached != null && sameCopyVersion(cached.copyVersion);
      const prev = fresh ? (cached?.rows ?? []) : [];
      const newestMs = prev.length ? Date.parse(prev[0].occurredAt) : 0;
      const canDelta =
        scopeKey === null &&
        side == null &&
        prev.length > 0 &&
        Date.now() - newestMs <= MAX_DELTA_SPAN_MS &&
        // A delta never rebuilds the non-trade families, so once the heartbeat
        // is due we take the full path even though a delta would be cheaper.
        !dueForFullRebuild(lastFullAt.current, Date.now());
      if (canDelta) {
        const sinceIso = new Date(newestMs - LIVE_DELTA_OVERLAP_MS).toISOString();
        const res = (await listLiveEvents({
          data: { wallet, limit, since: sinceIso },
        })) as LiveResult;
        if (res.error)
          return { rows: prev, copyVersion: COPY_VERSION, error: res.error };
        // The server may have redeployed mid-session: never merge across builds.
        if (!sameCopyVersion(res.copyVersion))
          return (await listLiveEvents({ data: { wallet, limit } })) as LiveResult;
        return {
          rows: mergeLiveRows(prev, res.rows, sinceIso, limit ?? 120),
          copyVersion: res.copyVersion,
          error: null,
        };
      }
      const full = (await listLiveEvents({
        data: { wallet, marketIds: scopeKey ?? undefined, side, limit },
      })) as LiveResult;
      // Only a SUCCESSFUL full build resets the clock — an errored one did not
      // refresh the families, so the next heartbeat should try again, not wait.
      if (!full.error) lastFullAt.current = Date.now();
      return full;
    },
    /**
     * FRESHNESS IS THE SOCKET'S JOB; the timer below is NOT a freshness poll.
     *
     * The realtime coordinator invalidates `["live-tape"]` on every trade event
     * — coalesced to at most one refetch per 1.5s — and again on reconnect and
     * on a hidden tab becoming visible. That is what keeps the tape current, and
     * a 30-second freshness poll was retired for being both slower than the
     * socket and redundant with it (see network-query.ts for the same lesson).
     * `staleTime` reflects that: the tape is authoritative until the coordinator
     * says otherwise, so remounting inside the window costs no request.
     */
    staleTime: 60_000,
    // THE HEARTBEAT — a SUPPLY floor, not a freshness poll. The socket only
    // wakes the tape on a trade, and the delta it fetches rebuilds none of the
    // non-trade families (standing facts, milestones, market signals, "showed
    // up"). So between trades the "Now" feed had nothing left to add and looked
    // frozen. This slow timer re-runs the query, and `dueForFullRebuild` turns
    // roughly every other tick into a full rebuild — which is the only thing
    // that replenishes those families, standing stories included. Deliberately far
    // slower than the retired poll, and only the global tape needs it (scoped
    // tapes already full-fetch and ride the socket); a hidden tab never polls.
    refetchInterval: scopeKey === null && side == null ? HEARTBEAT_MS : false,
    refetchIntervalInBackground: false,
    // The seed only answers the question it was built for: the unscoped,
    // signed-out tape. Anything scoped or personal must show its own rows.
    // A seed composed by an older build would paint stale sentences on arrival.
    placeholderData: (prev) =>
      prev ??
      (scopeKey === null && side == null && !wallet && sameCopyVersion(initial?.copyVersion)
        ? (initial ?? undefined)
        : undefined),
  });
  // Sticky: the tape holds its rows until fresh ones arrive.
  const sticky = useStickyRows(data?.rows);
  /* STANDING STORIES ARE ORDINARY ROWS NOW — they compete in the mixer like
     everything else. The one thing they still need is the per-reader cooldown:
     a fact that is permanently true would otherwise recur every session. Only
     the browser knows what THIS reader has already been told, so the filter
     lives here, before the mixer, rather than in a separate lane. */
  const { fresh: factFresh, remember } = useStandingMemory();
  const visible = useMemo(() => {
    const scoped =
      excludeMarketId == null
        ? sticky
        : sticky.filter((r) => Number(r.marketId) !== excludeMarketId);
    return scoped.filter((r) => !r.timeless || factFresh(r.id));
  }, [sticky, excludeMarketId, factFresh]);

  // THE EDITORIAL PASS — SELECT with rank, DISPLAY with time.
  //
  // A live tape's contract with the reader is "this is what just happened, in
  // order". The mixer's job is to CHOOSE which rows survive the window (dominance
  // caps, family variety, significance and discovery); it must never set the
  // ORDER, or the column reads 3h, 41m, 1h, 2h and feels broken rather than
  // curated. So the mixer's output becomes a RANK lookup here, and the actual
  // windowing + chronological ordering happens at the render boundary via
  // `arrangeFeed` — which, crucially, no longer DROPS the rows past the window
  // but hands back how many are waiting, so "Update" can offer older stories
  // instead of silently exhausting. See src/domain/live-display.
  const rankById = useMemo(() => {
    const cands = visible.map((r) => r.mix).filter((m): m is MixCandidate => m != null);
    if (cands.length === 0) return null;
    const map = new Map<string, number>();
    mixFeed(cands).forEach((m, i) => map.set(m.id, i));
    return map;
  }, [visible]);

  // ARRIVAL. A live feed should feel like it is being written, so rows are
  // released one at a time by the presentation scheduler rather than rendered
  // as whatever the last poll returned — eight events landing in one frame is a
  // page refresh with a transition on it. The scheduler also decides WHICH row
  // goes next, so coordinated selling never waits behind four dust trades.
  // THE GATE. Everything above decides what the tape COULD show; this decides
  // whether the reader gets it now or is offered it. The scheduler below then
  // paces what was admitted — pacing an arrival the reader never asked for is
  // still an interruption, just a prettier one.
  //
  // EMBEDDED TAPES (`scroll={false}`, inside a panel that scrolls for them)
  // cannot observe their own scroll position, so `scrollTop` is always 0 and
  // the gate falls back to the pointer alone: they hold updates while the
  // reader's pointer is in them and stream otherwise. That is the honest
  // behaviour for a short inline block rather than a gap — reaching up to a
  // parent scroller to fake the signal would couple this component to whoever
  // happens to render it.
  // A single-market tape counts events; the global feed counts markets.
  const singleMarket = (marketIds?.length ?? 0) === 1;
  // Identifies WHICH tape this is — a scope change is a new list, not new
  // activity. Shared by the gate, the scheduler and the reveal window.
  const resetKey = JSON.stringify(key);
  // The gate now sees the FULL candidate set (not a pre-sliced 40), so nothing
  // eligible is dropped before the reader can be offered it. Windowing moved to
  // the render boundary — see `arranged` below.
  const gate = useTapeGate(visible, resetKey, holdUpdates, !singleMarket);

  // How many rows the "Now" column reveals. Grows when the reader asks for more;
  // resets when the tape becomes a different list.
  const [revealCount, setRevealCount] = useState(INITIAL_REVEAL);
  useEffect(() => setRevealCount(INITIAL_REVEAL), [resetKey]);
  const revealMore = useCallback(() => setRevealCount((n) => n + REVEAL_PAGE), []);

  // The 0 → N edge, counted. Increments only when the pill goes from absent to
  // present, so the entrance animation plays once per waiting batch.
  const [pulseKey, setPulseKey] = useState(0);
  const wasWaiting = useRef(false);
  useEffect(() => {
    const waiting = gate.pending > 0;
    if (waiting && !wasWaiting.current) setPulseKey((n) => n + 1);
    wasWaiting.current = waiting;
  }, [gate.pending]);

  // The rows the last tap admitted — kept in the window and shown at the top,
  // so "Update" always visibly changes the feed.
  const pinnedIds = useMemo(() => new Set(gate.lastAdmitted), [gate.lastAdmitted]);

  const { rows: released, entranceWeight } = useScheduledRows(
    gate.admitted,
    resetKey,
    gate.admitNonce,
  );

  // WINDOW + ORDER, in one place. For the standalone "Now" column the mixer's
  // rank chooses the best `revealCount` stories and time orders them; `hidden`
  // is what "Show earlier" will surface. Embedded tapes (no label) are short and
  // scroll inside a host panel, so they keep showing everything the scheduler
  // has released, in the scheduler's order — the windowing is the Now column's
  // concern, not theirs.
  const arranged =
    label != null
      ? arrangeFeed(released, {
          rankOf: (id) => rankById?.get(id),
          limit: revealCount,
          pinned: pinnedIds,
        })
      : { shown: released, hidden: 0 };
  const shown = arranged.shown;
  const tail = tailState({
    shown: shown.length,
    hidden: arranged.hidden,
    pending: gate.pending,
    loading: isLoading,
  });

  /**
   * THE TAP HAS TO LAND SOMEWHERE THE READER CAN SEE.
   *
   * Merged rows join at the TOP of the list. If the reader was scrolled down,
   * that is off screen — the counter cleared and nothing appeared to change.
   * Riding the scroller back to the top makes the destination obvious, and the
   * rows play their entrance once they are in view.
   */
  const scrollerRef = useRef<HTMLElement | null>(null);
  const setScroller = useCallback(
    (el: HTMLElement | null) => {
      scrollerRef.current = el;
      gate.scrollRef(el);
    },
    [gate.scrollRef],
  );

  const admit = useCallback(() => {
    gate.admit();
    const el = scrollerRef.current;
    if (!el) return;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
  }, [gate]);

  // Once a standing fact has actually been shown, it goes on cooldown. Recorded
  // on RELEASE rather than on fetch, so a fact that was held and never drawn is
  // still available next time.
  useEffect(() => {
    for (const r of released) if (r.timeless) remember(r.id);
  }, [released, remember]);

  // Motion by rarity: the same tier that decided whether the row was worth
  // showing at all now decides how much it is allowed to move. A Tier 1 row
  // gets a deliberate entrance and a beat alone; texture just appears. Motion
  // that is identical everywhere tells a reader nothing.
  const entranceClass = (id: string): string | undefined => {
    const w = entranceWeight(id);
    if (w == null) return undefined;
    if (w <= 1) return "tape-enter-major";
    if (w === 2) return "tape-flash";
    if (w === 3) return "tape-enter";
    return undefined;
  };

  const header =
    label == null ? null : (
      /**
       * THE HEADING AND THE UPDATE CONTROL SHARE ONE LINE, AND THAT LINE NEVER
       * CHANGES HEIGHT.
       *
       * The control used to be `sticky top-0 mb-2` INSIDE the scroller. So it
       * pushed every row down by ~34px the moment activity arrived, and the rows
       * snapped back up the instant it was tapped — a jump on arrival and a
       * second one on the tap that was supposed to be the calm, deliberate act.
       * The reader's own click moved the thing they were aiming at.
       *
       * Out here it is a sibling of the label in a fixed-height row, so appearing
       * and disappearing costs the list nothing. It fades rather than popping,
       * and the row reserves its height whether or not it is there.
       */
      <div className="mb-4 flex h-[26px] shrink-0 items-center gap-2 overflow-visible">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          {label}
        </span>
        <button
          type="button"
          onClick={admit}
          /**
           * ONE PULSE, ON ARRIVAL, THEN STILLNESS.
           *
           * Remounting on the 0 → N edge (and only that edge) lets the CSS
           * animation play exactly once. Every later increment is just a number
           * changing inside a pill that is already sitting there, so the control
           * never nags: it announces itself once and then waits.
           */
          key={`pill-${pulseKey}`}
          // Present but inert at zero pending: the slot is always occupied, so
          // nothing reflows when it becomes available.
          aria-hidden={gate.pending === 0 || undefined}
          tabIndex={gate.pending === 0 ? -1 : undefined}
          className="ml-auto rounded-full border px-2.5 py-[3px] text-[11px] font-semibold leading-[14px] backdrop-blur-sm transition-[opacity,transform,background-color] duration-200 ease-out motion-reduce:transition-none motion-reduce:animate-none"
          style={{
            // A quiet system indicator, not a call to action: the filled white
            // button is reserved for Connect Wallet and Back YES/NO.
            background: "color-mix(in oklab, var(--notice) 12%, transparent)",
            borderColor: "color-mix(in oklab, var(--notice) 45%, transparent)",
            color: "var(--notice)",
            opacity: gate.pending > 0 ? 1 : 0,
            transform: gate.pending > 0 ? "scale(1)" : "scale(0.98)",
            pointerEvents: gate.pending > 0 ? "auto" : "none",
            animation: gate.pending > 0 ? "tape-pill-in 640ms ease-out 1" : undefined,
          }}
        >
          ↑ {arrivalLabel(gate.pending)}
        </button>
      </div>
    );

  const body = (
    <div
      ref={setScroller}
      {...gate.pointerProps}
      className={
        scroll
          ? "h-full min-h-0 flex-1 touch-pan-y overflow-y-scroll overscroll-contain [-webkit-overflow-scrolling:touch]"
          : ""
      }
    >
      {isLoading && shown.length === 0 ? (
        <ul className="space-y-2" aria-hidden>
          {Array.from({ length: skeletonRows }).map((_, i) => (
            <li key={i} className="h-8 animate-pulse rounded bg-[var(--surface-2)]" />
          ))}
        </ul>
      ) : shown.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">{emptyText}</p>
      ) : (
        <ul className="space-y-3">
          {shown.map((r) => {
            const s = r.story;
            const personal = s.personal;
            // A discovery moment is about a PERSON, not a market — it has no
            // destination of its own, and the faces are deliberately the only
            // way in. Everything else selects the market it happened in.
            const target = Number(r.marketId);
            const navigable = !!onSelect && Number.isFinite(target) && target > 0;
            // The title tells you WHICH market. Never show it when the body already
            // is the question (a fresh market), so the row never repeats itself.
            const norm = (x: string) => x.trim().replace(/\s+/g, " ").toLowerCase();
            const showTitle =
              showTitles &&
              navigable &&
              s.category !== "fresh_market" &&
              norm(r.marketTitle) !== norm(s.body);
            return (
              <li key={r.id} className={entranceClass(r.id)}>
                <div
                  role={navigable ? "button" : undefined}
                  tabIndex={navigable ? 0 : undefined}
                  // WARM ON TOUCH, NOT ON TAP. A tape row can point at any
                  // market in the system, so the tap used to start from a cold
                  // cache and the centre had nothing to draw. `pointerdown`
                  // fires while the finger is still down — enough of a head
                  // start that the market is usually ready by the time the
                  // column switches to it.
                  onPointerDown={navigable ? () => warm(target) : undefined}
                  onPointerEnter={navigable ? () => warm(target) : undefined}
                  onFocus={navigable ? () => warm(target) : undefined}
                  onClick={navigable ? () => onSelect?.(target) : undefined}
                  onKeyDown={
                    navigable
                      ? (event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onSelect?.(target);
                          }
                        }
                      : undefined
                  }
                  className={`block w-full rounded-[10px] px-2 py-2 text-left transition-colors ${navigable ? "hover:bg-[var(--surface-2)]" : ""}`}
                  // Personal (network) rows carry a faint "this is about you" wash —
                  // the only rows with a background, so belonging quietly stands out.
                  style={
                    personal
                      ? { background: "color-mix(in oklab, var(--rel,#9b87f5) 8%, transparent)" }
                      : undefined
                  }
                >
                  {/* WHEN → WHAT → WHY → WHO. Time first, headline loud, then the
                    one-sentence change, then a small muted attribution last. */}
                  {/* A standing fact has no "when" — printing an age beside it
                    would read as "this just happened", which is the one thing
                    it does not mean. */}
                  {!r.timeless && (
                    <div className="text-[10px] font-medium tabular-nums text-[var(--text-muted)]">
                      {ago(r.occurredAt)}
                    </div>
                  )}
                  <div className="mt-0.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-[var(--text)]">
                    <SideText text={s.headline} />
                  </div>
                  <div className="mt-0.5 text-[13px] leading-snug text-[var(--text-secondary)]">
                    <SideText text={s.body} />
                  </div>
                  {showTitle && (
                    <div className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]">
                      {r.marketTitle}
                    </div>
                  )}
                  {/* THE PATTERN ASIDE. Not what happened — what it is the third
                    of. Cross-market context no single event can carry, so it
                    sits apart from the story in the observer's own register. */}
                  {s.pattern && (
                    <div className="mt-1 text-[11px] italic leading-snug text-[var(--text-muted)]">
                      {s.pattern}
                    </div>
                  )}

                  {/* THE OPEN QUESTION. Only on rows where two facts genuinely
                    don't fit together — the investigator pointing at the gap
                    instead of pretending to have closed it. */}
                  {s.question && (
                    <div className="mt-1.5 border-l-2 border-[color-mix(in_oklab,var(--notice,#9b87f5)_60%,transparent)] pl-2 text-[12px] leading-snug text-[var(--text-secondary)]">
                      {s.question}
                    </div>
                  )}


                  {/* WHO + HOW MUCH. Every row that has people ends with their
                    faces, and every row that has money ends with the money.
                    Faces left, amount right, one line — the stack is the way
                    into the profiles, the amount is the proof of conviction. */}
                  {(r.people?.length || r.face || r.amountUsd != null) && (
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        {r.people && r.people.length > 0 ? (
                          // A discovery row IS the person — bigger faces there.
                          <PersonStack
                            people={r.people}
                            size={r.kind === "discovery_moment" ? 34 : 24}
                          />
                        ) : (
                          r.face && <AttributionFace r={r} />
                        )}
                        {s.attribution && (
                          <span className="truncate text-[11px] text-[var(--text-muted)]">
                            {s.attribution}
                          </span>
                        )}
                      </div>
                      {/* ONE FACT, ONCE PER CARD — AND ONLY IF IT IS A FACT
                        WORTH A LINE. See src/domain/amount-footer: a card that
                        already carries its own consequence ("Only 4 left") does
                        not need $15 bolted underneath it. */}
                      {showsAmountFooter({
                        headline: s.headline,
                        body: s.body,
                        attribution: s.attribution,
                        amountUsd: r.amountUsd,
                      }) && (
                        <span className="ml-auto shrink-0 text-[11px] text-[var(--text-muted)]">
                          <span className="num font-semibold text-[var(--text-secondary)]">
                            {usdShort(r.amountUsd!)}
                          </span>{" "}
                          traded
                        </span>
                      )}

                    </div>
                  )}
                </div>
              </li>
            );
          })}
          {/* THE TAIL NEVER LOOKS FROZEN. Three honest states, and only ever one:
              older stories to reveal, or a plain "you're caught up". A fetch in
              flight or arrivals waiting up top say nothing here, so the tail does
              not compete with the "N New" control. Only the standalone "Insider"
              column carries it — an embedded rail is short and its host owns the
              end of its own list. See src/domain/live-display. */}
          {label != null && tail === "more" && (
            <li>
              <button
                type="button"
                onClick={revealMore}
                className="w-full rounded-[10px] px-2 py-2 text-left text-[12px] font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-2)]"
              >
                Show earlier stories
              </button>
            </li>
          )}
          {label != null && tail === "caught_up" && (
            <li className="px-2 pb-1 pt-3 text-[11px] leading-snug text-[var(--text-muted)]">
              You&rsquo;re all caught up. New stories appear as Conviction moves.
            </li>
          )}
        </ul>
      )}
    </div>
  );

  // No label: the tape is embedded and the parent owns the heading (and there is
  // nothing to hold, because embedded tapes stream).
  if (header == null) return body;
  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}
      {body}
    </div>
  );
}

/** A tiny face beside the attribution — clicking it opens that person. */
function AttributionFace({ r }: { r: LiveRow }) {
  if (!r.face) return null;
  return (
    <PersonAvatar
      wallet={r.wallet ?? r.id}
      name={r.face.name}
      avatarUrl={r.face.avatarUrl}
      size={24}
    />
  );
}

/**
 * Colour discipline: the only tinted glyphs in the tape are the words YES / NO
 * (side colours) and signed percentages (gain green / loss red). Event labels
 * such as BACKED, SOLD SOME and EXITED stay neutral.
 */
function SideText({ text, tone }: { text?: string | null; tone?: BeatTone }) {
  // A toned headline (e.g. "CAPITAL PULLED BACK") carries its direction; body text
  // stays neutral except the YES / NO words and any percentage.
  const toneColor = tone === "yes" ? "var(--yes)" : tone === "no" ? "var(--no)" : undefined;
  // A beat can arrive with a missing headline/body (older cached payload, or a
  // narrator that produced no sentence). Render nothing rather than crash the feed.
  if (typeof text !== "string" || text.length === 0) return null;
  const parts = text.split(/(\bYES\b|\bNO\b|[+−-]?\d+(?:\.\d+)?%)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p === "YES" || p === "NO") {
          return (
            <span
              key={i}
              className="font-semibold"
              style={{ color: p === "YES" ? "var(--yes)" : "var(--no)" }}
            >
              {p}
            </span>
          );
        }
        if (/^[+−-]?\d+(?:\.\d+)?%$/.test(p)) {
          return (
            <span
              key={i}
              className="num font-semibold"
              style={{
                color: p.startsWith("−") || p.startsWith("-") ? "var(--loss)" : "var(--gain)",
              }}
            >
              {p}
            </span>
          );
        }
        return (
          <span key={i} style={toneColor ? { color: toneColor } : undefined}>
            {p}
          </span>
        );
      })}
    </>
  );
}
