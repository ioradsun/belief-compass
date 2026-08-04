/**
 * MARKET SCENE — the persistent stage the market's information changes inside.
 *
 * The shell (header, rails, column geometry, the dock's position) is structural
 * and stays mounted for the life of the page. This wrapper is the one place a
 * market change is allowed to be *visible* as motion, and it treats the whole
 * market as ONE scene: a single short fade with a few pixels of directional
 * travel, played once on the content as a group.
 *
 * Deliberately NOT here:
 *   • a `key` on the market id — that would remount the scene, which is the
 *     thing this whole design is avoiding.
 *   • per-statistic animation. Numbers changing is information, not an event.
 *   • anything that animates layout (height/width/top/margin). Only `transform`
 *     and `opacity`, so a transition costs compositing and never layout.
 *
 * The class is removed as soon as the animation ends, so the wrapper does not
 * keep a `transform` — a permanent transform would make this element the
 * containing block for any fixed-position descendant (share sheets, menus).
 */
import { useEffect, useRef, type ReactNode } from "react";

export function MarketScene({
  /** The market actually being displayed — NOT the one being navigated to. */
  marketId,
  children,
  className = "",
}: {
  marketId: number | null;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const shown = useRef<number | null>(marketId);

  useEffect(() => {
    if (shown.current === marketId) return;
    shown.current = marketId;
    const el = ref.current;
    if (!el) return;
    // Restart the animation even when one is already running: a rapid sequence
    // of markets plays one enter per arrival instead of stacking them.
    el.classList.remove("scene-enter");
    void el.offsetWidth; // force reflow so the removed animation can replay
    el.classList.add("scene-enter");
  }, [marketId]);

  return (
    <div
      ref={ref}
      onAnimationEnd={() => ref.current?.classList.remove("scene-enter")}
      className={`flex min-h-0 flex-1 flex-col ${className}`}
    >
      {children}
    </div>
  );
}
