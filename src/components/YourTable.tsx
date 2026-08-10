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
import {
  tableProgress,
  progressLine,
  tableLine,
  finishedLine,
  type RecipientFact,
  type CloseReason,
} from "@/domain/table";
import { bestEffort, useWalletSession } from "@/hooks/useWalletSession";

export const tableKey = (wallet?: string) => ["table", wallet ?? null] as const;

/**
 * WHICH SIDE THE RAIL IS SHOWING — a handoff, not a fetch.
 *
 * "See yours" is pressed in `PutOnTable`, which sits ABOVE the rail as a sibling
 * rather than inside it, so there is no prop path between them. The cache is the
 * seam, exactly as it already is for the callers a trade just closed: written by
 * one component, read by another, with no request behind it.
 */
export const railSideKey = ["challenge-side"] as const;

/** What is on this wallet's table right now — the count the capacity line reads. */
export function useTable(wallet?: string) {
  return useQuery({
    queryKey: tableKey(wallet),
    queryFn: () => getTable({ data: { wallet: wallet ?? null } }),
    enabled: !!wallet,
    staleTime: 30_000,
  });
}

/** Markets this wallet is in that could still take a free slot. */
export const candidatesKey = (wallet?: string, limit = 0) =>
  ["table-candidates", wallet ?? null, limit] as const;

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

  const put = useMutation({
    mutationFn: async (marketId: number) =>
      bestEffort(async () =>
        putOnTable({
          data: {
            wallet: wallet as string,
            session: await ensureSession({ interactive: true }),
            marketId,
          },
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: tableKey(wallet) });
      void qc.invalidateQueries({ queryKey: ["table-candidates", wallet ?? null] });
    },
  });

  const table = rows ?? [];
  /**
   * ACTIVE FIRST, THEN WHAT ENDED. Two groups, one list — a heading over three
   * cards would be scaffolding around a thing small enough not to need it, and the
   * dashed border already says which is which.
   *
   * THE CAPACITY LINE COUNTS ONLY THE LIVE ONES. A week of finished Challenges
   * reading as "3 on the table" would be the opposite of the truth: closing is
   * precisely what gave the slot back.
   */
  const live = table.filter((r) => r.closedAtMs == null);
  const ended = table.filter((r) => r.closedAtMs != null);
  const ordered = [...live, ...ended];
  const open = spotsOpen(live.length);

  /**
   * AN EMPTY SLOT IS AN OFFER, NOT A GAP. Every free space becomes an invitation
   * card for a market this person is actually in, so the only thing a table ever
   * shows is something to read or something to do.
   */
  const { data: candidates } = useQuery({
    queryKey: candidatesKey(wallet, open),
    queryFn: () => getTableCandidates({ data: { wallet: wallet ?? null, limit: open } }),
    enabled: !!wallet && open > 0 && !isError,
    staleTime: 60_000,
  });
  const invites = (candidates ?? []).filter(
    (c) => !live.some((r) => r.marketId === c.marketId),
  ).slice(0, open);

  if (isError) {
    // A failed read is not an empty table. Same rule the incoming side follows:
    // silence has to be earned by an answer.
    return (
      <p className="text-[11.5px] leading-snug text-[var(--text-muted)]">
        Could not load your table. This is a fault on our side — try again in a moment.
      </p>
    );
  }

  if (table.length === 0 && invites.length === 0) {
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
      {tableLine(live.length) && (
        <p className="num text-[11px] text-[var(--text-muted)]">{tableLine(live.length)}</p>
      )}

      <ul className="space-y-2">
        {ordered.map((row) => (
          <TableRowCard
            key={row.id}
            id={row.id}
            title={row.title}
            recipients={row.recipients}
            closeReason={row.closeReason}
            onOpen={() => onSelect(row.marketId)}
            onClose={() => close.mutate(row.id)}
            closing={close.isPending}
          />
        ))}

        {invites.map((c) => (
          <InviteCard
            key={`invite-${c.marketId}`}
            title={c.title}
            onOpen={() => onSelect(c.marketId)}
            onPut={() => put.mutate(c.marketId)}
            pending={put.isPending}
          />
        ))}
      </ul>
    </div>
  );
}

/**
 * A FREE SLOT, SPOKEN AS AN INVITATION. It names a market this person is already
 * in and offers the one act that matters — putting it in front of their people.
 * Never a placeholder, never an empty rectangle counting down to three.
 */
function InviteCard({
  title,
  onOpen,
  onPut,
  pending,
}: {
  title: string | null;
  onOpen: () => void;
  onPut: () => void;
  pending: boolean;
}) {
  return (
    <li className="rounded-xl border border-dashed border-[var(--border)] p-3">
      <button type="button" onClick={onOpen} className="w-full text-left">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Spot open
        </p>
        <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-[var(--text)]">
          {title ?? "This question"}
        </p>
      </button>
      <button
        type="button"
        onClick={onPut}
        disabled={pending}
        className="mt-1.5 text-[12px] font-medium text-[var(--text)] underline transition-opacity disabled:opacity-50"
      >
        Put it on the table
      </button>
    </li>
  );
}

function TableRowCard({
  id,
  title,
  recipients,
  closeReason,
  onOpen,
  onClose,
  closing,
}: {
  id: number;
  title: string | null;
  recipients: RecipientFact[];
  /** Set once it has ended — the card becomes an outcome rather than a status. */
  closeReason: CloseReason | null;
  onOpen: () => void;
  onClose: () => void;
  closing: boolean;
}) {
  const progress = tableProgress(recipients);
  const finished = closeReason != null;
  const line = finished ? finishedLine(progress, closeReason) : progressLine(progress);

  return (
    <li className="relative" data-challenge={id}>
      <button
        type="button"
        onClick={onOpen}
        className={`w-full rounded-xl border p-3 text-left transition-colors ${
          finished
            ? // QUIETER, NOT GREYED OUT. A finished Challenge is the best thing
              // that happens here; disabling its appearance would say the opposite.
              // It steps back because it no longer needs anything from you.
              "border-dashed border-[var(--border)] bg-transparent hover:border-[var(--border-strong)]"
            : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)]"
        }`}
      >
        <p
          className={`line-clamp-2 text-[13px] leading-snug ${finished ? "text-[var(--text-secondary)]" : "text-[var(--text)]"}`}
        >
          {title ?? "This question"}
        </p>

        {/* WHAT HAPPENED BECAUSE YOU PUT IT UP. Absent entirely until somebody has
            been reached — a Challenge with no audience has no story yet, and
            "0 of 0" is not a state anybody needs described. Once it has ended the
            same slot carries the ending instead, in the past tense. */}
        {line && (
          <p
            className={`mt-1.5 text-[11.5px] leading-snug ${finished ? "text-[var(--text)]" : "num text-[var(--text-secondary)]"}`}
          >
            {line}
          </p>
        )}

        {!finished && progress.waiting > 0 && progress.showedUp === 0 && progress.passed === 0 && (
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
          relationship forever.

          GONE ONCE IT HAS ENDED, and no control replaces it. A finished card needs
          no dismissing: it ages out by itself, and an outcome you have to file away
          is an inbox. The only thing left to do with it is read it. */}
      {!finished && (
        <button
          type="button"
          onClick={onClose}
          disabled={closing}
          className="mt-1 text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--text)] disabled:opacity-50"
        >
          Take off the table
        </button>
      )}
    </li>
  );
}
