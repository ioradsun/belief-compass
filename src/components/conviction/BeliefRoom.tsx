import { Menu } from "lucide-react";
import { IconButton } from "./IconButton";
import { EmptyState } from "./EmptyState";
import { SideColumn } from "./SideColumn";
import { OrderBar } from "./OrderBar";
import { SideSkeleton, Skeleton } from "./Skeleton";
import { useBelief, useOnboardingBeliefs } from "@/lib/conviction-data";
import type { SideKey, Viewer } from "@/lib/contract";
import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * BeliefRoom — the centre. Renders only what the contract supplies.
 */
export function BeliefRoom({
  onOpenDrawer,
  beliefId,
  onSelectBelief,
  viewer,
  address,
  onJoined,
}: {
  onOpenDrawer: () => void;
  beliefId: string | null;
  onSelectBelief: (id: string) => void;
  viewer: Viewer | undefined;
  address: string | null;
  onJoined: () => void;
}) {
  const [side, setSide] = useState<SideKey | null>(null);
  const belief = useBelief(beliefId, address);
  const qualified = viewer?.profile === "qualified";

  return (
    <main className="relative flex h-full min-h-0 flex-col overflow-hidden bg-bg wide:col-start-2 wide:row-start-1">
      <header className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 border-b border-border px-4 py-4 wide:grid-cols-1 wide:px-8 wide:py-6">
        <IconButton label="Open panels" onClick={onOpenDrawer} className="wide:hidden">
          <Menu size={18} strokeWidth={1.8} />
        </IconButton>

        <div className="min-w-0">
          <p className="label-micro">
            {belief.data ? `${belief.data.category} · ${belief.data.openedAgo}` : "Belief"}
          </p>
          {beliefId && belief.isLoading ? (
            <Skeleton className="mt-2 h-[30px] w-full" />
          ) : (
            <h1 className="mt-2 text-[length:var(--text-question-m)] leading-[1.15] font-medium text-balance text-text wide:text-[length:var(--text-question)]">
              {belief.data?.question ?? "Which of these do you believe?"}
            </h1>
          )}
          {belief.data?.relationshipRead ? (
            <p className="mt-2 text-sm text-rel">{belief.data.relationshipRead}</p>
          ) : null}
          {belief.data?.story ? (
            <p className="mt-2 text-sm text-text-secondary">{belief.data.story}</p>
          ) : null}
        </div>
      </header>

      <div className="scroll-panel min-h-0 flex-1 px-4 py-6 wide:px-8">
        {!beliefId ? (
          <Onboarding onSelectBelief={onSelectBelief} />
        ) : belief.isLoading ? (
          <div className="grid gap-4 wide:grid-cols-2">
            <SideSkeleton />
            <SideSkeleton />
          </div>
        ) : belief.isError ? (
          <EmptyState
            title="This belief did not load"
            detail="The connection dropped on the way. Try again."
          />
        ) : !belief.data ? (
          <EmptyState title="This belief is not here" detail="It may have been removed upstream." />
        ) : (
          <>
            <div className="grid gap-4 wide:grid-cols-2">
              <SideColumn
                side="y"
                data={belief.data.y}
                selected={side === "y"}
                onSelect={() => setSide("y")}
                qualified={qualified}
              />
              <SideColumn
                side="n"
                data={belief.data.n}
                selected={side === "n"}
                onSelect={() => setSide("n")}
                qualified={qualified}
              />
            </div>

            <section className="mt-6 rounded-md border border-border bg-surface px-4 py-4">
              <p className="label-micro">History</p>
              <p className="mt-2 font-num text-sm text-text-secondary">
                {belief.data.history.volumeToday} today · {belief.data.history.volumeChangePct} ·{" "}
                {belief.data.history.believerSplit}
              </p>
              <p className="mt-1 font-num text-fine text-text-secondary">
                {belief.data.history.newBelievers} new believers in the last hour
              </p>
              {beliefId ? (
                <a
                  href={`/market/${beliefId}`}
                  className="mt-3 inline-block text-fine text-text-secondary underline underline-offset-2 hover:text-text"
                >
                  Full market &amp; top believers ↗
                </a>
              ) : null}
            </section>
          </>
        )}
      </div>

      {belief.data && side ? (
        <OrderBar belief={belief.data} side={side} onJoined={onJoined} />
      ) : null}
    </main>
  );
}

/** Onboarding runs with no wallet. Nothing here requires connection. */
function Onboarding({ onSelectBelief }: { onSelectBelief: (id: string) => void }) {
  const list = useOnboardingBeliefs();
  if (list.isLoading) {
    return (
      <ul className="flex flex-col gap-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <li key={i}>
            <Skeleton className="h-[68px] w-full rounded-md" />
          </li>
        ))}
      </ul>
    );
  }
  if (list.isError) {
    return <EmptyState title="Beliefs did not load" detail="The connection dropped. Try again." />;
  }
  if (!list.data?.length) {
    return <EmptyState title="No beliefs are open yet" detail="They appear here as they open." />;
  }
  return (
    <ul className="flex flex-col gap-3">
      {list.data.map((b) => (
        <li key={b.id}>
          <button
            type="button"
            onClick={() => onSelectBelief(b.id)}
            className={cn(
              "w-full rounded-md border border-border bg-surface px-4 py-4 text-left",
              "transition-colors duration-200 hover:border-border-strong",
            )}
          >
            <span className="label-micro">{b.category}</span>
            <span className="mt-1 block text-body text-text">{b.question}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
