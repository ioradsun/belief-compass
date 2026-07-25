/**
 * Conviction Signal Feed — the card list.
 *
 * Loudness order, per spec: wealth → story → identity + context. Identity is
 * chrome (badge + conviction-match ring + avatar); only the story reads as
 * language. The ring IS the match % — the number never appears as text on the
 * card (exact value in the ring's tooltip).
 *
 * ── PALETTE RULE: each color axis means exactly ONE thing; hues never overlap ──
 *   1. Relationship (alignment ↔ opposition) → purple ↔ grey ↔ red RING only.
 *   2. Profit / loss → green ↔ red, GREEN RESERVED FOR PROFIT (P&L, tier 2 —
 *      not on the card yet), always paired with a +/- sign.
 *   3. Position side (YES/NO) → OPTION B: when ever tokenized, YES = blue,
 *      NO = grey — never green/red. Today sides appear only inside prose, so no
 *      side color competes with P&L's green.
 * The card reads as a STORY (hook → belief → story → turn), composed by the
 * feed copy engine — not a recitation of fields.
 */
import { useQuery } from "@tanstack/react-query";
import { listConvictionFeed } from "@/lib/feed.functions";
import {
  initialsFor,
  hueFor,
  relationshipColor,
  relationshipStrength,
  isOpposed,
} from "@/lib/conviction-feed";
import type { ActorIdentity, AvatarRef, FeedCard } from "@/lib/conviction-feed";

// Badge tint per role (the label chip only — the ring hue is computed from the
// match score on the relationship axis). People/Opp sit on the purple↔red
// relationship poles; creator/market are their own off-axis identity hues.
const BADGE_COLOR: Record<string, string> = {
  people: "#6d28d9", // deep purple
  opp: "#b91c1c", // deep red
  creator: "#0891b2", // cyan — authorship
  market: "#d97706", // amber — network
};

/** A pfp when we have one, otherwise a stable colored circle with initials. */
function Avatar({
  pfpUrl,
  name,
  seed,
  size = 22,
}: {
  pfpUrl: string | null;
  name: string;
  seed: string;
  size?: number;
}) {
  const dim = { width: size, height: size };
  if (pfpUrl) {
    return (
      <img
        src={pfpUrl}
        alt=""
        style={dim}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="rounded-full bg-muted object-cover"
      />
    );
  }
  return (
    <span
      style={{ ...dim, backgroundColor: `hsl(${hueFor(seed)} 45% 45%)` }}
      className="inline-flex items-center justify-center rounded-full font-semibold text-white"
    >
      <span style={{ fontSize: size * 0.4 }}>{initialsFor(name)}</span>
    </span>
  );
}

/**
 * Conviction-match ring around an avatar. Hue = relationship (purple↔grey↔red),
 * arc fill = strength (distance from neutral, filling for BOTH poles). The
 * redundant, non-hue channel required for color-blind safety: aligned rings are
 * thick, opposed rings are thin — so alignment survives without seeing the color.
 */
function RingAvatar({ actor }: { actor: ActorIdentity }) {
  const name = actor.displayName ?? actor.alias ?? "?";
  const avatar = <Avatar pfpUrl={actor.pfpUrl} name={name} seed={actor.alias ?? name} size={22} />;
  if (actor.matchPct == null) return <span className="shrink-0">{avatar}</span>;

  const color = relationshipColor(actor.matchPct);
  const strength = relationshipStrength(actor.matchPct);
  const opposed = isOpposed(actor.matchPct);
  const width = opposed ? 1.75 : 3; // redundant channel: aligned thick, opposed thin
  const r = 13;
  const c = 2 * Math.PI * r;
  const off = c * (1 - strength);
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: 32, height: 32 }}
    >
      <svg width="32" height="32" viewBox="0 0 32 32" className="absolute inset-0" aria-hidden>
        <circle
          cx="16"
          cy="16"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={width}
          opacity={0.18}
        />
        <circle
          cx="16"
          cy="16"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={width}
          strokeDasharray={c}
          strokeDashoffset={off}
          strokeLinecap="round"
          transform="rotate(-90 16 16)"
        />
      </svg>
      {avatar}
    </span>
  );
}

/** Overlapping avatars for a crowd. Shows `max`, then a "+N" overflow chip. */
function AvatarStack({
  refs,
  total,
  max = 4,
  size = 24,
}: {
  refs: AvatarRef[];
  total: number;
  max?: number;
  size?: number;
}) {
  const shown = refs.slice(0, max);
  const overflow = Math.max(0, total - shown.length);
  return (
    <div className="flex items-center">
      {shown.map((r, i) => (
        <span
          key={`${r.wallet}-${i}`}
          className="rounded-full ring-2 ring-background"
          style={{ marginLeft: i === 0 ? 0 : -8, zIndex: shown.length - i }}
          title={r.displayName ?? r.alias}
        >
          <Avatar pfpUrl={r.pfpUrl} name={r.displayName ?? r.alias} seed={r.wallet} size={size} />
        </span>
      ))}
      {overflow > 0 && (
        <span
          className="inline-flex items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground ring-2 ring-background"
          style={{ width: size, height: size, marginLeft: -8, fontSize: size * 0.36 }}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}

function Badge({ color, label }: { color: string; label: string }) {
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{ color, backgroundColor: `${color}1a` }}
    >
      {label}
    </span>
  );
}

function IdentityRow({
  actor,
  crowd,
  crowdTotal,
}: {
  actor: ActorIdentity;
  crowd: AvatarRef[];
  crowdTotal: number;
}) {
  const color = BADGE_COLOR[actor.role ?? "market"] ?? BADGE_COLOR.market;
  // Tooltip carries the exact value — as match or opposite, whichever the score is.
  const title =
    actor.matchPct == null
      ? undefined
      : isOpposed(actor.matchPct)
        ? `${Math.round(100 - actor.matchPct)}% opposite`
        : `${Math.round(actor.matchPct)}% match`;

  // Network scale: no single person — lead with the stack of backers, no ring.
  if (actor.scale === "market") {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {crowd.length > 0 ? (
          <AvatarStack refs={crowd} total={crowdTotal} />
        ) : (
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
        )}
        <Badge color={color} label={actor.badge} />
      </div>
    );
  }

  // Individual: avatar (in conviction-match ring for People/Opp) + badge.
  // The name is carried by the story hook, so it isn't repeated here.
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground" title={title}>
      <RingAvatar actor={actor} />
      <Badge color={color} label={actor.badge} />
    </div>
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

const actionBtn =
  "inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted";

/** The single natural next step the story invites — never a forced trade. */
function CardAction({ card }: { card: FeedCard }) {
  const kind = card.copy?.action.kind ?? "open";
  const market = `/market/${card.onchain_id}`;

  if (kind === "back_sides") {
    // Live tension → let the reader take a side. (Backing happens on the market
    // page until inline wallet-connect lands, so both route there.)
    return (
      <div className="mt-3 flex gap-2">
        <a href={`${market}?side=YES`} className={actionBtn}>
          Back YES
        </a>
        <a href={`${market}?side=NO`} className={actionBtn}>
          Back NO
        </a>
      </div>
    );
  }
  if (kind === "convictions" && card.actorWallet) {
    return (
      <div className="mt-3">
        <a href={`/wallet/${card.actorWallet}`} className={actionBtn}>
          See Their Convictions
        </a>
      </div>
    );
  }
  const label = card.copy?.action.label ?? "Open Market";
  return (
    <div className="mt-3">
      <a href={market} className={actionBtn}>
        {kind === "convictions" ? "Open Market" : label}
      </a>
    </div>
  );
}

/**
 * A card reads as a small story, not a field dump: an identity glance, then
 * HOOK → BELIEF → STORY → (TURN only when tension is real) → one action.
 */
function ConvictionCard({ card }: { card: FeedCard }) {
  const copy = card.copy;
  return (
    <div className="rounded-lg border border-border bg-background/60 p-4 transition-colors hover:bg-muted/30">
      {/* identity glance (avatar + ring/stack + role badge) and when it happened */}
      <div className="flex items-start justify-between gap-2">
        {card.actor ? (
          <IdentityRow actor={card.actor} crowd={card.crowd} crowdTotal={card.crowdTotal} />
        ) : (
          <span />
        )}
        <time className="shrink-0 text-[11px] text-muted-foreground" dateTime={card.occurredAt}>
          {timeAgo(card.occurredAt)}
        </time>
      </div>

      {/* HOOK — the single most interesting truthful fact */}
      <p className="mt-2 text-[15px] font-semibold leading-snug tracking-tight">
        {copy?.hook ?? card.story}
      </p>

      {/* THE BELIEF — the market question, given room to breathe */}
      <p className="mt-1.5 text-[15px] leading-snug text-foreground">
        &ldquo;{copy?.belief ?? card.marketTitle}&rdquo;
      </p>

      {/* THE STORY — who acted, what changed */}
      {copy?.story && <p className="mt-1.5 text-sm text-muted-foreground">{copy.story}</p>}

      {/* THE TURN — shown only when tension is real (material divergence) */}
      {copy?.turn && (
        <p className="mt-1.5 text-sm font-medium text-amber-600 dark:text-amber-500">{copy.turn}</p>
      )}

      <CardAction card={card} />
    </div>
  );
}

export function ConvictionFeed({ wallet }: { wallet?: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["conviction-feed", wallet ?? null],
    queryFn: () => listConvictionFeed({ data: wallet ? { wallet } : {} }),
    refetchInterval: 30_000,
  });

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Conviction signal feed
        </h2>
        <span className="text-[10px] text-muted-foreground">
          beliefs worth a look — and who&apos;s inside them
        </span>
      </div>

      {wallet && data && !data.hasPeople && (
        <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
          Haven&apos;t found your People yet. Keep taking positions.
        </div>
      )}

      {isLoading ? (
        <div className="rounded-lg border border-border p-6 text-center text-xs text-muted-foreground">
          Reading the chain…
        </div>
      ) : !data || data.data.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
          No conviction changes yet. As wallets move, their stories appear here.
        </div>
      ) : (
        <div className="space-y-3">
          {data.data.map((card) => (
            <ConvictionCard key={card.id} card={card} />
          ))}
        </div>
      )}
    </section>
  );
}
