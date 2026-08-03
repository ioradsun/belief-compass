/**
 * "See how it works" — a compact three-step sheet, not a page.
 *
 * It exists so the hero can stay short: anyone who needs the mechanic can get
 * it in three sentences without leaving the landing surface.
 */
const STEPS = [
  {
    title: "Back a side",
    body: "Choose YES or NO on a live belief.",
  },
  {
    title: "Demand moves the position",
    body: "As more people and capital back your side, its price can rise.",
  },
  {
    title: "Exit whenever you choose",
    body: "Markets do not expire or resolve. Sell your position whenever you choose.",
  },
];

export function HowItWorksSheet({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="How Conviction Company works"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[440px] rounded-[16px] bg-[var(--panel)] p-6"
        style={{ border: "1px solid var(--hairline)" }}
        onClick={(e) => e.stopPropagation()}
        role="presentation"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-[19px] font-semibold tracking-[-0.01em] text-[var(--text)]">
            How it works
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 grid h-8 w-8 place-items-center rounded-full text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
          >
            ✕
          </button>
        </div>

        <ol className="mt-4 space-y-3.5">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-3">
              <span className="num mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--surface-2)] text-[12px] text-[var(--text-secondary)]">
                {i + 1}
              </span>
              <div className="min-w-0">
                <div className="text-[14px] font-medium text-[var(--text)]">{s.title}</div>
                <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <p
          className="mt-5 pt-4 text-[12px] leading-relaxed text-[var(--text-muted)]"
          style={{ borderTop: "1px solid var(--hairline)" }}
        >
          Your result depends on your entry price, changing demand, the market curve, fees, and when
          you sell.
        </p>
      </div>
    </div>
  );
}
