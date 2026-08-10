/**
 * THE ONE FILTER SHAPE — a colour-led menu, not a row of words.
 *
 * IT WAS ALREADY THE ANSWER; IT JUST HAD ONE OWNER. `NetworkPanel` grew this to
 * pick a region of the Tribe↔Rival continuum, and every decision in it was made
 * for the general case rather than for people: a dot that carries the meaning, a
 * chevron, a click-away close, `role="listbox"` with `aria-selected`. The Insider
 * column needed the same control for a different question, and the alternative
 * was a second implementation that would drift — a different close behaviour
 * here, a missing aria role there.
 *
 * WHY A DOT AND NOT WORDS. Both places this renders sit on a crowded row beside
 * something that matters more (a search box; the update pill). A two-word label
 * would be the widest thing on the line and would say what the list underneath
 * already says. The dot carries the state, the menu carries the names.
 *
 * The caller owns the vocabulary — its own ids, labels and colours — so nothing
 * about one surface's meaning leaks into another's.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

export interface DotOption<T extends string> {
  id: T;
  label: string;
  /** Any CSS background: a token, a colour, or a gradient across a continuum. */
  dot: string;
}

export function DotFilter<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  align = "right",
}: {
  value: T;
  options: readonly DotOption<T>[];
  onChange: (v: T) => void;
  /** Spoken as "<ariaLabel>: <current label>" — the caller names the question. */
  ariaLabel: string;
  /** Which edge the menu hangs from. Left when the control sits on the left. */
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const current = options.find((o) => o.id === value) ?? options[0];
  if (!current) return null;

  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${ariaLabel}: ${current.label}`}
        className="flex items-center gap-1.5 rounded-md bg-[var(--surface)] px-2 py-1.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:text-[var(--text)]"
        style={{ border: "1px solid var(--border)" }}
      >
        <span
          aria-hidden
          className="h-2.5 w-2.5 rounded-full"
          style={{ background: current.dot }}
        />
        <span aria-hidden className="text-[9px] leading-none">
          ▾
        </span>
      </button>
      {open && (
        <ul
          role="listbox"
          className={`absolute z-30 mt-1 w-[150px] overflow-hidden rounded-[10px] py-1 shadow-lg ${
            align === "left" ? "left-0" : "right-0"
          }`}
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        >
          {options.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                role="option"
                aria-selected={o.id === value}
                onClick={() => {
                  onChange(o.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12.5px] transition-colors hover:bg-[var(--bg)] ${
                  o.id === value ? "text-[var(--text)]" : "text-[var(--text-secondary)]"
                }`}
              >
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: o.dot }}
                />
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Convenience for callers that want the menu's own label text elsewhere. */
export function dotLabel<T extends string>(options: readonly DotOption<T>[], value: T): ReactNode {
  return options.find((o) => o.id === value)?.label ?? null;
}
