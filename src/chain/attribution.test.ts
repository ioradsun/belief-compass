import { describe, expect, it } from "vitest";
import { CONVICTION_TAG, CONVICTION_TAG_TEXT, hasConvictionTag } from "./attribution";

const hexToAscii = (hex: string): string =>
  (hex.match(/../g) ?? []).map((b) => String.fromCharCode(parseInt(b, 16))).join("");

describe("CONVICTION_TAG", () => {
  it("is the ASCII encoding of the text form", () => {
    expect(hexToAscii(CONVICTION_TAG.slice(2))).toBe(CONVICTION_TAG_TEXT);
  });

  it("is whole bytes and lowercase, so suffix matching is exact", () => {
    expect(CONVICTION_TAG.startsWith("0x")).toBe(true);
    expect((CONVICTION_TAG.length - 2) % 2).toBe(0);
    expect(CONVICTION_TAG).toBe(CONVICTION_TAG.toLowerCase());
  });
});

describe("hasConvictionTag", () => {
  const call = "0xbfdabc5a" + "11".repeat(96); // selector + three static words

  it("detects calldata we tagged", () => {
    expect(hasConvictionTag(call + CONVICTION_TAG.slice(2))).toBe(true);
  });

  it("is case-insensitive about the calldata", () => {
    expect(hasConvictionTag((call + CONVICTION_TAG.slice(2)).toUpperCase())).toBe(true);
  });

  it("rejects untagged calldata", () => {
    expect(hasConvictionTag(call)).toBe(false);
  });

  it("rejects a tag that is not at the end", () => {
    expect(hasConvictionTag("0x" + CONVICTION_TAG.slice(2) + "deadbeef")).toBe(false);
  });

  it("is safe on empty and missing input", () => {
    expect(hasConvictionTag(null)).toBe(false);
    expect(hasConvictionTag(undefined)).toBe(false);
    expect(hasConvictionTag("")).toBe(false);
    expect(hasConvictionTag("0x")).toBe(false);
  });
});
