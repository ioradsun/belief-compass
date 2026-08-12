/**
 * CHALLENGE | INSIDER — the right rail.
 *
 * TWO QUESTIONS, AND KEEPING THEM APART IS THE WHOLE DESIGN:
 *
 *   CHALLENGE  Where are my people waiting for my take?
 *   INSIDER    What is happening across Conviction?
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
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChainList } from "@/components/ChainList";
import { useChallengeSent } from "@/lib/challenge-signal";
import { useTable } from "@/components/YourTable";
import { useSimulationMode } from "@/lib/simulation-mode";
import { hideCall, useOpenCalls, type OpenCalls } from "@/lib/open-calls";
import { ChallengeCardList } from "@/components/ChallengeCardList";
import { passOnCall } from "@/lib/table.functions";
import { bestEffort, useWalletSession } from "@/hooks/useWalletSession";
import { CHALLENGE, type Challenge, type CallerRelation } from "@/domain/challenge";
import { convictionMatch } from "@/domain/relationship";
import { backAndForthLine, outcomeLine, runEndedLine } from "@/domain/dependability";
import { RELATIONSHIP_MIN_SHARED } from "@/domain/dna/config";
import { relationshipTone } from "@/lib/dna-labels";
import { PersonAvatar } from "@/components/PersonAvatar";
import { ChallengeHistory } from "@/components/ChallengeHistory";

type Tab = "challenge" | "insider";

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
  onSelectPerson,
  insider,
  insiderCount,
  onOpenHistory,
}: {
  wallet?: string;
  onSelect: (marketId: number) => void;
  /**
   * Open somebody's profile — where the pair's own complete history already
   * lives. Optional, so the lab can mount the rail without a router.
   */
  onSelectPerson?: (personWallet: string) => void;
  /**
   * The Insider feed (live tape), rendered by the route. Passed as a node rather
   * than as five more props: this component is about YOUR calls, and threading
   * the tape's state through it would make it the owner of something it does not
   * decide.
   */
  insider: ReactNode;
  /** Stories the tape is holding back — the only number the Insider tab may say. */
  insiderCount?: number;
  /** Open Past Challenges in the centre column instead of a sheet over the rail. */
  onOpenHistory?: () => void;
}) {
  /**
   * NO CHALLENGES MEANS INSIDER. An empty Challenge tab is a dead first screen,
   * so the rail always opens on Insider — the one thing that is true for
   * everyone — and only promotes Challenge once real open calls exist for this
   * reader. A reader who picks a tab themselves keeps it.
   */
  const [tab, setTab] = useState<Tab>("insider");
  const chose = useRef(false);
  const pick = (t: Tab) => {
    chose.current = true;
    setTab(t);
  };

  /** How many of the open calls are on screen. A railful, then a railful more. */
  const [shown, setShown] = useState<number>(CHALLENGE.maxOpen);
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
  // The rail shows the table for the ledger the reader is in — three Simulation
  // Challenges must not make a real table look full, or the reverse.
  const { active: simulating } = useSimulationMode();
  const { data: table } = useTable(wallet, simulating ? "SIMULATION" : "REAL");

  // The open queue, minus anything this reader has waved off, plus what recently
  // became of the ones that were waiting. The count follows the WAITING list
  // rather than the payload, so the badge always equals the number of people
  // actually waiting on you — an outcome is the payoff, never another chore.
  const { lock, open, recent, failed, lockUnknown } = useOpenCalls(wallet);

  // Challenge earns the rail only when someone is actually waiting. Until then
  // — signed out, locked, or an empty queue — Insider holds it.
  useEffect(() => {
    if (chose.current) return;
    if (wallet && lock.unlocked && open.length > 0) setTab("challenge");
    else setTab("insider");
  }, [wallet, lock.unlocked, open.length]);

  /**
   * A SENT CHALLENGE TURNS THIS RAIL TO IT — including for a reader who had
   * chosen Insider. Putting a question up is the one action whose result lives
   * here and nowhere else; leaving them on the other tab would make the thing
   * they just did invisible at the exact moment they made it.
   */
  const sent = useChallengeSent();
  useEffect(() => {
    if (sent) setTab("challenge");
  }, [sent?.at]);

  /**
   * WHAT THE NUMBER ON THE TAB COUNTS: everything in the column that is still
   * live — people waiting on you, plus what you have up. Finished rows are
   * history, not a queue, so they are not counted.
   */
  const challengeCount = open.length + (table ?? []).filter((r) => r.closedAtMs == null).length;

  /**
   * HOW MANY ARE IN EACH DIRECTION — read from the same projection the list
   * renders, through the same query key, so the filter labels can never count
   * something the column does not show.
   */
  const { data: allCards } = useChallengeCards(wallet);
  const liveCards = (allCards ?? []).filter((p) => isLiveCard(p.state));
  const mineCount = liveCards.filter(isOutwardCard).length;
  const cardCounts = {
    all: liveCards.length,
    mine: mineCount,
    theirs: liveCards.length - mineCount,
  };
  const [direction, setDirection] = useState<ChallengeDirection>("all");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="mb-3 flex shrink-0 rounded-[10px] p-0.5"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        role="tablist"
        aria-label="Challenge or Insider"
      >
        {(["challenge", "insider"] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            type="button"
            onClick={() => pick(t)}
            className={`flex grow basis-0 items-center justify-center gap-1.5 rounded-[8px] px-1.5 py-1 text-[12px] font-medium transition-colors ${
              tab === t ? "bg-[var(--bg)] text-[var(--text)]" : "text-[var(--text-muted)]"
            }`}
          >
            {t === "challenge" ? "Challenge" : "Insider"}
            {/* No padlock while the lock is unknown — the tab strip must not
                claim a state the panel below it is refusing to claim. */}
            {t === "challenge" && !lock.unlocked && !lockUnknown && (
              <span aria-label="locked">🔒</span>
            )}
            {t === "challenge" && lock.unlocked && challengeCount > 0 && (
              <span className="num text-[11px] opacity-70">{challengeCount}</span>
            )}
            {/* WHAT IS WAITING, NOT WHAT EXISTS. The tape holds new stories back
                until they are asked for, so this is the same number the "↑ new"
                pill would show — never a total, which would just be noise. */}
            {t === "insider" && tab !== "insider" && (insiderCount ?? 0) > 0 && (
              <span className="num text-[11px] opacity-70">{insiderCount}</span>
            )}
          </button>
        ))}
      </div>

      {/* THE TAPE STAYS MOUNTED WHILE YOU ARE ON THE OTHER TAB. That is what
          makes the Insider number mean anything: arrivals have to keep queueing
          while nobody is looking, or the badge would only ever say zero. */}
      <div className={tab === "insider" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>{insider}</div>
      {tab === "insider" ? null : !wallet ? (
        <p className="text-[11.5px] leading-snug text-[var(--text-muted)]">
          Connect a wallet to see who wants you at the table.
        </p>
      ) : lockUnknown ? (
        /* THE LOCK IS A CLAIM ABOUT THE READER'S OWN HISTORY, so it may only be
           made from an answer. `challengeLock` reads `expressedBeliefs`, and an
           unread payload becomes 0 via `?? 0` — which renders the first-run
           sentence, "Take 5 sides and we'll work out who your people are", to
           somebody who has taken forty. That is worse than an error message: it
           is a confident, welcoming, wrong statement about what they have done.
           Silence has to be earned by an answer, and so does onboarding. */
        <p className="text-[11.5px] leading-snug text-[var(--text-muted)]">
          Could not load your people. This is a fault on our side — try again in a moment.
        </p>
      ) : !lock.unlocked ? (
        <LockedPanel lock={lock} />
      ) : (
        /* ONE LIST, NOT TWO SIDES. "Challenged" and "Yours" were a filter over a
           handful of cards, and the card already says which it is: an incoming
           call names the person asking, one of yours carries its own progress,
           and a free slot is an invitation. Tabs over that were a control asking
           the reader to sort a stack of three. */
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          {/* DIRECTION IS AN ATTRIBUTE, NOT A TAB. "I Challenged" and
              "Challenged Me" are two ends of one conversation — a third tab
              would cut a chain in half and give the reader two empty states to
              read. A segmented control filters the same list in place, and the
              counts are said out loud so nothing is hidden behind an icon. */}
          {!failed && cardCounts.all > 0 && (
            <div
              className="flex items-center gap-1 rounded-[9px] p-0.5"
              role="group"
              aria-label="Filter challenges by direction"
            >
              <SlidersHorizontal
                size={12}
                className="mx-1 shrink-0 text-[var(--text-muted)]"
                aria-hidden
              />
              {(
                [
                  ["all", "All", cardCounts.all],
                  ["mine", "I Challenged", cardCounts.mine],
                  ["theirs", "Challenged Me", cardCounts.theirs],
                ] as const
              ).map(([key, label, n]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={direction === key}
                  onClick={() => setDirection(key)}
                  className={`flex items-center gap-1 rounded-[7px] px-1.5 py-1 text-[10.5px] font-medium transition-colors ${
                    direction === key
                      ? "bg-[var(--surface)] text-[var(--text)]"
                      : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                  }`}
                >
                  {key !== "all" && (
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: key === "mine" ? "var(--yes)" : "var(--no)" }}
                      aria-hidden
                    />
                  )}
                  {label}
                  <span className="num tabular-nums opacity-60">{n}</span>
                </button>
              ))}
            </div>
          )}

          {failed ? (
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
          ) : null}

          {/* NOTHING IN PLAY IS A REAL STATE, AND A COMMON ONE. With finished
              cards moved to Past Challenges, a reader with no live loop sees an
              empty column — so it says what is true rather than nothing, and the
              history link right below is where their outcomes went. Withheld on a
              failed read, which is not an empty room. `challengeCount` is zero
              exactly when no card is still live: nobody waiting on you, nothing
              of yours still gathering answers. */}
          {!failed && challengeCount === 0 && (
            <p className="text-[11.5px] leading-snug text-[var(--text-muted)]">
              Nothing waiting on you right now.
            </p>
          )}

          {/* ONE LIST, ONE CARD PER QUESTION.
              "Challenged You" and "You Challenged" were the same market twice
              whenever a reader was brought into a question and then relayed it —
              two cards, no visible connection, and the chain passing THROUGH a
              person was the one thing this column could not show. `ChainList`
              merges them by market and lets a single card change colour as the
              reader stops being the one who was asked and becomes the one
              asking. */}
          {/* ONE DURABLE CARD PER RELATIONSHIP. `ChainList` merged incoming
              calls by market, which was right as far as it went — but a reader
              who had also put the question up still had a SECOND card for it on
              the Yours tab, and neither could see the other. `challengeCardsFor`
              projects both directions into one object with one state, so a card
              now evolves from "Maya brought you in" through "you showed up" to
              "Casey kept it moving" without ever becoming two things. */}
          {/* CURRENT ONLY. The column is the live social loop — waiting on you,
              yours still gathering answers, a chain still moving. What finished
              is not deleted; it moves to Past Challenges below, so this stops
              being a place to monitor closed outcomes and stays a place to act. */}
          <ChallengeCardList
            wallet={wallet}
            limit={shown + CHALLENGE.maxRecent}
            onSelect={onSelect}
            onPass={pass}
            activeOnly
          />

          {/* MORE, SAID OUT LOUD. A railful is what reads as a set of things
              waiting for you; past that it becomes a feed, and the feed already
              exists one tab across. But the rest are not discarded — a call is
              somebody's deliberate request, and hiding it without saying so
              would lose it. The count is exact because the server read them. */}
          {open.length > shown && (
            <button
              type="button"
              onClick={() => setShown((n) => n + CHALLENGE.maxOpen)}
              className="mt-2 block text-[11.5px] text-[var(--text)] underline"
            >
              {open.length - shown} more waiting
            </button>
          )}

          {/* THE WAY OUT OF THE RAIL, AND THE ONLY ONE.
              Everything above goes quiet after a week, which is right for a
              column somebody has to look past to reach the tape — and wrong as
              the end of the story. "See all" is where the whole thing lives:
              every challenge, both directions, chronological, complete. It sits
              last because it is the least urgent thing here and because a reader
              only wants it once they have read what is above it. */}
          <ChallengeHistory
            wallet={wallet}
            onSelect={onSelect}
            onSelectPerson={onSelectPerson}
            onOpen={onOpenHistory}
          />
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
  // Same two words as the audience heading and the lab badge — one vocabulary
  // for one relationship, wherever the reader meets it.
  neutral: "Still Forming",
  insufficient: "Still Forming",
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
  /**
   * THE CARD AFTER SOMETHING HAPPENED.
   *
   * `waiting` is unchanged in every respect. The other two states are the same
   * card with its question answered: the prompt goes (it would be inviting an act
   * already taken), the outcome takes its place, and the × goes with it because
   * there is nothing left to wave off.
   *
   * QUIETER, NOT DISABLED — the same dashed, transparent treatment the outbound
   * side already uses for a Challenge that ended, and for the same stated reason:
   * this is the best thing that happens here, so it steps back because it no
   * longer needs anything from the reader, not because it stopped mattering.
   */
  const done = c.state !== "waiting";
  const outcome = outcomeLine(c.state, c.caller.name ?? "");
  // The run, said in the product's own words. Never on a card whose pair has not
  // actually gone both ways — see `backAndForthLine`.
  const run = c.reciprocity
    ? (backAndForthLine(c.reciprocity) ?? runEndedLine(c.reciprocity))
    : null;

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
          done ? outcome : c.reason,
          run,
        ]
          .filter(Boolean)
          .join(". ")}
        className={`w-full rounded-xl border p-3 pr-9 text-left transition-colors ${
          done
            ? "border-dashed border-[var(--border)] bg-transparent hover:border-[var(--border-strong)]"
            : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)]"
        }`}
      >
        {/* WHO — named here rather than only inside the sentence below, so the
            card has a subject before it has a claim. */}
        <div className="flex items-center gap-2">
          {/* NOT ITS OWN TARGET. The whole card is a button, so a clickable face
              inside it would be a button inside a button — invalid markup that
              breaks hydration, and a second destination on a card whose entire
              body is meant to open the market. The face identifies; it does not
              navigate. */}
          <PersonAvatar
            wallet={c.caller.wallet}
            name={c.caller.name ?? undefined}
            size={22}
            interactive={false}
          />
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
        <p
          className={`mt-1.5 line-clamp-2 text-[13px] leading-snug ${done ? "text-[var(--text-secondary)]" : "text-[var(--text)]"}`}
        >
          {c.title}
        </p>

        {/* WHAT THEY BELIEVE. It never names a side the reader has not taken.
            Gone once the reader HAS taken one: "Maya believes YES. Take this one."
            beside a position already held is the product asking for something it
            already got. */}
        {!done && (
          <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-[var(--text-secondary)]">
            {c.reason}
          </p>
        )}

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

        {/* WHAT HAPPENED. The one line this whole surface exists to be able to
            print, and it took the place of the row silently disappearing.

            NOT A STATUS, AND NOT A SIDE. "You showed up for Maya" is true whether
            the reader answered YES or NO — the sentence has no branch on agreement
            because its input cannot carry one. Nothing here says "completed",
            "responded" or "answered by": those describe a record changing, and what
            actually happened is that two people put their convictions on the table. */}
        {done && outcome && (
          <p className="mt-1.5 text-[12px] leading-snug font-medium text-[var(--text)]">
            {outcome}
          </p>
        )}

        {/* THE RUN — what the two of you have actually done, compressed.
            No flame, no personal best, no word that would make it a score. */}
        {run && <p className="num mt-1 text-[11px] text-[var(--text-muted)]">{run}</p>}
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
          strength on the surface where it was hardest to hit.

          GONE ONCE THE CARD HAS AN ENDING. There is nothing left to wave off, and
          a control that would re-record a choice already made is worse than
          absent — it invites a reader to undo something the other person has
          already been told about. */}
      {!done && (
        <button
          type="button"
          onClick={() => onDismiss(c.marketId)}
          aria-label={`Pass on this call from ${c.caller.name ?? "them"}`}
          title="Not for me"
          className="absolute right-0 top-0 flex h-8 w-8 items-center justify-center text-[15px] leading-none text-[var(--text-muted)] opacity-60 transition-opacity hover:opacity-100"
        >
          ×
        </button>
      )}
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
