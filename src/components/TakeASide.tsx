/**
 * BUILD YOUR PROFILE — the first-run brief, and the door into Simulation.
 *
 * A new reader's problem is not "what is happening in this market", it is "what
 * am I supposed to DO here". So for the first ten convictions this card takes the
 * top of the Explore rail — the spot Market Insider holds later — and says the one
 * thing that matters: take sides, ten times, on your own reasons. And for the
 * reader who is not ready to put money behind those sides, it offers the way to
 * take them anyway.
 *
 * IT COUNTS THE CANONICAL NUMBER NOW. It used to count real positions with live
 * shares, which meant a conviction somebody had taken and since closed vanished
 * from their progress, and a completed Simulation position never appeared in it
 * at all — the card would have said "4 / 10" to somebody the matching engine
 * already knew ten things about. The count is the belief layer's own: distinct
 * markets, deduplicated across live positions, remembered ones, expressed beliefs
 * and Simulation, so the brief and the banner can never disagree.
 *
 * It retires itself. At ten the brief disappears and whatever the rail normally
 * pins (`children`) takes the slot back, permanently. While Simulation is active
 * the card steps aside too — the persistent banner owns balance, progress, help
 * and exit, and two progress counters on one screen is one too many.
 *
 * Signed out there is nothing to count, so the brief still shows: it is exactly
 * the reader who has not started. The action then begins wallet connection.
 */
import type { ReactNode } from "react";
import { useHydrated } from "@tanstack/react-router";
import { useSimulationMode } from "@/lib/simulation-mode";
import { requestConnect } from "@/lib/connect-bridge";
import { walletIntent } from "@/lib/wagmi";
import { PROFILE_TARGET } from "@/domain/beliefs";
import { SIMULATION_COPY } from "@/domain/simulation";

/** The onboarding goal. Re-exported from the belief layer, which owns it. */
export const CONVICTION_GOAL = PROFILE_TARGET;

export function TakeASide({
  wallet,
  children,
}: {
  wallet?: string;
  /** What the rail pins once the brief is done. */
  children?: ReactNode;
}) {
  const sim = useSimulationMode();
  // Simulation eligibility is resolved from browser-side state (wallet session,
  // cached account), so the server cannot know it. Render the offer only after
  // hydration or the server/client trees disagree.
  const hydrated = useHydrated();
  const { count, target, progress } = sim.profileProgress;

  // Retired at the goal, and stood down while Simulation is running.
  // Retired only at the goal. It stays through Simulation too: the progress to
  // ten is the same journey whether the convictions are simulated or real.
  if (wallet && sim.profileProgress.complete) return <>{children}</>;

  const pct = Math.min(100, progress * 100);
  // Signed out, the same button starts the wallet. Nothing about Simulation can
  // begin without an address to save the progress against.
  const start = () => {
    sim.dismissNotice();
    return wallet ? sim.activate() : requestConnect();
  };

  return (
    <div
      className="relative mb-3 overflow-hidden rounded-[10px] p-3"
      style={{
        background:
          "linear-gradient(180deg, color-mix(in oklab, var(--notice) 12%, var(--surface)) 0%, var(--surface) 70%)",
        border: "1px solid color-mix(in oklab, var(--notice) 32%, var(--border))",
        boxShadow: "0 0 0 1px color-mix(in oklab, var(--notice) 8%, transparent) inset",
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-10 -right-8 h-24 w-24 rounded-full blur-2xl"
        style={{ background: "color-mix(in oklab, var(--notice) 30%, transparent)" }}
      />

      <div className="relative flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--notice)" }} />
        <div className="text-[11px] font-semibold tracking-[0.08em] uppercase text-[var(--notice)]">
          Build your profile
        </div>
      </div>

      <div className="relative mt-2 flex items-baseline gap-1.5">
        <span className="text-[20px] leading-none font-semibold tabular-nums text-[var(--text)]">
          {count}
        </span>
        <span className="text-[12px] tabular-nums text-[var(--text-muted)]">
          / {target} convictions
        </span>
      </div>

      <div
        className="relative mt-2 h-[3px] w-full overflow-hidden rounded-full"
        style={{ background: "color-mix(in oklab, var(--notice) 18%, var(--border))" }}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={target}
        aria-valuenow={count}
        aria-label="Convictions taken"
      >
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{
            width: `${pct}%`,
            background:
              "linear-gradient(90deg, color-mix(in oklab, var(--notice) 60%, transparent), var(--notice))",
          }}
        />
      </div>

      {/* JUST LEFT SIMULATION? SAY SO, HERE, ONCE.
          The banner has gone and this card has come back, which is exactly the
          moment somebody wonders whether their convictions went with it. The
          count above already answers it; this says it in words. It clears on the
          next interaction rather than on a timer — a message that vanishes while
          being read is not an answer. */}
      {sim.notice ? (
        <p
          className="relative mt-2.5 text-[12px] leading-relaxed font-medium text-[var(--text-secondary)]"
          role="status"
        >
          {sim.notice}
        </p>
      ) : (
        <p className="relative mt-2.5 text-[12px] leading-relaxed text-[var(--text-muted)]">
          {sim.active
            ? "Take sides on your own reasons. Simulated or real, every conviction counts toward your profile."
            : SIMULATION_COPY.entryBody}
        </p>
      )}

      {/* The offer, and only while it is genuinely on offer. A graduated wallet
          never sees it again, and neither does one that already has ten. */}
      {hydrated && !sim.active && (!wallet || sim.eligible) && (
        <>
          <button
            type="button"
            {...walletIntent}
            onClick={start}
            disabled={sim.pending}
            className="relative mt-3 h-9 w-full rounded-[8px] text-[13px] font-semibold transition-opacity disabled:opacity-50"
            style={{ background: "var(--text)", color: "var(--bg)" }}
          >
            {sim.pending ? "Starting…" : "Try Simulation"}
          </button>
          <p className="relative mt-1.5 text-[11px] leading-relaxed text-[var(--text-muted)]">
            {SIMULATION_COPY.entrySupport}
          </p>
          {/* ONE QUIET LINE, and it is the honest one: a signature is not a
              transaction, and somebody about to see a wallet prompt deserves to
              know which of the two is coming. */}
          {sim.verifying && (
            <p
              className="relative mt-1 text-[11px] leading-relaxed text-[var(--text-secondary)]"
              role="status"
            >
              {SIMULATION_COPY.verifyWallet}
            </p>
          )}
          {sim.error && (
            <p className="relative mt-1 text-[11px]" role="alert" style={{ color: "var(--loss)" }}>
              {sim.error}
            </p>
          )}
        </>
      )}
    </div>
  );
}
