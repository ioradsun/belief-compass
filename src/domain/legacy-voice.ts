/**
 * LEGACY TRANSITION COPY → PI VOICE.
 *
 * Market transitions are composed ONCE, at emit time, and stored in the event
 * payload. That means every row written before the PI voice existed still ships
 * its original sentence forever: "MONEY IS LEAVING YES", "THIS QUESTION IS ALIVE
 * AGAIN", "NO HAS ITS FIRST BELIEVERS", "FIRST CAPITAL BACKS NO". They are
 * factually fine and stylistically from another product.
 *
 * Rewriting history in the database would be a lie about when we knew things, so
 * the conversion happens at READ time: recognise the old label, recover the
 * numbers the old detail already printed, and re-say it in the current voice.
 * Nothing is invented — if a pattern is not recognised, the stored copy ships
 * untouched.
 */
import { capitalDrainLine, capitalArrivalLine, reawakenLine } from "./pi-voice";

export interface TransitionCopy {
  headline: string;
  detail: string;
}

/** "−65% over 24H" → { pct: 65, window: "24H" } */
function readMove(detail: string): { pct: number; window: string } | null {
  const m = detail.match(/([-−+]?)\s*([\d.]+)%\s*over\s*(\S+)/i);
  if (!m) return null;
  const pct = Number(m[2]);
  if (!Number.isFinite(pct)) return null;
  return { pct, window: m[3]! };
}

const SIDE = /(YES|NO)/i;

export function modernizeTransitionCopy(
  headlineIn: string,
  detailIn: string | null | undefined,
  key: string,
): TransitionCopy {
  const headline = (headlineIn ?? "").trim();
  const detail = (detailIn ?? "").trim();
  if (!headline) return { headline, detail };
  const h = headline.toLowerCase();
  const sideOf = (s: string): string => (s.match(SIDE)?.[1] ?? "").toUpperCase();

  // MONEY LEAVING / ARRIVING — intensity comes from the number, not the label.
  if (/^(money is leaving|capital on)\b/.test(h) || /^money is piling into\b/.test(h)) {
    const side = sideOf(headline) || "that side";
    const move = readMove(detail);
    const falling = /leaving|fell|dropped/.test(h) || (move != null && /[-−]/.test(detail));
    const v = falling
      ? capitalDrainLine(side, move?.pct ?? 20, key)
      : capitalArrivalLine(side, move?.pct ?? 20, key);
    return {
      headline: v.headline,
      detail: move
        ? falling
          ? `${Math.round(move.pct)}% of the money left in ${move.window}.`
          : `${side} is carrying ${Math.round(move.pct)}% more than it was in ${move.window}.`
        : v.body,
    };
  }

  // A ROOM NOBODY HAD ENTERED IN A WEEK HAS PEOPLE IN IT.
  if (/alive again|activity resumed|trading again/.test(h)) {
    const trades = Number(detail.match(/(\d+)\s*trade/i)?.[1] ?? 0) || 1;
    const v = reawakenLine(trades, trades >= 5, key);
    return { headline: v.headline, detail: v.body };
  }

  // FIRST BELIEVERS — one motif for "this side was empty and now it isn't".
  if (/has its first believers|first believers/.test(h)) {
    const side = sideOf(headline);
    return {
      headline: side ? `${side} just got company` : "Just got company",
      detail: detail && !/first believers/i.test(detail) ? detail : "First believers just stepped in.",
    };
  }

  // FIRST CAPITAL — money doing something, not a state being named.
  if (/^first capital\b/.test(h)) {
    const side = sideOf(headline);
    return {
      headline: side ? `Money finally hit ${side}` : "Money finally landed",
      detail: "First capital just landed on that side.",
    };
  }

  if (/price moved.*conviction did not/.test(h)) {
    return { headline: "The price moved. The crowd didn't.", detail };
  }

  if (/gained \d+ believers?$/.test(h)) {
    const side = sideOf(headline);
    const nPeople = Number(headline.match(/gained (\d+)/i)?.[1] ?? 0);
    return {
      headline: side ? `${side} got company` : "Got company",
      detail: detail || `${nPeople} ${nPeople === 1 ? "person" : "people"} stepped in.`,
    };
  }

  return { headline, detail };
}
