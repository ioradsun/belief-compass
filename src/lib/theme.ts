/**
 * Theme — dark (default) or light.
 *
 * Dark is the base palette in styles.css; light is a `.light` class on <html>
 * that overrides the same tokens. Every surface in the app already reads those
 * tokens, so flipping the class re-themes the whole product with no re-render.
 * The choice is remembered in localStorage and applied by a tiny inline script
 * before first paint (see THEME_INIT_SCRIPT) so there is never a flash.
 */
import { useSyncExternalStore } from "react";

export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "conviction:theme";

/** Runs in <head> before paint: applies the stored theme with zero flash. */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==='light'){document.documentElement.classList.add('light');}else{document.documentElement.classList.remove('light');}}catch(e){}})();`;

type Cell = { current: Theme; listeners: Set<() => void> };
const g = globalThis as unknown as { __convictionTheme?: Cell };

function read(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("light") ? "light" : "dark";
}

const cell: Cell = (g.__convictionTheme ??= { current: read(), listeners: new Set() });

export function setTheme(theme: Theme) {
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("light", theme === "light");
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      /* storage unavailable — the session still themes correctly */
    }
  }
  if (cell.current === theme) return;
  cell.current = theme;
  for (const l of cell.listeners) l();
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (cb) => {
      cell.listeners.add(cb);
      return () => cell.listeners.delete(cb);
    },
    () => cell.current,
    () => "dark" as Theme,
  );
}
