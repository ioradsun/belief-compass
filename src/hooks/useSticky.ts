import { useRef } from "react";

/**
 * Keeps the last non-empty value alive so live panels never flash empty while a
 * refetch (or a query-key change) is in flight.
 */
export function useSticky<T>(value: T | undefined, isEmpty: (v: T) => boolean): T | undefined {
  const last = useRef<T | undefined>(undefined);
  if (value !== undefined && !isEmpty(value)) last.current = value;
  return value !== undefined && !isEmpty(value) ? value : last.current;
}

export function useStickyRows<T>(rows: T[] | undefined): T[] {
  return useSticky(rows, (r) => r.length === 0) ?? [];
}
