/**
 * The first-person reveal — the moment the game pays off in the center.
 *
 * The persistent home for exploring people is the left DNA panel. This is the
 * single, one-time nudge: the first time there's enough evidence to mean it, the
 * neutral center quietly surfaces ONE meaningful person right under The House —
 * "someone who thinks like you is here" — and invites you to go explore them.
 * Shown once per person (localStorage-guarded); dismissing or exploring retires
 * it so it never nags.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getNetwork } from "@/lib/dna.functions";
import { dnaStage, firstMeaningfulIndex } from "@/domain/conviction-dna";
import { RELATIONSHIP_TEXT, relationshipTone } from "@/lib/dna-labels";
import { hueFor, initialsFor } from "@/lib/wallet-identity";

export function DnaFirstReveal({
  viewerWallet,
  onSelectPerson,
}: {
  viewerWallet?: string;
  onSelectPerson?: (wallet: string) => void;
}) {
  const viewer = viewerWallet?.toLowerCase();
  const [dismissed, setDismissed] = useState(false);

  const { data } = useQuery({
    // Share the Network cache so this is free while the panel is open.
    queryKey: ["network", viewer ?? null, "all", "relevant", ""],
    queryFn: () => getNetwork({ data: { wallet: viewer, limit: 60 } }),
    enabled: !!viewer && !!onSelectPerson,
    staleTime: 60_000,
  });

  const people = data?.people ?? [];
  const stage = dnaStage({
    decisions: data?.summary.expressedBeliefs ?? 0,
    hasTwinCandidate: (data?.summary.twinCount ?? 0) > 0,
  });
  const idx = firstMeaningfulIndex(people, stage);
  const person = idx >= 0 ? people[idx] : null;

  // One-time per person: don't re-surface once seen.
  const key = viewer && person ? `dna-first-reveal:${viewer}:${person.wallet.toLowerCase()}` : null;
  const [seen, setSeen] = useState(true);
  useEffect(() => {
    if (!key) return;
    try {
      setSeen(localStorage.getItem(key) === "1");
    } catch {
      setSeen(false);
    }
  }, [key]);

  if (!viewer || !onSelectPerson || !person || dismissed || seen) return null;

  const retire = () => {
    if (key) {
      try {
        localStorage.setItem(key, "1");
      } catch {
        /* storage unavailable */
      }
    }
    setDismissed(true);
  };
  const explore = () => {
    retire();
    onSelectPerson(person.wallet);
  };

  const tone = relationshipTone(person.relationship);
  const lead =
    person.relationship === "twin"
      ? "Your closest match just showed up"
      : person.relationship === "opp" || person.relationship === "inverse"
        ? "Meet someone who sees it the other way"
        : "Someone who thinks like you is here";

  return (
    <div
      className="relative rounded-[14px] p-3"
      style={{
        border: "1px solid color-mix(in oklab, var(--yes) 34%, var(--border))",
        background: "color-mix(in oklab, var(--yes) 9%, transparent)",
      }}
      aria-label="A match you can explore"
    >
      <button
        type="button"
        onClick={retire}
        aria-label="Dismiss"
        className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full text-[13px] text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
      >
        ×
      </button>
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
        {lead}
      </div>
      <button
        type="button"
        onClick={explore}
        className="mt-2 flex w-full items-center gap-2.5 text-left"
      >
        {person.avatarUrl ? (
          <img
            src={person.avatarUrl}
            alt=""
            className="h-9 w-9 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[12px] font-semibold text-white"
            style={{ background: `hsl(${hueFor(person.wallet)} 45% 45%)` }}
            aria-hidden
          >
            {initialsFor(person.displayName)}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold text-[var(--text)]">
            {person.displayName}
          </span>
          <span className="num block text-[11px] text-[var(--text-secondary)]">
            {person.agreement}% aligned · {person.sharedBeliefs} shared
          </span>
        </span>
        <span
          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
          style={{ color: tone.fg, background: tone.bg }}
        >
          {RELATIONSHIP_TEXT[person.relationship]}
        </span>
      </button>
      <button
        type="button"
        onClick={explore}
        className="mt-2.5 w-full rounded-[10px] py-2 text-[13px] font-semibold"
        style={{ background: "var(--text)", color: "var(--bg)" }}
      >
        Explore their convictions
      </button>
    </div>
  );
}
