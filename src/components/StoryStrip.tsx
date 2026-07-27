/**
 * StoryStrip + FacePile — the narrative layer on a market card.
 *
 * Renders the server-composed beats (event → momentum → relationship) and the
 * avatar pile. Pure presentation: all copy + privacy decisions are made server-
 * side in src/domain/story.ts; this only styles what it's handed.
 */
import type { MarketStory, StoryBeat, BeatTone } from "@/domain/story";
import { hueFor, initialsFor } from "@/lib/wallet-identity";

const TONE_DOT: Record<BeatTone, string> = {
  yes: "var(--yes)",
  no: "var(--no)",
  hot: "#f59e0b",
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
          {faces.map((f) =>
            f.avatarUrl ? (
              <img
                key={f.wallet}
                src={f.avatarUrl}
                alt=""
                className="h-5 w-5 rounded-full object-cover ring-1 ring-[var(--bg)]"
              />
            ) : (
              <span
                key={f.wallet}
                className="grid h-5 w-5 place-items-center rounded-full text-[8px] font-semibold text-white ring-1 ring-[var(--bg)]"
                style={{ background: `hsl(${hueFor(f.wallet)} 45% 45%)` }}
                aria-hidden
              >
                {initialsFor(f.name)}
              </span>
            ),
          )}
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
          <span style={{ color: crowdTone }} className="font-medium">
            {crowd.count}
          </span>{" "}
          backed {crowd.side}
        </span>
      )}
    </div>
  );
}
