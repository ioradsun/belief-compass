import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const code = (p: string) =>
  readFileSync(join(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

/**
 * THE OUTBOUND CARD LIVES IN `ChainList` NOW. It was merged with the incoming
 * call that produced it — one card per person per market — so every rule below
 * still applies, to the component that actually renders them.
 */
const yours = () => code("src/components/ChainList.tsx");
const rail = () => code("src/components/ChallengeRail.tsx");

/**
 * ONE CARD GRAMMAR, TWO PERSPECTIVES. A Position card answers "where do I stand
 * and what happened"; a Challenge card answers "what did I put in front of my
 * people and what happened". The market is the shared object; the relationship
 * decides the view. Everything below is a way the outbound side could start
 * claiming more than it knows.
 */
describe("the outbound card claims only what the server proved", () => {
  it("leads with people, and prints nothing else", () => {
    const c = yours();
    expect(c).toMatch(/progressLine\(/);
    // No second row of metrics smuggled in beside it.
    expect(c).not.toMatch(/believers|capital|volume|\+\$/i);
  });

  it("never claims a view", () => {
    // The only view signal this product has is client-reported and unverifiable.
    // "5 viewed" is exactly the claim a creator would believe and we cannot prove.
    expect(yours()).not.toMatch(/viewed|looked|impression/i);
  });

  it("never names anybody as having passed", () => {
    // A pass is a choice about a question, not a verdict on a person. The count
    // is aggregate and stays aggregate — it reaches the card only through the
    // shared progress line, never as a named person.
    const c = yours();
    expect(c).not.toMatch(/passedBy|whoPassed|passers/);
  });

  it("tells the early state once, in the one progress line", () => {
    // "0 of 7 showed up" + "7 of your people can weigh in. No smoke yet." was the
    // same fact three times. `progressLine` owns the early sentence now, so the
    // card must not carry a second one of its own.
    const c = yours();
    expect(c).not.toMatch(/No smoke yet|can weigh in/);
    expect(c).toMatch(/progressLine\(/);
  });

  it("counts capacity from the live rows only", () => {
    const c = yours();
    // `live`, not `table` — the payload now also carries Challenges that ended in
    // the last week so their author finds out what happened, and counting those as
    // occupied slots would tell somebody with three good outcomes that their table
    // was full. Closing is exactly what gave the slot back.
    expect(c).toMatch(/\{live\.length\}\/\{TABLE_SLOTS\}/);
    expect(c).toMatch(/spotsOpen\(live\.length\)/);
  });
});

describe("taking it off the table", () => {
  it("is casual, and destroys nothing", () => {
    const c = yours();
    expect(c).toMatch(/Withdraw/);
    expect(c).not.toMatch(/Delete|Cancel|Remove Challenge/i);
  });

  it("keeps it behind an overflow menu rather than under every card", () => {
    const c = yours();
    expect(c).toMatch(/MoreHorizontal/);
    expect(c).toMatch(/more &&/);
  });


  it("never reports a failed read as an empty table", () => {
    // Same rule the incoming side follows: silence is earned by an answer.
    const c = yours();
    expect(c).toMatch(/isError/);
    expect(c).toMatch(/Could not load your table/);
  });
});


describe("one column, no whose-table filter", () => {
  it("has no side tabs at all", () => {
    // "Challenged" and "Yours" was a filter over a handful of cards. The card
    // already says which it is: an incoming call names the person asking, one of
    // yours carries its own progress, a free slot is an invitation.
    const c = rail();
    expect(c).not.toMatch(/"Sent"|"Received"|"Outbound"|"Inbound"/);
    expect(c).not.toMatch(/railSideKey/);
    expect(c).not.toMatch(/side === "yours"/);
  });

  it("renders both sides as ONE card, not two lists", () => {
    // A reader brought into a question who then relays it used to appear twice
    // in this column with no visible connection between the two cards — the
    // chain passing THROUGH a person was the one thing it could not show.
    /**
     * NOW ONE PROJECTION, NOT ONE MERGED LIST. `ChainList` merged the incoming
     * calls by market, which was right as far as it went — a reader who had ALSO
     * put the question up still had a second card for it on the Yours tab, and
     * neither could see the other. `challengeCardsFor` projects both directions
     * into a single object with a single state.
     */
    const c = rail();
    expect(c).toMatch(/<ChallengeCardList/);
    expect(c).not.toMatch(/<ChallengeRow/);
    expect(c).not.toMatch(/<YourTable/);
    // The component switches on the server's state and reconstructs nothing.
    expect(code("src/components/ChallengeCard.tsx")).toMatch(/switch \(p\.state\)/);
  });

  it("counts everything live on the tab", () => {
    // People waiting on you plus what you have up. Finished rows are history.
    const c = rail();
    expect(c).toMatch(/challengeCount/);
    expect(c).toMatch(/closedAtMs == null/);
  });
});

describe("a pass reaches the server now, and still tells nobody", () => {
  it("hides locally AND records durably", () => {
    // Local so the card leaves instantly and a failed write cannot bring it back;
    // durable so the creator's "1 passed" is true.
    const c = rail();
    const pass = c.slice(c.indexOf("const pass = (marketId"), c.indexOf("return ("));
    expect(pass).toMatch(/hideCall\(marketId\)/);
    expect(pass).toMatch(/passOnCall\(/);
  });

  it("never opens a wallet prompt to wave a card off", () => {
    const c = rail();
    const pass = c.slice(c.indexOf("const pass = (marketId"), c.indexOf("return ("));
    expect(pass).toMatch(/interactive: false/);
  });

  it("keeps the local set, rather than waiting on the round trip", () => {
    const c = code("src/lib/open-calls.ts");
    expect(c).toMatch(/localStorage/);
    expect(c).toMatch(/calls-hidden/);
  });
});

/**
 * WHEN SOMEBODY HAS MORE THAN A RAILFUL.
 *
 * Every open call is now a deliberate request rather than an inference, so the
 * old behaviour — quietly cutting at six and discarding the rest — stopped being
 * defensible. It is not that six is wrong; it is that the seventh person asked.
 */
describe("more than fits", () => {
  it("shows a railful and says how many are behind it", () => {
    const c = rail();
    // One list now, bounded by `limit` rather than sliced twice — same railful,
    // same "N more waiting" underneath, one object per market.
    expect(c).toMatch(/limit=\{shown \+ CHALLENGE\.maxRecent\}/);
    expect(c).toMatch(/\{open\.length - shown\} more waiting/);
  });

  it("reveals a railful at a time rather than everything at once", () => {
    // Past a railful it stops reading as a set of things waiting for you and
    // starts reading as a feed — and the feed already exists one tab across.
    expect(rail()).toMatch(/setShown\(\(n\) => n \+ CHALLENGE\.maxOpen\)/);
  });

  it("has no pass-all, and that is a decision", () => {
    // A pass is durable and per-question: each one tells a different creator
    // that somebody considered their question and moved on. A bulk gesture would
    // convert one reader's fatigue into N false signals about N questions —
    // "I had a full queue" rendered to each of them as "1 passed". The relief
    // valve is that unanswered calls are not urgent, not that they can be
    // cleared in one stroke.
    const c = rail();
    for (const w of ["dismissAll", "passAll", "Clear all", "Dismiss all"])
      expect(c).not.toContain(w);
  });
});

describe("the derived path is gone, not disabled", () => {
  it("reads calls somebody made rather than inferring them from trades", () => {
    const c = code("src/lib/challenge.server.ts");
    expect(c).toMatch(/\.not\("challenge_id", "is", null\)/);
    // The event scan, its window, its cap and the surfacing write are all gone.
    expect(c).not.toMatch(/recordCalls|callerEvents|kind", \["trade", "market_created"\]/);
  });

  it("keeps a Challenge alive when its caller has since exited", () => {
    // Putting it on the table is the thing they did, and it stays true. Without
    // this the row silently vanished and took a deliberate request with it.
    const c = code("src/lib/challenge.server.ts");
    expect(c).toMatch(/act: side \? "trade" : "market_created"/);
  });

  it("throws rather than rendering an empty room on a failed read", () => {
    const c = code("src/lib/challenge.server.ts");
    const build = c.slice(c.indexOf("export async function buildChallenges"));
    expect(build).toMatch(/throw new Error\(error\.message\)/);
  });
});

/**
 * THE DURABLE CARD BORROWS RULES; IT DOES NOT INVENT THEM.
 *
 * Three ways this surface could quietly grow a second opinion, asserted closed.
 */
describe("the durable card reuses the canonical rules", () => {
  const cardCode = () => code("src/components/ChallengeCard.tsx");

  it("labels the relay button with the closing screen's rules", () => {
    // It rendered "Challenge all 1" and "Challenge all 2" until it borrowed the
    // helper: one named person is "Challenge Maya", two is "Challenge both".
    const c = cardCode();
    expect(c).toMatch(/challengeLabel\(/);
    expect(c).not.toMatch(/Challenge all \{/);
  });

  it("celebrates a response in a colour that takes no side", () => {
    /**
     * A `--yes` highlight turns "somebody showed up" into a YES-coded event even
     * when they answered NO. Showing Up is side-blind everywhere else, and a
     * tint that agrees with one side is the same claim made in colour.
     */
    const fresh = cardCode().slice(cardCode().indexOf("borderColor: fresh"));
    const block = fresh.slice(0, fresh.indexOf("}"));
    expect(block).not.toMatch(/--yes|--no/);
  });

  it("confirms a removal transiently, and never from the projection", () => {
    // "Off the table" is a fact about a press, not about the market. A reader
    // arriving fresh must not be told about a removal they did not perform.
    expect(cardCode()).toMatch(/justRemoved/);
    expect(code("src/domain/challenge-card.ts")).not.toMatch(/justRemoved/);
    expect(code("src/components/ChallengeCardList.tsx")).toMatch(/setJustRemoved/);
  });
});
