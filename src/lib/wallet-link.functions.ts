/**
 * Wallet linking — connect a smart-wallet login address to the POV trading
 * wallet it belongs to, proven by a signature from the trading wallet.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const addr = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

/** Message the trading wallet must sign to prove ownership. */
export function linkMessage(connected: string, linked: string, nonce: string) {
  return [
    "Conviction — link wallets",
    `Trading wallet: ${linked.toLowerCase()}`,
    `Connected wallet: ${connected.toLowerCase()}`,
    `Nonce: ${nonce}`,
  ].join("\n");
}

export const getWalletLink = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ wallet: addr }).parse(data))
  .handler(async ({ data }) => {
    const { publicClient } = await import("@/lib/supabase-clients");
    const { data: rows } = await publicClient()
      .from("wallet_links")
      .select("linked_wallet, verified_at")
      .eq("connected_wallet", data.wallet.toLowerCase())
      .not("verified_at", "is", null)
      .order("verified_at", { ascending: false })
      .limit(1);
    const row = rows?.[0];
    return { linked: row ? String(row.linked_wallet) : null };
  });

export const linkWallet = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({
        connected: addr,
        linked: addr,
        nonce: z.string().min(8).max(80),
        signature: z.string().regex(/^0x[a-fA-F0-9]+$/).max(4000),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const connected = data.connected.toLowerCase();
    const linked = data.linked.toLowerCase();
    if (connected === linked) throw new Error("Wallets are the same address.");

    const { getBaseClient } = await import("@/chain/client");
    const ok = await getBaseClient().verifyMessage({
      address: linked as `0x${string}`,
      message: linkMessage(connected, linked, data.nonce),
      signature: data.signature as `0x${string}`,
    });
    if (!ok) throw new Error("Signature did not match the trading wallet.");

    const { serviceClient } = await import("@/lib/supabase-clients");
    const { error } = await serviceClient()
      .from("wallet_links")
      .upsert(
        {
          connected_wallet: connected,
          linked_wallet: linked,
          signature: data.signature,
          verified_at: new Date().toISOString(),
        },
        { onConflict: "connected_wallet,linked_wallet" },
      );
    if (error) throw new Error(error.message);
    return { ok: true, linked };
  });
