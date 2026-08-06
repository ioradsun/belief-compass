import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LENSES, LENS_LABELS } from "@/domain/feed/lens";

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

describe("the lens control", () => {
  const feed = code("src/components/FeedListPanel.tsx");

  it("offers every lens the domain defines, and no hand-written list", () => {
    expect(feed).toMatch(/LENSES\.map/);
    expect(feed).toMatch(/LENS_LABELS\[l\]/);
    expect(LENSES).toEqual(["for_you", "moving", "capital", "participants", "fresh"]);
  });

  it("names what it ranks, in words needing no interpretation", () => {
    // "Most Believers" asked the reader a question instead of answering one:
    // believers on YES, on NO, holding now, or everyone who ever traded? The
    // lens ranks people in the market irrespective of side.
    expect(LENS_LABELS.participants).toBe("Most Participants");
    expect(Object.values(LENS_LABELS).join(" ")).not.toMatch(/Believer/i);
  });

  it("reserves its own height so choosing a lens cannot move the list", () => {
    expect(feed).toMatch(/h-\[26px\]/);
  });

  it("did not delete the filter grammar it sits above", () => {
    // Thin lens/topic combinations are evidence, not yet a decision to remove a
    // capability. The menu stays until that call is made deliberately.
    expect(feed).toMatch(/<FeedFilterMenu/);
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
    expect(feed).toMatch(/Continue with For You/);
  });

  it("renders only on a real verdict, never inferred from an empty list", () => {
    // `entries.length === 0` means the client consumed its batch, which is not
    // the same as the lens running out — the feed pages implicitly.
    expect(feed).toMatch(/lensExhausted\?: boolean/);
    expect(feed).toMatch(/\{lensExhausted && <Continuation/);
  });

  it("requires the server's verdict, the right lens, and no error", () => {
    const guard = idx.slice(idx.indexOf("const lensExhausted ="), idx.indexOf("const ids ="));
    // Not For You — it is the destination, and its own end-state is untouched.
    expect(guard).toMatch(/lens !== "for_you"/);
    // A failed request tells us nothing about how much is left.
    expect(guard).toMatch(/!isFeedError/);
    // A response is only evidence about the lens it was built for.
    expect(guard).toMatch(/stableFeed\?\.lens === lens/);
    expect(guard).toMatch(/stableFeed\.exhausted === true/);
  });

  it("keeps the market on screen when a chosen lens ends", () => {
    // "Caught up" takes over the centre, and its copy is only true for For You.
    expect(idx).toMatch(/if \(lens === "for_you"\) setCaughtUp\(true\)/);
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
