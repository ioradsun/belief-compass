/**
 * COLLAPSIBLE — a block that changes height without anything jumping.
 *
 * THE PROBLEM IT SOLVES. The right rail is a flex column: three blocks that come
 * and go, stacked above a `flex-1` live tape. Any one of them appearing,
 * disappearing or reflowing instantly re-lays-out everything below it — the
 * "Insider" heading moves, the tape's viewport resizes, and the row the reader was
 * looking at is somewhere else. `if (count === 0) return null` is the sharpest
 * version: switch markets and a whole card blinks out of existence, taking 60px
 * of the column with it in a single frame.
 *
 * A JUMP IS A DISCONTINUITY, NOT A MOVEMENT. Things are allowed to move — this
 * is a live product and space has to be shared. What a reader cannot follow is
 * teleportation: 60px vanishing between two frames with nothing connecting the
 * before and the after. So the rule here is not "never resize", it is "never
 * resize instantly". Every height change is interpolated, and the eye tracks it.
 *
 * HOW, and why this way. `grid-template-rows: 0fr → 1fr` animates a block
 * between zero and its OWN INTRINSIC HEIGHT with no JavaScript at all:
 *
 *   • No measurement, so no ResizeObserver, no layout thrash, no reflow on every
 *     frame of the animation.
 *   • No pinned pixel height, so content that grows mid-animation (a second line
 *     of text arriving) is simply followed rather than clipped or fought.
 *   • No `max-height` guess, which is the usual hack and is always either too
 *     small (clips) or too large (animates a phantom gap at the wrong speed).
 *
 * REDUCED MOTION IS NOT "NO TRANSITION". A reader who asks for less motion still
 * needs to not be teleported; they need the change to be *instant and complete*
 * rather than animated. `motion-reduce:transition-none` gives exactly that — the
 * layout still resolves correctly, it just resolves at once.
 *
 * THE CONTENT STAYS MOUNTED while collapsed, which is deliberate: unmounting is
 * what throws away scroll position, input state and query observers, and a
 * collapsed block that remembers where it was is the difference between hiding
 * something and destroying it. `inert` + `aria-hidden` keep it out of the
 * keyboard order and the accessibility tree, so "invisible" is honest.
 */
import type { ReactNode } from "react";

/**
 * How long a height change takes.
 *
 * Long enough to read as one continuous movement, short enough that a reader
 * heading for a control is not waiting on it. Matches the scene fade the centre
 * column already uses, so the two rails move at the same speed rather than
 * arriving at slightly different times.
 */
export const COLLAPSE_MS = 200;

export function Collapsible({
  open,
  children,
  className = "",
  /** Marks the animating element for the layout probe (scripts/measure-rail). */
  probe,
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
  probe?: string;
}) {
  return (
    <div
      data-probe={probe}
      data-open={open ? "" : undefined}
      // `grid` + a single row is the whole mechanism. The row is 0fr closed and
      // 1fr open; `1fr` on a grid row resolves to the content's intrinsic size,
      // which is why this needs no measured pixel value.
      className={`grid transition-[grid-template-rows] ease-out motion-reduce:transition-none ${className}`}
      style={{
        gridTemplateRows: open ? "1fr" : "0fr",
        transitionDuration: `${COLLAPSE_MS}ms`,
      }}
    >
      {/*
       * `min-h-0` is load-bearing. A grid item's default `min-height: auto`
       * refuses to shrink below its content, so without this the row would
       * never actually reach zero and the block would leave a ghost behind.
       */}
      <div
        className="min-h-0 overflow-hidden"
        // Not focusable and not announced while collapsed. Without this a
        // reader tabbing through the rail lands inside a block they cannot see.
        inert={!open ? true : undefined}
        aria-hidden={!open || undefined}
      >
        {children}
      </div>
    </div>
  );
}
