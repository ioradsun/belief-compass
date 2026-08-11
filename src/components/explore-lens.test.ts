import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { LENSES, LENS_LABELS, DISCOVER_LENSES, toLens } from "@/domain/feed/lens";
import { MOMENTUM_LABELS } from "@/domain/feed/momentum";

const MOMENTUM_LABELS_LIST = Object.values(MOMENTUM_LABELS);

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
/** Comments stripped: these files EXPLAIN the rules they follow. */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

/**
 * EXPLORE IS ONE CONTROL AND THREE LINES PER ROW.
 *
 *   the question          what is being asked
 *   why it is here        the lens's hero — a reason, or the measure it ranked on
 *   the scale             believers and capital, minus whatever the hero said
 *
 * The rules live in @/domain/feed/lens and are tested there. This file only
 * holds the WIRING to them, because every one of these is the kind of thing a
 * later edit re-implements inline without noticing.
 */
describe("the playlist row", () => {
  const feed = code("src/components/FeedListPanel.tsx");

  it("composes the hero and the scale from the shared module, not inline", () => {
    expect(feed).toMatch(/lensHero\(lens, f\.scale, f\.ageHours\)/);
    expect(feed).toMatch(/scaleLine\(lens, f\.scale\)/);
  });

  it("reads participants and capital off the row the feed already shipped", () => {
    // No second query, no second cache, no second definition of either measure.
    expect(feed).toMatch(/participantCount\(\{/);
    expect(feed).toMatch(/yes_capital_usd\) \+ num\(r\.no_capital_usd\)/);
    expect(feed).not.toMatch(/useQuery/);
  });

  it("counts participants with the SAME function the server ranks on", () => {
    // Ranking on one field and displaying another is how "Most Participants"
    // ends up topped by a row saying it has none.
    const server = code("src/lib/opportunity-feed.server.ts");
    expect(server).toMatch(/participantCount\(\{/);
    expect(feed).toMatch(/from "@\/domain\/participants"/);
    expect(server).toMatch(/from "@\/domain\/participants"/);
    // And the search index, so one market cannot be 5 people in the playlist
    // and 12 in a search result.
    expect(code("src/lib/markets.functions.ts")).toMatch(/participantCount\(\{/);
  });

  it("never prints a reason sentence beside a ranked hero", () => {
    // Two headlines is no headline. A lens that states its measure has already
    // answered "why is this here".
    expect(feed).toMatch(/const line = hero \? null :/);
  });

  it("keeps the discovery accent for reasons only", () => {
    // `--rel` means "this one is about you" everywhere in the product. "$505
    // committed" is a fact about the market, so it takes text weight instead.
    const heroBlock = feed.slice(
      feed.indexOf("{hero && ("),
      feed.indexOf("<WhyThis reason={line}"),
    );
    expect(heroBlock).not.toMatch(/--rel/);
    expect(heroBlock).toMatch(/text-\[var\(--text\)\]/);
  });
});

/**
 * ONE CONTROL, NOT TWENTY-FOUR.
 *
 * Explore had a five-chip lens row AND a dropdown holding an All row, three
 * sensitivity levels, five network groups, seven momentum lenses, seven topics
 * and a Reset — two competing surfaces above the playlist that is the actual
 * product. It exposed the recommendation engine and asked the reader to operate
 * it. What replaced it asks one question, and folds narrowing away until asked.
 */
describe("the Explore selector", () => {
  const sel = code("src/components/ExploreSelector.tsx");
  const feed = code("src/components/FeedListPanel.tsx");

  it("is the only discovery control the playlist mounts", () => {
    expect(feed).toMatch(/<ExploreSelector/);
    expect((feed.match(/<ExploreSelector/g) ?? []).length).toBe(1);
    // The lens row and the filter menu are both gone, not merely hidden.
    expect(feed).not.toMatch(/LensRow|FeedFilterMenu/);
  });

  it("deleted the old filter menu rather than leaving it unmounted", () => {
    expect(existsSync(join(process.cwd(), "src/components/FeedFilterMenu.tsx"))).toBe(false);
  });

  it("offers the four discovery choices, from the domain and not a local list", () => {
    expect(sel).toMatch(/DISCOVER_LENSES\.map/);
    expect(sel).toMatch(/LENS_LABELS\[l\]/);
    expect(DISCOVER_LENSES).toEqual(["for_you", "capital", "participants", "fresh"]);
  });

  it("no longer offers Moving, while keeping it a valid lens", () => {
    // The permanent shelf space goes; the ranking and every saved link survive.
    // 41 markets traded platform-wide in 24h, and the lens admits only markets
    // that moved — a choice that is usually near-empty teaches readers not to
    // press it.
    expect(DISCOVER_LENSES).not.toContain("moving");
    expect(LENSES).toContain("moving");
    expect(toLens("moving")).toBe("moving");
  });

  it("exposes no momentum sub-lenses", () => {
    // Moving now / Biggest gains / Biggest drops / Capital flow / New believers
    // / Contested / Waking up — seven decisions that need the ranker explained.
    for (const gone of MOMENTUM_LABELS_LIST) expect(sel, gone).not.toContain(gone);
    expect(sel).not.toMatch(/MOMENTUM_OPTIONS|toggleMomentum/);
  });

  it("exposes no sensitivity control", () => {
    expect(sel).not.toMatch(/How much matters|SENSITIVITY_ORDER|setFeedSensitivity/);
    expect(feed).not.toMatch(/sensitivity/i);
  });

  it("folds topic and people away behind one level, never two", () => {
    expect(sel).toMatch(/type Pane = "root" \| "topic" \| "people"/);
    expect(sel).toMatch(/<Drill label="Topic"/);
    expect(sel).toMatch(/<Drill label="People"/);
  });

  it("reuses the canonical topic and network grammar", () => {
    // No second topic system, no invented relationship classes.
    expect(sel).toMatch(/TOPIC_OPTIONS/);
    expect(sel).toMatch(/NETWORK_OPTIONS/);
    expect(sel).toMatch(/toggleTopic/);
    expect(sel).toMatch(/toggleNetwork/);
  });

  it("never offers a network group the viewer's evidence cannot fill", () => {
    expect(sel).toMatch(/availableNetworks\.includes\(n\.key\)/);
  });

  it("summarises narrowing quietly instead of growing a chip row", () => {
    // `Most Capital ×` `Crypto ×` `Tribe ×` is the same complexity in a new shape.
    expect(sel).toMatch(/const narrowed = isAll\(filters\)/);
    expect(sel).toMatch(/selected`/);
  });
});

describe("the lens is a server concept", () => {
  const idx = code("src/routes/index.tsx");

  it("is part of the query key — two lenses are two playlists", () => {
    const key = idx.slice(idx.indexOf("queryKey: ["), idx.indexOf("queryFn"));
    expect(key).toMatch(/lens,/);
  });

  it("is sent with the request rather than applied on the client", () => {
    expect((idx.match(/\n\s+lens,\n/g) ?? []).length).toBeGreaterThanOrEqual(2);
    // The client renders the order it was given; it never re-sorts one.
    expect(idx).not.toMatch(/\.sort\(/);
  });

  it("restarts the playlist exactly the way a filter change does", () => {
    expect(idx).toMatch(/const restartPlaylist = \(\) => \{/);
    expect(idx).toMatch(/const selectLens = \(l: Lens\) => \{/);
  });

  it("does not adopt the SSR snapshot under a lens it was not fetched for", () => {
    // The loader fetched the anonymous 24h For You feed. Painting it under
    // "Most Capital" would show the wrong order on first frame.
    expect(idx).toMatch(/lens === "for_you"\n?\s*\? \(loaderData\?\.feed/);
  });
});

/**
 * THE VALIDATOR IS A CONTRACT. `momentum` and `sensitivity` were absent from
 * the feed's input schema while the client sent both on every request — and
 * zod's `.parse` strips unknown keys silently, so ten of the filter menu's rows
 * did nothing at all. Nothing errored and no test failed.
 */
describe("the feed request schema accepts everything the client sends", () => {
  const fn = code("src/lib/opportunity-feed.functions.ts");
  const idx = code("src/routes/index.tsx");

  it("declares every field the route puts in the request", () => {
    for (const field of ["lens", "momentum", "sensitivity", "networks", "topics", "window"]) {
      expect(fn, field).toMatch(new RegExp(`\\b${field}:\\s*z\\.`));
    }
  });

  it("has no client field without a schema entry", () => {
    /**
     * Every key of every `data: { … }` the route hands `getOpportunityFeed`.
     *
     * Brace-counted rather than matched by indentation: a first attempt at this
     * scraped by leading whitespace and picked up `request` out of a
     * `Promise.race([request, …])`, which is a local and not a request field. A
     * guard that reports a field nobody sends is a guard nobody will keep.
     */
    const sent = new Set<string>();
    for (let at = idx.indexOf("getOpportunityFeed({"); at >= 0; ) {
      const start = idx.indexOf("data: {", at);
      if (start < 0) break;
      let depth = 0;
      let end = start + "data: ".length;
      for (; end < idx.length; end += 1) {
        if (idx[end] === "{") depth += 1;
        else if (idx[end] === "}" && (depth -= 1) === 0) break;
      }
      const body = idx.slice(start, end);
      // The trailing delimiter is a LOOKAHEAD. Consuming it made every second
      // key invisible: `sensitivity,` ate the comma that `lens,` needed as its
      // own prefix, so the scraper silently reported half the object — a guard
      // that passes by not looking is the failure mode this whole file exists
      // to catch.
      for (const m of body.matchAll(/[{,]\s*([a-zA-Z][a-zA-Z0-9]*)\s*(?=[,:])/g)) {
        sent.add(m[1]!);
      }
      at = idx.indexOf("getOpportunityFeed({", end);
    }

    expect(sent.size).toBeGreaterThan(4);
    expect(sent.has("lens")).toBe(true);
    expect(sent.has("momentum")).toBe(true);
    for (const k of sent) {
      if (k === "data" || k === "feedSession") continue;
      expect(fn, `${k} is sent but not in the schema`).toMatch(new RegExp(`\\b${k}:\\s*z\\.`));
    }
  });
});

/**
 * THE END OF A CHOSEN LENS.
 *
 * The failure mode this exists to prevent is silent substitution: a finite lens
 * runs dry, For You markets start arriving, and the control still reads "Fresh".
 * The reader picked the lens; finishing it is worth one line, and being moved
 * without being told is not acceptable at all.
 */
describe("the continuation state", () => {
  const feed = code("src/components/FeedListPanel.tsx");
  const idx = code("src/routes/index.tsx");

  it("is the last item of the playlist, not a takeover", () => {
    // A modal, banner or centre-stage replacement would interrupt the market
    // the reader is still looking at.
    expect(feed).toMatch(/<Continuation onContinue=/);
    expect(feed).toMatch(/<li className=/);
    expect(feed).not.toMatch(/createPortal|aria-modal|role="dialog"/);
  });

  it("offers exactly one move, and it is the canonical lens change", () => {
    expect(feed).toMatch(/onContinue=\{\(\) => onLens\("for_you"\)\}/);
    // One button. No countdown, no second action, no automatic navigation.
    const block = feed.slice(feed.indexOf("function Continuation"));
    expect((block.match(/<button/g) ?? []).length).toBe(1);
    expect(block).not.toMatch(/setTimeout|setInterval|navigate\(/);
  });

  it("says the two lines and nothing more", () => {
    expect(feed).toMatch(/You&rsquo;re caught up\./);
    expect(feed).toMatch(/Continue with Up Next/);
  });

  it("renders only on a real verdict, never inferred from an empty list", () => {
    // `entries.length === 0` means the client consumed its batch, which is not
    // the same as the lens running out — the feed pages implicitly.
    expect(feed).toMatch(/lensExhausted\?: boolean/);
    expect(feed).toMatch(/\{lensExhausted && <Continuation/);
  });

  it("requires the server's verdict, the right lens, and no error", () => {
    /**
     * SLICED FORWARD FROM THE DECLARATION, not between two that were assumed to
     * be in order. `const ids =` moved ABOVE `const lensExhausted =`, so the old
     * two-index slice produced an EMPTY STRING — and an empty string matches no
     * regex, so this test was failing while asserting nothing at all. A looser
     * pattern would have turned it green and protected just as little.
     *
     * ANCHORED ON `feedEnded`, which is where the three conditions now live: a
     * second reader (the playlist's "more below" tail) needed the same answer,
     * and two copies of a three-part verdict is two answers waiting to disagree.
     * The assertions are unchanged — only the declaration holding them moved.
     */
    const start = idx.indexOf("const feedEnded =");
    expect(start).toBeGreaterThan(-1);
    const guard = idx.slice(start, start + 400);
    // A failed request tells us nothing about how much is left.
    expect(guard).toMatch(/!isFeedError/);
    // A response is only evidence about the lens it was built for.
    expect(guard).toMatch(/stableFeed\?\.lens === lens/);
    expect(guard).toMatch(/stableFeed\.exhausted === true/);
    // Not For You — it is the destination, and its own end-state is untouched.
    expect(idx).toMatch(/const lensExhausted = lens !== "for_you" && feedEnded;/);
  });

  /**
   * THE OTHER END OF THE SAME QUESTION.
   *
   * The playlist scrolls, so its last row is a statement whether or not anyone
   * meant it to be — a column that simply stops looks exactly like a platform
   * that ran out. The tail must therefore come from the server's verdict too,
   * and must NOT appear on a request that failed or has not landed, which have
   * their own states in the panel.
   */
  it("marks a list that has not ended, from the same verdict", () => {
    const start = idx.indexOf("const moreBelow =");
    expect(start).toBeGreaterThan(-1);
    const guard = idx.slice(start, start + 200);
    expect(guard).toMatch(/!feedEnded/);
    expect(guard).toMatch(/!isFeedError/);
    expect(guard).toMatch(/stableFeed !== undefined/);
    // And the panel renders it, never inferring one from `entries.length`.
    expect(feed).toMatch(/moreBelow\?: boolean/);
    expect(feed).toMatch(/\{moreBelow && !lensExhausted && <MoreBelow/);
  });

  it("keeps the market on screen when a chosen lens ends", () => {
    // "Caught up" takes over the centre, and its copy is only true for For You.
    // `pagedOut` joined the condition when paging arrived: the base query's
    // `exhausted` is computed without `queuedIds`, so it answers a different
    // question and never turns true for a reader who has paged.
    expect(idx).toMatch(/lens === "for_you" && \(pagedOut \|\| stableFeed\?\.exhausted === true\)/);
  });

  /**
   * AND IT IS NOT ENOUGH TO BE FOR YOU.
   *
   * The takeover used to fire on `lens === "for_you"` alone — that is, on the
   * LOCAL queue running out, which any session that outpaced the refill did.
   * Reaching the last row is now an ordinary event that asks for more markets;
   * only the server saying every tier is spent ends anything.
   */
  it("does not end the blend merely because the local queue drained", () => {
    const start = idx.indexOf("const nextMarket =");
    expect(start).toBeGreaterThan(-1);
    const body = idx.slice(start, start + 1600);
    expect(body).toMatch(/stableFeed\?\.exhausted === true/);
    expect(body).toMatch(/refillNow\(\)/);
    // The bare form must be gone: it is the whole bug.
    expect(body).not.toMatch(/if \(lens === "for_you"\) setCaughtUp\(true\)/);
  });

  it("cannot fire twice or restart the playlist twice on repeated clicks", () => {
    // The button is still mounted for the frame after the tap. `selectLens`
    // early-returns on the lens it is already showing, so a second click is a
    // no-op rather than a second request and a second queue reset — and once
    // the lens IS For You the continuation stops rendering at all.
    expect(idx).toMatch(/const selectLens = \(l: Lens\) => \{\s*if \(l === lens\) return;/);
    expect(feed).toMatch(/lens !== "for_you"|lensExhausted/);
  });

  it("cannot serve one lens's markets under another lens's label", () => {
    // The sticky feed and placeholderData both carry a result across a lens
    // change; a response now has to belong to the lens on screen.
    expect(idx).toMatch(/const forThisLens = /);
    expect(idx).toMatch(/forThisLens\(stableFeedRef\.current\) \?\? forThisLens\(data\)/);
  });
});

/**
 * SENSITIVITY MOVED, ITS MEANING DID NOT.
 *
 * "How much matters" sat at the top of Explore's filter menu beside topics and
 * network groups, which is the wrong shelf: those say WHAT to discover, this
 * says how much movement counts as movement. It is a standing preference about
 * the engine, so it now sits with the other things you set once.
 *
 * WHAT IT ACTUALLY AFFECTS, traced rather than assumed: `useFeedSensitivity` in
 * the route → the feed query key → the request → `atSensitivity` narrowing the
 * momentum classification, which feeds the `momentum` score component and the
 * card's headline reason. It does NOT touch the live tape, the right rail, or
 * Positions — nothing in those files reads it. The UI ownership moved; the
 * semantics are untouched.
 */
describe("sensitivity has exactly one source of truth", () => {
  const profile = code("src/components/ProfileMenu.tsx");
  const idx = code("src/routes/index.tsx");

  it("is set from Settings, reading the canonical store", () => {
    expect(profile).toMatch(/<SensitivitySetting \/>/);
    expect(profile).toMatch(/from "@\/lib\/feed-sensitivity"/);
    expect(profile).toMatch(/setFeedSensitivity\(s\)/);
  });

  it("keeps no local copy of the value", () => {
    // A `useState` here would be a second source that drifts from the store the
    // feed query actually reads.
    const block = profile.slice(profile.indexOf("function SensitivitySetting"));
    const body = block.slice(0, block.indexOf("\n}"));
    expect(body).not.toMatch(/useState|useRef/);
    expect(body).toMatch(/useFeedSensitivity\(\)/);
  });

  it("still reaches the feed exactly as before", () => {
    // The route remains the only place that puts it in the request, so the
    // ranking cannot notice where the control lives.
    expect(idx).toMatch(/const sensitivity = useFeedSensitivity\(\)/);
    expect(idx).toMatch(/sensitivity,/);
    // And the route no longer owns a setter it does not render.
    expect(idx).not.toMatch(/setFeedSensitivity/);
  });

  it("names steps rather than thresholds", () => {
    // One row of the bar table sets a percent, a dollar floor and a believer
    // count at once, each scaled by the window — "5%" would be true of one and
    // misleading about the others.
    expect(profile).toMatch(/Everything|Notable|Major only/);
    expect(profile).not.toMatch(/SENSITIVITY_COPY|minPct|minUsd/);
  });
});

/**
 * SWITCHING LENS MUST NOT MOVE THE COLUMN.
 *
 * The playlist used to collapse to a single line of text and push back open a
 * few hundred milliseconds later — the list and everything under it moving twice
 * for one decision. The cause was that an unanswered request and a genuinely
 * empty result are indistinguishable from `entries.length`, so the empty-state
 * sentence rendered for both.
 */
describe("loading holds the shape", () => {
  const feed = code("src/components/FeedListPanel.tsx");
  const idx = code("src/routes/index.tsx");
  const sel = code("src/components/ExploreSelector.tsx");

  it("separates 'no answer yet' from 'the answer is empty'", () => {
    expect(feed).toMatch(/loading\?: boolean/);
    expect(feed).toMatch(/\{loading && upcoming\.length === 0 \? \(\s*<PlaylistSkeleton/);
  });

  it("never shows the empty-state sentence while a request is in flight", () => {
    // The sentence is a VERDICT. It may only appear after one.
    const branch = feed.slice(feed.indexOf("{loading &&"), feed.indexOf("<ol className"));
    expect(branch).toMatch(/upcoming\.length === 0 && !lensExhausted/);
    expect(branch.indexOf("PlaylistSkeleton")).toBeLessThan(branch.indexOf("Nothing matches"));
  });

  it("reserves the row's real geometry, not a spinner", () => {
    expect(feed).toMatch(/function PlaylistSkeleton/);
    // Three bands per row, same as a real one: question, hero, scale.
    expect(feed).toMatch(/SKELETON_LINES/);
    expect(feed).not.toMatch(/Loading…|spinner/i);
  });

  it("keeps the reserved height deterministic across server and client", () => {
    // A random line count would reserve a different height in each render pass,
    // which is the same jump with extra steps.
    expect(feed).not.toMatch(/Math\.random/);
    expect(feed).toMatch(/SKELETON_LINES = \[[\d, ]+\] as const/);
  });

  it("derives loading from the lens-gated feed, so a poll never triggers it", () => {
    // `stableFeed` is already gated to the current lens, so this is exactly
    // "the request for what the control says is still in flight".
    expect(idx).toMatch(/const feedPending = stableFeed === undefined && !isFeedError/);
    expect(idx).toMatch(/loading=\{feedLoading\}/);
  });

  it("never leaves a skeleton as the final answer", () => {
    /**
     * A skeleton is a PROMISE that something is coming, so it must never be
     * terminal. `stableFeed === undefined` alone does not mean "in flight" — it
     * is also what a failed request looks like, and a shimmer that never
     * resolves with nothing to press is the worst of the three outcomes.
     *
     * Three states, three renders: loading gets the placeholder, failure gets a
     * sentence and a retry, empty gets its own words.
     */
    expect(idx).toMatch(/const feedLoading = feedPending && !feedStalled/);
    expect(idx).toMatch(
      /const feedFailed = stableFeed === undefined && \(isFeedError \|\| feedStalled\)/,
    );
    // A request that never settles is not an error, so nothing else would ever
    // replace the placeholder — hence the timer.
    expect(idx).toMatch(/FEED_STALL_MS/);
    expect(idx).toMatch(/<FeedUnavailable onRetry=\{refreshFeed\}/);
    // The centre's skeleton branch is now gated on loading, not on absence.
    expect(idx).toMatch(/activeMarket != null \|\| feedLoading \?/);
  });

  it("does not blame the reader's filter for a failed request", () => {
    // Falling through to "Nothing matches this feed yet. Try widening it" sends
    // someone to change a control that was never the problem.
    expect(feed).toMatch(/failed\?: boolean/);
    const branch = feed.slice(feed.indexOf("{loading &&"), feed.indexOf("<ol className"));
    expect(branch.indexOf("Couldn")).toBeLessThan(branch.indexOf("Nothing matches"));
  });

  it("reserves the selector's narrowing line whether or not it has words", () => {
    // Choosing a topic would otherwise grow the control by a line and push the
    // whole playlist down — a jump caused by the act of narrowing it.
    expect(sel).toMatch(/h-\[15px\][^>]*>\s*\{narrowed \?\? ""\}/);
  });

  it("stops the animation for readers who asked it to", () => {
    expect(feed).toMatch(/motion-reduce:animate-none/);
  });
});
