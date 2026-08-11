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
}

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
}: PostPositionBarProps) {
  const ctas = [x.primary, x.secondary].filter(Boolean) as Cta[];
  const challenge = ctas.find((c) => c.kind === "challenge");
  const next = ctas.find((c) => c.kind === "next_question");
  const rest = ctas.filter((c) => c !== challenge && c !== next);
  const consequence = CONSEQUENCE_COPY[x.consequence as string] ?? null;

  return (
    <div className="grid gap-2 px-3 py-3" data-post-position={x.copyCategory}>
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
