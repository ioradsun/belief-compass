/**
 * INSIDER — THE DISCOVERY PASS.
 *
 * The second ranking dimension, and the one the product is actually for.
 * Significance says how big an event is; this says whether it opens a
 * relationship. Both are needed: a $5,000 anonymous trade really is the bigger
 * event, and a $50 buy by your Twin really is the better row.
 *
 * Lifted out of `buildTape` whole. Everything here is pure — it reads the
 * composed rows and the viewer's relationship graph and returns numbers plus
 * the synthesized "you two should meet" rows. No IO, no mutation of the input
 * rows, so it can be run twice with two readers and compared.
 */
import { discoveryValue, markSeen, type DiscoverySubject } from "@/domain/discovery";
import {
  scoreDiscoveryMoment,
  tellDiscoveryMoment,
  type DiscoveryMoment,
} from "@/domain/discovery-moment";
import { flattenStory, type LiveRow } from "@/lib/live-tape";
import { aliasFor } from "@/lib/wallet-identity";
import type { NetLabel } from "@/domain/viewer-network";
import type { CachedRelationship } from "@/lib/dna/viewer-dna-cache.server";
import type { ProfileLike } from "@/domain/feed-people";

/** A cohort member as the grammar kept them — the face stack only needs names. */
interface CohortHolderLike {
  wallet: string;
  daysHeld?: number | null;
}

export interface DiscoveryPassInput<R extends LiveRow> {
  /** The admitted rows, in chronological order (newest first, as composed). */
  material: R[];
  /** The viewer's unstored "meet this person" moments, if any. */
  moments: DiscoveryMoment[];
  cohortPeople: Map<string, CohortHolderLike[]>;
  labelByWallet: Map<string, NetLabel>;
  relByWallet: Map<string, CachedRelationship>;
  beliefByKey: Map<string, { daysHeld: number | null }>;
  profiles: Map<string, ProfileLike>;
}

export interface DiscoveryPassResult {
  /** rowId → discovery score, for the mixer. */
  discovery: Map<string, number>;
  /** wallet → how recently the reader has already met them in this feed. */
  seen: Map<string, number>;
  /** Synthesized relationship rows, to be placed at the head of the material. */
  momentRows: LiveRow[];
}

export function runDiscoveryPass<R extends LiveRow>({
  material,
  moments,
  cohortPeople,
  labelByWallet,
  relByWallet,
  beliefByKey,
  profiles,
}: DiscoveryPassInput<R>): DiscoveryPassResult {
  // Walked in chronological order so `seen` is deterministic — the reader's
  // eventual order comes from the mixer, which cannot be an input to its own
  // inputs, so "most recent appearance is the first one" is the honest proxy.
  const discovery = new Map<string, number>();
  const seen = new Map<string, number>();

  const subjectsFor = (r: R): DiscoverySubject[] => {
    const group = cohortPeople.get(r.id);
    const wallets = group?.length ? group.map((p) => p.wallet) : r.wallet ? [r.wallet] : [];
    const founding =
      r.kind === "conviction_cohort" && (r.payload as { kind?: string }).kind === "founding";
    return wallets.map((raw) => {
      const w = raw.toLowerCase();
      const rel = relByWallet.get(w);
      const held = group?.find((p) => p.wallet.toLowerCase() === w)?.daysHeld;
      return {
        wallet: w,
        relationship: labelByWallet.get(w) ?? null,
        sharedConvictions: rel?.sharedBeliefs ?? null,
        confidence: rel?.confidence ?? null,
        topicCount: rel?.topicCount ?? null,
        since: rel?.since ?? null,
        daysHeld: held ?? beliefByKey.get(`${w}:${Number(r.marketId)}`)?.daysHeld ?? null,
        founding,
      } satisfies DiscoverySubject;
    });
  };

  for (const r of material) {
    const subs = subjectsFor(r);
    discovery.set(r.id, discoveryValue(subs, { seen }).score);
    markSeen(
      seen,
      subs.map((s) => s.wallet),
    );
  }

  // ── MEETING SOMEONE ──────────────────────────────────────────────────────
  // The rarest rows in the feed, and the only ones not about a market. They
  // are synthesized here rather than stored because they exist for exactly one
  // reader — see src/domain/discovery-moment for why that needs no ledger.
  const momentRows: LiveRow[] = [];
  for (const m of moments) {
    // Name the people first: the copy speaks about them, and the DNA cache
    // stores wallets, not names. `aliasFor` is the last resort so a row never
    // shows a hex address where a person should be.
    const named = m.people.map((p) => {
      const prof = profiles.get(p.wallet.toLowerCase());
      return { ...p, name: prof?.displayName ?? aliasFor(p.wallet) };
    });
    const story = tellDiscoveryMoment({ ...m, people: named });
    const lead = named[0];
    const significance = scoreDiscoveryMoment({
      rarity: m.rarity,
      sharedConvictions: lead?.sharedBeliefs ?? null,
      people: named.length,
    }).score;
    const subs: DiscoverySubject[] = named.map((p) => ({
      wallet: p.wallet.toLowerCase(),
      relationship:
        p.relationship === "neutral" || p.relationship === "insufficient" ? null : p.relationship,
      sharedConvictions: p.sharedBeliefs,
      confidence: p.confidence,
      topicCount: p.topicCount ?? null,
      since: p.since ?? null,
    }));
    const row: LiveRow = {
      id: m.id,
      kind: "discovery_moment",
      // Not about a market. The renderer treats a non-positive id as "no
      // destination" and lets the faces be the only way in — which is what
      // this row is for.
      marketId: "0",
      marketTitle: "",
      occurredAt: m.occurredAt,
      startedAt: m.occurredAt,
      side: null,
      walletCount: named.length,
      tradeCount: null,
      amountEth: null,
      amountUsd: null,
      wallet: null,
      people: named.map((p) => ({
        wallet: p.wallet,
        name: p.name,
        avatarUrl: profiles.get(p.wallet.toLowerCase())?.pfpUrl ?? null,
      })),
      story,
      text: flattenStory(story),
      payload: { significance },
      mix: {
        id: m.id,
        family: "relationship_story",
        significance,
        discovery: discoveryValue(subs, { seen }).score,
        occurredAt: m.occurredAt,
        marketId: "0",
        side: null,
        subjects: subs.map((s) => s.wallet),
        motif: `discovery:${m.kind}`,
      },
    };
    momentRows.push(row);
    markSeen(
      seen,
      subs.map((s) => s.wallet),
    );
  }

  return { discovery, seen, momentRows };
}
