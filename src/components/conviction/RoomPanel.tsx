import { EmptyState } from "./EmptyState";

/**
 * RoomPanel — "The Room". Answers: what is changing, and who is here?
 * Placeholder shell; contents arrive in a later prompt.
 */
export function RoomPanel() {
  return (
    <aside className="flex h-full min-h-0 flex-col border-border bg-panel wide:border-l">
      <header className="border-b border-border px-4 py-4">
        <p className="label-micro">The Room</p>
        <p className="mt-1 text-sm text-text">Nobody has moved yet</p>
      </header>

      <div className="scroll-panel min-h-0 flex-1 px-4 py-4">
        <EmptyState
          title="No activity to show"
          detail="Changes of conviction — entries, exits and reversals — will appear here as they happen."
        />
      </div>
    </aside>
  );
}
