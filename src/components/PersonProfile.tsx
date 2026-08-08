/**
 * PROFILE — three acts, and nothing that has not earned its existence.
 *
 * THE FAILURE V2 HAD. It narrated the database. A person with one conviction
 * was described six ways: "their story is still taking shape", "taken a side in
 * 1 market", Start Here (that market), Convictions That Define Them (that
 * market), Their Conviction Map (that market, under a taxonomy heading), and
 * "1 active conviction" in the footer. Eleven sections designed for the maximum
 * amount of data, shown emaciated to almost everybody.
 *
 * V3 asks what a human actually wants to know, in order, and each section is
 * the only place its question is answered:
 *
 *   I    YOU + THEM     what are we?              null when you have never met
 *   II   NEXT           what could we do now?     null when there is nothing
 *   III  THEIR CONVICTIONS   what do they believe?
 *
 * Everything else is subordinate to those and appears only when the
 * relationship is rich enough to carry it: the shared-market receipts, the call
 * history, the people around them.
 *
 * THIN RELATIONSHIP → THIN PROFILE. No section is padded with a fallback. The
 * page gets SHORTER when there is less to say, and earns complexity as the
 * person accumulates history — which is why the conviction list is flat until
 * there is enough of it for a taxonomy to be navigation rather than ceremony.
 *
 * "START HERE" WAS WRONG AND IS GONE. It recommended their biggest position
 * whether or not you had already taken a side there, so it meant "their largest
 * holding" rather than "the best place to meet this person". Act II only offers
 * markets you have never answered, and an outstanding call from them outranks
 * any position — someone asking you directly is the one thing here with a
 * deadline.
 *
 * FOLLOW IS GONE. Showing up is the relationship model on this platform;
 * a subscribe button inherited from another social network sat next to
 * Conviction Match and shared history saying something entirely different.
 *
 * All judgement lives in @/domain/profile-story, including the refusals.
 */
import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { getPersonProfile, listPersonConvictions } from "@/lib/dna.functions";
import { ago, RELATIONSHIP_TEXT, relationshipTone } from "@/lib/dna-labels";
import { getCallsWithPerson, getChallenges } from "@/lib/challenge.functions";
import { historyRows } from "@/domain/dependability";
import { hueFor, initialsFor } from "@/lib/wallet-identity";
import { categoryToDomain } from "@/domain/categories";
import {
  definingConvictions,
  introduction,
  convictionMap,
  sharedCuriosity,
  allConvictions,
  tenureText,
  type PersonPosition,
  type SharedRow,
  type ConvictionTheme,
} from "@/domain/person-profile";
import { rankStartCandidates, type StartCandidate } from "@/domain/profile-start-here";
import { peopleAround, type ConnectedPerson } from "@/domain/person-network";
import {
  usAct,
  nextAct,
  themAct,
  DENSITY,
  type NextAct,
  type ThemPosition,
} from "@/domain/profile-story";

export function PersonProfile({
  wallet,
  viewer,
  onSelectMarket,
  onSelectPerson,
}: {
  wallet: string;
  viewer?: string;
  onSelectMarket: (id: number) => void;
  /** Person → conviction → market → another person. Absent = no onward path. */
  onSelectPerson?: (wallet: string) => void;
}) {
  const [allShared, setAllShared] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["person", wallet.toLowerCase(), viewer ?? null],
    queryFn: () => getPersonProfile({ data: { wallet, viewer } }),
    staleTime: 60_000,
  });

  /** Both directions of the call record — read separately so the page paints first. */
  const { data: pair } = useQuery({
    queryKey: ["calls-with", viewer ?? null, wallet.toLowerCase()],
    queryFn: () => getCallsWithPerson({ data: { viewer: viewer ?? null, person: wallet } }),
    enabled: !!viewer,
    staleTime: 60_000,
  });

  /**
   * The viewer's OPEN calls, filtered to this person. An unanswered call from
   * the person you are looking at is the strongest thing this page can offer,
   * and it is the only signal Act II ranks above a position.
   */
  const { data: challenges } = useQuery({
    queryKey: ["challenges", viewer ?? null],
    queryFn: () => getChallenges({ data: { wallet: viewer ?? null } }),
    enabled: !!viewer,
    staleTime: 60_000,
  });

  const all = useInfiniteQuery({
    queryKey: ["person-convictions", wallet.toLowerCase()],
    enabled: allOpen,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      listPersonConvictions({ data: { wallet, offset: pageParam as number, limit: ALL_PAGE } }),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.positions.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
  });

  if (isLoading || !data) {
    return <div className="h-40 animate-pulse rounded-xl bg-[var(--surface-2)]" />;
  }

  const first = data.displayName.split(" ")[0] || data.displayName;
  const intro = introduction(data.positions, { marketsParticipated: data.positions.length });

  /* ── ACT I ─────────────────────────────────────────────────────────────── */
  const us = data.hasViewer
    ? usAct({
        shared: data.sharedBeliefs,
        together: data.together,
        apart: data.apart,
        alignedTopics: data.alignedDomains.map((d) => d.domain),
      })
    : null;

  /* ── ACT II ────────────────────────────────────────────────────────────── */
  // Only markets the viewer has never answered are eligible, which is the whole
  // correction: an invitation to a market you already took a side in is not an
  // invitation. Ranking then picks the one most worth opening.
  const viewerHeld = new Set(data.viewerMarketIds);
  const unexplored = candidatesFrom(data).filter((c) => !viewerHeld.has(c.marketId));
  const joinPick = data.hasViewer
    ? (rankStartCandidates(unexplored, {
        personName: data.displayName,
        hasViewer: data.hasViewer,
      })[0] ?? null)
    : null;
  const joinSide = joinPick
    ? (data.positions.find((p) => p.marketId === joinPick.marketId)?.side ?? null)
    : null;
  const callFromThem =
    challenges?.find((c) => c.caller.wallet.toLowerCase() === wallet.toLowerCase()) ?? null;
  const next = nextAct({
    name: first,
    callFromThem: callFromThem
      ? { marketId: callFromThem.marketId, title: callFromThem.title, side: callFromThem.callerSide }
      : null,
    joinCandidate:
      joinPick && joinSide
        ? { marketId: joinPick.marketId, title: joinPick.title, side: joinSide }
        : null,
  });

  /* ── ACT III ───────────────────────────────────────────────────────────── */
  const them = themAct(data.positions as ThemPosition[], {
    total: data.positionsTotal,
    medianDays: data.personMedianDays,
    excludeMarketId: next?.marketId ?? null,
  });
  const themes = them.grouped ? convictionMap(data.positions) : [];
  const flat = them.rows.slice(0, DENSITY.preview);
  const every = allConvictions(data.positions);
  const everyLoaded = allConvictions(
    all.data ? all.data.pages.flatMap((p) => p.positions) : data.positions,
  );

  /* ── Subordinate, and only when the relationship carries them ──────────── */
  const agreed = data.sharedBoth.map((m) => ({
    marketId: Number(m.marketId),
    title: m.title,
    viewerSide: m.viewerSide,
    personSide: m.personSide,
  }));
  const opposed = data.opposing.map((m) => ({
    marketId: Number(m.marketId),
    title: m.title,
    viewerSide: m.viewerSide,
    personSide: m.personSide,
  }));
  const sharedTotal = agreed.length + opposed.length;
  // Two or fewer shared markets are already fully described by "1 of 1
  // together" — listing them would be the same fact wearing a list.
  const showShared = sharedTotal >= MIN_SHARED_LIST;
  const shared = showShared
    ? sharedCuriosity(agreed, opposed, allShared ? sharedTotal : SHARED_PREVIEW)
    : [];
  const history = historyRows(pair?.history ?? [], data.displayName);
  const around = peopleAround(data.around);

  return (
    <div className="space-y-7">
      {/* ── I · YOU + THEM ───────────────────────────────────────────────────
          The relationship before the person, because nobody becomes curious
          about a stranger through statistics — they become curious the moment
          they recognise a point of contact.

          THE COUNT IS NOT SMALLER THAN THE PERCENTAGE while the record is thin.
          A 100% built on one market is arithmetic; "1 of 1 together" is the
          fact. Making the percentage the loudest thing on a one-market record
          would be the unfalsifiable compatibility score this page replaced. */}
      {us && (
        <section>
          <SectionTitle>
            You + {first.toUpperCase() === first ? first : first.toUpperCase()}
          </SectionTitle>
          <div className="flex items-baseline gap-2.5">
            <span
              className={`num font-semibold text-[var(--text)] ${us.thin ? "text-[20px]" : "text-[28px]"}`}
            >
              {us.matchPct != null ? `${us.matchPct}%` : "—"}
            </span>
            <span
              className={`num text-[var(--text-secondary)] ${us.thin ? "text-[16px] font-semibold" : "text-[13px]"}`}
            >
              {us.evidence}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] font-medium tracking-wide text-[var(--text-muted)] uppercase">
            Conviction Match
          </p>
          {us.sentence && (
            <p className="mt-2 text-[14px] leading-relaxed text-[var(--text)]">{us.sentence}</p>
          )}
          {data.relationship !== "none" && (
            <p
              className="mt-1.5 text-[10px] font-semibold tracking-wide uppercase"
              style={{ color: relationshipTone(data.relationship).fg }}
            >
              {RELATIONSHIP_TEXT[data.relationship]}
            </p>
          )}
        </section>
      )}

      {/* ── WHO ──────────────────────────────────────────────────────────────
          A name, a face, one line. When there is no pattern to claim yet it
          says exactly that, once — the market count lives in Act III. */}
      <header className="flex items-start gap-3">
        {data.avatarUrl ? (
          <img
            src={data.avatarUrl}
            alt=""
            className="h-12 w-12 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span
            className="grid h-12 w-12 shrink-0 place-items-center rounded-full text-sm font-semibold text-white"
            style={{ background: `hsl(${hueFor(data.wallet)} 45% 45%)` }}
            aria-hidden
          >
            {initialsFor(data.displayName)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold text-[var(--text)]">{data.displayName}</h1>
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-secondary)]">
            {/* Provisional profiles get ONE sentence. The second was "they have
                taken a side in 1 market", which Act III already states. */}
            {(intro.provisional ? intro.lines.slice(0, 1) : intro.lines).join(" ")}
          </p>
        </div>
      </header>

      {/* ── II · NEXT ────────────────────────────────────────────────────────
          One thing to do together, or nothing at all. Never a filler row. */}
      {next && <NextCard next={next} name={first} onSelect={onSelectMarket} />}

      {/* ── III · THEIR CONVICTIONS ──────────────────────────────────────────
          One section where three used to be. Grouped by theme only once there
          are enough positions for the grouping to help someone navigate. */}
      {(them.rows.length > 0 || every.length > 0) && (
        <section>
          <SectionTitle>Their convictions</SectionTitle>
          {them.grouped ? (
            <div className="space-y-4">
              {themes.map((t) => (
                <ThemeGroup key={t.theme} theme={t} onSelect={onSelectMarket} />
              ))}
            </div>
          ) : (
            <ul className="space-y-0.5">
              {flat.map((p) => (
                <li key={p.marketId}>
                  <ConvictionRow p={p as PersonPosition} onSelect={onSelectMarket} />
                </li>
              ))}
            </ul>
          )}
          <p className="num mt-2 px-2 text-[11px] text-[var(--text-muted)]">{them.summary}</p>
          {/* The unabridged list — what makes everything above trustworthy. It
              only offers itself when there is more than the section shows. */}
          {data.positionsTotal > (them.grouped ? themes.length : flat.length) && (
            <>
              <MoreButton onClick={() => setAllOpen((v) => !v)}>
                {allOpen ? "Hide all convictions" : `Show all ${data.positionsTotal}`}
              </MoreButton>
              {allOpen && (
                <>
                  <ul className="mt-2 space-y-0.5">
                    {everyLoaded.map((p) => (
                      <li key={p.marketId}>
                        <ConvictionRow p={p} onSelect={onSelectMarket} />
                      </li>
                    ))}
                  </ul>
                  {all.hasNextPage && (
                    <MoreButton onClick={() => void all.fetchNextPage()}>
                      {all.isFetchingNextPage
                        ? "Loading…"
                        : `Show more — ${everyLoaded.length} of ${data.positionsTotal}`}
                    </MoreButton>
                  )}
                </>
              )}
            </>
          )}
        </section>
      )}

      {/* ── Receipts. Only when they say something Act I did not. ──────────── */}
      {showShared && shared.length > 0 && (
        <section>
          <SectionTitle>Where you have met</SectionTitle>
          <ul className="space-y-0.5">
            {shared.map((s) => (
              <li key={s.marketId}>
                <SharedMarketRow s={s} onSelect={onSelectMarket} />
              </li>
            ))}
          </ul>
          {sharedTotal > shared.length && (
            <MoreButton onClick={() => setAllShared(true)}>
              Show all {sharedTotal} shared markets
            </MoreButton>
          )}
        </section>
      )}

      {/* Who showed up for whom, both directions. */}
      {history.length > 0 && (
        <section>
          <SectionTitle>Your history</SectionTitle>
          <ul className="space-y-1.5">
            {history.map((h) => (
              <li key={`${h.direction}-${h.marketId}`}>
                <button
                  type="button"
                  onClick={() => onSelectMarket(h.marketId)}
                  className="w-full rounded-[10px] px-2 py-2 text-left transition-colors hover:bg-[var(--surface)]"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span
                      className="shrink-0 text-[10px] font-semibold tracking-wide uppercase"
                      style={{
                        color:
                          h.direction === "waiting_on_them"
                            ? "var(--text-muted)"
                            : "var(--text-secondary)",
                      }}
                    >
                      {h.label}
                    </span>
                    <span className="num shrink-0 text-[10px] text-[var(--text-muted)]">
                      {ago(new Date(h.atMs).toISOString())}
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-[var(--text)]">
                    {h.title}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Person → market → person, once there is a room around them to describe. */}
      {around.length >= MIN_AROUND && onSelectPerson && (
        <section>
          <SectionTitle>People around their convictions</SectionTitle>
          <ul className="space-y-0.5">
            {around.map((p) => (
              <li key={p.wallet}>
                <PersonRow p={p} onSelect={onSelectPerson} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * Everything the ranking engine needs, from data the page already has. No extra
 * query: the person's positions carry the market facts and the DNA domains say
 * which topics the two of them usually land the same way on.
 */
function candidatesFrom(data: {
  positions: PersonPosition[];
  alignedDomains: { domain: string }[];
}): StartCandidate[] {
  const alignedTopics = new Set(data.alignedDomains.map((d) => d.domain));
  const defining = definingConvictions(data.positions);
  const largestId = defining.find((d) => d.kind === "largest")?.marketId ?? null;
  const longestId = defining.find((d) => d.kind === "longest")?.marketId ?? null;

  return data.positions.map((p) => {
    const against =
      p.crowdYesPct == null
        ? null
        : Math.round(
            Math.max(0, Math.min(100, p.side === "YES" ? 100 - p.crowdYesPct : p.crowdYesPct)),
          );
    const domain = categoryToDomain(p.category);
    return {
      marketId: p.marketId,
      title: p.title,
      personSide: p.side,
      valueUsd: p.valueUsd,
      daysHeld: p.daysHeld,
      tenureIsFloor: p.tenureIsFloor,
      againstPct: against,
      participants: p.participants,
      // Every candidate here is one the viewer has never answered — that is the
      // filter applied before ranking, so there is no viewer side to carry.
      viewerSide: null,
      category: p.category,
      topicUsuallyAligned: domain != null && alignedTopics.has(domain),
      isLargest: p.marketId === largestId,
      isLongest: p.marketId === longestId,
    };
  });
}

/** Shared markets shown before the reader asks for the rest. */
const SHARED_PREVIEW = 6;
/** Below this, the shared list only repeats what Act I already said. */
const MIN_SHARED_LIST = 3;
/** Below this there is no room around them worth naming. */
const MIN_AROUND = 3;
/** Convictions per page of the unabridged list. */
const ALL_PAGE = 100;

/** The expansion affordance. Quiet, but a real control rather than a caption. */
function MoreButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-1.5 px-2 text-[11px] font-medium text-[var(--text-secondary)] underline decoration-dotted underline-offset-2 transition-colors hover:text-[var(--text)]"
    >
      {children}
    </button>
  );
}

/**
 * ACT II. The only element on the page allowed to be loud, because a page with
 * two primary actions has none — and a call outranks an invitation.
 */
function NextCard({
  next,
  name,
  onSelect,
}: {
  next: NextAct;
  name: string;
  onSelect: (id: number) => void;
}) {
  const called = next.kind === "call";
  return (
    <section>
      <SectionTitle>{called ? `${name} called you` : "Join them"}</SectionTitle>
      <button
        type="button"
        onClick={() => onSelect(next.marketId)}
        className="block w-full rounded-[14px] px-4 py-3.5 text-left transition-colors hover:bg-[var(--surface-2)]"
        style={{
          background: "var(--surface)",
          border: `1px solid ${called ? "var(--notice, var(--text-secondary))" : "var(--text-secondary)"}`,
        }}
      >
        <span className="block text-[15px] leading-snug font-semibold text-[var(--text)]">
          {next.title}
        </span>
        <span className="mt-1.5 block text-[12px] text-[var(--text-secondary)]">
          {next.side ? (
            <>
              {next.detail.replace(` ${next.side}`, "")}{" "}
              <span style={{ color: next.side === "YES" ? "var(--yes)" : "var(--no)" }}>
                {next.side}
              </span>
            </>
          ) : (
            next.detail
          )}
        </span>
        <span className="mt-2 block text-[12px] font-medium text-[var(--text)]">{next.cta}</span>
      </button>
    </section>
  );
}

/** One row: side, question, how long they have held it. */
function ConvictionRow({ p, onSelect }: { p: PersonPosition; onSelect: (id: number) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(p.marketId)}
      className="flex w-full items-baseline gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--surface-2)]"
    >
      <span
        className="w-[26px] shrink-0 text-[10px] font-semibold"
        style={{ color: p.side === "YES" ? "var(--yes)" : "var(--no)" }}
      >
        {p.side}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text)]">{p.title}</span>
      <span className="num shrink-0 text-[11px] text-[var(--text-muted)]">
        {tenureText(p.daysHeld, p.tenureIsFloor)}
      </span>
    </button>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 text-[11px] font-semibold tracking-wide text-[var(--text-muted)] uppercase">
      {children}
    </h2>
  );
}

/** One theme of the map: a quiet heading, then the markets inside it. */
function ThemeGroup({
  theme,
  onSelect,
}: {
  theme: ConvictionTheme;
  onSelect: (id: number) => void;
}) {
  const hidden = theme.total - theme.positions.length;
  return (
    <div>
      <h3 className="mb-1 flex items-baseline gap-1.5 text-[12px] font-medium text-[var(--text)] capitalize">
        {theme.theme}
        <span className="num text-[11px] font-normal text-[var(--text-muted)]">{theme.total}</span>
      </h3>
      <ul className="space-y-0.5">
        {theme.positions.map((p) => (
          <li key={p.marketId}>
            <button
              type="button"
              onClick={() => onSelect(p.marketId)}
              className="flex w-full items-baseline gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--surface-2)]"
            >
              <span
                className="w-[26px] shrink-0 text-[10px] font-semibold"
                style={{ color: p.side === "YES" ? "var(--yes)" : "var(--no)" }}
              >
                {p.side}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text)]">
                {p.title}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <p className="mt-0.5 px-2 text-[11px] text-[var(--text-muted)]">
          and {hidden} more in {theme.theme.toLowerCase()}
        </p>
      )}
    </div>
  );
}

/** One market you both took a side in, with both sides shown. */
function SharedMarketRow({ s, onSelect }: { s: SharedRow; onSelect: (id: number) => void }) {
  const tone = (v: "YES" | "NO") => (v === "YES" ? "var(--yes)" : "var(--no)");
  return (
    <button
      type="button"
      onClick={() => onSelect(s.marketId)}
      className="block w-full rounded-lg px-2 py-2 text-left transition-colors hover:bg-[var(--surface-2)]"
    >
      <span className="block text-[13px] leading-snug text-[var(--text)]">{s.title}</span>
      <span className="mt-0.5 flex items-center gap-3 text-[11px] text-[var(--text-muted)]">
        <span>
          You <span style={{ color: tone(s.viewerSide) }}>{s.viewerSide}</span>
        </span>
        <span>
          Them <span style={{ color: tone(s.personSide) }}>{s.personSide}</span>
        </span>
        {!s.agree && <span className="text-[var(--text-secondary)]">— you differ here</span>}
      </span>
    </button>
  );
}

/** One connected person. The pattern colours the row and nothing else. */
function PersonRow({ p, onSelect }: { p: ConnectedPerson; onSelect: (w: string) => void }) {
  const tone =
    p.pattern === "aligned"
      ? "var(--yes)"
      : p.pattern === "opposed"
        ? "var(--no)"
        : "var(--text-muted)";
  return (
    <button
      type="button"
      onClick={() => onSelect(p.wallet)}
      className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-[var(--surface-2)]"
    >
      {p.avatarUrl ? (
        <img
          src={p.avatarUrl}
          alt=""
          className="mt-0.5 h-7 w-7 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span
          className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-white"
          style={{ background: `hsl(${hueFor(p.wallet)} 45% 45%)` }}
          aria-hidden
        >
          {initialsFor(p.name)}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-[var(--text)]">{p.name}</span>
        {p.lines.map((line, i) => (
          <span
            key={line}
            className="block text-[11px] leading-snug"
            style={{ color: i === 1 ? tone : "var(--text-muted)" }}
          >
            {line}
          </span>
        ))}
      </span>
    </button>
  );
}
