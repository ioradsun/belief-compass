/**
 * The control room's semantic palette, in one place.
 *
 * Colour in Forge is never decorative. Four tones carry meaning and nothing
 * else does: a station is working, a human is needed, something failed,
 * something passed. They resolve to `.forge-room` custom properties (see
 * src/styles.css) so a theme change retunes the console with the app, and so
 * Forge never borrows YES/NO — those mean "a side of a belief" everywhere
 * else and must not start meaning "running" here.
 *
 * Pure data. Kept out of the component files so those export components only.
 */
import type { StationTone } from "@/lib/forge/stations";
import type { ObjectionSeverity } from "@/lib/forge/types";
import type { HumanState } from "@/lib/forge/narrative";

export const TONE_COLOR: Record<StationTone, string> = {
  active: "var(--station-run)",
  attention: "var(--station-attention)",
  fail: "var(--station-fail)",
  pass: "var(--station-pass)",
  idle: "var(--text-muted)",
};

/** A job's inbox state, in the same four tones. */
export const STATE_TONE: Record<HumanState, StationTone> = {
  running: "active",
  "needs-you": "attention",
  failed: "fail",
  ready: "attention",
  completed: "idle",
};

/** CRITICAL and HIGH block implementation, so they share the failure tone. */
export const SEVERITY_TONE: Record<ObjectionSeverity, StationTone> = {
  CRITICAL: "fail",
  HIGH: "fail",
  MEDIUM: "attention",
  LOW: "idle",
};

/** 24-hour, seconds included: an operations log, not a friendly timestamp. */
export function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}
