/**
 * Self-serve profile edits — a person can override the display name and
 * picture we resolve from POV, proven by a signature from their connected
 * wallet (or a wallet verifiably linked to the profile wallet).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { profileEditMessage, MAX_AVATAR_BYTES, MAX_DISPLAY_NAME } from "@/lib/profile-edit";

const addr = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

export const getProfileOverride = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ wallet: addr }).parse(data))
  .handler(async ({ data }) => {
    const { serviceClient } = await import("@/lib/supabase-clients");
    const { data: row } = await serviceClient()
      .from("profile_overrides")
      .select("display_name, avatar_url")
      .eq("wallet", data.wallet.toLowerCase())
      .maybeSingle();
    return {
      displayName: (row?.display_name as string | null) ?? null,
      avatarUrl: (row?.avatar_url as string | null) ?? null,
    };
  });

export const saveProfileOverride = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({
        wallet: addr,
        signer: addr,
        nonce: z.string().min(8).max(80),
        signature: z
          .string()
          .regex(/^0x[a-fA-F0-9]+$/)
          .max(4000),
        displayName: z.string().trim().max(MAX_DISPLAY_NAME).nullable(),
        avatarUrl: z
          .string()
          .max(MAX_AVATAR_BYTES)
          .regex(/^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/)
          .nullable(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const wallet = data.wallet.toLowerCase();
    const signer = data.signer.toLowerCase();

    const { getBaseClient } = await import("@/chain/client");
    const ok = await getBaseClient().verifyMessage({
      address: signer as `0x${string}`,
      message: profileEditMessage(wallet, data.nonce),
      signature: data.signature as `0x${string}`,
    });
    if (!ok) throw new Error("Signature did not match your wallet.");

    const { serviceClient } = await import("@/lib/supabase-clients");
    const sb = serviceClient();

    if (signer !== wallet) {
      const { data: links } = await sb
        .from("wallet_links")
        .select("connected_wallet")
        .eq("connected_wallet", signer)
        .eq("linked_wallet", wallet)
        .not("verified_at", "is", null)
        .limit(1);
      if (!links?.length) throw new Error("This wallet isn't linked to that profile.");
    }

    const name = data.displayName?.trim() || null;
    if (name && /^0x[a-f0-9]{6,}/i.test(name)) throw new Error("Pick a name, not an address.");

    const { error } = await sb.from("profile_overrides").upsert(
      {
        wallet,
        display_name: name,
        avatar_url: data.avatarUrl,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "wallet" },
    );
    if (error) throw new Error(error.message);
    return { ok: true, displayName: name, avatarUrl: data.avatarUrl };
  });
