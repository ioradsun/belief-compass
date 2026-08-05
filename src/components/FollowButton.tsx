/**
 * FOLLOW — the one thing a viewer can say about a person on day one.
 *
 * Conviction DNA infers relationships from shared beliefs, which means a new
 * account has no network at all until it has traded. A follow is the same
 * statement made deliberately and immediately, so this button is what turns an
 * empty feed into a personal one.
 *
 * WHAT IT DOES NOT SAY. Not "friend", not "ally", not a request awaiting
 * approval — following is one-way, unannounced, and grants no access, because
 * every position behind it is already public on-chain. It is a statement about
 * the READER's attention, not about the person.
 *
 * OPTIMISTIC, because the answer is never in doubt: the server records what the
 * button already shows, and a failure puts it back. The alternative — a spinner
 * on a boolean — makes a free action feel expensive.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getFollows, setFollow } from "@/lib/follows.functions";
import { useWalletSession } from "@/hooks/useWalletSession";

export const followsQueryKey = (viewer: string | undefined, person: string) =>
  ["follows", viewer?.toLowerCase() ?? null, person.toLowerCase()] as const;

export function FollowButton({
  person,
  viewer,
  size = "default",
}: {
  /** The wallet being followed. */
  person: string;
  /** The viewer's wallet. Absent = signed out, and the button does not render. */
  viewer?: string;
  size?: "default" | "compact";
}) {
  const qc = useQueryClient();
  const { withSession } = useWalletSession();
  const [error, setError] = useState<string | null>(null);

  const self = !!viewer && viewer.toLowerCase() === person.toLowerCase();
  const enabled = !!viewer && !self;

  const { data } = useQuery({
    queryKey: followsQueryKey(viewer, person),
    queryFn: () => getFollows({ data: { wallet: viewer, person } }),
    enabled,
    staleTime: 30_000,
  });

  const mutation = useMutation({
    mutationFn: (following: boolean) =>
      withSession((session) =>
        setFollow({ data: { wallet: viewer as string, person, following, session } }),
      ),
    // Optimistic: paint the new state, keep the old one to fall back to.
    onMutate: async (following) => {
      setError(null);
      const key = followsQueryKey(viewer, person);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData(key);
      qc.setQueryData(key, (old: unknown) => {
        const o = (old ?? { following: [], followerCount: 0, isFollowing: false }) as {
          following: string[];
          followerCount: number | null;
          isFollowing: boolean;
        };
        return {
          ...o,
          isFollowing: following,
          followerCount:
            o.followerCount == null ? null : Math.max(0, o.followerCount + (following ? 1 : -1)),
        };
      });
      return { prev };
    },
    onError: (e, _v, ctx) => {
      qc.setQueryData(followsQueryKey(viewer, person), ctx?.prev);
      setError(e instanceof Error ? e.message : "Couldn't save that.");
    },
    onSuccess: (fresh) => qc.setQueryData(followsQueryKey(viewer, person), fresh),
    // The feed ranks on follows, so it is stale the moment this changes.
    onSettled: () => void qc.invalidateQueries({ queryKey: ["opp-feed"] }),
  });

  // Signed out, or looking at yourself: nothing to offer. Following yourself
  // would rank your own markets up in your own feed.
  if (!enabled) return null;

  const following = data?.isFollowing ?? false;
  const pad = size === "compact" ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-[12px]";

  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <button
        type="button"
        onClick={() => mutation.mutate(!following)}
        disabled={mutation.isPending}
        aria-pressed={following}
        className={`inline-flex shrink-0 items-center rounded-full font-semibold transition-colors disabled:opacity-60 ${pad} ${
          following
            ? "border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text)]"
            : "bg-[var(--text)] text-[var(--bg)] hover:brightness-110"
        }`}
      >
        {following ? "Following" : "Follow"}
      </button>
      {error && <span className="text-[11px] text-[var(--no)]">{error}</span>}
    </span>
  );
}
