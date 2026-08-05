/**
 * WHAT THE PROFILE SAYS FIRST, across the relationship shapes that exist.
 *
 * This is the sentence a visitor reads before they know anything about the
 * person, so it decides whether they keep reading. Tests prove it never claims
 * a score and never reports an absence; only a human can say whether it sounds
 * like an introduction a thoughtful friend would make.
 *
 * Read each block and ask:
 *   1. Would I keep reading after this line?
 *   2. Does it say something a person would actually say?
 *   3. Is every bond checkable, and none of it flattery?
 *   4. On the empty case — does it feel hopeful rather than apologetic?
 *
 *   npm run check:connection
 */
import { whatConnectsYou, type ConnectionInput } from "../src/domain/what-connects-you";

const i = (o: Partial<ConnectionInput> = {}): ConnectionInput => ({
  sharedMarkets: 0,
  together: 0,
  apart: 0,
  alignedTopics: [],
  opposedTopics: [],
  viewerTopics: [],
  personTopics: [],
  viewerMedianDays: null,
  personMedianDays: null,
  ...o,
});

const CASES: [string, ConnectionInput][] = [
  [
    "Strong overlap, mostly agreeing",
    i({
      sharedMarkets: 18,
      together: 15,
      apart: 3,
      alignedTopics: ["technology"],
      opposedTopics: ["economics"],
      viewerMedianDays: 30,
      personMedianDays: 95,
    }),
  ],
  [
    "Opposite thinkers, same questions",
    i({
      sharedMarkets: 12,
      together: 3,
      apart: 9,
      alignedTopics: ["culture"],
      opposedTopics: ["politics"],
      viewerMedianDays: 60,
      personMedianDays: 55,
    }),
  ],
  ["Never once disagreed", i({ sharedMarkets: 7, together: 7, apart: 0, alignedTopics: ["ai"] })],
  [
    "Thin overlap — two markets",
    i({ sharedMarkets: 2, together: 2, viewerTopics: ["crypto"], personTopics: ["crypto", "ai"] }),
  ],
  [
    "No shared markets, but a shared interest",
    i({
      viewerTopics: ["technology", "sports"],
      personTopics: ["culture", "technology"],
      viewerMedianDays: 40,
      personMedianDays: 44,
    }),
  ],
  ["Brand new — nothing measurable at all", i()],
];

for (const [label, input] of CASES) {
  const c = whatConnectsYou(input, "Sarah");
  console.log(`\n── ${label}`);
  console.log(`   [${c.strength}${c.early ? " · early" : ""}]`);
  console.log(`   ${c.opening}`);
  for (const b of c.bonds) console.log(`   • ${b}`);
}

console.log(`
Would you keep reading after each opening line?
Nothing above may be a score, a percentage, or a report of an absence — a reader
with no overlap is EARLY, not incompatible.
`);
