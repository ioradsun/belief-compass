/**
 * FORGE — Discovery, the pre-job planning session.
 *
 * Opens in the centre of the control room when you start a new job. The AI is
 * the CTO: it has read the code, and it asks YOU — the business — one question
 * at a time until the plan is buildable. The plan builds on the right as you
 * talk. Only when it is complete does "Proceed" hand it to the pipeline.
 *
 * Nothing is written during discovery. The escape hatch files a job directly
 * for a change too small to be worth the conversation.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  forgeDiscoveryGet,
  forgeDiscoveryProceed,
  forgeDiscoverySend,
  forgeDiscoveryStart,
} from "@/lib/forge-discovery.functions";
import { forgeCreateJob } from "@/lib/forge.functions";
import {
  FORGE_MODES,
  MODE_BLURB,
  type DiscoveryMessage,
  type DiscoveryPlan,
  type ForgeMode,
} from "@/lib/forge/types";

const PLAN_LISTS: { key: keyof DiscoveryPlan; label: string }[] = [
  { key: "edgeCases", label: "Edge cases" },
  { key: "constraints", label: "Constraints" },
  { key: "acceptanceCriteria", label: "Acceptance criteria" },
  { key: "relevantFiles", label: "Relevant files" },
  { key: "openQuestions", label: "Open questions" },
];

export function ForgeDiscovery({
  sessionId: initialSessionId,
  onProceed,
  onClose,
  onStarted,
}: {
  sessionId: string | null;
  onProceed: (jobId: string) => void;
  onClose: () => void;
  onStarted: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId);
  const [request, setRequest] = useState("");
  const [mode, setMode] = useState<ForgeMode>("DEBATE");
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : "Something went wrong.");

  // The URL is the source of truth for which session is open, so resuming from
  // the rail (or a refresh) just points this at a different id.
  useEffect(() => {
    setSessionId(initialSessionId);
    setError(null);
  }, [initialSessionId]);

  const session = useQuery({
    queryKey: ["forge-discovery", sessionId],
    queryFn: () => forgeDiscoveryGet({ data: { id: sessionId as string } }),
    enabled: Boolean(sessionId),
  });

  const start = useMutation({
    mutationFn: () => forgeDiscoveryStart({ data: { request: request.trim(), mode } }),
    onSuccess: (s) => {
      setError(null);
      setSessionId(s.id);
      qc.setQueryData(["forge-discovery", s.id], s);
      onStarted(s.id);
    },
    onError: fail,
  });
  const send = useMutation({
    mutationFn: (message: string) =>
      forgeDiscoverySend({ data: { id: sessionId as string, message } }),
    onSuccess: (s) => qc.setQueryData(["forge-discovery", sessionId], s),
    onError: fail,
  });
  const skip = useMutation({
    mutationFn: () => forgeCreateJob({ data: { request: request.trim(), mode } }),
    onSuccess: (r) => onProceed(r.id),
    onError: fail,
  });
  const proceed = useMutation({
    mutationFn: () => forgeDiscoveryProceed({ data: { id: sessionId as string } }),
    onSuccess: (r) => onProceed(r.jobId),
    onError: fail,
  });

  const submit = (text: string) => {
    const t = text.trim();
    if (!t || send.isPending) return;
    setInput("");
    send.mutate(t);
  };

  /* ── initial entry ──────────────────────────────────────────────────────*/
  if (!sessionId) {
    const ready = request.trim().length >= 8;
    return (
      <Shell onClose={onClose}>
        <div className="flex min-h-0 flex-1 items-center justify-center px-6">
          <div className="w-full max-w-[620px]">
            <h1 className="text-[24px] font-medium leading-[1.2] tracking-[-0.02em]">
              What should Conviction become next?
            </h1>
            <p className="mt-1 text-[13px] leading-[1.6] text-[var(--text-muted)]">
              Say it plainly. The CTO reads the code and asks you the questions that turn it into a
              plan — before anything is built.
            </p>
            <textarea
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              rows={4}
              autoFocus
              placeholder="e.g. Let people challenge a specific person directly, not just the open feed."
              className="mt-4 w-full resize-none rounded-[6px] border border-[var(--hairline)] bg-[var(--bg)] px-3 py-2.5 text-[14px] leading-[1.6] outline-none focus:border-[var(--border-strong)]"
            />
            <div className="mt-3 flex flex-wrap gap-1.5">
              {FORGE_MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  title={MODE_BLURB[m]}
                  className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] ${
                    mode === m
                      ? "border-[var(--rel,#9b87f5)] bg-[var(--surface)] text-[var(--text)]"
                      : "border-[var(--border)] text-[var(--text-muted)]"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            {error && <p className="mt-3 text-[12px] text-[var(--loss)]">{error}</p>}
            <div className="mt-5 flex items-center gap-3">
              <button
                type="button"
                disabled={!ready || start.isPending}
                onClick={() => start.mutate()}
                className="rounded-[6px] bg-[var(--text)] px-4 py-2 text-[13px] font-semibold text-[var(--bg)] disabled:opacity-35"
              >
                {start.isPending ? "Reading the code…" : "Start discovery"}
              </button>
              <button
                type="button"
                disabled={!ready || skip.isPending}
                onClick={() => skip.mutate()}
                className="text-[12px] text-[var(--text-muted)] underline underline-offset-2 hover:text-[var(--text)] disabled:opacity-35"
              >
                {skip.isPending ? "Filing…" : "Skip — file it directly"}
              </button>
            </div>
          </div>
        </div>
      </Shell>
    );
  }

  /* ── the conversation ───────────────────────────────────────────────────*/
  const s = session.data;
  const plan = s?.plan;
  const lastAi = [...(s?.messages ?? [])].reverse().find((m) => m.role === "ai");
  const chips = s?.status === "active" && !send.isPending ? (lastAi?.suggestedAnswers ?? []) : [];

  return (
    <Shell onClose={onClose} request={s?.request}>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        {/* conversation */}
        <section className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] border-r border-[var(--hairline)]">
          <div className="min-h-0 overflow-y-auto px-6 py-5">
            {session.isPending && !s ? (
              <p className="text-[12px] text-[var(--text-muted)]">Reading the code…</p>
            ) : (
              <ul className="flex flex-col gap-4">
                {(s?.messages ?? []).map((m, i) => (
                  <Bubble key={i} message={m} />
                ))}
                {send.isPending && (
                  <li className="text-[12px] text-[var(--text-muted)]">The CTO is thinking…</li>
                )}
              </ul>
            )}
            {chips.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {chips.map((c, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => submit(c)}
                    className="rounded-full border border-[var(--border-strong)] px-3 py-1.5 text-[12px] hover:border-[var(--rel,#9b87f5)] hover:bg-[var(--surface)]"
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-[var(--hairline)] bg-[var(--panel)] px-4 py-3">
            {error && <p className="mb-2 text-[12px] text-[var(--loss)]">{error}</p>}
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit(input);
                  }
                }}
                rows={1}
                placeholder={
                  s?.status === "active"
                    ? "Answer the CTO, or type your own…"
                    : "This session is closed."
                }
                disabled={s?.status !== "active"}
                className="min-h-[40px] flex-1 resize-none rounded-[6px] border border-[var(--hairline)] bg-[var(--bg)] px-3 py-2 text-[13px] outline-none focus:border-[var(--border-strong)] disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => submit(input)}
                disabled={!input.trim() || send.isPending || s?.status !== "active"}
                className="rounded-[6px] border border-[var(--border-strong)] px-3.5 py-2 text-[12px] font-semibold disabled:opacity-35"
              >
                Send
              </button>
            </div>
          </div>
        </section>

        {/* plan so far */}
        <aside className="flex min-h-0 flex-col bg-[var(--panel)]">
          <div className="flex items-baseline justify-between border-b border-[var(--hairline)] px-5 py-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
              Plan so far
            </span>
            <span
              className="text-[10px] font-semibold uppercase tracking-[0.12em]"
              style={{ color: s?.ready ? "var(--gain)" : "var(--no,#f5a623)" }}
            >
              {s?.ready ? "Complete" : "Forming"}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <PlanText label="Problem" value={plan?.problem} />
            <PlanText label="Desired behavior" value={plan?.behavior} />
            {PLAN_LISTS.map(({ key, label }) => (
              <PlanList key={key} label={label} items={(plan?.[key] as string[]) ?? []} />
            ))}
          </div>
          <div className="border-t border-[var(--hairline)] px-5 py-3">
            <button
              type="button"
              onClick={() => proceed.mutate()}
              disabled={!s?.ready || proceed.isPending || s?.status !== "active"}
              className="w-full rounded-[6px] py-2.5 text-[13px] font-semibold disabled:cursor-not-allowed"
              style={
                s?.ready && s?.status === "active"
                  ? { background: "var(--rel,#9b87f5)", color: "#fff" }
                  : { background: "var(--surface-2)", color: "var(--text-muted)" }
              }
            >
              {proceed.isPending
                ? "Filing…"
                : s?.status === "proceeded"
                  ? "Handed to the pipeline"
                  : s?.ready
                    ? "Proceed → hand to the pipeline"
                    : "Keep refining…"}
            </button>
            <p className="mt-1.5 text-[11px] leading-[1.4] text-[var(--text-muted)]">
              {s?.ready
                ? "Creates the job with this brief. Nothing was built during discovery."
                : "Proceed unlocks once the plan is complete."}
            </p>
          </div>
        </aside>
      </div>
    </Shell>
  );
}

/* ── pieces ─────────────────────────────────────────────────────────────── */

function Shell({
  children,
  onClose,
  request,
}: {
  children: React.ReactNode;
  onClose: () => void;
  request?: string;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--bg)]">
      <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-[var(--hairline)] bg-[var(--panel)] px-6">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--rel,#9b87f5)]">
          Discovery · CTO
        </span>
        {request && (
          <span className="min-w-0 truncate text-[13px] text-[var(--text-secondary)]">
            {request}
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded-[3px] border border-[var(--border)] px-2.5 py-1 text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          Close
        </button>
      </header>
      {children}
    </div>
  );
}

function Bubble({ message }: { message: DiscoveryMessage }) {
  const you = message.role === "you";
  return (
    <li className={`flex max-w-[94%] flex-col ${you ? "self-end items-end" : ""}`}>
      <span
        className="mb-1 text-[9px] font-semibold uppercase tracking-[0.16em]"
        style={{ color: you ? "var(--text-muted)" : "var(--rel,#9b87f5)" }}
      >
        {you ? "You · business" : "CTO · office-hours"}
      </span>
      <div
        className="whitespace-pre-wrap rounded-[8px] border border-[var(--hairline)] px-3.5 py-2.5 text-[13px] leading-[1.6]"
        style={{ background: you ? "var(--surface)" : "var(--panel)" }}
      >
        {message.content}
      </div>
    </li>
  );
}

function PlanText({ label, value }: { label: string; value?: string }) {
  return (
    <div className="mb-4">
      <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
        {label}
      </h4>
      {value ? (
        <p className="text-[12.5px] leading-[1.55] text-[var(--text)]">{value}</p>
      ) : (
        <p className="text-[12px] italic text-[var(--text-muted)]">Surfacing…</p>
      )}
    </div>
  );
}

function PlanList({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mb-4">
      <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
        {label} <span className="num text-[var(--text-muted)]">({items.length})</span>
      </h4>
      <ul className="flex flex-col gap-1">
        {items.map((it, i) => (
          <li key={i} className="text-[12.5px] leading-[1.5] text-[var(--text-secondary)]">
            · {it}
          </li>
        ))}
      </ul>
    </div>
  );
}
