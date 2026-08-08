/**
 * CHALLENGE | NOW — the right rail.
 *
 * TWO QUESTIONS, AND KEEPING THEM APART IS THE WHOLE DESIGN:
 *
 *   CHALLENGE  Where are my people waiting for my take?
 *   NOW        What is happening across Conviction?
 *
 * The tape answers "what is happening"; Challenge answers "what is happening TO
 * YOU". Anything that cannot tell those apart belongs in the tape. That is why
 * this replaced ForYouShelf rather than sitting beside it — the shelf was
 * already reaching for this distinction with four kinds too many.
 *
 * THE LOCKED STATE SHOWS THE DESTINATION. A hidden feature teaches nobody
 * anything; a visible locked one gives a reason to build the DNA that opens it.
 * The threshold is not invented here — `challengeLock` reads the canonical
 * stage gate, which has put "recognizable" at five decisions since long before
 * this panel existed.
 *
 * AND UNLOCKED IS NOT THE SAME AS POPULATED. Five decisions grants access to the
 * social system; the DNA engine still decides whether anyone qualifies to call
 * you. An unlocked, empty panel is a correct state — measured platform-wide, 95%
 * of wallets have no Tribe and no wallet has a Rival — so the empty copy says
 * what is actually true rather than implying something is broken.
 */
import { useState, type ReactNode } from "react";
import { YourTable, useTable } from "@/components/YourTable";
import { useQueryClient } from "@tanstack/react-query";
import { hideCall, useOpenCalls, type OpenCalls } from "@/lib/open-calls";
import { passOnCall } from "@/lib/table.functions";
import { bestEffort, useWalletSession } from "@/hooks/useWalletSession";
import { type Challenge, type CallerRelation } from "@/domain/challenge";
import { convictionMatch } from "@/domain/relationship";
import { RELATIONSHIP_MIN_SHARED } from "@/domain/dna/config";
import { relationshipTone } from "@/lib/dna-labels";
import { PersonAvatar } from "@/components/PersonAvatar";

type Tab = "challenge" | "now";
/**
 * WHOSE TABLE, and the words are chosen against two wrong pairs.
 *
 * NOT Sent/Received — that is messaging, and a Challenge is not a message. NOT
 * Outbound/Inbound — that is plumbing described to a user. The parent surface
 * already says Challenge, so these only have to say whose: the ones you put up,
 * and the ones put in front of you.
 */
type Side = "yours" | "challenged";

/**
 * WHY THERE IS NO ACKNOWLEDGEMENT STATE HERE ANY MORE.
 *
 * This file used to keep a localStorage set (`conviction:call-ack`) so that a
 * "SARAH SHOWED UP" card could be dismissed with an ×. That treated the most
 * durable social evidence the platform produces as a notification — the one fact
 * worth keeping forever was the one fact a tap could delete.
 *
 * Somebody answering your call now accumulates into the relationship itself: the
 * People card says it in a sentence and the profile keeps every instance. Nothing
 * needs dismissing, because nothing is interrupting.
 *
 * What is left here is an ACTION QUEUE. A queue with completed items in it is a
 * to-do list, so an answered call simply stops being derivable and leaves.
 */

/**
 * NOT FOR ME — dismissal, and why it is viewer-local ON PURPOSE.
 *
 * This file deleted a localStorage set one revision ago, so the shape deserves
 * an explanation rather than a shrug. That one acknowledged "SARAH SHOWED UP"
 * notices, and it was wrong because somebody answering your call is the most
 * DURABLE evidence this platform produces — a tap must never be able to delete
 * it. A dismissal is the exact opposite kind of fact, and the reasoning now lives
 * beside the store in `lib/open-calls`, which owns both the query and the
 * dismissed set so the rail and the mobile menu badge can never disagree.
 */
export function ChallengeRail({
  wallet,
  onSelect,
  now,
}: {
  wallet?: string;
  onSelect: (marketId: number) => void;
  /**
   * The live tape, rendered by the route. Passed as a node rather than as five
   * more props: this component is about YOUR calls, and threading the tape's
   * state through it would make it the owner of something it does not decide.
   */
  now: ReactNode;
}) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("challenge");
  const [side, setSide] = useState<Side>("challenged");
  const { ensureSession } = useWalletSession();

  /**
   * NOT FOR ME — hidden here instantly, recorded there eventually.
   *
   * The local hide is what the reader feels; the server write is what makes the
   * creator's "1 passed" true. Best-effort and non-interactive on purpose: waving
   * a card off must never open a wallet prompt, and a failed write costs one
   * uncounted pass rather than a card that refuses to leave.
   */
  const pass = (marketId: number) => {
    hideCall(marketId);
    if (!wallet) return;
    void bestEffort(async () =>
      passOnCall({
        data: {
          wallet,
          session: await ensureSession({ interactive: false }),
          marketId,
        },
      }),
    );
  };
  const { data: table } = useTable(wallet);

  // The open queue, minus anything this reader has waved off. The count follows
  // the list rather than the payload, so the badge always equals what is on
  // screen — three means three people are actually waiting on you.
  const { lock, open, failed } = useOpenCalls(wallet);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="mb-3 flex shrink-0 rounded-[10px] p-0.5"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        role="tablist"
        aria-label="Challenge or Now"
      >
        {(["challenge", "now"] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex grow basis-0 items-center justify-center gap-1.5 rounded-[8px] px-1.5 py-1 text-[12px] font-medium transition-colors ${
              tab === t ? "bg-[var(--bg)] text-[var(--text)]" : "text-[var(--text-muted)]"
            }`}
          >
            {t === "challenge" ? "Challenge" : "Now"}
            {t === "challenge" && !lock.unlocked && <span aria-label="locked">🔒</span>}
            {t === "challenge" && lock.unlocked && open.length > 0 && (
              <span className="num text-[11px] opacity-70">{open.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* WHOSE TABLE. Only once there is a second side to show — a person with
          nothing up has no choice to make, and a control offering one is a
          question the surface is asking for its own benefit. */}
      {tab === "challenge" && wallet && lock.unlocked && (table?.length ?? 0) > 0 && (
        <div className="mb-2 flex shrink-0 gap-3 text-[11px]" role="tablist" aria-label="Whose">
          {(["challenged", "yours"] as Side[]).map((sd) => (
            <button
              key={sd}
              role="tab"
              aria-selected={side === sd}
              type="button"
              onClick={() => setSide(sd)}
              className={`font-medium uppercase tracking-wide transition-colors ${
                side === sd ? "text-[var(--text)]" : "text-[var(--text-muted)]"
              }`}
            >
              {sd === "yours" ? "Yours" : "Challenged"}
              <span className="num ml-1 opacity-70">
                {sd === "yours" ? (table?.length ?? 0) : open.length}
              </span>
            </button>
          ))}
        </div>
      )}

      {tab === "now" ? (
        now
      ) : !wallet ? (
        <p className="text-[11.5px] leading-snug text-[var(--text-muted)]">
          Connect a wallet to see who wants you at the table.
        </p>
      ) : !lock.unlocked ? (
        <LockedPanel lock={lock} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {side === "yours" ? (
            <YourTable wallet={wallet} onSelect={onSelect} />
          ) : failed ? (
            /* A FAILED READ IS NOT AN EMPTY GRAPH.
               `buildChallenges` opens with an unguarded `serviceClient()`, and
               `createClient` throws SYNCHRONOUSLY without a key — so a
               deployment missing SUPABASE_SERVICE_ROLE_KEY threw on every call
               while this panel rendered the calm sentence below, indefinitely.
               Nobody was told, no row was written, and the surface looked
               perfectly healthy. Silence has to be earned by an answer. */
            <p className="text-[11.5px] leading-snug text-[var(--text-muted)]">
              Could not load who is waiting on you. This is a fault on our side, not an empty room —
              try again in a moment.
            </p>
          ) : open.length === 0 ? (
            <p className="text-[11.5px] leading-snug text-[var(--text-muted)]">
              {/* Honest, and deliberately not "no challenges yet!" — the reason
                  is that nobody has qualified, which is a fact about the graph
                  rather than about the reader. Quiet, not broken — the sentence
                  promises the room rather than apologising for it. */}
              Your people are quiet. For now. When your Tribe or Rivals want your take, their open
              questions land here.
            </p>
          ) : (
            <ul className="space-y-2">
              {open.map((c) => (
                <ChallengeRow key={c.marketId} challenge={c} onSelect={onSelect} onDismiss={pass} />
              ))}
            </ul>
          )}

          <button
            type="button"
            onClick={() => {
              void qc.invalidateQueries({ queryKey: ["challenges", wallet] });
            }}
            className="mt-2 text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
          >
            Refresh
          </button>
        </div>
      )}
    </div>
  );
}

/** One open call. The question, who is asking, and the way in. */
/**
 * WHICH RELATION WORDS THIS CARD MAY SAY.
 *
 * `RELATIONSHIP_TEXT` still maps twin→"Twin" and inverse→"Opp", and rendering
 * those here would put words on the Challenge rail that the People rail
 * deliberately withholds — the same person reading "Twin" in one column and no
 * label in the other. Twin and Opp are held back until production evidence
 * supports them, and "held back" has to mean everywhere.
 *
 * So a caller shows the word for the DIRECTION they qualify in. Nothing is lost:
 * the relation still decides who may call and in what order.
 */
const BADGE: Record<CallerRelation, string> = {
  twin: "Tribe",
  tribe: "Tribe",
  opp: "Rival",
  inverse: "Rival",
};

/**
 * ONE CARD, ONE STORY: PERSON → BELIEF → RELATIONSHIP EVIDENCE.
 *
 *     Sarah · TRIBE
 *     Will AI replace software engineers?
 *     Sarah believes YES. Take this one.
 *     82% Conviction Match · 9 of 11 together
 *
 * The belief now sits ABOVE the evidence, and the order is the argument: here is
 * a person, here is what they hold, and here is what your history with them says
 * about whether you will hold it too. The evidence used to sit between the
 * question and the belief, which made the card read as a statistic about a
 * relationship that happened to mention somebody's position.
 *
 * Nothing else earns space, and two things are deliberately absent:
 *
 *  • The wager. "Mike put $500 down" turns a social signal into financial
 *    pressure and would make the loudest voice the wealthiest one. The market
 *    itself shows position and size to anyone who opens it.
 *  • An Accept button. Opening is not accepting — TAKING A SIDE is. A CTA here
 *    would add a step before the only step that means anything.
 *
 * THE CARD IS THE AFFORDANCE. Clicking anywhere opens the market in the centre,
 * which is where the decision belongs.
 */
function ChallengeRow({
  challenge: c,
  onSelect,
  onDismiss,
}: {
  challenge: Challenge;
  onSelect: (marketId: number) => void;
  onDismiss: (marketId: number) => void;
}) {
  const badge = BADGE[c.relation];
  const tone = relationshipTone(c.relation);
  // The SAME calculation the People card and the profile use. A pair cannot be
  // 82% in one surface and 79% in another, so nothing is recomputed here.
  const match = convictionMatch(c.together ?? 0, c.shared ?? 0);
  const showMatch = match != null && (c.shared ?? 0) >= RELATIONSHIP_MIN_SHARED;

  return (
    <li className="relative">
      <button
        type="button"
        onClick={() => onSelect(c.marketId)}
        aria-label={[
          c.caller.name,
          badge,
          c.title,
          showMatch
            ? `${match} percent Conviction Match, ${c.together} of ${c.shared} together`
            : null,
          c.reason,
        ]
          .filter(Boolean)
          .join(". ")}
        className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 pr-9 text-left transition-colors hover:border-[var(--border-strong)]"
      >
        {/* WHO — named here rather than only inside the sentence below, so the
            card has a subject before it has a claim. */}
        <div className="flex items-center gap-2">
          <PersonAvatar wallet={c.caller.wallet} name={c.caller.name ?? undefined} size={22} />
          <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[var(--text)]">
            {c.caller.name}
          </span>
          <span
            className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
            style={{ color: tone.fg, background: tone.bg }}
          >
            {badge}
          </span>
        </div>

        {/* WHAT THEY WERE ASKED */}
        <p className="mt-1.5 line-clamp-2 text-[13px] leading-snug text-[var(--text)]">{c.title}</p>

        {/* WHAT THEY BELIEVE. It never names a side the reader has not taken. */}
        <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-[var(--text-secondary)]">
          {c.reason}
        </p>

        {/* WHY THEIR BELIEF IS WORTH YOUR TIME — the record between the two of
            you, and the arithmetic that proves it. Last, because it explains the
            line above rather than competing with it. Withheld below the evidence
            bar rather than shown as a confident percentage over one shared
            conviction. */}
        {showMatch && (
          <p className="num mt-1.5 text-[11px] text-[var(--text-muted)]">
            {match}% Conviction Match · {c.together} of {c.shared} together
          </p>
        )}
      </button>

      {/* NOT FOR ME — quiet, and private. Never "Decline": nothing is reported
          to the caller, nothing is written down, and no relationship number
          moves. Showing up is worth celebrating; not showing up is simply the
          absence of that, and a product that ledgered it would be keeping score
          of the wrong thing.

          SIZED FOR A THUMB. The glyph stays small, but the hit area is a full
          32px square: this control sits on top of a card whose entire body is
          the affordance, so on a phone a near-miss dismisses the call instead of
          opening it — and dismissal is deliberately undoable by nothing. The
          opacity is no longer hover-only for the same reason. A phone has no
          hover, so `opacity-50 hover:opacity-100` left the × permanently at half
          strength on the surface where it was hardest to hit. */}
      <button
        type="button"
        onClick={() => onDismiss(c.marketId)}
        aria-label={`Hide this call from ${c.caller.name ?? "them"}`}
        title="Not for me"
        className="absolute right-0 top-0 flex h-8 w-8 items-center justify-center text-[15px] leading-none text-[var(--text-muted)] opacity-60 transition-opacity hover:opacity-100"
      >
        ×
      </button>
    </li>
  );
}

/** The destination, shown rather than hidden. */
function LockedPanel({ lock }: { lock: OpenCalls["lock"] }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <p className="text-[13px] font-semibold text-[var(--text)]">{lock.title}</p>
      <div className="mt-2 flex items-center gap-1.5" aria-hidden>
        {Array.from({ length: lock.total }, (_, i) => (
          <span
            key={i}
            className="h-2 w-2 rounded-full"
            style={{ background: i < lock.filled ? "var(--text)" : "var(--border)" }}
          />
        ))}
      </div>
      <p className="mt-1.5 num text-[11px] text-[var(--text-muted)]">
        {lock.filled} of {lock.total} convictions
      </p>
      {lock.detail && (
        <p className="mt-1 text-[11.5px] leading-snug text-[var(--text-secondary)]">
          {lock.detail}
        </p>
      )}
    </div>
  );
}
