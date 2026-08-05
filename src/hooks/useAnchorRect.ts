/**
 * Measure the horizontal footprint of the container an overlay springs from, so
 * a sheet opens over ITS column instead of hijacking the whole viewport. The
 * rect is re-read on resize and scroll while the overlay is open.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type AnchorBox = { left: number; width: number };

export function useAnchorRect<T extends HTMLElement>(open: boolean) {
  const ref = useRef<T | null>(null);
  const [box, setBox] = useState<AnchorBox | null>(null);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setBox({ left: r.left, width: r.width });
  }, []);

  useEffect(() => {
    if (!open) return;
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, measure]);

  return { ref, box } as const;
}

/** Fixed-position style constrained to the anchor column (full width fallback). */
export function anchorStyle(box: AnchorBox | null): React.CSSProperties {
  return box ? { left: box.left, width: box.width } : { left: 0, right: 0 };
}
