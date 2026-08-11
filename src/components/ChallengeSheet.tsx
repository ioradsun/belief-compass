/**
 * CHALLENGE, OVER THE MARKET — never instead of it.
 *
 * The reader pressed a button on the bar at the bottom of a market they can
 * still see. This opens above that market, shows exactly who the question would
 * reach, sends, and closes back to the same post-position state. There is no
 * navigation and no separate page.
 *
 * IT SENDS TO THE WHOLE AUDIENCE, and says so. `put_on_table` puts the question
 * up for everyone who qualifies in one transaction — offering per-person
 * checkboxes would be a control that does not exist underneath it.
 */
import { Sheet } from "@/components/Sheet";
import { AudienceGroups } from "@/components/AudiencePreview";
import type { AudienceGroupView } from "@/domain/audience";
import { RELAY_COST } from "@/domain/chain";

/**
 * EARN THE WORD. "Tribe" is a reward, not vocabulary a first-timer must learn,
 * so the rows describe what is checkably true until the concept has been felt.
 */
const plain = (label: string): string =>
  label === "Your Tribe" || label === "Your Twin + Tribe"
    ? "People who think like you"
    : label === "Your Rivals"
      ? "People who usually disagree"
      : label;

export function ChallengeSheet({
  count,
  groups,
  remaining,
  pending,
  onSend,
  onClose,
}: {
  count: number;
  groups?: AudienceGroupView[];
  remaining: number;
  pending: boolean;
  onSend: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="Ask your people" onClose={onClose}>
      <p className="text-[13px] leading-snug text-[var(--text-secondary)]">
        {count === 1
          ? "One person gets this question next. See if they call it the same way."
          : `${count} people get this question next. See who calls it the same way.`}
      </p>

      {groups && groups.length > 0 && (
        <div className="mt-3 border-t border-[var(--border)] pt-3">
          <AudienceGroups groups={groups.map((g) => ({ ...g, label: plain(g.label) }))} />
        </div>
      )}

      <div className="mt-4 border-t border-[var(--border)] pt-3">
        <button
          type="button"
          disabled={pending}
          onClick={onSend}
          className="w-full rounded-[12px] bg-[var(--text)] px-3 py-2.5 text-[13px] font-semibold text-[var(--bg)] transition-opacity disabled:opacity-50"
        >
          {pending ? "Sending…" : count === 1 ? "Send it" : `Send to all ${count}`}
        </button>
        <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">
          {RELAY_COST} · {remaining} of 3 slots free
        </p>
      </div>
    </Sheet>
  );
}
