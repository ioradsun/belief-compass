import { EmptyState } from "./EmptyState";

/**
 * LeftPanel — "My Convictions". Answers: who am I here?
 * Placeholder shell; contents arrive in a later prompt.
 */
export function LeftPanel() {
  return (
    <aside className="flex h-full min-h-0 flex-col border-border bg-panel wide:border-r">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-4">
        <div className="min-w-0">
          <p className="label-micro">My Convictions</p>
          <p className="mt-1 truncate text-sm text-text">Not connected</p>
        </div>
      </header>

      <div className="scroll-panel min-h-0 flex-1 px-4 py-4">
        <EmptyState
          title="No positions yet"
          detail="Once you back a belief, your side, capital and conviction appear here."
        />
      </div>
    </aside>
  );
}
