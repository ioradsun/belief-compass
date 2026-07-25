/**
 * Conviction Signal Feed — the card list.
 *
 * Loudness order, per spec: wealth → story → identity + context. Identity is
 * chrome (badge + completeness ring + alias); only the story reads as language.
 * The ring's fill IS the match % — the number never appears as text on the card
 * (it lives in the ring's tooltip).
 */
import { useQuery } from "@tanstack/react-query";
import { listConvictionFeed } from "@/lib/feed.functions";
import { initialsFor, hueFor } from "@/lib/conviction-feed";
import type { ActorIdentity, AvatarRef, FeedCard } from "@/lib/conviction-feed";

const ROLE_COLOR: Record<string, string> = {
  people: "#7c3aed", // purple — your echo
  opp: "#e11d48", // red — your opposite
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

/** The completeness ring drawn around an avatar. Fill = match %. */
function RingAvatar({ actor, color }: { actor: ActorIdentity; color: string }) {
  const name = actor.displayName ?? actor.alias ?? "?";
  const avatar = <Avatar pfpUrl={actor.pfpUrl} name={name} seed={actor.alias ?? name} size={22} />;
  if (actor.matchPct == null) return <span className="shrink-0">{avatar}</span>;
  const r = 13;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(100, actor.matchPct)) / 100);
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: 30, height: 30 }}
    >
      <svg width="30" height="30" viewBox="0 0 30 30" className="absolute inset-0" aria-hidden>
        <circle cx="15" cy="15" r={r} fill="none" stroke={color} strokeWidth="2" opacity={0.2} />
        <circle
          cx="15"
          cy="15"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeDasharray={c}
          strokeDashoffset={off}
          strokeLinecap="round"
          transform="rotate(-90 15 15)"
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
  const color = ROLE_COLOR[actor.role ?? "market"] ?? ROLE_COLOR.market;
  const title = actor.matchPct != null ? `${Math.round(actor.matchPct)}% match` : undefined;

  // Network scale: no single person — lead with the stack of backers.
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

  // Individual: avatar (in ring for People/Opp) + badge + real name or alias.
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground" title={title}>
      <RingAvatar actor={actor} color={color} />
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

/**
 * Price + one context fact. Leads with the % move when there is one; otherwise
 * shows the current market odds (money-weighted YES%) so the "price" is never a
 * blank line. A muted meta row carries conviction and the believer split.
 */
function PriceContext({ card }: { card: FeedCard }) {
  const hasMove = card.priceSide && card.priceChgPct != null;
  let priceText: string | null = null;
  if (hasMove) {
    const sign = card.priceChgPct! >= 0 ? "+" : "";
    priceText = `${card.priceSide} ${sign}${card.priceChgPct!.toFixed(0)}%`;
  } else if (card.impliedYesPct != null) {
    priceText = `${Math.round(card.impliedYesPct)}% YES odds`;
  }
  const up = (card.priceChgPct ?? 0) >= 0;

  const meta: string[] = [];
  if (card.convictionPct != null) meta.push(`${card.convictionPct}% conviction`);
  if (card.believersYes != null && card.believersNo != null) {
    meta.push(`${card.believersYes} YES · ${card.believersNo} NO`);
  }

  if (!priceText && !card.context && meta.length === 0) return null;
  return (
    <div className="mt-1 space-y-0.5 text-xs">
      {(priceText || card.context) && (
        <div className="tabular-nums">
          {priceText && (
            <span
              className={hasMove ? (up ? "text-emerald-600" : "text-rose-600") : "text-foreground"}
            >
              {priceText}
            </span>
          )}
          {priceText && card.context && <span className="text-muted-foreground"> · </span>}
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
