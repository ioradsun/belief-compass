/**
 * FORGE — the autonomous loop.
 *
 * A queue of bugs / feature requests / friction, an on/off switch, and a driver
 * that turns the next item into a Forge job whose output is a pull request. A
 * human approves every merge; the loop never deploys.
 *
 * While this view is open and the loop is ON, it ticks the driver on an interval
 * so the queue advances. (Unattended scheduling is a later slice.)
 */
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  forgeEnqueue,
  forgeGetLoop,
  forgeListQueue,
  forgeLoopTick,
  forgeSetLoop,
} from "@/lib/forge-loop.functions";

const KINDS = ["bug", "feature", "friction", "chore"] as const;

const STATUS_TONE: Record<string, string> = {
  pending: "text-[var(--text-muted)]",
  running: "text-amber-400",
  pr_open: "text-emerald-400",
  done: "text-emerald-400",
  rejected: "text-red-400",
};

type QueueItem = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  status: string;
  job_id: string | null;
  created_at: string;
};

export function ForgeLoop() {
  const qc = useQueryClient();
  const loop = useQuery({ queryKey: ["forge-loop"], queryFn: () => forgeGetLoop() });
  const queue = useQuery({
    queryKey: ["forge-queue"],
    queryFn: () => forgeListQueue() as Promise<QueueItem[]>,
    refetchInterval: 5000,
  });

  const enabled = loop.data?.enabled === true;

  const setLoop = useMutation({
    mutationFn: (v: boolean) => forgeSetLoop({ data: { enabled: v } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-loop"] }),
  });
  const tick = useMutation({
    mutationFn: () => forgeLoopTick(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["forge-queue"] });
      qc.invalidateQueries({ queryKey: ["forge-jobs"] });
    },
  });
  const enqueue = useMutation({
    mutationFn: (v: { kind: string; title: string; body: string }) => forgeEnqueue({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-queue"] }),
  });

  // Drive the loop while this view is open and it's on.
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      if (!tick.isPending) tick.mutate();
    }, 20000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const [kind, setKind] = useState<string>("bug");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const items = queue.data ?? [];
  const pending = items.filter((i) => i.status === "pending").length;

  return (
    <main className="forge-room min-h-[100dvh] w-full bg-[var(--bg)] text-[var(--text)]">
      <div className="mx-auto max-w-[880px] px-6 py-8">
        <header className="mb-6 flex items-baseline justify-between gap-4">
          <span className="whitespace-nowrap text-[11px] uppercase tracking-[0.3em] text-[var(--text-muted)]">
            Conviction · Forge · Loop
          </span>
          <Link to="/admin/forge" search={{}} className="text-[12px] underline">
            ← Back to Forge
          </Link>
        </header>

        {/* Switch + driver */}
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border,rgba(255,255,255,0.12))] p-4">
          <button
            onClick={() => setLoop.mutate(!enabled)}
            disabled={setLoop.isPending}
            className={`rounded-md border px-3 py-1.5 text-[13px] ${
              enabled
                ? "border-emerald-500 text-emerald-400"
                : "border-[var(--border,rgba(255,255,255,0.2))] text-[var(--text-muted)]"
            }`}
          >
            Loop: {enabled ? "ON" : "OFF"}
          </button>
          <span className="text-[12px] text-[var(--text-muted)]">
            {pending} pending · one job at a time · output is always a PR (you approve)
          </span>
          <button
            onClick={() => tick.mutate()}
            disabled={tick.isPending}
            className="ml-auto rounded-md border border-[var(--border,rgba(255,255,255,0.2))] px-3 py-1.5 text-[12px] hover:border-[var(--text-muted)]"
          >
            {tick.isPending ? "running…" : "Run next now"}
          </button>
        </div>
        {tick.data && "reason" in tick.data && (
          <p className="mb-4 text-[11px] text-[var(--text-muted)]">Driver: {String(tick.data.reason)}</p>
        )}

        {/* Add an item */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim().length < 3) return;
            enqueue.mutate({ kind, title: title.trim(), body: body.trim() });
            setTitle("");
            setBody("");
          }}
          className="mb-6 flex flex-col gap-2 rounded-lg border border-[var(--border,rgba(255,255,255,0.12))] p-4"
        >
          <div className="flex gap-2">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="rounded-md border border-[var(--border,rgba(255,255,255,0.12))] bg-transparent px-2 py-2 text-[13px]"
            >
              {KINDS.map((k) => (
                <option key={k} value={k} className="bg-[var(--bg)]">
                  {k}
                </option>
              ))}
            </select>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What should the agent improve? (title)"
              className="flex-1 rounded-md border border-[var(--border,rgba(255,255,255,0.12))] bg-transparent px-3 py-2 text-[13px] outline-none focus:border-[var(--text-muted)]"
            />
            <button
              type="submit"
              disabled={enqueue.isPending}
              className="rounded-md border border-[var(--text)] px-3 py-2 text-[13px]"
            >
              Add
            </button>
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Evidence / details (optional)"
            rows={2}
            className="rounded-md border border-[var(--border,rgba(255,255,255,0.12))] bg-transparent px-3 py-2 text-[13px] outline-none focus:border-[var(--text-muted)]"
          />
        </form>

        {/* Queue */}
        <div className="overflow-hidden rounded-lg border border-[var(--border,rgba(255,255,255,0.12))]">
          {items.length === 0 && (
            <div className="p-4 text-[12px] text-[var(--text-muted)]">
              Queue is empty. Add a bug or feature request above.
            </div>
          )}
          {items.map((i) => (
            <div
              key={i.id}
              className="flex items-center justify-between gap-3 border-b border-[var(--border,rgba(255,255,255,0.08))] px-3 py-2 last:border-b-0"
            >
              <span className="min-w-0">
                <span className="block truncate text-[13px]">
                  <span className="text-[var(--text-muted)]">[{i.kind}]</span> {i.title}
                </span>
                {i.body && (
                  <span className="block truncate text-[11px] text-[var(--text-muted)]">{i.body}</span>
                )}
              </span>
              <span className="flex items-center gap-3 whitespace-nowrap">
                {i.job_id && (
                  <Link
                    to="/admin/forge"
                    search={{ job: i.job_id }}
                    className="text-[11px] underline text-[var(--text-muted)]"
                  >
                    job
                  </Link>
                )}
                <span className={`text-[11px] ${STATUS_TONE[i.status] ?? "text-[var(--text-muted)]"}`}>
                  {i.status}
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
