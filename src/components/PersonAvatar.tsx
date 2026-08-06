/**
 * PersonAvatar — the one face component.
 *
 * Every avatar in the app is the same clickable target: tapping it opens that
 * person's profile in the center panel (universal behaviour, via person-focus).
 * Falls back to a deterministic colour + initials when there's no picture.
 */
import { useState } from "react";
import { focusPerson } from "@/lib/person-focus";
import { aliasFor, hueFor, initialsFor } from "@/lib/wallet-identity";

export function PersonAvatar({
  wallet,
  name,
  avatarUrl,
  size = 28,
  className = "",
  interactive = true,
}: {
  wallet: string;
  name?: string | null;
  avatarUrl?: string | null;
  size?: number;
  className?: string;
  /** False when the wallet is partial/unresolvable — render the face, no link. */
  interactive?: boolean;
}) {
  const label = name || aliasFor(wallet);
  const px = `${size}px`;
  return (
    <button
      type="button"
      disabled={!interactive}
      onClick={(e) => {
        e.stopPropagation();
        if (interactive) focusPerson(wallet);
      }}
      title={interactive ? `Open ${label}` : label}
      {...(interactive ? { "aria-label": `Open ${label}'s profile` } : { "aria-hidden": true })}
      className={`shrink-0 overflow-hidden rounded-full transition-opacity ${interactive ? "hover:opacity-80" : "cursor-default"} focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--text-muted)] ${className}`}
      style={{ width: px, height: px }}
    >
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt=""
          loading="lazy"
          width={size}
          height={size}
          className="h-full w-full rounded-full object-cover"
        />
      ) : (
        <span
          className="grid h-full w-full place-items-center rounded-full font-semibold text-white"
          style={{
            background: `hsl(${hueFor(wallet)} 45% 45%)`,
            fontSize: `${Math.max(9, Math.round(size * 0.36))}px`,
          }}
          aria-hidden
        >
          {initialsFor(label)}
        </span>
      )}
    </button>
  );
}
