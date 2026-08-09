/**
 * THE READER'S NETWORK, resolved from what the DNA engine already cached.
 *
 * This is the piece of the tape that decides who is a Twin, who is a Rival, and
 * therefore which sentences a reader sees — the same trade reads differently
 * depending on whether the person behind it is a stranger or someone you match.
 * It is the leak-prone half of personalization, so it lives here: pure, taking
 * one viewer's cached row and returning only what that viewer may see.
 *
 * PURE ON PURPOSE. It touches no client, mutates nothing it is given, and builds
 * fresh Maps every call. Two viewers cannot reach each other through it, because
 * there is nothing shared for them to reach through — which is the property the
 * eventual cache boundary has to rest on, and the reason this was worth pulling
 * out of an 1100-line function before anything gets cached.
 *
 * SCOPE MATTERS. Discovery moments are only for the app-wide tape: a market panel
 * is about that market, not about the reader's network. Nothing is ever written —
 * a moment is a projection of relationships already cached, so the same state
 * always yields the same rows.
 */
import { findDiscoveryMoments, type DiscoveryMoment } from "@/domain/discovery-moment";
import type { CachedRelationship } from "@/lib/dna/viewer-dna-cache.server";

/** The relationship vocabulary, as the DNA cache stores it. */
export type NetLabel = "twin" | "tribe" | "opp" | "inverse";

/** The four relationship buckets the DNA engine caches per viewer. */
export interface ViewerDnaRow {
  twin_matches: unknown;
  tribe_matches: unknown;
  opp_matches: unknown;
  inverse_matches: unknown;
}

export interface ViewerNetwork {
  /** wallet → what they are to this reader. */
  labelByWallet: Map<string, NetLabel>;
  /**
   * The relationships in full, not just their names. Discovery asks how much
   * EVIDENCE stands behind a label and how recently it was formed — a 100% match
   * on three shared markets is a coincidence, not a Twin.
   */
  relByWallet: Map<string, CachedRelationship>;
  /** Who this reader is meeting. Empty when scoped to one market. */
  moments: DiscoveryMoment[];
}

/** Nobody signed in, or nothing cached for them yet. */
const EMPTY: ViewerNetwork = {
  labelByWallet: new Map(),
  relByWallet: new Map(),
  moments: [],
};

export function viewerNetwork(cache: ViewerDnaRow | null, scoped: boolean): ViewerNetwork {
  if (!cache) return { ...EMPTY, labelByWallet: new Map(), relByWallet: new Map(), moments: [] };

  const labelByWallet = new Map<string, NetLabel>();
  const relByWallet = new Map<string, CachedRelationship>();

  const add = (rows: unknown, label: NetLabel): CachedRelationship[] => {
    const out = ((rows as CachedRelationship[] | null) ?? []).filter((r) => r.wallet);
    for (const r of out) {
      const w = String(r.wallet).toLowerCase();
      labelByWallet.set(w, label);
      relByWallet.set(w, r);
    }
    return out;
  };

  const net = {
    twin: add(cache.twin_matches, "twin"),
    tribe: add(cache.tribe_matches, "tribe"),
    opp: add(cache.opp_matches, "opp"),
    inverse: add(cache.inverse_matches, "inverse"),
  };

  return { labelByWallet, relByWallet, moments: scoped ? [] : findDiscoveryMoments(net) };
}
