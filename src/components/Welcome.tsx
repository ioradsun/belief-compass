/**
 * Welcome — belonging, one tap.
 *
 * Two calm banners on top of the existing rails:
 *  - WelcomePrompt (right rail): "👋 N people like you joined your tribe" → a
 *    lightweight sheet to welcome them all in one tap. No chat, no typing.
 *  - WelcomeReceived (left rail): "👋 N believers welcomed you", aggregated into
 *    one line (never N notifications), dismissible and remembered so it doesn't nag.
 *
 * Presentation over the welcomes.functions server layer; all matching/aggregation
 * is server + pure domain. Reuses the belief tap's wallet-session for the write.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getWelcomable,
  getWelcomesReceived,
  sendWelcomes,
  type WelcomablePerson,
} from "@/lib/welcomes.functions";
import { welcomeKey } from "@/domain/welcome";
import { bestEffort, useWalletSession } from "@/hooks/useWalletSession";
import { hueFor, initialsFor } from "@/lib/wallet-identity";

function Avatar({
  url,
  name,
  seed,
  size = 24,
}: {
  url: string | null;
  name: string;
  seed: string;
  size?: number;
}) {
  const s = `${size}px`;
  return url ? (
    <img
      src={url}
      alt=""
      className="shrink-0 rounded-full object-cover"
      style={{ width: s, height: s }}
    />
  ) : (
    <span
      className="grid shrink-0 place-items-center rounded-full text-[9px] font-semibold text-white"
      style={{ width: s, height: s, background: `hsl(${hueFor(seed)} 45% 45%)` }}
      aria-hidden
    >
      {initialsFor(name)}
    </span>
  );
}

/* ─────────────────────────── Sender: welcome them in ─────────────────────── */

export function WelcomePrompt({
  wallet,
  onSelectPerson,
}: {
  wallet?: string;
  /** Open a believer's profile so the viewer can explore their convictions. */
  onSelectPerson?: (wallet: string) => void;
}) {
  const qc = useQueryClient();
  const { ensureSession } = useWalletSession();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data } = useQuery({
    queryKey: ["welcomable", wallet ?? null],
    queryFn: () => getWelcomable({ data: { wallet } }),
    enabled: !!wallet,
    staleTime: 30_000,
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });
  const people = data?.people ?? [];
  const count = data?.count ?? 0;

  const keyOf = (p: WelcomablePerson) => welcomeKey(p.wallet, p.marketId, p.side);

  const openSheet = () => {
    setSelected(new Set(people.map(keyOf))); // default: welcome everyone
    setOpen(true);
  };

  const send = useMutation({
    mutationFn: async () => {
      const chosen = people.filter((p) => selected.has(keyOf(p)));
      if (chosen.length === 0) return { welcomed: 0 };
      // Welcoming is free — never prompt the wallet to sign for it.
      return bestEffort(async () => {
        const session = await ensureSession({ interactive: false });
        return sendWelcomes({
          data: {
            wallet: wallet as string,
            session,
            recipients: chosen.map((p) => ({
              recipientWallet: p.wallet,
              marketId: p.marketId,
              side: p.side,
            })),
          },
        });
      });
    },
    onSuccess: () => {
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ["welcomable", wallet ?? null] });
    },
  });

  if (!wallet || count === 0) return null;
  const selectedCount = selected.size;

  return (
    <>
      <div
        className="mb-4 flex items-center gap-3 rounded-[12px] px-3 py-2.5"
        style={{ border: "1px solid var(--border)", background: "var(--surface)" }}
      >
        <span className="text-[16px]" aria-hidden>
          👋
        </span>
        <span className="min-w-0 flex-1 text-[12px] leading-snug text-[var(--text-secondary)]">
          {count} {count === 1 ? "person" : "people"} like you joined your tribe.
        </span>
        <button
          type="button"
          onClick={openSheet}
          className="shrink-0 rounded-[10px] px-3 py-1.5 text-[12px] font-semibold"
          style={{ background: "var(--text)", color: "var(--bg)" }}
        >
          Welcome
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/50"
          />
          <div
            className="relative z-10 flex max-h-[80vh] w-full max-w-[420px] flex-col rounded-t-[18px] sm:rounded-[18px]"
            style={{ background: "var(--panel,var(--bg))", border: "1px solid var(--border)" }}
          >
            <div className="px-4 pb-2 pt-4">
              <div className="text-[15px] font-semibold text-[var(--text)]">
                Welcome new believers
              </div>
              <div className="mt-0.5 text-[12px] text-[var(--text-muted)]">
                They just joined a side you back. One tap says you saw them.
              </div>
            </div>

            <ul className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
              {people.map((p) => {
                const k = keyOf(p);
                const on = selected.has(k);
                return (
                  <li key={k}>
                    <button
                      type="button"
                      onClick={() =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(k)) next.delete(k);
                          else next.add(k);
                          return next;
                        })
                      }
                      className="flex w-full items-center gap-2.5 rounded-[10px] px-2 py-2 text-left transition-colors hover:bg-[var(--border)]/30"
                    >
                      <span
                        className="grid h-4 w-4 shrink-0 place-items-center rounded-[5px] text-[10px] font-bold"
                        style={
                          on
                            ? { background: "var(--text)", color: "var(--bg)" }
                            : { border: "1.5px solid var(--border)" }
                        }
                        aria-hidden
                      >
                        {on ? "✓" : ""}
                      </span>
                      <Avatar url={p.avatarUrl} name={p.name} seed={p.wallet} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-[var(--text)]">
                          {p.name}
                        </span>
                        <span className="block truncate text-[11px] text-[var(--text-muted)]">
                          <span
                            className="font-semibold"
                            style={{ color: p.side === "YES" ? "var(--yes)" : "var(--no)" }}
                          >
                            {p.side}
                          </span>{" "}
                          · {p.marketTitle}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <div
              className="flex items-center gap-2 px-4 py-3"
              style={{ borderTop: "1px solid var(--border)" }}
            >
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-[12px] px-3 py-2.5 text-[13px] font-medium text-[var(--text-secondary)]"
              >
                Not now
              </button>
              <button
                type="button"
                disabled={selectedCount === 0 || send.isPending}
                onClick={() => send.mutate()}
                className="flex-1 rounded-[12px] py-2.5 text-[14px] font-semibold disabled:opacity-40"
                style={{ background: "var(--text)", color: "var(--bg)" }}
              >
                {send.isPending
                  ? "Welcoming…"
                  : selectedCount === people.length
                    ? `Welcome all (${selectedCount})`
                    : `Welcome (${selectedCount})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ─────────────────────────── Recipient: you were welcomed ────────────────── */

const seenKey = (wallet: string) => `cc:welcomes-seen:${wallet.toLowerCase()}`;

export function WelcomeReceived({ wallet }: { wallet?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [dismissedAt, setDismissedAt] = useState<string | null>(() => {
    if (typeof window === "undefined" || !wallet) return null;
    try {
      return window.localStorage.getItem(seenKey(wallet));
    } catch {
      return null;
    }
  });

  const { data } = useQuery({
    queryKey: ["welcomes-received", wallet ?? null],
    queryFn: () => getWelcomesReceived({ data: { wallet } }),
    enabled: !!wallet,
    staleTime: 60_000,
    refetchInterval: 120_000,
    placeholderData: (prev) => prev,
  });

  const fresh = useMemo(() => {
    if (!data || data.count === 0 || !data.latestAt) return false;
    return !dismissedAt || new Date(data.latestAt) > new Date(dismissedAt);
  }, [data, dismissedAt]);

  if (!wallet || !data || !fresh) return null;

  const dismiss = () => {
    if (data.latestAt) {
      try {
        window.localStorage.setItem(seenKey(wallet), data.latestAt);
      } catch {
        /* private mode — fall back to in-memory dismissal */
      }
      setDismissedAt(data.latestAt);
    }
  };

  const tribe = data.side ? ` to the ${data.side} tribe` : "";

  return (
    <div
      className="mb-4 rounded-[12px] px-3 py-2.5"
      style={{
        border: "1px solid var(--border)",
        background: "color-mix(in oklab, var(--rel,#9b87f5) 8%, transparent)",
      }}
    >
      <div className="flex items-center gap-2.5">
        <span className="text-[16px]" aria-hidden>
          👋
        </span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="min-w-0 flex-1 text-left text-[12px] leading-snug text-[var(--text)]"
        >
          {data.count} {data.count === 1 ? "believer" : "believers"} welcomed you{tribe}.
        </button>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={dismiss}
          className="shrink-0 rounded-full px-1.5 text-[13px] leading-none text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
        >
          ✕
        </button>
      </div>
      {expanded && data.welcomers.length > 0 && (
        <ul className="mt-2 space-y-1 pl-7">
          {data.welcomers.map((w) => (
            <li key={w.wallet} className="flex items-center gap-2">
              <Avatar url={w.avatarUrl} name={w.name} seed={w.wallet} size={20} />
              <span className="truncate text-[12px] text-[var(--text-secondary)]">{w.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
