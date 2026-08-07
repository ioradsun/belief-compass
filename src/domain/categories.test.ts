import { describe, it, expect } from "vitest";
import {
  CATEGORY_SLUGS,
  CATEGORY_TO_DOMAIN,
  CATEGORY_LABEL,
  CREATOR_CATEGORIES,
  DOMAINS,
  categoryToDomain,
  categoryLabel,
  normalizeCategory,
  type CategorySlug,
} from "./categories";

/** The vocabulary the POV importer writes, observed in production. */
const POV_SLUGS = ["sports", "crypto", "culture", "politics", "other", "ai", "defi"];

/** The title-case list the AI reviewer and the creation path used to write. */
const LEGACY_TITLES = [
  "Relationships",
  "Money",
  "Technology",
  "Society",
  "Human Nature",
  "Politics",
  "Morality",
  "Health",
  "Entertainment",
  "Other",
];

describe("one vocabulary, and everything already written lands in it", () => {
  it("reads every slug POV writes", () => {
    for (const slug of POV_SLUGS) {
      expect(normalizeCategory(slug), slug).not.toBeNull();
    }
  });

  it("reads every name the old creation path wrote", () => {
    // This is the regression. `categoryToDomain` used to know only POV's slugs,
    // so a market created by this app resolved to no domain at all — measured
    // as 336 of 2,789 unresolved, one of them a market we created ourselves.
    for (const title of LEGACY_TITLES) {
      expect(normalizeCategory(title), title).not.toBeNull();
    }
  });

  it("places the one production market that was stranded", () => {
    expect(categoryToDomain("Society")).toBe("Society");
  });

  it("reaches the same slug from the slug, the label and the legacy title", () => {
    expect(normalizeCategory("human-nature")).toBe("human-nature");
    expect(normalizeCategory("Human Nature")).toBe("human-nature");
    expect(normalizeCategory("HUMAN NATURE")).toBe("human-nature");
    expect(normalizeCategory("DeFi")).toBe("defi");
  });

  it("still refuses what it does not know, rather than guessing a spoke", () => {
    for (const junk of ["", "  ", "quandle", "zorbex-nature", null, undefined]) {
      expect(normalizeCategory(junk)).toBeNull();
      expect(categoryToDomain(junk)).toBeNull();
    }
  });
});

describe("the map is total, so a new slug cannot go quietly unmapped", () => {
  it("gives every slug a domain entry and a label", () => {
    for (const slug of CATEGORY_SLUGS) {
      expect(Object.prototype.hasOwnProperty.call(CATEGORY_TO_DOMAIN, slug), slug).toBe(true);
      expect(CATEGORY_LABEL[slug], slug).toBeTruthy();
    }
  });

  it("maps every slug except `other` onto a real DNA spoke", () => {
    for (const slug of CATEGORY_SLUGS) {
      const domain = CATEGORY_TO_DOMAIN[slug];
      if (slug === "other") {
        // Honest null: a market nobody could place must widen no spoke.
        expect(domain).toBeNull();
      } else {
        expect(DOMAINS).toContain(domain!);
      }
    }
  });

  it("leaves no spoke unreachable — every domain has at least one slug", () => {
    const reached = new Set(Object.values(CATEGORY_TO_DOMAIN).filter(Boolean));
    for (const d of DOMAINS) expect([...reached], d).toContain(d);
  });

  it("round-trips every label back to its own slug", () => {
    for (const slug of CATEGORY_SLUGS) {
      expect(normalizeCategory(CATEGORY_LABEL[slug]), slug).toBe(slug);
    }
  });
});

describe("what a creator is offered", () => {
  it("offers only slugs the rest of the system reads", () => {
    for (const slug of CREATOR_CATEGORIES) {
      expect(CATEGORY_SLUGS as readonly string[]).toContain(slug);
    }
  });

  it("covers every spoke, so no belief is unclassifiable at creation", () => {
    const reached = new Set(CREATOR_CATEGORIES.map((s) => CATEGORY_TO_DOMAIN[s]).filter(Boolean));
    for (const d of DOMAINS) expect([...reached], d).toContain(d);
  });

  it("never offers two choices that mean the same spoke", () => {
    // "Crypto" and "Money" both resolve to Money. Offering both would ask a
    // creator to settle an ambiguity that exists only because POV got here
    // first; the picker resolves it for them.
    const domains = CREATOR_CATEGORIES.map((s) => CATEGORY_TO_DOMAIN[s]).filter(
      Boolean,
    ) as string[];
    expect(new Set(domains).size).toBe(domains.length);
  });

  it("ends on `other`, so the escape hatch is last rather than easiest", () => {
    expect(CREATOR_CATEGORIES[CREATOR_CATEGORIES.length - 1]).toBe("other");
  });

  it("has a label for every offered slug", () => {
    for (const slug of CREATOR_CATEGORIES) expect(categoryLabel(slug)).toBeTruthy();
  });
});

describe("labels are what people see, slugs are what we store", () => {
  it("never shows a raw slug", () => {
    for (const slug of CATEGORY_SLUGS) {
      const label = CATEGORY_LABEL[slug as CategorySlug];
      if (slug === "other" || slug === "money" || slug === "politics") continue; // identical by nature
      expect(label).not.toBe(slug);
    }
  });

  it("titles the multiword ones", () => {
    expect(categoryLabel("human-nature")).toBe("Human Nature");
  });
});
