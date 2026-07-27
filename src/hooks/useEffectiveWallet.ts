/**
 * Resolves "whose convictions am I looking at?" in one place:
 *   ?wallet= in the URL  →  signature-verified link  →  browser-remembered link
 *   →  the connected vendor wallet itself.
 */
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { getWalletLink } from "@/lib/wallet-link.functions";
import { readLocalLink } from "@/lib/wallet-link";

export function useEffectiveWallet(searchWallet?: string): string | undefined {
  const { address } = useAccount();
  const vendor = address?.toLowerCase();

  const { data } = useQuery({
    queryKey: ["wallet-link", vendor ?? null],
    queryFn: async () => await getWalletLink({ data: { wallet: vendor as string } }),
    enabled: !!vendor,
  });

  // localStorage is browser-only: read after hydration so SSR markup matches.
  const [remembered, setRemembered] = useState<string | null>(null);
  useEffect(() => {
    setRemembered(vendor ? readLocalLink(vendor) : null);
  }, [vendor]);

  if (searchWallet) return searchWallet.toLowerCase();
  const verified = (data as { linked?: string | null } | undefined)?.linked ?? null;
  return (verified ?? remembered ?? vendor)?.toLowerCase();
}
