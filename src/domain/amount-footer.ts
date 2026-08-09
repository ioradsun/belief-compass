/**
 * DOES THE MONEY EARN ITS LINE?
 *
 * Every row used to end with "$X traded" because every row HAS an amount. That
 * is a database receipt, not editing: when the story is "Alex left and only 4
 * remain", $15 is trivia stapled to the card; when the story is "$244 landed",
 * the money IS the story and belongs on the card.
 *
 * Three rules, in order:
 *   1. If any line already names a dollar figure, never say it twice.
 *   2. If the card already carries its own consequence — a remaining count, a
 *      crowd size, a named social change — the amount is secondary and only
 *      survives if it is large enough to be news by itself.
 *   3. Otherwise the amount is the only evidence the card has. Show it.
 */
export const AMOUNT_IS_NEWS_USD = 50;

/** Lines whose subject is people or state rather than money. */
const CONSEQUENCE =
  /\b(believers?|people|company|only \d+ left|one less|nobody|somebody is|stepped in|is out|walked away|conviction #\d+)\b/i;

export interface AmountFooterInput {
  headline: string;
  body: string;
  attribution?: string | null;
  amountUsd?: number | null;
}

export function showsAmountFooter({
  headline,
  body,
  attribution,
  amountUsd,
}: AmountFooterInput): boolean {
  if (amountUsd == null || !(amountUsd > 0)) return false;
  const lines = [headline, body, attribution ?? ""];
  if (lines.some((l) => l.includes("$"))) return false;
  const carriesItsOwnPoint = lines.some((l) => CONSEQUENCE.test(l));
  return carriesItsOwnPoint ? amountUsd >= AMOUNT_IS_NEWS_USD : true;
}
