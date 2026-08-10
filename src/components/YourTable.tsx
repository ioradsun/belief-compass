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
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { getTable } from "@/lib/table.functions";
import { searchMarkets } from "@/lib/markets.functions";


/**
 * ONLY THE WORDS YES AND NO CARRY A SIDE COLOUR.
 *
 * The same rule the Case File already follows. Tinting the whole sentence would
 * make agreement look like a bigger success than disagreement, which is the one
 * thing this surface must never say.
 */
export function SideWord({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\bYES\b|\bNO\b)/g).map((part, i) =>
        part === "YES" || part === "NO" ? (
          <span key={i} style={{ color: part === "YES" ? "var(--yes)" : "var(--no)" }}>
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

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

/**
 * ONE LIST THAT CHANGES ITS MIND. Before you type it offers the markets you are
 * already in — including whatever the centre column is showing, which is why
 * there is no separate "use this market" line any more. Type two characters and
 * the same rows are replaced by matches from the same index the header searches.
 * No empty state, no result count: an empty list already says nothing matched.
 */
export function TablePicker({
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
