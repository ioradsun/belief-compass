import * as React from "react";
import { startTransition } from "react";

const MOBILE_BREAKPOINT = 768;
/** Matches the `lg` breakpoint where the layout becomes three side-by-side columns. */
const DESKTOP_BREAKPOINT = 1024;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}

/**
 * True at the `lg` breakpoint and up — where the three-column layout (and thus the
 * desktop-only Case File) applies. Defaults to true so SSR + the first client paint
 * assume desktop (desktop behavior never flashes); a phone corrects to false on mount.
 */
export function useIsDesktop() {
  const [isDesktop, setIsDesktop] = React.useState(true);

  React.useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`);
    const onChange = () => setIsDesktop(window.innerWidth >= DESKTOP_BREAKPOINT);
    mql.addEventListener("change", onChange);
    onChange();
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isDesktop;
}
