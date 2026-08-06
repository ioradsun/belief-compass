/**
 * WHY THIS — the one sentence that says why a market is in front of you.
 *
 * WHAT IT REPLACES. The centre carried a momentum chip in the top-right: HOT,
 * Early, Hidden, Contested, Conviction, New — six labels, six hues, in the most
 * valuable corner of the card. It described the MARKET's own temperature, which
 * is a fact about the market and not an answer to the reader's actual question:
 * *why am I looking at this?*
 *
 * That answer already existed. `reasonFor` composes it per reader — "Your Tribe
 * is backing YES", "YES moved up 52% today", "Picked from your interest in
 * crypto" — and both the feed list and the centre already render it. It was just
 * rendered in muted grey underneath a loud orange chip that said something else.
 * So the chip goes and the sentence gets the emphasis.
 *
 * WHY PURPLE. `--rel` is already the discovery accent in this product: the faint
 * wash on a live-tape row about someone in your network, the rail on "In this
 * market", the relationship spectrum. It consistently means *this one is about
 * you*. A reason for showing you a market is exactly that, so it inherits the
 * colour rather than introducing a seventh one.
 *
 * ONE COMPONENT, TWO SURFACES. The feed list and the centre title show the same
 * sentence about the same market; rendering it twice invites the two to drift in
 * wording, weight or colour. They call this instead.
 */

/** The discovery accent — the same token personal rows and the market rail use. */
const REL = "var(--rel,#9b87f5)";

export function WhyThis({
  reason,
  /**
   * `lead` prints the "WHY THIS ·" label — the centre, where the sentence sits
   * above a large title and needs naming. The feed list omits it: every row
   * carries one, so a label on each would be six words of chrome per row saying
   * what the column already says.
   */
  lead = false,
  className = "",
}: {
  reason: string | null | undefined;
  lead?: boolean;
  className?: string;
}) {
  if (!reason) return null;
  return (
    <p className={`truncate text-[11.5px] leading-[18px] ${className}`} style={{ color: REL }}>
      {lead && (
        <>
          <span className="font-semibold uppercase tracking-[0.08em]">Why this</span>
          <span aria-hidden> · </span>
        </>
      )}
      {reason}
    </p>
  );
}
