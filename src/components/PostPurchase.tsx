/**
 * Post-purchase experience (V1) — Conviction needs company.
 *
 * A completed BUY is reframed here: not a receipt, but the moment a belief
 * becomes belonging. This takes over the whole center panel. It reuses data the
 * deck already holds (the side's believer count off the market row, the faces
 * from the evidence query) — no new fetch, no calculation, no portfolio metrics.
 *
 * Reading order is deliberate and nothing competes with it:
 *   ✓ → Welcome to the {SIDE} Tribe → belonging message → people → SHARE → Next.
 *
 * The one primary action invites more believers in. The existing "Next market"
 * stays exactly where it was, at the bottom, at lower priority.
 */
import { useEffect, useState } from "react";
import type { Believer } from "@/lib/evidence.functions";
import { fmtUsd, type OrderSide } from "@/domain/order";
import { tribeWelcome, tribeShareText } from "@/domain/tribe";
import { hueFor, initialsFor } from "@/lib/wallet-identity";

const fmt = (n: number) => n.toLocaleString("en-US");

export function PostPurchase({
  side,
  title,
  believers,
  faces,
  shareUrl,
  investedUsd,
  onNext,
}: {
  side: OrderSide;
  title: string;
  /** Current believer count on the joined side — straight off the market row. */
  believers: number | null;
  /** Real holders on this side (from the deck's existing evidence query). */
  faces: Believer[];
  /** Deep link back to this market, so a share invites participation. */
  shareUrl: string;
  /** Dollars the viewer just put in — exactly the amount they invested. */
  investedUsd?: number | null;
  onNext: () => void;
}) {
  const color = side === "YES" ? "var(--yes)" : "var(--no)";
  const welcome = tribeWelcome(side, believers);

  // "Finding your tribe…" for a beat, then the belonging lands. Reframes the
  // wait: the app isn't confirming a transaction, it's confirming belonging.
  const [phase, setPhase] = useState<"finding" | "welcome">("finding");
  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setPhase("welcome");
      return;
    }
    const t = setTimeout(() => setPhase("welcome"), 420);
    return () => clearTimeout(t);
  }, []);

  const shown = faces.slice(0, 7);
  const total = Math.max(believers ?? 0, shown.length);

  const [copied, setCopied] = useState(false);
  async function onShare() {
    setCopied(false);
    const data = { title, text: tribeShareText(side), url: shareUrl };
    // Native share sheet — let people share anywhere, no forced destination.
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share(data);
        return;
      } catch (e) {
        // User dismissed the sheet — not a failure, don't fall back to copy.
        if ((e as Error)?.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(`${data.text} ${shareUrl}`);
      setCopied(true);
    } catch {
      /* nothing more we can do on this platform */
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Celebration canvas — vertically centered, nothing else on screen. */}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 text-center">
        {phase === "finding" ? (
          <div className="flex flex-col items-center gap-3" aria-live="polite">
            <span
              className="h-9 w-9 animate-pulse rounded-full"
              style={{ background: `color-mix(in oklab, ${color} 28%, transparent)` }}
              aria-hidden
            />
            <span className="text-[14px] font-medium text-[var(--text-muted)]">
              Finding your tribe…
            </span>
          </div>
        ) : (
          <div
            className="flex w-full max-w-[420px] flex-col items-center gap-5 motion-safe:animate-[pp-fade_.4s_ease-out]"
            aria-live="polite"
          >
            <style>{`@keyframes pp-fade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}`}</style>
            <span
              className="grid h-14 w-14 place-items-center rounded-full text-[26px] font-semibold"
              style={{ color, background: `color-mix(in oklab, ${color} 12%, transparent)` }}
              aria-hidden
            >
              ✓
            </span>

            <div className="space-y-2">
              <h1 className="text-[clamp(24px,3.2vw,34px)] font-semibold leading-tight tracking-tight text-[var(--text)]">
                {welcome.headline}
              </h1>
              <p className="text-[14px] leading-snug text-[var(--text-secondary)]">
                {welcome.message.map((line, i) => (
                  <span key={i} className="block">
                    {line}
                  </span>
                ))}
              </p>
              {/* Quiet ownership confirmation — belonging first, then the fact of
                what you put in. Never shares or a transaction hash. */}
              {investedUsd != null && investedUsd > 0 && (
                <p className="num text-[13px] text-[var(--text-muted)]">
                  You invested {fmtUsd(investedUsd)} into{" "}
                  <span style={{ color }} className="font-semibold">
                    {side}
                  </span>
                  .
                </p>
              )}
            </div>

            {/* People — faces if we have them, calm circles otherwise. Communicates
              "real people believe this," not a statistic. */}
            <div className="flex items-center justify-center gap-3">
              <div className="flex -space-x-2">
                {shown.length > 0
                  ? shown.map((b) => (
                      <span
                        key={b.wallet}
                        className="inline-block rounded-full"
                        style={{ boxShadow: "0 0 0 2px var(--bg)" }}
                      >
                        {b.avatarUrl ? (
                          <img
                            src={b.avatarUrl}
                            alt=""
                            className="h-8 w-8 rounded-full object-cover"
                          />
                        ) : (
                          <span
                            className="grid h-8 w-8 place-items-center rounded-full text-[10px] font-semibold text-white"
                            style={{ background: `hsl(${hueFor(b.wallet)} 45% 45%)` }}
                            aria-hidden
                          >
                            {initialsFor(b.name)}
                          </span>
                        )}
                      </span>
                    ))
                  : [0, 1, 2, 3, 4].map((i) => (
                      <span
                        key={i}
                        className="inline-block h-8 w-8 rounded-full"
                        style={{
                          background: "var(--surface-2,var(--border))",
                          boxShadow: "0 0 0 2px var(--bg)",
                        }}
                        aria-hidden
                      />
                    ))}
              </div>
              {total > 0 && (
                <span className="num text-[13px] text-[var(--text-muted)]">
                  {fmt(total)} believer{total === 1 ? "" : "s"}
                </span>
              )}
            </div>

            {/* Primary action — highest visual priority. Invites the next believer. */}
            <div className="flex w-full flex-col items-center gap-2 pt-1">
              <button
                type="button"
                onClick={onShare}
                className="w-full max-w-[320px] rounded-[14px] px-6 py-3.5 text-[15px] font-semibold"
                style={{ background: "var(--text)", color: "var(--bg)" }}
              >
                {welcome.cta}
              </button>
              {copied && (
                <span className="text-[12px] text-[var(--text-muted)]">
                  Link copied — share it anywhere.
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Secondary — the existing next-market step, kept at low priority. */}
      <div className="shrink-0 pt-2 text-center">
        <button
          type="button"
          onClick={onNext}
          className="rounded-[12px] px-4 py-2 text-[13px] font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)]"
        >
          Next market →
        </button>
      </div>
    </div>
  );
}
