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
 * EXIT IS A BUTTON, NOT A MENU ITEM. One tap, no confirmation, always on screen.
 * A mode you have to go looking for the way out of is a mode you are trapped in,
 * and Simulation's whole promise is that leaving costs nothing.
 *
 * THE `?` IS ALSO ALWAYS THERE. Somebody seeing a balance in a unit they have
 * never heard of should never have to hunt for what it means.
 */
import { useState } from "react";
import { SimulationHelpSheet } from "@/components/SimulationHelpSheet";
import { useSimulationMode } from "@/lib/simulation-mode";
import { formatCC, SIMULATION_COPY } from "@/domain/simulation";

/** The round `?` beside the mode label. */
function HelpButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="What is Simulation?"
      className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-[var(--text-secondary)] transition-colors hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text)]"
      style={{ border: "1px solid var(--border-strong,var(--border))" }}
    >
      ?
    </button>
  );
}

export function SimulationBanner() {
  const sim = useSimulationMode();
  const [helpOpen, setHelpOpen] = useState(false);

  // Real Mode renders NOTHING — not an empty bar, not a reserved row. The banner
  // exists only while there is a mode to declare.
  if (!sim.active) return null;

  const graduated = sim.mode === "GRADUATING";
  const progress = `${sim.profileProgress.count} / ${sim.profileProgress.target} convictions`;

  const leave = () => {
    setHelpOpen(false);
    if (graduated) sim.continueAfterGraduation();
    else sim.exit();
  };

  return (
    <>
      <div
        role="status"
        aria-live="polite"
        className="w-full shrink-0 px-4 py-2 lg:px-6"
        style={{
          background: "color-mix(in oklab, var(--notice) 10%, var(--bg))",
          borderBottom: "1px solid color-mix(in oklab, var(--notice) 28%, var(--hairline))",
        }}
      >
        {/* ONE INFORMATION SET, TWO SHAPES. Desktop reads as a single line;
            the phone wraps to two compact rows with the same facts in the same
            order, so nothing is dropped to fit — least of all the exit. */}
        <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--notice)]"
              style={{ whiteSpace: "nowrap" }}
            >
              {graduated ? "Profile ready" : "Simulation"}
            </span>
            <HelpButton onClick={() => setHelpOpen(true)} />

            {/* The phone puts the action on the first row, opposite the label. */}
            <div className="ml-auto sm:hidden">
              <ExitAction graduated={graduated} pending={sim.pending} onClick={leave} />
            </div>
          </div>

          <div className="num flex min-w-0 flex-1 items-center gap-2 text-[12px] text-[var(--text-secondary)]">
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
          </div>

          <div className="hidden shrink-0 sm:block">
            <ExitAction graduated={graduated} pending={sim.pending} onClick={leave} />
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

      {helpOpen && <SimulationHelpSheet onClose={() => setHelpOpen(false)} onExit={leave} />}
    </>
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
