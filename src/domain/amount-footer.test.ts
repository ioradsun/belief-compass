import { describe, expect, it } from "vitest";
import { showsAmountFooter } from "./amount-footer";

const row = (o: Partial<Parameters<typeof showsAmountFooter>[0]>) =>
  showsAmountFooter({ headline: "", body: "", attribution: null, amountUsd: 10, ...o });

describe("amount footer", () => {
  it("never says a dollar figure twice", () => {
    expect(row({ headline: "Got heavier", body: "Three people brought in $244." })).toBe(false);
    expect(row({ headline: "$244 just landed", body: "Three stepped in." })).toBe(false);
    expect(row({ body: "Out.", attribution: "$15 left with them." })).toBe(false);
  });

  it("drops a small amount when the card already carries its own consequence", () => {
    expect(row({ headline: "Out", body: "Alex is out.", attribution: "Only 4 left.", amountUsd: 15 })).toBe(false);
    expect(row({ headline: "YES just got company", body: "3 people stepped in at once.", amountUsd: 6.32 })).toBe(false);
  });

  it("keeps an amount that is news by itself", () => {
    expect(row({ headline: "Out", body: "Alex is out.", attribution: "Only 4 left.", amountUsd: 900 })).toBe(true);
  });

  it("keeps the amount when it is the only evidence the card has", () => {
    expect(row({ headline: "Backed", body: "Parzival took a side.", amountUsd: 12 })).toBe(true);
  });

  it("shows nothing without a positive amount", () => {
    expect(row({ amountUsd: 0 })).toBe(false);
    expect(row({ amountUsd: null })).toBe(false);
  });
});
