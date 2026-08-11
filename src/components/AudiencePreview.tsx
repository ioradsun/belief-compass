/**
 * WHO THIS WOULD REACH — the audience, shown before anybody commits to it.
 *
 * NOT A PICKER, AND THE DISTINCTION IS THE WHOLE DESIGN. There are no checkboxes
 * here and no per-person Invite button, because choosing recipients is casting
 * and casting is the recruitment panel this product already deleted once. The
 * audience is the qualified set, frozen at the moment the slot is taken. This
 * only lets somebody SEE it first.
 *
 * THREE ROWS AT MOST, AND EMPTY ONES ARE ABSENT. `groupAudience` decides that,
 * not this file — a heading over nothing is the software pointing at a category
 * the reader does not have, which on a cold-start network is most of them.
 *
 * A REFUSED READ RENDERS NOTHING. Not "nobody qualifies", not a zero, not a
 * skeleton that resolves into a lie: the module hides, and the offer beside it
 * makes its own decision about whether it can still be made honestly.
 */
import { useQuery } from "@tanstack/react-query";
import type { RecordMode } from "@/domain/simulation";
import { getAudience } from "@/lib/challenge.functions";
import { PersonAvatar } from "@/components/PersonAvatar";
import {
  COLD_START_HEADLINE,
  COLD_START_SUPPORT,
  type AudienceGroupView,
  type AudienceResult,
} from "@/domain/audience";

/**
 * THE MODE IS IN THE KEY.
 *
 * A Simulation audience is a strict subset of the real one — the same
 * relationships, narrowed to people who can actually answer in that ledger — so
 * the two answers for one market are genuinely different lists. Sharing a cache
 * entry would let a real audience be rendered as the Simulation reach, and the
 * count under a Challenge button is a promise about that many real people.
 */
export const audienceKey = (wallet?: string, marketId?: number, mode: RecordMode = "REAL") =>
  ["audience", wallet ?? null, marketId ?? null, mode] as const;

export function useAudience(wallet?: string, marketId?: number, mode: RecordMode = "REAL") {
  return useQuery<AudienceResult>({
    queryKey: audienceKey(wallet, marketId, mode),
    queryFn: () =>
      getAudience({ data: { wallet: wallet ?? null, marketId: marketId ?? null, mode } }),
    enabled: !!wallet && marketId != null,
    staleTime: 60_000,
  });
}

export function AudiencePreview({
  wallet,
  marketId,
  /**
   * Say the cold-start sentence when there is nobody. Off by default: most
   * surfaces already handle "nobody qualifies" in their own voice, and two
   * empty-state paragraphs stacked is worse than either alone.
   */
  showColdStart = false,
  /** Which ledger's reach to preview. The write uses the same value. */
  mode = "REAL",
}: {
  wallet?: string;
  marketId?: number;
  showColdStart?: boolean;
  mode?: RecordMode;
}) {
  const { data } = useAudience(wallet, marketId, mode);
  if (!data) return null;

  if (data.status === "none" && showColdStart) {
    return (
      <div className="mt-2">
        <p className="text-[12px] font-semibold leading-snug text-[var(--text)]">
          {COLD_START_HEADLINE}
        </p>
        <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--text-secondary)]">
          {COLD_START_SUPPORT}
        </p>
      </div>
    );
  }
  // Loading, refused, or empty with nothing to say about it.
  if (data.status !== "available") return null;
  return <AudienceGroups groups={data.groups} />;
}

/**
 * THE ROWS THEMSELVES, WITH NO IDEA WHERE THEY CAME FROM.
 *
 * Split from the fetching wrapper so /lab-9f3c7a21b4 can render a full audience
 * — a Twin, four Rivals, nine Still Forming — without a DNA cache, a wallet or a
 * network. Every other rendering bug in this system was found by looking at it,
 * and a component that can only be seen in production is one that will not be.
 */
export function AudienceGroups({
  groups,
  stacked = false,
}: {
  groups: AudienceGroupView[];
  stacked?: boolean;
}) {
  return (
    <div className={stacked ? "flex flex-col gap-4" : "mt-2 flex flex-col gap-1.5"}>
      {groups.map((g) => (
        <div
          key={g.key}
          className={stacked ? "flex flex-col gap-2" : "flex items-center gap-2"}
        >
          {stacked ? (
            <div className="min-w-0">
              <p className="text-[15px] font-semibold leading-snug text-[var(--text)]">
                {g.label}
                <span className="ml-1.5 font-normal text-[var(--text-muted)]">{g.count}</span>
              </p>
              <p className="text-[13px] leading-snug text-[var(--text-secondary)]">{g.note}</p>
            </div>
          ) : null}

          {/* A FIXED GUTTER, FOUND BY LOOKING. Sized to a full stack — five faces
              at 22px overlapping by 6, plus the overflow chip — so the three
              labels start at the same x. Rendered without it, a Tribe of three
              and a Rivals of seven pushed their headings to different places and
              the rows stopped reading as one list. `min-w` rather than `w`, so a
              three-digit overflow grows instead of clipping. */}
          <div
            className={cn(
              "flex -space-x-1.5",
              stacked ? "min-w-[140px]" : "min-w-[102px] shrink-0"
            )}
          >
            {g.visiblePeople.map((p) => (
              <PersonAvatar
                key={p.wallet}
                wallet={p.wallet}
                name={p.displayName}
                avatarUrl={p.avatarUrl}
                size={stacked ? 32 : 22}
                className="ring-1 ring-[var(--bg)]"
              />
            ))}
            {/* THE OVERFLOW IS A COUNT, NOT A FACE. A generic silhouette standing
                in for four real people is the one thing an audience must never
                do — it would be filler wearing a person's shape. */}
            {g.overflow > 0 && (
              <span
                className={cn(
                  "flex items-center justify-center rounded-full px-1 font-medium ring-1 ring-[var(--bg)]",
                  stacked ? "h-[32px] min-w-[32px] text-[12px]" : "h-[22px] min-w-[22px] text-[10px]"
                )}
                style={{
                  background: "color-mix(in oklab, var(--text-muted) 16%, transparent)",
                  color: "var(--text-secondary)",
                }}
              >
                +{g.overflow}
              </span>
            )}
          </div>

          {!stacked ? (
            <div className="min-w-0">
              <p className="truncate text-[11.5px] font-medium leading-snug text-[var(--text)]">
                {g.label}
                <span className="ml-1 font-normal text-[var(--text-muted)]">{g.count}</span>
              </p>
              <p className="truncate text-[11px] leading-snug text-[var(--text-muted)]">{g.note}</p>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
