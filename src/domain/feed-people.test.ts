import { describe, expect, it } from "vitest";
import { namePerson, knownFirst, type NamedPerson, type ProfileLike } from "./feed-people";

type Label = "twin" | "tribe" | "opp";

const alias = (w: string) => `anon-${w.slice(0, 4)}`;
const profiles = (o: Record<string, ProfileLike> = {}) => new Map(Object.entries(o));
const labels = (o: Record<string, Label> = {}) => new Map(Object.entries(o));

describe("namePerson", () => {
  it("prefers a display name over the alias fallback", () => {
    const p = namePerson("0xaaa", profiles({ "0xaaa": { displayName: "Sarah" } }), labels(), alias);
    expect(p.name).toBe("Sarah");
  });

  it("falls back to the alias when there is no profile", () => {
    expect(namePerson("0xaaa", profiles(), labels(), alias).name).toBe("anon-0xaa");
  });

  it("falls back when a profile exists but its name is null", () => {
    // A present-but-empty profile must not produce a nameless face.
    const p = namePerson("0xaaa", profiles({ "0xaaa": { displayName: null } }), labels(), alias);
    expect(p.name).toBe("anon-0xaa");
  });

  it("carries the relationship for this reader, and null when there is none", () => {
    const known = labels({ "0xaaa": "twin" });
    expect(namePerson("0xaaa", profiles(), known, alias).relationship).toBe("twin");
    expect(namePerson("0xbbb", profiles(), known, alias).relationship).toBeNull();
  });

  it("mutates neither map it is handed", () => {
    const prof = profiles({ "0xaaa": { displayName: "Sarah" } });
    const lab = labels({ "0xaaa": "twin" });
    namePerson("0xzzz", prof, lab, alias);
    expect(prof.size).toBe(1);
    expect(lab.size).toBe(1);
  });
});

/**
 * THE SAME GUARANTEE AS viewerNetwork, one layer out: a person is tagged only
 * from the map belonging to the reader being served. This used to be written by
 * hand at three separate sites, which is three chances to get it wrong.
 */
describe("a person is tagged only for the reader being served", () => {
  it("names the same wallet differently for two readers", () => {
    const w = "0xshared";
    const forAlice = namePerson(w, profiles(), labels({ [w]: "twin" }), alias);
    const forBob = namePerson(w, profiles(), labels({ [w]: "opp" }), alias);
    expect(forAlice.relationship).toBe("twin");
    expect(forBob.relationship).toBe("opp");
  });

  it("returns a fresh object, so one reader's row cannot become another's", () => {
    const lab = labels({ "0xaaa": "twin" });
    const a = namePerson("0xaaa", profiles(), lab, alias);
    const b = namePerson("0xaaa", profiles(), lab, alias);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe("knownFirst", () => {
  const p = (wallet: string, relationship: Label | null): NamedPerson<Label> => ({
    wallet,
    name: wallet,
    avatarUrl: null,
    relationship,
  });

  it("lifts familiar faces to the front", () => {
    const out = knownFirst([p("a", null), p("b", "twin"), p("c", null)]);
    expect(out.map((x) => x.wallet)).toEqual(["b", "a", "c"]);
  });

  it("keeps the incoming order within each group — a stable partition, not a sort", () => {
    // The order handed in means something: a burst arrives sorted by commitment.
    const out = knownFirst([p("a", null), p("b", "twin"), p("c", null), p("d", "opp")]);
    expect(out.map((x) => x.wallet)).toEqual(["b", "d", "a", "c"]);
  });

  it("is a no-op in shape when nobody is known", () => {
    const input = [p("a", null), p("b", null)];
    expect(knownFirst(input).map((x) => x.wallet)).toEqual(["a", "b"]);
  });

  it("does not mutate the array it was given", () => {
    const input = [p("a", null), p("b", "twin")];
    knownFirst(input);
    expect(input.map((x) => x.wallet)).toEqual(["a", "b"]);
  });
});
