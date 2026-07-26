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
import { type ReactNode, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useAccount } from "wagmi";
import { listConvictionFeed } from "@/lib/feed.functions";
import {
  initialsFor,
  hueFor,
  fmtUsd,
  relationshipColor,
  relationshipStrength,
  isOpposed,
} from "@/lib/conviction-feed";
import type { ActorIdentity, AvatarRef, FeedCard } from "@/lib/conviction-feed";
import type { CardFormat } from "@/lib/feed-copy";
import { MIN_SPARK_POINTS } from "@/lib/feed-price";

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

function actorName(card: FeedCard): string | null {
  return card.actor?.displayName ?? card.actor?.alias ?? null;
}

/** Tiny 2-month trajectory. Neutral stroke (momentum ≠ P&L) + an endpoint dot
 *  as the non-color trend cue for colorblind readers. */
function Sparkline({ values }: { values: number[] }) {
  const w = 60;
  const h = 16;
  const pad = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - 2 * pad);
    const y = pad + (1 - (v - min) / range) * (h - 2 * pad);
    return [x, y] as const;
  });
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg width={w} height={h} className="shrink-0" aria-hidden>
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
        strokeLinecap="round"
        className="text-muted-foreground"
      />
      <circle cx={last[0]} cy={last[1]} r="1.6" className="fill-foreground" />
    </svg>
  );
}

function Belief({ text, className = "" }: { text: string; className?: string }) {
  return <p className={`leading-snug text-foreground ${className}`}>&ldquo;{text}&rdquo;</p>;
}

// Option B side colors — never green/red (that stays reserved for P&L).
const ARMY_COLOR: Record<"YES" | "NO", string> = { YES: "#2563eb", NO: "#6b7280" };

function fmtCountCell(n: number | null): string {
  return n != null ? n.toLocaleString("en-US") : "—";
}

/** Share prices live in $0–$1 — show cents under a dollar, dollars at/above. */
function fmtSharePrice(n: number | null): string {
  if (n == null) return "—";
  return n >= 1 ? `$${n.toFixed(2)}` : `${Math.round(n * 100)}¢`;
}

/** YES / NO value pair — the two independent sides, never one derived from the other. */
function SidePair({ yes, no }: { yes: string; no: string }) {
  return (
    <span className="flex items-center gap-3 tabular-nums">
      <span style={{ color: ARMY_COLOR.YES }}>
        YES <span className="text-foreground">{yes}</span>
      </span>
      <span style={{ color: ARMY_COLOR.NO }}>
        NO <span className="text-foreground">{no}</span>
      </span>
    </span>
  );
}

function StripRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-0.5">
      <span className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * The battle strip — ONE shared evidence block on EVERY card. Three tiny rows,
 * each per-side because the three stories can disagree, and that disagreement is
 * the reason to click:
 *   Price     — the market's own consensus (per-side share price + 24h + trend)
 *   Believers — how many people are on each side (breadth)
 *   Capital   — how much money backs each side (depth)
 * Believers and capital are shown per side and never summed; YES and NO are
 * independent perpetual curves, so one is never computed as 100 − the other.
 */
function BattleStrip({ card }: { card: FeedCard }) {
  const p = card.price;
  const chg24h = p?.chg24h ?? card.priceChgPct ?? null;
  const showSpark = (p?.series.length ?? 0) >= MIN_SPARK_POINTS;
  const yesPrice = card.yesPriceUsd;
  const noPrice = card.noPriceUsd;
  const impliedYesPct = card.impliedYesPct;
  const vol = card.volume24hUsd;
  const hasPrice =
    yesPrice != null || noPrice != null || chg24h != null || showSpark || impliedYesPct != null;
  const hasBelievers = card.believersYes != null || card.believersNo != null;
  const hasCapital = card.yesCapitalUsd != null || card.noCapitalUsd != null;
  if (!hasPrice && !hasBelievers && !hasCapital) return null;

  // Momentum, not P&L: the 24h arrow stays neutral. Green/red is reserved for
  // realized/unrealized P&L (see the palette rule at the top of this file).
  const up = (chg24h ?? 0) >= 0;
  return (
    <div className="mt-2 border-t border-border/50 pt-1.5 text-xs">
      {hasPrice && (
        <StripRow label="Price">
          <SidePair yes={fmtSharePrice(yesPrice)} no={fmtSharePrice(noPrice)} />
          {impliedYesPct != null && (
            <span className="tabular-nums text-muted-foreground" title="Implied YES probability">
              <span className="font-semibold text-foreground">{Math.round(impliedYesPct)}%</span>{" "}
              implied
            </span>
          )}
          {chg24h != null && (
            <span className="tabular-nums text-muted-foreground" title="24h price performance">
              {up ? "▲ +" : "▼ −"}
              {Math.abs(Math.round(chg24h))}% 24h
            </span>
          )}
          {showSpark && (
            <span className="flex items-center gap-1.5">
              <Sparkline values={p!.series} />
              <span className="text-[10px] text-muted-foreground/70">{p!.windowLabel}</span>
            </span>
          )}
        </StripRow>
      )}
      {hasBelievers && (
        <StripRow label="Believers">
          <SidePair yes={fmtCountCell(card.believersYes)} no={fmtCountCell(card.believersNo)} />
        </StripRow>
      )}
      {hasCapital && (
        <StripRow label="Capital">
          <SidePair
            yes={card.yesCapitalUsd != null ? fmtUsd(card.yesCapitalUsd) : "—"}
            no={card.noCapitalUsd != null ? fmtUsd(card.noCapitalUsd) : "—"}
          />
          {vol != null && vol > 0 && (
            <span className="tabular-nums text-muted-foreground/80" title="24h volume">
              {fmtUsd(vol)} vol 24h
            </span>
          )}
        </StripRow>
      )}
    </div>
  );
}

// Per-format shell tint — most cards share the base; tension/rare/quiet differ so
// the timeline is visually irregular, not a uniform stack.
const SHELL: Record<CardFormat, string> = {
  birth: "border-border bg-background/60",
  character: "border-border bg-background/60",
  crowd: "border-border bg-background/60",
  scoreboard: "border-border bg-background/60",
  tension: "border-amber-500/30 bg-amber-500/[0.04]",
  // momentum = speed (sky); achievement = a neutral spotlight — deliberately NOT
  // green: green is reserved for P&L, and a structural rank is not a profit.
  momentum: "border-sky-500/30 bg-sky-500/[0.04]",
  achievement: "border-foreground/20 bg-foreground/[0.035]",
  rare: "border-violet-500/40 bg-violet-500/[0.05]",
  quiet: "border-dashed border-border bg-transparent",
};

/** One page in the story. Each format is a distinct visual beat. */
function ConvictionCard({ card }: { card: FeedCard }) {
  const copy = card.copy;
  const format: CardFormat = copy?.format ?? "quiet";
  const name = actorName(card);

  let body: ReactNode;
  switch (format) {
    case "birth":
      body = (
        <>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            New belief
          </div>
          <Belief text={copy!.belief} className="mt-1.5 text-lg font-semibold" />
          <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
            {card.actor && (
              <Avatar
                pfpUrl={card.actor.pfpUrl}
                name={name ?? "?"}
                seed={card.actor.alias ?? "?"}
                size={18}
              />
            )}
            <span>
              {name ? <span className="font-medium text-foreground">{name}</span> : "Someone"} asked
              it first.{copy!.story ? ` ${copy!.story}` : ""}
            </span>
          </div>
        </>
      );
      break;

    case "character":
      body = (
        <div className="flex items-start gap-3">
          {card.actor && <RingAvatar actor={card.actor} />}
          <div className="min-w-0 flex-1">
            {card.actor && (
              <Badge
                color={BADGE_COLOR[card.actor.role ?? "market"] ?? BADGE_COLOR.market}
                label={card.actor.badge}
              />
            )}
            <p className="mt-1 text-[15px] font-semibold leading-snug">{copy!.hook}</p>
            {copy!.story && <p className="text-sm text-muted-foreground">{copy!.story}</p>}
            <Belief text={copy!.belief} className="mt-1.5 text-xs text-muted-foreground" />
          </div>
        </div>
      );
      break;

    case "crowd":
      body = (
        <>
          {card.crowd.length > 0 ? (
            <AvatarStack refs={card.crowd} total={card.crowdTotal} max={5} size={28} />
          ) : (
            card.actor && (
              <IdentityRow actor={card.actor} crowd={card.crowd} crowdTotal={card.crowdTotal} />
            )
          )}
          <p className="mt-2 text-[15px] font-semibold leading-snug">{copy!.hook}</p>
          <Belief text={copy!.belief} className="mt-1 text-sm text-muted-foreground" />
          {copy!.story && <p className="mt-0.5 text-sm text-muted-foreground">{copy!.story}</p>}
        </>
      );
      break;

    case "scoreboard": {
      const up = (card.priceChgPct ?? 0) >= 0;
      body = (
        <>
          <div className="text-2xl font-bold tracking-tight">
            {card.priceSide} {up ? "▲ +" : "▼ "}
            {Math.abs(card.priceChgPct ?? 0).toFixed(0)}%
          </div>
          <Belief text={copy!.belief} className="mt-1 text-[15px]" />
          {copy!.story && <p className="mt-1 text-sm text-muted-foreground">{copy!.story}</p>}
        </>
      );
      break;
    }

    case "tension":
      // The money's consensus (PRICE) leads; the belief; then the turn line that
      // names the disagreement. The per-side Believers/Capital split — where the
      // tension is proven — is carried by the shared BattleStrip below.
      body = (
        <>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-lg font-bold tabular-nums">
              {card.impliedYesPct != null ? `${Math.round(card.impliedYesPct)}% YES` : "—"}
            </span>
            <span className="text-[11px] text-muted-foreground">the market price</span>
            {card.volume24hUsd != null && card.volume24hUsd > 0 && (
              <span className="text-[11px] text-muted-foreground">
                · {fmtUsd(card.volume24hUsd)} traded 24h
              </span>
            )}
          </div>
          <Belief text={copy!.belief} className="mt-1.5 text-[15px]" />
          {(copy!.shape ?? copy!.turn) && (
            <p className="mt-2 text-sm font-medium text-amber-600 dark:text-amber-500">
              {copy!.shape ?? copy!.turn}
            </p>
          )}
        </>
      );
      break;

    case "momentum":
      body = (
        <>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-sky-600 dark:text-sky-400">
              Momentum
            </span>
          </div>
          <p className="mt-1.5 text-[15px] font-semibold leading-snug">{copy!.hook}</p>
          {copy!.story && <p className="text-sm text-muted-foreground">{copy!.story}</p>}
          <Belief text={copy!.belief} className="mt-1.5 text-xs text-muted-foreground" />
        </>
      );
      break;

    case "achievement":
      body = (
        <>
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            <span aria-hidden>🏆</span> Milestone
          </div>
          <p className="mt-1.5 text-[15px] font-semibold leading-snug">{copy!.hook}</p>
          <Belief text={copy!.belief} className="mt-1 text-sm text-muted-foreground" />
          {copy!.story && <p className="mt-0.5 text-sm text-muted-foreground">{copy!.story}</p>}
        </>
      );
      break;

    case "rare":
      body = (
        <>
          <div className="flex items-center gap-2">
            {card.actor && <RingAvatar actor={card.actor} />}
            <span className="text-[11px] font-semibold uppercase tracking-widest text-violet-600 dark:text-violet-400">
              People × Opp
            </span>
          </div>
          <p className="mt-2 text-[15px] font-semibold leading-snug">{copy!.hook}</p>
          {copy!.story && <p className="text-sm text-muted-foreground">{copy!.story}</p>}
          <Belief text={copy!.belief} className="mt-1.5 text-sm text-muted-foreground" />
        </>
      );
      break;

    case "quiet":
    default:
      // A breather — but the belief question still leads; it never loses to metadata.
      body = (
        <>
          <Belief text={copy?.belief ?? card.marketTitle} className="text-base font-medium" />
          <p className="mt-1 text-sm text-muted-foreground">{copy?.hook ?? card.story}</p>
        </>
      );
      break;
  }

  return (
    <div className={`rounded-lg border p-4 transition-colors hover:bg-muted/20 ${SHELL[format]}`}>
      {/* A timestamp always names its event — never a bare "4h ago". */}
      <div className="mb-1.5 text-right">
        <time
          className="whitespace-nowrap text-[11px] text-muted-foreground"
          dateTime={card.occurredAt}
        >
          {copy?.timeLabel ? `${copy.timeLabel} ` : ""}
          {timeAgo(card.occurredAt)}
        </time>
      </div>
      {body}
      <BattleStrip card={card} />
      <CardAction card={card} />
    </div>
  );
}

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Viewer control. The relationship ring (People/Opp alignment) is viewer-
 * relative, so without a viewer the feed runs at network/creator scale and
 * shows no rings. A connected wallet (RainbowKit) drives the viewer automatically;
 * ?wallet= is an explicit override you can also paste to view AS any wallet.
 */
function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function ViewerControl({ override, connected }: { override?: string; connected?: string }) {
  const navigate = useNavigate();
  const [val, setVal] = useState("");
  const setViewer = (w: string | undefined) =>
    navigate({ to: "/", search: (prev: Record<string, unknown>) => ({ ...prev, wallet: w }) });

  // Explicit ?wallet= override — takes precedence over the connected wallet.
  if (override) {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        <span>
          Viewing as <span className="font-medium text-foreground">{short(override)}</span> — your
          People &amp; Opp are lit up.
        </span>
        <button
          type="button"
          onClick={() => setViewer(undefined)}
          className="underline hover:text-foreground"
        >
          {connected ? "back to my wallet" : "clear"}
        </button>
      </div>
    );
  }

  // Connected wallet drives the viewer — no paste needed.
  if (connected) {
    return (
      <div className="text-[11px] text-muted-foreground">
        Viewing as your wallet{" "}
        <span className="font-medium text-foreground">{short(connected)}</span> — your People &amp;
        Opp are lit up.
      </div>
    );
  }

  const valid = WALLET_RE.test(val.trim());
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) setViewer(val.trim().toLowerCase());
      }}
      className="flex items-center gap-1.5"
    >
      <input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder="Connect your wallet, or paste one, to see who thinks like you"
        spellCheck={false}
        className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-ring"
      />
      <button
        type="submit"
        disabled={!valid}
        className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-40"
      >
        View
      </button>
    </form>
  );
}

export function ConvictionFeed({ wallet }: { wallet?: string }) {
  // The connected wallet drives the viewer automatically; ?wallet= overrides it.
  const { address } = useAccount();
  const connected = address ? address.toLowerCase() : undefined;
  const viewer = wallet ?? connected;

  const { data, isLoading } = useQuery({
    queryKey: ["conviction-feed", viewer ?? null],
    queryFn: () => listConvictionFeed({ data: viewer ? { wallet: viewer } : {} }),
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

      <ViewerControl override={wallet} connected={connected} />

      {viewer && data && !data.hasPeople && (
        <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
          No People or Opp for this wallet yet — it needs a few shared markets. Showing the market
          at large.
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
