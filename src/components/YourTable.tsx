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
 *
 * ONE HEADER, ONE CONTROL. Capacity is now a plain 1/3 beside a single + — the
 * whole "what can I put up" question collapses into one affordance with two
 * answers: this market, or find one. Everything else that used to be spoken in
 * sentences (spots open, invitations, take-it-down links) is either implied by the
 * fraction or tucked behind a chevron on the card it belongs to.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Plus, Search, X } from "lucide-react";
import { getTable, getTableCandidates, putOnTable, takeOffTable } from "@/lib/table.functions";
import { searchMarkets } from "@/lib/markets.functions";
import {
  tableProgress,
  progressLine,
  finishedLine,
  spotsOpen,
  TABLE_SLOTS,
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
  const [adding, setAdding] = useState(false);
  const [collapsed, setCollapsed] = useState(false);


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
      setAdding(false);
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
   * THE FRACTION COUNTS ONLY THE LIVE ONES. A week of finished Challenges reading
   * as 3/3 would be the opposite of the truth: closing is what gave the slot back.
   */
  const live = table.filter((r) => r.closedAtMs == null);
  const ended = table.filter((r) => r.closedAtMs != null);
  const ordered = [...live, ...ended];
  const open = spotsOpen(live.length);

  /**
   * SUGGESTIONS AND SEARCH ARE ONE SURFACE. Opening "Add" shows the markets you
   * are already in; typing replaces them in place with matches. Two lists in two
   * modes was a menu about a menu — the suggestions were the answer most of the
   * time, and searching used to throw them away.
   */
  const { data: candidates } = useQuery({
    queryKey: candidatesKey(wallet, open),
    queryFn: () => getTableCandidates({ data: { wallet: wallet ?? null, limit: open } }),
    enabled: !!wallet && open > 0 && !isError && adding,
    staleTime: 60_000,
  });
  const suggestions = (candidates ?? [])
    .filter((c) => !live.some((r) => r.marketId === c.marketId))
    .slice(0, open)
    .map((c) => ({ id: c.marketId, title: c.title ?? "This question" }));

  if (isError) {
    // A failed read is not an empty table. Same rule the incoming side follows:
    // silence has to be earned by an answer.
    return (
      <p className="text-[11.5px] leading-snug text-[var(--text-muted)]">
        Could not load your table. This is a fault on our side — try again in a moment.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {/* WHOSE MOVE IT IS, IN TWO WORDS AND A COLOUR. Blue is this product's own
          side-of-the-question colour for the reader; amber is the other side. So
          the rail reads without a legend: blue is what you asked, amber is what
          was asked of you. The fraction sits beside the heading because capacity
          is a fact about this section, not a sentence of its own.

          THE HEADING IS THE CONTROL. Pressing it folds the section away — the dot
          and the fraction still report the state while it is closed, which is why
          the cards no longer repeat the blue dot one per row. */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)]"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--yes)]" aria-hidden />
          You Challenged
          <span className="num tabular-nums font-normal">
            {live.length}/{TABLE_SLOTS}
          </span>
          <ChevronDown
            size={12}
            className={`transition-transform ${collapsed ? "-rotate-90" : ""}`}
            aria-hidden
          />
        </button>
        {!collapsed && (
          <button
            type="button"
            aria-expanded={adding}
            disabled={open === 0 || !wallet}
            onClick={() => setAdding((a) => !a)}
            className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-secondary)] transition-colors hover:text-[var(--text)] disabled:opacity-30"
          >
            {adding ? "Close" : "Add"}
          </button>
        )}
      </div>

      {!collapsed && adding && (
        <TablePicker
          suggestions={suggestions}
          onPick={(id) => put.mutate(id)}
          pending={put.isPending}
        />
      )}

      {!collapsed && (
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
        </ul>
      )}

    </div>
  );
}

/**
 * ONE LIST THAT CHANGES ITS MIND. Before you type it offers the markets you are
 * already in — including whatever the centre column is showing, which is why
 * there is no separate "use this market" line any more. Type two characters and
 * the same rows are replaced by matches from the same index the header searches.
 * No empty state, no result count: an empty list already says nothing matched.
 */
function TablePicker({
  suggestions,
  onPick,
  pending,
}: {
  suggestions: { id: number; title: string }[];
  onPick: (id: number) => void;
  pending: boolean;
}) {
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const box = useRef<HTMLInputElement>(null);

  useEffect(() => {
    box.current?.focus();
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 180);
    return () => clearTimeout(t);
  }, [q]);

  const searching = term.length >= 2;
  const { data: hits } = useQuery({
    queryKey: ["table-search", term],
    queryFn: () => searchMarkets({ data: { query: term, limit: 6 } }),
    enabled: searching,
    staleTime: 30_000,
  });

  const rows = searching
    ? (hits ?? []).map((h) => ({ id: h.onchain_id, title: h.title as string }))
    : suggestions;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2">
      <div className="flex items-center gap-1.5 rounded-lg bg-[var(--bg)] px-2">
        <Search size={12} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
        <input
          ref={box}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search markets"
          aria-label="Search markets to put on the table"
          className="w-full bg-transparent py-1.5 text-[12px] text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
        />
      </div>
      {rows.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {rows.map((r) => (
            <button
              key={r.id}
              type="button"
              disabled={pending}
              onClick={() => onPick(r.id)}
              className="block w-full truncate rounded-lg px-2 py-1.5 text-left text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg)] hover:text-[var(--text)] disabled:opacity-50"
            >
              {r.title}
            </button>
          ))}
        </div>
      )}
    </div>
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
  const [more, setMore] = useState(false);

  return (
    <li className="relative" data-challenge={id}>
      <button
        type="button"
        onClick={onOpen}
        className={`w-full rounded-xl border p-3 pr-8 text-left transition-colors ${finished ? "" : "pl-6 "}${
          finished
            ? // QUIETER, NOT GREYED OUT. A finished Challenge is the best thing
              // that happens here; disabling its appearance would say the opposite.
              // It steps back because it no longer needs anything from you.
              "border-dashed border-[var(--border)] bg-transparent hover:border-[var(--border-strong)]"
            : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)]"
        }`}
      >
        {/* IT IS LIVE — a dot, not a word. The one thing a creator wants to know at
            a glance is whether this is still out there collecting answers, and a
            breathing dot says it without spending a line of copy. */}
        {!finished && (
          <span className="absolute left-3 top-3.5 grid h-1.5 w-1.5 place-items-center" aria-label="Still open">
            <span className="absolute inline-flex h-1.5 w-1.5 animate-ping rounded-full bg-[var(--yes)] opacity-70" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--yes)]" />
          </span>
        )}

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

          BEHIND A CHEVRON, because it is the rarest thing anybody does here and it
          was sitting under every card as a permanent line of text. Gone entirely
          once the Challenge has ended: a finished card needs no dismissing — it
          ages out by itself, and an outcome you have to file away is an inbox. */}
      {!finished && (
        <>
          <button
            type="button"
            aria-label="Options"
            aria-expanded={more}
            onClick={() => setMore((m) => !m)}
            className="absolute right-1.5 top-2.5 grid h-6 w-6 place-items-center rounded-full text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
          >
            <MoreHorizontal size={14} />
          </button>
          {more && (
            <div className="absolute right-1.5 top-9 z-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1 shadow-lg">
              <button
                type="button"
                onClick={onClose}
                disabled={closing}
                className="block w-full whitespace-nowrap rounded-lg px-2 py-1.5 text-left text-[12px] text-[var(--text)] transition-colors hover:bg-[var(--bg)] disabled:opacity-50"
              >
                Take off the table
              </button>
            </div>
          )}
        </>
      )}
    </li>
  );
}
