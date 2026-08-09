/**
 * A TRANSITION CARRIES ITS OWN EVIDENCE.
 *
 * The signal vector reads `market_state` as it is NOW. That is right for a
 * trade that just landed, and wrong for a derived market reading that was
 * measured hours ago: "More believers. Less capital. 3 people joined while $215
 * left" is a proven contradiction, but by the time it is read the 24h windows
 * behind it have rolled and the vector sees an empty market. The clue then
 * scores as a receipt and — worse — can never earn the open question, because
 * the question layer only listens to the vector.
 *
 * So the emitted transition speaks for itself. This module turns the frozen
 * payload (the type the emitter proved, the significance it assigned, and how
 * long ago it was measured) into the same `VoiceInput` shape, decayed by age,
 * and merges it with whatever the live market state still shows. It never
 * invents a shape the emitter did not name, and it never raises a signal above
 * the significance the emitter recorded.
 */
import type { VoiceInput } from "./pi-voice";
import type { TensionKind, ConcentrationKind } from "./signal-vector";

type Key = keyof VoiceInput["signals"];

/** Evidence stays fresh this long, then decays to nothing. */
export const TRANSITION_FRESH_HOURS = 6;
export const TRANSITION_STALE_HOURS = 30;

/** How much of a signal's strength survives into information gain. */
const GAIN: Record<Key, number> = {
  tension: 0.75,
  nonresponse: 0.7,
  beforePrice: 0.6,
  concentration: 0.55,
  unusual: 0.5,
  reversing: 0.45,
  building: 0.25,
  confirmation: 0.15,
};

const SHAPE: Record<
  string,
  { key: Key; tensionKind?: TensionKind; concentrationKind?: ConcentrationKind }
> = {
  people_capital_divergence: { key: "tension", tensionKind: "people_up_capital_down" },
  price_conviction_divergence: { key: "tension", tensionKind: "price_up_believers_flat" },
  concentration_rising: { key: "concentration", concentrationKind: "concentrating" },
  majority_flipped: { key: "reversing" },
  market_balanced: { key: "reversing" },
  losing_conviction: { key: "reversing" },
  market_reawakened: { key: "unusual" },
  accelerating: { key: "unusual" },
  participation_broadening: { key: "building" },
  side_doubled: { key: "building" },
  material_move: { key: "building" },
};

const zero = (): VoiceInput["signals"] => ({
  tension: 0,
  beforePrice: 0,
  unusual: 0,
  concentration: 0,
  reversing: 0,
  building: 0,
  nonresponse: 0,
  confirmation: 0,
});

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Full strength while fresh, straight-line to zero as the reading goes stale. */
export function transitionFreshness(ageHours: number): number {
  if (!Number.isFinite(ageHours) || ageHours < 0) return 0;
  if (ageHours <= TRANSITION_FRESH_HOURS) return 1;
  if (ageHours >= TRANSITION_STALE_HOURS) return 0;
  return clamp01(
    (TRANSITION_STALE_HOURS - ageHours) / (TRANSITION_STALE_HOURS - TRANSITION_FRESH_HOURS),
  );
}

/**
 * The vector a transition row carries on its own, or null when the emitter
 * named no shape this layer understands.
 */
export function signalFromTransition(input: {
  type?: string | null;
  significance?: number | null;
  ageHours: number;
}): VoiceInput | null {
  const shape = input.type ? SHAPE[input.type] : undefined;
  if (!shape) return null;
  const sig = Number(input.significance);
  const base = Number.isFinite(sig) && sig > 0 ? clamp01(sig) : 0.5;
  const strength = clamp01(base * transitionFreshness(input.ageHours));
  if (strength <= 0) return null;

  const signals = zero();
  signals[shape.key] = strength;
  return {
    signals,
    informationGain: clamp01(strength * GAIN[shape.key]),
    tensionKind: shape.tensionKind,
    concentrationKind: shape.concentrationKind,
  };
}

/**
 * Take the strongest reading of each shape. The live market state wins where it
 * still sees something; the frozen evidence fills the silence it left behind.
 */
export function mergeSignals(
  live: VoiceInput | null | undefined,
  own: VoiceInput | null | undefined,
): VoiceInput | null {
  if (!live) return own ?? null;
  if (!own) return live;
  const signals = zero();
  for (const k of Object.keys(signals) as Key[])
    signals[k] = Math.max(live.signals[k] ?? 0, own.signals[k] ?? 0);
  return {
    ...live,
    signals,
    informationGain: Math.max(live.informationGain, own.informationGain),
    tensionKind: live.tensionKind ?? own.tensionKind,
    concentrationKind: live.concentrationKind ?? own.concentrationKind,
  };
}
