/**
 * FORGE — model configuration view.
 *
 * Which OpenRouter model plays each role (Builder / Challenger / Escalation) is
 * a setting, not a code constant. This view lists the live OpenRouter catalog
 * with per-1M pricing and lets an operator assign a model to each role; the
 * choice is stored server-side and used by the next job.
 *
 * Rendered inside /admin/forge behind `?view=models`, so it shares the control
 * room's session gate and never needs its own route.
 */
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  forgeGetModelConfig,
  forgeOpenRouterModels,
  forgeSetModelConfig,
} from "@/lib/forge.functions";

type Role = "builder" | "challenger" | "escalation";

const ROLES: { key: Role; label: string; blurb: string }[] = [
  { key: "builder", label: "Builder", blurb: "The engineer — implements the change." },
  { key: "challenger", label: "Challenger", blurb: "Attacks the plan and the diff." },
  { key: "escalation", label: "Escalation", blurb: "Security, money, deadlocks." },
];

const usd = (n: number) => (n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`);

export function ForgeModelConfig() {
  const qc = useQueryClient();
  const models = useQuery({ queryKey: ["or-models"], queryFn: () => forgeOpenRouterModels() });
  const cfg = useQuery({ queryKey: ["forge-model-config"], queryFn: () => forgeGetModelConfig() });
  const setModel = useMutation({
    mutationFn: (v: { role: Role; modelId: string }) => forgeSetModelConfig({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-model-config"] }),
  });

  const [role, setRole] = useState<Role>("builder");
  const [q, setQ] = useState("");

  const list = models.data ?? [];
  const byId = useMemo(() => new Map(list.map((m) => [m.id, m])), [list]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = needle
      ? list.filter(
          (m) => m.id.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle),
        )
      : list;
    return base.slice(0, 80);
  }, [list, q]);

  const selectedId = cfg.data?.[role];

  return (
    <main className="forge-room min-h-[100dvh] w-full bg-[var(--bg)] text-[var(--text)]">
      <div className="mx-auto max-w-[880px] px-6 py-8">
        <header className="mb-6 flex items-baseline justify-between gap-4">
          <span className="whitespace-nowrap text-[11px] uppercase tracking-[0.3em] text-[var(--text-muted)]">
            Conviction · Forge · Models
          </span>
          <Link to="/admin/forge" search={{}} className="text-[12px] underline">
            ← Back to Forge
          </Link>
        </header>

        <div className="flex flex-col gap-6">
          {/* Role cards — current assignment + price */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {ROLES.map((r) => {
              const id = cfg.data?.[r.key];
              const m = id ? byId.get(id) : undefined;
              const active = r.key === role;
              return (
                <button
                  key={r.key}
                  onClick={() => setRole(r.key)}
                  className={`rounded-lg border p-3 text-left transition ${
                    active
                      ? "border-[var(--text)] bg-[var(--bg-elev,rgba(255,255,255,0.05))]"
                      : "border-[var(--border,rgba(255,255,255,0.12))] hover:border-[var(--text-muted)]"
                  }`}
                >
                  <div className="text-[11px] uppercase tracking-[0.2em] text-[var(--text-muted)]">
                    {r.label}
                  </div>
                  <div className="mt-1 truncate text-[13px]" title={id}>
                    {id ?? "—"}
                  </div>
                  <div className="mt-1 text-[11px] text-[var(--text-muted)]">
                    {m
                      ? `${usd(m.promptPer1M)}/1M in · ${usd(m.completionPer1M)}/1M out`
                      : models.isPending
                        ? "pricing…"
                        : "unknown pricing"}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Picker for the active role */}
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <label className="text-[12px] text-[var(--text-muted)]">
                Assign a model to <span className="text-[var(--text)]">{role}</span>
              </label>
              {setModel.isPending && (
                <span className="text-[11px] text-[var(--text-muted)]">saving…</span>
              )}
              {setModel.isError && (
                <span className="text-[11px] text-red-400">
                  {(setModel.error as Error)?.message ?? "save failed"}
                </span>
              )}
            </div>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search OpenRouter models (e.g. deepseek, qwen, claude)…"
              className="w-full rounded-md border border-[var(--border,rgba(255,255,255,0.12))] bg-transparent px-3 py-2 text-[13px] outline-none focus:border-[var(--text-muted)]"
            />

            {models.isError && (
              <p className="mt-3 text-[12px] text-red-400">
                Could not load the OpenRouter catalog: {(models.error as Error)?.message}
              </p>
            )}

            <div className="mt-3 max-h-[46dvh] overflow-y-auto rounded-lg border border-[var(--border,rgba(255,255,255,0.12))]">
              {models.isPending && (
                <div className="p-4 text-[12px] text-[var(--text-muted)]">Loading catalog…</div>
              )}
              {filtered.map((m) => {
                const chosen = m.id === selectedId;
                return (
                  <button
                    key={m.id}
                    onClick={() => setModel.mutate({ role, modelId: m.id })}
                    className={`flex w-full items-center justify-between gap-4 border-b border-[var(--border,rgba(255,255,255,0.08))] px-3 py-2 text-left last:border-b-0 hover:bg-[var(--bg-elev,rgba(255,255,255,0.05))] ${
                      chosen ? "bg-[var(--bg-elev,rgba(255,255,255,0.07))]" : ""
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px]">
                        {chosen ? "✓ " : ""}
                        {m.id}
                      </span>
                      <span className="block truncate text-[11px] text-[var(--text-muted)]">
                        {m.name}
                        {m.contextLength ? ` · ${Math.round(m.contextLength / 1000)}k ctx` : ""}
                      </span>
                    </span>
                    <span className="whitespace-nowrap text-[11px] text-[var(--text-muted)]">
                      {usd(m.promptPer1M)} / {usd(m.completionPer1M)}
                      <span className="ml-1 opacity-60">per 1M</span>
                    </span>
                  </button>
                );
              })}
              {!models.isPending && filtered.length === 0 && (
                <div className="p-4 text-[12px] text-[var(--text-muted)]">No models match “{q}”.</div>
              )}
            </div>
            <p className="mt-2 text-[11px] text-[var(--text-muted)]">
              {list.length} models · showing {filtered.length}. Selecting a model saves immediately
              and applies to the next job.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
