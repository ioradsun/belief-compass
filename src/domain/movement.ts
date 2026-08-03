/**
 * Movement — a Tribe growing into something larger, around ONE market and side.
 *
 * The last step of the emotional arc: what you believe → who shares it → what
 * you can build together. A movement's size is its UNIQUE BELIEVERS, never its
 * capital — one large wallet must not be able to fake a crowd. Stages are honest
 * and human, and progress is always expressed as "N more believers to become X",
 * never a points bar.
 *
 * ZERO IO, pure, fully tested. Thresholds are centralized and configurable.
 */

export type MovementStage = "seed" | "spark" | "forming" | "tribe" | "movement";

/**
 * Believer counts that enter each stage. Configurable starting values — review
 * real market distributions before hardening them. Each is the MINIMUM believers
 * to be in that stage.
 */
export const MOVEMENT_THRESHOLDS: Record<Exclude<MovementStage, "seed">, number> = {
  spark: 2,
  forming: 5,
  tribe: 15,
  movement: 50,
};

const ORDER: MovementStage[] = ["seed", "spark", "forming", "tribe", "movement"];

export const MOVEMENT_LABEL: Record<MovementStage, string> = {
  seed: "Seed",
  spark: "Spark",
  forming: "Forming",
  tribe: "Tribe",
  movement: "Movement",
};

export interface MovementProgress {
  stage: MovementStage;
  label: string;
  believers: number;
  /** The next stage up, or null at the top. */
  nextStage: MovementStage | null;
  nextLabel: string | null;
  /** Believers still needed to reach the next stage (0 at the top). */
  toNext: number;
  /** 0–1 progress from this stage's floor toward the next stage's floor. */
  progress: number;
  /** One human line — "4 more believers to become a Tribe" / a top-stage line. */
  note: string;
}

function stageFor(believers: number): MovementStage {
  if (believers >= MOVEMENT_THRESHOLDS.movement) return "movement";
  if (believers >= MOVEMENT_THRESHOLDS.tribe) return "tribe";
  if (believers >= MOVEMENT_THRESHOLDS.forming) return "forming";
  if (believers >= MOVEMENT_THRESHOLDS.spark) return "spark";
  return "seed";
}

export function movementProgress(believersRaw: number): MovementProgress {
  const believers = Number.isFinite(believersRaw) ? Math.max(0, Math.floor(believersRaw)) : 0;
  const stage = stageFor(believers);
  const idx = ORDER.indexOf(stage);
  const nextStage = idx < ORDER.length - 1 ? ORDER[idx + 1] : null;

  // The floor of the current and next stages, so progress spans this stage only.
  const floor = stage === "seed" ? 0 : MOVEMENT_THRESHOLDS[stage as Exclude<MovementStage, "seed">];
  const nextFloor = nextStage
    ? MOVEMENT_THRESHOLDS[nextStage as Exclude<MovementStage, "seed">]
    : null;

  const toNext = nextFloor != null ? Math.max(0, nextFloor - believers) : 0;
  const progress =
    nextFloor != null && nextFloor > floor
      ? Math.max(0, Math.min(1, (believers - floor) / (nextFloor - floor)))
      : 1;

  let note: string;
  if (nextStage && nextFloor != null) {
    note = `${toNext} more believer${toNext === 1 ? "" : "s"} to become a ${MOVEMENT_LABEL[nextStage]}.`;
  } else {
    note = "A full movement — and still growing.";
  }
  if (stage === "seed" && believers <= 1) {
    note =
      believers === 0
        ? "Be the first to stand here."
        : `Just you so far — ${MOVEMENT_THRESHOLDS.spark - believers} more to spark a movement.`;
  }

  return {
    stage,
    label: MOVEMENT_LABEL[stage],
    believers,
    nextStage,
    nextLabel: nextStage ? MOVEMENT_LABEL[nextStage] : null,
    toNext,
    progress,
    note,
  };
}
