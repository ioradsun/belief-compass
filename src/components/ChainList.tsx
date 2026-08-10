/**
 * THE CHAIN — one card per person per market, whatever role you are playing.
 *
 * This is the merge of what used to be two lists in the same column: "Challenged
 * You" (amber, incoming) and "You Challenged" (blue, outbound). A reader who was
 * brought into a question and then relayed it saw their own participation split
 * across two cards with no visible connection between them — the chain passing
 * THROUGH a person was the one thing the surface could not draw.
 *
 * Now there is ONE card, keyed by the market, and it changes as the role changes:
 *
 *     somebody brought me in (amber)
 *       → I showed up
 *       → I relayed it (blue)
 *       → my people are answering
 *       → the chain continued past me
 *
 * `domain/chain` owns the merge and the ordering; this owns the pixels.
 *
 * WHAT IS STILL FORBIDDEN HERE, unchanged by the merge:
 *  • Nobody who passed is ever named. Counts stay aggregate.
 *  • The "showed up" headline is SIDE-BLIND — turning up is the fact, not agreeing.
 *  • No Accept button. Opening is not accepting; taking a side is.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, MoreHorizontal } from "lucide-react";
import { getTableCandidates, putOnTable, takeOffTable } from "@/lib/table.functions";
import { getChainContext } from "@/lib/challenge.functions";
import {
  SideWord,
  TablePicker,
  candidatesKey,
  tableKey,
  useTable,
} from "@/components/YourTable";
import {
  tableProgress,
  progressLine,
  finishedLine,
  keptItMovingLine,
  spotsOpen,
  TABLE_SLOTS,
  showedUpHeadline,
  showedUpSide,
} from "@/domain/table";
import {
  mergeChain,
  provenanceLine,
  EMPTY_PROVENANCE,
  type ChainCard,
  type Provenance,
} from "@/domain/chain";
import { convictionMatch } from "@/domain/relationship";
import { backAndForthLine, outcomeLine, runEndedLine } from "@/domain/dependability";
import { RELATIONSHIP_MIN_SHARED } from "@/domain/dna/config";
import { relationshipTone } from "@/lib/dna-labels";
import { PersonAvatar } from "@/components/PersonAvatar";
import { bestEffort, useWalletSession } from "@/hooks/useWalletSession";
import type { Challenge, CallerRelation } from "@/domain/challenge";

const BADGE: Record<CallerRelation, string> = {
  twin: "Tribe",
  tribe: "Tribe",
  opp: "Rival",
  inverse: "Rival",
};

export function ChainList({
  wallet,
  incoming,
  onSelect,
  onPass,
}: {
  wallet?: string;
  /** The reader's open and recently-answered calls, already trimmed by the rail. */
  incoming: Challenge[];
  onSelect: (marketId: number) => void;
  /** Not for me. Local hide plus a durable, nameless count for the asker. */
  onPass: (marketId: number) => void;
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

  const table = useMemo(() => rows ?? [], [rows]);
  /**
   * THE FRACTION COUNTS ONLY THE LIVE ONES. A week of finished Challenges reading
   * as 3/3 would be the opposite of the truth: closing is what gave the slot back.
   */
  const live = table.filter((r) => r.closedAtMs == null);
  const ended = table.filter((r) => r.closedAtMs != null && r.closeReason === "all_responded");
  const open = spotsOpen(live.length);

  const cards = useMemo(
    () => mergeChain(incoming, [...live, ...ended]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [incoming, table],
  );

  /**
   * WHERE EACH QUESTION CAME FROM — one read for the whole list rather than one
   * per card, because provenance is a walk over the same two tables every time.
   */
  const ids = cards.map((c) => c.marketId);
  const { data: chain } = useQuery({
    queryKey: ["chain-context", wallet ?? null, ids.join(",")],
    queryFn: () => getChainContext({ data: { wallet: wallet ?? null, marketIds: ids } }),
    enabled: !!wallet && ids.length > 0,
    staleTime: 60_000,
  });

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
    // A failed read is not an empty table. Silence has to be earned by an answer.
    return (
      <p className="text-[11.5px] leading-snug text-[var(--text-muted)]">
        Could not load your table. This is a fault on our side — try again in a moment.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {/* ONE HEADING FOR ONE LIST. The colour legend moved onto the cards, where
          the role actually lives: amber means somebody is waiting on you, blue
          means you are waiting on them, and a single card can go from one to the
          other without moving. The fraction is capacity for the blue half. */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)]"
        >
          Chains
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
          {cards.map((card) => (
            <ChainCardRow
              key={card.marketId}
              card={card}
              provenance={chain?.[card.marketId] ?? EMPTY_PROVENANCE}
              onSelect={onSelect}
              onPass={onPass}
              onClose={() => card.mine && close.mutate(card.mine.id)}
              closing={close.isPending}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * ONE CARD, THE WHOLE WAY THROUGH.
 *
 *     Sundeep · TRIBE
 *     Will AI replace software engineers?
 *     You showed up for Sundeep.
 *     Casey showed up · 2 of 9 showed up
 *     Started by Maya · Reached you through Sundeep
 *
 * The blocks are independently absent, and the order is the argument: who asked,
 * what they asked, what you did about it, what happened because you did, and only
 * then where the whole thing came from.
 */
function ChainCardRow({
  card,
  provenance,
  onSelect,
  onPass,
  onClose,
  closing,
}: {
  card: ChainCard;
  provenance: Provenance;
  onSelect: (marketId: number) => void;
  onPass: (marketId: number) => void;
  onClose: () => void;
  closing: boolean;
}) {
  const [more, setMore] = useState(false);
  const c = card.incoming;
  const mine = card.mine;

  const badge = c ? BADGE[c.relation] : null;
  const tone = c ? relationshipTone(c.relation) : null;
  const match = convictionMatch(c?.together ?? 0, c?.shared ?? 0);
  const showMatch = c != null && match != null && (c.shared ?? 0) >= RELATIONSHIP_MIN_SHARED;

  const waiting = c?.state === "waiting";
  const outcome = c && !waiting ? outcomeLine(c.state, c.caller.name ?? "") : null;
  const run = c?.reciprocity
    ? (backAndForthLine(c.reciprocity) ?? runEndedLine(c.reciprocity))
    : null;

  const progress = mine ? tableProgress(mine.recipients) : null;
  const closeReason = mine?.closeReason ?? null;
  const finishedMine = closeReason != null;
  const progressText =
    mine && progress
      ? closeReason
        ? finishedLine(progress, closeReason)
        : progressLine(progress)
      : null;
  const headline = mine ? showedUpHeadline(mine.responders) : null;
  const sideLine = mine ? showedUpSide(mine.responders) : null;
  const carried = keptItMovingLine(provenance.relayedBy, provenance.relayTables);
  const from = provenanceLine(provenance);

  /**
   * QUIET WHEN NOTHING IS OWED. A card with a live incoming call or a live
   * Challenge of the reader's own is a solid surface; everything else has ended
   * and steps back into the same dashed treatment both halves already used.
   */
  const quiet = !card.live;

  return (
    <li className="relative" data-market={card.marketId} data-tone={card.tone}>
      <button
        type="button"
        onClick={() => onSelect(card.marketId)}
        className={`w-full rounded-xl border p-3 pr-9 text-left transition-colors ${
          quiet
            ? "border-dashed border-[var(--border)] bg-transparent hover:border-[var(--border-strong)]"
            : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)]"
        }`}
      >
        {/* THE ROLE, AS A COLOUR AND NOTHING ELSE. Amber while somebody is waiting
            on the reader; blue the moment they became the one asking. */}
        <div className="flex items-center gap-2">
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: card.tone === "blue" ? "var(--yes)" : "var(--no)" }}
            aria-hidden
          />
          {c ? (
            <>
              {/* The face identifies; it does not navigate — a button inside a
                  button is invalid markup and a second destination. */}
              <PersonAvatar
                wallet={c.caller.wallet}
                name={c.caller.name ?? undefined}
                size={22}
                interactive={false}
              />
              <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[var(--text)]">
                {c.caller.name}
              </span>
              {badge && tone && (
                <span
                  className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                  style={{ color: tone.fg, background: tone.bg }}
                >
                  {badge}
                </span>
              )}
            </>
          ) : (
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              You put this up
            </span>
          )}
        </div>

        <p
          className={`mt-1.5 line-clamp-2 text-[13px] leading-snug ${quiet ? "text-[var(--text-secondary)]" : "text-[var(--text)]"}`}
        >
          {card.title ?? "This question"}
        </p>

        {/* WHAT THEY BELIEVE — only while the reader has not answered. Beside a
            position already held it is the product asking for something it got. */}
        {c && waiting && (
          <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-[var(--text-secondary)]">
            {c.reason}
          </p>
        )}

        {showMatch && (
          <p className="num mt-1.5 text-[11px] text-[var(--text-muted)]">
            {match}% Conviction Match · {c?.together} of {c?.shared} together
          </p>
        )}

        {/* WHAT YOU DID. Side-blind: "You showed up for Maya" is true whether the
            reader went YES or NO, because the sentence cannot carry a side. */}
        {outcome && (
          <p className="mt-1.5 text-[12px] leading-snug font-medium text-[var(--text)]">
            {outcome}
          </p>
        )}

        {/* WHAT HAPPENED BECAUSE YOU RELAYED IT — a person before a ratio, and
            nobody who passed is ever named. */}
        {headline && (
          <p className="mt-1.5 text-[12px] leading-snug font-semibold text-[var(--text)]">
            {headline}
          </p>
        )}
        {sideLine && (
          <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--text-secondary)]">
            <SideWord text={sideLine} />
          </p>
        )}
        {progressText && (
          <p
            className={`mt-1.5 text-[11.5px] leading-snug ${finishedMine ? "text-[var(--text)]" : "num text-[var(--text-secondary)]"}`}
          >
            {progressText}
          </p>
        )}

        {/* IT WENT PAST YOU. The second win, and the one that makes this a chain. */}
        {carried && (
          <p className="mt-1 text-[11.5px] leading-snug text-[var(--text-secondary)]">{carried}</p>
        )}

        {/* WHERE IT CAME FROM — one line, last, and never a diagram. */}
        {from && <p className="mt-1.5 text-[11px] leading-snug text-[var(--text-muted)]">{from}</p>}

        {run && <p className="num mt-1 text-[11px] text-[var(--text-muted)]">{run}</p>}
      </button>

      {/* NOT FOR ME — private, nameless, and only while an answer is still owed. */}
      {waiting && !mine && (
        <button
          type="button"
          onClick={() => onPass(card.marketId)}
          aria-label={`Pass on this call from ${c?.caller.name ?? "them"}`}
          title="Not for me"
          className="absolute right-0 top-0 flex h-8 w-8 items-center justify-center text-[15px] leading-none text-[var(--text-muted)] opacity-60 transition-opacity hover:opacity-100"
        >
          ×
        </button>
      )}

      {/* TAKE IT OFF THE TABLE — casual, because it is. Nothing is destroyed:
          every recipient row survives with its stamps. */}
      {mine && !finishedMine && (
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
