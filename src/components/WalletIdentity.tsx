/**
 * Wallet identity header — shows the two addresses that matter, side by side:
 * the Vendor Wallet you signed in with (often a smart wallet with no trades)
 * and the POV Wallet you actually trade from. Linking lives behind a toggle.
 */
import { useState } from "react";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { getWalletLink } from "@/lib/wallet-link.functions";
import { readLocalLink } from "@/lib/wallet-link";
import { LinkWalletCard } from "@/components/LinkWalletCard";

function short(w: string) {
  return `${w.slice(0, 6)}…${w.slice(-4)}`;
}

function Row({
  label,
  addr,
  note,
  hint,
}: {
  label: string;
  addr: string | null;
  note?: string;
  hint?: string;
}) {
  return (
    <div
      className="rounded-[14px] p-3"
      style={{ background: "var(--surface)" }}
    >
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
        {label}
      </div>
      <div className="num mt-1.5 text-[13px] text-[var(--text)]">
        {addr ? short(addr) : <span className="text-[var(--text-muted)]">{hint ?? "—"}</span>}
      </div>
      {note && <div className="mt-1 text-[11px] text-[var(--text-secondary)]">{note}</div>}
    </div>
  );
}

export function WalletIdentity({ viewing, compact }: { viewing: string; compact?: boolean }) {
  const { address } = useAccount();
  const vendor = address?.toLowerCase() ?? null;
  const [open, setOpen] = useState(false);

  const { data } = useQuery({
    queryKey: ["wallet-link", vendor],
    queryFn: async () => await getWalletLink({ data: { wallet: vendor as string } }),
    enabled: !!vendor,
  });

  const verified = (data as { linked?: string | null } | undefined)?.linked ?? null;
  const remembered = vendor ? readLocalLink(vendor) : null;
  const pov = verified ?? remembered ?? (vendor && viewing !== vendor ? viewing : null);
  const povNote = verified
    ? "Verified by signature — works on any device"
    : remembered
      ? "Remembered in this browser"
      : pov
        ? "Viewing only — not linked yet"
        : undefined;

  return (
    <section className={compact ? "pt-4" : "mt-6"}>
      <div className={compact ? "grid gap-2" : "grid gap-2 sm:grid-cols-2"}>
        <Row
          label="Vendor Wallet"
          addr={vendor}
          note={vendor ? "The address you signed in with" : undefined}
          hint="Not connected"
        />
        <Row label="POV Wallet" addr={pov} note={povNote} hint="Not linked" />
      </div>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-2 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text)]"
      >
        {open ? "Hide" : pov ? "Change POV wallet" : "Link POV wallet"}
      </button>

      {open && <LinkWalletCard />}
    </section>
  );
}
