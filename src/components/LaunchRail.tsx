/**
 * YOUR PEOPLE GOT THE CALL — what a creator sees the moment a market is live.
 *
 * WHAT THIS REPLACED, and the replacement is mostly deletion. This was a
 * recruitment panel: five audiences, an Invite button per person, a stored
 * invitation each, and a Launch Progress ladder measuring what came of them. It
 * asked a creator to do casting before anyone had read their question.
 *
 * Challenge makes all of that unnecessary. Publishing a market ALREADY calls
 * everyone who qualifies — the market becomes eligible for their Challenge
 * surface the moment it exists — so there is nothing to send and nothing to
 * pick. What is left is the one useful thing: telling the creator that it
 * happened.
 *
 * CREATION AND PARTICIPATION USE THE SAME SENTENCE. Taking a side calls your
 * people exactly as creating a market does, so this component renders after
 * both. Two recruitment systems collapse into one line of feedback.
 *
 * NEVER "NOTIFIED". There is no notification channel on this platform: no
 * email, no push, no service worker, no inbox. "Got the call" is true in the
 * only sense available — this market is now eligible for their Challenge
 * surface — and `callReachLine` refuses to render a zero rather than showing
 * "0 Tribe · 0 Rivals", which reads as a scoreboard the creator is losing when
 * the truth is that a network is still forming.
 */
import { useQuery } from "@tanstack/react-query";
import { getCallReach } from "@/lib/challenge.functions";
import { callReachLine } from "@/domain/challenge";

/**
 * WHICH ACT JUST HAPPENED. Only the first line differs — the reach sentence,
 * the empty-network sentence and the dismissal are identical, because the
 * underlying fact is identical: qualified people can now see this market on
 * their Challenge surface because of something this viewer did.
 */
const HEADLINE: Record<"created" | "backed", string> = {
  created: "Your market is live.",
  backed: "You took a side.",
};

export function LaunchRail({
  wallet,
  kind = "created",
  onDone,
}: {
  wallet?: string;
  kind?: "created" | "backed";
  /** Dismiss the moment — the market is just a market now. */
  onDone: () => void;
}) {
  const { data: reach } = useQuery({
    queryKey: ["call-reach", wallet ?? null],
    queryFn: () => getCallReach({ data: { wallet: wallet ?? null } }),
    enabled: !!wallet,
    staleTime: 60_000,
  });

  if (!wallet) return null;
  const line = reach ? callReachLine(reach) : null;

  return (
    <section
      className="mb-4 shrink-0 rounded-xl border p-3"
      style={{
        borderColor: "var(--border-strong,var(--border))",
        background: "color-mix(in oklab, var(--yes) 8%, transparent)",
      }}
    >
      <p className="text-[13px] font-semibold leading-snug text-[var(--text)]">{HEADLINE[kind]}</p>
      {line ? (
        <>
          <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--text-secondary)]">
            Your people got the call.
          </p>
          <p className="num mt-1 text-[12px] text-[var(--text)]">{line}</p>
        </>
      ) : (
        /* Nobody qualifies yet, and saying so plainly beats a zero. The market
           still stands; it simply has no relationships pointing at it. */
        <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--text-secondary)]">
          As your Tribe and Rivals form, questions like this one reach them automatically.
        </p>
      )}
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
