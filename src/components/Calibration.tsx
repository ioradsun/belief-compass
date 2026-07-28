/**
 * Calibration — the single cold-start module shared by every personalized
 * surface. Below the readiness threshold, the Network tab, the House tab, and the
 * center all show THIS (never a blank list or a "New territory" no-read), so the
 * experience is one consistent "charge up your read", not a scatter of empty
 * states. Driven by getViewerReadiness — the one signal all three respect.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getViewerReadiness } from "@/lib/beliefs.functions";
import { CALIBRATION_TARGET, type Readiness } from "@/domain/beliefs";

export function useReadiness(wallet?: string) {
  return useQuery({
    queryKey: ["readiness", wallet?.toLowerCase() ?? null],
    queryFn: () => getViewerReadiness({ data: { wallet: wallet ?? null } }),
    enabled: !!wallet,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

function Bar({ progress }: { progress: number }) {
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full"
      style={{ background: "var(--border)" }}
    >
      <div
        className="h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none"
        style={{
          width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`,
          background: "var(--yes)",
        }}
      />
    </div>
  );
}

const remainingLine = (r?: Readiness) => {
  const remaining = r?.remaining ?? CALIBRATION_TARGET;
  if (remaining <= 0) return "Calibrated — your network and the House are live.";
  return `${remaining} more belief${remaining === 1 ? "" : "s"} to unlock your network and the House.`;
};

/** Full card — used where a whole surface is waiting (Network tab, House tab). */
export function CalibrationCard({ readiness }: { readiness?: Readiness }) {
  const count = readiness?.count ?? 0;
  const target = readiness?.target ?? CALIBRATION_TARGET;
  return (
    <div
      className="space-y-2.5 rounded-[12px] p-3"
      style={{ border: "1px solid var(--border)", background: "var(--surface,transparent)" }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
          Calibrate your read
        </span>
        <span className="num text-[11px] font-semibold text-[var(--text-secondary)]">
          {count} / {target}
        </span>
      </div>
      <p className="text-[14px] font-semibold leading-snug text-[var(--text)]">
        {remainingLine(readiness)}
      </p>
      <Bar progress={readiness?.progress ?? 0} />
      <p className="text-[12px] leading-snug text-[var(--text-muted)]">
        Tap <b className="text-[var(--yes)]">Agree</b> or{" "}
        <b className="text-[var(--no)]">Disagree</b> on any market — free, no money — to teach the
        app who you are. The more you answer, the sharper your network and the House get.
      </p>
    </div>
  );
}

/**
 * One-time celebratory reveal fired the moment the viewer crosses into
 * calibrated. Shown once per wallet (localStorage-guarded), so it lands on the
 * live crossing but never nags on later visits. Everything under it has already
 * lit up — this just names the moment.
 */
export function CalibrationReveal({ wallet }: { wallet?: string }) {
  const { data: readiness } = useReadiness(wallet);
  const [show, setShow] = useState(false);
  const fired = useRef(false);
  const key = wallet ? `calibrated-revealed:${wallet.toLowerCase()}` : null;

  useEffect(() => {
    if (!key || !readiness?.calibrated || fired.current) return;
    if (typeof localStorage !== "undefined" && localStorage.getItem(key)) return;
    fired.current = true;
    setShow(true);
  }, [key, readiness?.calibrated]);

  if (!show) return null;
  const dismiss = () => {
    if (key && typeof localStorage !== "undefined") localStorage.setItem(key, "1");
    setShow(false);
  };
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="You're calibrated"
      onClick={dismiss}
      className="fixed inset-0 z-50 grid place-items-center p-6"
      style={{
        background: "color-mix(in oklab, var(--bg) 72%, transparent)",
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[360px] rounded-[18px] p-6 text-center"
        style={{
          border: "1px solid var(--border)",
          background: "var(--surface, var(--bg))",
          boxShadow:
            "0 0 0 1px color-mix(in oklab, var(--yes) 22%, transparent), 0 24px 60px rgba(0,0,0,0.35)",
          animation: "cal-pop 380ms cubic-bezier(0.2,0.9,0.3,1.2) both",
        }}
      >
        <div
          className="mx-auto grid h-12 w-12 place-items-center rounded-full text-[22px] font-bold"
          style={{
            background: "color-mix(in oklab, var(--yes) 18%, transparent)",
            color: "var(--yes)",
          }}
          aria-hidden
        >
          ✓
        </div>
        <div className="mt-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
          Calibrated
        </div>
        <h2 className="mt-1 text-[20px] font-semibold leading-tight text-[var(--text)]">
          The app knows you now.
        </h2>
        <p className="mt-2 text-[13px] leading-snug text-[var(--text-secondary)]">
          Your network is live and the House can read you. Every belief you take from here sharpens
          both.
        </p>
        <button
          type="button"
          onClick={dismiss}
          className="mt-5 w-full rounded-[12px] py-2.5 text-[14px] font-semibold"
          style={{ background: "var(--text)", color: "var(--bg)" }}
        >
          See who thinks like you
        </button>
      </div>
      <style>{`@keyframes cal-pop{from{opacity:0;transform:translateY(8px) scale(.96)}to{opacity:1;transform:none}}
      @media (prefers-reduced-motion: reduce){[style*="cal-pop"]{animation:none!important}}`}</style>
    </div>
  );
}

/** Slim banner — sits atop the center deck while the user is answering. */
export function CalibrationBanner({ readiness }: { readiness?: Readiness }) {
  return (
    <div
      className="flex items-center gap-3 rounded-[12px] px-3 py-2"
      style={{ border: "1px solid var(--border)", background: "var(--surface,transparent)" }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
            Calibrating
          </span>
          <span className="num text-[11px] font-semibold text-[var(--text-secondary)]">
            {readiness?.count ?? 0} / {readiness?.target ?? CALIBRATION_TARGET}
          </span>
        </div>
        <div className="mt-1.5">
          <Bar progress={readiness?.progress ?? 0} />
        </div>
        <p className="mt-1 truncate text-[11px] text-[var(--text-muted)]">
          {remainingLine(readiness)}
        </p>
      </div>
    </div>
  );
}
