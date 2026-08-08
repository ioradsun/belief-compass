/**
 * PersonAvatar — the one face component.
 *
 * Every avatar in the app is the same clickable target: tapping it opens that
 * person's profile in the center panel (universal behaviour, via person-focus).
 * Falls back to a deterministic colour + initials when there's no picture.
 *
 * A NON-INTERACTIVE AVATAR IS NOT A BUTTON — it renders a `<span>`. This used to
 * be a disabled `<button>`, which is invalid the moment the face sits inside a
 * card that is itself a button: the HTML parser refuses nested buttons, so the
 * server's markup and React's tree disagree and hydration breaks. The Challenge
 * card is exactly that shape, and /testingscene caught it the first time the
 * shipped rail was rendered under the scene lab.
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
  /**
   * False when the wallet is partial/unresolvable, or when the face already sits
   * inside a larger click target — render the face, no control.
   */
  interactive?: boolean;
}) {
  const label = name || aliasFor(wallet);
  const px = `${size}px`;
  const [imgFailed, setImgFailed] = useState(false);
  const Tag = interactive ? "button" : "span";
  return (
    <Tag
      {...(interactive
        ? {
            type: "button" as const,
            onClick: (e: React.MouseEvent) => {
              e.stopPropagation();
              focusPerson(wallet);
            },
            title: `Open ${label}`,
            "aria-label": `Open ${label}'s profile`,
          }
        : { title: label, "aria-hidden": true })}
      className={`block shrink-0 overflow-hidden rounded-full transition-opacity ${interactive ? "hover:opacity-80" : "cursor-default"} focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--text-muted)] ${className}`}
      style={{ width: px, height: px }}
    >
      {avatarUrl && !imgFailed ? (
        <img
          src={avatarUrl}
          alt=""
          loading="lazy"
          width={size}
          height={size}
          onError={() => setImgFailed(true)}
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
    </Tag>
  );
}
