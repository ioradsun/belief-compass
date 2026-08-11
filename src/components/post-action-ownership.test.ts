import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const path = (p: string) => join(process.cwd(), p);
const raw = (p: string) => readFileSync(path(p), "utf8");
/** Source with comments stripped — a decision, not a description of one. */
const code = (p: string) =>
  raw(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

/**
 * DEFINITION-OF-DONE #1, ASSERTED RATHER THAN ANNOUNCED.
 *
 * A resolver that exists but is not reached is not an owner — it is architecture
 * nobody uses, and it looks identical in a diff. Every test here is a way the
 * ownership could silently revert: a second component quietly deciding whether
 * Challenge appears, a route inventing its own exit, a fallback branch that
 * still renders a headline when the resolver is bypassed.
 *
 * These are source assertions on purpose. The behaviour is covered by
 * `post-action.test.ts` (69 cases over the copy matrix); what cannot be covered
 * by calling a pure function is whether anybody CALLS it, and that is exactly
 * the thing that regressed for four components before this PR.
 */
describe("resolvePostAction owns all three closing flows", () => {
  const deck = () => code("src/components/MarketDeck.tsx");
  const route = () => code("src/routes/index.tsx");
  const container = () => code("src/components/PostAction.tsx");

  it("routes every confirmed buy through the resolver, on both surfaces", () => {
    /**
     * DESKTOP AND MOBILE, because they were two closing screens for one action.
     * Mobile rendered the reveal directly — choosing its own navigation and
     * offering no Challenge at all — so the same buy ended differently
     * depending on the width of the window, in ways nobody had decided.
     */
    for (const f of ["src/components/MarketDeck.tsx", "src/components/MobileGame.tsx"]) {
      const c = code(f);
      const buy = c.slice(c.indexOf("if (trade.isSuccess"));
      expect(buy, f).toMatch(/<PostAction\b/);
      expect(buy, f).toMatch(/kind="buy"/);
    }
  });

  it("routes every confirmed sell through the resolver", () => {
    const c = deck();
    expect(c).toMatch(/if \(soldSide != null\)/);
    const sell = c.slice(c.indexOf("if (soldSide != null)"));
    expect(sell).toMatch(/kind="sell"/);
  });

  it("routes every confirmed market creation through the resolver", () => {
    expect(route()).toMatch(/kind="create"/);
  });

  it("renders one screen, from one call", () => {
    // Exactly one place calls the resolver. A second call site is a second
    // owner, whatever it is named.
    const callers = ["src/components/PostAction.tsx"];
    for (const f of [
      "src/components/MarketDeck.tsx",
      "src/components/MobileGame.tsx",
      "src/routes/index.tsx",
      "src/components/PostActionScreen.tsx",
    ])
      expect(code(f)).not.toMatch(/resolvePostAction\(/);
    for (const f of callers) expect(code(f)).toMatch(/resolvePostAction\(/);
  });

  /**
   * THE LOAD-BEARING TEST. If the resolver call were removed, would anything
   * still render? The container has no fallback: `experience` comes from
   * `resolvePostAction` and is passed straight to the screen, which reads only
   * from it. There is no default headline anywhere to fall back to.
   */
  it("has no path that renders a closing screen without the resolver", () => {
    const c = container();
    expect(c).toMatch(/const experience = resolvePostAction\(/);
    expect(c).toMatch(/experience=\{experience\}/);
    // No literal copy in the container or the screen — every word comes from
    // the resolver, so bypassing it produces nothing rather than something worse.
    for (const banned of [
      "You showed up",
      "Your market is live",
      "You're out",
      "That's a real call",
    ])
      for (const f of ["src/components/PostAction.tsx", "src/components/PostActionScreen.tsx"])
        expect(code(f)).not.toContain(banned);
  });
});

describe("the competing owners are gone, not merely bypassed", () => {
  it("deleted LaunchRail rather than leaving it beside the new screen", () => {
    // It rendered a closing screen for BOTH a publish and a buy, so a confirmed
    // buy produced two at once: the rail deciding relay eligibility while the
    // centre's reveal decided navigation.
    expect(existsSync(path("src/components/LaunchRail.tsx"))).toBe(false);
  });

  it("deleted KeepChainMoving, which decided relay eligibility on its own", () => {
    // It read reach itself and hid the offer on its own arithmetic — a second
    // answer to "can this person Challenge", one the write path never saw.
    expect(existsSync(path("src/components/KeepChainMoving.tsx"))).toBe(false);
  });

  it("leaves ConvictionReveal drawing the story and choosing no destination", () => {
    const c = code("src/components/ConvictionReveal.tsx");
    // The handlers survive for standalone contexts; what matters is that the
    // post-buy surface passes neither, so no CTA renders there.
    expect(c).toMatch(/onNext\?: \(\) => void/);
    expect(c).toMatch(/\{onNext && \(/);
    const deck = code("src/components/MarketDeck.tsx");
    expect(deck).toMatch(/reveal=\{<ConvictionReveal story=\{reveal\} side=\{side\} \/>\}/);
    // No navigation handed to it from the deck — that is the resolver's job.
    expect(deck).not.toMatch(/<ConvictionReveal[\s\S]{0,200}onNext=/);
  });

  it("leaves the route executing a CTA rather than inventing one", () => {
    const c = code("src/routes/index.tsx");
    // The buy branch that used to open a second closing screen is gone.
    expect(c).not.toMatch(/kind="backed"/);
    expect(c).not.toMatch(/backedId/);
    expect(c).not.toMatch(/<LaunchRail/);
  });
});

describe("the invariants the closing screen must never break", () => {
  it("never lets a sell leave the market", () => {
    // `SellInput` carries no `nextIncoming`, so the buy hierarchy is not merely
    // unused for a sell — it cannot be expressed. Proved in the domain suite;
    // asserted here so nobody adds the field back for convenience.
    const c = code("src/domain/post-action.ts");
    const sellCommon = c.slice(
      c.indexOf("interface SellCommon"),
      c.indexOf("export type SellInput"),
    );
    expect(sellCommon).not.toMatch(/nextIncoming/);
  });

  it("never renders a disabled social CTA", () => {
    const c = code("src/components/PostActionScreen.tsx");
    // The only `disabled` is the in-flight primary. Nothing is greyed out to
    // represent an offer that cannot be made — the resolver omits those.
    expect([...c.matchAll(/disabled=/g)]).toHaveLength(1);
    expect(c).toMatch(/disabled=\{pending\}/);
  });

  it("never turns a failed audience read into an empty-network claim", () => {
    const c = code("src/lib/post-action.adapter.ts");
    // `failed` survives as `failed` all the way to the resolver. The moment this
    // maps to `none`, a blocked read becomes "nobody qualifies".
    expect(c).toMatch(/case "failed":\s*return \{ status: "failed"/);
    expect(c).not.toMatch(/case "failed":\s*return \{ status: "none"/);
  });

  it("proves a buy's role from the confirmed action, not from a balance", () => {
    // A confirmed buy proves the position. The balance only says how much.
    const c = code("src/lib/post-action.adapter.ts");
    expect(c).toMatch(/function buyRole\(authored: boolean\)/);
    expect(c).toMatch(/role: buyRole\(act\.authored\)/);
  });

  it("surfaces a refused Challenge write instead of restoring the same CTA", () => {
    /**
     * The press used to produce nothing: the button reappeared unchanged, at the
     * emotional peak of the product, explaining nothing. A refusal now rides
     * ALONGSIDE the experience rather than re-deciding it, because
     * `put_on_table` rolls back whole and nothing about this market changed.
     */
    const c = code("src/components/PostAction.tsx");
    expect(c).toMatch(/setStatus\(\{ state: "failed"/);
    expect(c).toMatch(/refusalIsCanonical\(res\.reason\)/);
    // A null result is a network failure, not a silent success.
    expect(c).toMatch(/if \(res == null\)/);
    // Re-read on EVERY outcome, so a lost race can explain itself canonically.
    expect(c).toMatch(/onSettled/);
    const screen = code("src/components/PostActionScreen.tsx");
    expect(screen).toMatch(/status\.state === "failed"/);
    expect(screen).toMatch(/WRITE_RETRY_LABEL/);
    // The refusal is NOT a field on the experience — a momentary network error
    // must never look like a permanent property of somebody's position.
    const domain = code("src/domain/post-action.ts");
    const shape = domain.slice(
      domain.indexOf("interface PostActionExperience"),
      domain.indexOf("function assertNever"),
    );
    for (const leak of ["status", "error", "refusal", "retry"]) expect(shape).not.toContain(leak);
  });

  it("keeps the adapter gathering and the resolver deciding", () => {
    const c = code("src/lib/post-action.adapter.ts");
    // No copy, no CTA, no module choice. The moment the adapter picks a
    // headline, four owners become two under new names.
    for (const decision of ["headline", "challengeModule", "copyCategory", "primary:"])
      expect(c).not.toContain(decision);
  });

  it("never fabricates holdings on ANY action to satisfy a type", () => {
    /**
     * `{ yes: 0, no: 0 }` is the claim "they are out". Guessing it is how a
     * partial seller gets told they left, which is the single worst sentence
     * this screen can produce.
     */
    const c = code("src/hooks/usePositionShift.ts");
    expect(c).toMatch(/after: active && settled \? asHoldings\(bal\.yes, bal\.no\) : null/);
    const adapter = code("src/lib/post-action.adapter.ts");
    const sell = adapter.slice(
      adapter.indexOf('if (kind === "sell")'),
      adapter.indexOf("const after: Holdings"),
    );
    expect(sell).not.toMatch(/act\.after \?\? \{ yes: 0, no: 0 \}/);
  });
});
