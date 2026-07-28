/**
 * ACCOUNT — lives at the top-left of the left rail.
 *
 * Collapsed: just a profile picture and name — the quietest possible anchor.
 * Expanded: the account opens *inside* the rail (no floating layer), taking
 * over the panel with identity, wallets, the link flow and sign out, and a
 * clear way back. Everything account-related is behind this one affordance.
 */
import { useEffect, useState } from "react";
import { useAccount, useDisconnect } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp } from "lucide-react";
import { lookupPovUser } from "@/lib/pov-user.functions";
import { getPersonProfile } from "@/lib/dna.functions";
import { WalletIdentity } from "@/components/WalletIdentity";
import { ProfileEditor } from "@/components/ProfileEditor";
import { getProfileOverride } from "@/lib/profile-edit.functions";
import { aliasFor, hueFor, initialsFor } from "@/lib/wallet-identity";

/** Never show a raw 0x address as a name — fall back to the neutral alias. */
function nameOf(candidates: (string | null | undefined)[], wallet: string) {
  for (const c of candidates) {
    const v = c?.trim();
    if (v && !/^0x[a-f0-9]{6,}/i.test(v)) return v;
  }
  return wallet ? aliasFor(wallet) : "";
}

export function AccountRail({
  wallet,
  onOpenProfile,
  open,
  onOpenChange,
}: {
  /** The effective (POV / trading) wallet being represented. */
  wallet?: string;
  onOpenProfile: (wallet: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { address } = useAccount();
  const { disconnect } = useDisconnect();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const me = (wallet ?? address ?? "").toLowerCase();

  const { data } = useQuery({
    queryKey: ["pov-user", me || null],
    queryFn: async () => await lookupPovUser({ data: { wallet: me } }),
    enabled: mounted && Boolean(me),
    staleTime: 5 * 60_000,
  });

  // Fallback naming: POV rarely fills username, so fall back to the profile
  // name we already resolve everywhere else (never a raw address).
  const { data: profile } = useQuery({
    queryKey: ["person", me || null, "self-name"],
    queryFn: async () => await getPersonProfile({ data: { wallet: me } }),
    enabled: mounted && Boolean(me),
    staleTime: 5 * 60_000,
  });

  // What you set yourself always wins over the POV-resolved identity.
  const { data: override } = useQuery({
    queryKey: ["profile-override", me],
    queryFn: async () => await getProfileOverride({ data: { wallet: me } }),
    enabled: mounted && Boolean(me),
    staleTime: 60_000,
  });

  const user = data?.user ?? null;
  const name = nameOf(
    [override?.displayName, user?.username, user?.displayName, profile?.displayName],
    me,
  );
  const avatar = override?.avatarUrl ?? user?.pfpUrl ?? profile?.avatarUrl ?? null;


  const Avatar = ({ size }: { size: number }) =>
    avatar ? (
      <img
        src={avatar}
        alt=""
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    ) : (
      <span
        className="grid place-items-center rounded-full font-semibold text-white"
        style={{
          width: size,
          height: size,
          fontSize: Math.round(size * 0.36),
          background: `hsl(${hueFor(me || "0x0")} 45% 45%)`,
        }}
        aria-hidden
      >
        {initialsFor(name)}
      </span>
    );

  return (
    <div className={open ? "flex min-h-0 flex-1 flex-col" : "contents"}>
      {/* One header row, always in the same place. Chevron flips up/down. */}
      <div className="-mx-2 mb-4 flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition-colors hover:bg-[var(--surface)]">
        <button
          type="button"
          onClick={() => me && onOpenProfile(me)}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
          title="View my profile"
        >
          <Avatar size={28} />
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--text)]">
            {name}
          </span>
        </button>
        <button
          type="button"
          onClick={() => onOpenChange(!open)}
          aria-expanded={open}
          aria-label={open ? "Close account" : "Open account"}
          className="shrink-0 rounded-md p-0.5 text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
        >
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>

      {open && (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {me && <ProfileEditor wallet={me} fallbackName={name} />}
            <WalletIdentity viewing={me} compact />
          </div>


          <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
            <button
              type="button"
              onClick={() => {
                disconnect();
                onOpenChange(false);
              }}
              className="-mx-2 w-[calc(100%+1rem)] rounded-xl px-2 py-2 text-left text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text)]"
            >
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

