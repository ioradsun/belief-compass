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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { networkQO } from "@/lib/network-query";
import { getAnsweredCalls, getChallenges } from "@/lib/challenge.functions";
import { challengeLock, type Challenge } from "@/domain/challenge";
import { RELATIONSHIP_TEXT, relationshipTone } from "@/lib/dna-labels";
import { PersonAvatar } from "@/components/PersonAvatar";

type Tab = "challenge" | "now";

/** Acknowledged "showed up" notices, so an answer is celebrated once. */
const ACK_KEY = "conviction:call-ack";
function acknowledged(): Set<string> {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(ACK_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
function acknowledge(id: string) {
  try {
    const next = acknowledged();
    next.add(id);
    // Bounded: this is a courtesy list, not a history, and an unbounded one
    // would grow forever in storage a reader never asked us to use.
    window.localStorage.setItem(ACK_KEY, JSON.stringify([...next].slice(-100)));
  } catch {
    /* storage unavailable — the notice simply reappears, which is harmless */
  }
}

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
  const [acks, setAcks] = useState<Set<string>>(() =>
    typeof window === "undefined" ? new Set() : acknowledged(),
  );

  // The same cached observer DnaFirstReveal uses — the lock costs no round trip.
  const { data: net } = useQuery({ ...networkQO(wallet), enabled: !!wallet });
  const lock = challengeLock(net?.summary.expressedBeliefs ?? 0, (net?.summary.twinCount ?? 0) > 0);

  const { data: challenges } = useQuery({
    queryKey: ["challenges", wallet ?? null],
    queryFn: () => getChallenges({ data: { wallet: wallet ?? null } }),
    enabled: !!wallet && lock.unlocked,
    staleTime: 60_000,
  });

  const { data: answers } = useQuery({
    queryKey: ["answered-calls", wallet ?? null],
    queryFn: () => getAnsweredCalls({ data: { wallet: wallet ?? null } }),
    enabled: !!wallet && lock.unlocked,
    staleTime: 60_000,
  });

  const open = challenges ?? [];
  const fresh = (answers ?? []).filter((a) => !acks.has(`${a.marketId}`));

  const dismiss = (marketId: number) => {
    acknowledge(String(marketId));
    setAcks(new Set([...acks, String(marketId)]));
  };

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

      {tab === "now" ? (
        now
      ) : !wallet ? (
        <p className="text-[11.5px] leading-snug text-[var(--text-muted)]">
          Connect a wallet to see who is waiting on your take.
        </p>
      ) : !lock.unlocked ? (
        <LockedPanel lock={lock} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* SOMEBODY SHOWED UP — above the open calls, briefly. It is the one
              thing here with no action in it, so it must not hold an actionable
              slot permanently; dismissing files it as history. */}
          {fresh.map((a) => (
            <div
              key={`ans-${a.marketId}`}
              className="mb-2 rounded-xl border p-2.5"
              style={{
                borderColor: "var(--border-strong,var(--border))",
                background: "color-mix(in oklab, var(--yes) 8%, transparent)",
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text)]">
                  {a.headline}
                </span>
                <button
                  type="button"
                  onClick={() => dismiss(a.marketId)}
                  aria-label="Dismiss"
                  className="px-1 text-[13px] leading-none text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
                >
                  ×
                </button>
              </div>
              <p className="mt-0.5 text-[11.5px] text-[var(--text-secondary)]">{a.body}</p>
              <button
                type="button"
                onClick={() => onSelect(a.marketId)}
                className="mt-1 line-clamp-2 text-left text-[12.5px] leading-snug text-[var(--text)] underline underline-offset-2"
              >
                {a.title}
              </button>
            </div>
          ))}

          {open.length === 0 ? (
            <p className="text-[11.5px] leading-snug text-[var(--text-muted)]">
              {/* Honest, and deliberately not "no challenges yet!" — the reason
                  is that nobody has qualified, which is a fact about the graph
                  rather than about the reader. */}
              Nobody is waiting on you right now. As your Tribe and Rivals take sides, their open
              questions land here.
            </p>
          ) : (
            <ul className="space-y-2">
              {open.map((c) => (
                <ChallengeRow key={c.marketId} challenge={c} onSelect={onSelect} />
              ))}
            </ul>
          )}

          <button
            type="button"
            onClick={() => {
              void qc.invalidateQueries({ queryKey: ["challenges", wallet] });
              void qc.invalidateQueries({ queryKey: ["answered-calls", wallet] });
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
function ChallengeRow({
  challenge: c,
  onSelect,
}: {
  challenge: Challenge;
  onSelect: (marketId: number) => void;
}) {
  const tone = relationshipTone(c.relation);
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(c.marketId)}
        className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-left transition-colors hover:border-[var(--border-strong)]"
      >
        <div className="flex items-start gap-2">
          <PersonAvatar wallet={c.caller.wallet} name={c.caller.name ?? undefined} size={22} />
          <div className="min-w-0 flex-1">
            <span
              className="inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={{ color: tone.fg, background: tone.bg }}
            >
              {RELATIONSHIP_TEXT[c.relation]}
            </span>
            <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-[var(--text)]">
              {c.title}
            </p>
          </div>
        </div>
        {/* THE CALL ITSELF — what they did, and the question back to you. It
            never names a side you have not taken. */}
        <p className="mt-1.5 line-clamp-2 text-[11.5px] leading-snug text-[var(--text-secondary)]">
          {c.reason}
        </p>
      </button>
    </li>
  );
}

/** The destination, shown rather than hidden. */
function LockedPanel({ lock }: { lock: ReturnType<typeof challengeLock> }) {
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
