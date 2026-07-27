import { Menu } from "lucide-react";
import { IconButton } from "./IconButton";
import { EmptyState } from "./EmptyState";

/**
 * BeliefRoom — the centre. Answers: what is the belief?
 * Always visible at every breakpoint; anchors the order bar in a later prompt.
 */
export function BeliefRoom({ onOpenDrawer }: { onOpenDrawer: () => void }) {
  return (
    <main className="relative flex h-full min-h-0 flex-col overflow-hidden bg-bg wide:col-start-2">
      <header className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 border-b border-border px-4 py-4 wide:grid-cols-1 wide:px-8 wide:py-6">
        <IconButton label="Open panels" onClick={onOpenDrawer} className="wide:hidden">
          <Menu size={18} strokeWidth={1.8} />
        </IconButton>

        <div className="min-w-0">
          <p className="label-micro">Belief</p>
          <h1 className="mt-2 text-[length:var(--text-question-m)] leading-[1.15] font-medium text-balance text-text wide:text-[length:var(--text-question)]">
            No belief selected
          </h1>
        </div>
      </header>

      <div className="scroll-panel min-h-0 flex-1 px-4 py-6 wide:px-8">
        <EmptyState
          title="Choose a belief to enter the room"
          detail="The question, the two sides, and the people standing behind each of them will appear here."
        />
      </div>
    </main>
  );
}
