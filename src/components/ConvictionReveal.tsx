/**
 * ConvictionReveal — the emotional payoff after a completed YES/NO position.
 *
 * ONE component for desktop and mobile. The pure `getConvictionReveal` engine
 * decides the story (a headline + at most two cards + one CTA); this only renders
 * it. There is no desktop/mobile branching — typography and spacing are fluid
 * (clamp), the layout is centered and capped, and it always fits one viewport
 * with no scrolling, no charts, no dashboards.
 *
 * The beats fade gently upward in order: ✓ → headline (The House) → card → card →
 * CTA. Small and elegant; never fireworks.
 */
import { hueFor, initialsFor } from "@/lib/wallet-identity";
import type { RevealStory, RevealFace, RevealCard } from "@/domain/conviction-reveal";

const toneColor = (tone: RevealStory["tone"]): string =>
  tone === "yes" ? "var(--yes)" : tone === "no" ? "var(--no)" : "var(--text)";

/** Each beat fades in, slightly upward, in sequence. */
function Beat({ delay, children }: { delay: number; children: React.ReactNode }) {
  return (
    <div
      className="animate-in fade-in slide-in-from-bottom-2 duration-500 motion-reduce:animate-none"
      style={{ animationDelay: `${delay}ms`, animationFillMode: "both" }}
    >
      {children}
    </div>
  );
}

function Faces({ faces, overflow }: { faces: RevealFace[]; overflow: number }) {
  if (faces.length === 0 && overflow <= 0) return null;
  return (
    <div className="mt-3 flex items-center justify-center">
      <div className="flex -space-x-2">
        {faces.map((f) =>
          f.avatarUrl ? (
            <img
              key={f.wallet}
              src={f.avatarUrl}
              alt=""
              className="h-8 w-8 rounded-full object-cover ring-2 ring-[var(--panel)]"
            />
          ) : (
            <span
              key={f.wallet}
              className="grid h-8 w-8 place-items-center rounded-full text-[11px] font-semibold text-white ring-2 ring-[var(--panel)]"
              style={{ background: `hsl(${hueFor(f.wallet)} 45% 45%)` }}
              aria-hidden
            >
              {initialsFor(f.name)}
            </span>
          ),
        )}
      </div>
      {overflow > 0 && (
        <span className="num ml-2 text-[13px] font-semibold text-[var(--text-muted)]">
          +{overflow}
        </span>
      )}
    </div>
  );
}

function Card({ card }: { card: RevealCard }) {
  return (
    <div
      // Padding is part of the height budget too: on a short window five
      // stacked cards of fixed padding are what pushes the story off screen.
      className="rounded-2xl px-5 py-[clamp(8px,1.8vh,16px)] text-center"
      style={{ background: "var(--surface)" }}
    >
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
        <span aria-hidden>{card.icon}</span> {card.title}
      </div>
      <p className="mt-1.5 text-[clamp(13px,min(3.6vw,2.2vh),17px)] leading-snug text-[var(--text)]">
        {card.body}
      </p>
      <Faces faces={card.faces} overflow={card.overflow} />
    </div>
  );
}

export function ConvictionReveal({
  story,
  side,
  onNext,
  onMeetTribe,
}: {
  story: RevealStory;
  side: "YES" | "NO";
  /**
   * THIS COMPONENT NO LONGER OWNS WHERE "NEXT" GOES.
   *
   * It used to render the one CTA on the post-buy screen and decide, by itself,
   * that the way out was `story.cta` — while `KeepChainMoving` decided
   * separately whether to offer a relay and the route decided separately what
   * "done" meant. Three owners, one moment, none able to see the others.
   *
   * `resolvePostAction` owns that now. Omit both handlers and this renders the
   * STORY ALONE, as a slot inside `PostActionScreen` — which is how every
   * post-buy surface uses it. The handlers survive for the standalone contexts
   * that are genuinely just a story with a way onward.
   */
  onNext?: () => void;
  /** Optional deeper path when the secondary CTA is a people-story. */
  onMeetTribe?: () => void;
}) {
  const sideColor = side === "YES" ? "var(--yes)" : "var(--no)";
  // Beats cascade: ✓, headline, each card, then the CTA — each a touch later.
  const cardBase = 260;
  const cardStep = 150;
  const ctaDelay = cardBase + Math.max(1, story.cards.length) * cardStep + 40;
  /**
   * SLOT MODE — the story inside a surface that has already spoken.
   *
   * With no `onNext` this is rendered inside the answer surface, which has
   * already printed the tick's meaning ("You backed YES") one line above. A
   * second ✓ and a second 30px headline is the duplicate confirmation this
   * product deleted: in slot mode the story drops both and continues the page
   * instead of restarting it, in normal flow at its own natural height.
   */
  const slot = !onNext;

  return (
    /**
     * FLUID IN BOTH DIRECTIONS.
     *
     * The type here was already fluid across WIDTH and completely blind to
     * HEIGHT, so a 30px headline, 9mm of gaps and two cards read beautifully on
     * a tall screen and collided on a short one. Every vertical measurement —
     * type size, gaps, padding, the tick — is now the smaller of a width rule
     * and a height rule, so the story compresses instead of overflowing, and
     * `justify-center` only centres when there is genuinely spare room.
     */
    <div
      className={
        slot
          ? "w-full"
          : "flex min-h-0 flex-1 flex-col items-center justify-center px-4 py-[clamp(8px,2.5vh,24px)]"
      }
    >
      <div
        className={`flex w-full flex-col ${
          slot ? "gap-2.5" : "max-w-[440px] gap-[clamp(10px,2.2vh,20px)]"
        }`}
      >
        {/* ✓ — the transaction was only the unlock. Absent in slot mode, where
            the surface above it already acknowledged the call. */}
        {!slot && (
          <Beat delay={0}>
            <div className="flex items-center justify-center">
              <span
                className="grid h-[clamp(26px,4vh,36px)] w-[clamp(26px,4vh,36px)] place-items-center rounded-full text-[clamp(13px,2vh,16px)] font-bold text-[var(--bg)]"
                style={{ background: sideColor }}
                aria-hidden
              >
                ✓
              </span>
            </div>
          </Beat>
        )}

        {/* Headline — The House's voice, or a warm confirmation. */}
        <Beat delay={120}>
          <div className={slot ? "" : "text-center"}>
            <h2
              className={
                slot
                  ? "text-[15px] font-semibold leading-snug tracking-[-0.01em]"
                  : "text-[clamp(18px,min(6vw,4.4vh),30px)] font-semibold leading-tight tracking-[-0.02em]"
              }
              style={{ color: toneColor(story.tone) }}
            >
              {story.tone === "house" && <span aria-hidden>🏠 </span>}
              {story.headline}
            </h2>
            {story.subheadline && (
              <p
                className={
                  slot
                    ? "mt-1 text-[12px] text-[var(--text-muted)]"
                    : "mt-1.5 text-[13px] text-[var(--text-muted)]"
                }
              >
                {story.subheadline}
              </p>


            )}
          </div>
        </Beat>

        {/* At most two cards — the strongest stories, never every signal. */}
        {story.cards.map((card, i) => (
          <Beat key={card.type} delay={cardBase + i * cardStep}>
            <Card card={card} />
          </Beat>
        ))}

        {/* One CTA — keep going. A single quiet secondary link when meaningful.
            ABSENT ENTIRELY when no handler is given: the closing screen owns the
            navigation, and a second button here would be the old competing
            decision wearing the new architecture's clothes. */}
        {onNext && (
          <Beat delay={ctaDelay}>
            <div className="flex flex-col items-center gap-2.5">
              <button
                type="button"
                onClick={onNext}
                className="w-full rounded-full px-6 py-3 text-[15px] font-semibold text-[var(--bg)] transition-transform active:scale-[0.98] motion-reduce:active:scale-100"
                style={{ background: "var(--text)" }}
              >
                {story.cta.label} →
              </button>
              {story.secondaryCta && onMeetTribe && (
                <button
                  type="button"
                  onClick={onMeetTribe}
                  className="text-[13px] font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
                >
                  {story.secondaryCta.label} →
                </button>
              )}
            </div>
          </Beat>
        )}
      </div>
    </div>
  );
}
