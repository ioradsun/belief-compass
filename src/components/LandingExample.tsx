/**
 * The one live-example card on the landing hero.
 *
 * It is deliberately a slice of the real product surface — same fills, same
 * hairlines, same tabular numerals — rather than a marketing illustration. It
 * has to tell one sequence at a glance: someone backed a side early, more
 * people and capital joined that side, the early position became worth more,
 * and it can be sold at any time.
 */
export type LandingExample = {
  question: string;
  yesPeople: number;
  noPeople: number;
  entry: string;
  current: string;
  growth: { label: string; value: string }[];
};

/** Default fixture — identity, disagreement, and "find your people" in one line. */
export const SOCKS_EXAMPLE: LandingExample = {
  question: "Sleeping with socks on should be illegal.",
  yesPeople: 23,
  noPeople: 12,
  entry: "$10.00",
  current: "$23.94",
  growth: [
    { label: "5× more backing", value: "~$47" },
    { label: "20× more backing", value: "~$120" },
    { label: "50× more backing", value: "~$180" },
  ],
};

/** Alternate fixture, kept for future content testing. Never shown alongside the default. */
export const SMILING_EXAMPLE: LandingExample = {
  question: "Did you catch yourself smiling today?",
  yesPeople: 41,
  noPeople: 9,
  entry: "$10.00",
  current: "$18.60",
  growth: [
    { label: "5× more backing", value: "~$38" },
    { label: "20× more backing", value: "~$94" },
    { label: "50× more backing", value: "~$150" },
  ],
};

export function LandingExampleCard({
  example = SOCKS_EXAMPLE,
  onEnter,
}: {
  example?: LandingExample;
  onEnter?: () => void;
}) {
  return (
    <div
      className="w-full max-w-[420px] rounded-[14px] bg-[var(--panel)] p-4 lg:p-5"
      style={{ border: "1px solid var(--hairline)" }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
          Live example
        </span>
        <span className="num text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
          No expiry
        </span>
      </div>

      <p className="mt-2.5 text-[16px] font-semibold leading-snug text-[var(--text)]">
        {example.question}
      </p>

      <div className="mt-3 flex items-center gap-4 text-[12px] text-[var(--text-secondary)]">
        <span>
          <span className="num text-[var(--yes)]">{example.yesPeople}</span> people back YES
        </span>
        <span>
          <span className="num">{example.noPeople}</span> people back NO
        </span>
      </div>

      <div className="mt-3.5 rounded-[10px] bg-[var(--surface)] px-3.5 py-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
          You backed YES early
        </div>
        <div className="mt-2 flex items-end justify-between gap-3">
          <div>
            <div className="text-[11px] text-[var(--text-muted)]">Your entry</div>
            <div className="num text-[15px] text-[var(--text-secondary)]">{example.entry}</div>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-[var(--text-muted)]">Current position</div>
            <div className="num text-[26px] font-semibold leading-none text-[var(--yes)]">
              {example.current}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3.5">
        <div className="text-[11px] font-medium text-[var(--text-secondary)]">
          If more capital backs YES:
        </div>
        <dl className="mt-1.5 space-y-1">
          {example.growth.map((g) => (
            <div
              key={g.label}
              className="flex items-center justify-between text-[12px] text-[var(--text-secondary)]"
            >
              <dt>{g.label}</dt>
              <dd className="num text-[var(--text)]">{g.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onEnter}
          className="h-10 rounded-full bg-[var(--yes)] text-[13px] font-semibold text-[#08130c] transition-opacity hover:opacity-90"
        >
          Back YES
        </button>
        <button
          type="button"
          onClick={onEnter}
          className="h-10 rounded-full bg-[var(--surface-2)] text-[13px] font-semibold text-[var(--text-secondary)] transition-colors hover:text-[var(--text)]"
        >
          Back NO
        </button>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
        Illustrative values only.
      </p>
    </div>
  );
}
