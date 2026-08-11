/**
 * Wallet sessions — public server function.
 *
 * One signature at connect time proves wallet ownership; the server returns a
 * short-lived signed token that authorizes later writes for that wallet.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { sessionMessage } from "@/lib/wallet-session";

const addr = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

export const startWalletSession = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z
      .object({
        wallet: addr,
        nonce: z.string().min(8).max(80),
        signature: z
          .string()
          .regex(/^0x[a-fA-F0-9]+$/)
          .max(4000),
      })
      .parse(raw),
  )
  .handler(async ({ data }) => {
    const wallet = data.wallet.toLowerCase();
    const { getBaseClient } = await import("@/chain/client");
    const ok = await getBaseClient().verifyMessage({
      address: wallet as `0x${string}`,
      message: sessionMessage(wallet, data.nonce),
      signature: data.signature as `0x${string}`,
    });
    if (!ok) throw new Error("Signature did not match your wallet.");

    const { mintSessionToken } = await import("@/lib/wallet-session.server");
    const { token, exp } = await mintSessionToken(wallet);
    return { wallet, token, exp };
  });

/**
 * Connect-only session — no signature.
 *
 * Signing is reserved for actions that move money. Everything else (beliefs,
 * challenges, the House, Simulation) opens a session from the connected wallet
 * address alone, so a person is never asked to sign for a free action.
 */
export const startConnectSession = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => z.object({ wallet: addr }).parse(raw))
  .handler(async ({ data }) => {
    const wallet = data.wallet.toLowerCase();
    const { mintSessionToken } = await import("@/lib/wallet-session.server");
    const { token, exp } = await mintSessionToken(wallet);
    return { wallet, token, exp };
  });
