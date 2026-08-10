/**
 * The in-progress create-market draft, kept outside React.
 *
 * Two jobs:
 *   1. Survive unmounts. Clicking a duplicate suggestion swaps the center
 *      column to that market — the form unmounts — and the user must be able
 *      to come back to exactly what they had typed.
 *   2. Publish a "probe" (question / media fingerprint / link) that the right
 *      rail subscribes to, so the suggestion search lives next to the feed
 *      without the create form owning that UI.
 *
 * Module-level and session-scoped on purpose: a draft is not worth a round
 * trip, and it should not outlive the tab.
 */
import { useSyncExternalStore } from "react";
import type { CategorySlug } from "@/domain/categories";

export interface DraftAttachment {
  kind: "image" | "video" | "audio" | "link";
  /** Absent for links. */
  file?: File;
  previewUrl?: string;
  url?: string;
  /** Resolved platform embed for link attachments (YouTube, TikTok, …). */
  embed?: unknown;
  durationSeconds?: number | null;
  /** SHA-256 of the exact bytes — the strongest duplicate signal we have. */
  sha256?: string | null;
}

/**
 * Where a draft came from, when it did not come from a blank form. Carried so a
 * published market can be attributed back to the House idea that started it.
 */
export interface DraftSource {
  suggestionId: string;
  originalQuestion: string;
}

export interface Draft {
  question: string;
  side: "YES" | "NO";
  amount: number;
  type: "text" | "media";
  attachment: DraftAttachment | null;
  source: DraftSource | null;
  /**
   * The creator's own pick, or null while the AI's read still stands. Null and
   * "the AI happened to say the same thing" have to stay distinguishable: only
   * a real pick may be stored as `category_source: "creator"`.
   */
  category: CategorySlug | null;
}

export const EMPTY_DRAFT: Draft = {
  question: "",
  side: "YES",
  amount: 0,
  type: "text",
  attachment: null,
  source: null,
  category: null,
};

/** What the suggestion search runs on. Null means "not creating right now". */
export interface Probe {
  question: string;
  sha256: string | null;
  linkUrl: string | null;
}

let draft: Draft = EMPTY_DRAFT;
let probe: Probe | null = null;
/** Suggestion keys the user has waved away for this draft. */
let dismissed = false;

const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getDraft(): Draft {
  return draft;
}

export function setDraft(patch: Partial<Draft>) {
  draft = { ...draft, ...patch };
  emit();
}

/**
 * Start a fresh draft from a House idea. Replaces (never merges into) whatever
 * was there, so accepting an idea can't inherit a stale attachment or wording.
 */
export function startDraftFromSuggestion(
  question: string,
  source: DraftSource,
  side: "YES" | "NO" = "YES",
) {
  draft = { ...EMPTY_DRAFT, question, side, source };
  dismissed = false;
  emit();
}

export function clearDraft() {
  draft = EMPTY_DRAFT;
  probe = null;
  dismissed = false;
  emit();
}

/** Called by the form as the user types / attaches; null when it unmounts. */
export function setProbe(next: Probe | null) {
  const same =
    (next === null && probe === null) ||
    (next != null &&
      probe != null &&
      next.question === probe.question &&
      next.sha256 === probe.sha256 &&
      next.linkUrl === probe.linkUrl);
  if (same) return;
  probe = next;
  emit();
}

export function dismissSuggestions() {
  dismissed = true;
  emit();
}

function snapshot() {
  return probe;
}
const serverSnapshot = () => null;

/** Right-rail subscription: the live probe, or null when dismissed/idle. */
export function useSuggestionProbe(): Probe | null {
  const p = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return dismissed ? null : p;
}

/**
 * ADOPTING AN ALTERNATE FROM THE RIGHT RAIL.
 *
 * The alternates rail lives in a different subtree from the form, so it cannot
 * setState the question directly. It publishes an adoption here and the mounted
 * form applies it. `nonce` is what makes re-adopting the SAME text work and, more
 * importantly, what lets the form tell a fresh request from a stale one: it
 * records the nonce it has seen and applies only newer ones, so remounting the
 * form (opening a duplicate and coming back) never re-overwrites an edit the
 * writer made after adopting. The value is never cleared, so the nonce only ever
 * climbs — a monotonic signal, not a piece of shared mutable draft state.
 */
let adopted: { text: string; nonce: number } | null = null;

export function adoptQuestion(text: string) {
  adopted = { text, nonce: (adopted?.nonce ?? 0) + 1 };
  emit();
}

const adoptedSnapshot = () => adopted;
const adoptedServerSnapshot = () => null;

/** Form subscription: the latest adoption request, or null if none yet. */
export function useAdoptedQuestion(): { text: string; nonce: number } | null {
  return useSyncExternalStore(subscribe, adoptedSnapshot, adoptedServerSnapshot);
}

/** SHA-256 of a file, hex. Used to catch the same upload under new wording. */
export async function hashFile(file: File): Promise<string | null> {
  try {
    const buf = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}
