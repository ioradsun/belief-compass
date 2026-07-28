/**
 * Calibration — the single cold-start module shared by every personalized
 * surface. Below the readiness threshold, the Network tab, the House tab, and the
 * center all show THIS (never a blank list or a "New territory" no-read), so the
 * experience is one consistent "charge up your read", not a scatter of empty
 * states. Driven by getViewerReadiness — the one signal all three respect.
 */
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
