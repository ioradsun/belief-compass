/**
 * THE PERSISTENT SIMULATION BANNER — the mode, said once, everywhere.
 *
 * It sits directly beneath the global header and above the three columns, and it
 * is visible on every screen Simulation touches: browsing, ordering, positions, a
 * match, a Challenge, a post-action receipt. That persistence is what lets every
 * OTHER surface stop repeating the word "Simulation" in every sentence — the
 * banner owns the mode explanation, so the product underneath can go back to
 * speaking normally.
 *
 * THE EXPLANATION IS A DISCLOSURE, NOT A PAGE. A `?` glyph beside the word
 * "Simulation" read like a typo and sent people to a separate sheet to learn six
 * things they could read in six lines. The whole banner is now the control: click
 * it (or the chevron) and the explanation drops down in place, directly under the
 * thing it explains. Nothing navigates, nothing is lost.
 *
 * EXIT IS A BUTTON, NOT A MENU ITEM. One tap, no confirmation, always on screen.
 * A mode you have to go looking for the way out of is a mode you are trapped in,
 * and Simulation's whole promise is that leaving costs nothing.
 */
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useSimulationMode } from "@/lib/simulation-mode";
import { formatCC, SIMULATION_COPY } from "@/domain/simulation";

/** The six lines, in the order a reader asks them. */
const EXPLANATION: string[] = [
  "Real choices. No real money.",
  "Use CC to take positions and build your Conviction profile.",
  "Market prices stay live. Your balance, orders, and positions are simulated.",
  "CC means Conviction Company Units. They have no monetary value.",
  "At 10 convictions, your profile is ready and Simulation ends.",
  "You can leave anytime.",
];

export function SimulationBanner() {
  const sim = useSimulationMode();
  const [open, setOpen] = useState(false);

  // Real Mode renders NOTHING — not an empty bar, not a reserved row. The banner
  // exists only while there is a mode to declare.
  if (!sim.active) return null;

  const graduated = sim.mode === "GRADUATING";
  const progress = `${sim.profileProgress.count} / ${sim.profileProgress.target} convictions`;

  /**
   * TWO ACTS, AND THEY MUST NOT SHARE A HANDLER.
   *
   * `finish` is the graduation — the primary thing to do at ten, and a one-way
   * door the SERVER CAN REFUSE. `leave` is the reversible exit, which it never
   * refuses.
   *
   * They were one function branching on `graduated`, so at ten there was no way
   * to leave at all: every control ran the graduation. Combined with a refusal —
   * a conviction lost after GRADUATING was written — that left somebody who
   * could not finish, could not order, and could not leave either. An exit that
   * can be refused is not an exit.
   */
  const finish = () => {
    setOpen(false);
    sim.continueAfterGraduation();
  };
  const leave = () => {
    setOpen(false);
    sim.exit();
  };

  return (
    <div
      className="w-full shrink-0"
      style={{
        background: "color-mix(in oklab, var(--notice) 10%, var(--bg))",
        borderBottom: "1px solid color-mix(in oklab, var(--notice) 28%, var(--hairline))",
      }}
    >
      <div role="status" aria-live="polite" className="px-4 py-2 lg:px-6">
        {/* ONE INFORMATION SET, TWO SHAPES. Desktop reads as a single line;
            the phone wraps to two compact rows with the same facts in the same
            order, so nothing is dropped to fit — least of all the exit. */}
        <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="simulation-explanation"
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <span
              className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--notice)]"
              style={{ whiteSpace: "nowrap" }}
            >
              {graduated ? "Profile ready" : "Simulation"}
            </span>
            <ChevronDown
              size={14}
              aria-hidden
              className="shrink-0 text-[var(--text-secondary)] transition-transform"
              style={{ transform: open ? "rotate(180deg)" : undefined }}
            />

            <span className="num flex min-w-0 flex-1 items-center gap-2 text-[12px] text-[var(--text-secondary)]">
              {/* The balance is CC and only CC. It is never converted, never shown
                  beside a dollar figure, and never carries a currency symbol. */}
              {!graduated && sim.balanceCc != null && (
                <>
                  <span className="shrink-0 font-semibold text-[var(--text)]">
                    {formatCC(sim.balanceCc)} available
                  </span>
                  <span aria-hidden className="text-[var(--text-muted)]">
                    ·
                  </span>
                </>
              )}
              <span className="shrink-0">{progress}</span>
              <span className="hidden min-w-0 truncate text-[var(--text-muted)] lg:inline">
                {graduated ? SIMULATION_COPY.graduatedSupport : SIMULATION_COPY.bannerSupport}
              </span>
            </span>
          </button>

          <div className="flex shrink-0 items-center gap-2 self-start sm:self-auto">
            {/* AT GRADUATION THE REVERSIBLE EXIT SURVIVES, quietly, beside the
                primary action. Continue can be refused; this cannot, so it is
                the control that guarantees nobody is ever stuck on this screen. */}
            {graduated && (
              <button
                type="button"
                onClick={leave}
                disabled={sim.pending}
                className="h-8 whitespace-nowrap rounded-full px-2 text-[12px] font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--text)] disabled:opacity-50"
              >
                Exit
              </button>
            )}
            <ExitAction
              graduated={graduated}
              pending={sim.pending}
              onClick={graduated ? finish : leave}
            />
          </div>
        </div>

        {sim.error && (
          <p
            className="mx-auto mt-1 w-full max-w-[1400px] text-[11px]"
            style={{ color: "var(--loss)" }}
            role="alert"
          >
            {sim.error}
          </p>
        )}
      </div>

      {open && (
        <div
          id="simulation-explanation"
          className="px-4 pb-3 lg:px-6"
          style={{ borderTop: "1px solid color-mix(in oklab, var(--notice) 18%, var(--hairline))" }}
        >
          <div className="mx-auto w-full max-w-[1400px] pt-3">
            <p className="text-[13px] font-semibold text-[var(--text)]">{EXPLANATION[0]}</p>
            <ul className="mt-1 space-y-1">
              {EXPLANATION.slice(1).map((line) => (
                <li key={line} className="text-[12px] leading-relaxed text-[var(--text-secondary)]">
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * ONE CONTROL, TWO MEANINGS, and they are genuinely different acts. Exiting is
 * reversible and quiet; Continue is the end of Simulation and reads as the
 * primary thing to do next, which is why it carries the solid treatment.
 */
function ExitAction({
  graduated,
  pending,
  onClick,
}: {
  graduated: boolean;
  pending: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="h-8 whitespace-nowrap rounded-full px-3 text-[12px] font-semibold transition-opacity disabled:opacity-50"
      style={
        graduated
          ? { background: "var(--text)", color: "var(--bg)" }
          : {
              border: "1px solid var(--border-strong,var(--border))",
              color: "var(--text-secondary)",
            }
      }
    >
      {graduated ? "Continue to Conviction" : "Exit"}
    </button>
  );
}
