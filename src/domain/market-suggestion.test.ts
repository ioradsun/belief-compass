import { describe, expect, it } from "vitest";
import {
  SUGGESTION,
  candidateScore,
  clarityScore,
  fitLine,
  isParticipationEligible,
  nearestExisting,
  normalizeQuestion,
  participationOf,
  rankCategories,
  rewardLine,
  selectBestCandidate,
  shouldInsertSuggestion,
  textSimilarity,
  validateCandidate,
  type IdeaCandidate,
  type InterestSignal,
  type MarketIdeaOpportunity,
} from "./market-suggestion";

const CATS = ["Technology", "Society", "Money"] as const;

const opp: MarketIdeaOpportunity = {
  primaryCategory: "Technology",
  secondaryCategory: "Society",
  relevantTopics: ["AI", "schools"],
  recentRelatedQuestions: [],
  similarExistingQuestions: [],
};

const idea = (over: Partial<IdeaCandidate> = {}): IdeaCandidate => ({
  question: "Should schools teach children how to challenge AI answers?",
  category: "Technology",
  shortReason: "Connects AI and learning.",
  keywords: ["AI", "schools"],
  ...over,
});

describe("eligibility", () => {
  it("requires participation across categories", () => {
    expect(isParticipationEligible({ meaningfulActions: 5, yesNoDecisions: 3, categoriesTouched: 2 })).toBe(true);
    expect(isParticipationEligible({ meaningfulActions: 5, yesNoDecisions: 3, categoriesTouched: 1 })).toBe(false);
    expect(isParticipationEligible({ meaningfulActions: 4, yesNoDecisions: 3, categoriesTouched: 2 })).toBe(false);
    expect(isParticipationEligible({ meaningfulActions: 9, yesNoDecisions: 2, categoriesTouched: 3 })).toBe(false);
  });

  const gate = {
    cardsViewed: 9,
    cardsSinceSuggestion: 20,
    suggestionsThisSession: 0,
    dismissedAt: null,
    createdAt: null,
    hasReadySuggestion: true,
  };

  it("inserts only when every session rule passes", () => {
    expect(shouldInsertSuggestion(gate)).toBe(true);
    expect(shouldInsertSuggestion({ ...gate, hasReadySuggestion: false })).toBe(false);
    expect(shouldInsertSuggestion({ ...gate, cardsViewed: 4 })).toBe(false);
    expect(shouldInsertSuggestion({ ...gate, cardsSinceSuggestion: 11 })).toBe(false);
    expect(shouldInsertSuggestion({ ...gate, suggestionsThisSession: 1 })).toBe(false);
  });

  it("honours the dismissal and creation cooldowns", () => {
    const now = Date.now();
    expect(shouldInsertSuggestion({ ...gate, now, dismissedAt: now - 3 * 86_400_000 })).toBe(false);
    expect(shouldInsertSuggestion({ ...gate, now, dismissedAt: now - 8 * 86_400_000 })).toBe(true);
    expect(shouldInsertSuggestion({ ...gate, now, createdAt: now - 10 * 86_400_000 })).toBe(false);
    expect(shouldInsertSuggestion({ ...gate, now, createdAt: now - 15 * 86_400_000 })).toBe(true);
  });
});

describe("interest profile", () => {
  const signals: InterestSignal[] = [
    { marketId: "1", category: "Technology", action: "YES", backed: true },
    { marketId: "2", category: "Technology", action: "NO" },
    { marketId: "3", category: "Society", action: "PASS" },
    { marketId: "4", category: "Society", action: "CASE_OPENED" },
    { marketId: "5", category: null, action: "YES" },
  ];

  it("weights backed decisions above selections above passes", () => {
    expect(rankCategories(signals)).toEqual([
      { category: "Technology", score: 8 },
      { category: "Society", score: 3 },
    ]);
  });

  it("counts participation", () => {
    expect(participationOf(signals)).toEqual({
      meaningfulActions: 5,
      yesNoDecisions: 3,
      categoriesTouched: 2,
    });
  });
});

describe("duplicate detection", () => {
  it("normalizes punctuation and case", () => {
    expect(normalizeQuestion("Should Schools BAN AI?!")).toBe("should schools ban ai");
    expect(textSimilarity("Should schools ban AI?", "should schools ban ai")).toBe(1);
  });

  it("scores reworded propositions high and new angles low", () => {
    expect(textSimilarity("Should schools ban AI tools?", "Should schools ban AI?")).toBeGreaterThan(0.6);
    expect(textSimilarity("Should schools ban AI?", "Will crypto replace banks?")).toBeLessThan(0.1);
  });

  it("rejects a candidate that duplicates an existing market", () => {
    const v = validateCandidate(idea({ question: "Should schools teach children to challenge AI answers?" }), CATS, [
      "Should schools teach children how to challenge AI answers?",
    ]);
    expect(v).toEqual({ ok: false, reason: "duplicate" });
  });

  it("reports the nearest existing market", () => {
    expect(nearestExisting("Will AI tutors become normal?", ["Should schools allow ChatGPT?"])).toBeLessThan(0.4);
  });
});

describe("validation", () => {
  it("accepts a clean candidate", () => {
    expect(validateCandidate(idea(), CATS, [])).toEqual({ ok: true, reason: null });
  });

  it("rejects malformed, compound, promotional and miscategorised questions", () => {
    expect(validateCandidate(idea({ question: "Should AI?" }), CATS, []).reason).toBe("too-short");
    expect(validateCandidate(idea({ question: `Should schools ${"teach ".repeat(30)}AI?` }), CATS, []).reason).toBe("too-long");
    expect(validateCandidate(idea({ question: "Schools should teach AI literacy." }), CATS, []).reason).toBe("not-a-question");
    expect(validateCandidate(idea({ question: "Should schools teach AI and will teachers accept it?" }), CATS, []).reason).toBe("compound");
    expect(validateCandidate(idea({ question: "Will this market bring guaranteed returns to backers?" }), CATS, []).reason).toBe("banned-phrase");
    expect(validateCandidate(idea({ category: "Sports" }), CATS, []).reason).toBe("bad-category");
  });
});

describe("ranking", () => {
  it("prefers on-topic, novel, concise questions", () => {
    const onTopic = candidateScore(idea(), opp, []);
    const offTopic = candidateScore(
      idea({ question: "Will interest rates fall next year?", category: "Money" }),
      opp,
      [],
    );
    expect(onTopic).toBeGreaterThan(offTopic);
  });

  it("penalises questions close to an existing market", () => {
    const novel = candidateScore(idea(), opp, []);
    const near = candidateScore(idea(), opp, ["Should schools teach kids to challenge AI answers today?"]);
    expect(near).toBeLessThan(novel);
  });

  it("selects deterministically and returns null when all are invalid", () => {
    const pick = selectBestCandidate(
      [idea({ question: "Will interest rates fall next year?", category: "Money" }), idea()],
      opp,
      CATS,
      [],
    );
    expect(pick?.candidate.question).toBe(idea().question);
    expect(selectBestCandidate([idea({ question: "no" })], opp, CATS, [])).toBeNull();
    expect(selectBestCandidate([idea()], opp, CATS, [idea().question])).toBeNull();
  });

  it("scores clarity between 0 and 1", () => {
    expect(clarityScore(idea().question)).toBeGreaterThan(0.8);
    expect(clarityScore("Should?")).toBeLessThan(1);
  });
});

describe("copy", () => {
  it("switches between cold and cross-category personalization", () => {
    expect(fitLine(["AI", "education"])).toContain("connects both");
    expect(fitLine(["AI"])).toContain("still missing");
    expect(fitLine([])).toBe("No close market currently asks this.");
  });

  it("states the fee entitlement exactly", () => {
    expect(rewardLine(450)).toBe("Create it and earn 4.5% of eligible trading fees generated by the market.");
    expect(rewardLine(null)).toContain("4.5%");
    expect(rewardLine(500)).toContain("5%");
  });

  it("keeps suggestions rare by configuration", () => {
    expect(SUGGESTION.MAX_PER_SESSION).toBe(1);
    expect(SUGGESTION.MIN_CARDS_BETWEEN_SUGGESTIONS).toBe(12);
  });
});
