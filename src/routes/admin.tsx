import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminLogin,
  adminLogout,
  adminQueue,
  adminResolveReport,
  adminSetVisibility,
  adminStatus,
} from "@/lib/admin.functions";

export const Route = createFileRoute("/admin")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Moderation — Conviction" },
      { name: "description", content: "Review reported Conviction markets and hide content." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Moderation — Conviction" },
      { property: "og:description", content: "Internal moderation console." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Admin,
});

function Admin() {
  const qc = useQueryClient();
  const { data: status } = useQuery({ queryKey: ["admin-status"], queryFn: () => adminStatus() });
  const unlocked = status?.unlocked === true;
  const [password, setPassword] = useState("");
  const [failed, setFailed] = useState(false);

  const login = useMutation({
    mutationFn: async () => await adminLogin({ data: { password } }),
    onSuccess: (r) => {
      setFailed(!r.ok);
      if (r.ok) qc.invalidateQueries();
    },
  });

  if (!unlocked) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-[var(--bg)] px-6 text-[var(--text)]">
        <form
          className="w-full max-w-[320px]"
          onSubmit={(e) => {
            e.preventDefault();
            login.mutate();
          }}
        >
          <h1 className="text-[18px] font-semibold">Moderation</h1>
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="mt-4 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[14px] outline-none focus:border-[var(--border-strong)]"
          />
          {failed && <p className="mt-2 text-[12px] text-[var(--no)]">Incorrect password.</p>}
          <button
            type="submit"
            className="mt-4 w-full rounded-md bg-[var(--text)] px-3 py-2 text-[14px] font-medium text-[var(--bg)]"
          >
            Unlock
          </button>
        </form>
      </main>
    );
  }

  return <Console onLock={() => qc.invalidateQueries()} />;
}

function Console({ onLock }: { onLock: () => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["admin-queue"], queryFn: () => adminQueue() });
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-queue"] });

  const hide = useMutation({
    mutationFn: async (v: { questionId: string; hidden: boolean }) =>
      await adminSetVisibility({ data: v }),
    onSuccess: refresh,
  });
  const resolve = useMutation({
    mutationFn: async (id: string) => await adminResolveReport({ data: { id } }),
    onSuccess: refresh,
  });

  return (
    <main className="mx-auto min-h-[100dvh] max-w-[900px] bg-[var(--bg)] px-6 py-10 text-[var(--text)]">
      <header className="flex items-center justify-between">
        <h1 className="text-[20px] font-semibold">Moderation</h1>
        <button
          type="button"
          onClick={async () => {
            await adminLogout();
            onLock();
          }}
          className="text-[12px] text-[var(--text-muted)] underline"
        >
          Lock
        </button>
      </header>

      <h2 className="mt-8 text-[12px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        Open reports
      </h2>
      <div className="mt-3 space-y-2">
        {(data?.reports ?? []).length === 0 && (
          <p className="text-[13px] text-[var(--text-muted)]">Nothing to review.</p>
        )}
        {(data?.reports ?? []).map((r) => (
          <div
            key={String(r.id)}
            className="flex items-start gap-3 rounded-md border border-[var(--border)] bg-[var(--surface)] p-3"
          >
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium">{r.reason}</div>
              <div className="truncate text-[12px] text-[var(--text-muted)]">
                {r.question_id ?? `market #${r.onchain_id}`} · {r.details ?? "no details"}
              </div>
            </div>
            {r.question_id && (
              <button
                type="button"
                onClick={() => hide.mutate({ questionId: r.question_id!, hidden: true })}
                className="shrink-0 rounded-md border border-[var(--border-strong)] px-2 py-1 text-[12px]"
              >
                Hide market
              </button>
            )}
            <button
              type="button"
              onClick={() => resolve.mutate(String(r.id))}
              className="shrink-0 rounded-md bg-[var(--text)] px-2 py-1 text-[12px] text-[var(--bg)]"
            >
              Resolve
            </button>
          </div>
        ))}
      </div>

      <h2 className="mt-10 text-[12px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        Conviction markets
      </h2>
      <div className="mt-3 space-y-2">
        {(data?.markets ?? []).map((m) => (
          <div
            key={m.question_id}
            className="flex items-center gap-3 rounded-md border border-[var(--border)] bg-[var(--surface)] p-3"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px]">{m.question}</div>
              <div className="truncate text-[12px] text-[var(--text-muted)]">
                {m.status}
                {m.onchain_id ? ` · #${m.onchain_id}` : ""} · {m.creator_wallet.slice(0, 10)}…
              </div>
            </div>
            <button
              type="button"
              onClick={() => hide.mutate({ questionId: m.question_id, hidden: !m.hidden })}
              className="shrink-0 rounded-md border border-[var(--border-strong)] px-2 py-1 text-[12px]"
            >
              {m.hidden ? "Restore" : "Hide"}
            </button>
          </div>
        ))}
      </div>
    </main>
  );
}
