import { useEffect, useRef, useState } from "react";

/**
 * How many rows of a known height fit in a box that the layout sized for us.
 *
 * The rails never scroll: each section is handed whatever vertical space the
 * panel has left, and the list simply renders as many rows as fit. Because YES
 * and NO are the same height by construction, they resolve to the same count,
 * so the two columns stay aligned without either one measuring the other.
 */
export function useFitRows(rowHeight: number, min = 1, max = 50) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [rows, setRows] = useState(min);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const fit = Math.floor(el.clientHeight / rowHeight);
      setRows(Math.max(min, Math.min(max, fit)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [rowHeight, min, max]);

  return { ref, rows };
}
