import { EmptyState } from "./EmptyState";
import { RowSkeleton } from "./Skeleton";
import { Pill } from "./Pill";
import { useRoomFeed } from "@/lib/conviction-data";

/**
 * RoomPanel — "The Room". Stories are written and ranked upstream; this list
 * renders them in the order supplied.
 */
export function RoomPanel({
  address,
  onSelectBelief,
}: {
  address: string | null;
  onSelectBelief: (id: string) => void;
}) {
  const feed = useRoomFeed(address);

  return (
    <aside className="flex min-h-0 flex-1 flex-col wide:h-full wide:col-start-3 wide:row-start-1 border-border bg-panel wide:border-l">
      <header className="border-b border-border px-4 py-4">
        <p className="label-micro">The Room</p>
        <p className="mt-1 text-sm text-text">
          {feed.data?.length ? "What is changing" : "Nobody has moved yet"}
        </p>
      </header>

      <div className="scroll-panel min-h-0 flex-1 px-4 py-4">
        {feed.isLoading ? (
          <div className="flex flex-col gap-2">
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
          </div>
        ) : feed.isError ? (
          <EmptyState title="The room did not load" detail="The connection dropped. Try again." />
        ) : !feed.data?.length ? (
          <EmptyState
            title="No activity to show"
            detail="Changes of conviction — entries, exits and reversals — will appear here as they happen."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {feed.data.map((s, i) => (
              <li key={`${s.beliefId}-${i}`}>
                <button
                  type="button"
                  onClick={() => onSelectBelief(s.beliefId)}
                  className="w-full rounded-md border border-border bg-surface px-3 py-3 text-left"
                >
                  {s.markerLabel ? (
                    <Pill tone={s.marker === "tribe" ? "tribe" : "attention"}>{s.markerLabel}</Pill>
                  ) : null}
                  <span className="mt-2 block text-sm text-text">{s.story}</span>
                  <span className="mt-1 block truncate text-fine text-text-secondary">
                    {s.question}
                  </span>
                  <span className="mt-1 block font-num text-fine text-text-secondary">
                    {s.values ? `${s.values} · ` : ""}
                    {s.ago}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
