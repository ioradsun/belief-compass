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
 *   3. Position side (YES/NO) → OPTION B: YES = blue, NO = grey. Green/red are
 *      NOT used for sides, so nothing fights P&L for green.
 * Price *momentum* is not profit, so it renders as a neutral arrow + signed %
 * (no green/red) — that keeps green exclusively for realized gains and avoids
 * clashing with the ring's opposition-red on the same card.
 */
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { listConvictionFeed } from "@/lib/feed.functions";
import {
  initialsFor,
  hueFor,
  relationshipColor,
  relationshipStrength,
  isOpposed,
} from "@/lib/conviction-feed";
import type { ActorIdentity, AvatarRef, FeedCard, Side } from "@/lib/conviction-feed";

// Badge tint per role (the label chip only — the ring hue is computed from the
// match score on the relationship axis). People/Opp sit on the purple↔red
// relationship poles; creator/market are their own off-axis identity hues.
const BADGE_COLOR: Record<string, string> = {
  people: "#6d28d9", // deep purple
  opp: "#b91c1c", // deep red
  creator: "#0891b2", // cyan — authorship
  market: "#d97706", // amber — network
};

// Option B position-side colors — never green/red (that's P&L's).
const SIDE_COLOR: Record<Side, string> = {
  YES: "#2563eb", // blue
  NO: "#6b7280", // grey
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

  // Individual: avatar (in conviction-match ring for People/Opp) + badge + name.
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground" title={title}>
      <RingAvatar actor={actor} />
      <Badge color={color} label={actor.badge} />
      {(actor.displayName ?? actor.alias) && (
        <span className="font-medium text-foreground">{actor.displayName ?? actor.alias}</span>
      )}
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

/** The colored side token — Option B (YES = blue, NO = grey), never green/red. */
function SideToken({ side }: { side: Side }) {
  return (
    <span style={{ color: SIDE_COLOR[side] }} className="font-medium">
      {side}
    </span>
  );
}

/**
 * Price + one context fact. Leads with the % move when there is one; otherwise
 * shows the current market odds (money-weighted YES%) so the "price" is never a
 * blank line. Momentum renders as a neutral arrow + signed % — NOT green/red,
 * which stays reserved for realized P&L. A muted meta row carries conviction and
 * the believer split.
 */
function PriceContext({ card }: { card: FeedCard }) {
  const hasMove = card.priceSide && card.priceChgPct != null;
  const up = (card.priceChgPct ?? 0) >= 0;

  let priceEl: ReactNode = null;
  if (hasMove) {
    priceEl = (
      <>
        <SideToken side={card.priceSide!} />{" "}
        <span className="text-foreground">
          {up ? "▲" : "▼"} {up ? "+" : ""}
          {card.priceChgPct!.toFixed(0)}%
        </span>
      </>
    );
  } else if (card.impliedYesPct != null) {
    priceEl = (
      <>
        <span className="text-foreground">{Math.round(card.impliedYesPct)}%</span>{" "}
        <SideToken side="YES" />
        <span className="text-muted-foreground"> odds</span>
      </>
    );
  }

  const meta: string[] = [];
  if (card.convictionPct != null) meta.push(`${card.convictionPct}% conviction`);
  if (card.believersYes != null && card.believersNo != null) {
    meta.push(`${card.believersYes} YES · ${card.believersNo} NO`);
  }

  if (!priceEl && !card.context && meta.length === 0) return null;
  return (
    <div className="mt-1 space-y-0.5 text-xs">
      {(priceEl || card.context) && (
        <div className="tabular-nums">
          {priceEl}
          {priceEl && card.context && <span className="text-muted-foreground"> · </span>}
          {card.context && <span className="text-muted-foreground">{card.context}</span>}
        </div>
      )}
      {meta.length > 0 && (
        <div className="text-muted-foreground tabular-nums">{meta.join(" · ")}</div>
      )}
    </div>
  );
}

function ConvictionCard({ card }: { card: FeedCard }) {
  return (
    <div className="rounded-lg border border-border bg-background/60 p-4 transition-colors hover:bg-muted/30">
      {/* wealth — the visceral hook, loudest — with when it happened */}
      <div className="flex items-baseline justify-between gap-2">
        {card.wealth ? (
          <div className="text-lg font-semibold tracking-tight">{card.wealth.text}</div>
        ) : (
          <div className="text-sm font-medium text-muted-foreground">No money in yet</div>
        )}
        <time className="shrink-0 text-[11px] text-muted-foreground" dateTime={card.occurredAt}>
          {timeAgo(card.occurredAt)}
        </time>
      </div>

      {/* identity — quiet sub-line; dropped entirely when unattributed */}
      {card.actor && (
        <div className="mt-1.5">
          <IdentityRow actor={card.actor} crowd={card.crowd} crowdTotal={card.crowdTotal} />
        </div>
      )}

      {/* story — the one sentence */}
      <p className="mt-1.5 text-sm text-foreground">{card.story}</p>
      <p className="text-xs text-muted-foreground">{card.marketTitle}</p>

      {/* who else is in — the crowd behind an individual actor */}
      {card.actor?.scale === "individual" && card.crowdTotal >= 1 && card.crowd.length > 0 && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <AvatarStack refs={card.crowd} total={card.crowdTotal} max={4} size={20} />
          <span className="text-[11px] text-muted-foreground">
            {card.crowdTotal === 1 ? "1 other believer" : `${card.crowdTotal} others in`}
          </span>
        </div>
      )}

      {/* price + one context fact */}
      <PriceContext card={card} />

      {/* exactly one action */}
      <div className="mt-3">
        <a
          href={`/market/${card.onchain_id}`}
          className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
        >
          Open Market
        </a>
      </div>
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
        <span className="text-[10px] text-muted-foreground">who changed their mind — and why</span>
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
