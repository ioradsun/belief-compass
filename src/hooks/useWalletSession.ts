/**
 * useWalletSession — one signature per wallet, cached locally, reused by every
 * write that is keyed by a wallet address (beliefs, House rounds).
 *
 * The signature prompt is reserved for actions that involve money. Free actions
 * (expressing a belief, passing, welcoming, training the House) call
 * `ensureSession({ interactive: false })`: they reuse a cached session when the
 * wallet already signed for a paid action, and are skipped otherwise instead of
 * popping the wallet open.
 */
import { useCallback } from "react";
import { useAccount, useSignMessage } from "wagmi";
import {
  randomNonce,
  readSessionToken,
  sessionMessage,
  writeSessionToken,
} from "@/lib/wallet-session";
import { startWalletSession } from "@/lib/wallet-session.functions";

export function useWalletSession() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const ensureSession = useCallback(
    async (opts?: { interactive?: boolean }): Promise<string> => {
      const interactive = opts?.interactive !== false;
      if (!address) throw new Error("Connect a wallet first.");
      const cached = readSessionToken(address);
      if (cached) return cached;
      if (!interactive) throw new SignatureRequired();
      const nonce = randomNonce();
      const signature = await signMessageAsync({
        message: sessionMessage(address, nonce),
        account: address,
      });
      const res = await startWalletSession({ data: { wallet: address, nonce, signature } });
      writeSessionToken(address, res.token, res.exp);
      return res.token;
    },
    [address, signMessageAsync],
  );

  return { ensureSession, address };
}

/** Thrown when a free action would need a fresh signature — it is skipped instead. */
export class SignatureRequired extends Error {
  constructor() {
    super("Wallet signature required.");
    this.name = "SignatureRequired";
  }
}

/** Run a wallet-signed side effect only when a session already exists. */
export async function bestEffort<T>(run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof SignatureRequired) return null;
    throw err;
  }
}

