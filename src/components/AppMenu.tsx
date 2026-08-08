import { Link } from "@tanstack/react-router";

export type AppTab = "mine" | "belief" | "room";

export const APP_TABS: { key: AppTab; label: string; sub: string }[] = [
  { key: "mine", label: "Mine", sub: "where you stand, and why" },
  { key: "belief", label: "Back", sub: "one belief, right now" },
  { key: "room", label: "Crowd", sub: "what's moving, and who's behind it" },
];

/** The standing pages, reachable from the menu like everything else. */
export const MENU_PAGES: { to: string; label: string; sub: string }[] = [
  { to: "/how", label: "How it works", sub: "the idea, in plain language" },
  { to: "/value", label: "Why it matters", sub: "what this adds to the ecosystem" },
  { to: "/terms", label: "Terms & risk", sub: "what you're agreeing to" },
];

/**
 * ONE MENU, EVERY PAGE. The feed and the standing reading pages open the exact
 * same drawer with the exact same items in the exact same order, so "where am I
 * and how do I get somewhere else" is answered identically wherever you are.
 *
 * The two hosts differ only in how a tab is honoured: on the feed it switches
 * the visible column in place; on a reading page it navigates back to the feed
 * carrying the tab. Both go through `onSelectTab`.
 */
export function AppMenu({
  open,
  onClose,
  tab,
  onSelectTab,
  onHome,
  openCalls = 0,
  currentPath,
}: {
  open: boolean;
  onClose: () => void;
  /** Active column, when the host is the feed. */
  tab?: AppTab;
  onSelectTab: (t: AppTab) => void;
  onHome: () => void;
  openCalls?: number;
  /** Active route, when the host is a standing page. */
  currentPath?: string;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className="absolute inset-0 bg-black/60"
      />
      <div
        className="absolute inset-y-0 left-0 w-72 overflow-y-auto bg-[var(--panel)] p-4"
        style={{ borderRight: "1px solid var(--hairline)" }}
      >
        <div className="mb-4 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Menu
        </div>
        <div className="space-y-1">
          {/* HOME — the intro and an example. A destination in the menu like
              anything else, so the header stays a plain header. */}
          <button
            type="button"
            onClick={onHome}
            className="flex w-full items-start gap-2 rounded-md px-3 py-2.5 text-left"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-[var(--text-muted)]">Home</span>
              <span className="mt-0.5 block text-[12px] leading-snug text-[var(--text-muted)]">
                the intro, and an example
              </span>
            </span>
          </button>

          {APP_TABS.map((t) => {
            const current = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => onSelectTab(t.key)}
                aria-current={current ? "page" : undefined}
                className={`flex w-full items-start gap-2 rounded-md px-3 py-2.5 text-left ${
                  current ? "bg-[var(--surface)]" : ""
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span
                    className={`block text-sm font-medium ${
                      current ? "text-[var(--text)]" : "text-[var(--text-muted)]"
                    }`}
                  >
                    {t.label}
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-snug text-[var(--text-muted)]">
                    {t.sub}
                  </span>
                </span>
                {/* Somebody is waiting on this reader — the same count the
                    Challenge rail renders from, surfaced where a phone can see
                    it without going looking. */}
                {t.key === "room" && openCalls > 0 && (
                  <span
                    className="num rounded-full px-1.5 py-0.5 text-[11px] font-semibold"
                    style={{ background: "var(--surface-2)", color: "var(--text)" }}
                    aria-label={`${openCalls} people want your take`}
                  >
                    {openCalls}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* The standing pages. Real routes, not panels, so they live below a
            rule rather than among the three views. */}
        <div className="mt-4 space-y-1 pt-3" style={{ borderTop: "1px solid var(--hairline)" }}>
          {MENU_PAGES.map((p) => {
            const current = currentPath === p.to;
            return (
              <Link
                key={p.to}
                to={p.to}
                onClick={onClose}
                aria-current={current ? "page" : undefined}
                className={`block rounded-md px-3 py-2.5 text-left ${
                  current ? "bg-[var(--surface)]" : ""
                }`}
              >
                <span
                  className={`block text-sm font-medium ${
                    current ? "text-[var(--text)]" : "text-[var(--text-muted)]"
                  }`}
                >
                  {p.label}
                </span>
                <span className="mt-0.5 block text-[12px] leading-snug text-[var(--text-muted)]">
                  {p.sub}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
