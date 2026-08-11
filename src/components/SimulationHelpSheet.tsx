/**
 * WHAT SIMULATION IS — six short answers, and no tutorial.
 *
 * The temptation with a mode this different is to explain it: a carousel, a
 * walkthrough, a wall of terms. All of those teach the EXPLANATION rather than
 * the product, and the product is the thing somebody came to learn. So this
 * answers only the questions a reader actually has in front of a screen that is
 * behaving strangely — what is real, what is not, what CC means, what counts,
 * when it ends — and then gets out of the way.
 *
 * It reuses the shared `Sheet`: portalled above the app, Escape to close, one
 * close action, identical on desktop and mobile. A second sheet implementation
 * would be a second set of those behaviours to keep in step.
 */
import { Sheet } from "@/components/Sheet";
import { CC_DEFINITION, SIMULATION_COPY } from "@/domain/simulation";

/** One question and its answer. The heading is the question a reader has. */
function Answer({ q, a }: { q: string; a: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
        {q}
      </h3>
      <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-secondary)]">{a}</p>
    </div>
  );
}

export function SimulationHelpSheet({
  onClose,
  onExit,
}: {
  onClose: () => void;
  /** Leaving from inside the explanation — the same one-tap exit as the banner. */
  onExit: () => void;
}) {
  return (
    <Sheet title="Simulation" onClose={onClose}>
      <p className="mb-5 text-[15px] font-semibold leading-snug text-[var(--text)]">
        {SIMULATION_COPY.purpose}
      </p>

      <Answer
        q="Why it exists"
        a="Conviction needs enough real choices to understand what you believe and find people you match with."
      />
      <Answer
        q="What is simulated"
        a="Your balance, orders, and positions are simulated. Market prices remain live."
      />
      {/* The definition is imported rather than typed here: it is the one sentence
          that must never be paraphrased into a claim about value. */}
      <Answer q="What CC means" a={CC_DEFINITION} />
      <Answer
        q="What counts"
        a="A completed Simulation position counts toward your first 10 convictions and helps shape your matches."
      />
      <Answer
        q="When it ends"
        a="Simulation ends when you reach 10 convictions. You can exit at any time."
      />

      <div className="mt-6 mb-2 flex flex-col gap-2">
        <button
          type="button"
          onClick={onClose}
          className="h-[52px] w-full rounded-[12px] text-[15px] font-semibold"
          style={{ background: "var(--text)", color: "var(--bg)" }}
        >
          Got it
        </button>
        <button
          type="button"
          onClick={onExit}
          className="h-[44px] w-full rounded-[12px] text-[13px] font-semibold text-[var(--text-secondary)] transition-colors hover:text-[var(--text)]"
          style={{ border: "1px solid var(--border)" }}
        >
          Exit Simulation
        </button>
      </div>
    </Sheet>
  );
}
