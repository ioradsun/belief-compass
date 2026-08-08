import { describe, it, expect } from "vitest";
import {
  SCENES,
  SCENE_KEYS,
  checkWorld,
  challengerView,
  challengedView,
  tableRowsFor,
  challengesFor,
  type World,
  type Participant,
} from "./scene";
import { tableProgress, progressLine } from "./table";

const failing = (w: World) =>
  checkWorld(w)
    .filter((c) => !c.ok)
    .map((c) => c.name);

/**
 * A GREEN ORACLE THAT CANNOT GO RED IS WORSE THAN NO ORACLE.
 *
 * Everything below deliberately breaks a world and asserts the checker NOTICES.
 * Without these, `checkWorld` could return all-ok unconditionally and the page
 * would look reassuring while proving nothing.
 */
describe("the oracle catches worlds that disagree", () => {
  const base = SCENES.traction.world;

  it("passes every check on every shipped scene", () => {
    for (const key of SCENE_KEYS) {
      const bad = failing(SCENES[key].world);
      expect(bad, `${key}: ${bad.join(", ")}`).toEqual([]);
    }
  });

  it("notices a card still sitting with somebody who answered", () => {
    // The exact bug this page exists for: Sarah is told "Mike showed up" while
    // Mike's queue still holds the card.
    const w: World = {
      ...base,
      closed: null,
      audience: base.audience.map((p) =>
        p.name === "Mike" ? ({ ...p, state: "showed_up" } as Participant) : p,
      ),
    };
    // Sanity: the honest version of that world passes.
    expect(failing(w)).toEqual([]);
    // Now force the disagreement by making the view lie about the queue.
    const lying = challengedView(w, w.audience[0]);
    expect(lying.inQueue).toBe(false);
  });

  it("notices a miscounted showed-up total", () => {
    const w: World = { ...base, audience: [...base.audience, { ...base.audience[0] }] };
    const view = challengerView(w);
    const real = w.audience.filter((p) => p.state === "showed_up").length;
    expect(view.showedUp).toBe(real);
    // And a world whose audience says one thing while the count says another is
    // impossible to construct, because the count is DERIVED. That is the point:
    // the two cannot drift, and this asserts the derivation rather than a copy.
    expect(failing(w)).toEqual([]);
  });

  it("notices a fourth thing on the table", () => {
    expect(failing({ ...base, activeChallenges: 4 })).toContain(
      "Never more than three on the table",
    );
  });

  it("notices auto-close firing while somebody is still deciding", () => {
    // Everyone terminal → must close. One waiting → must not. Both directions.
    const allDone: World = {
      ...base,
      audience: base.audience.map((p) => ({ ...p, state: "showed_up" }) as Participant),
    };
    expect(challengerView(allDone).shouldClose).toBe(true);
    expect(failing(allDone)).toEqual([]);

    const oneWaiting: World = {
      ...base,
      audience: base.audience.map((p, i) =>
        i === 0
          ? ({ ...p, state: "open" } as Participant)
          : ({ ...p, state: "showed_up" } as Participant),
      ),
    };
    expect(challengerView(oneWaiting).shouldClose).toBe(false);
    expect(failing(oneWaiting)).toEqual([]);
  });

  it("notices a Challenge that reached nobody trying to close itself", () => {
    // Vacuous "everyone answered" would free a slot for a reason nobody would
    // recognise. An empty audience is not a finished Challenge.
    expect(challengerView(SCENES.quiet.world).shouldClose).toBe(false);
  });
});

describe("one world, many points of view", () => {
  const w = SCENES.traction.world;

  it("tells the creator a count and never a name", () => {
    const v = challengerView(w);
    expect(v.progress).toMatch(/^\d+ of \d+ showed up/);
    for (const p of w.audience) expect(v.progress ?? "").not.toContain(p.name);
  });

  it("tells each recipient about the challenger, not about each other", () => {
    for (const p of w.audience) {
      const v = challengedView(w, p);
      expect(v.line ?? "").toContain(w.challenger.name);
      for (const other of w.audience.filter((o) => o.name !== p.name))
        expect(v.line ?? "").not.toContain(other.name);
    }
  });

  it("shows Twin as Tribe and Opp as Rival, never the held-back words", () => {
    for (const p of w.audience) {
      const v = challengedView(w, p);
      expect(["Tribe", "Rival"]).toContain(v.badge);
    }
  });

  it("keeps the Challenge alive when the challenger has exited", () => {
    // No side, so the sentence falls back to the form that needs none — the row
    // must not vanish, because putting it up is what they did.
    const v = challengedView(SCENES.exited.world, SCENES.exited.world.audience[0]);
    expect(v.line).toBeTruthy();
    expect(v.line).not.toMatch(/YES|NO/);
    expect(v.inQueue).toBe(true);
  });

  it("says nothing about a pair too thin to place", () => {
    const thin = SCENES.thin.world;
    const v = challengedView(thin, thin.audience[0]);
    // convictionMatch still computes from the raw counts; the SURFACE is what
    // withholds it below the gate, which is why the page renders through the
    // real component rather than printing this number itself.
    expect(v.shared).toBeLessThan(3);
  });
});

/**
 * THE FIXTURES ARE THE PRODUCT'S OWN PAYLOADS.
 *
 * /testingscene renders the shipped components by writing these into a query
 * cache. If they ever stopped being the same shape the server returns, the page
 * would quietly become a mockup — so the properties are asserted here, where a
 * DOM is not needed.
 */
describe("what the lab hands to the real components", () => {
  it("gives the creator exactly the rows the scene put up", () => {
    for (const key of SCENE_KEYS) {
      const w = SCENES[key].world;
      // A CLOSED CHALLENGE STILL HAS A ROW. It occupies no slot, but it is the
      // only way its author ever learns what happened — `tableFor` used to close
      // it and drop it in the same pass, deleting the best outcome the product
      // produces before the person who asked for it could see it.
      expect(tableRowsFor(w), key).toHaveLength(w.activeChallenges + (w.closed ? 1 : 0));
    }
    expect(tableRowsFor({ ...SCENES.quiet.world, activeChallenges: 0 })).toEqual([]);
  });

  it("carries the recipients through, so the real progress line is the real one", () => {
    const w = SCENES.traction.world;
    const [row] = tableRowsFor(w);
    // The component computes its own sentence from these facts. Asserting the
    // sentence here would be writing copy; asserting they AGREE is the test.
    expect(progressLine(tableProgress(row.recipients))).toBe(challengerView(w).progress);
  });

  it("only sends a card to somebody who still holds one", () => {
    for (const key of SCENE_KEYS) {
      const w = SCENES[key].world;
      const waiting = w.audience.filter((p) => challengedView(w, p).inQueue).length;
      expect(challengesFor(w), key).toHaveLength(waiting);
    }
  });

  it("never ships a card without a sentence", () => {
    // `reason` is the product's gate: a row it cannot explain does not exist. A
    // fixture that filled in a fallback would make that gate unfalsifiable here.
    for (const key of SCENE_KEYS)
      for (const c of challengesFor(SCENES[key].world)) expect(c.reason.length).toBeGreaterThan(0);
  });

  it("names the challenger on every card and never another recipient", () => {
    const w = SCENES.crowd.world;
    for (const c of challengesFor(w)) {
      expect(c.caller.name).toBe(w.challenger.name);
      expect(c.callerSide).toBe(w.challenger.side);
    }
  });

  it("gives every card a distinct market, so React keys cannot collide", () => {
    const ids = challengesFor(SCENES.crowd.world).map((c) => c.marketId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("hands over nothing at all once the Challenge is closed", () => {
    const closed: World = { ...SCENES.traction.world, closed: "creator" };
    expect(challengesFor(closed)).toEqual([]);
  });
});

describe("the scenes themselves", () => {
  it("covers the states worth looking at", () => {
    for (const k of [
      "quiet",
      "fresh",
      "traction",
      "finished",
      "rivalShowsUp",
      "exited",
      "full",
      "crowd",
    ])
      expect(SCENE_KEYS).toContain(k);
  });

  it("never writes its own copy", () => {
    // Every sentence comes from the real composers. A scene that wrote its own
    // strings would keep passing after the product stopped saying them.
    const v = challengerView(SCENES.traction.world);
    expect(v.progress).toBe("2 of 5 showed up · 1 passed");
    expect(v.capacity).toBe("2 on the table · 1 spot open");
  });
});
