/**
 * The Daily Room — belonging, one tap, once a day.
 *
 * Two calm surfaces on top of the existing rails:
 *  - WelcomePrompt (center rail): the room. Everyone who joined a side you
 *    hold, grouped by WHO THEY ARE TO YOU (Twin / Tribe / crossed-over Opp /
 *    new face) rather than by market, with a "since you were last here" line
 *    that refills every day. One tap says hi to all of them.
 *  - WelcomeReceived (left rail): "N believers welcomed you", aggregated into
 *    one line (never N notifications), dismissible and remembered.
 *
 * Presentation over the welcomes.functions server layer; all matching,
 * grouping and headline copy is server + pure domain (@/domain/welcome).
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Collapsible } from "@/components/Collapsible";
import { useSticky } from "@/hooks/useSticky";
import {
  getWelcomable,
  getWelcomesReceived,
  markRoomSeen,
  sendWelcomes,
  type WelcomablePerson,
} from "@/lib/welcomes.functions";
import { ROOM_GROUP_LABEL, roomGroupFor, roomReason, welcomeKey } from "@/domain/welcome";
import { bestEffort, useWalletSession } from "@/hooks/useWalletSession";
import { hueFor, initialsFor } from "@/lib/wallet-identity";
import { RELATIONSHIP_TEXT, relationshipTone } from "@/lib/dna-labels";
import type { RelationshipLabel } from "@/domain/dna/config";

function relLabel(relationship: string | null): string | null {
  if (!relationship || relationship === "insufficient" || relationship === "neutral") return null;
  return RELATIONSHIP_TEXT[relationship as RelationshipLabel] ?? null;
}

function relTone(relationship: string | null) {
  return relationshipTone((relationship ?? "insufficient") as RelationshipLabel);
}

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

/** Small relationship chip — the vocabulary of the whole app, in one word. */
function RelChip({ relationship }: { relationship: string | null }) {
  const label = relLabel(relationship);
  if (!label) return null;
  const tone = relTone(relationship);
  return (
    <span
      className="shrink-0 rounded-[5px] px-1.5 py-[1px] text-[9.5px] font-semibold uppercase tracking-wide"
      style={{ color: tone.fg, background: tone.bg }}
    >
      {label}
    </span>
  );
}

/* ─────────────────────────── The room: say hi ─────────────────────── */

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
  /** Which face the viewer is curious about (wallet), or null. */
  const [peek, setPeek] = useState<string | null>(null);

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
  const sections = data?.sections ?? [];

  const peekedNow = peek ? (people.find((p) => p.wallet === peek) ?? null) : null;
  // The panel stays mounted while it collapses, so it needs something to render
  // on the way out. Without this the text disappears the instant the reader
  // deselects and the box animates closed around nothing.
  const peeked = useSticky(peekedNow ?? undefined, () => false) ?? null;

  // Rarest commonality first, one face per person. FOUR faces, not seven: past
  // that the row reads as a crowd rather than as people, and the "+N" carries
  // the size better than a squeezed eighth avatar ever did.
  const ordered = useMemo(() => sections.flatMap((s) => s.people), [sections]);
  const MAX_FACES = 4;
  const shown = ordered.slice(0, MAX_FACES);
  const hidden = ordered.length - shown.length;
  const overlap = -6;


  const keyOf = (p: WelcomablePerson) => welcomeKey(p.wallet, p.marketId, p.side);

  const openSheet = () => {
    setSelected(new Set(people.map(keyOf))); // default: say hi to everyone
    setOpen(true);
  };

  /** Saying hi also marks the room seen — that's what makes tomorrow a delta. */
  const send = useMutation({
    mutationFn: async () => {
      const chosen = people.filter((p) => selected.has(keyOf(p)));
      if (chosen.length === 0) return { welcomed: 0 };
      // A welcome puts YOUR NAME in someone else's interface, so the server now
      // requires proof of the wallet rather than trusting the claimed one. That
      // makes this the one place the gesture may open the wallet: it is an
      // explicit, deliberate act, the signature is once per device, and every
      // hello after it is free. Sending unsigned was what let anyone say hi as
      // anyone.
      const session = await ensureSession({ interactive: true });
      const res = await sendWelcomes({
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
      await markRoomSeen({ data: { wallet: wallet as string, session } });
      return res;
    },
    onSuccess: () => {
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ["welcomable", wallet ?? null] });
      void qc.invalidateQueries({ queryKey: ["welcomes-received"] });
    },
  });

  /**
   * "Seen it" without saying hi — the room resets, the people stay.
   *
   * Stays non-interactive: this writes only the reader's own visit counter and
   * is worth nobody's signature prompt. It now needs a session to land, so a
   * reader who has never signed simply keeps seeing the same room until they
   * do — a degraded ritual, not a broken one, and it heals on their first
   * signed action.
   */
  const seen = useMutation({
    mutationFn: async () => {
      const session = await bestEffort(() => ensureSession({ interactive: false }));
      if (!session) return { ok: false };
      return markRoomSeen({ data: { wallet: wallet as string, session } });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["welcomable", wallet ?? null] }),
  });

  // NOT `return null` when the room is empty. This card sits above the live tape
  // in a flex column, so removing it in one frame moves "Now" and every row
  // below it — and the room fills and empties on its own while a reader is
  // looking elsewhere. It collapses instead; see components/Collapsible.
  const hasRoom = !!wallet && count > 0;
  const selectedCount = selected.size;
  const headline = data?.headline ?? "";

  /** The headline already names them — the button is just the next step. */
  const cardLabel = "Say Hi";
  const selectedNames = people.filter((p) => selected.has(keyOf(p))).map((p) => p.name);
  const sheetLabel = selectedNames.length > 1 ? `Say Hi to ${selectedNames.length}` : "Say Hi";

  return (
    <>
      <Collapsible open={hasRoom} probe="welcome" className="mb-4">
        <div className="rounded-[14px] px-3.5 py-3" style={{ background: "var(--surface)" }}>
          <div className="flex items-start gap-2.5">
            <span className="mt-[1px] text-[17px] leading-none" aria-hidden>
              👋
            </span>
            <div className="min-w-0 flex-1">
              {/* Two lines reserved: the headline is generated from who is in the
              room, so it rewraps on its own and would otherwise resize the card
              under a reader who is not touching anything. */}
              <div
                className="text-[13px] font-semibold break-words text-[var(--text)]"
                style={{ minHeight: 36 }}
              >
                {headline}
              </div>
            </div>
            <button
              type="button"
              aria-label="Mark the room as seen"
              onClick={() => seen.mutate()}
              className="shrink-0 rounded-full px-1.5 text-[13px] leading-none text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
            >
              ✕
            </button>
          </div>

          {/* One line: the faces (rarest commonality first) and the action. The
            stack tightens as the room fills, so height never grows with it. */}
          <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
            <div className="flex min-w-0 items-center">
              {shown.map((p, i) => {
                const active = peek === p.wallet;
                return (
                  <button
                    key={p.wallet}
                    type="button"
                    onClick={() => setPeek(active ? null : p.wallet)}
                    aria-expanded={active}
                    aria-label={`Why this believer is in your room: ${roomReason(p).why}`}
                    className="shrink-0 rounded-full p-[2px] transition-transform hover:-translate-y-0.5 hover:z-10"
                    style={{
                      background: p.side === "YES" ? "var(--yes)" : "var(--no)",
                      marginLeft: i === 0 ? 0 : overlap,
                      zIndex: active ? 20 : shown.length - i,
                      outline: active ? "2px solid var(--text)" : "none",
                      outlineOffset: "1px",
                      opacity: p.isNew || active ? 1 : 0.78,
                    }}
                  >
                    <span
                      className="block rounded-full p-[1.5px]"
                      style={{ background: "var(--surface)" }}
                    >
                      <Avatar url={p.avatarUrl} name={p.name} seed={p.wallet} size={28} />
                    </span>
                  </button>
                );
              })}
              {hidden > 0 && (
                <button
                  type="button"
                  onClick={openSheet}
                  aria-label={`See ${hidden} more in the room`}
                  className="grid h-[32px] shrink-0 place-items-center rounded-full px-2 text-[11px] font-semibold text-[var(--text-secondary)]"
                  style={{
                    marginLeft: overlap,
                    background: "var(--surface-2)",
                  }}
                >
                  +{hidden}
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={openSheet}
              className="max-w-[190px] shrink-0 truncate rounded-[10px] px-3.5 py-2 text-[12.5px] font-semibold"
              style={{ background: "var(--text)", color: "var(--bg)" }}
            >
              {cardLabel}
            </button>
          </div>

          {/* One face at a time: why they're here, then what you already share.
          Tapping a face used to insert this block instantly, shoving the tape
          below down by its full height — the reader's own tap, and still a jump.
          It grows downward from the faces instead. `peeked` is kept mounted
          through the close so the text does not vanish mid-collapse. */}
          <Collapsible open={!!peekedNow} probe="welcome-peek">
            <div
              className="mt-2 rounded-[10px] px-2.5 py-2"
              style={{ background: "var(--surface-2)" }}
            >
              {peeked && (
                <>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                      {ROOM_GROUP_LABEL[roomGroupFor(peeked.relationship)]}
                    </span>
                    <RelChip relationship={peeked.relationship} />
                  </div>
                  <div className="mt-0.5 text-[11.5px] leading-snug break-words text-[var(--text)]">
                    {roomReason(peeked).why}
                  </div>
                  <div className="mt-0.5 text-[11px] leading-snug break-words text-[var(--text-muted)]">
                    {roomReason(peeked).history}
                  </div>
                  {onSelectPerson && peeked && (
                    <button
                      type="button"
                      onClick={() => onSelectPerson(peeked.wallet)}
                      className="mt-1.5 text-[11px] font-semibold text-[var(--text-secondary)] underline"
                    >
                      See who they are →
                    </button>
                  )}
                </>
              )}
            </div>
          </Collapsible>
        </div>
      </Collapsible>

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
            style={{
              background: "var(--panel,var(--bg))",
              boxShadow: "0 -12px 40px rgba(0,0,0,.35)",
            }}
          >
            <div className="flex items-start gap-2 px-4 pb-2 pt-4">
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold text-[var(--text)]">Today's room</div>
                <div className="mt-0.5 text-[12px] break-words text-[var(--text-muted)]">
                  {headline}
                </div>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                className="-mr-1 shrink-0 rounded-full px-2 py-1 text-[15px] leading-none text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
              >
                ✕
              </button>
            </div>

            <ul className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
              {people.map((p) => {
                const k = keyOf(p);
                const on = selected.has(k);
                return (
                  <li key={k} className="flex items-center gap-1.5 px-2">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      aria-label={`Say hi to ${p.name}`}
                      onClick={() =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(k)) next.delete(k);
                          else next.add(k);
                          return next;
                        })
                      }
                      className="grid h-4 w-4 shrink-0 place-items-center rounded-[5px] text-[10px] font-bold"
                      style={
                        on
                          ? { background: "var(--text)", color: "var(--bg)" }
                          : { border: "1.5px solid var(--border)" }
                      }
                    >
                      {on ? "✓" : ""}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!onSelectPerson) return;
                        setOpen(false);
                        onSelectPerson(p.wallet);
                      }}
                      aria-label={`Open ${p.name}'s profile`}
                      disabled={!onSelectPerson}
                      className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[10px] px-2 py-2 text-left transition-colors hover:bg-[var(--surface-2)] disabled:cursor-default"
                    >
                      <span
                        className="block shrink-0 rounded-full p-[2px]"
                        style={{ background: p.side === "YES" ? "var(--yes)" : "var(--no)" }}
                      >
                        <span
                          className="block rounded-full p-[1.5px]"
                          style={{ background: "var(--surface)" }}
                        >
                          <Avatar url={p.avatarUrl} name={p.name} seed={p.wallet} size={26} />
                        </span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="break-words text-[12.5px] font-semibold text-[var(--text)]">
                            {p.name}
                          </span>
                          <RelChip relationship={p.relationship} />
                        </span>
                        <span className="block break-words text-[11.5px] text-[var(--text-secondary)]">
                          {roomReason(p).why}
                        </span>
                        <span className="block break-words text-[11px] text-[var(--text-muted)]">
                          {roomReason(p).history}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="px-4 py-3" style={{ borderTop: "1px solid var(--hairline)" }}>
              {send.isError && (
                <div className="mb-2 text-[11.5px] text-[var(--no,#e5484d)]">
                  Couldn't say hi just now. Try again.
                </div>
              )}
              <button
                type="button"
                disabled={selectedCount === 0 || send.isPending}
                onClick={() => send.mutate()}
                className="w-full truncate rounded-[12px] py-2.5 text-[14px] font-semibold disabled:opacity-40"
                style={{ background: "var(--text)", color: "var(--bg)" }}
              >
                {send.isPending ? "Saying hi…" : sheetLabel}
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

export function WelcomeReceived({
  wallet,
  onSelectPerson,
}: {
  wallet?: string;
  onSelectPerson?: (wallet: string) => void;
}) {
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
  // Lead with the relationship when there is one — "your Twin said hi" is a
  // different event from "someone said hi".
  const lead = data.welcomers[0];
  const leadRel = relLabel(lead?.relationship ?? null);
  const line =
    data.count === 1 && lead
      ? leadRel
        ? `Your ${leadRel} ${lead.name} said hi.`
        : `${lead.name} welcomed you${tribe}.`
      : `${data.count} believers welcomed you${tribe}.`;

  return (
    <div
      className="mb-4 rounded-[12px] px-3 py-2.5"
      style={{
        background: "color-mix(in oklab, var(--rel,#9b87f5) 12%, var(--surface))",
      }}
    >
      <div className="flex items-center gap-2.5">
        <span className="text-[16px]" aria-hidden>
          👋
        </span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="min-w-0 flex-1 text-left text-[12px] leading-snug break-words text-[var(--text)]"
        >
          {line}
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
              <button
                type="button"
                onClick={() => onSelectPerson?.(w.wallet)}
                disabled={!onSelectPerson}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left disabled:cursor-default"
              >
                <span className="break-words text-[12px] text-[var(--text-secondary)]">
                  {w.name}
                </span>
                <RelChip relationship={w.relationship} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
