/**
 * PROFILE — a person told through their convictions, and a door out of every
 * section.
 *
 * THE FAILURE V1 HAD. It answered "who is this person" well and then stopped
 * being a page you could leave through. Four defining convictions, then four
 * more markets to explore: eight doors of equal size, and a visitor given eight
 * equal choices takes none of them. Worse, the one section about the
 * RELATIONSHIP — "what connects you" — was prose with no markets under it, so
 * the most personal thing on the page was the only thing you could not act on.
 *
 * V2 keeps the order a curious visitor actually asks in, and gives every
 * section somewhere to go:
 *
 *   1  YOU + THEM            the relationship, before anything about them
 *   2  WHO THEY ARE          observable patterns, never personality
 *   3  WHY FOLLOW THEM       what arrives in your feed, not how well they did
 *   4  START HERE            ONE market, with the reason. The front door.
 *   5  CONVICTIONS           the positions that most reveal them
 *   6  BOTH CARE ABOUT       the evidence under the bridge
 *  6b  YOUR HISTORY          who showed up for whom, both directions
 *   7  CONVICTION MAP        everything they back, by theme — browsable
 *   8  EXPLORE               more markets, each explaining itself
 *   9  PEOPLE AROUND THEM    person → market → person
 *  10  ALL CONVICTIONS       the unabridged list, collapsed but never absent
 *  11  SUPPORTING            evidence, last and quiet
 *
 * CONNECTION BEFORE EXPLANATION — the reordering everything else hangs off.
 * Opening by describing a stranger asks a visitor to become interested in
 * somebody they have no reason to care about yet, and then offers statistics as
 * the argument. People do not become curious about strangers through
 * statistics; they become curious the moment they recognise a point of contact.
 * So the page opens with the bridge and only then describes who is standing on
 * the other side of it. See @/domain/what-connects-you, including its refusal
 * to ever report an absence: a reader with no overlap is EARLY, not
 * incompatible, and "no shared markets" is the worst sentence this page could
 * lead with.
 *
 * THE RELATIONSHIP COMES BEFORE THE BROWSE. 6 sits above 7 for the same reason
 * 1 sits above 2 — a viewer-relative page answers "why does this matter to me"
 * before asking anyone to walk through a stranger's whole history.
 *
 * INTERPRETATION AND COMPLETENESS ARE BOTH REQUIRED, and they are different
 * jobs. Sections 4 and 6 pick, group and truncate — that is what builds
 * curiosity. Section 9 does none of it, and that is what makes the rest
 * trustworthy: a visitor who suspects the highlights were cherry picked has to
 * be able to check. Every position they hold and every market the two of you
 * share is reachable from this page, collapsed rather than hidden.
 *
 * THE PERCENTAGE CAME BACK, AND WHY THAT IS NOT A REGRESSION. This page removed
 * a relationship score once, for a good reason: it told a visitor they were "68%
 * compatible" without naming one thing they would disagree about. The objection
 * was never to the number, it was to the number ARRIVING ALONE.
 *
 * Section 1 now answers that by construction. The bonds render in the same block,
 * so a figure is physically unable to appear without the concrete detail beneath
 * it, and the order is deliberate: the sentence about the two of you comes first,
 * then TRIBE and the percentage as the machinery that explains it. Leading with
 * the machinery would make a reader decode before they feel anything.
 *
 * TWO DIMENSIONS, NEVER BLENDED. Shared DNA answers "do we see the world the same
 * way"; showing up answers "are they there when I call". A person at 92% DNA who
 * never shows, and one at 28% who always does, are the two most interesting
 * relationships on this platform — averaging them into one "compatibility" score
 * would erase exactly what makes them worth reading. The two calculations never
 * touch; see @/domain/dependability.
 *
 * STILL DELIBERATELY ABSENT. A Together/Apart stat pair. A per-topic bar chart.
 * Returns, rank, profit, follower counts — outcomes, and an outcome is not a
 * reason to listen to someone.
 *
 * WHAT COULD NOT BE BUILT HONESTLY. "Recently increased" — the events log
 * records becoming directional, changing side, going mixed and going inactive,
 * but nothing for strengthening a position. Inferring it from a rising marked
 * value would report "they doubled down" when in fact someone else bought and
 * moved the price. It is omitted rather than faked.
 *
 * All judgement lives in @/domain/person-profile and @/domain/profile-start-here
 * — including the refusals, which are most of it. This file only arranges what
 * those modules allow.
 */
import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { getPersonProfile, listPersonConvictions } from "@/lib/dna.functions";
import { ago, RELATIONSHIP_TEXT, relationshipTone } from "@/lib/dna-labels";
import { getCallsWithPerson } from "@/lib/challenge.functions";
import { bondFor, historyRows, EMPTY_TALLY } from "@/domain/dependability";
import { hueFor, initialsFor } from "@/lib/wallet-identity";
import { FollowButton } from "@/components/FollowButton";
import { categoryToDomain } from "@/domain/categories";
import {
  definingConvictions,
  introduction,
  topCategories,
  whyFollow,
  convictionMap,
  sharedCuriosity,
  allConvictions,
  limitRepeats,
  type DefiningConviction,
  type PersonPosition,
  type SharedRow,
  tenureText,
  type ConvictionTheme,
  type ProfileSlot,
} from "@/domain/person-profile";
import {
  rankStartCandidates,
  type StartCandidate,
  type StartHere,
} from "@/domain/profile-start-here";
import { peopleAround, type ConnectedPerson } from "@/domain/person-network";
import { whatConnectsYou } from "@/domain/what-connects-you";

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
  // Two expansions, both closed by default and neither ever absent. Breadth is
  // what makes the interpretation above it trustworthy; hiding it behind a
  // scroll is fine, hiding it behind nothing is not.
  const [allShared, setAllShared] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["person", wallet.toLowerCase(), viewer ?? null],
    queryFn: () => getPersonProfile({ data: { wallet, viewer } }),
    // NO INTERVAL. Unlike the network and the DNA overview, this profile is
    // computed on read rather than served from a worker cache, so there is no
    // "still computing" state to wait on — the timer was re-running a
    // multi-query service read every minute for a panel the reader opened and
    // is looking at. What moves it is that person trading, which carries no
    // wallet-keyed event; focus and reconnect refetching are the honest
    // coverage, and this staleTime is short enough for them to fire.
    staleTime: 60_000,
  });

  /**
   * DID WE SHOW UP FOR EACH OTHER — both directions, the whole history.
   *
   * Its own query rather than a wider `getPersonProfile`, for the same reason
   * the People rail keeps it separate: this reads a different table on a
   * different cadence, and folding it in would make every profile view wait on
   * it. The page paints, and the relationship arrives a beat later.
   */
  const { data: pair } = useQuery({
    queryKey: ["calls-with", viewer ?? null, wallet.toLowerCase()],
    queryFn: () => getCallsWithPerson({ data: { viewer: viewer ?? null, person: wallet } }),
    enabled: !!viewer,
    staleTime: 60_000,
  });

  /**
   * The unabridged list, paged, and fetched ONLY once somebody opens it — the
   * profile payload is loaded for every person you look at, and most visitors
   * never ask for all 260 rows. `getNextPageParam` returning undefined at the
   * end is what makes the section genuinely complete rather than capped.
   */
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

  const intro = introduction(data.positions, { marketsParticipated: data.positions.length });
  const follow = whyFollow(data.positions, { marketsCreated: data.marketsCreated });
  const defining = definingConvictions(data.positions, data.changes);
  const themes = convictionMap(data.positions);
  const link = whatConnectsYou(
    {
      sharedMarkets: data.sharedBeliefs,
      together: data.together,
      apart: data.apart,
      alignedTopics: data.alignedDomains.map((d) => d.domain),
      opposedTopics: data.opposedDomains.map((d) => d.domain),
      viewerTopics: data.viewerTopics,
      // As DOMAINS, because that is what `viewerTopics` and `alignedTopics`
      // already are and `whatConnectsYou` intersects the three. Passing raw
      // categories here compared "crypto" against "Money" and so found a
      // shared topic exactly never — the same vocabulary split, one layer up.
      personTopics: [
        ...new Set(
          topCategories(data.positions)
            .map((c) => categoryToDomain(c.name))
            .filter((d): d is NonNullable<typeof d> => d != null),
        ),
      ],
      viewerMedianDays: data.viewerMedianDays,
      personMedianDays: data.personMedianDays,
    },
    data.displayName,
  );
  const around = peopleAround(data.around);

  // The relationship, from two counted directions. Null pair (signed out, or the
  // read has not landed) yields the silent state rather than a zero.
  const bond = bondFor(data.displayName, pair?.theirs ?? EMPTY_TALLY, pair?.yours ?? EMPTY_TALLY);
  const history = historyRows(pair?.history ?? [], data.displayName);

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
  const shared = sharedCuriosity(agreed, opposed, allShared ? sharedTotal : SHARED_PREVIEW);
  // Before the section is opened the profile's own (capped) slice stands in, so
  // the heading and the empty check work without a second request.
  const every = allConvictions(data.positions);
  const everyLoaded = allConvictions(
    all.data ? all.data.pages.flatMap((p) => p.positions) : data.positions,
  );

  // ONE ranking drives both the front door and the further reading, so the page
  // can never recommend a market for one reason at the top and a different
  // reason four sections down.
  const ranked = rankStartCandidates(candidatesFrom(data, defining), {
    personName: data.displayName,
    hasViewer: data.hasViewer,
  });
  const lead = ranked[0] ?? null;

  /**
   * REPETITION BUDGET across the interpreting sections.
   *
   * "Explore" already refuses anything offered above it. The remaining failure
   * is a SPARSE profile, where three positions fill five sections and a visitor
   * scrolls past the same question over and over. Some repetition is correct —
   * Start Here and "Largest conviction" answer different questions — so this
   * allows a market to appear twice and drops the weakest claim after that.
   *
   * The conviction map and All Convictions are deliberately outside the budget:
   * they are inventories, and an inventory with holes is broken, not tidy.
   */
  const exploreRaw = ranked
    .filter((r) => r.marketId !== lead?.marketId)
    .filter((r) => !shared.some((s) => s.marketId === r.marketId))
    .slice(0, 4);
  const keep = limitRepeats([
    ...(lead ? [{ slot: "start_here" as const, marketId: lead.marketId }] : []),
    ...defining.map((d) => ({ slot: "defining" as const, marketId: d.marketId })),
    ...shared.map((s) => ({ slot: "shared" as const, marketId: s.marketId })),
    ...exploreRaw.map((r) => ({ slot: "explore" as const, marketId: r.marketId })),
  ]);
  const kept = (slot: ProfileSlot, id: number) => keep.has(`${slot}:${id}`);

  const definingShown = defining.filter((d) => kept("defining", d.marketId));
  const sharedShown = shared.filter((s) => kept("shared", s.marketId));
  const explore = exploreRaw.filter((r) => kept("explore", r.marketId));

  return (
    <div className="space-y-7">
      {/* ── 1 · WHAT CONNECTS YOU ────────────────────────────────────────────
          CONNECTION BEFORE EXPLANATION, and this is the whole reason it sits
          above the person's own name.

          Every earlier version opened by explaining a stranger, which asks a
          visitor to become interested in somebody they have no reason to care
          about yet and then offers statistics as the argument. People do not
          become curious about strangers through statistics; they become curious
          the moment they recognise a point of contact. Two people who discover
          a shared birthday feel something, and the fact carries no information
          at all — the feeling is "we have something in common", and everything
          after it lands warmer.

          Only for a signed-in visitor: with nobody on the other side there is
          no bridge to describe, and a "what connects you" panel addressed to
          no one is worse than starting with the person. */}
      {data.hasViewer && (
        <section>
          {/* ACT I. The emotional answer BEFORE the mechanics, which is the one
              change to this section since it was written.

              This page once carried a relationship percentage and it was removed
              for a good reason recorded above: it told a visitor they were "68%
              compatible" without naming one thing they would disagree about. The
              number is back, and that objection is answered by CONSTRUCTION —
              the bonds render in this same block, so the figure is physically
              unable to appear on its own.

              Order matters. "You show up for each other" is a fact about the two
              of you; TRIBE and 82% are the machinery that explains it. Leading
              with the machinery would make a reader decode before they feel. */}
          <SectionTitle>You + {data.displayName.split(" ")[0] || data.displayName}</SectionTitle>
          {bond?.sentence && (
            <p className="text-[15px] leading-snug font-semibold text-[var(--text)]">
              {bond.sentence}
            </p>
          )}
          <div className={`flex items-baseline gap-2 ${bond?.sentence ? "mt-1.5" : ""}`}>
            <span
              className="text-[10px] font-semibold uppercase tracking-wide"
              style={{ color: relationshipTone(data.relationship).fg }}
            >
              {RELATIONSHIP_TEXT[data.relationship]}
            </span>
            {data.sharedBeliefs > 0 && Number.isFinite(data.agreement) && (
              <span className="num text-[12px] text-[var(--text-secondary)]">
                {Math.round(data.agreement)}% Shared DNA
              </span>
            )}
          </div>
          <p className="mt-2.5 text-[14px] leading-relaxed font-medium text-[var(--text)]">
            {link.opening}
          </p>
          <ul className="mt-2 space-y-1">
            {link.bonds.map((b) => (
              <li
                key={b}
                className="flex gap-2 text-[13px] leading-relaxed text-[var(--text-secondary)]"
              >
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--text-muted)]" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
          {/* An empty overlap is a beginning, not a verdict — so it gets the one
              onward sentence rather than a shrug. */}
          {link.early && (
            <p className="mt-2 text-[12px] leading-relaxed text-[var(--text-muted)]">
              Open one of their convictions below to find where your thinking overlaps — or where it
              does not.
            </p>
          )}
          {/* The receipt, last and quiet. It says "13 of 17 times" rather than a
              percentage on purpose: a reader can count the rows in the history
              below and get the same answer, which is what makes the claim
              checkable instead of magical. */}
          {bond?.evidence && (
            <p className="mt-2 text-[12px] leading-relaxed text-[var(--text-secondary)]">
              {bond.evidence}
            </p>
          )}
        </section>
      )}

      {/* ── 2 · WHO THEY ARE ─────────────────────────────────────────────────
          A name, a face, and two sentences about what they have actually
          backed. No score: a number here would be the first thing read and the
          least useful thing said. */}
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
            {intro.lines.join(" ")}
          </p>
        </div>
        <FollowButton person={wallet} viewer={viewer} />
      </header>

      {/* ── 3 · WHY FOLLOW THEM ──────────────────────────────────────────────
          What you GET, never how well they have done. V1 said "surfaces markets
          connected to them" — true of following anybody, and therefore a
          description of the button rather than of the person. */}
      {follow.length > 0 && (
        <section>
          <SectionTitle>Why follow them</SectionTitle>
          {/* MEANING, then evidence. A bare count reads like a database row and
              leaves the interpreting to the reader; a bare claim could be
              printed about anybody. Neither ships without the other. */}
          <ul className="space-y-2">
            {follow.map((r) => (
              <li key={r.kind}>
                <span className="block text-[13px] leading-snug text-[var(--text)]">
                  {r.headline}
                </span>
                <span className="mt-0.5 block text-[12px] leading-snug text-[var(--text-muted)]">
                  {r.evidence}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── 4 · START HERE ───────────────────────────────────────────────────
          The front door, and the only element on the page allowed to be loud.
          One market, chosen for how much opening it would explain — not for
          being the biggest. Omitted entirely when nothing can explain itself. */}
      {lead && <StartHereCard lead={lead} onSelect={onSelectMarket} />}

      {/* ── 5 · CONVICTIONS THAT DEFINE THEM ─────────────────────────────── */}
      {definingShown.length > 0 && (
        <section>
          <SectionTitle>Convictions that define them</SectionTitle>
          <ul className="space-y-2">
            {definingShown.map((d) => (
              <li key={`${d.kind}:${d.marketId}`}>
                <DefiningRow c={d} onSelect={onSelectMarket} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── 6 · MARKETS YOU BOTH CARE ABOUT ──────────────────────────────────
          Ahead of their conviction map ON PURPOSE. The page is viewer-relative,
          and "why does this person matter to me" has to be answered before a
          visitor is asked to browse someone's whole history.

          Shared curiosity, not a tally. The summary, and then — the part V1
          never had — the markets themselves, each showing what the two of you
          concluded side by side. Every shared market is reachable: the list
          starts short and opens to all of them, because a relationship you can
          only sample is a relationship you cannot check.

          Signed-out visitors see none of it: with no viewer there is no
          relationship, and an empty "what connects you" is worse than none. */}
      {data.hasViewer && (
        <section>
          <SectionTitle>Markets you both care about</SectionTitle>
          {/* The SUMMARY of this relationship now opens the page. What is left
              here is the evidence for it — the markets themselves, each showing
              what the two of you concluded. Saying it twice would make the
              recognition at the top feel like a preview of a list. */}
          {sharedShown.length > 0 && (
            <>
              <ul className="mt-2.5 space-y-0.5">
                {sharedShown.map((s) => (
                  <li key={s.marketId}>
                    <SharedMarketRow s={s} onSelect={onSelectMarket} />
                  </li>
                ))}
              </ul>
              {sharedTotal > sharedShown.length && (
                <MoreButton onClick={() => setAllShared(true)}>
                  Show all {sharedTotal} shared markets
                </MoreButton>
              )}
            </>
          )}
        </section>
      )}

      {/* ── 6b · YOUR HISTORY ────────────────────────────────────────────────
          ACT II — the receipts under Act I's claim.

          BOTH DIRECTIONS, because a relationship is not one person's record of
          the other. The reverse rows have been written since the first day and
          nothing ever read them, so half of every relationship on this platform
          was invisible.

          THREE STATES, NOT FOUR. A call that has left the derivation window is
          simply absent — it is neither a success nor a failure, its caller can
          no longer see it either, and naming it would teach a reader a database
          lifecycle they should never have to know exists. The counting keeps it
          out of the denominator; the story keeps it out of view. */}
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
                      className="shrink-0 text-[10px] font-semibold uppercase tracking-wide"
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

      {/* ── 7 · THEIR CONVICTION MAP ─────────────────────────────────────────
          Everything they currently back, by theme. A flat list of forty
          positions is the same as no list — nothing in it is more important
          than anything else. Grouped, "what do they think about culture"
          becomes a question the page can answer.

          This INTERPRETS: it truncates each theme and leads with the one they
          have said the most about. Section 9 is the unabridged version, and the
          two exist together deliberately — interpretation builds curiosity, the
          complete list is what makes it trustworthy. */}
      {themes.length > 0 && (
        <section>
          <SectionTitle>Their conviction map</SectionTitle>
          <div className="space-y-4">
            {themes.map((t) => (
              <ThemeGroup key={t.theme} theme={t} onSelect={onSelectMarket} />
            ))}
          </div>
        </section>
      )}

      {/* ── 8 · MARKETS YOU SHOULD EXPLORE ───────────────────────────────────
          Every row states why it is here, in terms of this person — never
          "recommended for you". Nothing already offered above appears again. */}
      {explore.length > 0 && (
        <section>
          <SectionTitle>Markets to explore because of them</SectionTitle>
          <ul className="space-y-0.5">
            {explore.map((s) => (
              <li key={s.marketId}>
                <SuggestionRow
                  title={s.title}
                  why={s.why}
                  id={s.marketId}
                  onSelect={onSelectMarket}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── 9 · PEOPLE AROUND THEIR CONVICTIONS ──────────────────────────────
          Markets lead to more people. These are structurally connected to THE
          PROFILE OWNER — everyone who keeps turning up in the same markets as
          them — which is a different question from the viewer's own network and
          answered by its own query. Omitted entirely when the overlap is too
          thin to describe, never rendered as an empty shell. */}
      {around.length > 0 && onSelectPerson && (
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

      {/* ── 10 · ALL CONVICTIONS ──────────────────────────────────────────────
          The unabridged list, and the reason every section above is allowed to
          be selective. Sections 4 and 6 interpret — they pick, group and
          truncate — and a visitor who suspects the highlights were cherry
          picked has to be able to check, or the highlights are worth nothing.

          Collapsed by default, never absent, and the count is the TRUE total
          rather than the length of what was loaded: a heading that says "All
          convictions · 200" about someone holding 260 is lying in the one place
          on the page that exists to be trusted. */}
      {every.length > 0 && (
        <section>
          <button
            type="button"
            onClick={() => setAllOpen((v) => !v)}
            aria-expanded={allOpen}
            className="flex w-full items-center gap-1.5 text-[11px] font-semibold tracking-wide text-[var(--text-muted)] uppercase transition-colors hover:text-[var(--text)]"
          >
            <span aria-hidden className={allOpen ? "rotate-90" : ""}>
              ›
            </span>
            All convictions
            <span className="num normal-case">· {data.positionsTotal}</span>
          </button>
          {allOpen && (
            <>
              <ul className="mt-2 space-y-0.5">
                {everyLoaded.map((p) => (
                  <li key={p.marketId}>
                    <ConvictionRow p={p} onSelect={onSelectMarket} />
                  </li>
                ))}
              </ul>
              {/* Reaches the end. The count says what is on screen against the
                  true total, and the control keeps going until there is nothing
                  left — a browsing surface that stops at a cap while calling
                  itself complete is the one lie this section cannot afford. */}
              {all.hasNextPage && (
                <MoreButton onClick={() => void all.fetchNextPage()}>
                  {all.isFetchingNextPage
                    ? "Loading…"
                    : `Show more — ${everyLoaded.length} of ${data.positionsTotal}`}
                </MoreButton>
              )}
            </>
          )}
        </section>
      )}

      {/* ── 11 · SUPPORTING ──────────────────────────────────────────────────
          Evidence, not identity, so it sits last and stays quiet. */}
      <section className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--text-muted)]">
        <span>
          <span className="num text-[var(--text-secondary)]">{data.positions.length}</span> active{" "}
          {data.positions.length === 1 ? "conviction" : "convictions"}
        </span>
        {data.personMedianDays != null && data.personMedianDays > 0 && (
          <span>
            typically held{" "}
            <span className="num text-[var(--text-secondary)]">
              {Math.round(data.personMedianDays)}
            </span>{" "}
            days
          </span>
        )}
        {data.marketsCreated > 0 && (
          <span>
            <span className="num text-[var(--text-secondary)]">{data.marketsCreated}</span>{" "}
            {data.marketsCreated === 1 ? "question" : "questions"} written
          </span>
        )}
        {data.recentActivity.map((a) => (
          <button
            key={a.marketId}
            type="button"
            onClick={() => onSelectMarket(Number(a.marketId))}
            className="underline decoration-dotted underline-offset-2 transition-colors hover:text-[var(--text)]"
          >
            last active {ago(a.occurredAt)}
          </button>
        ))}
      </section>
    </div>
  );
}

/**
 * Everything the Start Here engine needs, assembled from data the page already
 * has. No extra query: the person's positions carry the market facts, the
 * viewer's shared markets carry their side, and the DNA domains say which topics
 * the two of them usually land the same way on.
 */
function candidatesFrom(
  data: {
    positions: PersonPosition[];
    sharedBoth: { marketId: string; personSide: "YES" | "NO"; viewerSide: "YES" | "NO" }[];
    opposing: { marketId: string; personSide: "YES" | "NO"; viewerSide: "YES" | "NO" }[];
    alignedDomains: { domain: string }[];
    viewerMarketIds: number[];
  },
  defining: readonly DefiningConviction[],
): StartCandidate[] {
  const viewerSideOf = new Map<number, "YES" | "NO">();
  for (const m of [...data.sharedBoth, ...data.opposing])
    viewerSideOf.set(Number(m.marketId), m.viewerSide);
  // A market the viewer holds that is NOT in the shared lists still counts as
  // explored: those lists only cover the overlap the DNA engine scored, while
  // "have you been here" is a fact about the viewer alone.
  const viewerHeld = new Set(data.viewerMarketIds);
  // Compared as DOMAINS, not as raw strings. `alignedDomains` are DNA spokes
  // ("Money") and `position.category` is a stored slug ("crypto"), so the old
  // lowercase string match never once returned true — a flag that was silently
  // always false rather than a flag that was wrong.
  const alignedTopics = new Set(data.alignedDomains.map((d) => d.domain));

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
      viewerSide: viewerSideOf.get(p.marketId) ?? (viewerHeld.has(p.marketId) ? p.side : null),
      category: p.category,
      topicUsuallyAligned: domain != null && alignedTopics.has(domain),
      isLargest: p.marketId === largestId,
      isLongest: p.marketId === longestId,
    };
  });
}

/** Shared markets shown before the reader asks for the rest. */
const SHARED_PREVIEW = 6;
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

/** One row of the unabridged list: side, question, and what it is worth. */
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

/**
 * The front door. The only card on the page with a highlighted border, because
 * a page with two primary actions has none — and the whole point of this section
 * is that a visitor leaves through it rather than reading on.
 */
function StartHereCard({ lead, onSelect }: { lead: StartHere; onSelect: (id: number) => void }) {
  return (
    <section>
      <SectionTitle>Start here</SectionTitle>
      <button
        type="button"
        onClick={() => onSelect(lead.marketId)}
        className="block w-full rounded-[14px] px-4 py-3.5 text-left transition-colors hover:bg-[var(--surface-2)]"
        style={{ background: "var(--surface)", border: "1px solid var(--text-secondary)" }}
      >
        <span className="block text-[15px] leading-snug font-semibold text-[var(--text)]">
          {lead.title}
        </span>
        <span className="mt-1.5 block text-[12px] leading-relaxed text-[var(--text-secondary)]">
          {lead.why}
        </span>
        <span className="mt-2 block text-[12px] font-medium text-[var(--text)]">
          Explore market →
        </span>
      </button>
    </section>
  );
}

/**
 * One defining conviction — a heading, the question, the evidence.
 *
 * Deliberately a whole tappable block rather than a list row: these are the
 * invitations, and the question needs room to be read rather than truncated.
 */
function DefiningRow({ c, onSelect }: { c: DefiningConviction; onSelect: (id: number) => void }) {
  const tone =
    c.side === "YES" ? "var(--yes)" : c.side === "NO" ? "var(--no)" : "var(--text-muted)";
  return (
    <button
      type="button"
      onClick={() => onSelect(c.marketId)}
      className="block w-full rounded-[12px] px-3.5 py-3 text-left transition-colors hover:bg-[var(--surface-2)]"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
    >
      <span
        className="block text-[10px] font-semibold tracking-[0.1em] uppercase"
        style={{ color: tone }}
      >
        {c.label}
      </span>
      <span className="mt-1 block text-[14px] leading-snug font-medium text-[var(--text)]">
        {c.title}
      </span>
      <span className="num mt-1 block text-[12px] text-[var(--text-secondary)]">{c.detail}</span>
    </button>
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
      {/* Not a dead caption. Every one of these is reachable in "All
          convictions" below — the map is allowed to truncate precisely because
          the unabridged list exists. */}
      {hidden > 0 && (
        <p className="mt-0.5 px-2 text-[11px] text-[var(--text-muted)]">
          and {hidden} more in {theme.theme.toLowerCase()} — see all convictions below
        </p>
      )}
    </div>
  );
}

/**
 * One market you both took a side in, with both sides shown.
 *
 * The two sides sit together on purpose: this section exists to make the
 * relationship legible, and a row that showed only an agreement count would be
 * the similarity score this page was built to replace.
 */
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

/**
 * One connected person. The pattern colours the row and nothing else — it is a
 * shape, not a badge, and turning "often opposed" into a permanent label is
 * exactly the diminishing categorisation the profile avoids.
 */
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

/** A market and the sentence saying why it is here. Never "recommended". */
function SuggestionRow({
  id,
  title,
  why,
  onSelect,
}: {
  id: number;
  title: string;
  why: string;
  onSelect: (id: number) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      className="block w-full rounded-lg px-2 py-2 text-left transition-colors hover:bg-[var(--surface-2)]"
    >
      <span className="block text-[13px] leading-snug text-[var(--text)]">{title}</span>
      <span className="mt-0.5 block text-[11px] text-[var(--text-muted)]">{why}</span>
    </button>
  );
}
