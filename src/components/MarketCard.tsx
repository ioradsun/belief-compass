/**
 * MarketCard — one market, alive.
 *
 * Replaces the old table row: YES and NO are shown as two independent books,
 * and each card runs its OWN little feed — the market's most recent real trade
 * events cycle through a single pulse line, one at a time, long enough to read
 * (~4.5s) and staggered per card so the grid breathes instead of blinking in
 * unison. Click the card to freeze the rotation and see the whole strip.
 * Prices/volumes flash when the polled data actually changes.
 */
import { useEffect, useRef, useState } from "react";
import type { MatchPerson, Pulse } from "@/lib/markets.functions";
import { hueFor, initialsFor } from "@/lib/wallet-identity";
import { relationshipTone } from "@/lib/dna-labels";
import { marketVitals, marketBadge, type PulseLevel } from "@/lib/market-vitals";
import { StoryStrip } from "@/components/StoryStrip";
import { PersonAvatar } from "@/components/PersonAvatar";

import type { MarketStory } from "@/domain/story";
import { formatMoney, type DisplayUnit } from "@/domain/money";
import { marketTitle } from "@/domain/market-title";

// Pulse bar colour by aliveness. Amber for a living market (kept off the
// YES-blue / NO-amber axis so it never reads as a side), fading to muted as
// the market goes quiet. Green stays reserved for P&L, never for "alive".
const PULSE_COLOR: Record<PulseLevel, string> = {
  alive: "#f59e0b",
  active: "#f59e0b",
  quiet: "#9ca3af",
  flatline: "#9ca3af",
};

const ROTATE_MS = 4500;

export type MarketRow = {
  onchain_id: number;
  yes_price_usd: number | null;
  no_price_usd: number | null;
  people_yes_pct: number | null;
  believers_yes: number | null;
  believers_no: number | null;
  /** Per-side gross new believers in the last 24h (position_became_directional). */
  new_believers_yes_24h?: number | null;
  new_believers_no_24h?: number | null;
  believers_mixed: number | null;
  volume_total_usd: number | null;
  yes_capital_usd?: number | null;
  no_capital_usd?: number | null;
  chg_window_yes?: number | null;
  chg_window_no?: number | null;
  yes_volume_usd?: number | null;
  no_volume_usd?: number | null;
  yes_trade_count?: number | null;
  no_trade_count?: number | null;
  window_volume_usd?: number | null;
  tribe_side?: "YES" | "NO" | null;
  opp_side?: "YES" | "NO" | null;
  story?: MarketStory | null;
  markets?: {
    title?: string;
    category?: string;
    /** POV page slug — powers the "Trade on POV" deep link. */
    pov_slug?: string | null;
  } | null;
};

function fmtUsd(n: number | null | undefined) {
  if (n == null) return "—";
  const v = Number(n);
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}k`;
  return `$${v.toFixed(2)}`;
}
function fmtShare(n: number | null | undefined) {
  if (n == null) return "—";
  const v = Number(n);
  return v >= 1 ? `$${v.toFixed(2)}` : `${Math.round(v * 100)}¢`;
}
function shortWallet(w: string) {
  return w && w.length > 10 ? `${w.slice(0, 6)}…${w.slice(-4)}` : w || "someone";
}
function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86_400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86_400)}d`;
}
function personName(p: Pulse) {
  return p.name || shortWallet(p.wallet);
}
export function pulseLine(p: Pulse, ethUsd: number, unit: DisplayUnit = "USD") {
  // Trade size is ETH-native; show it in the viewer's chosen unit. When USD is
  // wanted but no rate is known, fall back to the raw ETH so a size still shows.
  const size =
    unit === "USD" && !(ethUsd > 0)
      ? `\u039E${p.eth.toFixed(3)}`
      : formatMoney(p.eth, { from: "ETH", to: unit, ethUsd });
  const verb = p.type === "reduced" ? "cut" : "backed";
  return `${personName(p)} ${verb} ${p.side} · ${size}`;
}

/** Small face for a trader: real POV picture, else initials. Opens the profile. */
export function Face({ p, size = 18 }: { p: Pulse; size?: number }) {
  return <PersonAvatar wallet={p.wallet} name={personName(p)} avatarUrl={p.pfpUrl} size={size} />;
}

/** Flash helper: returns true for ~1s after `value` changes. */
function useFlash(value: number | null | undefined) {
  const prev = useRef(value);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (prev.current !== value && prev.current != null && value != null) {
      setOn(true);
      const t = setTimeout(() => setOn(false), 1000);
      prev.current = value;
      return () => clearTimeout(t);
    }
    prev.current = value;
  }, [value]);
  return on;
}

function SideBlock({
  side,
  price,
  chg,
  backers,
  sharePct,
  capital,
  capShare,
  volume,
  trades,
  winLabel,
  badge,
}: {
  side: "YES" | "NO";
  price: number | null;
  chg: number | null;
  backers: number;
  sharePct: number;
  capital: number | null;
  capShare: number | null;
  volume: number | null;
  trades: number;
  winLabel: string;
  badge: "Tribe" | "Opp" | null;
}) {
  const isYes = side === "YES";
  const up = chg != null && chg >= 0;
  const flash = useFlash(price);
  return (
    <div
      className={`rounded-lg border p-3 transition-colors duration-500 ${
        isYes ? "border-[var(--yes)]/25 bg-[var(--yes)]/5" : "border-[var(--no)]/25 bg-[var(--no)]/5"
      } ${flash ? (isYes ? "ring-2 ring-[var(--yes)]/50" : "ring-2 ring-[var(--no)]/50") : ""}`}
    >
      <div className="flex items-center justify-between">
        <span
          className={`text-[10px] font-semibold uppercase tracking-wider ${
            isYes ? "text-[var(--yes)]" : "text-[var(--no)]"
          }`}
        >
          {side}
        </span>
        {badge &&
          (() => {
            // Use the shared relationship token (aligned → YES color, opposed → NO
            // color) so this badge matches the Network panel — one visual language.
            const t = relationshipTone(badge === "Tribe" ? "tribe" : "opp");
            return (
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                style={{ color: t.fg, background: t.bg }}
              >
                {badge}
              </span>
            );
          })()}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-lg font-semibold tabular-nums">{fmtShare(price)}</span>
        <span
          className="text-xs font-medium tabular-nums"
          style={{ color: chg == null ? undefined : up ? "#059669" : "#dc2626" }}
        >
          {chg == null
            ? "—"
            : `${up ? "▲+" : "▼−"}${Math.abs(chg) < 1 ? Math.abs(chg).toFixed(1) : Math.round(Math.abs(chg))}%`}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {winLabel}
        </span>
      </div>
      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full transition-all duration-700 ${isYes ? "bg-[var(--yes)]" : "bg-[var(--no)]"}`}
          style={{ width: `${Math.max(2, sharePct)}%` }}
        />
      </div>
      <dl className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
        <div className="flex justify-between">
          <dt>Backers</dt>
          <dd className="tabular-nums text-foreground">{backers}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Invested</dt>
          <dd className="tabular-nums text-foreground">
            {capital == null ? "—" : fmtUsd(capital)}
            {capShare != null && capital != null ? (
              <span className="text-muted-foreground"> · {Math.round(capShare)}%</span>
            ) : null}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt>Vol {winLabel}</dt>
          <dd className="tabular-nums text-foreground">
            {volume == null || volume === 0 ? "—" : fmtUsd(volume)}
            <span className="text-muted-foreground"> · {trades}t</span>
          </dd>
        </div>
      </dl>
    </div>
  );
}

/** Header strip: your tribesman / opp holds a position in this market. */
function MatchStrip({
  person,
  kind,
  side,
}: {
  person: MatchPerson;
  kind: "Tribe" | "Opp";
  side: "YES" | "NO";
}) {
  const tribe = kind === "Tribe";
  const name = person.name || shortWallet(person.wallet);
  return (
    <div
      className={`flex items-center gap-2 border-b border-border px-4 py-2 text-[11px] ${
        tribe ? "bg-violet-500/10" : "bg-red-500/10"
      }`}
    >
      <PersonAvatar wallet={person.wallet} name={name} avatarUrl={person.pfpUrl} size={16} />

      <span
        className={`shrink-0 font-semibold uppercase tracking-wide ${
          tribe ? "text-violet-600" : "text-[var(--no)]"
        }`}
      >
        {tribe ? "Your tribe" : "Your opp"}
      </span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        <span className="text-foreground">{name}</span> is on{" "}
        <span className={side === "YES" ? "text-[var(--yes)]" : "text-[var(--no)]"}>{side}</span>
      </span>
      <span className="shrink-0 tabular-nums text-muted-foreground">{person.score}%</span>
    </div>
  );
}

export function MarketCard({
  row,
  pulses,
  ethUsd,
  winLabel,
  stagger,
  tribe,
  opp,
  reason,
}: {
  row: MarketRow;
  pulses: Pulse[];
  ethUsd: number;
  winLabel: string;
  stagger: number;
  tribe?: MatchPerson | null;
  opp?: MatchPerson | null;
  /** Why this market surfaced for the active feed lens (Hot/Conviction/…). */
  reason?: string;
}) {
  const [i, setI] = useState(0);
  const [open, setOpen] = useState(false);

  // Each card rotates its own pulses; the stagger keeps the grid from ticking
  // in lockstep. Rotation pauses while the strip is expanded.
  useEffect(() => {
    if (open || pulses.length <= 1) return;
    let interval: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      setI((n) => (n + 1) % pulses.length);
      interval = setInterval(() => setI((n) => (n + 1) % pulses.length), ROTATE_MS);
    }, stagger);
    return () => {
      clearTimeout(start);
      if (interval) clearInterval(interval);
    };
  }, [open, pulses.length, stagger]);

  const yesB = Number(row.believers_yes ?? 0);
  const noB = Number(row.believers_no ?? 0);
  const totalB = yesB + noB;
  const yesCap = row.yes_capital_usd == null ? null : Number(row.yes_capital_usd);
  const noCap = row.no_capital_usd == null ? null : Number(row.no_capital_usd);
  const capTotal = (yesCap ?? 0) + (noCap ?? 0);
  const current = pulses[i % Math.max(1, pulses.length)];
  const volFlash = useFlash(row.window_volume_usd ?? null);

  // Vital signs — is this market alive? Turnover is cumulative (all money ever
  // traded vs what's still held), so Pulse reads volume_total_usd. Battle split
  // is money-weighted (capital on each side).
  const vitalsInput = {
    volumeUsd: Number(row.volume_total_usd ?? 0),
    yesCapitalUsd: yesCap ?? 0,
    noCapitalUsd: noCap ?? 0,
    believers: totalB,
    yesPct:
      capTotal > 0 && yesCap != null
        ? (yesCap / capTotal) * 100
        : row.people_yes_pct == null
          ? null
          : Number(row.people_yes_pct),
  };
  const vitals = marketVitals(vitalsInput);
  const badge = marketBadge(vitalsInput);

  return (
    <article className="flex flex-col rounded-xl border border-border bg-card/40 transition-shadow hover:shadow-md">
      <header className="border-b border-border px-4 py-3">
        <div className="text-sm font-medium leading-snug">
          {marketTitle(row.markets?.title, row.onchain_id)}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
          {row.markets?.category && <span>{row.markets.category}</span>}
          <span>·</span>
          <span>cap {capTotal > 0 ? fmtUsd(capTotal) : "—"}</span>
          <span>·</span>
          <span className={volFlash ? "text-foreground" : undefined}>
            {winLabel} vol {row.window_volume_usd ? fmtUsd(row.window_volume_usd) : "—"}
          </span>
        </div>
      </header>

      {/* The story: what just happened → momentum → your people (server-composed). */}
      {row.story && (row.story.beats.length > 0 || row.story.crowd) && (
        <div className="border-b border-border px-4 py-2.5">
          <StoryStrip story={row.story} />
        </div>
      )}

      {/* Why this market surfaced for the active lens — intent, not a formula. */}
      {reason && (
        <div className="border-b border-border bg-muted/30 px-4 py-2 text-[11px] leading-snug text-foreground">
          {reason}
        </div>
      )}

      {/* Vital sign: Pulse — is this market alive? A health bar + one-line story,
          no math for the reader. Badge (Battlefield / Ghost Town / …) when earned. */}
      <div className="border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span aria-hidden>{vitals.pulse.emoji}</span>
          <span className="text-xs font-semibold">Pulse: {vitals.pulse.label}</span>
          {badge && (
            <span
              className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600"
              title={badge.note}
            >
              {badge.emoji} {badge.label}
            </span>
          )}
          <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
            {vitals.pulse.healthPct}%
          </span>
        </div>
        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full transition-all duration-700"
            style={{
              width: `${Math.max(2, vitals.pulse.healthPct)}%`,
              backgroundColor: PULSE_COLOR[vitals.pulse.level],
            }}
          />
        </div>
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">{vitals.pulse.line}</p>
      </div>

      <div className="grid grid-cols-2 gap-2 p-3">
        <SideBlock
          side="YES"
          price={row.yes_price_usd}
          chg={row.chg_window_yes == null ? null : Number(row.chg_window_yes)}
          backers={yesB}
          sharePct={totalB > 0 ? (yesB / totalB) * 100 : 0}
          capital={yesCap}
          capShare={capTotal > 0 && yesCap != null ? (yesCap / capTotal) * 100 : null}
          volume={row.yes_volume_usd ?? null}
          trades={Number(row.yes_trade_count ?? 0)}
          winLabel={winLabel}
          badge={row.tribe_side === "YES" ? "Tribe" : row.opp_side === "YES" ? "Opp" : null}
        />
        <SideBlock
          side="NO"
          price={row.no_price_usd}
          chg={row.chg_window_no == null ? null : Number(row.chg_window_no)}
          backers={noB}
          sharePct={totalB > 0 ? (noB / totalB) * 100 : 0}
          capital={noCap}
          capShare={capTotal > 0 && noCap != null ? (noCap / capTotal) * 100 : null}
          volume={row.no_volume_usd ?? null}
          trades={Number(row.no_trade_count ?? 0)}
          winLabel={winLabel}
          badge={row.tribe_side === "NO" ? "Tribe" : row.opp_side === "NO" ? "Opp" : null}
        />
      </div>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={pulses.length === 0}
        className="flex items-center gap-2 border-t border-border px-4 py-2.5 text-left text-xs disabled:cursor-default"
        aria-expanded={open}
      >
        <span
          className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
            pulses.length ? "animate-pulse bg-[var(--yes)]" : "bg-muted-foreground/40"
          }`}
        />
        {pulses.length === 0 ? (
          <span className="text-muted-foreground">no trades indexed yet</span>
        ) : (
          <>
            <span
              key={current?.key}
              className="flex min-w-0 flex-1 items-center gap-1.5 animate-in fade-in slide-in-from-bottom-1 duration-500"
            >
              {current && <Face p={current} />}
              <span className="min-w-0 flex-1 truncate">
                <span className={current?.side === "YES" ? "text-[var(--yes)]" : "text-[var(--no)]"}>
                  {pulseLine(current!, ethUsd)}
                </span>
                <span className="text-muted-foreground"> · {ago(current!.at)} ago</span>
              </span>
            </span>
            <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
              {open ? "close" : `${pulses.length} events`}
            </span>
          </>
        )}
      </button>

      {open && pulses.length > 0 && (
        <ul className="border-t border-border px-4 py-2 text-xs">
          {pulses.map((p) => (
            <li key={p.key} className="flex items-center gap-2 py-1">
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  p.side === "YES" ? "bg-[var(--yes)]" : "bg-[var(--no)]"
                }`}
              />
              <Face p={p} size={16} />
              <span className="min-w-0 flex-1 truncate">{pulseLine(p, ethUsd)}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground">{ago(p.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
