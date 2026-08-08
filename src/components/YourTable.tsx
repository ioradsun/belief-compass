/**
 * YOURS — the things you put in front of your people, and what became of them.
 *
 * THE SAME CARD GRAMMAR AS AN INCOMING CHALLENGE, seen from the other side. A
 * Position card answers "where do I stand and what happened"; this answers "what
 * did I put in front of my people and what happened". Both are persistent and
 * stateful — they live and update until closed, which is what separates them from
 * feed events and notifications. The market is the shared object; the relationship
 * decides the perspective.
 *
 * WHAT THE CARD IS ALLOWED TO CLAIM, and the omissions are the design:
 *
 *     Will Bitcoin hit $200K before 2027?
 *     3 of 8 showed up · 1 passed
 *
 * No viewed count — the only view signal this product has is client-reported and
 * unverifiable, and "5 viewed" is precisely the claim a creator would believe and
 * the system cannot prove. No capital, no believer totals: those are facts about a
 * market, not effects of a Challenge, and "+$42" next to one implies a causal link
 * the data does not establish. Four numbers would make this an ad-tech panel; the
 * one that matters is that people moved because somebody asked.
 *
 * NOBODY IS NAMED AS HAVING PASSED. The count is aggregate and stays aggregate.
 * Passing is a choice about a question, not a verdict on a person, and a surface
 * that said "Mike passed on you" would be building the ledger of rejection this
 * product decided not to keep.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getTable, takeOffTable } from "@/lib/table.functions";
import { tableProgress, progressLine, tableLine, type RecipientFact } from "@/domain/table";
import { bestEffort, useWalletSession } from "@/hooks/useWalletSession";

export const tableKey = (wallet?: string) => ["table", wallet ?? null] as const;

/** What is on this wallet's table right now — the count the capacity line reads. */
export function useTable(wallet?: string) {
  return useQuery({
    queryKey: tableKey(wallet),
    queryFn: () => getTable({ data: { wallet: wallet ?? null } }),
    enabled: !!wallet,
    staleTime: 30_000,
  });
}

export function YourTable({
  wallet,
  onSelect,
}: {
  wallet?: string;
  onSelect: (marketId: number) => void;
}) {
  const qc = useQueryClient();
  const { ensureSession } = useWalletSession();
  const { data: rows, isError } = useTable(wallet);

  const close = useMutation({
    mutationFn: async (challengeId: number) =>
      bestEffort(async () =>
        takeOffTable({
          data: {
            wallet: wallet as string,
            session: await ensureSession({ interactive: true }),
            challengeId,
          },
        }),
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: tableKey(wallet) }),
  });

  if (isError) {
    // A failed read is not an empty table. Same rule the incoming side follows:
    // silence has to be earned by an answer.
    return (
      <p className="text-[11.5px] leading-snug text-[var(--text-muted)]">
        Could not load your table. This is a fault on our side — try again in a moment.
      </p>
    );
  }

  const table = rows ?? [];
  if (table.length === 0) {
    return (
      <p className="text-[11.5px] leading-snug text-[var(--text-muted)]">
        Nothing on the table. When you back something worth asking about, put it up and your people
        get the chance to weigh in.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {/* CAPACITY, NOT CURRENCY. "2 on the table · 1 spot open" rather than
          "2 / 3 USED" — a fraction with a denominator reads as a balance being
          spent, and turns an editorial choice into an allowance. */}
      <p className="num text-[11px] text-[var(--text-muted)]">{tableLine(table.length)}</p>

      <ul className="space-y-2">
        {table.map((row) => (
          <TableRowCard
            key={row.id}
            id={row.id}
            title={row.title}
            recipients={row.recipients}
            onOpen={() => onSelect(row.marketId)}
            onClose={() => close.mutate(row.id)}
            closing={close.isPending}
          />
        ))}
      </ul>
    </div>
  );
}

function TableRowCard({
  id,
  title,
  recipients,
  onOpen,
  onClose,
  closing,
}: {
  id: number;
  title: string | null;
  recipients: RecipientFact[];
  onOpen: () => void;
  onClose: () => void;
  closing: boolean;
}) {
  const progress = tableProgress(recipients);
  const line = progressLine(progress);

  return (
    <li className="relative" data-challenge={id}>
      <button
        type="button"
        onClick={onOpen}
        className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-left transition-colors hover:border-[var(--border-strong)]"
      >
        <p className="line-clamp-2 text-[13px] leading-snug text-[var(--text)]">
          {title ?? "This question"}
        </p>

        {/* WHAT HAPPENED BECAUSE YOU PUT IT UP. Absent entirely until somebody has
            been reached — a Challenge with no audience has no story yet, and
            "0 of 0" is not a state anybody needs described. */}
        {line && <p className="num mt-1.5 text-[11.5px] text-[var(--text-secondary)]">{line}</p>}

        {progress.waiting > 0 && progress.showedUp === 0 && progress.passed === 0 && (
          /* Nobody has answered yet, and saying so plainly beats a row of noughts.
             It is early, not empty. */
          <p className="mt-1.5 text-[11.5px] leading-snug text-[var(--text-muted)]">
            {progress.reached} of your people can weigh in. No smoke yet.
          </p>
        )}
      </button>

      {/* TAKE IT OFF THE TABLE — casual, because it is. Not "Delete", not "Cancel":
          nothing is destroyed and nothing failed. The slot frees, every recipient
          row survives with its stamps, and who showed up stays part of the
          relationship forever. */}
      <button
        type="button"
        onClick={onClose}
        disabled={closing}
        className="mt-1 text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--text)] disabled:opacity-50"
      >
        Take off the table
      </button>
    </li>
  );
}
