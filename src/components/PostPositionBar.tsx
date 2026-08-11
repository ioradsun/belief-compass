/**
 * THE ORDER BAR AFTER THE ORDER — the same region, a second state.
 *
 * NOT A SCREEN. Buying does not navigate anywhere: the market stays exactly
 * where it was and this replaces the order ticket in place, so the bottom of the
 * interface always answers one question — "what can I do now?".
 *
 * PRE-PURCHASE   side · amount · confirm
 * POST-PURCHASE  what just happened · Challenge [n] · Next Market
 *
 * IT DECIDES NOTHING. `resolvePostAction` already chose the sentence and the two
 * controls; this draws them at bar scale and hands presses back.
 */
import { useEffect, useRef, useState } from "react";
import {
  WRITE_FAILED_TITLE,
  WRITE_RETRY_LABEL,
  type ActionStatus,
  type Cta,
  type PostActionExperience,
} from "@/domain/post-action";

export interface PostPositionBarProps {
  experience: PostActionExperience;
  /** "You backed YES." — the plain human record of the transaction. */
  lockLine: string;
  /**
   * HOW MANY CHALLENGES ARE LEFT, said as scarcity rather than as a fraction.
   * "1 of 3" can mean used or available; "3 left" cannot be misread.
   */
  remaining: number;
  onAct: (cta: Cta) => void;
  pending?: boolean;
  status?: ActionStatus;
  onRetry?: () => void;
  /**
   * CARRY THE READER ON BY THEMSELVES, after a beat.
   *
   * The receipt stays on the market it belongs to — it never rides along to a
   * different question — and the move happens only if the reader does nothing.
   * The smallest sign of attention (a pointer, a key, a scroll) cancels it for
   * good, because a countdown that fights someone reading is worse than a
   * button they have to press.
   */
  autoAdvance?: boolean;
}

/** Long enough to read one line, short enough not to feel like waiting. */
const ADVANCE_MS = 3000;

const CONSEQUENCE_COPY: Record<string, string> = {
  branch_live: "You already asked people about this one.",
  challenge_live: "The people you asked are still deciding.",
};

export function PostPositionBar({
  experience: x,
  lockLine,
  remaining,
  onAct,
  pending = false,
  status = { state: "idle" },
  onRetry,
  autoAdvance = false,
}: PostPositionBarProps) {
  const ctas = [x.primary, x.secondary].filter(Boolean) as Cta[];
  const challenge = ctas.find((c) => c.kind === "challenge");
  const next = ctas.find((c) => c.kind === "next_question");
  const rest = ctas.filter((c) => c !== challenge && c !== next);
  const consequence = CONSEQUENCE_COPY[x.consequence as string] ?? null;

  /* ── The unattended advance ──────────────────────────────────────────────
     `progress` is 0→1 while it runs and null once cancelled or finished, so a
     single value drives both the line and whether the countdown copy shows. */
  const armed = autoAdvance && !!next && !pending && status.state === "idle";
  const [progress, setProgress] = useState<number | null>(null);
  const cancelled = useRef(false);
  const act = useRef(onAct);
  act.current = onAct;

  useEffect(() => {
    if (!armed || cancelled.current || !next) return;
    const stop = () => {
      cancelled.current = true;
      setProgress(null);
    };
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      if (cancelled.current) return;
      const p = Math.min(1, (t - start) / ADVANCE_MS);
      setProgress(p);
      if (p >= 1) {
        cancelled.current = true;
        act.current(next);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const opts = { passive: true } as const;
    window.addEventListener("pointerdown", stop, opts);
    window.addEventListener("keydown", stop, opts);
    window.addEventListener("wheel", stop, opts);
    window.addEventListener("touchmove", stop, opts);
    window.addEventListener("pointermove", stop, opts);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointerdown", stop);
      window.removeEventListener("keydown", stop);
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchmove", stop);
      window.removeEventListener("pointermove", stop);
    };
  }, [armed, next]);

  const counting = progress != null && progress < 1;

  return (
    <div className="relative grid gap-2 px-3 py-3" data-post-position={x.copyCategory}>
      {/* 0 · THE ONLY SIGN THE MOVE IS COMING — a hairline that drains. It sits
          on the bar's edge so it reads as time passing, not as a loading state. */}
      {counting && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[2px] origin-left bg-[var(--text-muted)]/60"
          style={{ transform: `scaleX(${1 - (progress ?? 0)})` }}
        />
      )}

      {/* 1 · THE RECEIPT — one small line. The transaction is not the payoff. */}
      <p className="text-[12px] font-semibold leading-snug text-[var(--text)]">
        <span className="text-[var(--yes)]">✓</span> {lockLine}
      </p>

      {/* 2 · THE STRONGEST THING THE ANSWER REVEALED — the market above is still
          on screen, so this stays to one or two lines. */}
      {(x.headline || x.support) && (
        <p className="text-[12px] leading-snug text-[var(--text-secondary)]">
          <span className="text-[var(--text)]">{x.headline}</span>
          {x.support ? ` ${x.support}` : ""}
        </p>
      )}
      {consequence && (
        <p className="text-[11.5px] leading-snug text-[var(--text-muted)]">
          {consequence}
          {x.consequenceLine ? ` ${x.consequenceLine}` : ""}
        </p>
      )}

      {status.state === "failed" && (
        <p className="text-[11.5px] leading-snug text-[var(--text-secondary)]">
          {WRITE_FAILED_TITLE} {status.message}{" "}
          {onRetry && (
            <button type="button" onClick={onRetry} className="underline text-[var(--text)]">
              {WRITE_RETRY_LABEL}
            </button>
          )}
        </p>
      )}

      {/* 3 · TWO CHOICES, IN THE REGION THE ORDER FORM JUST LEFT. Keep going is
          the loop, so it is the filled one; bringing people in sits beside it
          with what it costs attached to the control that spends it. */}
      <div className="flex items-center gap-2">
        {next && (
          <button
            type="button"
            disabled={pending}
            onClick={() => onAct(next)}
            className="flex-1 rounded-[12px] bg-[var(--text)] px-3 py-2.5 text-[13px] font-semibold text-[var(--bg)] transition-opacity disabled:opacity-50"
          >
            {next.label} →
            {counting && (
              <span className="ml-1 font-normal opacity-70">· moving on</span>
            )}
          </button>
        )}

        {challenge && (
          <button
            type="button"
            disabled={pending}
            onClick={() => onAct(challenge)}
            className="flex-1 rounded-[12px] border border-[var(--border)] px-3 py-2 text-left transition-colors hover:border-[var(--text-muted)] disabled:opacity-50"
          >
            <span className="block text-[13px] font-semibold leading-tight text-[var(--text)]">
              {challenge.label}
            </span>
            <span className="block text-[11px] leading-tight text-[var(--text-muted)]">
              {remaining} of 3 slots free
            </span>
          </button>
        )}
        {!next &&
          rest.length === 0 &&
          !challenge &&
          [x.primary].map((c) => (
            <button
              key={c.kind}
              type="button"
              onClick={() => onAct(c)}
              className="flex-1 rounded-[12px] bg-[var(--text)] px-3 py-2.5 text-[13px] font-semibold text-[var(--bg)]"
            >
              {c.label}
            </button>
          ))}
      </div>
      {rest.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          {rest.map((c) => (
            <button
              key={c.kind}
              type="button"
              onClick={() => onAct(c)}
              className="text-[12px] font-medium text-[var(--text-secondary)] underline underline-offset-2 hover:text-[var(--text)]"
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
