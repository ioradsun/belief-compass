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
   * `lead` is the centre, where the sentence sits alone above the question and
   * gets full weight. The feed list uses the muted, smaller variant: every row
   * carries one, so a column of purple reads as decoration.
   */
  lead = false,
  className = "",
}: {
  reason: string | null | undefined;
  lead?: boolean;
  className?: string;
}) {
  if (!reason) return null;

  // NO LABEL. "WHY THIS ·" named a thing that names itself — "Your Tribe is
  // backing YES" is self-evidently a reason, so the label was six words of
  // chrome in front of the sentence it described. Removing it and giving the
  // sentence the size it lost to the label is the whole trade.
  //
  // NOT CAPS. Caps are for labels — short, glanced, not read. This is a
  // sentence with names and numbers in it; capitalising it slows reading and
  // makes a reason look like a warning. Size, weight and the discovery purple
  // carry the emphasis instead, which is what they are for.
  if (lead) {
    return (
      <p
        className={`truncate text-[13.5px] font-semibold leading-[20px] tracking-[-0.005em] ${className}`}
        style={{ color: REL }}
      >
        {reason}
      </p>
    );
  }

  return (
    <p
      className={`truncate text-[11.5px] leading-[18px] ${className}`}
      style={{ color: "var(--text-muted)" }}
    >
      {reason}
    </p>
  );
}

