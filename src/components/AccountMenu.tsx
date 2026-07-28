/**
 * ACCOUNT — the single place every account-related thing lives.
 *
 * Signed out: one honest "Connect wallet" affordance.
 * Signed in: a profile pic in the top-right. Opening it reveals identity
 * (username + POV wallet + vendor wallet), the link flow, and sign out.
 * Tapping the picture or the username opens that profile in the center.
 */
import { useEffect, useRef, useState } from "react";
import { useAccount, useDisconnect } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { lookupPovUser } from "@/lib/pov-user.functions";
import { WalletIdentity } from "@/components/WalletIdentity";
import { WalletConnectButton } from "@/components/WalletConnect";
import { hueFor, initialsFor } from "@/lib/wallet-identity";

function short(w: string) {
  return `${w.slice(0, 6)}…${w.slice(-4)}`;
}

export function AccountMenu({
  wallet,
  onOpenProfile,
}: {
  /** The effective (POV / trading) wallet being represented. */
  wallet?: string;
  onOpenProfile: (wallet: string) => void;
}) {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

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

  if (!mounted || !isConnected) {
    return (
      <div className="shrink-0">
        <WalletConnectButton />
      </div>
    );
  }

  const openProfile = () => {
    if (me) onOpenProfile(me);
    setOpen(false);
  };

  return (
    <div className="relative shrink-0" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account"
        className="grid h-10 w-10 place-items-center overflow-hidden rounded-full border border-[var(--border)] bg-[var(--surface)] transition-colors hover:border-[var(--text-muted)]"
      >
        {avatar ? (
          <img src={avatar} alt="" className="h-full w-full object-cover" />
        ) : (
          <span
            className="grid h-full w-full place-items-center text-[12px] font-semibold text-white"
            style={{ background: `hsl(${hueFor(me || "0x0")} 45% 45%)` }}
            aria-hidden
          >
            {initialsFor(name)}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-12 z-50 w-[320px] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-3 shadow-xl"
        >
          {/* Identity — tapping it opens the profile in the center. */}
          <button
            type="button"
            onClick={openProfile}
            className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-[var(--surface)]"
          >
            {avatar ? (
              <img src={avatar} alt="" className="h-10 w-10 rounded-full object-cover" />
            ) : (
              <span
                className="grid h-10 w-10 place-items-center rounded-full text-[12px] font-semibold text-white"
                style={{ background: `hsl(${hueFor(me || "0x0")} 45% 45%)` }}
                aria-hidden
              >
                {initialsFor(name)}
              </span>
            )}
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-semibold text-[var(--text)]">
                {name}
              </span>
              <span className="block text-[11px] text-[var(--text-muted)]">View my profile</span>
            </span>
          </button>

          <div className="my-2" style={{ borderTop: "1px solid var(--border)" }} />

          {/* Wallets — POV (trading) and vendor (login), with the link flow. */}
          <div className="max-h-[46vh] overflow-y-auto pr-0.5">
            <WalletIdentity viewing={me} compact />
          </div>

          <div className="my-2" style={{ borderTop: "1px solid var(--border)" }} />

          <button
            type="button"
            onClick={() => {
              disconnect();
              setOpen(false);
            }}
            className="w-full rounded-xl px-3 py-2 text-left text-[13px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text)]"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
