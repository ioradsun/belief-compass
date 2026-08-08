import { useState, type ReactNode } from "react";
import { useCanGoBack, useRouter } from "@tanstack/react-router";
import { BrandMark } from "@/components/BrandMark";

/** The standing pages, same list and same order as the phone menu on the feed. */
const PAGES: { to: string; label: string; sub: string }[] = [
  { to: "/how", label: "How it works", sub: "the idea, in plain language" },
  { to: "/value", label: "Why it matters", sub: "what this adds to the ecosystem" },
  { to: "/terms", label: "Terms & risk", sub: "what you're agreeing to" },
];

/**
 * The shared chrome for the standalone reading pages (How it works, Why it
 * matters, Terms & risk). ONE header everywhere: brand on the left, the same
 * menu icon on the right. There is no "✕ Close" pill — leaving is the menu's
 * job (Back to Conviction) or the browser's, so the control set matches the
 * feed instead of teaching a second way out.
 */
export function InfoPageHeader({ label, children }: { label: string; children?: ReactNode }) {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const [menuOpen, setMenuOpen] = useState(false);

  const here = router.state.location.pathname;

  const back = () => {
    setMenuOpen(false);
    if (canGoBack) router.history.back();
    else router.navigate({ to: "/" });
  };

  return (
    <>
      <header
        className="sticky top-0 z-30 w-full bg-[var(--panel)]/95 backdrop-blur"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <div className="mx-auto flex h-14 w-full max-w-[1180px] items-center gap-3 px-4 lg:px-8">
          <a
            href="/"
            className="flex min-w-0 items-center gap-2 text-[var(--text)]"
            aria-label="Conviction"
          >
            <BrandMark size={22} className="shrink-0" />
            <span className="truncate text-[13px] font-semibold tracking-[-0.01em]">Conviction</span>
          </a>
          <span className="hidden truncate text-[12px] text-[var(--text-muted)] sm:inline">
            · {label}
          </span>
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            className="ml-auto grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[var(--border)] text-[var(--text)]"
          >
            <span className="space-y-1">
              <span className="block h-px w-4 bg-current" />
              <span className="block h-px w-4 bg-current" />
              <span className="block h-px w-4 bg-current" />
            </span>
          </button>
        </div>
        {children}
      </header>

      {menuOpen && (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
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
              <button
                type="button"
                onClick={back}
                className="flex w-full items-start gap-2 rounded-md px-3 py-2.5 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-[var(--text)]">
                    Back to Conviction
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-snug text-[var(--text-muted)]">
                    where you left off
                  </span>
                </span>
              </button>

              {PAGES.map((p) => {
                const current = here === p.to;
                return (
                  <a
                    key={p.to}
                    href={p.to}
                    onClick={() => setMenuOpen(false)}
                    aria-current={current ? "page" : undefined}
                    className={`flex w-full items-start gap-2 rounded-md px-3 py-2.5 text-left ${
                      current ? "bg-[var(--surface)]" : ""
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block text-sm font-medium ${current ? "text-[var(--text)]" : "text-[var(--text-muted)]"}`}
                      >
                        {p.label}
                      </span>
                      <span className="mt-0.5 block text-[12px] leading-snug text-[var(--text-muted)]">
                        {p.sub}
                      </span>
                    </span>
                  </a>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
