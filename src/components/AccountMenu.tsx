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
import { ChevronDown, ChevronLeft } from "lucide-react";
import { lookupPovUser } from "@/lib/pov-user.functions";
import { WalletIdentity } from "@/components/WalletIdentity";
import { hueFor, initialsFor } from "@/lib/wallet-identity";

function short(w: string) {
  return `${w.slice(0, 6)}…${w.slice(-4)}`;
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

  const user = data?.user ?? null;
  const name = user?.username ?? user?.displayName ?? (me ? short(me) : "");
  const avatar = user?.pfpUrl ?? null;

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

  if (open) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="-ml-1 mb-4 flex items-center gap-1 self-start rounded-md px-1 py-1 text-[11px] font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Back
        </button>

        {/* Identity — tapping opens the profile in the center panel. */}
        <button
          type="button"
          onClick={() => {
            if (me) onOpenProfile(me);
            onOpenChange(false);
          }}
          className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-[var(--surface)]"
        >
          <Avatar size={40} />
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold text-[var(--text)]">
              {name}
            </span>
            <span className="block text-[11px] text-[var(--text-muted)]">View my profile</span>
          </span>
        </button>

        <div className="my-3" style={{ borderTop: "1px solid var(--border)" }} />

        <div className="min-h-0 flex-1 overflow-y-auto">
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
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpenChange(true)}
      aria-expanded={false}
      className="-mx-2 mb-4 flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-[var(--surface)]"
    >
      <Avatar size={28} />
      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--text)]">
        {name}
      </span>
      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
    </button>
  );
}
