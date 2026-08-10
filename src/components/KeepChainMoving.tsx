/**
 * KEEP THE CHAIN MOVING — the offer, at the emotional peak and nowhere else.
 *
 * A person has just bought into a question BECAUSE SOMEBODY ASKED THEM TO. That
 * is the only second in the whole product where relaying is obvious rather than
 * a chore: they have proof the thing works, because it just worked on them. Ask
 * later, from a rail, and it is admin.
 *
 * NEVER "PASS IT ON". `Pass` already means "not for me" here, and one word cannot
 * mean both declining and continuing. The vocabulary is "keep the chain moving".
 *
 * IT IS ONE BUTTON, NOT A PICKER. Choosing recipients would be casting; the
 * audience is the same qualified set every Challenge reaches, frozen at the
 * moment the slot is taken.
 *
 * ABSENT UNLESS ALL THREE ARE TRUE: this buy answered somebody's call, the reader
 * has a slot free, and somebody is left to ask. An offer that leads to an empty
 * audience is worse than silence.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getCallReach } from "@/lib/challenge.functions";
import { putOnTable } from "@/lib/table.functions";
import { answeredCallKey, closedCallsKey } from "@/hooks/useAnswerCalls";
import { tableKey, useTable } from "@/components/YourTable";
import { branchLiveLine, canPutOnTable, keepMovingLine } from "@/domain/table";
import { RELAY_COST, RELAY_TITLE, relayButtonLabel } from "@/domain/chain";
import { bestEffort, useWalletSession } from "@/hooks/useWalletSession";
import { reachTotal, type NamedPerson } from "@/domain/challenge";
import type { PutResult } from "@/lib/table.server";

export function KeepChainMoving({ wallet, marketId }: { wallet?: string; marketId?: number }) {
  const qc = useQueryClient();
  const { ensureSession } = useWalletSession();
  const { data: table } = useTable(wallet);

  // Both written by `useAnswerCalls` when the trade settled. No queryFn: this is
  // a handoff between siblings, not a fetch, and a request here would race the
  // write it is waiting on.
  const { data: closed } = useQuery<NamedPerson[]>({
    queryKey: closedCallsKey(marketId ?? -1),
    enabled: false,
    initialData: [],
  });
  const { data: answered } = useQuery<{ parentCall: number | null }>({
    queryKey: answeredCallKey(marketId ?? -1),
    enabled: false,
    initialData: { parentCall: null },
  });

  const { data: reach } = useQuery({
    queryKey: ["call-reach", wallet ?? null, marketId ?? null],
    queryFn: () => getCallReach({ data: { wallet: wallet ?? null, marketId: marketId ?? null } }),
    enabled: !!wallet && marketId != null && (closed ?? []).length > 0,
    staleTime: 60_000,
  });

  const relay = useMutation({
    mutationFn: async (): Promise<PutResult | null> =>
      bestEffort(async () =>
        putOnTable({
          data: {
            wallet: wallet as string,
            session: await ensureSession({ interactive: true }),
            marketId: marketId as number,
            // THE LINK. Without it the chain is a set of unrelated Challenges
            // that happen to share a market, and provenance has nothing to walk.
            parentCall: answered?.parentCall ?? null,
          },
        }),
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: tableKey(wallet) }),
  });

  if (!wallet || marketId == null) return null;
  // Only a buy that ANSWERED somebody continues a chain. A buy nobody asked for
  // is just a conviction, and the rail is where that gets put up.
  if ((closed ?? []).length === 0) return null;

  const live = (table ?? []).filter((r) => r.closedAtMs == null);
  if (live.some((r) => r.marketId === marketId)) return null;

  const result = relay.data;
  if (result?.ok) {
    return (
      <p className="mt-2 text-[11.5px] leading-snug text-[var(--text-secondary)]">
        {branchLiveLine(result.reached) ?? "It's on your table."}
      </p>
    );
  }
  // AT CAPACITY, OR NOBODY LEFT TO ASK — silence rather than an offer that
  // leads nowhere. Three is an editorial cap, and the rail already shows it.
  if (!canPutOnTable(live.length)) return null;
  if (result && !result.ok) return null;

  /**
   * ADDED UP BY THE DOMAIN, NOT HERE. This used to read `tribe + rivals`, which
   * was right for two groups and became an undercount the moment there were
   * three — hiding the offer entirely from somebody whose whole audience is
   * Still Forming. Null means the read was refused, and a refusal is not zero:
   * the offer is withheld rather than made against a network nobody saw.
   */
  const reachable = reachTotal(reach);
  if (reachable == null) return null;
  const label = relayButtonLabel(reachable);
  if (!label) return null;

  return (
    <div className="mt-2.5 border-t border-[var(--border)] pt-2.5">
      <p className="text-[12px] font-semibold leading-snug text-[var(--text)]">{RELAY_TITLE}</p>
      <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--text-secondary)]">
        {keepMovingLine(reachable)}
      </p>
      <button
        type="button"
        disabled={relay.isPending}
        onClick={() => relay.mutate()}
        className="mt-1.5 text-[12px] font-medium text-[var(--text)] underline transition-opacity disabled:opacity-50"
      >
        {label}
      </button>
      {/* WHAT IT COSTS, said plainly — not a balance to watch run down. */}
      <p className="mt-1 text-[11px] text-[var(--text-muted)]">{RELAY_COST}</p>
    </div>
  );
}
