/**
 * Forge control room — the shared vocabulary every station is drawn from.
 *
 * Six stations sit in a fixed grid that never scrolls as a page. So the
 * primitives here are built for a control surface, not a document: a panel is
 * a header that stays put over a body that scrolls inside itself, and nothing
 * a panel contains may change the height of the screen.
 *
 * Two rules hold the visual language together:
 *   1. Colour is semantic. Blue is "running", amber is "attention", red is
 *      "failed", green is "passed". Nothing is coloured to look nice.
 *   2. The interface still reads in greyscale. Tone is carried by weight,
 *      position and spacing first; the accent only confirms it.
 */
import { useState } from "react";
import type { ForgeCheck, ForgeEvent, ForgeObjection, ObjectionSeverity } from "@/lib/forge/types";
import type { StationTone } from "@/lib/forge/stations";
import { HUMAN_STATE_GLYPH, HUMAN_STATE_LABEL, type HumanState } from "@/lib/forge/narrative";
import { SEVERITY_TONE, STATE_TONE, TONE_COLOR, timeOf } from "./tone";

/** The one moving thing on a calm screen: the station currently working. */
export function Dot({ tone, pulse = false }: { tone: StationTone; pulse?: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block size-[6px] shrink-0 rounded-full ${pulse ? "forge-pulse" : ""}`}
      style={{ backgroundColor: TONE_COLOR[tone] }}
    />
  );
}

/* ── Panel ────────────────────────────────────────────────────────────────
 * Fixed header, scrolling body, optional fixed footer. The header is the
 * focus affordance: pressing it expands this station over the canvas.
 */

export function Panel({
  title,
  status,
  tone,
  subtitle,
  active = false,
  focused = false,
  onFocus,
  footer,
  children,
}: {
  title: string;
  status: string;
  tone: StationTone;
  subtitle?: string | null;
  active?: boolean;
  focused?: boolean;
  onFocus?: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      className="relative flex min-h-0 min-w-0 flex-col"
      style={{ backgroundColor: active ? "var(--surface)" : "var(--panel)" }}
    >
      {/* Current-actor emphasis: a hairline of accent, nothing more. */}
      {active && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{ backgroundColor: TONE_COLOR[tone] }}
        />
      )}
      <header className="shrink-0 px-4 pb-2 pt-3">
        <button
          type="button"
          onClick={onFocus}
          disabled={!onFocus}
          aria-expanded={focused}
          className="flex w-full items-baseline gap-3 text-left disabled:cursor-default"
        >
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">
            {title}
          </h2>
          <span className="ml-auto flex items-baseline gap-1.5">
            <Dot tone={tone} pulse={active} />
            <span
              className="text-[11px] font-medium uppercase tracking-[0.08em]"
              style={{ color: tone === "idle" ? "var(--text-muted)" : TONE_COLOR[tone] }}
            >
              {status}
            </span>
          </span>
        </button>
        {subtitle && (
          <p className="truncate font-mono text-[11px] leading-[1.4] text-[var(--text-muted)]">
            {subtitle}
          </p>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-3">{children}</div>
      {footer && (
        <div className="shrink-0 border-t border-[var(--hairline)] px-4 py-2">{footer}</div>
      )}
    </section>
  );
}

/* ── Small type ───────────────────────────────────────────────────────── */

/** A titled group inside a panel body. Cheaper than a card, clearer than a gap. */
export function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-3 first:mt-1">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
        {label}
      </p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/** Label over value, numerals tabular. Used wherever figures must line up. */
export function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: StationTone;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">{label}</p>
      <p
        className="num truncate text-[13px] leading-[1.5]"
        style={tone ? { color: TONE_COLOR[tone] } : undefined}
      >
        {value}
      </p>
    </div>
  );
}

export function Body({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] leading-[1.55] text-[var(--text-secondary)]">{children}</p>;
}

export function Lede({ children }: { children: React.ReactNode }) {
  return <p className="text-[14px] leading-[1.45] text-[var(--text)]">{children}</p>;
}

export function Path({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[12px] text-[var(--text-secondary)]">{children}</span>;
}

/**
 * A waiting panel still owes an explanation. "Waiting…" is not one — the
 * operator is told which station it is waiting on and what will unblock it.
 */
export function Waiting({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-1">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
        {title}
      </p>
      <p className="mt-1 text-[12px] leading-[1.55] text-[var(--text-muted)]">{body}</p>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] leading-[1.55] text-[var(--text-muted)]">{children}</p>;
}

/** A system that explains its own choices stops being magical. */
export function Why({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[11px] text-[var(--text-muted)] underline decoration-dotted underline-offset-2 hover:text-[var(--text)]"
      >
        {label}
      </button>
      {open && (
        <span className="mt-1 block text-[12px] leading-[1.55] text-[var(--text-muted)]">
          {children}
        </span>
      )}
    </span>
  );
}

/* ── Buttons ──────────────────────────────────────────────────────────────
 * Three weights and no more: the one action the operator should take, the
 * ones they may take, and the destructive one.
 */

export function Action({
  children,
  weight = "quiet",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { weight?: "primary" | "quiet" | "danger" }) {
  const base =
    "rounded-[3px] px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.08em] transition-opacity disabled:opacity-35";
  const skin =
    weight === "primary"
      ? "bg-[var(--text)] text-[var(--bg)]"
      : weight === "danger"
        ? "border border-[var(--hairline)] text-[var(--loss)] hover:border-[var(--loss)]"
        : "border border-[var(--hairline)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text)]";
  return (
    <button type="button" className={`${base} ${skin}`} {...rest}>
      {children}
    </button>
  );
}

export function LinkAction({ children, href }: { children: React.ReactNode; href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="rounded-[3px] border border-[var(--hairline)] px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
    >
      {children}
    </a>
  );
}

/* ── Objections ───────────────────────────────────────────────────────────
 * A structured review record, not a conversation. CRITICAL and HIGH earn
 * their prominence from a severity rule at the left edge and a heavier title
 * — never from a loud fill.
 */

export function SeverityTag({ severity }: { severity: ObjectionSeverity }) {
  return (
    <span
      className="text-[10px] font-semibold uppercase tracking-[0.14em]"
      style={{ color: TONE_COLOR[SEVERITY_TONE[severity]] }}
    >
      {severity}
    </span>
  );
}

const OBJECTION_STATUS_LABEL: Record<ForgeObjection["status"], string> = {
  open: "Open",
  resolved: "Resolved",
  maintained: "Maintained",
  waived: "Waived",
};

export function ObjectionRow({
  objection,
  expanded,
}: {
  objection: ForgeObjection;
  expanded: boolean;
}) {
  const o = objection;
  const loud = o.severity === "CRITICAL" || o.severity === "HIGH";
  const settled = o.status === "resolved" || o.status === "waived";
  return (
    <li
      className="border-l-2 py-2 pl-3"
      style={{
        borderColor: settled
          ? "var(--hairline)"
          : loud
            ? TONE_COLOR.fail
            : TONE_COLOR[SEVERITY_TONE[o.severity]],
      }}
    >
      <div className="flex items-baseline gap-2">
        <SeverityTag severity={o.severity} />
        <span className="ml-auto text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
          Round {o.round}
        </span>
      </div>
      <p
        className={`mt-0.5 text-[13px] leading-[1.4] ${loud && !settled ? "font-medium text-[var(--text)]" : "text-[var(--text)]"}`}
      >
        {o.title}
      </p>
      {o.body && (
        <p
          className={`mt-1 text-[12px] leading-[1.55] text-[var(--text-muted)] ${expanded ? "" : "line-clamp-2"}`}
        >
          {o.body}
        </p>
      )}
      {o.resolution && (
        <div className="mt-2 border-l border-[var(--hairline)] pl-2">
          <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
            Builder response
          </p>
          <p
            className={`mt-0.5 text-[12px] leading-[1.55] text-[var(--text-secondary)] ${expanded ? "" : "line-clamp-2"}`}
          >
            {o.resolution}
          </p>
        </div>
      )}
      <p
        className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.14em]"
        style={{
          color: settled
            ? "var(--text-muted)"
            : TONE_COLOR[o.status === "maintained" ? "attention" : SEVERITY_TONE[o.severity]],
        }}
      >
        {settled ? "✓ " : ""}
        {OBJECTION_STATUS_LABEL[o.status]}
      </p>
    </li>
  );
}

/* ── Checks ───────────────────────────────────────────────────────────────
 * Deterministic evidence. The human-readable failure is primary; raw output
 * is available underneath it, never instead of it.
 */

const CHECK_GLYPH: Record<ForgeCheck["status"], string> = {
  pending: "○",
  running: "●",
  passed: "✓",
  failed: "✕",
  skipped: "–",
};

const CHECK_TONE: Record<ForgeCheck["status"], StationTone> = {
  pending: "idle",
  running: "active",
  passed: "pass",
  failed: "fail",
  skipped: "idle",
};

export function CheckRow({
  name,
  status,
  durationMs,
  detail,
  raw,
  open,
  onToggle,
}: {
  name: string;
  status: ForgeCheck["status"];
  durationMs: number | null;
  detail: string | null;
  raw: string | null;
  open: boolean;
  onToggle: () => void;
}) {
  const [showRaw, setShowRaw] = useState(false);
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-baseline gap-2 py-[3px] text-left"
      >
        <span
          className="w-[11px] shrink-0 text-[11px] leading-[1.5]"
          style={{ color: TONE_COLOR[CHECK_TONE[status]] }}
        >
          {CHECK_GLYPH[status]}
        </span>
        <span
          className={`min-w-0 flex-1 truncate text-[12px] leading-[1.5] ${
            status === "failed" ? "text-[var(--loss)]" : "text-[var(--text-secondary)]"
          }`}
        >
          {name}
        </span>
        <span className="num shrink-0 text-[11px] text-[var(--text-muted)]">
          {durationMs != null ? `${(durationMs / 1000).toFixed(0)}s` : ""}
        </span>
      </button>
      {open && (
        <div className="pb-2 pl-[19px]">
          {detail ? (
            <p className="text-[12px] leading-[1.55] text-[var(--text)]">{detail}</p>
          ) : (
            <Empty>No output recorded for this check.</Empty>
          )}
          {raw && (
            <>
              <button
                type="button"
                onClick={() => setShowRaw((v) => !v)}
                className="mt-1 text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)] underline decoration-dotted underline-offset-2"
              >
                {showRaw ? "Hide raw output" : "Raw output"}
              </button>
              {showRaw && (
                <pre className="mt-1 max-h-[160px] overflow-auto whitespace-pre-wrap bg-[var(--bg)] p-2 font-mono text-[11px] leading-[1.5] text-[var(--text-muted)]">
                  {raw}
                </pre>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}

/* ── Activity ─────────────────────────────────────────────────────────────
 * What happened, in the order it happened, in words. Not a log tail.
 */

const LEVEL_TONE: Record<ForgeEvent["level"], StationTone> = {
  success: "pass",
  info: "idle",
  warn: "attention",
  error: "fail",
};

export function ActivityRow({ event, fresh }: { event: ForgeEvent; fresh?: boolean }) {
  return (
    <li className={`flex items-baseline gap-3 py-[3px] ${fresh ? "forge-event-in" : ""}`}>
      <span className="num w-[60px] shrink-0 text-[11px] text-[var(--text-muted)]">
        {timeOf(event.createdAt)}
      </span>
      <span
        aria-hidden
        className="mt-[6px] size-[4px] shrink-0 rounded-full"
        style={{ backgroundColor: TONE_COLOR[LEVEL_TONE[event.level]] }}
      />
      {event.role && event.role !== "system" && (
        <span className="w-[68px] shrink-0 text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
          {event.role}
        </span>
      )}
      <span
        className={`min-w-0 flex-1 text-[12px] leading-[1.5] ${
          event.level === "error" ? "text-[var(--loss)]" : "text-[var(--text-secondary)]"
        }`}
      >
        {event.message}
      </span>
    </li>
  );
}

/** The debugging view of Forge itself. Timestamps, kinds, payloads, nothing kind. */
export function RawLog({ events }: { events: readonly ForgeEvent[] }) {
  if (events.length === 0) return <Empty>No events recorded.</Empty>;
  return (
    <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-[1.6] text-[var(--text-muted)]">
      {events
        .map(
          (e) =>
            `${e.createdAt} [${e.level}] ${e.role ?? "system"} ${e.kind} — ${e.message}` +
            (e.detail == null ? "" : `\n    ${JSON.stringify(e.detail)}`),
        )
        .join("\n")}
    </pre>
  );
}

/* ── Job rail ─────────────────────────────────────────────────────────── */

export function RailRow({
  title,
  phase,
  meta,
  state,
  active,
  onOpen,
}: {
  title: string;
  phase: string;
  meta: string;
  state: HumanState;
  active: boolean;
  onOpen: () => void;
}) {
  const tone = STATE_TONE[state];
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={`flex w-full items-baseline gap-2 py-[5px] pl-3 pr-2 text-left ${
          active ? "bg-[var(--surface)]" : "hover:bg-[var(--surface)]"
        }`}
        style={
          active
            ? { boxShadow: `inset 2px 0 0 ${TONE_COLOR[tone]}` }
            : { boxShadow: "inset 2px 0 0 transparent" }
        }
      >
        <span
          className="w-[10px] shrink-0 text-[11px] leading-[1.4]"
          style={{ color: TONE_COLOR[tone] }}
          aria-label={HUMAN_STATE_LABEL[state]}
        >
          {HUMAN_STATE_GLYPH[state]}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={`block truncate text-[12px] leading-[1.4] ${active ? "text-[var(--text)]" : "text-[var(--text-secondary)]"}`}
          >
            {title}
          </span>
          <span className="mt-px flex items-baseline gap-1.5 text-[10px] text-[var(--text-muted)]">
            <span className="min-w-0 truncate">{phase}</span>
            <span className="num ml-auto shrink-0">{meta}</span>
          </span>
        </span>
      </button>
    </li>
  );
}

/* ── Focus rail ───────────────────────────────────────────────────────────
 * In Focus Mode the other five stations collapse to this. They keep their
 * order and their status, so leaving focus never disorients.
 */

export function FocusRailRow({
  label,
  status,
  tone,
  active,
  selected,
  onSelect,
}: {
  label: string;
  status: string;
  tone: StationTone;
  active: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-baseline gap-2 px-3 py-2 text-left ${
        selected ? "bg-[var(--surface)]" : "hover:bg-[var(--surface)]"
      }`}
    >
      <Dot tone={tone} pulse={active} />
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-[11px] font-semibold uppercase tracking-[0.14em] ${
            selected ? "text-[var(--text)]" : "text-[var(--text-secondary)]"
          }`}
        >
          {label}
        </span>
        <span
          className="block truncate text-[10px] uppercase tracking-[0.08em]"
          style={{ color: tone === "idle" ? "var(--text-muted)" : TONE_COLOR[tone] }}
        >
          {status}
        </span>
      </span>
    </button>
  );
}
