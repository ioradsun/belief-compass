/**
 * PROFILE — a relationship story first, a profile second.
 *
 * THE FAILURE. The page narrated the database. It could show Conviction Match,
 * a shared count, relationship copy, Start Here, Their Convictions, Where
 * You've Met, a conviction map, active-conviction stats, people around them and
 * a Showing Up history — with the EVIDENCE for the headline number sitting
 * below all of it. A reader had to scroll past a stranger's whole inventory to
 * find the four markets that produced "100% Conviction Match".
 *
 * THE ORDER IS THE PRODUCT:
 *
 *   YOU + THEM        what are we?            one narrative sentence, owned by
 *                                             @/domain/relationship-narrative
 *   THE RECEIPTS      why does it say that?   the shared markets, immediately
 *   BETWEEN YOU       have we shown up?       only with real call history
 *   CALLED YOU/JOIN   what could we do now?   only with a live opportunity
 *   THEM              who are they?           name, face, one line
 *   THEIR CONVICTIONS what do they believe?   one canonical section
 *   PEOPLE AROUND     who else is here?       only when it aids discovery
 *
 * relationship → evidence → history → opportunity → person → world.
 *
 * NEVER MAKE THE READER HUNT FOR THE EVIDENCE BEHIND THE HEADLINE. The claim
 * and its proof are adjacent, always.
 *
 * THIN RELATIONSHIP → THIN PROFILE. Every section returns nothing when it has
 * nothing true to say; the page contracts rather than padding itself. A person
 * with one conviction gets no taxonomy, no "largest conviction", no map.
 *
 * ONE NARRATIVE OWNER. JSX never composes a competing story: it renders exactly
 * what the engine chose, and the accessible reading matches it word for word.
 *
 * NO FOLLOW. Showing up is the relationship model here; a subscribe button
 * inherited from another network sat beside Conviction Match saying something
 * else entirely.
 */
import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { getPersonProfile, listPersonConvictions } from "@/lib/dna.functions";
import { ago } from "@/domain/relative-time";
import { getCallsWithPerson, getChallenges } from "@/lib/challenge.functions";
import { historyRows } from "@/domain/dependability";
import { hueFor, initialsFor } from "@/lib/wallet-identity";
import { categoryToDomain } from "@/domain/categories";
import {
  definingConvictions,
  convictionMap,
  allConvictions,
  tenureText,
  type PersonPosition,
  type ConvictionTheme,
} from "@/domain/person-profile";
import { rankStartCandidates, type StartCandidate } from "@/domain/profile-start-here";
import { peopleAround, type ConnectedPerson } from "@/domain/person-network";
import {
  nextAct,
  themAct,
  receipts,
  DENSITY,
  RECEIPTS,
  type NextAct,
  type Receipts,
  type ReceiptRow,
  type ThemPosition,
} from "@/domain/profile-story";
import {
  relationshipNarrative,
  type DomainRecord,
  type Narrative,
} from "@/domain/relationship-narrative";

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
   * the person you are looking at is the strongest thing this page can offer.
   */
  const { data: challenges } = useQuery({
    queryKey: ["challenges", viewer ?? null],
    queryFn: () => getChallenges({ data: { wallet: viewer ?? null } }),
    enabled: !!viewer,
    staleTime: 60_000,
  });

  if (isLoading || !data) {
    return <div className="h-40 animate-pulse rounded-xl bg-[var(--surface-2)]" />;
  }

  const first = data.displayName.split(" ")[0] || data.displayName;

  /* ── The shared record, once, and everything relational reads from it ───── */
  const sharedRows = [...data.sharedBoth, ...data.opposing].map((m) => ({
    marketId: Number(m.marketId),
    title: m.title,
    viewerSide: m.viewerSide,
    personSide: m.personSide,
    domain: m.domain ?? null,
  }));
  const proof = receipts(sharedRows, {
    limit: allShared ? sharedRows.length : RECEIPTS.preview,
  });

  /* ── ACT I · YOU + THEM ─────────────────────────────────────────────────── */
  // Showing up is counted from the call ledger, never inferred from sides.
  const theyShowed = (pair?.theirs.answered ?? 0) > 0;
  const youShowed = (pair?.yours.answered ?? 0) > 0;
  const story: Narrative | null = data.hasViewer
    ? relationshipNarrative({
        name: first,
        shared: data.sharedBeliefs,
        together: data.together,
        apart: data.apart,
        domains: domainRecords(sharedRows),
        theyShowed,
        youShowed,
      })
    : null;

  /* ── OPPORTUNITY ────────────────────────────────────────────────────────── */
  // Only markets the viewer has never answered are eligible: an invitation to a
  // market you already took a side in is not an invitation.
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
      ? {
          marketId: callFromThem.marketId,
          title: callFromThem.title,
          side: callFromThem.callerSide,
        }
      : null,
    joinCandidate:
      joinPick && joinSide
        ? { marketId: joinPick.marketId, title: joinPick.title, side: joinSide }
        : null,
  });

  /* ── THEM ───────────────────────────────────────────────────────────────── */
  const them = themAct(data.positions as ThemPosition[], {
    total: data.positionsTotal,
    medianDays: data.personMedianDays,
    excludeMarketId: next?.marketId ?? null,
  });
  const themes = them.grouped ? convictionMap(data.positions) : [];
  const flat = them.rows.slice(0, DENSITY.preview);
  const every = allConvictions(data.positions);

  const history = historyRows(pair?.history ?? [], data.displayName);
  const around = peopleAround(data.around);
  /** Where most of their conviction lives — one line, only when it is true. */
  const home = concentration(data.positions);

  return (
    <div className="space-y-7">
      {/* ── I · THE TWO OF YOU ─────────────────────────────────────────────
          The two faces ARE the heading. A label reading "YOU + RASOUL" over
          two anonymous paragraphs made the reader assemble the pair from text;
          seeing your own picture next to theirs does it in one glance, and the
          words underneath can then get on with saying something.

          Signed out, there is no pair: the header collapses to one person and
          claims no relationship. */}
      <header className="space-y-4">
        <div className="flex items-start gap-4">
          {data.hasViewer && (
            <>
              <Face
                name={data.viewerName ?? "You"}
                avatarUrl={data.viewerAvatarUrl}
                seed={viewer ?? data.wallet}
                label="You"
              />
              <span
                className="mt-5 h-px w-6 shrink-0 bg-[var(--border)] sm:w-10"
                aria-hidden="true"
              />
            </>
          )}
          <Face
            name={data.displayName}
            avatarUrl={data.avatarUrl}
            seed={data.wallet}
            label={data.hasViewer ? "Them" : null}
            heading
          />
        </div>

        {/* THE COUNT IS NOT SMALLER THAN THE PERCENTAGE while the record is
            thin. 100% built on one market is arithmetic; "1 of 1 together" is
            the fact. */}
        {story && (
          <div aria-label={`You and ${first}`}>
            {story.matchPct != null && story.evidence ? (
              <>
                <div className="flex items-baseline gap-2.5">
                  <span
                    className={`num font-semibold text-[var(--text)] ${
                      data.sharedBeliefs < 8 ? "text-[20px]" : "text-[28px]"
                    }`}
                  >
                    {story.matchPct}%
                  </span>
                  <span
                    className={`num text-[var(--text-secondary)] ${
                      data.sharedBeliefs < 8 ? "text-[16px] font-semibold" : "text-[13px]"
                    }`}
                  >
                    {story.evidence}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] font-medium tracking-wide text-[var(--text-muted)] uppercase">
                  Conviction Match
                </p>
              </>
            ) : null}
            <p className="mt-2 text-[14px] leading-relaxed text-[var(--text)]">{story.primary}</p>
            {story.supporting && (
              <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-secondary)]">
                {story.supporting}
              </p>
            )}
          </div>
        )}
      </header>

      {/* ── THE RECEIPTS ───────────────────────────────────────────────────
          Directly under the claim, because the claim is only as good as this. */}
      {proof.rows.length > 0 && (
        <ReceiptsSection
          proof={proof}
          name={first}
          onSelect={onSelectMarket}
          onExpand={() => setAllShared(true)}
        />
      )}

      {/* ── BETWEEN YOU ────────────────────────────────────────────────────
          Who showed up for whom. Never declines, never expiries as shame. */}
      {history.length > 0 && (
        <section>
          <SectionTitle>Between you</SectionTitle>
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

      {/* ── WHAT CAN WE DO NEXT ────────────────────────────────────────────
          One thing, or nothing at all. Never a filler row. */}
      {next && <NextCard next={next} name={first} onSelect={onSelectMarket} />}

      {/* ── THEIR CONVICTIONS ──────────────────────────────────────────────
          One canonical section where four overlapping ones used to be. The
          face and name moved to the top of the page, so all that is left of
          "them as an individual" is the one true line about where their
          conviction lives. */}
      {(them.rows.length > 0 || every.length > 0) && (
        <section>
          <SectionTitle>Their convictions</SectionTitle>
          {home && (
            <p className="mb-2 text-[13px] leading-relaxed text-[var(--text-secondary)]">{home}</p>
          )}

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
          {/* The unabridged list — what makes everything above checkable. */}
          {data.positionsTotal > (them.grouped ? themes.length : flat.length) && (
            <AllConvictions
              wallet={wallet}
              total={data.positionsTotal}
              open={allOpen}
              onToggle={() => setAllOpen((v) => !v)}
              fallback={every}
              onSelect={onSelectMarket}
            />
          )}
        </section>
      )}

      {/* ── PEOPLE AROUND THEIR CONVICTIONS ────────────────────────────────
          One line each. It aids discovery; it does not compete with Act I. */}
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
 * Per-domain agreement over the SAME shared markets the receipts print, so a
 * domain sentence can never claim evidence a reader cannot count below it.
 */
function domainRecords(
  rows: readonly { domain: string | null; viewerSide: string; personSide: string }[],
): DomainRecord[] {
  const by = new Map<string, DomainRecord>();
  for (const r of rows) {
    const d = r.domain?.trim();
    if (!d) continue;
    const rec = by.get(d) ?? { domain: d, together: 0, apart: 0 };
    if (r.viewerSide === r.personSide) rec.together += 1;
    else rec.apart += 1;
    by.set(d, rec);
  }
  return [...by.values()];
}

/** Where most of their conviction lives — only when a majority actually does. */
function concentration(positions: readonly PersonPosition[]): string | null {
  if (positions.length < 4) return null;
  const counts = new Map<string, number>();
  for (const p of positions) {
    const d = categoryToDomain(p.category);
    if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!top || top[1] / positions.length < 0.5) return null;
  return `${top[0]} is where most of their conviction lives.`;
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
      // Every candidate here is one the viewer has never answered.
      viewerSide: null,
      category: p.category,
      topicUsuallyAligned: domain != null && alignedTopics.has(domain),
      isLargest: p.marketId === largestId,
      isLongest: p.marketId === longestId,
    };
  });
}

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

/** The unabridged inventory, paged, and only fetched once somebody asks. */
function AllConvictions({
  wallet,
  total,
  open,
  onToggle,
  fallback,
  onSelect,
}: {
  wallet: string;
  total: number;
  open: boolean;
  onToggle: () => void;
  fallback: PersonPosition[];
  onSelect: (id: number) => void;
}) {
  const q = useInfiniteQuery({
    queryKey: ["person-convictions", wallet.toLowerCase()],
    enabled: open,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      listPersonConvictions({ data: { wallet, offset: pageParam as number, limit: ALL_PAGE } }),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.positions.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
  });
  const loaded = allConvictions(q.data ? q.data.pages.flatMap((p) => p.positions) : fallback);

  return (
    <>
      <MoreButton onClick={onToggle}>
        {open ? "Hide all convictions" : `Show all ${total}`}
      </MoreButton>
      {open && (
        <>
          <ul className="mt-2 space-y-0.5">
            {loaded.map((p) => (
              <li key={p.marketId}>
                <ConvictionRow p={p} onSelect={onSelect} />
              </li>
            ))}
          </ul>
          {q.hasNextPage && (
            <MoreButton onClick={() => void q.fetchNextPage()}>
              {q.isFetchingNextPage ? "Loading…" : `Show more — ${loaded.length} of ${total}`}
            </MoreButton>
          )}
        </>
      )}
    </>
  );
}

/**
 * THE RECEIPTS. Two shapes, because agreement and disagreement are different
 * information: a column of "You YES · Them YES" repeated eleven times hides the
 * pattern it is meant to prove, while a single differing row is the whole story
 * of why the number is not 100.
 */
function ReceiptsSection({
  proof,
  name,
  onSelect,
  onExpand,
}: {
  proof: Receipts;
  name: string;
  onSelect: (id: number) => void;
  onExpand: () => void;
}) {
  return (
    <section>
      <SectionTitle>The receipts</SectionTitle>
      {proof.groups.length > 0 ? (
        <div className="space-y-3.5">
          {proof.groups.map((g) => (
            <div key={g.domain}>
              <h3 className="mb-1 text-[11px] font-medium tracking-wide text-[var(--text-secondary)] uppercase">
                {g.domain} — {g.together} of {g.total} together
              </h3>
              <ul className="space-y-0.5">
                {g.rows.map((r) => (
                  <li key={r.marketId}>
                    <ReceiptLine r={r} name={name} onSelect={onSelect} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <ul className="space-y-0.5">
          {proof.rows.map((r) => (
            <li key={r.marketId}>
              <ReceiptLine r={r} name={name} onSelect={onSelect} />
            </li>
          ))}
        </ul>
      )}
      <div className="mt-1.5 flex items-baseline gap-3 px-2">
        {proof.footer && (
          <span className="num text-[11px] text-[var(--text-muted)]">{proof.footer}</span>
        )}
        {proof.hidden > 0 && proof.groups.length === 0 && (
          <MoreButton onClick={onExpand}>Show all {proof.rows.length + proof.hidden}</MoreButton>
        )}
      </div>
    </section>
  );
}

/** One shared market. Sides appear only when they differ — then they lead. */
function ReceiptLine({
  r,
  name,
  onSelect,
}: {
  r: ReceiptRow;
  name: string;
  onSelect: (id: number) => void;
}) {
  const tone = (v: "YES" | "NO") => (v === "YES" ? "var(--yes)" : "var(--no)");
  return (
    <button
      type="button"
      onClick={() => onSelect(r.marketId)}
      className="block w-full rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--surface-2)]"
    >
      <span className="flex items-baseline gap-2">
        {r.agree && (
          <span className="shrink-0 text-[11px] text-[var(--text-muted)]" aria-hidden>
            ✓
          </span>
        )}
        <span className="min-w-0 flex-1 text-[13px] leading-snug text-[var(--text)]">
          {r.title}
        </span>
      </span>
      {!r.agree && (
        <span className="mt-0.5 flex items-center gap-3 pl-0 text-[11px] text-[var(--text-muted)]">
          <span>
            You <span style={{ color: tone(r.viewerSide) }}>{r.viewerSide}</span>
          </span>
          <span>
            {name} <span style={{ color: tone(r.personSide) }}>{r.personSide}</span>
          </span>
        </span>
      )}
    </button>
  );
}

/**
 * The opportunity. The only element on the page allowed to be loud, because a
 * page with two primary actions has none — and a call outranks an invitation.
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

/**
 * ONE PERSON IN THE PAIR — face, name, and who they are to the reader.
 *
 * The label is the whole point: two pictures with no labels is a puzzle, and
 * "You" over your own face is the cheapest possible way to make the page feel
 * like it is about a relationship rather than about a record.
 */
function Face({
  name,
  avatarUrl,
  seed,
  label,
  heading = false,
}: {
  name: string;
  avatarUrl: string | null;
  seed: string;
  label: string | null;
  /** The person this page is about gets the document heading; the reader does not. */
  heading?: boolean;
}) {
  const Name = heading ? "h1" : "p";
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      {avatarUrl ? (
        <img src={avatarUrl} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" />
      ) : (
        <span
          className="grid h-12 w-12 shrink-0 place-items-center rounded-full text-sm font-semibold text-white"
          style={{ background: `hsl(${hueFor(seed)} 45% 45%)` }}
          aria-hidden
        >
          {initialsFor(name)}
        </span>
      )}
      <div className="min-w-0">
        {label && (
          <p className="text-[10px] font-semibold tracking-wide text-[var(--text-muted)] uppercase">
            {label}
          </p>
        )}
        <Name className="truncate text-[15px] font-semibold text-[var(--text)]">{name}</Name>
      </div>
    </div>
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

/** One connected person. One line, so this cannot compete with Act I. */
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
      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-[var(--surface-2)]"
    >
      {p.avatarUrl ? (
        <img src={p.avatarUrl} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
      ) : (
        <span
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-white"
          style={{ background: `hsl(${hueFor(p.wallet)} 45% 45%)` }}
          aria-hidden
        >
          {initialsFor(p.name)}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-[var(--text)]">{p.name}</span>
        {p.lines[0] && (
          <span className="block truncate text-[11px] leading-snug" style={{ color: tone }}>
            {p.lines[0]}
          </span>
        )}
      </span>
    </button>
  );
}
