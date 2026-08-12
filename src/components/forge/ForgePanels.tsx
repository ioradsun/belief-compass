/**
 * Forge display primitives. Dense, typographic, no decoration — this is an
 * engineering console, not a product surface.
 */
import type {
  ForgeCheck,
  ForgeEvent,
  ForgeJob,
  ForgeModelRun,
  ForgeObjection,
  ForgePhase,
  ObjectionSeverity,
} from "@/lib/forge/types";
import { MODEL_REGISTRY } from "@/lib/forge/models";
import { VERIFICATION_PROFILES } from "@/lib/forge/types";

export function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
        {label}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] text-[var(--text-muted)]">{children}</p>;
}

function time(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/* ── Pipeline ─────────────────────────────────────────────────────────── */

export function Pipeline({
  phases,
  status,
  currentPhase,
}: {
  phases: readonly ForgePhase[];
  status: ForgeJob["status"];
  currentPhase: string | null;
}) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
      {phases.map((p, i) => {
        const live = currentPhase === p.key || p.statuses.includes(status);
        return (
          <li key={p.key} className="flex items-center gap-2">
            <span
              className={
                live
                  ? "rounded border border-[var(--border-strong)] px-1.5 py-0.5 font-medium text-[var(--text)]"
                  : "px-1.5 py-0.5 text-[var(--text-muted)]"
              }
            >
              {p.label}
            </span>
            {i < phases.length - 1 && <span className="text-[var(--text-muted)]">→</span>}
          </li>
        );
      })}
    </ol>
  );
}

/* ── Activity ─────────────────────────────────────────────────────────── */

const GLYPH: Record<ForgeEvent["level"], string> = {
  success: "✓",
  info: "●",
  warn: "⚠",
  error: "✕",
};

export function Activity({ events }: { events: ForgeEvent[] }) {
  if (events.length === 0) return <Empty>No activity yet.</Empty>;
  return (
    <ul className="space-y-1 font-mono text-[12px] leading-[1.6]">
      {events.map((e) => (
        <li key={e.id} className="flex gap-2">
          <span className="w-[64px] shrink-0 text-[var(--text-muted)]">{time(e.createdAt)}</span>
          <span className="w-[14px] shrink-0">{GLYPH[e.level]}</span>
          <span className={e.level === "error" ? "text-[var(--loss)]" : undefined}>
            {e.role && e.role !== "system" && (
              <span className="mr-2 uppercase text-[var(--text-muted)]">{e.role}</span>
            )}
            {e.message}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ── Debate ───────────────────────────────────────────────────────────── */

const SEVERITY_TONE: Record<ObjectionSeverity, string> = {
  CRITICAL: "text-[var(--loss)]",
  HIGH: "text-[var(--loss)]",
  MEDIUM: "text-[var(--text)]",
  LOW: "text-[var(--text-muted)]",
};

export function Objections({ objections }: { objections: ForgeObjection[] }) {
  if (objections.length === 0) return <Empty>No objections raised.</Empty>;
  return (
    <ul className="space-y-3">
      {objections.map((o) => (
        <li key={o.id} className="rounded-md bg-[var(--surface)] p-3">
          <div className="flex items-baseline gap-2 text-[11px] uppercase tracking-[0.1em]">
            <span className="text-[var(--text-muted)]">Challenger</span>
            <span className={SEVERITY_TONE[o.severity]}>{o.severity}</span>
            <span className="ml-auto text-[var(--text-muted)]">
              round {o.round} · {o.status}
            </span>
          </div>
          <div className="mt-1 text-[13px] font-medium">{o.title}</div>
          {o.body && <p className="mt-1 text-[13px] text-[var(--text-muted)]">{o.body}</p>}
          {o.resolution && (
            <p className="mt-2 border-l-2 border-[var(--border-strong)] pl-2 text-[13px]">
              <span className="mr-2 text-[11px] uppercase text-[var(--text-muted)]">Builder</span>
              {o.resolution}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

/* ── Checks ───────────────────────────────────────────────────────────── */

const CHECK_GLYPH: Record<ForgeCheck["status"], string> = {
  pending: "·",
  running: "●",
  passed: "✓",
  failed: "✕",
  skipped: "–",
};

export function Checks({
  checks,
  profileKey,
}: {
  checks: ForgeCheck[];
  profileKey: string | null;
}) {
  const profile = profileKey
    ? VERIFICATION_PROFILES[profileKey as keyof typeof VERIFICATION_PROFILES]
    : null;

  // Before the worker has reported anything, the profile itself is the honest
  // answer to "what will be run" — shown as pending, never as passed.
  const rows: {
    key: string;
    name: string;
    status: ForgeCheck["status"];
    duration: number | null;
    note: string | null;
  }[] =
    checks.length > 0
      ? checks.map((c) => ({
          key: c.id,
          name: c.name,
          status: c.status,
          duration: c.durationMs,
          note: c.failureSummary ?? c.outputSummary,
        }))
      : (profile?.checks ?? []).map((name) => ({
          key: name,
          name,
          status: "pending" as const,
          duration: null,
          note: null,
        }));

  if (rows.length === 0) return <Empty>No verification profile selected.</Empty>;

  return (
    <div>
      {profile && (
        <p className="mb-2 text-[12px] text-[var(--text-muted)]">
          {profile.label} profile — {profile.description}
        </p>
      )}
      <ul className="font-mono text-[12px] leading-[1.7]">
        {rows.map((r) => (
          <li key={r.key} className="flex gap-2">
            <span className="w-[14px] shrink-0">{CHECK_GLYPH[r.status]}</span>
            <span className={r.status === "failed" ? "text-[var(--loss)]" : undefined}>
              {r.name}
            </span>
            {r.duration != null && (
              <span className="text-[var(--text-muted)]">{(r.duration / 1000).toFixed(1)}s</span>
            )}
            {r.note && <span className="truncate text-[var(--text-muted)]">— {r.note}</span>}
          </li>
        ))}
      </ul>
      {profile?.gates?.length ? (
        <p className="mt-2 text-[12px] text-[var(--text-muted)]">
          Additional gates: {profile.gates.join(", ")}.
        </p>
      ) : null}
    </div>
  );
}

/* ── Cost ─────────────────────────────────────────────────────────────── */

export function CostLedger({ runs, job }: { runs: ForgeModelRun[]; job: ForgeJob }) {
  const roles = ["builder", "challenger", "escalation"] as const;
  const money = (n: number) => `$${n.toFixed(4)}`;
  return (
    <table className="w-full text-[12px]">
      <thead className="text-[11px] uppercase tracking-[0.1em] text-[var(--text-muted)]">
        <tr>
          <th className="py-1 text-left font-medium">Role</th>
          <th className="py-1 text-left font-medium">Model</th>
          <th className="py-1 text-right font-medium">In</th>
          <th className="py-1 text-right font-medium">Out</th>
          <th className="py-1 text-right font-medium">Cost</th>
        </tr>
      </thead>
      <tbody>
        {roles.map((role) => {
          const mine = runs.filter((r) => r.role === role);
          const cfg = MODEL_REGISTRY[role];
          return (
            <tr key={role} className="border-t border-[var(--border)]">
              <td className="py-1 capitalize">{role}</td>
              <td className="py-1 font-mono text-[var(--text-muted)]">{cfg.modelId}</td>
              <td className="py-1 text-right">{mine.reduce((s, r) => s + r.inputTokens, 0)}</td>
              <td className="py-1 text-right">{mine.reduce((s, r) => s + r.outputTokens, 0)}</td>
              <td className="py-1 text-right">{money(mine.reduce((s, r) => s + r.costUsd, 0))}</td>
            </tr>
          );
        })}
        <tr className="border-t border-[var(--border-strong)] font-medium">
          <td className="py-1" colSpan={2}>
            Total
          </td>
          <td className="py-1 text-right">{job.inputTokens}</td>
          <td className="py-1 text-right">{job.outputTokens}</td>
          <td className="py-1 text-right">{money(job.totalCostUsd)}</td>
        </tr>
      </tbody>
    </table>
  );
}
