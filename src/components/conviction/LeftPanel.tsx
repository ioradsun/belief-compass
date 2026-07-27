import { EmptyState } from "./EmptyState";
import { RowSkeleton } from "./Skeleton";
import { Pill } from "./Pill";
import { usePositions } from "@/lib/conviction-data";
import type { Viewer } from "@/lib/contract";

/**
 * LeftPanel — "My Convictions". Positions come preformatted from the contract;
 * value and change are rendered neutrally and never as profit.
 */
export function LeftPanel({
  address,
  viewer,
  onConnect,
  onSelectBelief,
}: {
  address: string | null;
  viewer: Viewer | undefined;
  onConnect: () => void;
  onSelectBelief: (id: string) => void;
}) {
  const positions = usePositions(address);

  return (
    <aside className="flex min-h-0 flex-1 flex-col wide:h-full wide:col-start-1 wide:row-start-1 border-border bg-panel wide:border-r">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-4">
        <div className="min-w-0">
          <p className="label-micro">My Convictions</p>
          <p className="mt-1 truncate text-sm text-text">
            {address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Not connected"}
          </p>
        </div>
        {!address ? (
          <button
            type="button"
            onClick={onConnect}
            className="shrink-0 rounded-full border border-border px-2 py-0.5 text-fine text-text-secondary"
          >
            Connect
          </button>
        ) : null}
      </header>

      <div className="scroll-panel min-h-0 flex-1 px-4 py-4">
        {!address ? (
          <EmptyState
            title="No wallet connected"
            detail="Your address is your identity here. Connecting shows the convictions already on record for it."
          />
        ) : positions.isLoading ? (
          <div className="flex flex-col gap-2">
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
          </div>
        ) : positions.isError ? (
          <EmptyState title="Positions did not load" detail="The connection dropped. Try again." />
        ) : !positions.data?.length ? (
          <EmptyState
            title="No positions yet"
            detail="Once you back a belief, your side, capital and conviction appear here."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {positions.data.map((p) => (
              <li key={`${p.beliefId}-${p.side}`}>
                <button
                  type="button"
                  onClick={() => onSelectBelief(p.beliefId)}
                  className="w-full rounded-md border border-border bg-surface px-3 py-3 text-left"
                >
                  <span className="flex items-center gap-2">
                    <Pill tone={p.side === "y" ? "yes" : "no"}>{p.side === "y" ? "YES" : "NO"}</Pill>
                    <span className="ml-auto font-num text-sm text-text">{p.value}</span>
                  </span>
                  <span className="mt-2 block text-sm text-text">{p.question}</span>
                  <span className="mt-1 block font-num text-fine text-text-secondary">
                    {p.changeLabel}
                  </span>
                  {p.socialContext ? (
                    <span className="mt-1 block text-fine text-rel">{p.socialContext}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}

        {viewer && viewer.profile === "provisional" ? (
          <p className="mt-4 text-fine text-text-secondary">
            {3 - viewer.beliefsBacked} more belief
            {3 - viewer.beliefsBacked === 1 ? "" : "s"} and the people around you become visible.
          </p>
        ) : null}
      </div>
    </aside>
  );
}
