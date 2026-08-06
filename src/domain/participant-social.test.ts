import { describe, expect, it } from "vitest";
import { participantSocial, type SocialParticipant } from "./participant-social";

const p = (wallet: string, relation?: SocialParticipant["relation"]): SocialParticipant => ({
  wallet,
  relation,
});

describe("participantSocial", () => {
  it("puts tribe first, then rivals, then everyone else", () => {
    const r = participantSocial([p("a"), p("b", "rival"), p("c", "tribe")], 3);
    expect(r.faces.map((f) => f.wallet)).toEqual(["c", "b", "a"]);
    expect(r.summary).toBe("1 Tribe · 1 Rival · 1 Other");
  });

  it("falls back to a plain count when nobody is familiar", () => {
    const r = participantSocial([p("a"), p("b")], 17);
    expect(r.summary).toBe("17 Participants");
    expect(r.overflow).toBe(15);
  });

  it("shows at most six faces", () => {
    const r = participantSocial(
      Array.from({ length: 10 }, (_, i) => p(`w${i}`)),
      10,
    );
    expect(r.faces).toHaveLength(6);
    expect(r.overflow).toBe(4);
  });

  it("dedupes wallets case-insensitively", () => {
    const r = participantSocial([p("0xAB"), p("0xab", "tribe")], 1);
    expect(r.faces).toHaveLength(1);
  });

  it("is empty and silent with no participants", () => {
    expect(participantSocial([], 0)).toEqual({ faces: [], overflow: 0, summary: "" });
  });
});
