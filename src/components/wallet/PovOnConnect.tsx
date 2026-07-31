/**
 * When a wallet connects, look up the POV profile and focus the home feed on
 * that wallet. Shared by both connect providers (RainbowKit and Privy).
 */
import { useEffect, useRef } from "react";
import { useAccount } from "wagmi";
import { useNavigate } from "@tanstack/react-router";
import { lookupPovUser } from "@/lib/pov-user.functions";
import { getWalletLink } from "@/lib/wallet-link.functions";
import { readLocalLink } from "@/lib/wallet-link";

export function PovOnConnect() {
  const { address, isConnected } = useAccount();
  const navigate = useNavigate();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!isConnected || !address) return;
    if (handled.current === address) return;
    handled.current = address;
    // Redirect at most once per address per tab, so Back isn't trapped.
    const key = `conviction:auto-nav:${address.toLowerCase()}`;
    try {
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, "1");
    } catch {
      /* storage unavailable — fall through and navigate once */
    }
    void lookupPovUser({ data: { wallet: address } }).catch(() => null);
    void (async () => {
      const local = readLocalLink(address);
      const linked =
        local ??
        (await getWalletLink({ data: { wallet: address.toLowerCase() } })
          .then((r) => r.linked)
          .catch(() => null));
      void navigate({
        to: "/",
        search: (prev: { wallet?: string; m?: number; p?: string; dna?: boolean }) => ({
          ...prev,
          wallet: linked ?? address,
        }),
        replace: true,
      });
    })();
  }, [address, isConnected, navigate]);

  return null;
}
