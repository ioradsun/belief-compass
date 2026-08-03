/**
 * StoryStrip + FacePile — the narrative layer on a market card.
 *
 * Renders the server-composed beats (event → momentum → relationship) and the
 * avatar pile. Pure presentation: all copy + privacy decisions are made server-
 * side in src/domain/story.ts; this only styles what it's handed.
 */
import type { MarketStory, StoryBeat, BeatTone } from "@/domain/story";
import { hueFor, initialsFor } from "@/lib/wallet-identity";
import { PersonAvatar } from "@/components/PersonAvatar";

// Beat dots stay neutral on purpose: only YES/NO words and percentages carry
// colour, so the feed reads as text instead of a traffic-light board.
const TONE_DOT: Record<BeatTone, string> = {
  yes: "var(--text-muted)",
  no: "var(--text-muted)",
  hot: "var(--text-secondary)",
  neutral: "var(--text-muted)",
};

export function StoryStrip({ story }: { story?: MarketStory | null }) {
  if (!story || (story.beats.length === 0 && !story.crowd)) return null;
  return (
    <div className="space-y-1.5">
      {story.beats.map((b, i) => (
        <BeatLine key={`${b.kind}-${i}`} beat={b} />
      ))}
      <FacePile story={story} />
    </div>
  );
}

function BeatLine({ beat }: { beat: StoryBeat }) {
  return (
    <div className="flex items-start gap-2 text-[12px] leading-snug">
      <span
        className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: TONE_DOT[beat.tone] }}
        aria-hidden
      />
      <span className="min-w-0 text-[var(--text-secondary)]">
        {beat.emoji ? <span className="mr-1">{beat.emoji}</span> : null}
        {beat.text}
      </span>
    </div>
  );
}

/** Real faces for the viewer's network, then an anonymous count for the crowd. */
export function FacePile({ story }: { story: MarketStory }) {
  const faces = story.faces.slice(0, 3);
  const crowd = story.crowd;
  if (faces.length === 0 && !crowd) return null;

  const crowdTone = crowd?.side === "YES" ? "var(--yes)" : "var(--no)";
  return (
    <div className="flex items-center gap-2 pt-0.5">
      {(faces.length > 0 || crowd) && (
        <div className="flex -space-x-1.5">
          {faces.map((f) => (
            <PersonAvatar
              key={f.wallet}
              wallet={f.wallet}
              name={f.name}
              avatarUrl={f.avatarUrl}
              size={20}
              className="ring-1 ring-[var(--bg)]"
            />
          ))}
          {/* Anonymous crowd chips — no identity, just presence. */}
          {crowd &&
            Array.from({ length: Math.min(3, Math.max(0, crowd.count - faces.length)) }).map(
              (_, i) => (
                <span
                  key={`c-${i}`}
                  className="h-5 w-5 rounded-full ring-1 ring-[var(--bg)]"
                  style={{
                    background: "color-mix(in oklab, var(--text-muted) 30%, var(--surface))",
                  }}
                  aria-hidden
                />
              ),
            )}
        </div>
      )}
      {crowd && (
        <span className="text-[11px] text-[var(--text-muted)]">
          <span className="num font-medium text-[var(--text-secondary)]">{crowd.count}</span> backed{" "}
          <span className="font-semibold" style={{ color: crowdTone }}>
            {crowd.side}
          </span>
        </span>
      )}
    </div>
  );
}
