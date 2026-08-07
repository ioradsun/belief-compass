/**
 * LAUNCH YOUR DEBATE — the right rail, after a market exists.
 *
 * THE PROBLEM THIS IS FOR. Measured against production: 71.2% of markets have
 * zero participants and 2.3% reach five. The workflow ended at "Market
 * Created", which is where the interesting part should have begun. Publishing
 * is not launching, and until this panel existed nothing in the product ever
 * said so.
 *
 * TWO STATES, AND THE ORDER MATTERS.
 *
 *   RECRUIT   "Your market is live. Who should see it first?" Five audiences,
 *             each with a reason per person and a designed zero-state.
 *   PROGRESS  What happened to the debate.
 *
 * The panel does NOT become a dashboard the moment the market publishes. A
 * creator who has just pressed the button has one useful thing to do and it is
 * not watching a number — so recruitment holds the rail until they send an
 * invitation or dismiss it. That is a moment of agency before the panel turns
 * observational, and swapping the order would replace the only action available
 * with a scoreboard of nothing.
 *
 * WHAT IT MEASURES. Outcomes, never effort. Invitations sent is not on the
 * ladder; it is the denominator the ladder is read against. See `launchLadder`.
 *
 * EVERY REASON IS STORED. The sentence beside a person is the one that goes
 * onto the invitation, so the recipient reads exactly what the sender saw.
 * Nothing here composes copy — `@/domain/launch-audience` does, and refuses to
 * name anyone it cannot justify.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useWalletSession } from "@/hooks/useWalletSession";
import { getLaunchAudience, getLaunchProgress, sendInvites } from "@/lib/launch.functions";
import { launchLadder, type AudienceKind, type AudienceRow } from "@/domain/launch-audience";
import { PersonAvatar } from "@/components/PersonAvatar";

/** Which invite kind a row sends as. Same vocabulary as market_invites. */
const KIND_OF: Record<AudienceKind, "adjacent" | "tribe" | "rival" | "category" | "follower"> = {
  adjacent: "adjacent",
  tribe: "tribe",
  rival: "rival",
  category: "category",
  follower: "follower",
};

export function LaunchRail({
  wallet,
  marketId,
  onDone,
}: {
  wallet?: string;
  marketId: number;
  /** Leave Launch Mode entirely — the market is just a market now. */
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const { ensureSession } = useWalletSession();
  // Recruitment holds the rail until the creator acts. `sent` flips on the first
  // successful invitation, `dismissed` on an explicit "not now".
  const [sent, setSent] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: rows, isLoading } = useQuery({
    queryKey: ["launch-audience", wallet ?? null, marketId],
    queryFn: () => getLaunchAudience({ data: { wallet: wallet as string, marketId } }),
    enabled: !!wallet,
    staleTime: 60_000,
  });

  const { data: progress } = useQuery({
    queryKey: ["launch-progress", marketId],
    queryFn: () => getLaunchProgress({ data: { marketId } }),
    enabled: sent || dismissed,
    staleTime: 30_000,
  });

  const invite = useMutation({
    mutationFn: async (input: { row: AudienceRow; wallets: string[] }) => {
      if (!wallet) throw new Error("Connect a wallet first.");
      // An invitation puts YOUR NAME in someone else's interface, so the server
      // demands proof of the wallet rather than trusting the claimed one. One
      // signature per device; every invitation after it is free.
      const session = await ensureSession({ interactive: true });
      const chosen = input.row.people.filter((p) => input.wallets.includes(p.wallet));
      return sendInvites({
        data: {
          wallet,
          session,
          marketId,
          recipients: chosen.map((p) => ({
            toWallet: p.wallet,
            // The sentence the creator is looking at, stored verbatim.
            reason: p.reason,
            reasonKind: KIND_OF[input.row.kind],
          })),
        },
      });
    },
    onSuccess: () => {
      setSent(true);
      setError(null);
      void qc.invalidateQueries({ queryKey: ["launch-audience", wallet ?? null, marketId] });
      void qc.invalidateQueries({ queryKey: ["launch-progress", marketId] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not send that."),
  });

  if (!wallet) return null;

  const recruiting = !sent && !dismissed;

  return (
    <section className="mb-4 flex min-h-0 flex-col">
      <div className="mb-2">
        <p className="text-[13px] font-semibold leading-snug text-[var(--text)]">
          {recruiting ? "Your market is live. Who should see it first?" : "Launch progress"}
        </p>
        <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--text-secondary)]">
          {recruiting
            ? "Most markets never get a second person. Asking someone specific is what changes that."
            : "What happened to the debate — not what you sent."}
        </p>
      </div>

      {error && <p className="mb-2 text-[11.5px] text-[var(--loss)]">{error}</p>}

      {recruiting ? (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {isLoading && !rows ? (
              <p className="text-[11.5px] text-[var(--text-muted)]">Finding people…</p>
            ) : (
              (rows ?? []).map((row) => (
                <AudienceRowView
                  key={row.kind}
                  row={row}
                  busy={invite.isPending}
                  onInvite={(wallets) => invite.mutate({ row, wallets })}
                />
              ))
            )}
          </div>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="mt-2 shrink-0 text-left text-[11.5px] text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
          >
            Not now — just show me how it does
          </button>
        </>
      ) : (
        <>
          <ol className="space-y-2">
            {launchLadder(
              progress ?? { invited: 0, viewed: 0, joined: 0, backed: 0, participants: 0 },
            ).map((step) => (
              <li
                key={step.label}
                className="rounded-xl border p-2.5"
                style={{
                  borderColor: step.reached
                    ? "var(--border-strong,var(--border))"
                    : "var(--border)",
                  background: "var(--surface)",
                }}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className="text-[12px] font-semibold"
                    style={{ color: step.reached ? "var(--text)" : "var(--text-muted)" }}
                  >
                    {step.label}
                  </span>
                  <span className="num text-[12px] text-[var(--text-secondary)]">
                    {step.value}
                    {step.of != null ? ` / ${step.of}` : ""}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] leading-snug text-[var(--text-secondary)]">
                  {step.detail}
                </p>
              </li>
            ))}
          </ol>
          <div className="mt-2 flex gap-3">
            {dismissed && !sent && (
              <button
                type="button"
                onClick={() => setDismissed(false)}
                className="text-[11.5px] text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
              >
                Invite someone after all
              </button>
            )}
            <button
              type="button"
              onClick={onDone}
              className="text-[11.5px] text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
            >
              Done
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * One audience. Renders whether or not it has anyone — an empty row tells the
 * creator something true about their own graph, and a panel that shows three
 * groups one day and five the next is one nobody can form a model of.
 */
function AudienceRowView({
  row,
  busy,
  onInvite,
}: {
  row: AudienceRow;
  busy: boolean;
  onInvite: (wallets: string[]) => void;
}) {
  const [open, setOpen] = useState(row.kind === "adjacent");
  const pending = row.people.filter((p) => !p.invited);

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-baseline justify-between gap-2 text-left"
      >
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          {row.label}
        </span>
        <span className="num text-[11px] text-[var(--text-secondary)]">
          {/* A count, not a zero. The empty state below says why. */}
          {row.people.length > 0 ? row.people.length : "—"}
        </span>
      </button>

      {open && (
        <>
          {row.people.length === 0 ? (
            <p className="mt-1 text-[11.5px] leading-snug text-[var(--text-muted)]">
              {row.emptyState}
            </p>
          ) : (
            <>
              <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{row.blurb}</p>
              <ul className="mt-1.5 space-y-1.5">
                {row.people.map((p) => (
                  <li
                    key={p.wallet}
                    className="flex items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2"
                  >
                    <PersonAvatar wallet={p.wallet} name={p.name ?? undefined} size={22} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-medium text-[var(--text)]">
                        {p.name ?? p.wallet.slice(0, 8)}
                      </div>
                      {/* WHY THIS PERSON — and the exact text that will be
                          stored on the invitation they receive. */}
                      <p className="line-clamp-2 text-[11px] leading-snug text-[var(--text-secondary)]">
                        {p.reason}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busy || p.invited}
                      onClick={() => onInvite([p.wallet])}
                      className="shrink-0 rounded-full border px-2 py-1 text-[11px] font-semibold disabled:opacity-45"
                      style={{ borderColor: "var(--border-strong,var(--border))" }}
                    >
                      {p.invited ? "Invited" : "Invite"}
                    </button>
                  </li>
                ))}
              </ul>
              {pending.length > 1 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onInvite(pending.map((p) => p.wallet))}
                  className="mt-1.5 text-[11.5px] font-semibold text-[var(--text)] underline underline-offset-2 disabled:opacity-45"
                >
                  Invite all {pending.length}
                </button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
