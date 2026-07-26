/**
 * Build identifier used for cache-busting.
 *
 * At build time Vite inlines `import.meta.env.VITE_BUILD_ID` — we set it in
 * `vite.config.ts` `define` to a fresh timestamp per build. In dev it falls back
 * to the string "dev", which the VersionWatcher treats as "don't reload".
 */
export const BUILD_ID: string =
  (import.meta.env.VITE_BUILD_ID as string | undefined) ?? "dev";
