import type { ReactNode } from "react";
import { BrandMark } from "@/components/BrandMark";

/**
 * The shared chrome for the standalone reading pages (How it works, Why it
 * matters, Terms & risk). One header, one way out: the same "✕ Close" pill in
 * the same place, so leaving never depends on which page you happen to be on.
 */
export function InfoPageHeader({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <header
      className="sticky top-0 z-30 w-full bg-[var(--panel)]/95 backdrop-blur"
      style={{ borderBottom: "1px solid var(--border)" }}
    >
      <div className="mx-auto flex h-14 w-full max-w-[1180px] items-center gap-3 px-4 lg:px-8">
        <a href="/" className="flex min-w-0 items-center gap-2 text-[var(--text)]" aria-label="Conviction">
          <BrandMark size={22} className="shrink-0" />
          <span className="truncate text-[13px] font-semibold tracking-[-0.01em]">Conviction</span>
        </a>
        <span className="hidden truncate text-[12px] text-[var(--text-muted)] sm:inline">
          · {label}
        </span>
        <a
          href="/"
          className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--text)] px-4 py-1.5 text-[12px] font-semibold text-[var(--bg)] transition-opacity hover:opacity-90"
        >
          <span aria-hidden>✕</span> Close
        </a>
      </div>
      {children}
    </header>
  );
}
