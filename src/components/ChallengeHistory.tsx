/**
 * PAST CHALLENGES — the record of what my questions did, told as a story.
 *
 * THE RAIL AND THIS ANSWER DIFFERENT QUESTIONS, and keeping them apart is the
 * whole point. The rail is the live loop — who is waiting on me, what of mine is
 * still gathering answers — and it stays short because a finished Challenge stops
 * being in the way. This is "what became of the questions I put up": complete,
 * grouped by the EVENT rather than the recipient, and reached only on purpose.
 *
 * ONE EVENT, ONE CARD — THE ANTI-INBOX RULE. A question I put to thirty people is
 * one thing I did, and it reads as one card: my call, how many showed up, who
 * they were, and what their answers revealed. The old page rendered a row per
 * recipient — "WAITING ON A · WAITING ON B …" thirty times over — which turned a
 * single act into a log and destroyed every scent of hierarchy. The meaningful
 * number is six challenges, never a hundred and two call rows.
 *
 * SHOWING UP IS THE HEADLINE AND IT IS SIDE-BLIND; agreement is the reveal beneath
 * it, in the product's warm register. Nobody is named for not showing up — a
 * responder took a public position and is shown, a passer is counted and never
 * named. All of that lives in `domain/challenge-past`; this file only renders it.
 *
 * IT IS NOT A FEED. No scoring, no ranking, no "interesting enough" — the order is
 * time and the contents are everything I did. The read costs the rail nothing
 * until somebody opens the sheet.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sheet } from "@/components/Sheet";
import { PersonAvatar } from "@/components/PersonAvatar";
import { getChallengePast } from "@/lib/challenge.functions";
import {
  completionSupport,
  discoveryLine,
  groupPast,
  otherSide,
  pastOverview,
  showedUpForLine,
  showedUpLine,
  statusLabel,
  tribeLine,
  type PastChallenge,
  type PastResponder,
  type ShowedUpEntry,
} from "@/domain/challenge-past";

export const pastKey = (wallet?: string) => ["challenge-past", wallet ?? null] as const;

/**
 * The control, and where it leads.
 *
 * IT OPENS IN THE CENTRE, NOT OVER IT. A history is something a reader studies —
 * a sheet on top of the rail it came from is a glance surface. When the host
 * gives it a destination (`onOpen`) the arrow points LEFT, at the column that
 * will hold it; without one it falls back to the sheet.
 */
export function ChallengeHistory({
  wallet,
  onSelect,
  onSelectPerson,
  onOpen,
}: {
  wallet?: string;
  onSelect: (marketId: number) => void;
  onSelectPerson?: (personWallet: string) => void;
  /** Open it in the centre panel instead of a sheet. */
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (!wallet) return null;

  return (
    <>
      {/* THE WAY OUT OF THE RAIL, AND THE ONLY ONE. Everything above it is the
          live loop and goes quiet; this is where the whole record lives. It sits
          last because it is the least urgent thing here. */}
      <button
        type="button"
        onClick={() => (onOpen ? onOpen() : setOpen(true))}
        className="mt-1 block text-[11.5px] text-[var(--text-secondary)] underline-offset-2 transition-colors hover:text-[var(--text)] hover:underline"
      >
        {onOpen ? "← Challenge History" : "Challenge History →"}
      </button>

      {open && (
        <Sheet onClose={() => setOpen(false)} title="Past Challenges">
          <ChallengeHistoryPanel
            wallet={wallet}
            onSelect={onSelect}
            onSelectPerson={onSelectPerson}
            onExplore={() => setOpen(false)}
          />
        </Sheet>
      )}
    </>
  );
}

/**
 * THE HISTORY ITSELF, with no container of its own — so the same record reads
 * the same whether it is in the centre column or a sheet.
 */
export function ChallengeHistoryPanel({
  wallet,
  onSelect,
  onSelectPerson,
  onExplore,
}: {
  wallet?: string;
  onSelect: (marketId: number) => void;
  onSelectPerson?: (personWallet: string) => void;
  onExplore?: () => void;
}) {
  const { data, isError } = useQuery({
    queryKey: pastKey(wallet),
    queryFn: () => getChallengePast({ data: { wallet: wallet ?? null } }),
    enabled: !!wallet,
    staleTime: 60_000,
  });

  const items = data?.items ?? [];
  const eras = useMemo(() => groupPast(items, Date.now()), [items]);
  const overview = useMemo(() => pastOverview(items), [items]);
  const showedUp = data?.showedUp ?? [];
  const nothing = items.length === 0 && showedUp.length === 0;

  if (!wallet) return null;

  /* A FAILED READ IS NOT AN EMPTY HISTORY. The confident zero would tell
     somebody with a year of relationships that they never challenged anybody. */
  if (isError)
    return (
      <p className="py-6 text-[12px] leading-snug text-[var(--text-muted)]">
        Could not load your history. This is a fault on our side, not an empty one — try again in a
        moment.
      </p>
    );
  if (data == null)
    return <p className="py-6 text-[12px] text-[var(--text-muted)]">Reading your history…</p>;
  if (nothing) return <EmptyState onExplore={() => onExplore?.()} />;

  return (
    <div className="space-y-6 pb-2">
      {items.length > 0 && <Overview overview={overview} />}

      {eras.map((era) => (
        <section key={era.key}>
          <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
            {era.label}
          </h4>
          <div className="space-y-2.5">
            {era.items.map((pc) => (
              <PastCard key={pc.marketId} pc={pc} onSelect={onSelect} />
            ))}
          </div>
        </section>
      ))}

      {showedUp.length > 0 && (
        <ShowedUpSection rows={showedUp} onSelect={onSelect} onSelectPerson={onSelectPerson} />
      )}

      {/* SAID OUT LOUD. A history that stopped at its read bound without
          mentioning it would claim a completeness it does not have. */}
      {data.truncated && (
        <p className="text-[11px] leading-snug text-[var(--text-muted)]">
          Showing your most recent challenges. There are older ones behind these.
        </p>
      )}
    </div>
  );
}


/**
 * ORIENTATION, NOT A DASHBOARD. Four numbers that help a reader understand their
 * own history — how many questions they put up, how many answers those drew, and
 * the two shares that say something about their people. The rates are absent
 * rather than zeroed when there is nothing to divide.
 */
function Overview({ overview }: { overview: ReturnType<typeof pastOverview> }) {
  const stats: { value: string; label: string }[] = [
    { value: String(overview.challenges), label: overview.challenges === 1 ? "challenge" : "challenges" },
    { value: String(overview.responses), label: overview.responses === 1 ? "response" : "responses" },
  ];
  if (overview.showedUpPct != null) stats.push({ value: `${overview.showedUpPct}%`, label: "showed up" });
  if (overview.agreedPct != null)
    stats.push({ value: `${overview.agreedPct}%`, label: "agreed with you" });

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <h3 className="text-[12px] font-semibold text-[var(--text)]">Your challenge history</h3>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5">
        {stats.map((s) => (
          <div key={s.label} className="flex items-baseline gap-1.5">
            <span className="num text-[14px] font-semibold text-[var(--text)]">{s.value}</span>
            <span className="text-[11px] text-[var(--text-muted)]">{s.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * ONE HISTORICAL ITEM: WHAT I BELIEVED, WHO SHOWED UP, WHAT WE DISCOVERED.
 *
 * The reader should understand what happened without opening it. Opening reveals
 * the people, grouped by which way they went — the one place individual names
 * become useful, and the one place the "still out" number stays a number.
 */
function PastCard({ pc, onSelect }: { pc: PastChallenge; onSelect: (marketId: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  const showed = showedUpLine(pc);
  const discovery = discoveryLine(pc);
  const tribe = tribeLine(pc);
  const support = completionSupport(pc);

  return (
    <article className="rounded-xl border border-[var(--border)] p-3">
      <div className="flex items-start justify-between gap-3">
        {/* THE QUESTION — a market to open, not just a label. */}
        <button
          type="button"
          onClick={() => onSelect(pc.marketId)}
          className="min-w-0 flex-1 text-left text-[13px] font-medium leading-snug text-[var(--text)] underline-offset-2 hover:underline"
        >
          {pc.title}
        </button>
        <span className="mt-0.5 shrink-0 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
          {statusLabel(pc)}
        </span>
      </div>

      {/* WHAT I BACKED — the belief this Challenge was a test of. */}
      {pc.yourSide && (
        <p className="mt-1 text-[11.5px] text-[var(--text-secondary)]">
          Your call: <span className="font-semibold text-[var(--text)]">{pc.yourSide}</span>
        </p>
      )}

      {/* THE HEADLINE FACT — side-blind, and the faces that make it an invitation. */}
      {showed && <p className="num mt-1.5 text-[12px] text-[var(--text)]">{showed}</p>}
      {pc.responders.length > 0 && (
        <div className="mt-2">
          <ResponderFaces people={pc.responders} />
        </div>
      )}

      {/* THE REVEAL, then the Tribe within it. */}
      {discovery && <p className="mt-2 text-[12px] leading-snug text-[var(--text-secondary)]">{discovery}</p>}
      {tribe && <p className="num mt-0.5 text-[11.5px] text-[var(--text-muted)]">{tribe}</p>}
      {support && <p className="mt-1.5 text-[12px] leading-snug text-[var(--text-muted)]">{support}</p>}

      {/* COLLAPSE THE RECIPIENTS. Individual names belong inside the detail, not in
          the scannable feed above it. */}
      {pc.responders.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="mt-2 text-[11.5px] text-[var(--text-secondary)] underline-offset-2 hover:text-[var(--text)] hover:underline"
          >
            {expanded ? "Hide results" : "View results →"}
          </button>
          {expanded && <ResultsDetail pc={pc} />}
        </>
      )}
    </article>
  );
}

/** A compact overlapping avatar row for the people who showed up. */
function ResponderFaces({ people, max = 6 }: { people: readonly PastResponder[]; max?: number }) {
  const shown = people.slice(0, max);
  const overflow = Math.max(0, people.length - max);
  return (
    <div className="flex flex-wrap items-center gap-y-1">
      <div className="flex -space-x-1.5">
        {shown.map((p) => (
          <PersonAvatar
            key={p.wallet}
            wallet={p.wallet}
            name={p.name}
            avatarUrl={p.avatarUrl}
            size={24}
            className="ring-1 ring-[var(--bg)]"
          />
        ))}
      </div>
      {overflow > 0 && (
        <span className="ml-2 text-[11px] text-[var(--text-muted)]">+{overflow}</span>
      )}
    </div>
  );
}

/**
 * INSIDE THE ITEM — the people, grouped by which way they went.
 *
 * "With you" and "went the other way" both name people, because both showed up
 * and both took a public position. "Still out" is a COUNT and only a count:
 * somebody who never answered is not a decision anybody made, and naming them
 * would be the ledger of who did not turn up this product refuses to keep.
 */
function ResultsDetail({ pc }: { pc: PastChallenge }) {
  const stillOut = pc.waiting + pc.passed;
  let groups: { label: string; people: PastResponder[] }[];

  if (pc.yourSide) {
    const away = otherSide(pc.yourSide);
    const withYou = pc.responders.filter((r) => r.side === pc.yourSide);
    const other = pc.responders.filter((r) => r.side === away);
    const noSide = pc.responders.filter((r) => r.side == null);
    groups = [
      { label: "With you", people: withYou },
      { label: "Went the other way", people: other },
      { label: "Showed up", people: noSide },
    ];
  } else {
    // No side of my own — group by what they took, with no agreement claim.
    groups = [
      { label: "Backed YES", people: pc.responders.filter((r) => r.side === "YES") },
      { label: "Backed NO", people: pc.responders.filter((r) => r.side === "NO") },
      { label: "Showed up", people: pc.responders.filter((r) => r.side == null) },
    ];
  }

  return (
    <div className="mt-2.5 space-y-3 border-t border-[var(--border)] pt-2.5">
      {groups
        .filter((g) => g.people.length > 0)
        .map((g) => (
          <div key={g.label}>
            <p className="text-[11px] font-semibold text-[var(--text-secondary)]">
              {g.label} · <span className="num text-[var(--text-muted)]">{g.people.length}</span>
            </p>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1.5">
              {g.people.map((p) => (
                <span key={p.wallet} className="flex items-center gap-1.5">
                  <PersonAvatar wallet={p.wallet} name={p.name} avatarUrl={p.avatarUrl} size={20} />
                  <span className="text-[11.5px] text-[var(--text)]">{p.name}</span>
                </span>
              ))}
            </div>
          </div>
        ))}

      {/* NOT NAMED, EVER. A pass is a choice about a question, and silence is not a
          choice at all — both are counted here and neither is a person on a list. */}
      {stillOut > 0 && (
        <p className="text-[11px] text-[var(--text-muted)]">
          <span className="num">{stillOut}</span> {stillOut === 1 ? "hasn't" : "haven't"} shown up
        </p>
      )}
    </div>
  );
}

/**
 * WHERE YOU SHOWED UP — the reciprocal, kept compact on purpose.
 *
 * This page's spine is the challenges I made; the ones I answered for other people
 * are one line each, so the record stays complete without competing with the
 * events the summary counts.
 */
function ShowedUpSection({
  rows,
  onSelect,
  onSelectPerson,
}: {
  rows: readonly ShowedUpEntry[];
  onSelect: (marketId: number) => void;
  onSelectPerson?: (personWallet: string) => void;
}) {
  return (
    <section>
      <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
        Where you showed up
      </h4>
      <ul>
        {rows.map((r) => (
          <li key={r.marketId} className="border-b border-[var(--border)] py-2 last:border-b-0">
            <div className="flex items-baseline gap-2">
              {/* The person and the question are two destinations, so two siblings
                  rather than nested controls — a button in a button breaks
                  hydration. Without a person handler the name is plain text. */}
              {onSelectPerson ? (
                <button
                  type="button"
                  onClick={() => onSelectPerson(r.wallet)}
                  className="shrink-0 text-[11.5px] text-[var(--text-secondary)] transition-colors hover:text-[var(--text)]"
                >
                  {showedUpForLine(r)}
                </button>
              ) : (
                <span className="shrink-0 text-[11.5px] text-[var(--text-secondary)]">
                  {showedUpForLine(r)}
                </span>
              )}
              <button
                type="button"
                onClick={() => onSelect(r.marketId)}
                className="min-w-0 flex-1 truncate text-left text-[12px] text-[var(--text)] transition-colors hover:text-[var(--text-secondary)]"
              >
                {r.title}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * A NEW READER SHOULD NEVER SEE AN EMPTY ADMINISTRATIVE PAGE. It says what will
 * fill this in and points at the one thing that starts it — a market to take a
 * side in. Closing the sheet returns to exactly that.
 */
function EmptyState({ onExplore }: { onExplore: () => void }) {
  return (
    <div className="py-8">
      <p className="text-[13px] font-medium text-[var(--text)]">No past challenges yet.</p>
      <p className="mt-1 text-[12px] leading-snug text-[var(--text-muted)]">
        When your challenges finish, you&apos;ll see what your people thought here.
      </p>
      <button
        type="button"
        onClick={onExplore}
        className="mt-3 text-[12px] font-medium text-[var(--text)] underline underline-offset-2"
      >
        Explore markets →
      </button>
    </div>
  );
}
