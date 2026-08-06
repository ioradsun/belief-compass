/**
 * MOBILE CASE — the comparison first, a side on demand.
 *
 * WHAT THIS REPLACED. A three-page carousel — NO ← MARKET → YES — where each
 * side page rendered `CaseColumn`, the desktop component, with one prop
 * flipped. Mobile had no design of its own; it was the desktop layout on a
 * smaller screen, and the consequence was worse than cosmetic:
 *
 *   Comparing two sides requires seeing them at once. The carousel put YES and
 *   NO on separate screens WITH THE MARKET BETWEEN THEM, so comparing meant two
 *   swipes and holding numbers in your head. The feature is named "See Both
 *   Sides" and its mobile layout was the one arrangement that prevented it.
 *
 * The shape now answers the five questions a reader actually arrives with, in
 * the order they ask them:
 *
 *   1. WHICH SIDE IS GAINING?  one sentence, above everything
 *   2. WHY?                    the same sentence, then two numbers each
 *   3. WHO IS BACKING IT?      tap a side; the people are the first thing in it
 *   4. EXPLORE SOMEONE?        every believer opens their profile
 *   5. BACK A SIDE?            the dock below, unchanged
 *
 * WHAT WAS REMOVED, and why none of it is missed:
 *
 *   PRICE. On a bonding curve price is a DERIVATIVE of capital — it moves
 *   because capital moved — so showing both showed one fact twice. It answers
 *   none of the five questions; it is an execution detail, and the order dock
 *   already surfaces it at the moment it matters.
 *
 *   THE TIMEFRAME LABEL. It was quoted on the side page and CHOSEN on the
 *   market page: a control you could see and could not reach. Mobile now reads
 *   the shared window silently and says nothing about it.
 *
 *   THE METRIC RADIOGROUP. Three metric rows secretly acting as a chart lens
 *   selector is a desktop interaction — nothing on a phone tells you that
 *   tapping "Capital" redraws the chart below it.
 *
 *   THE SECOND NARRATIVE LINE. A headline plus two prose lines is three
 *   overlapping statements of one fact.
 *
 * Presentation only. The comparison sentence and the strip come from the pure
 * `@/domain/side-compare`; an expanded side reuses `CaseColumn`, so no query
 * key or data path changes.
 */
import { useState } from "react";
import { CaseColumn } from "@/components/CaseFile";
import type { MarketRow } from "@/components/MarketCard";
import type { OrderSide } from "@/domain/order";
import { useMoney } from "@/lib/display-unit";
import { compareSides, comparisonStrip, type Side, type StripSide } from "@/domain/side-compare";

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function MobileCaseView({
  title,
  marketId,
  row,
  viewerWallet,
  ethUsd,
  onClose,
  onBackSide,
  children,
}: {
  title: string;
  marketId: number;
  row: MarketRow;
  viewerWallet?: string;
  ethUsd: number;
  /** Close case mode → return to the neutral market page. */
  onClose: () => void;
  /** Pick a side (the dock below then confirms it). */
  onBackSide: (side: OrderSide) => void;
  /** The neutral market content, shown beneath the comparison. */
  children: React.ReactNode;
}) {
  // Null = comparing. A side = that side is open. There is no third state, and
  // no page you can be "between" — the reason the carousel needed an indicator.
  const [open, setOpen] = useState<Side | null>(null);
  const { format } = useMoney();

  const r = row as unknown as Record<string, unknown>;
  const yes = {
    believers: num(r.believers_yes),
    capitalUsd: numOrNull(r.yes_capital_usd),
    joined: num(r.new_believers_yes_24h),
    // `chg_window_*` is a per-share PRICE change, not a capital one — see
    // SideSnapshot.priceChangePct for why the distinction matters.
    priceChangePct: numOrNull(r.chg_window_yes ?? r.chg_24h_yes),
  };
  const no = {
    believers: num(r.believers_no),
    capitalUsd: numOrNull(r.no_capital_usd),
    joined: num(r.new_believers_no_24h),
    priceChangePct: numOrNull(r.chg_window_no ?? r.chg_24h_no),
  };
  const { story, focus } = compareSides(yes, no);
  const strip = comparisonStrip(yes, no);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The question, and the way out. Both stay put. */}
      <div className="mb-3 flex shrink-0 items-start gap-2">
        <h1 className="min-w-0 flex-1 text-[16px] leading-tight font-semibold tracking-tight text-[var(--text)]">
          {title}
        </h1>
        <button
          type="button"
          onClick={() => (open ? setOpen(null) : onClose())}
          className="-mt-0.5 -mr-1 shrink-0 rounded-full px-2 py-1 text-[12px] font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
          aria-label={open ? "Back to the comparison" : "Close case"}
        >
          {open ? "← Compare" : "× Case"}
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain">
        {open ? (
          /* A SIDE, IN PLACE. The comparison is one tap behind, not a swipe
             through an unrelated page. `CaseColumn` is reused whole — the same
             queries, the same believers, the same tape. */
          <CaseColumn
            side={open}
            marketId={marketId}
            row={row}
            viewerWallet={viewerWallet}
            ethUsd={ethUsd}
            compactRoster
          />
        ) : (
          <>
            {/* 1 — THE STORY. The first thing read, and the thing that makes
                every number below it interpretable. */}
            <p className="text-[15px] leading-snug font-medium text-[var(--text)]">{story}</p>

            {/* 2 — BOTH SIDES, AT ONCE. The entire point: no swipe, no memory. */}
            <div className="space-y-2">
              <ShareBar strip={strip} />
              {strip.map((s) => (
                <SideRow
                  key={s.side}
                  s={s}
                  emphasised={focus === s.side}
                  money={(v) => format(v, "USD")}
                  onOpen={() => setOpen(s.side)}
                />
              ))}
            </div>

            {/* 3 — THE MARKET ITSELF, beneath the comparison rather than between
                the two sides where it used to block them from meeting. */}
            <div className="border-t border-[var(--hairline)] pt-4">{children}</div>
          </>
        )}
      </div>

      {/* The side action appears only inside a side — offering "Back YES" while
          someone is still comparing asks for a decision before the question. */}
      {open && (
        <button
          type="button"
          onClick={() => onBackSide(open)}
          className="mt-3 shrink-0 rounded-[12px] py-3 text-[15px] font-semibold transition-transform active:scale-[0.98] motion-reduce:active:scale-100"
          style={{
            border: `1px solid ${open === "YES" ? "var(--yes)" : "var(--no)"}`,
            color: open === "YES" ? "var(--yes)" : "var(--no)",
          }}
        >
          Back {open}
        </button>
      )}
    </div>
  );
}

/**
 * One bar, split by believers. The share arrives already computed beside the
 * numbers (see `comparisonStrip`) so the bar and the labels beneath it cannot
 * disagree — a bar that says one thing while the count says another is worse
 * than no bar.
 */
function ShareBar({ strip }: { strip: readonly [StripSide, StripSide] }) {
  const [yes, no] = strip;
  return (
    <div className="flex h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]" aria-hidden>
      <span style={{ width: `${yes.share * 100}%`, background: "var(--yes)" }} />
      <span style={{ width: `${no.share * 100}%`, background: "var(--no)" }} />
    </div>
  );
}

/**
 * One side: who is on it, what they have committed, who just arrived.
 *
 * TWO numbers, not five. Believers and capital are the only ones that answer
 * "is this side gaining conviction" — price was a restatement of capital, and
 * a percentage change beside both of them was a fourth way of saying the same
 * sentence already printed above.
 */
function SideRow({
  s,
  emphasised,
  money,
  onOpen,
}: {
  s: StripSide;
  emphasised: boolean;
  money: (v: number) => string;
  onOpen: () => void;
}) {
  const color = s.side === "YES" ? "var(--yes)" : "var(--no)";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-[14px] px-3.5 py-3 text-left transition-colors active:bg-[var(--surface-2)]"
      style={{
        background: "var(--surface)",
        // Emphasis, not decoration: the side the story is about gets the edge
        // the eye lands on first. Never a border on both — that is just a box.
        border: emphasised ? `1px solid ${color}` : "1px solid var(--border)",
      }}
    >
      <span className="w-[34px] shrink-0 text-[13px] font-semibold tracking-wide" style={{ color }}>
        {s.side}
      </span>

      <span className="min-w-0 flex-1">
        <span className="num block text-[17px] leading-none font-semibold text-[var(--text)]">
          {s.believers.toLocaleString("en-US")}
          <span className="ml-1.5 text-[11px] font-normal text-[var(--text-muted)]">
            {s.believers === 1 ? "believer" : "believers"}
          </span>
        </span>
        <span className="num mt-1 block text-[12px] text-[var(--text-secondary)]">
          {s.capitalUsd != null && s.capitalUsd > 0 ? money(s.capitalUsd) : "—"}
          {/* Arrivals only when there ARE any: "+0 today" is noise wearing the
              costume of an update. */}
          {s.joined > 0 && (
            <span className="ml-2" style={{ color }}>
              +{s.joined} today
            </span>
          )}
        </span>
      </span>

      <span className="shrink-0 text-[var(--text-muted)]" aria-hidden>
        ›
      </span>
    </button>
  );
}
