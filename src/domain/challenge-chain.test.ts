import { describe, it, expect } from "vitest";
import {
  CHAIN_BANNED_WORDS,
  PARTIAL_NOTE,
  TRUNCATED_NOTE,
  branchLines,
  broughtYouIn,
  chainVocabulary,
  depthLine,
  opportunitiesLine,
  routeNames,
  startedBy,
  wholeChainLines,
  type ChainLink,
  type ChallengeChainProjection,
  type UpstreamPath,
  type ViewerBranch,
  type WholeChain,
} from "./challenge-chain";
import type { CardPerson, CardResponder } from "./challenge-card";

const person = (name: string): CardPerson => ({
  wallet: `0x${name.toLowerCase()}`,
  name,
  avatarUrl: null,
});
const link = (name: string, side: "YES" | "NO" | null = "YES"): ChainLink => ({
  person: person(name),
  side,
});
const responder = (name: string): CardResponder => ({ ...person(name), side: "NO", atMs: 1 });

const upstream = (over: Partial<UpstreamPath> = {}): UpstreamPath => ({
  path: [link("Maya"), link("Sundeep")],
  depth: 3,
  truncated: false,
  ...over,
});

const branch = (over: Partial<ViewerBranch> = {}): ViewerBranch => ({
  reached: 9,
  showedUp: 2,
  passed: 0,
  waiting: 7,
  responders: [responder("Casey"), responder("Nia")],
  relayers: [person("Casey")],
  ...over,
});

const whole = (over: Partial<WholeChain> = {}): WholeChain => ({
  uniqueResponders: 18,
  uniqueRelayers: 5,
  recipientOpportunities: 42,
  partial: false,
  ...over,
});

const chain = (over: Partial<ChallengeChainProjection> = {}): ChallengeChainProjection => ({
  marketId: 1,
  question: "Will AI replace most software engineers?",
  upstream: upstream(),
  viewerBranch: branch(),
  wholeChain: whole(),
  ...over,
});

/* ── The invariant the whole module exists for ─────────────────────────────── */

describe("unknown ancestry is not a root", () => {
  it("names a root only when the whole route was proved", () => {
    expect(startedBy(upstream({ truncated: false }))).toBe("Maya");
  });

  /**
   * THE LIE THIS PREVENTS. A truncated walk knows who the EARLIEST VERIFIED link
   * is and nothing about what came before them. Reporting that person as the
   * origin would permanently credit the wrong human on the one screen whose
   * entire subject is who started what.
   */
  it("refuses to name a root when the walk could not prove one", () => {
    expect(startedBy(upstream({ truncated: true }))).toBeNull();
  });

  it("marks the route with an ellipsis rather than beginning at a guess", () => {
    expect(routeNames(upstream({ truncated: true }))).toEqual(["…", "Maya", "Sundeep", "You"]);
    expect(routeNames(upstream({ truncated: false }))).toEqual(["Maya", "Sundeep", "You"]);
  });

  it("still names the direct parent, which is always provable", () => {
    // Truncation is about the far end. Who brought you in is a row addressed to
    // you, and no walk is needed to know it.
    expect(broughtYouIn(upstream({ truncated: true }))).toBe("Sundeep brought you in");
  });

  it("says the boundary out loud rather than trailing off silently", () => {
    const said = chainVocabulary(chain({ upstream: upstream({ truncated: true }) }));
    expect(said).toContain(TRUNCATED_NOTE);
    expect(said).not.toMatch(/Started by/);
  });

  it("treats an aggregate it could not finish as a floor", () => {
    expect(chainVocabulary(chain({ wholeChain: whole({ partial: true }) }))).toContain(
      PARTIAL_NOTE,
    );
  });
});

/* ── The privacy boundary, enforced by the shape ───────────────────────────── */

describe("the projection cannot carry what the view must not show", () => {
  /**
   * STRUCTURAL, NOT EDITORIAL. A component cannot render a name the type has
   * nowhere to put, and a future reader cannot be asked to fetch one "just for
   * the aggregate".
   */
  it("has no field for anybody outside the viewer's own branch", () => {
    const c = chain();
    const branchKeys = Object.keys(c.viewerBranch ?? {});
    // Named people appear in exactly two places, and both are the viewer's own.
    expect(branchKeys.filter((k) => Array.isArray((c.viewerBranch as never)[k]))).toEqual([
      "responders",
      "relayers",
    ]);
    // The whole chain is numbers only.
    for (const v of Object.values(c.wholeChain)) expect(typeof v).not.toBe("object");
  });

  it("never names a passer, only counts them", () => {
    const b = branch({ passed: 3, waiting: 4, showedUp: 2 });
    expect(branchLines(b)).toContain("3 passed");
    // Passers are absent from `responders` by construction — not anonymised.
    expect(b.responders.every((r) => r.name !== "")).toBe(true);
    expect(chainVocabulary(chain({ viewerBranch: b }))).not.toMatch(/passed on/);
  });

  it("counts waiting people rather than listing them", () => {
    expect(branchLines(branch({ waiting: 7 }))).toContain("7 still deciding");
  });

  it("shows no passed count until somebody has actually passed", () => {
    // A standing "0 passed" is a rejection counter the reader is invited to watch.
    expect(branchLines(branch({ passed: 0 })).join(" ")).not.toMatch(/passed/);
  });
});

/* ── Counting, which is where a chain view most easily lies ────────────────── */

describe("three counts, three meanings", () => {
  it("reports responders and relayers as people", () => {
    expect(wholeChainLines(whole())).toEqual(["18 people showed up", "5 people kept it moving"]);
  });

  it("singularises one person correctly in both", () => {
    expect(wholeChainLines(whole({ uniqueResponders: 1, uniqueRelayers: 1 }))).toEqual([
      "1 person showed up",
      "1 person kept it moving",
    ]);
  });

  /**
   * THE LINE THAT INVITES A LIE. Once a chain forks the same person can hold two
   * opportunities, so 42 rows is not 42 humans. It says what it is, and it is
   * deliberately a separate function so a caller renders it secondary on purpose.
   */
  it("never calls recipient opportunities people", () => {
    const line = opportunitiesLine(whole({ recipientOpportunities: 42 }));
    expect(line).toBe("42 recipient opportunities were created");
    expect(line).not.toMatch(/people|joined/);
    expect(wholeChainLines(whole()).join(" ")).not.toContain("42");
  });

  it("says nothing at all when there are no opportunities to report", () => {
    expect(opportunitiesLine(whole({ recipientOpportunities: 0 }))).toBeNull();
  });

  it("keeps the branch reach as a fraction rather than a headcount", () => {
    expect(branchLines(branch({ reached: 9, showedUp: 2 }))[0]).toBe("2 of 9 showed up");
  });
});

/* ── Depth is secondary and derived ────────────────────────────────────────── */

describe("depth is a footnote, not the headline", () => {
  it("says how deep once there is anything to say", () => {
    expect(depthLine(upstream({ depth: 3 }))).toBe("3 links deep");
  });

  /**
   * FOUND BY RENDERING IT. Beside a route beginning with an ellipsis, a bare
   * "3 links deep" counts something the walk could not finish counting. Same
   * rule as everywhere else: an unfinished read reports a floor and says so.
   */
  it("reports depth as a floor when the route was truncated", () => {
    expect(depthLine(upstream({ depth: 3, truncated: true }))).toBe("at least 3 links deep");
  });

  it("stays quiet for a direct call", () => {
    // "1 link deep" is a sentence nobody needs about being asked by one person.
    expect(depthLine(upstream({ path: [link("Maya")], depth: 1 }))).toBeNull();
  });
});

/* ── Vocabulary ────────────────────────────────────────────────────────────── */

describe("words this view must never use", () => {
  const shapes = (): ChallengeChainProjection[] => {
    const out: ChallengeChainProjection[] = [];
    for (const u of [
      upstream(),
      upstream({ truncated: true }),
      upstream({ path: [link("Maya")], depth: 1 }),
      upstream({ path: [], depth: 0, truncated: true }),
    ])
      for (const b of [
        null,
        branch(),
        branch({ passed: 3, waiting: 0, showedUp: 6, relayers: [] }),
        branch({ reached: 0, showedUp: 0, waiting: 0, responders: [], relayers: [] }),
      ])
        for (const w of [
          whole(),
          whole({ partial: true }),
          whole({ uniqueResponders: 0, uniqueRelayers: 0, recipientOpportunities: 0 }),
        ])
          out.push(chain({ upstream: u, viewerBranch: b, wholeChain: w }));
    return out;
  };

  it("never says any of them, in any shape the view can take", () => {
    for (const c of shapes()) {
      const said = chainVocabulary(c).toLowerCase();
      for (const banned of CHAIN_BANNED_WORDS)
        expect(said, `${banned} :: ${said}`).not.toContain(banned);
    }
  });

  it("never reports a root it did not prove, in any shape", () => {
    for (const c of shapes()) if (c.upstream.truncated) expect(startedBy(c.upstream)).toBeNull();
  });

  it("never attributes a count of rows to a count of humans", () => {
    for (const c of shapes()) {
      const n = c.wholeChain.recipientOpportunities;
      if (n <= 0) continue;
      const humanLines = wholeChainLines(c.wholeChain).join(" ");
      expect(humanLines).not.toContain(String(n));
    }
  });
});
