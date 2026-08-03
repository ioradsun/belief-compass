/**
 * Share attribution — client wiring.
 *
 * Two tiny hooks that close the loop without touching how anything renders:
 *   • useShareCode  — the connected wallet's ?r= code, for the share control.
 *   • useCaptureShareVisit — records a link OPEN on arrival, and binds this
 *     browser's opens to the wallet once one is connected.
 *
 * Everything here fails silently: attribution is a nice-to-have signal, never a
 * thing that can break a page load or a trade.
 */
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { getShareCode, recordShareVisit, bindShareVisit } from "@/lib/share.functions";
import { getVisitorId } from "@/lib/visitor";
import { readSessionToken } from "@/lib/wallet-session";

/** The stable ?r= code for a wallet (created on first use). Null when signed out. */
export function useShareCode(wallet?: string): string | null {
  const { data } = useQuery({
    queryKey: ["share-code", wallet ?? null],
    queryFn: async () => await getShareCode({ data: { wallet: wallet as string } }),
    enabled: !!wallet,
    staleTime: Infinity,
  });
  return (data as { code?: string } | undefined)?.code || null;
}

/**
 * Record the open for an arriving `?r=` link, and — independently — bind this
 * browser's prior opens to a wallet the moment one connects (with a short retry
 * while the session token is still being minted).
 */
export function useCaptureShareVisit(
  refCode: string | undefined | null,
  marketId: number | null | undefined,
  wallet: string | undefined | null,
) {
  // 1) The OPEN — once per (link, market) for this browser.
  const recorded = useRef<string | null>(null);
  useEffect(() => {
    if (!refCode || marketId == null) return;
    const visitorId = getVisitorId();
    if (!visitorId) return;
    const key = `${refCode}:${marketId}`;
    if (recorded.current === key) return;
    recorded.current = key;
    void recordShareVisit({ data: { refCode, marketId, visitorId } }).catch(() => {});
  }, [refCode, marketId]);

  // 2) The BIND — attribute this browser's opens to the connected wallet. Runs
  // whether or not a ?r= is in the current URL (a visitor may connect later).
  const bound = useRef<string | null>(null);
  useEffect(() => {
    if (!wallet) return;
    const visitorId = getVisitorId();
    if (!visitorId) return;
    if (bound.current === wallet) return;

    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = () => {
      const token = readSessionToken(wallet);
      if (!token) {
        // The token is minted during connect; give it a few seconds to appear.
        if (tries++ < 5) timer = setTimeout(attempt, 1200);
        return;
      }
      bound.current = wallet;
      void bindShareVisit({ data: { visitorId, wallet, sessionToken: token } }).catch(() => {});
    };
    attempt();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [wallet]);
}
