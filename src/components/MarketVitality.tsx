/**
 * CENTER — Market Momentum: the timeless read of "how big and which way?"
 *
 * Two compact metric rows — believers and capital (total · percentage change) —
 * plus the exact absolute move over the selected timeframe. No charts here: the
 * shape of the move lives in the Case File. This is the only momentum surface;
 * the story (the narrative sentence, the House voice, the activity) lives in the
 * right feed. The center never becomes a feed.
 *
 * WHO OWNS THE MOMENTUM READ. Not this file. The numbers are canonical
 * (`marketBook` + the shared `MarketChange`), their copy comes from the shared
 * metric-display rule, and the INTERPRETATION — direction, momentum, whether
 * this is fast or calm — is the Insider's: `pulseFactsFromMarket` → `insiderPulse`
 * → `insight`. The component renders that read; it does not compute one. This is
 * the constitutional rule in `src/domain/insider` applied to the center panel.
 *
 * Side-blind by construction. The SAME component renders on desktop and mobile;
 * only the layout changes.
 */
import { Signed } from "@/components/Signed";
import { useMemo, useState, type ReactNode } from "react";
import { PersonAvatar } from "@/components/PersonAvatar";
import { ParticipantSheet, RingedAvatar, RELATION_RING } from "@/components/ParticipantSheet";
import { marketBook, type BookMetric, type BookWindow } from "@/domain/market-book";
import type { TapeTrade } from "@/domain/conviction-series";
import type { FlowWindow } from "@/domain/market-flow";
import { formatMoney, convertMoney } from "@/domain/money";
import { useDisplayUnit } from "@/lib/display-unit";
import { believerMove, capitalMove, type MetricMove } from "@/domain/metric-display";
import type { MarketChange, MetricChange } from "@/domain/market-change";
import { participantSocial, type ParticipantRelation } from "@/domain/participant-social";
import {
  insiderPulse,
  insight,
  pulseFactsFromMarket,
  type MarketStateFacts,
} from "@/domain/insider";


/**
 * A shared MetricChange in the shape believerMove/capitalMove expect.
 *
 * `divisor` converts a USD-denominated change back into the metric's own unit
 * (capital is quoted to those functions in ETH so the viewer's display unit can
 * be applied; believers pass through at 1). Null means we have no rate and
 * cannot convert, so the tape fallback stands.
 */
function fromChange(
  m: MetricChange | undefined,
  fallback: BookMetric,
  divisor: number | null,
): { current: number; base: number } {
  if (m == null || m.current == null || divisor == null || divisor === 0) return fallback;
  const current = m.current / divisor;
  return { current, base: m.base == null ? current : m.base / divisor };
}

const dirTone = (d: "up" | "down" | "flat"): string =>
  d === "up" ? "var(--gain)" : d === "down" ? "var(--loss)" : "var(--text-muted)";

/** Formats an ETH-native capital amount in the viewer's chosen unit. */
type CapFmt = (eth: number, signed?: boolean) => string;

// Believers and capital are turned into their two copy lines by the ONE shared
// metric-display rule (src/domain/metric-display): the count/money leads, the %
// is paired, and a % off a tiny base is kept quiet or dropped. These adapters just
// feed the canonical book metric into that rule.
const believerCopy = (m: { current: number; base: number }, w: BookWindow): MetricMove =>
  believerMove(m.current, m.base, w.since);

// Materiality (direction, the percentage floor) is judged in USD so a display in
// ETH never changes what counts as a real move; only the shown figure converts.
const capitalCopy = (
  m: { current: number; base: number },
  w: BookWindow,
  usd: (eth: number) => number | null,
  money: CapFmt,
): MetricMove =>
  capitalMove({ currentEth: m.current, baseEth: m.base, since: w.since, usd, money });

/** A face the Participants row can show — the smallest shape an avatar needs. */
export interface MomentumFace {
  wallet: string;
  name?: string | null;
  avatarUrl?: string | null;
  /** How the viewer relates to them — decides who is seen first. */
  relation?: ParticipantRelation;
  /** Sheet-only detail (mobile): which way, how much, how long. */
  side?: "YES" | "NO" | null;
  valueUsd?: number | null;
  daysHeld?: number | null;
}

/**
 * SOCIAL PROOF — the answer to "do I know anyone here?", directly under the
 * count. Up to six faces (tribe, then rivals, then everyone else) and one
 * composition line. One list, never separate network sections, and never a
 * message about absence: with nobody familiar it simply reads "17 participants".
 */
function ParticipantProof({
  faces,
  total,
  dense,
}: {
  faces: MomentumFace[];
  total: number;
  dense?: boolean;
}) {
  const { faces: shown, overflow, summary } = participantSocial(faces, total);
  const [sheet, setSheet] = useState(false);
  if (shown.length === 0 && !summary) return null;

  // MOBILE — recognition, not reading. Rings carry the tribe/rival story, the
  // faces carry the social proof, and the whole row is one tap into the sheet
  // where side, amount and time held finally have room.
  if (dense) {
    if (shown.length === 0) return null;
    return (
      <>
        <div
          role="button"
          tabIndex={0}
          aria-label={`Open participants (${total})`}
          onClick={() => setSheet(true)}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setSheet(true)}
          className="mt-2 flex items-center gap-1.5"
        >
          <div className="flex -space-x-1.5">
            {shown.map((f) => (
              <RingedAvatar
                key={f.wallet}
                wallet={f.wallet}
                name={f.name}
                avatarUrl={f.avatarUrl}
                size={26}
                ring={RELATION_RING[f.relation ?? "other"]}
              />
            ))}
          </div>
          {overflow > 0 && (
            <span className="num text-[12px] font-semibold text-[var(--text-muted)]">
              +{overflow}
            </span>
          )}
        </div>
        {sheet && (
          <ParticipantSheet
            people={faces.map((f) => ({
              wallet: f.wallet,
              name: f.name,
              avatarUrl: f.avatarUrl,
              relation: f.relation,
              side: f.side,
              valueUsd: f.valueUsd,
              daysHeld: f.daysHeld,
            }))}
            total={total}
            onClose={() => setSheet(false)}
          />
        )}
      </>
    );
  }

  // DESKTOP — one reading: the face pile. Names + per-person role labels under
  // every face repeated the count above and read as noise, so the pile stays at
  // every width. Tapping it opens the full roster, where names belong.
  return (
    <div className="mt-2">
      {shown.length > 0 && (
        <div
          role="button"
          tabIndex={0}
          aria-label={`Open participants (${total})`}
          onClick={() => setSheet(true)}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setSheet(true)}
          className="flex cursor-pointer items-center gap-1.5"
        >
          <div className="flex -space-x-1.5">
            {shown.map((f) => (
              <PersonAvatar
                key={f.wallet}
                wallet={f.wallet}
                name={f.name}
                avatarUrl={f.avatarUrl}
                size={26}
                className="ring-1 ring-[var(--surface)]"
              />
            ))}
          </div>
          {overflow > 0 && (
            <span className="num text-[11px] text-[var(--text-muted)]">+{overflow}</span>
          )}
        </div>
      )}

      {summary && (
        <div className={`${shown.length > 0 ? "mt-2" : ""} text-[11px] text-[var(--text-muted)]`}>
          {summary}
        </div>
      )}
      {sheet && (
        <ParticipantSheet
          people={faces.map((f) => ({
            wallet: f.wallet,
            name: f.name,
            avatarUrl: f.avatarUrl,
            relation: f.relation,
            side: f.side,
            valueUsd: f.valueUsd,
            daysHeld: f.daysHeld,
          }))}
          total={total}
          onClose={() => setSheet(false)}
        />
      )}
    </div>
  );
}

/**
 * One full-width metric row inside the Total Market instrument: the current
 * total in large type on the left, the percentage change in large type on the
 * right (with its direction arrow trailing it), the metric label beneath, and
 * the exact absolute change over the selected timeframe beneath that.
 */
function MomentumMetric({
  total,
  label,
  copy,
  dense,
  faces,
  facesTotal,
}: {
  total: string;
  label: string;
  copy: MetricMove;
  /** Phone-tight rhythm so the whole market fits one screen without scrolling. */
  dense?: boolean;
  /** Optional identity for this metric — rendered opposite the label. */
  faces?: MomentumFace[];
  facesTotal?: number;
}) {
  // Only a trusted (headline) % earns the big right-hand figure. A small-base %
  // is demoted to a quiet suffix on the absolute line so it never overstates the
  // move.
  //
  // AND WITH NO % AT ALL, THE MOVE ITSELF TAKES THE SLOT. It used to stay empty,
  // which is how a blank space came to argue for a looser percentage rule: the
  // believer floor was lowered from ten to three to fill this gap, and at a base
  // of three "3 → 6 participants" prints "+100%". The gap was the bug. Believers
  // and capital both read faster as a count and an amount anyway — that is this
  // module's own stated rule — so the fallback is not a compromise.
  // ATTENTION IS RANKED, NOT SHARED. The question is the only thing on this
  // panel a reader must decide about; the counts are the evidence they consult
  // *after* reading it. At 30px these totals matched the headline exactly, so
  // the eye had two equal entry points and picked the number — the cheaper
  // read — first. Sizing them a clear step below the question (20/22 against
  // the title's 20–30) restores one obvious first stop without making the
  // evidence any harder to find: they keep the same weight, tabular figures
  // and position, so they are still the strongest thing under the headline.
  const headlinePct =
    copy.pct && !copy.pctQuiet
      ? copy.pct
      : copy.figure || copy.pct || (copy.direction === "flat" ? "0%" : "");
  return (
    /* Every dimension here is a token the container sets (see `.momentum` in
       styles.css): width chooses the type scale, height chooses the air. */
    <div
      style={{
        paddingInline: "var(--mom-pad-x, 16px)",
        paddingBlock: "var(--mom-pad-y, 12px)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="flex min-w-0 items-baseline gap-2">
            <span
              className="num min-w-0 truncate font-semibold leading-none tracking-[-0.02em] text-[var(--text)]"
              style={{ fontSize: "var(--mom-total, 20px)" }}
              suppressHydrationWarning
            >
              {total}
            </span>
            <span
              className="shrink-0 font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]"
              style={{ fontSize: "var(--mom-label, 10px)" }}
            >
              {label}
            </span>
          </span>
          {/* People before statistics: when this metric has faces, the space
          under the count belongs to them.

          THE ROW IS RESERVED, NOT CONDITIONAL. The faces arrive on their own
          request, a beat after the counts, and a market with nobody familiar
          in it has none at all — so rendering them only when they exist made
          this card two different heights, and everything under it (capital,
          the Case File line, the dock) moved as each market's roster landed.
          One face is 26–30px of a card that is otherwise identical on every
          market; holding that space costs nothing and removes the last thing
          in the centre that moves by itself. */}
          {faces ? (
            <div
              style={{ minHeight: "calc(var(--mom-face, 26px) + 8px)" }}
              className="flex items-end"
            >
              <ParticipantProof faces={faces} total={facesTotal ?? faces.length} dense={dense} />
            </div>
          ) : null}
        </span>
        <span className="shrink-0 text-right">
          {/* One rule decides the treatment (see @/components/Signed): a rate is
          a verdict — coloured, arrow-trailing; a count or an amount is a fact —
          signed but neutral, whatever fills this slot. */}
          <Signed
            value={headlinePct}
            className="num block font-semibold leading-none tabular-nums"
            style={{ fontSize: "var(--mom-pct, 16px)" }}
          />
          {/* The exact move sits directly under its percentage — one column,
          one story, for both participants and capital. */}
          <span
            className="num mt-1 block whitespace-nowrap text-[var(--text-muted)]"
            style={{ fontSize: "var(--mom-abs, 12px)" }}
            suppressHydrationWarning
          >
            {copy.absolute}
          </span>
        </span>
      </div>
    </div>
  );
}

export function MarketMomentum({
  tape,
  change,
  ethUsd,
  win,
  nowMs = Date.now(),
  footer,
  dense,
  faces,
  state,

}: {
  /** Still needed for the window phrase and the cold-start read. Never for a delta. */
  tape: TapeTrade[] | undefined;
  /**
   * WHAT MOVED — the one shared answer (src/domain/market-change), the same
   * object the YES and NO rails read.
   *
   * This used to be two props (an authoritative total) plus a delta lifted off
   * the tape replay: `base: believersTotal − raw.delta`. The totals reconciled
   * with the rails and the MOVEMENT did not, because the rails measured against
   * a snapshot baseline while this measured against a 1000-row trade replay. On
   * a busy market the centre and its own two sides disagreed about the same
   * window, and the comment above the code said so and shipped anyway.
   */
  change?: MarketChange | null;
  ethUsd: number;
  /** The one on-screen timeframe — every total, delta and spark quotes it. */
  win?: FlowWindow;
  nowMs?: number;
  /** The insight + Case File disclosure, rendered inside the same instrument. */
  footer?: ReactNode;
  /** Phone: believers and capital sit side by side so the market fits one screen. */
  dense?: boolean;
  /** Who the participant count is made of — faces beside the Participants label. */
  faces?: MomentumFace[];
  /**
   * The `market_state` facts the Insider needs to read direction and pace
   * (per-side believers and capital, trade counts, price move). Optional: with
   * none of it the read stays calm and balanced rather than inventing movement.
   */
  state?: MarketStateFacts | null;
}) {
  const book = useMemo(() => marketBook(tape ?? [], nowMs, win), [tape, nowMs, win]);
  const { unit } = useDisplayUnit();
  // Null, not zero. A zero here told `capitalMove` that nothing moved — see the
  // unpriced branch in @/domain/metric-display.
  const usd = (eth: number) => convertMoney(eth, "ETH", "USD", ethUsd);
  // Capital is ETH-native; one rate takes it to the viewer's chosen display unit.
  const money: CapFmt = (eth, signed) =>
    formatMoney(eth, { from: "ETH", to: unit, ethUsd, signed });

  // The shared answer where we have it; the tape replay only while it is still
  // in flight, so the panel never opens blank. `base` falling back to `current`
  // means "no history yet" — believerMove/capitalMove then say nothing about a
  // change rather than reporting a fabricated zero.
  const b = fromChange(change?.market.believers, book.believers.market, 1);
  const c = fromChange(change?.market.capital, book.capitalEth.market, ethUsd > 0 ? ethUsd : null);

  /**
   * THE READ, from the Insider — the same facts these two rows print, handed to
   * the one momentum owner. Nothing visual depends on it yet (the figures are
   * unchanged, which is the parity requirement); it names the panel for anyone
   * listening to it, and it is the seam the Case File / House Read adopt next.
   */
  const read = useMemo(
    () => insight(insiderPulse(pulseFactsFromMarket({ book, change, state, ethUsd }))),
    [book, change, state, ethUsd],
  );

  // ONE analytical container: heading → believers → cap → insight → Case File.
  // No floating typography, no nested cards — a single market instrument.
  return (
    <section
      aria-label={`Total market — ${read.headline}`}

      className={`momentum${dense ? " momentum-dense" : ""} shrink-0 overflow-hidden rounded-[16px]`}
      style={{ background: "var(--surface)", border: "1px solid var(--hairline)" }}
    >
      <MomentumMetric
        dense={dense}
        total={b.current.toLocaleString("en-US")}
        label="Total participants"
        copy={believerCopy(b, book.window)}
        faces={faces}
        facesTotal={Math.max(faces?.length ?? 0, Math.round(b.current))}
      />
      <div className="border-t border-[var(--hairline)]" aria-hidden />
      <MomentumMetric
        dense={dense}
        total={money(c.current)}
        label="Total capital"
        copy={capitalCopy(c, book.window, usd, money)}
      />

      {footer && (
        <>
          <div className="border-t border-[var(--hairline)]" aria-hidden />
          {footer}
        </>
      )}
    </section>
  );
}
