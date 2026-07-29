/**
 * MARKET INTELLIGENCE — one container, three lenses.
 *
 *   House Read (default) — does the House know what you'll choose? The prediction
 *     is locked server-side before you act and stays hidden (visually and from
 *     assistive tech) until you make a call.
 *   Believers — who is on each side, and which of them matter to you.
 *   Defense — the strongest case for YES and for NO.
 *
 * Price is deliberately NOT a lens here: it lives in the battlefield cards, the
 * quote, and the receipt, where money decisions actually happen.
 */
import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getMarketEvidence, type Believer } from "@/lib/evidence.functions";
import {
  getHouseRead,
  finalizeBet,
  finalizeSkip,
  recordFoundation,
  type HouseReadView,
} from "@/lib/house.functions";
import { getNetwork } from "@/lib/dna.functions";
import { useEffectiveWallet } from "@/hooks/useEffectiveWallet";
import { BelieversSplit, Defense } from "@/components/MarketEvidence";
import { LiveTape } from "@/components/LiveTape";
import { useReadiness } from "@/components/Calibration";
import { expressBelief, getCalibrationQueue } from "@/lib/beliefs.functions";
import { useWalletSession } from "@/hooks/useWalletSession";
import { type Readiness } from "@/domain/beliefs";
import { BAND_COPY } from "@/domain/house";

type Mode = "house" | "stream" | "believers" | "defense";

export const houseKey = (wallet: string | undefined, marketId: number) =>
  ["house", wallet ?? null, marketId] as const;

/**
 * Finalize the round. A verified BET reveals the House pick; a SKIP closes the
 * round but keeps the pick sealed. Both refresh the locked read in the cache.
 */
export function useHouseFinalize(marketId: number, viewerWallet?: string) {
  const connected = useEffectiveWallet();
  const wallet = viewerWallet ?? connected;
  const { ensureSession } = useWalletSession();
  const qc = useQueryClient();
  const store = (data: HouseReadView | null) => {
    if (data) qc.setQueryData(houseKey(wallet, marketId), data);
  };
  const bet = useMutation({
    mutationFn: async (vars: { side: "YES" | "NO"; txHash: string }) => {
      if (!wallet) return null;
      const session = await ensureSession();
      return finalizeBet({
        data: { wallet, marketId, side: vars.side, txHash: vars.txHash, session },
      });
    },
    onSuccess: store,
  });
  const skip = useMutation({
    mutationFn: async () => {
      if (!wallet) return null;
      const session = await ensureSession();
      return finalizeSkip({ data: { wallet, marketId, session } });
    },
    onSuccess: store,
  });
  const foundation = useMutation({
    mutationFn: async (vars: { key: string; action: "YES" | "NO" | "SKIP" }) => {
      if (!wallet) return null;
      const session = await ensureSession();
      return recordFoundation({
        data: { wallet, marketId, key: vars.key, action: vars.action, session },
      });
    },
    onSuccess: store,
  });
  return {
    betReveal: (side: "YES" | "NO", txHash: string) => bet.mutate({ side, txHash }),
    skip: () => skip.mutate(),
    trainFoundation: (key: string, action: "YES" | "NO" | "SKIP") =>
      foundation.mutate({ key, action }),
    training: foundation.isPending,
    revealing: bet.isPending,
  };
}

export function MarketIntelligence({
  marketId,
  viewerWallet,
}: {
  marketId: number;
  viewerWallet?: string;
}) {
  const [mode, setMode] = useState<Mode>("house");
  const connected = useEffectiveWallet();
  const viewer = viewerWallet ?? connected;
  const actions = useHouseFinalize(marketId, viewerWallet);
  const { data: readiness } = useReadiness(viewer);

  const tablistId = useId();
  const btnRefs = useRef<Record<Mode, HTMLButtonElement | null>>({
    house: null,
    stream: null,
    believers: null,
    defense: null,
  });

  // A new market resets the lens back to the House.
  useEffect(() => setMode("house"), [marketId]);

  const { data: evidence, isLoading: loadingEvidence } = useQuery({
    queryKey: ["evidence", marketId],
    queryFn: () => getMarketEvidence({ data: { marketId } }),
    refetchInterval: 60_000,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const { data: house, isLoading: loadingHouse } = useQuery({
    queryKey: houseKey(viewer, marketId),
    queryFn: () => getHouseRead({ data: { wallet: viewer ?? null, marketId } }),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const { data: net } = useQuery({
    queryKey: ["network", viewer ?? null, "all", "relevant", ""],
    queryFn: () => getNetwork({ data: { wallet: viewer, limit: 60 } }),
    enabled: !!viewer,
    staleTime: 60_000,
  });
  const networkWallets = new Set((net?.people ?? []).map((p) => p.wallet.toLowerCase()));

  const believers = evidence?.believers ?? [];
  const defense = evidence?.defense ?? [];

  const calibrating = !!viewer && !!readiness && !readiness.calibrated;
  const meta =
    mode === "stream"
      ? ""
      : mode === "believers"
      ? `${believers.length} believer${believers.length === 1 ? "" : "s"}`
      : mode === "defense"
        ? `${defense.length} case${defense.length === 1 ? "" : "s"}`
        : calibrating
          ? `${readiness!.remaining} to unlock`
          : house?.revealed && house.confidence != null && house.predicted
            ? `Confidence ${Math.round(house.confidence * 100)}%`
            : house?.record && house.record.correct + house.record.miss > 0
              ? `House record ${house.record.correct}–${house.record.miss}`
              : "";

  const tabs: { id: Mode; label: string; short: string }[] = [
    {
      id: "house",
      label: calibrating ? `House Read · ${readiness!.remaining} left` : "House Read",
      short: calibrating ? `House · ${readiness!.remaining}` : "House",
    },
    { id: "stream", label: "Belief Stream", short: "Stream" },
    { id: "believers", label: "Believers", short: "Believers" },
    { id: "defense", label: "Defense", short: "Defense" },
  ];


  const onTabKey = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === mode);
    let next: Mode | null = null;
    if (e.key === "ArrowRight") next = tabs[(i + 1) % tabs.length].id;
    if (e.key === "ArrowLeft") next = tabs[(i - 1 + tabs.length) % tabs.length].id;
    if (next) {
      e.preventDefault();
      e.stopPropagation();
      setMode(next);
      btnRefs.current[next]?.focus();
    }
  };

  return (
    <section
      className="rounded-[14px]"
      style={{ border: "1px solid var(--border)", background: "var(--surface,transparent)" }}
      aria-label="Market intelligence"
    >
      <div className="flex items-center gap-1 px-3 pt-2.5">
        <div
          role="tablist"
          aria-label="Intelligence lens"
          id={tablistId}
          onKeyDown={onTabKey}
          className="flex gap-1"
        >
          {tabs.map((t) => {
            const on = mode === t.id;
            return (
              <button
                key={t.id}
                ref={(el) => {
                  btnRefs.current[t.id] = el;
                }}
                type="button"
                role="tab"
                id={`${tablistId}-${t.id}`}
                aria-selected={on}
                aria-controls={`${tablistId}-panel`}
                tabIndex={on ? 0 : -1}
                onClick={() => setMode(t.id)}
                className="whitespace-nowrap rounded-[9px] px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] transition-colors motion-reduce:transition-none"
                style={{
                  background: on ? "var(--surface-2,var(--border))" : "transparent",
                  color: on ? "var(--text)" : "var(--text-muted)",
                }}
              >
                <span className="sm:hidden">{t.short}</span>
                <span className="hidden sm:inline">{t.label}</span>
              </button>

            );
          })}
        </div>
        {meta && (
          <span className="num ml-auto truncate text-[11px] text-[var(--text-muted)]">{meta}</span>
        )}
      </div>

      <div
        role="tabpanel"
        id={`${tablistId}-panel`}
        aria-labelledby={`${tablistId}-${mode}`}
        tabIndex={-1}
        className="min-h-[188px] max-h-[260px] overflow-y-auto px-3 pb-3 pt-2"
      >
        {mode === "house" ? (
          viewer && readiness && !readiness.calibrated && !house?.revealed && !house?.closed ? (
            // Pre-calibration, House Read IS the calibration: answer free belief
            // questions right here and watch the House learn you. But once this
            // market's round is revealed/closed (a bet or skip), show that instead.
            <CalibrationQuiz viewer={viewer} readiness={readiness} />
          ) : (
            <div className="space-y-2">
              {house && house.record.correct + house.record.miss > 0 && (
                <MiniScoreboard rec={house.record} />
              )}
              <HouseMode
                house={house ?? null}
                loading={loadingHouse && !house}
                onFoundation={actions.trainFoundation}
                training={actions.training}
              />
            </div>
          )
        ) : mode === "stream" ? (
          <LiveTape
            marketIds={[marketId]}
            limit={30}
            showTitles={false}
            skeletonRows={4}
            emptyText="No trades on this market yet."
            onSelect={() => {}}
          />
        ) : mode === "believers" ? (
          <BelieversMode
            believers={believers}
            networkWallets={networkWallets}
            loading={loadingEvidence && !evidence}
          />
        ) : (
          <Defense opinions={defense} />
        )}
      </div>
    </section>
  );
}

function Skeleton() {
  return (
    <div className="space-y-2 py-2" aria-hidden>
      <div className="h-5 w-1/2 animate-pulse rounded bg-[var(--border)]/60 motion-reduce:animate-none" />
      <div className="h-5 animate-pulse rounded bg-[var(--border)]/40 motion-reduce:animate-none" />
      <div className="h-5 w-2/3 animate-pulse rounded bg-[var(--border)]/40 motion-reduce:animate-none" />
    </div>
  );
}

/* ── Cold start — House Read IS the calibration ──────────────────────────── */

/**
 * The magical front door: one belief question at a time, right in the House Read
 * box, framed as the House learning you. Every answer is free and moves the
 * meter; you volunteer because the payoff (it predicts YOU) is irresistible and
 * the cost is a single tap. Answers feed DNA / Network / House alike.
 */
function CalibrationQuiz({ viewer, readiness }: { viewer: string; readiness: Readiness }) {
  const qc = useQueryClient();
  const { ensureSession } = useWalletSession();
  const {
    data: queue,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["cal-queue", viewer.toLowerCase()],
    queryFn: () => getCalibrationQueue({ data: { wallet: viewer } }),
    staleTime: 60_000,
  });
  const [handled, setHandled] = useState<Set<number>>(new Set());
  const answer = useMutation({
    mutationFn: async (v: { marketId: number; side: "YES" | "NO" }) =>
      expressBelief({
        data: {
          wallet: viewer,
          marketId: v.marketId,
          side: v.side,
          source: "calibration",
          session: await ensureSession(),
        },
      }),
    onSuccess: (r) => {
      if (r) qc.setQueryData(["readiness", viewer.toLowerCase()], r);
    },
  });

  const current = (queue ?? []).find((q) => !handled.has(q.marketId));
  const mark = (id: number) => setHandled((s) => new Set(s).add(id));

  // Ran out of the local batch but not calibrated yet → pull a fresh set.
  useEffect(() => {
    if (queue && !current && !isLoading) void refetch();
  }, [queue, current, isLoading, refetch]);

  const done = readiness.count;
  const target = readiness.target;

  const choice = (label: string, side: "YES" | "NO", color: string) => (
    <button
      type="button"
      onClick={() => {
        if (!current) return;
        answer.mutate({ marketId: current.marketId, side });
        mark(current.marketId);
      }}
      className="flex-1 rounded-[10px] py-2.5 text-[13px] font-semibold transition-transform active:scale-[0.98] motion-reduce:active:scale-100"
      style={{ border: `1px solid ${color}`, color }}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Kicker>The House is learning you</Kicker>
        <span className="num text-[11px] font-semibold text-[var(--text-secondary)]">
          {done} / {target}
        </span>
      </div>
      <div className="flex gap-1" aria-hidden>
        {Array.from({ length: target }).map((_, i) => (
          <span
            key={i}
            className="h-1.5 flex-1 rounded-full transition-colors duration-300 motion-reduce:transition-none"
            style={{ background: i < done ? "var(--yes)" : "var(--border)" }}
          />
        ))}
      </div>

      {!current ? (
        <p className="py-6 text-center text-[13px] text-[var(--text-muted)]">
          Lining up your next belief…
        </p>
      ) : (
        <div className="space-y-2.5">
          {current.category && (
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
              {current.category}
            </div>
          )}
          <p className="text-[16px] font-semibold leading-snug text-[var(--text)]">
            “{current.title}”
          </p>
          <div className="flex gap-2">
            {choice("Disagree", "NO", "var(--no)")}
            <button
              type="button"
              onClick={() => current && mark(current.marketId)}
              className="rounded-[10px] px-3 py-2.5 text-[13px] font-medium text-[var(--text-muted)] transition-transform active:scale-[0.98] motion-reduce:active:scale-100"
              style={{ border: "1px solid var(--border)" }}
            >
              Pass
            </button>
            {choice("Agree", "YES", "var(--yes)")}
          </div>
          <p className="text-[11px] text-[var(--text-muted)]">
            {readiness.remaining <= 1
              ? "One more and the House can read your every move."
              : `${readiness.remaining} to unlock your network and the House. Free — no money, ever.`}
          </p>
        </div>
      )}
    </div>
  );
}

/* ── Mode 1 — House Read ─────────────────────────────────────────────────── */

function HouseMode({
  house,
  loading,
  onFoundation,
  training,
}: {
  house: HouseReadView | null;
  loading: boolean;
  onFoundation: (key: string, action: "YES" | "NO" | "SKIP") => void;
  training: boolean;
}) {
  if (loading || !house) return <Skeleton />;

  const rec = house.record;

  // Cold start — train the House on free foundation POVs before it reads markets.
  if (house.foundation) {
    return <FoundationCard f={house.foundation} onAnswer={onFoundation} busy={training} />;
  }

  // Honest no-read — shown before the round closes; it never scores.
  if (!house.revealed && !house.closed && house.noRead) {
    return (
      <div className="space-y-1.5">
        <Kicker>{house.noRead.title}</Kicker>
        <p className="text-[13px] leading-snug text-[var(--text-secondary)]">{house.noRead.body}</p>
        {house.noRead.detail.map((d) => (
          <p key={d} className="text-[12px] text-[var(--text-muted)]">
            {d}
          </p>
        ))}
      </div>
    );
  }

  // Sealed — the round closed on a SKIP, so the pick is gone. This is the hook:
  // you had a read waiting and you never paid to see it.
  if (!house.revealed && house.closed) {
    return (
      <div className="space-y-2">
        <Kicker>{house.headline?.title ?? "Sealed"}</Kicker>
        <p className="text-[15px] font-semibold leading-snug text-[var(--text)]">
          {house.headline?.line ?? "The House kept its read. You never paid to see it."}
        </p>
        <div
          className="relative grid h-[48px] place-items-center overflow-hidden rounded-[10px]"
          style={{ background: "var(--surface-2,var(--border))" }}
          aria-hidden
        >
          <span
            className="select-none text-[20px] font-semibold tracking-[0.35em] text-[var(--text-muted)]"
            style={{ filter: "blur(10px)" }}
          >
            {house.category ? "●●●" : "●●●"}
          </span>
        </div>
        <p className="text-[12px] text-[var(--text-muted)]">
          Next time, put money down to find out if the House had you.
        </p>
      </div>
    );
  }

  // Hidden state — a read is waiting, but nothing about the side is in the DOM.
  // Only a real bet unlocks it. The coarse band drives the FOMO headline.
  if (!house.revealed) {
    const copy = house.band ? BAND_COPY[house.band] : null;
    const strong = house.band === "READ" || house.band === "STRONG_READ";
    return (
      <div className="space-y-2">
        <Kicker>{copy?.headline ?? "House Read"}</Kicker>
        <p className="text-[15px] font-semibold text-[var(--text)]">
          {copy?.line ?? "The House has a read on you."}
        </p>
        <div
          className="relative grid h-[54px] place-items-center overflow-hidden rounded-[10px]"
          style={{
            background: "var(--surface-2,var(--border))",
            boxShadow: strong ? "inset 0 0 0 1.5px var(--text-muted)" : undefined,
          }}
          aria-hidden
        >
          <span
            className="select-none text-[22px] font-semibold tracking-[0.3em] text-[var(--text-muted)]"
            style={{ filter: "blur(9px)" }}
          >
            ●●●
          </span>
          <span
            className="absolute inset-0 grid place-items-center text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]"
            style={{ textShadow: "0 0 12px var(--surface-2,var(--border))" }}
          >
            Sealed
          </span>
        </div>
        <p className="text-[12px] font-semibold text-[var(--text)]">
          Back a side to reveal our pick.
        </p>
        <p className="text-[11px] text-[var(--text-muted)]">
          Skip and the read stays sealed — you’ll never know if we had you.
        </p>
        <p className="sr-only" role="note">
          The House prediction is hidden. Place a bet on YES or NO to reveal it.
        </p>
      </div>
    );
  }

  // Revealed.
  const correct = house.outcome === "correct";
  const tone = !house.predicted
    ? "var(--text-secondary)"
    : house.predicted === "YES"
      ? "var(--yes)"
      : house.predicted === "NO"
        ? "var(--no)"
        : "var(--text-secondary)";
  return (
    <div className="space-y-2" aria-live="polite">
      <Kicker>{house.headline?.title ?? "Revealed"}</Kicker>
      <p className="text-[15px] font-semibold leading-snug text-[var(--text)]">
        {house.headline?.line}
      </p>
      {house.predicted && (
        <p className="text-[12px]">
          <span style={{ color: tone }} className="font-semibold">
            House prediction: {house.predicted}
          </span>
          {house.confidence != null && (
            <span className="num text-[var(--text-muted)]">
              {" "}
              · Confidence {Math.round(house.confidence * 100)}%
            </span>
          )}
          <span className="text-[var(--text-muted)]"> · {correct ? "Called it" : "Missed"}</span>
        </p>
      )}
      {house.reasons.length > 0 && (
        <ul className="space-y-1 pt-0.5">
          {house.reasons.map((r) => (
            <li
              key={r}
              className="flex gap-2 text-[12px] leading-snug text-[var(--text-secondary)]"
            >
              <span
                className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--text-muted)]"
                aria-hidden
              />
              {r}
            </li>
          ))}
        </ul>
      )}
      <Record
        correct={rec.correct}
        miss={rec.miss}
        streak={rec.streak}
        surprise={rec.surpriseStreak}
      />
    </div>
  );
}

/** Super-small persistent tally for the House section. You win when the House misses. */
function MiniScoreboard({ rec }: { rec: HouseReadView["record"] }) {
  return (
    <div
      className="flex items-center gap-2 rounded-[8px] px-2 py-1"
      style={{ background: "var(--surface-2,var(--border))" }}
    >
      <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
        You vs House
      </span>
      <span className="num ml-auto text-[11px] font-semibold text-[var(--text)]">
        You {rec.miss} · House {rec.correct}
      </span>
      {rec.streak >= 2 && (
        <span className="num text-[10px] font-semibold text-[var(--text-secondary)]">
          🔥 {rec.streak}
        </span>
      )}
      {rec.surpriseStreak >= 2 && (
        <span className="num text-[10px] font-semibold text-[var(--text-secondary)]">
          😮 {rec.surpriseStreak}
        </span>
      )}
    </div>
  );
}

/** Cold-start training: one free belief POV with YES / NO / SKIP. Moves no money. */
function FoundationCard({
  f,
  onAnswer,
  busy,
}: {
  f: NonNullable<HouseReadView["foundation"]>;
  onAnswer: (key: string, action: "YES" | "NO" | "SKIP") => void;
  busy: boolean;
}) {
  const btn = (action: "YES" | "NO" | "SKIP", label: string, color: string) => (
    <button
      type="button"
      disabled={busy}
      onClick={() => onAnswer(f.key, action)}
      className="flex-1 rounded-[10px] py-2 text-[13px] font-semibold transition-colors disabled:opacity-40"
      style={{ border: `1px solid ${color}`, color }}
    >
      {label}
    </button>
  );
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <Kicker>Teach the House</Kicker>
        <span className="num text-[11px] text-[var(--text-muted)]">
          {f.answered} of {f.required}
        </span>
      </div>
      <p className="text-[15px] font-semibold leading-snug text-[var(--text)]">“{f.prompt}”</p>
      <p className="text-[11px] text-[var(--text-muted)]">
        Free — this trains your House Read. It moves no money.
      </p>
      <div className="flex gap-2 pt-0.5">
        {btn("YES", "Agree", "var(--yes)")}
        {btn("SKIP", "Skip", "var(--text-muted)")}
        {btn("NO", "Disagree", "var(--no)")}
      </div>
      {f.answered > 0 && (
        <p className="text-[11px] text-[var(--text-secondary)]">{f.progressLine}</p>
      )}
    </div>
  );
}

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
      {children}
    </div>
  );
}

function Record({
  correct,
  miss,
  streak = 0,
  surprise = 0,
}: {
  correct: number;
  miss: number;
  streak?: number;
  surprise?: number;
}) {
  return (
    <p className="num pt-0.5 text-[11px] text-[var(--text-muted)]">
      House record: {correct}–{miss}
      {streak >= 2 ? ` · The House has called your last ${streak} beliefs.` : ""}
      {surprise >= 2 ? ` · You have surprised the House ${surprise} times in a row.` : ""}
    </p>
  );
}

/* ── Mode 2 — Believers ──────────────────────────────────────────────────── */

function BelieversMode({
  believers,
  networkWallets,
  loading,
}: {
  believers: Believer[];
  networkWallets: Set<string>;
  loading: boolean;
}) {
  if (loading) return <Skeleton />;
  const yes = believers.filter((b) => b.side === "YES").length;
  const no = believers.filter((b) => b.side === "NO").length;
  const total = yes + no;
  const mine = believers.filter((b) => networkWallets.has(b.wallet.toLowerCase()));
  const mineYes = mine.filter((b) => b.side === "YES").length;

  let title = "The crowd hasn't formed";
  let line = `Only ${total} directional believer${total === 1 ? "" : "s"} ${total === 1 ? "has" : "have"} taken a side.`;
  if (mine.length >= 3) {
    const share = Math.round((mineYes / mine.length) * 100);
    if (share >= 65) {
      title = "Your tribe is here";
      line = `${share}% of your strongest matches back YES.`;
    } else if (share <= 35) {
      title = "You would stand apart";
      line = `${100 - share}% of your closest matches back NO.`;
    } else {
      title = "Your tribe is divided";
      line = `People most like you are nearly even — ${share} / ${100 - share}.`;
    }
  } else if (mine.length === 0 && total >= 12) {
    title = "No reliable relationship signal yet";
    line = "Answer more beliefs to discover who consistently thinks like you.";
  } else if (total >= 12) {
    title = "The crowd is forming";
    line = `${yes} back YES, ${no} back NO — people, not dollars.`;
  }

  return (
    <div className="space-y-2">
      <Kicker>{title}</Kicker>
      <p className="text-[13px] leading-snug text-[var(--text-secondary)]">{line}</p>
      <BelieversSplit believers={believers} networkWallets={networkWallets} />
    </div>
  );
}
