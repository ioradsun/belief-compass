/**
 * SEE ALL — every challenge either of you ever made.
 *
 * THE RAIL AND THIS ANSWER DIFFERENT QUESTIONS, and keeping them apart is why the
 * rail can stay short. The rail is "who is waiting on me, and what just happened":
 * a handful of rows that go quiet after a week, because an outcome deserves to be
 * in the way for a while and then stop being in the way. This is "what have we
 * actually done" — complete, chronological, and reached only on purpose.
 *
 * IT IS NOT A FEED, AND THE ABSENCES ARE THE PROOF. No scoring, no ranking, no
 * significance, no admission rule, no "interesting" — the order is time and the
 * contents are everything. The moment something here decided what was worth
 * showing, this would be the Insider tape with a different heading, and Insider
 * already exists one tab across answering "what is happening" for everybody.
 *
 * EVERY ROW IS A SENTENCE ABOUT PEOPLE. "Maya showed up", "You showed up",
 * "Waiting on Alex" — never a status, never a state name, never a challenge id.
 * The vocabulary is `historyRows`, the same one the profile's "Between you"
 * section renders, so one interaction cannot be described two ways.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sheet } from "@/components/Sheet";
import { getChallengeHistory } from "@/lib/challenge.functions";
import { groupHistory, historyRows, type HistoryRow } from "@/domain/dependability";

export const historyKey = (wallet?: string) => ["challenge-history", wallet ?? null] as const;

/**
 * The control and the sheet, together, because they are one affordance.
 *
 * IT SAYS THE COUNT BEFORE IT IS PRESSED. "See all" alone asks the reader to
 * gamble a tap on whether there is anything behind it; "See all 41" is a fact that
 * makes the decision for them. The number is what the server actually read, never
 * an estimate — and the query only runs once the sheet is open, so an unread
 * history costs the rail nothing.
 */
export function ChallengeHistory({
  wallet,
  onSelect,
  onSelectPerson,
}: {
  wallet?: string;
  onSelect: (marketId: number) => void;
  onSelectPerson?: (personWallet: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const { data, isError } = useQuery({
    queryKey: historyKey(wallet),
    queryFn: () => getChallengeHistory({ data: { wallet: wallet ?? null } }),
    enabled: !!wallet && open,
    staleTime: 60_000,
  });

  const groups = useMemo(
    () => groupHistory(historyRows(data?.entries ?? []), Date.now()),
    [data?.entries],
  );
  const total = data?.entries.length ?? 0;

  if (!wallet) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 block text-[11.5px] text-[var(--text-secondary)] underline-offset-2 transition-colors hover:text-[var(--text)] hover:underline"
      >
        See all →
      </button>

      {open && (
        <Sheet
          onClose={() => setOpen(false)}
          title={
            <>
              Challenges
              {total > 0 && (
                <>
                  {" "}
                  · <span className="num text-[var(--text-muted)]">{total}</span>
                </>
              )}
            </>
          }
        >
          {/* A FAILED READ IS NOT AN EMPTY HISTORY. The confident zero this
              codebase keeps paying for, and here it would tell somebody with a
              year of relationships that they have never challenged anybody. */}
          {isError ? (
            <p className="py-6 text-[12px] leading-snug text-[var(--text-muted)]">
              Could not load your history. This is a fault on our side, not an empty one — try again
              in a moment.
            </p>
          ) : data == null ? (
            <p className="py-6 text-[12px] text-[var(--text-muted)]">Reading your history…</p>
          ) : groups.length === 0 ? (
            /* NOTHING HAS HAPPENED YET, which is a correct state and by far the
               most common one — measured platform-wide, most wallets have no
               Tribe at all. It says so without implying anything is broken and
               without a zero. */
            <p className="py-6 text-[12px] leading-snug text-[var(--text-muted)]">
              Nothing between you and anybody yet. Put a question on the table and this fills in.
            </p>
          ) : (
            <div className="space-y-5 pb-2">
              {groups.map((g) => (
                <section key={g.key}>
                  <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                    {g.label}
                  </h4>
                  <ul>
                    {g.rows.map((r) => (
                      <HistoryRowLine
                        key={`${r.direction}-${r.marketId}-${r.who ?? ""}`}
                        row={r}
                        onSelect={onSelect}
                        onSelectPerson={
                          onSelectPerson && r.who && data.people[r.who]
                            ? () => onSelectPerson(data.people[r.who as string])
                            : undefined
                        }
                      />
                    ))}
                  </ul>
                </section>
              ))}
              {/* SAID OUT LOUD. A history that stopped at its read bound without
                  mentioning it would be claiming completeness it does not have,
                  on the one surface whose whole promise is completeness. */}
              {data.truncated && (
                <p className="text-[11px] leading-snug text-[var(--text-muted)]">
                  Showing your most recent challenges. There are older ones behind these.
                </p>
              )}
            </div>
          )}
        </Sheet>
      )}
    </>
  );
}

/** One fixed column for the label, so sixty rows read as a column and not a list. */
const LABEL =
  "w-[124px] shrink-0 truncate text-left text-[10px] font-semibold uppercase tracking-wide";

/**
 * ONE ROW: WHAT HAPPENED, WHO WITH, WHICH QUESTION.
 *
 * The label leads because it is the only part that differs between two rows about
 * the same market, and the question follows because it is what the reader is most
 * likely to want to open. Nothing states a date: the group heading above already
 * did, once, for every row under it.
 */
function HistoryRowLine({
  row,
  onSelect,
  onSelectPerson,
}: {
  row: HistoryRow;
  onSelect: (marketId: number) => void;
  onSelectPerson?: () => void;
}) {
  // WAITING IS QUIETER THAN WHAT HAPPENED. Somebody turning up is the fact worth
  // reading; a question still open is context. Same tokens the profile's own
  // history uses, so one row cannot look different on two screens.
  const waiting = row.direction === "waiting_on_them" || row.direction === "waiting_on_you";
  return (
    <li className="border-b border-[var(--border)] last:border-b-0">
      <div className="flex items-baseline gap-3 py-2">
        {/* NOT ITS OWN BUTTON INSIDE ANOTHER ONE. The person and the question are
            two destinations, so they are two siblings rather than nested
            controls — a button inside a button is invalid markup that breaks
            hydration.

            AND NOT A DISABLED BUTTON EITHER, when there is nowhere to go. A
            control that cannot be used is still announced as a control, so a
            screen reader is told about an action that does not exist. Without a
            destination this is just text, and it renders as text. */}
        {onSelectPerson ? (
          <button
            type="button"
            onClick={onSelectPerson}
            className={`${LABEL} transition-colors hover:text-[var(--text)]`}
            style={{ color: waiting ? "var(--text-muted)" : "var(--text-secondary)" }}
          >
            {row.label}
          </button>
        ) : (
          <span
            className={LABEL}
            style={{ color: waiting ? "var(--text-muted)" : "var(--text-secondary)" }}
          >
            {row.label}
          </span>
        )}
        <button
          type="button"
          onClick={() => onSelect(row.marketId)}
          className="min-w-0 flex-1 truncate text-left text-[12px] text-[var(--text)] transition-colors hover:text-[var(--text-secondary)]"
        >
          {row.title}
        </button>
      </div>
    </li>
  );
}
