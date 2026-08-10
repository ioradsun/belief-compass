/**
 * THE MOMENT SOMEONE SHOWS UP — the emotional peak of the product.
 *
 * Every conviction answers calls behind you and creates calls ahead of you, and
 * this is the only surface that can say both halves in one breath:
 *
 *     You showed up for Sarah.               ← backward: you were counted on
 *     Now your people can show up for you.   ← forward: their turn, not a delivery
 *
 * "CAN show up", not "have your call". The forward half describes an OPPORTUNITY
 * that now exists, not a message that went out — nothing was delivered, and a
 * sentence implying otherwise would be the notification claim wearing softer
 * words. It also mirrors the backward half exactly, which is the point: the same
 * act that let you show up for Sarah is what lets Sarah show up for you.
 *
 * NEVER "YOU TOOK A SIDE". The trade confirmation two inches away already said
 * that, and repeating it spends the one moment in the product that could have said
 * something that matters instead.
 *
 * WHAT THIS REPLACED, and the replacement is mostly deletion. It was a recruitment
 * panel: five audiences, an Invite button per person, a stored invitation each, and
 * a Launch Progress ladder measuring what came of them. It asked a creator to do
 * casting before anyone had read their question. Publishing already calls everyone
 * who qualifies, so there is nothing to send and nothing to pick.
 *
 * NEVER "NOTIFIED". There is no notification channel on this platform: no email, no
 * push, no service worker, no inbox. "Have your call" is true in the only sense
 * available — the market is now eligible for their Challenge surface — and
 * `callReachLine` returns null rather than "0 Tribe · 0 Rivals", which reads as a
 * scoreboard the reader is losing when the truth is that a network is still forming.
 *
 * EVERY LINE IS INDEPENDENTLY ABSENT. Nobody called → no backward line. Nobody
 * qualifies yet → no reach line. Neither is ever rendered as a zero.
 */
import { useQuery } from "@tanstack/react-query";
import { getCallReach } from "@/lib/challenge.functions";
import { callReachLine, type NamedPerson } from "@/domain/challenge";
import { PutOnTable } from "@/components/PutOnTable";
import { showedUpFor } from "@/domain/dependability";
import { closedCallsKey } from "@/hooks/useAnswerCalls";

export function LaunchRail({
  wallet,
  kind = "created",
  marketId,
  onSeeTable,
  onDone,
}: {
  wallet?: string;
  kind?: "created" | "backed";
  /** Which market just happened — how the backward line finds who was answered. */
  marketId?: number;
  /** Take me to Yours — the only place a Challenge can actually be managed. */
  onSeeTable?: () => void;
  /** Dismiss the moment — the market is just a market now. */
  onDone: () => void;
}) {
  const { data: reach } = useQuery({
    queryKey: ["call-reach", wallet ?? null, marketId ?? null],
    queryFn: () => getCallReach({ data: { wallet: wallet ?? null, marketId: marketId ?? null } }),
    enabled: !!wallet,
    staleTime: 60_000,
  });

  // Written by useAnswerCalls when the trade settled. No queryFn: this is a
  // handoff, not a fetch — there is nothing to go and ask for, and a request
  // here would race the write it is waiting on.
  const { data: closed } = useQuery<NamedPerson[]>({
    queryKey: closedCallsKey(marketId ?? -1),
    enabled: false,
    initialData: [],
  });

  if (!wallet) return null;

  const line = reach ? callReachLine(reach) : null;
  // Creating a market answers nobody — a creator was not called into their own
  // question — so the backward line belongs to a taken side only.
  const answered = kind === "backed" ? showedUpFor((closed ?? []).map((p) => p.name ?? "")) : null;

  return (
    <section
      className="mb-4 shrink-0 rounded-xl border p-3"
      style={{
        borderColor: "var(--border-strong,var(--border))",
        background: "color-mix(in oklab, var(--yes) 8%, transparent)",
      }}
    >
      {/* THE PAYOFF LEADS when there is one. Being counted on is a bigger fact
          than having published, so it outranks the headline rather than sitting
          under it. */}
      {answered ? (
        <p className="text-[13px] font-semibold leading-snug text-[var(--text)]">{answered}</p>
      ) : (
        <p className="text-[13px] font-semibold leading-snug text-[var(--text)]">
          {kind === "created" ? "Your market is live." : "Your conviction is out there."}
        </p>
      )}

      {/* NOTHING ELSE. The reach line, the fee line and the put-it-up prompt all
          used to stack here, which made the moment a briefing. Everything they
          said now lives where it can be acted on: the Challenge tab below counts
          what is waiting, and every free slot there is an invitation carrying its
          own market. This says the one fact, and gets out of the way. */}
      <button
        type="button"
        onClick={onDone}
        className="mt-2 text-[11.5px] text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
      >
        Done
      </button>
    </section>
  );
}
