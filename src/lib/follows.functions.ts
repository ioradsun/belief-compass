/**
 * FOLLOWS — read and write the one signal a new viewer can produce.
 *
 * The table's reasoning lives in the migration; this file is the door. Two
 * things worth knowing about the shape:
 *
 * READS AND WRITES ARE UNSIGNED. Who follows whom is not a secret — every
 * position behind it is on-chain — so neither `getFollows` nor `setFollow` asks
 * the viewer to sign. A follow grants no access and is instantly reversible;
 * making a free action cost a wallet prompt is the surest way to kill it.

 *
 * FOLLOWING IS IDEMPOTENT. Tapping Follow twice is one follow; tapping Unfollow
 * on someone you never followed is not an error. The button reflects a state,
 * so the write sets that state rather than toggling one the client guessed at —
 * a toggle would invert itself the moment two tabs disagreed.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { serviceClient } from "@/lib/supabase-clients";

export interface FollowState {
  /** Wallets this viewer follows, lowercased. */
  following: string[];
  /** How many people follow the wallet that was asked about, when one was. */
  followerCount: number | null;
  /** Whether the viewer follows the wallet that was asked about. */
  isFollowing: boolean;
}

const EMPTY: FollowState = { following: [], followerCount: null, isFollowing: false };

/**
 * The viewer's follow list, plus the relationship to one specific person when
 * `person` is given — so a profile needs one request, not three.
 */
export const getFollows = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) =>
    z
      .object({
        wallet: z.string().min(3).optional(),
        /** Ask about one person: fills `followerCount` and `isFollowing`. */
        person: z.string().min(3).optional(),
      })
      .parse(raw ?? {}),
  )
  .handler(async ({ data }): Promise<FollowState> => {
    const viewer = data.wallet?.toLowerCase() ?? null;
    const person = data.person?.toLowerCase() ?? null;
    if (!viewer && !person) return EMPTY;
    const sb = serviceClient();

    const [mine, theirs] = await Promise.all([
      viewer
        ? sb.from("follows").select("followed").eq("follower", viewer)
        : Promise.resolve({ data: [] as { followed: string }[] }),
      person
        ? sb
            .from("follows")
            .select("follower", { count: "exact", head: true })
            .eq("followed", person)
        : Promise.resolve({ count: null as number | null }),
    ]);

    const following = ((mine.data ?? []) as { followed: string }[]).map((r) =>
      String(r.followed).toLowerCase(),
    );
    return {
      following,
      followerCount: person ? ((theirs as { count: number | null }).count ?? 0) : null,
      isFollowing: person ? following.includes(person) : false,
    };
  });

/**
 * Follow or unfollow one person. Returns the viewer's fresh state so the caller
 * never has to reconstruct it — the same reason the read carries both sides.
 */
export const setFollow = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z
      .object({
        wallet: z.string().min(3),
        person: z.string().min(3),
        following: z.boolean(),
      })
      .parse(raw),
  )
  .handler(async ({ data }): Promise<FollowState> => {
    // Following is a public, reversible statement about the READER's attention —
    // it grants no access and reveals nothing that isn't already on-chain, so it
    // does not ask the viewer to sign. Cheap actions must feel cheap.
    const follower = data.wallet.toLowerCase();
    const followed = data.person.toLowerCase();
    // The DB rejects this too; refusing here gives the caller a sentence rather
    // than a constraint name.
    if (follower === followed) throw new Error("You can't follow yourself.");


    const sb = serviceClient();
    if (data.following) {
      const { error } = await sb
        .from("follows")
        .upsert({ follower, followed }, { onConflict: "follower,followed" });
      if (error) throw new Error(error.message);
    } else {
      const { error } = await sb
        .from("follows")
        .delete()
        .eq("follower", follower)
        .eq("followed", followed);
      if (error) throw new Error(error.message);
    }

    return getFollows({ data: { wallet: follower, person: followed } });
  });

/**
 * Server-side read for the feed builder. A plain function, not a server fn:
 * `buildOpportunityFeed` already runs on the server and going back out through
 * the RPC layer to reach the same database would be a round trip to nowhere.
 *
 * Returns a Set because every caller asks "is this creator followed?" per row.
 */
export async function loadFollowing(
  sb: ReturnType<typeof serviceClient>,
  viewer: string | null,
): Promise<ReadonlySet<string>> {
  if (!viewer) return new Set();
  const { data, error } = await sb
    .from("follows")
    .select("followed")
    .eq("follower", viewer.toLowerCase());
  // A missing or unreadable `follows` table returns data = null with an error
  // set. Swallowing that turns a whole ranking axis off silently and forever,
  // which is exactly how it went unnoticed before: log loudly, then degrade.
  if (error) {
    console.error("[follows] loadFollowing failed — follow ranking is inert", {
      viewer: viewer.toLowerCase(),
      code: error.code,
      message: error.message,
    });
    return new Set();
  }
  return new Set(
    ((data ?? []) as { followed: string }[]).map((r) => String(r.followed).toLowerCase()),
  );
}
