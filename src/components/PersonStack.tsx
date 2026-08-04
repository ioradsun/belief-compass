/**
 * PERSON STACK — the faces behind a story, and the way into them.
 *
 * A group story is only half told by its sentence. "Jon, Kate, and 12 others
 * reached 30 days" states a fact; the faces turn it into an invitation. Every
 * one of them is a door to that person's profile, which is where the deeper
 * story lives — what else they believe, how long they tend to hold, what you
 * share with them.
 *
 * NOT DECORATION. There is no non-interactive mode. If a face appears here it
 * can be opened, and the overflow chip expands the rest in place rather than
 * inventing a new navigation model — the profiles it reveals are the same
 * PersonAvatar targets, opening the same panel the rest of the app uses.
 *
 * Built on PersonAvatar, which already owns the click target, the fallback
 * initials and the accessible name. This adds only the overlap, the overflow
 * and the expansion.
 */
import { useState } from "react";
import { PersonAvatar } from "@/components/PersonAvatar";
import { faceSplit, type StackPerson } from "@/domain/conviction-cohort";

export function PersonStack({
  people,
  size = 26,
  className = "",
}: {
  people: StackPerson[];
  size?: number;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  if (people.length === 0) return null;

  const { faces, overflow } = faceSplit(people);
  const shown = expanded ? people : faces;

  return (
    <div className={`flex flex-wrap items-center gap-y-1 ${className}`}>
      {/* Negative margin overlaps the faces; each keeps its own full hit area. */}
      <div className="flex -space-x-1.5">
        {shown.map((p) => (
          <PersonAvatar
            key={p.wallet}
            wallet={p.wallet}
            name={p.name}
            avatarUrl={p.avatarUrl}
            size={size}
            className="ring-1 ring-[var(--bg)]"
          />
        ))}
      </div>

      {overflow > 0 && !expanded && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(true);
          }}
          // The count is the affordance — hover is never required to discover it.
          aria-label={`Show all ${people.length} people`}
          className="ml-1.5 grid shrink-0 place-items-center rounded-full px-2 text-[11px] font-semibold text-[var(--text-secondary)] transition-colors hover:text-[var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--text-muted)]"
          style={{ height: `${size}px`, minWidth: `${size}px`, border: "1px solid var(--border)" }}
        >
          +{overflow}
        </button>
      )}
    </div>
  );
}
