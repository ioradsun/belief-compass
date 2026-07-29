/**
 * Report a market. Deliberately available without a wallet — a market nobody
 * can report is a market nobody can moderate.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { reportMarket } from "@/lib/market-create.functions";

const REASONS = [
  "Illegal content",
  "Harassment or targeted harm",
  "Sexual content",
  "Copyright / not their content",
  "Spam or duplicate",
  "Something else",
];

export function ReportMarket({
  onchainId,
  wallet,
}: {
  onchainId: number;
  wallet?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState("");

  const send = useMutation({
    mutationFn: async () =>
      await reportMarket({
        data: { onchainId, reason: reason!, details: details || null, wallet: wallet ?? null },
      }),
  });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[11px] text-[var(--text-muted)] underline-offset-2 hover:underline"
      >
        Report
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close report"
        onClick={() => setOpen(false)}
        className="absolute inset-0 bg-black/60"
      />
      <div className="relative w-full max-w-[380px] rounded-t-2xl border border-[var(--border)] bg-[var(--panel)] p-4 sm:rounded-2xl">
        {send.isSuccess ? (
          <>
            <p className="text-[14px] text-[var(--text)]">Thanks — we'll review it.</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-4 w-full rounded-full bg-[var(--text)] px-3 py-2 text-[13px] font-medium text-[var(--bg)]"
            >
              Close
            </button>
          </>
        ) : (
          <>
            <div className="text-[14px] font-semibold text-[var(--text)]">Report this market</div>
            <div className="mt-3 space-y-1.5">
              {REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason(r)}
                  className={`block w-full rounded-md border px-3 py-2 text-left text-[13px] transition-colors ${
                    reason === r
                      ? "border-[var(--border-strong)] text-[var(--text)]"
                      : "border-[var(--border)] text-[var(--text-muted)]"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="Anything else? (optional)"
              className="mt-3 w-full resize-none rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px] outline-none placeholder:text-[var(--text-muted)]"
            />
            {send.isError && <p className="mt-2 text-[12px] text-[var(--no)]">Could not send that.</p>}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex-1 rounded-full border border-[var(--border)] px-3 py-2 text-[13px] text-[var(--text-muted)]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!reason || send.isPending}
                onClick={() => send.mutate()}
                className="flex-1 rounded-full bg-[var(--text)] px-3 py-2 text-[13px] font-medium text-[var(--bg)] disabled:opacity-40"
              >
                {send.isPending ? "Sending…" : "Send report"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
