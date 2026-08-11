/**
 * HOW A BELIEF TRAVELLED — avatars and a line, and nothing that looks like a graph.
 *
 * NO CANVAS, NO ZOOM, NO FORCE-DIRECTED ANYTHING. The underlying data genuinely
 * is a tree, which is exactly why this is the screen most likely to slide into
 * being a diagram of one. A real route is two to four people; drawn as faces in
 * a row it reads instantly, and drawn as nodes it reads as analytics about
 * strangers.
 *
 * THREE SECTIONS, IN THE ORDER A PERSON CARES ABOUT: who brought this to me,
 * what I caused, and how far it went overall. The third is aggregate on purpose
 * — beyond the reader's own branch, other people's recipients did not choose to
 * be visible.
 *
 * IT DECIDES NOTHING. Every count, every name and every truncation came from
 * `challengeChainFor`. In particular this file must never call `startedBy` on a
 * truncated route or compose its own sentence from `recipientOpportunities` —
 * both are the ways this view could quietly begin lying.
 */
import { PersonAvatar } from "@/components/PersonAvatar";
import {
  BRANCH_TITLE,
  CHAIN_TITLE,
  PARTIAL_NOTE,
  TRUNCATED_NOTE,
  UPSTREAM_TITLE,
  WHOLE_TITLE,
  branchLines,
  depthLine,
  opportunitiesLine,
  wholeChainLines,
  type ChallengeChainProjection,
} from "@/domain/challenge-chain";
import type { CardPerson } from "@/domain/challenge-card";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-[var(--border)] pt-3 first:border-0 first:pt-0">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
        {title}
      </p>
      <div className="mt-1.5">{children}</div>
    </section>
  );
}

/** One face with a name beneath it — the only unit this view draws. */
function Step({ person, label }: { person?: CardPerson; label: string }) {
  return (
    <div className="flex w-[56px] shrink-0 flex-col items-center gap-1">
      {person ? (
        <PersonAvatar
          wallet={person.wallet}
          name={person.name}
          avatarUrl={person.avatarUrl}
          size={32}
        />
      ) : (
        <span
          className="flex h-[32px] w-[32px] items-center justify-center rounded-full text-[13px]"
          style={{
            background: "color-mix(in oklab, var(--text-muted) 14%, transparent)",
            color: "var(--text-muted)",
          }}
        >
          {label}
        </span>
      )}
      <span className="w-full truncate text-center text-[10.5px] text-[var(--text-secondary)]">
        {person ? person.name : ""}
      </span>
    </div>
  );
}

const Arrow = () => (
  <span aria-hidden className="shrink-0 pb-4 text-[12px] text-[var(--text-muted)]">
    →
  </span>
);

export function ChallengeChainView({
  chain,
  onSelectMarket,
}: {
  chain: ChallengeChainProjection;
  onSelectMarket?: (marketId: number) => void;
}) {
  const { upstream: u, viewerBranch: b, wholeChain: w } = chain;
  const depth = depthLine(u);

  return (
    <div className="flex flex-col gap-3 p-4">
      <div>
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
          {CHAIN_TITLE}
        </p>
        <button
          type="button"
          onClick={() => onSelectMarket?.(chain.marketId)}
          className="mt-0.5 block text-left text-[14px] font-semibold leading-snug text-[var(--text)] underline-offset-2 hover:underline"
        >
          {chain.question}
        </button>
      </div>

      {u.path.length > 0 && (
        <Section title={UPSTREAM_TITLE}>
          {/* Horizontal, and allowed to scroll on a narrow screen rather than
              wrapping into something that reads as a tree. */}
          <div className="flex items-start gap-1.5 overflow-x-auto pb-1">
            {/* THE ELLIPSIS IS THE TRUNCATION, drawn rather than described. It
                is what stands in place of a root nobody proved. */}
            {u.truncated && (
              <>
                <Step label="…" />
                <Arrow />
              </>
            )}
            {u.path.map((l, i) => (
              <span key={l.person.wallet} className="flex items-start gap-1.5">
                <Step person={l.person} label="" />
                {i < u.path.length - 1 && <Arrow />}
              </span>
            ))}
            <Arrow />
            <Step label="You" />
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-[var(--text-muted)]">
            {depth && <span>{depth}</span>}
            {/* Said out loud, flatly. Not an error, and not an apology — the
                boundary of what the ledger can prove. */}
            {u.truncated && <span>{TRUNCATED_NOTE}</span>}
          </div>
        </Section>
      )}

      {b && (
        <Section title={BRANCH_TITLE}>
          {/* NAMED RESPONDERS ONLY. They took a public on-chain position;
              everybody else on this branch is a number in the lines below. */}
          {b.responders.length > 0 && (
            <div className="mb-1.5 flex -space-x-1.5">
              {b.responders.slice(0, 5).map((r) => (
                <PersonAvatar
                  key={r.wallet}
                  wallet={r.wallet}
                  name={r.name}
                  avatarUrl={r.avatarUrl}
                  size={24}
                  className="ring-1 ring-[var(--bg)]"
                />
              ))}
              {b.responders.length > 5 && (
                <span
                  className="flex h-[24px] min-w-[24px] items-center justify-center rounded-full px-1 text-[10px] font-medium ring-1 ring-[var(--bg)]"
                  style={{
                    background: "color-mix(in oklab, var(--text-muted) 16%, transparent)",
                    color: "var(--text-secondary)",
                  }}
                >
                  +{b.responders.length - 5}
                </span>
              )}
            </div>
          )}
          {branchLines(b).map((line) => (
            <p key={line} className="text-[12px] leading-snug text-[var(--text-secondary)]">
              {line}
            </p>
          ))}
        </Section>
      )}

      <Section title={WHOLE_TITLE}>
        {wholeChainLines(w).map((line) => (
          <p key={line} className="text-[12px] leading-snug text-[var(--text-secondary)]">
            {line}
          </p>
        ))}
        {/* SECONDARY ON PURPOSE. This number counts call rows, and once a chain
            forks the same person can hold two of them — so it is smaller, dimmer,
            and says "opportunities" rather than "people". */}
        {opportunitiesLine(w) && (
          <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{opportunitiesLine(w)}</p>
        )}
        {w.partial && <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{PARTIAL_NOTE}</p>}
      </Section>
    </div>
  );
}
