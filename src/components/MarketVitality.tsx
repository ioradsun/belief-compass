/**
 * CENTER — Market Momentum: the timeless read of "how big and which way?"
 *
 * Two compact metric rows — believers and capital (total · percentage change) —
 * plus the exact absolute move over the selected timeframe. No charts here: the
 * shape of the move lives in the Case File. This is the only momentum surface;
 * the story (the narrative sentence, the House voice, the activity) lives in the
 * right feed. The center never becomes a feed.
 *
 * Every number is read off the canonical marketBook, so the totals reconcile with
 * the side panels; the label comes from marketPulse — existing calculations,
 * unchanged. Side-blind by construction. The SAME component renders on desktop and
 * mobile; only the layout changes.
 */
import { useMemo, type ReactNode } from "react";
import { PersonAvatar } from "@/components/PersonAvatar";
import { marketBook, type BookMetric, type BookWindow } from "@/domain/market-book";
import type { TapeTrade } from "@/domain/conviction-series";
import type { FlowWindow } from "@/domain/market-flow";
import { formatMoney } from "@/domain/money";
import { useDisplayUnit } from "@/lib/display-unit";
import { believerMove, capitalMove, type MetricMove } from "@/domain/metric-display";
import type { MarketChange, MetricChange } from "@/domain/market-change";

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
  usd: (eth: number) => number,
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
  if (shown.length === 0 && !summary) return null;
  const size = dense ? 22 : 26;
  return (
    <div className={dense ? "mt-1.5" : "mt-2"}>
      {shown.length > 0 && (
        <div className="flex items-center gap-1.5">
          <div className="flex -space-x-1.5">
            {shown.map((f) => (
              <PersonAvatar
                key={f.wallet}
                wallet={f.wallet}
                name={f.name}
                avatarUrl={f.avatarUrl}
                size={size}
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
        <div className={`${shown.length > 0 ? "mt-1" : ""} text-[11px] text-[var(--text-muted)]`}>
          {summary}
        </div>
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
  const tone = dirTone(copy.direction);
  const arrow = copy.direction === "up" ? "▲" : copy.direction === "down" ? "▼" : "";
  // Only a trusted (headline) % earns the big right-hand figure. A small-base %
  // is demoted to a quiet suffix on the absolute line so it never overstates the
  // move; with no % at all the headline space stays empty.
  const headlinePct = copy.pct ?? (copy.direction === "flat" ? "0%" : "");
  return (
    <div className={dense ? "px-4 py-2" : "px-4 py-3 sm:px-5"}>
      <div className="flex items-baseline justify-between gap-4">
        <span
          className={`num min-w-0 truncate font-semibold leading-none tracking-[-0.02em] text-[var(--text)] ${dense ? "text-[21px]" : "text-[26px] sm:text-[30px]"}`}
        >
          {total}
        </span>
        <span
          className={`num shrink-0 font-semibold leading-none tabular-nums ${dense ? "text-[18px]" : "text-[22px] sm:text-[26px]"}`}
          style={{ color: tone }}
        >
          {headlinePct}
          {arrow && headlinePct ? (
            <span className="ml-1.5 text-[0.6em] align-middle">{arrow}</span>
          ) : null}
        </span>
      </div>
      <div className={`${dense ? "mt-1" : "mt-1.5"} flex items-center justify-between gap-3`}>
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
          {label}
        </span>
      </div>
      {/* People before statistics: when this metric has faces, the space under
      the label belongs to them, not to a restatement of the move. */}
      {faces ? (
        <ParticipantProof faces={faces} total={facesTotal ?? faces.length} dense={dense} />
      ) : (
        <div
          className={`num mt-0.5 ${dense ? "text-[11px]" : "text-[12px]"}`}
          style={{ color: tone }}
        >
          {copy.absolute}
        </div>
      )}
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
}) {
  const book = useMemo(() => marketBook(tape ?? [], nowMs, win), [tape, nowMs, win]);
  const { unit } = useDisplayUnit();
  const usd = (eth: number) => eth * (ethUsd > 0 ? ethUsd : 0);
  // Capital is ETH-native; one rate takes it to the viewer's chosen display unit.
  const money: CapFmt = (eth, signed) =>
    formatMoney(eth, { from: "ETH", to: unit, ethUsd, signed });

  // The shared answer where we have it; the tape replay only while it is still
  // in flight, so the panel never opens blank. `base` falling back to `current`
  // means "no history yet" — believerMove/capitalMove then say nothing about a
  // change rather than reporting a fabricated zero.
  const b = fromChange(change?.market.believers, book.believers.market, 1);
  const c = fromChange(change?.market.capital, book.capitalEth.market, ethUsd > 0 ? ethUsd : null);

  // ONE analytical container: heading → believers → cap → insight → Case File.
  // No floating typography, no nested cards — a single market instrument.
  return (
    <section
      aria-label="Total market"
      className="shrink-0 overflow-hidden rounded-[16px]"
      style={{ background: "var(--surface)", border: "1px solid var(--hairline)" }}
    >
      <div
        className={`${dense ? "px-4 pt-2" : "px-4 pt-3 sm:px-5"} text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]`}
      >
        Total market
      </div>
      <MomentumMetric
        dense={dense}
        total={b.current.toLocaleString("en-US")}
        label="Participants"
        copy={believerCopy(b, book.window)}
        faces={faces}
        facesTotal={Math.max(faces?.length ?? 0, Math.round(b.current))}
      />
      <div className="border-t border-[var(--hairline)]" aria-hidden />
      <MomentumMetric
        dense={dense}
        total={money(c.current)}
        label="Capital"
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
