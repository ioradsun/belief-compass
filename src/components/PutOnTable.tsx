/**
 * PUT IT ON THE TABLE — one action, both paths.
 *
 * Creating a market and backing an existing one are different acts that produce
 * the same opportunity: you now hold a conviction worth asking your people about.
 * Two Challenge architectures for those two moments would be two lifecycles, two
 * caps and two sets of copy drifting apart — so there is ONE reusable action, and
 * `LaunchRail` already renders after both.
 *
 * IT IS DELIBERATELY SMALL. The post-position screen stays a confirmation, not a
 * Challenge manager: no card list, no 3/3 progress widget, no replace-selector for
 * choosing which one to take down. That work belongs in Challenge, where the whole
 * table is visible and a person can weigh one against another. Here there is a
 * sentence and a link.
 *
 * AND IT REFUSES TO ASK WHEN THE ANSWER IS NO. At capacity it says so and points
 * at the table rather than offering a button that fails; when nobody qualifies it
 * says nothing at all, because inviting somebody to put a question in front of an
 * audience that does not exist is worse than silence.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { putOnTable } from "@/lib/table.functions";
import { railSideKey, tableKey, useTable } from "@/components/YourTable";
import { canPutOnTable } from "@/domain/table";
import { bestEffort, useWalletSession } from "@/hooks/useWalletSession";
import type { PutResult } from "@/lib/table.server";

export function PutOnTable({
  wallet,
  marketId,
  onSeeTable,
}: {
  wallet?: string;
  marketId?: number;
  /** Take me to Yours — the only place a Challenge can actually be managed. */
  onSeeTable?: () => void;
}) {
  const qc = useQueryClient();
  const { ensureSession } = useWalletSession();
  const { data: table } = useTable(wallet);

  const put = useMutation({
    mutationFn: async (): Promise<PutResult | null> =>
      bestEffort(async () =>
        putOnTable({
          data: {
            wallet: wallet as string,
            session: await ensureSession({ interactive: true }),
            marketId: marketId as number,
          },
        }),
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: tableKey(wallet) }),
  });

  if (!wallet || marketId == null) return null;

  const active = table?.length ?? 0;
  const alreadyUp = (table ?? []).some((r) => r.marketId === marketId);
  const result = put.data;

  // ON THE TABLE ALREADY — the same market cannot take a second slot, and saying
  // so is better than a button that would fail against the unique index.
  if (alreadyUp || result?.ok) {
    return <p className="mt-2 text-[11.5px] text-[var(--text-secondary)]">On the table.</p>;
  }

  // NOBODY QUALIFIES. Silence rather than an offer that leads nowhere.
  if (result && !result.ok && result.reason === "no_audience") {
    return (
      <p className="mt-2 text-[11.5px] leading-snug text-[var(--text-muted)]">
        Nobody qualifies to weigh in yet. As your Tribe and Rivals form, this becomes worth asking.
      </p>
    );
  }

  // AT CAPACITY. It points at the table instead of arguing — the choice of what
  // to take down needs to see all three, which is not this surface's job.
  if (!canPutOnTable(active) || (result && !result.ok && result.reason === "full")) {
    return (
      <p className="mt-2 text-[11.5px] leading-snug text-[var(--text-muted)]">
        Your table&rsquo;s full.{" "}
        <button
          type="button"
          onClick={() => {
            qc.setQueryData(railSideKey, "yours");
            onSeeTable?.();
          }}
          className="underline"
        >
          See yours
        </button>
      </p>
    );
  }

  return (
    <div className="mt-2">
      <p className="text-[11.5px] leading-snug text-[var(--text-secondary)]">
        Want your people&rsquo;s take?
      </p>
      <button
        type="button"
        disabled={put.isPending}
        onClick={() => put.mutate()}
        className="mt-1 text-[12px] font-medium text-[var(--text)] underline transition-opacity disabled:opacity-50"
      >
        Put it on the table
      </button>
    </div>
  );
}
