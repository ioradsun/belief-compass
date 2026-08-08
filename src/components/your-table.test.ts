import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const code = (p: string) =>
  readFileSync(join(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

const yours = () => code("src/components/YourTable.tsx");
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
    // is aggregate and stays aggregate — no "Mike passed on you", ever.
    const c = yours();
    expect(c).toMatch(/progress\.passed/);
    expect(c).not.toMatch(/passedBy|whoPassed|passers/);
  });

  it("says it is early rather than printing a row of noughts", () => {
    const c = yours();
    expect(c).toMatch(/No smoke yet/);
    expect(c).toMatch(/progress\.showedUp === 0 && progress\.passed === 0/);
  });

  it("reads capacity from the canonical line, never its own arithmetic", () => {
    const c = yours();
    expect(c).toMatch(/tableLine\(table\.length\)/);
    expect(c).not.toMatch(/\/ 3|of 3 used|TABLE_SLOTS -/i);
  });
});

describe("taking it off the table", () => {
  it("is casual, and destroys nothing", () => {
    const c = yours();
    expect(c).toMatch(/Take off the table/);
    expect(c).not.toMatch(/Delete|Cancel|Remove Challenge/i);
  });

  it("never reports a failed read as an empty table", () => {
    // Same rule the incoming side follows: silence is earned by an answer.
    const c = yours();
    expect(c).toMatch(/isError/);
    expect(c.indexOf("isError")).toBeLessThan(c.indexOf("Nothing on the table"));
  });
});

describe("whose table", () => {
  it("uses neither messaging nor plumbing words", () => {
    const c = rail();
    expect(c).toMatch(/Yours/);
    expect(c).toMatch(/Challenged/);
    // Sent/Received is messaging; Outbound/Inbound is describing the pipes.
    expect(c).not.toMatch(/"Sent"|"Received"|"Outbound"|"Inbound"/);
  });

  it("offers no choice to somebody with nothing up", () => {
    // A control that asks a question the reader cannot answer is the surface
    // talking to itself.
    expect(rail()).toMatch(/\(table\?\.length \?\? 0\) > 0 &&/);
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
