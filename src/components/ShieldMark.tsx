/**
 * ShieldMark — the quiet trust affordance that sits beside the wallet action.
 *
 * A padlock next to "Connect wallet" is the one moment a newcomer is deciding
 * whether this is safe. One tap answers it: where the money sits, who can touch
 * it, what the fees are. Never a modal, never a dead icon.
 */
export function ShieldMark({
  onClick,
  className = "",
}: {
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Your wallet, your keys — see how it works"
      aria-label="Transparency & Trust"
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text)] ${className}`}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M12 3l7 3v5.5c0 4.4-2.9 8.2-7 9.5-4.1-1.3-7-5.1-7-9.5V6l7-3z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
        <path
          d="M9.2 12.2l2 2 3.6-4"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
