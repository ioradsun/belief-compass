/**
 * Build identifier used for cache-busting.
 *
 * At build time Vite inlines `import.meta.env.VITE_BUILD_ID` — we set it in
 * `vite.config.ts` `define` to a fresh timestamp per build.
 *
 * IN DEV IT MUST BE "dev". That `define` fires in dev too, so the value used to
 * be a fresh timestamp there as well — and the dev/preview server re-evaluates
 * its config on every restart. A tab holding the previous timestamp then
 * disagreed with the server the moment it mounted or regained focus, and
 * VersionWatcher hard-reloaded the page: the preview appeared to start, revert,
 * and start over. Dev has HMR; it never needs a version reload.
 */
export const BUILD_ID: string = import.meta.env.DEV
  ? "dev"
  : ((import.meta.env.VITE_BUILD_ID as string | undefined) ?? "dev");
