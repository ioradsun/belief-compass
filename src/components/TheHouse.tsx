/**
 * The House — one line. A companion that slowly becomes your Conviction Twin.
 *
 * Not an analytics card: no borders, bars, percentages, or reasoning. It reads
 * the SAME house data the app already computes (a read's confidence band, and the
 * running record of how often it reads you right), and turns it into a single
 * sentence + a relationship stage you level up. It never names the side before a
 * decision, never mentions AI or math — the mystery is the point.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getHouseRead } from "@/lib/house.functions";
import { houseKey } from "@/components/MarketIntelligence";
import {
  houseAfter,
  houseBefore,
  houseDelight,
  houseMilestone,
  houseMode,
  houseStage,
  STAGE_LABEL,
  type HouseStage,
} from "@/domain/the-house";

export function TheHouse({ marketId, viewerWallet }: { marketId: number; viewerWallet?: string }) {
  const viewer = viewerWallet;
  const { data: house } = useQuery({
    queryKey: houseKey(viewer, marketId),
    queryFn: () => getHouseRead({ data: { wallet: viewer ?? null, marketId } }),
    enabled: true,
    staleTime: 30_000,
  });

  const { stage, text } = useMemo((): { stage: HouseStage; text: string } => {
    if (!viewer) {
      return { stage: "learning", text: "Connect a wallet and I'll start learning how you think." };
    }
    if (!house) return { stage: "learning", text: "Still learning you." };

    const rec = house.record;
    const decisions = rec.correct + rec.miss;
    const accuracy = decisions > 0 ? rec.correct / decisions : null;
    const stage = houseStage(decisions, accuracy);
    const seed = marketId;

    // After a decision — react with emotion (a rare relationship beat first).
    if (house.closed && (house.outcome === "correct" || house.outcome === "miss")) {
      const beat = houseMilestone(stage, seed + decisions);
      return { stage, text: beat ?? houseAfter(house.outcome === "correct", seed) };
    }

    // Before a decision — an occasional pattern observation, else the confidence
    // line. While still training (foundation), the House simply keeps watching.
    const delight = house.foundation ? null : houseDelight(seed + decisions);
    if (delight) return { stage, text: delight };
    const mode = house.foundation ? "low" : houseMode(house.band);
    return { stage, text: houseBefore(mode, seed) };
  }, [viewer, house, marketId]);

  return (
    <div aria-label="The House">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
        <span aria-hidden>🏠</span> The House · {STAGE_LABEL[stage]}
      </div>
      <p className="mt-1 text-[13px] leading-snug text-[var(--text-secondary)]">{text}</p>
    </div>
  );
}
