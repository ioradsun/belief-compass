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
import { useSimulationMode } from "@/lib/simulation-mode";
import type { RecordMode } from "@/domain/simulation";
import { railSideKey, tableKey, useTable } from "@/components/YourTable";
import { canPutOnTable } from "@/domain/table";
import { AudiencePreview } from "@/components/AudiencePreview";
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
  /**
   * ONE LEDGER, END TO END. The capacity read, the audience preview and the write
   * all carry the same mode, so what the reader is shown is exactly what the
   * write would do — a Simulation Challenge reaches only active Simulation users
   * and occupies a Simulation slot.
   */
  const { active: simulating } = useSimulationMode();
  const mode: RecordMode = simulating ? "SIMULATION" : "REAL";
  const { data: table } = useTable(wallet, mode);

  const put = useMutation({
    mutationFn: async (): Promise<PutResult | null> =>
      bestEffort(async () =>
        putOnTable({
          data: {
            wallet: wallet as string,
            session: await ensureSession({ interactive: true }),
            marketId: marketId as number,
            mode,
          },
        }),
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: tableKey(wallet, mode) }),
  });

  if (!wallet || marketId == null) return null;

  /**
   * LIVE ONLY, IN BOTH ANSWERS. `getTable` now also returns Challenges that ended
   * in the last week, so their author finds out what happened — and a finished row
   * must not be mistaken for an occupied slot or for "this one is already up".
   * Reading `table.length` here would have told somebody with three good outcomes
   * that their table was full, and offered "On the table." for a question that
   * finished on Tuesday.
   */
  const live = (table ?? []).filter((r) => r.closedAtMs == null);
  const active = live.length;
  const alreadyUp = live.some((r) => r.marketId === marketId);
  const result = put.data;

  // ON THE TABLE ALREADY — the same market cannot take a second slot, and saying
  // so is better than a button that would fail against the unique index.
  if (alreadyUp || result?.ok) {
    return <p className="mt-2 text-[11.5px] text-[var(--text-secondary)]">On the table.</p>;
  }

  /**
   * THE AUDIENCE COULD NOT BE ESTABLISHED — which is not nobody, and not a
   * reason to blame the reader's network. The exclusions are what keep a
   * Challenge away from people who already answered this market; if one of those
   * reads failed, the server refused, no slot was spent, and the honest thing to
   * say is that it did not go through. "Nobody qualifies" here would be a
   * permanent-sounding claim about somebody's network made from an outage.
   */
  if (result && !result.ok && result.reason === "audience_unavailable") {
    return (
      <p className="mt-2 text-[11.5px] leading-snug text-[var(--text-muted)]">
        Couldn&rsquo;t work out who this would reach. Nothing was put up &mdash; try again in a
        moment.
      </p>
    );
  }

  /**
   * NOBODY LEFT TO ASK. Silence rather than an offer that leads nowhere.
   *
   * `no_reach` joins `no_audience` because to the reader they are one fact: the
   * write landed on nobody. They differ only in where it was discovered — one
   * before the transaction, one inside it, after everybody in the audience
   * turned out to already have a row. Both rolled back; neither spent a slot.
   */
  if (result && !result.ok && (result.reason === "no_audience" || result.reason === "no_reach")) {
    return (
      <p className="mt-2 text-[11.5px] leading-snug text-[var(--text-muted)]">
        Nobody new to ask here yet. As your network fills in, this becomes worth asking.
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
      {/* WHO, BEFORE THE BUTTON. "Your people" was an abstraction the reader had
          to take on trust — and the surface that reveals where everybody stands
          asking somebody to publish into an unnamed crowd was the one place it
          kept its own cards face down. Self-hides on a refused or empty read, so
          the offer never sits under a heading with nothing beneath it. */}
      <AudiencePreview wallet={wallet} marketId={marketId} mode={mode} />
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
